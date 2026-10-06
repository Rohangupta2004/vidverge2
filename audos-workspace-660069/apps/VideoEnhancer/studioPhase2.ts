/**
 * Video Studio Phase 2 — subject-aware B-roll and per-project music.
 *
 * The OpenAI text proxy does not accept image models or Gemini model ids, so
 * visual analysis uses the supported platform path: server-side frame
 * extraction followed by Gemini Vision. Every paid/AI request carries the
 * injected workspace token. The two independently analysed frames are merged
 * deterministically so one unusual frame cannot completely change the result.
 */
import { WORKSPACE_UUID, MusicStyleId, SubjectMood, SubjectProfile } from './studioModel';
import { workspaceToken } from './enhancerCore';

interface FrameAnalysis {
  subject_type: string;
  dominant_color: string;
  background_description: string;
  mood: SubjectMood;
}

const MOODS: SubjectMood[] = ['energetic', 'calm', 'dramatic', 'playful'];

function clean(value: unknown, fallback: string, max = 180): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return (text || fallback).slice(0, max);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Subject detection returned an unexpected response.');
  return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
}

async function imageUrlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read an extracted frame (HTTP ${response.status}).`);
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not encode an extracted frame.'));
    reader.readAsDataURL(blob);
  });
  return { data, mimeType: blob.type || 'image/png' };
}

async function analyzeFrame(url: string): Promise<FrameAnalysis> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const image = await imageUrlToBase64(url);
  const response = await fetch('/api/generate/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      image: image.data,
      mimeType: image.mimeType,
      prompt: [
        'Identify the primary subject (person, product, object) in this video frame.',
        'Return JSON only with exactly these keys:',
        '{"subject_type":"short noun phrase","dominant_color":"single common color name or hex","background_description":"one concise sentence","mood":"energetic|calm|dramatic|playful"}',
        'Choose exactly one allowed mood. Do not add markdown.',
      ].join(' '),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(String(payload?.error || `Gemini Vision failed (HTTP ${response.status}).`));
  }
  const parsed = parseJsonObject(String(payload.result || ''));
  const mood = MOODS.includes(parsed.mood as SubjectMood) ? parsed.mood as SubjectMood : 'calm';
  return {
    subject_type: clean(parsed.subject_type, 'main subject', 80),
    dominant_color: clean(parsed.dominant_color, 'neutral', 32),
    background_description: clean(parsed.background_description, 'the visible scene', 220),
    mood,
  };
}

/** Extract the required 25% and 75% frames and identify the subject in both. */
export async function detectSubjectProfile(videoUrl: string, durationS: number): Promise<SubjectProfile> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  if (!/^https?:\/\//i.test(videoUrl)) throw new Error('Subject detection starts after the durable video upload finishes.');
  const duration = Math.max(0.4, Number(durationS) || 1);
  const timestamps = [duration * 0.25, duration * 0.75].map((n) => Number(n.toFixed(3)));
  const framesResponse = await fetch('/api/video/frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ videoUrl, timestamps, workspaceId: WORKSPACE_UUID }),
  });
  const framesPayload = await framesResponse.json().catch(() => null);
  const frameUrls: string[] = Array.isArray(framesPayload?.frames)
    ? framesPayload.frames.map((f: { url?: unknown }) => String(f?.url || '')).filter(Boolean)
    : [];
  if (!framesResponse.ok || frameUrls.length < 2) {
    throw new Error(String(framesPayload?.error || 'The two subject-detection frames could not be extracted.'));
  }

  const reads = await Promise.all(frameUrls.slice(0, 2).map(analyzeFrame));
  const [a, b] = reads;
  const subjectType = a.subject_type.toLowerCase() === b.subject_type.toLowerCase()
    ? a.subject_type
    : `${a.subject_type} / ${b.subject_type}`;
  const dominantColor = a.dominant_color.toLowerCase() === b.dominant_color.toLowerCase()
    ? a.dominant_color
    : `${a.dominant_color}, ${b.dominant_color}`;
  const backgroundDescription = a.background_description.toLowerCase() === b.background_description.toLowerCase()
    ? a.background_description
    : `${a.background_description}; later, ${b.background_description.charAt(0).toLowerCase()}${b.background_description.slice(1)}`;
  const mood = a.mood === b.mood ? a.mood : a.mood;
  return {
    subjectType,
    dominantColor,
    backgroundDescription,
    mood,
    frameUrls: frameUrls.slice(0, 2),
    detectedAt: new Date().toISOString(),
  };
}

export function resolvedMusicStyle(style: MusicStyleId, mood: SubjectMood): Exclude<MusicStyleId, 'auto'> {
  if (style !== 'auto') return style;
  if (mood === 'energetic') return 'uptempo';
  if (mood === 'dramatic') return 'cinematic';
  if (mood === 'playful') return 'playful';
  return 'ambient';
}

export function musicPromptFor(profile: SubjectProfile | null, style: MusicStyleId, variation = 1): string {
  const mood = profile?.mood || 'calm';
  const selected = resolvedMusicStyle(style, mood);
  const genre = selected === 'uptempo'
    ? 'uptempo electronic and hip-hop instrumental'
    : selected === 'ambient'
      ? 'ambient lo-fi instrumental'
      : selected === 'cinematic'
        ? 'cinematic orchestral instrumental'
        : selected === 'playful'
          ? 'playful pop and indie instrumental'
          : 'no music';
  const subject = profile?.subjectType || 'creator video';
  return `${genre} for a ${subject} video, ${mood}, modern, clean, no vocals${variation > 1 ? `, variation ${variation}` : ''}`;
}

/** Generate a durable music URL. Gemini/Lyria is used for the Remotion export. */
export async function generateBackgroundMusic(opts: {
  profile: SubjectProfile | null;
  style: MusicStyleId;
  lengthSeconds: number;
  variation?: number;
}): Promise<{ url: string; prompt: string; provider: string; durationMs: number }> {
  if (opts.style === 'none') return { url: '', prompt: '', provider: 'none', durationMs: 0 };
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const prompt = musicPromptFor(opts.profile, opts.style, opts.variation || 1);
  const response = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/music/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      prompt,
      lengthMs: Math.max(3000, Math.min(600000, Math.round(Math.max(3, opts.lengthSeconds) * 1000))),
      instrumental: true,
      provider: 'gemini',
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success || !data.audioUrl) {
    throw new Error(String(data?.error || `Music generation failed (HTTP ${response.status}).`));
  }
  return {
    url: String(data.audioUrl),
    prompt,
    provider: String(data.provider || 'gemini'),
    durationMs: Number(data.durationMs) || 0,
  };
}

/** Subject-aware ranking for the workspace B-roll library. */
export function rankBrollSuggestions<T extends { prompt?: string; provider?: string }>(items: T[], profile: SubjectProfile | null): T[] {
  if (!profile) return items;
  const terms = `${profile.subjectType} ${profile.backgroundDescription} ${profile.dominantColor}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const scored = items.map((item, index) => {
    const hay = `${item.prompt || ''} ${item.provider || ''}`.toLowerCase();
    const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
    return { item, index, score };
  });
  const matched = scored.filter((entry) => entry.score > 0);
  const pool = matched.length >= 3 ? matched : scored;
  return pool
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 30)
    .map((entry) => entry.item);
}
