import { useCallback, useEffect, useState } from 'react';
import { WORKSPACE_ID, type Project, type WordTimestamp } from '../lib/supabase';
import { sleep } from '../lib/proxy';
import { approximateWordTimestamps } from '../agents/sceneDeciderAgent';

const base = `/api/workspaces/${WORKSPACE_ID}/provider-credentials/heygen/proxy`;
async function heygen(path: string, init?: RequestInit) { const response = await fetch(`${base}/${path.replace(/^\/+/, '')}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data?.error?.message || data?.message || data?.error || `HeyGen failed (${response.status})`); return data; }
function cueTime(value: string) { const parts = value.trim().replace(',', '.').split(':').map(Number); return parts.reduce((sum, part) => sum * 60 + part, 0); }
async function wordsFromSubtitle(url?: string): Promise<WordTimestamp[]> {
  if (!url) return [];
  try {
    const text = await fetch(url).then((response) => response.text()); const lines = text.split(/\r?\n/); const words: WordTimestamp[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/); if (!match) continue;
      const start = cueTime(match[1]); const end = cueTime(match[2]); const cueWords = String(lines[i + 1] || '').replace(/<[^>]+>/g, '').trim().split(/\s+/).filter(Boolean);
      cueWords.forEach((word, index) => words.push({ word, start: start + (end - start) * index / cueWords.length, end: start + (end - start) * (index + 1) / cueWords.length }));
    }
    return words;
  } catch { return []; }
}
export interface HeyGenOptions { avatar_id: string; voice_id: string; engine?: string; resolution: '720p' | '1080p' | '4k'; aspect_ratio: '16:9' | '9:16'; fit: 'cover' | 'contain'; background: { type: 'color' | 'image'; value?: string; url?: string }; voice_settings: { speed: number; pitch?: number; emotion?: string }; captions: boolean; caption_style?: Record<string, unknown>; gestures: boolean; gesture_style?: string; pose?: string; expression?: string; camera?: string; output_format?: 'mp4' | 'webm'; advanced?: Record<string, unknown> }
export function useHeyGen() {
  const [avatars, setAvatars] = useState<any[]>([]); const [voices, setVoices] = useState<any[]>([]); const [progress, setProgress] = useState('');
  useEffect(() => { Promise.all([heygen('v3/avatars/looks?limit=50'), heygen('v3/voices?limit=100')]).then(([a, v]) => { setAvatars(Array.isArray(a.data) ? a.data : []); setVoices(Array.isArray(v.data) ? v.data : []); }).catch(() => undefined); }, []);
  const generate = useCallback(async (project: Project, options: HeyGenOptions) => {
    setProgress('Validating avatar and voice'); const detail = await heygen(`v3/avatars/looks/${encodeURIComponent(options.avatar_id)}`); const supported = detail.data?.supported_api_engines || []; const engine = options.engine && supported.includes(options.engine) ? options.engine : ['avatar_iv', 'avatar_v', 'avatar_iii'].find((v) => supported.includes(v)); if (!engine) throw new Error('This avatar has no supported v3 engine.');
    await heygen(`v3/voices/${encodeURIComponent(options.voice_id)}`);
    // POST /v3/videos rejects every unknown key. Keep this payload aligned with
    // the documented avatar-video contract instead of forwarding advanced UI
    // controls or the unsupported pitch/emotion voice settings.
    const speed = Math.min(1.5, Math.max(0.5, Number(options.voice_settings?.speed) || 1));
    const background = options.background.type === 'image' && options.background.url
      ? { type: 'image' as const, url: options.background.url }
      : { type: 'color' as const, value: options.background.value || '#0f172a' };
    const body = {
      type: 'avatar',
      avatar_id: options.avatar_id,
      engine: { type: engine },
      script: project.script,
      voice_id: options.voice_id,
      voice_settings: { speed },
      resolution: options.resolution,
      aspect_ratio: options.aspect_ratio,
      fit: options.fit,
      ...(options.output_format === 'webm' ? {} : { background }),
      output_format: options.output_format || 'mp4',
    };
    setProgress('Submitting avatar render'); const created = await heygen('v3/videos', { method: 'POST', body: JSON.stringify(body) }); const videoId = created.data?.video_id; if (!videoId) throw new Error('HeyGen did not return a video id.');
    for (let i = 0; i < 160; i += 1) { setProgress(`HeyGen is rendering · ${i * 15}s`); await sleep(15000); const status = await heygen(`v3/videos/${encodeURIComponent(videoId)}`); const video = status.data || status; if (video.status === 'completed') { const duration = Number(video.duration || project.estimated_duration_sec || project.target_length_sec); const subtitleWords = await wordsFromSubtitle(video.subtitle_url || video.caption_url); const words: WordTimestamp[] = Array.isArray(video.word_timestamps) && video.word_timestamps.length ? video.word_timestamps : subtitleWords.length ? subtitleWords : approximateWordTimestamps(project.script || '', duration); setProgress('Avatar video ready'); return { videoId, videoUrl: video.video_url, duration, words, raw: video }; } if (video.status === 'failed') throw new Error([video.failure_code, video.failure_message].filter(Boolean).join(': ') || 'HeyGen render failed'); }
    throw new Error('HeyGen render timed out. You can safely come back and resume.');
  }, []);
  return { avatars, voices, progress, generate };
}
