/**
 * Script Graphics mode — paste a video script, the workspace AI proxy
 * (gpt-5.6-terra via POST /proxy/openai/v1/chat/completions) splits it into
 * timed scenes, and a self-contained Remotion composition renders matching
 * overlays (title cards, lower-thirds, callouts) on top of the base video
 * through the existing render pipeline (POST /api/render/remotion — the same
 * contract enhancerCore/enhancerRender already use).
 *
 * Overlay design rules (enforced BOTH in the LLM prompt and in the
 * composition itself, so a wayward AI answer can never break them):
 * - Every overlay is anchored to the LOWER portion of the frame — the bottom
 *   15–20% of the 16:9 canvas. The center of the image is never obscured.
 * - Positions vary per scene: bottom-left, bottom-center, bottom-right,
 *   alternating so consecutive scenes never sit in the same spot.
 * - Each overlay enters with a subtle fade-in + slide-up and fades out.
 * - Typography is clean white sans-serif on a semi-transparent dark backdrop
 *   with a drop shadow for legibility — enhancing, never covering, the video.
 */
import { workspaceToken, WORKSPACE_UUID } from './enhancerCore';

export type SceneOverlayType = 'title' | 'lowerthird' | 'callout' | 'none';
export type SceneOverlayPos = 'left' | 'center' | 'right';

export interface ScriptScene {
  startSec: number;
  endSec: number;
  title: string;
  body: string;
  type: SceneOverlayType;
  /** Horizontal anchor inside the bottom band — alternates per scene. */
  pos: SceneOverlayPos;
}

const OVERLAY_TYPES: readonly string[] = ['title', 'lowerthird', 'callout', 'none'];
const OVERLAY_POSITIONS: readonly SceneOverlayPos[] = ['left', 'center', 'right'];
const MAX_SCENES = 24;

function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Coerce one raw LLM scene object into a validated ScriptScene (or null). */
function toScene(raw: unknown, index: number): ScriptScene | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const start = Number(r.startSec);
  const end = Number(r.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 64) : '';
  const body = typeof r.body === 'string' ? r.body.trim().slice(0, 140) : '';
  if (!title && !body) return null;
  const type: SceneOverlayType = typeof r.type === 'string' && OVERLAY_TYPES.includes(r.type)
    ? (r.type as SceneOverlayType)
    : 'none';
  // Position from the AI when valid; otherwise rotate left → center → right
  // so consecutive scenes always land in different spots.
  const pos: SceneOverlayPos = typeof r.pos === 'string' && (OVERLAY_POSITIONS as readonly string[]).includes(r.pos)
    ? (r.pos as SceneOverlayPos)
    : OVERLAY_POSITIONS[index % OVERLAY_POSITIONS.length];
  const s = Math.max(0, round1(start));
  return { startSec: s, endSec: round1(Math.max(end, s + 1)), title: title || body.slice(0, 40), body, type, pos };
}

interface ChatChoice { message?: { content?: string | null } | null }
interface ChatResponse { choices?: ChatChoice[]; error?: { message?: string } | string | null }

function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last <= first) throw new Error('The AI response came back in an unexpected format — try again.');
  const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1));
  if (!Array.isArray(parsed)) throw new Error('The AI response was not a scene list — try again.');
  return parsed;
}

/**
 * One gpt-5.6-terra pass over the pasted script: split it into ordered,
 * non-overlapping scenes with an estimated time range, one overlay plan
 * (title card / lower-third / callout / none) and one bottom-band position
 * (left / center / right, varied) per scene.
 */
