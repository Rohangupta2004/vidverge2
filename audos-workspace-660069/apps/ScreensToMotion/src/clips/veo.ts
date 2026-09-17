/**
 * Veo atmosphere clips (Phase 2 §8). Veo generates ATMOSPHERE ONLY — hands,
 * rooms, light, texture, movement. Standing constraints ride on every prompt,
 * and the rejection gate (./gate) enforces them: any frame showing a screen
 * with an interface, legible text, a logo or signage discards the clip.
 * Discarded clips are regenerated up to 2 attempts, then the caller falls
 * back to a screenshot scene.
 *
 * Model: veo-3.0-fast-generate-001 through the platform proxy
 * (/api/veo/generate/video) — text-to-video, 1080p, no audio (the audio
 * default for clip scenes is "strip" anyway).
 */
import { CLIP_RULES, type IngestedClip } from '../types';
import { probeToClip } from './probe';
import { screenGateCheck, type GateRejection } from './gate';

export const STANDING_CONSTRAINTS =
  'No screens, monitors, phones or tablets showing content — any visible device screen must be completely blank. ' +
  'No text, signage, labels, logos or UI of any kind in frame. ' +
  'Shallow depth of field, subject-led framing.';

const NEGATIVE_PROMPT = 'screens with content, monitors with content, visible interface, UI, text, captions, subtitles, signage, labels, logos, watermarks, writing';

export interface AtmosphereResult {
  clip: IngestedClip | null;
  attempts: number;
  rejectionLog: Array<{ attempt: number; rejections: GateRejection[] }>;
}

async function generateOnce(prompt: string, onProgress?: (message: string) => void): Promise<string> {
  const response = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'veo-3.0-fast-generate-001',
      prompt,
      negativePrompt: NEGATIVE_PROMPT,
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: 6,
      generateAudio: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 402) throw new Error('The workspace wallet needs funds before atmosphere clips can be generated.');
  if (!response.ok || !body?.operationId) {
    throw new Error(body?.error || `Atmosphere generation could not be started (${response.status}).`);
  }
  const operationId = String(body.operationId);
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusResponse = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`);
    const status = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok) throw new Error(status?.error || `Atmosphere generation status check failed (${statusResponse.status}).`);
    const state = String(status?.status || '').toLowerCase();
    onProgress?.(`Atmosphere clip ${state}${status?.progress ? ` — ${status.progress}%` : '…'}`);
    if (state === 'completed' && status?.videoUrl) return String(status.videoUrl);
    if (state === 'failed') throw new Error(status?.errorMessage || 'Atmosphere generation failed.');
  }
  throw new Error('Atmosphere generation timed out.');
}

/**
 * Generate one gated atmosphere clip. Returns clip: null after the retry
 * budget is exhausted — the caller falls back to a screenshot scene and the
 * full rejection log explains why.
 */
export async function generateAtmosphereClip(
  idea: string,
  clipId: string,
  workspaceId: string,
  onProgress?: (message: string) => void,
): Promise<AtmosphereResult> {
  const prompt = `${idea.trim().replace(/[.\s]+$/, '')}. ${STANDING_CONSTRAINTS}`;
  const rejectionLog: AtmosphereResult['rejectionLog'] = [];
  const maxAttempts = 1 + CLIP_RULES.maxGateAttempts; // initial + 2 regenerations
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt === 1 ? 'Generating atmosphere clip…' : `Regenerating after gate rejection (attempt ${attempt}/${maxAttempts})…`);
    const url = await generateOnce(prompt, onProgress);
    onProgress?.('Running the rejection gate…');
    const gate = await screenGateCheck(url, 6, workspaceId);
    if (gate.passed) {
      onProgress?.('Gate passed — measuring the clip’s true frame rate…');
      const clip = await probeToClip(url, 'veo', `atmosphere-${clipId}.mp4`, clipId);
      return { clip, attempts: attempt, rejectionLog };
    }
    rejectionLog.push({ attempt, rejections: gate.rejections });
  }
  console.warn(`[screens-to-motion:veo] atmosphere clip discarded after ${maxAttempts} attempts — falling back to a screenshot scene`, rejectionLog);
  return { clip: null, attempts: maxAttempts, rejectionLog };
}