export async function parseScriptScenes(script: string, videoDurationSec: number | null): Promise<ScriptScene[]> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const durationLine = videoDurationSec && videoDurationSec > 0
    ? 'The base video is ' + Math.round(videoDurationSec) + ' seconds long. Every startSec/endSec must fall between 0 and ' + Math.round(videoDurationSec) + ', with scenes in order, non-overlapping, together spanning the video.'
    : 'The exact video length is unknown — estimate it from the script at roughly 2.4 spoken words per second, then spread the scenes across that estimate in order, non-overlapping.';
  const prompt = [
    'You are a motion-graphics director for a video editor. Split the video script below into scenes and plan one graphic overlay per scene.',
    '',
    'SCRIPT:',
    script.slice(0, 8000),
    '',
    durationLine,
    '',
    'Return ONLY a JSON array (no prose, no markdown), each element exactly this shape:',
    '{"startSec": number, "endSec": number, "title": "scene heading or first sentence, 8 words max", "body": "optional key line or callout, 20 words max (empty string if none)", "type": "title" | "lowerthird" | "callout" | "none", "pos": "left" | "center" | "right"}',
    '',
    'Rules:',
    '- 2 to ' + MAX_SCENES + ' scenes, ordered by startSec, non-overlapping.',
    '- PLACEMENT (critical): ALL text and graphic overlays are rendered in the LOWER portion of the frame — the bottom 15–20% of the 16:9 canvas. They must NEVER obscure the center of the image. Overlays are non-intrusive: they enhance the video, they do not cover its subject.',
    '- "pos" is the horizontal anchor inside that bottom band: "left" = bottom-left, "center" = bottom-center, "right" = bottom-right. VARY the position across scenes — alternate between bottom-left, bottom-center and bottom-right so consecutive scenes never use the same position twice in a row.',
    '- "title": the boldest bottom-band card — the opening scene and major chapter breaks only.',
    '- "lowerthird": a slim strip — speaker or context lines.',
    '- "callout": a compact badge — one short punchy key line.',
    '- "none": the scene needs no overlay.',
  ].join('\n');
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = (await res.json().catch(() => null)) as ChatResponse | null;
  if (!res.ok) {
    const err = data && data.error ? (typeof data.error === 'string' ? data.error : data.error.message || '') : '';
    throw new Error(err || ('AI request failed (HTTP ' + res.status + ').'));
  }
  const first = data && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = first && first.message && typeof first.message.content === 'string' ? first.message.content : '';
  if (!content.trim()) throw new Error('The AI returned an empty response — try again.');
  const scenes = extractJsonArray(content)
    .map((raw, i) => toScene(raw, i))
    .filter((s): s is ScriptScene => s !== null)
    .slice(0, MAX_SCENES);
  scenes.sort((a, b) => a.startSec - b.startSec);
  return scenes;
}

/**
 * Clamp scene time ranges to the real video duration. Scenes that start past
 * the end are dropped; the render must never ask Remotion to extract frames
 * beyond the source video (that fails the whole render server-side).
 */
export function clampScenesToDuration(scenes: ScriptScene[], durationSec: number): ScriptScene[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return scenes;
  return scenes
    .filter((s) => s.startSec < durationSec - 0.25)
    .map((s) => (s.endSec > durationSec ? { ...s, endSec: round1(durationSec) } : s))
    .filter((s) => s.endSec - s.startSec >= 0.4);
}

/** Read a video URL's duration client-side (metadata only). Resolves null on failure. */
export function probeVideoDuration(url: string, timeoutMs = 12000): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    let timer = 0;
    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.removeAttribute('src');
      try { v.load(); } catch { /* no-op */ }
      resolve(d);
    };
    timer = window.setTimeout(() => finish(null), timeoutMs);
    v.preload = 'metadata';
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => finish(null);
    v.src = url;
  });
}

/**
 * Submit the Script Graphics render. Same endpoint, headers and body contract
 * as submitRender / submitRenderV2; the composition source travels as a string
 * (never eval'd client-side) and the scenes ride along as inputProps.
 */
export async function submitScriptGraphicsRender(scenes: ScriptScene[], videoUrl: string, durationInFrames: number): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      workspaceId: WORKSPACE_UUID,
      compositionTsx: SCRIPT_GRAPHICS_COMPOSITION,
      props: { scenes, videoUrl },
      durationInFrames,
      fps: 30,
      // The platform's Remotion service only accepts fixed landscape geometry
      // (width 1920 / height 1080 — anything else is rejected server-side).
      // The composition designs at a 1280x720 reference and scales up.
      width: 1920,
      height: 1080,
    }),
  });
  const data = (await res.json().catch(() => null)) as { operationId?: unknown; error?: unknown } | null;
  if (!res.ok || !data || typeof data.operationId !== 'string' || !data.operationId) {
    const err = data && typeof data.error === 'string' ? data.error : '';
    throw new Error(err || ('Render submission failed (HTTP ' + res.status + ').'));
  }
  return data.operationId;
}

/**
 * The Script Graphics composition (id: ScriptGraphics). Renders the base video
 * full-frame with one overlay per scene at its time range. EVERY overlay is
 * anchored to the bottom band of the frame (bottom ~15–20% of the canvas) at
 * a per-scene horizontal position (bottom-left / bottom-center / bottom-right)
 * with a fade-in + slide-up entrance and a fade-out exit — white sans-serif on
 * a semi-transparent dark backdrop so the video's center is never covered.
 * Only `remotion` imports. The render service probes the bundle with EMPTY
 * props first — nothing here may throw when scenes/videoUrl are absent.
 */
export const SCRIPT_GRAPHICS_COMPOSITION = `
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const ACCENT = '#3B82F6';
const BACKDROP = 'rgba(8, 10, 20, 0.68)';
const TEXT_SHADOW = '0 3px 14px rgba(0,0,0,0.7)';

// Shared bottom-band wrapper: anchors its child to the lower ~15-20% of the
// frame at the scene's horizontal position, never covering the center of the
// image. Entrance = fade-in + slide-up over ~0.4s; exit = fade-out.
function BottomBand({ pos, dur, scale, children }) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], CLAMP);
  const fadeOut = interpolate(frame, [Math.max(1, dur - 12), dur], [1, 0], CLAMP);
  const rise = interpolate(frame, [0, 12], [26, 0], CLAMP);
  const align = pos === 'left' ? 'flex-start' : pos === 'right' ? 'flex-end' : 'center';
  return (
    <AbsoluteFill style={{ alignItems: align, justifyContent: 'flex-end', padding: '0 ' + (44 * scale) + 'px ' + (34 * scale) + 'px', pointerEvents: 'none' }}>
      <div style={{ opacity: Math.min(fadeIn, fadeOut), transform: 'translateY(' + (rise * scale) + 'px)', maxWidth: pos === 'center' ? '64%' : '46%' }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

function TitleCard({ title, body, dur, scale, pos }) {
  return (
    <BottomBand pos={pos} dur={dur} scale={scale}>
      <div style={{ background: BACKDROP, borderRadius: 14 * scale, padding: (14 * scale) + 'px ' + (26 * scale) + 'px', borderBottom: (4 * scale) + 'px solid ' + ACCENT, textAlign: pos === 'center' ? 'center' : 'left' }}>
        <div style={{ fontFamily: FONT, fontSize: 34 * scale, fontWeight: 800, color: '#FFFFFF', lineHeight: 1.15, textShadow: TEXT_SHADOW }}>{title}</div>
        {body ? <div style={{ fontFamily: FONT, fontSize: 19 * scale, fontWeight: 500, color: 'rgba(255,255,255,0.85)', marginTop: 6 * scale, textShadow: TEXT_SHADOW }}>{body}</div> : null}
      </div>
    </BottomBand>
  );
}

function LowerThird({ title, body, dur, scale, pos }) {
  return (
    <BottomBand pos={pos} dur={dur} scale={scale}>
      <div style={{ background: 'linear-gradient(90deg, rgba(8,10,20,0.84), rgba(8,10,20,0.55))', borderLeft: (5 * scale) + 'px solid ' + ACCENT, borderRadius: 10 * scale, padding: (10 * scale) + 'px ' + (20 * scale) + 'px' }}>
        <div style={{ fontFamily: FONT, fontSize: 24 * scale, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.18, textShadow: TEXT_SHADOW }}>{title}</div>
        {body ? <div style={{ fontFamily: FONT, fontSize: 17 * scale, fontWeight: 500, color: 'rgba(255,255,255,0.82)', marginTop: 4 * scale, textShadow: TEXT_SHADOW }}>{body}</div> : null}
      </div>
    </BottomBand>
  );
}

function Callout({ title, body, dur, scale, pos }) {
  return (
    <BottomBand pos={pos} dur={dur} scale={scale}>
      <div style={{ background: BACKDROP, border: (2 * scale) + 'px solid ' + ACCENT, borderRadius: 999, padding: (10 * scale) + 'px ' + (26 * scale) + 'px', textAlign: 'center' }}>
        <div style={{ fontFamily: FONT, fontSize: 22 * scale, fontWeight: 800, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 1.2, lineHeight: 1.15, textShadow: TEXT_SHADOW }}>{title}</div>
        {body ? <div style={{ fontFamily: FONT, fontSize: 16 * scale, fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginTop: 3 * scale, textTransform: 'none', letterSpacing: 0, textShadow: TEXT_SHADOW }}>{body}</div> : null}
      </div>
    </BottomBand>
  );
}

export default function ScriptGraphics(props) {
  const { scenes, videoUrl } = props || {};
  const { fps, height } = useVideoConfig();
  const scale = height / 720;
  const src = typeof videoUrl === 'string' ? videoUrl : '';
  const list = Array.isArray(scenes) ? scenes : [];
  const POSITIONS = ['left', 'center', 'right'];
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {src.length > 0 ? <OffthreadVideo src={src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
      </AbsoluteFill>
      {list.map((sc, i) => {
        if (!sc || sc.type === 'none') return null;
        const start = Number(sc.startSec);
        const end = Number(sc.endSec);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        const from = Math.max(0, Math.round(start * fps));
        const df = Math.max(1, Math.round((end - start) * fps));
        const title = String(sc.title || '');
        const body = String(sc.body || '');
        const pos = POSITIONS.indexOf(sc.pos) >= 0 ? sc.pos : POSITIONS[i % POSITIONS.length];
        return (
          <Sequence key={'scene-' + i} from={from} durationInFrames={df}>
            {sc.type === 'title' ? <TitleCard title={title} body={body} dur={df} scale={scale} pos={pos} />
              : sc.type === 'lowerthird' ? <LowerThird title={title} body={body} dur={df} scale={scale} pos={pos} />
              : <Callout title={title} body={body} dur={df} scale={scale} pos={pos} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
`;
