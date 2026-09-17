/**
 * LLM-generated caption styles for the Captions & Graphics panel.
 *
 * Instead of hardcoded caption presets, one gpt-5.6-terra pass writes a small
 * self-contained JavaScript render function per style brief:
 *   function renderCaption(ctx, text, x, y, videoWidth, videoHeight) { ... }
 * Each function is compiled with new Function(), smoke-tested on a throwaway
 * canvas, and only then offered as a swatch. Every brief also ships a built-in
 * fallback renderer so the panel always has working styles — even offline.
 */
import { workspaceToken } from './enhancerCore';
import type { CaptionRenderFn } from './overlayCanvas';

export interface CaptionStyleOption {
  id: string;
  name: string;
  /** The function source ('' for built-in fallbacks). */
  code: string;
  fn: CaptionRenderFn;
  source: 'ai' | 'builtin';
}

export const STYLE_BRIEFS: { id: string; name: string; desc: string }[] = [
  { id: 'bold-shadow', name: 'Bold Shadow', desc: 'bold white uppercase text with a strong dark drop shadow' },
  { id: 'yellow-pop', name: 'Yellow Pop', desc: 'black bold text on a solid yellow rounded highlight box' },
  { id: 'neon-glow', name: 'Neon Glow', desc: 'white text with a vivid cyan and magenta neon glow' },
  { id: 'minimal-pill', name: 'Minimal Pill', desc: 'light minimal sans-serif on a subtle translucent dark pill' },
  { id: 'gradient-punch', name: 'Gradient Punch', desc: 'heavy text filled with a warm orange-to-pink gradient and a thin dark outline' },
  { id: 'boxed-classic', name: 'Boxed Classic', desc: 'classic broadcast caption: white text on a semi-transparent black box' },
];

// ---------------------------------------------------------------------------
// Built-in fallback renderers (always available)
// ---------------------------------------------------------------------------

function builtinFor(id: string): CaptionRenderFn {
  switch (id) {
    case 'yellow-pop':
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.048;
        ctx.font = '800 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + fs * 1.1;
        const h = fs * 1.7;
        ctx.fillStyle = '#FFD84D';
        ctx.beginPath();
        (ctx as any).roundRect ? (ctx as any).roundRect(x - w / 2, y - h / 2, w, h, fs * 0.35) : ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fill();
        ctx.fillStyle = '#151515';
        ctx.fillText(text, x, y + fs * 0.04);
      };
    case 'neon-glow':
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.05;
        ctx.font = '800 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#22D3EE';
        ctx.shadowBlur = fs * 0.65;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, x, y);
        ctx.shadowColor = '#E879F9';
        ctx.shadowBlur = fs * 0.35;
        ctx.fillText(text, x, y);
      };
    case 'minimal-pill':
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.038;
        ctx.font = '500 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + fs * 1.4;
        const h = fs * 1.9;
        ctx.fillStyle = 'rgba(10,14,24,0.6)';
        ctx.beginPath();
        (ctx as any).roundRect ? (ctx as any).roundRect(x - w / 2, y - h / 2, w, h, h / 2) : ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fill();
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(text, x, y + fs * 0.04);
      };
    case 'gradient-punch':
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.055;
        ctx.font = '900 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const grad = ctx.createLinearGradient(x - fs * 3, y, x + fs * 3, y);
        grad.addColorStop(0, '#FB923C');
        grad.addColorStop(1, '#EC4899');
        ctx.lineWidth = Math.max(1.5, fs * 0.06);
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(text.toUpperCase(), x, y);
        ctx.fillStyle = grad;
        ctx.fillText(text.toUpperCase(), x, y);
      };
    case 'boxed-classic':
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.042;
        ctx.font = '600 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + fs * 0.9;
        const h = fs * 1.55;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, x, y + fs * 0.04);
      };
    default: // 'bold-shadow'
      return (ctx, text, x, y, _vw, vh) => {
        const fs = vh * 0.055;
        ctx.font = '900 ' + Math.round(fs) + "px 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = fs * 0.3;
        ctx.shadowOffsetY = fs * 0.08;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text.toUpperCase(), x, y);
      };
  }
}

export function builtinCaptionStyles(): CaptionStyleOption[] {
  return STYLE_BRIEFS.map((b) => ({ id: b.id, name: b.name, code: '', fn: builtinFor(b.id), source: 'builtin' as const }));
}

// ---------------------------------------------------------------------------
// LLM generation + safe compilation
// ---------------------------------------------------------------------------

/** Compile one LLM-returned function source and smoke-test it on a tiny canvas. */
export function compileCaptionFn(code: string): CaptionRenderFn | null {
  if (typeof code !== 'string' || code.length < 40 || code.length > 6000) return null;
  // Refuse code that reaches outside the canvas sandbox.
  if (/\b(window|document|fetch|XMLHttpRequest|localStorage|eval|Function|import|globalThis|self)\b/.test(code)) return null;
  let fn: unknown;
  try {
    const factory = new Function('"use strict"; return (' + code + ');');
    fn = factory();
  } catch { return null; }
  if (typeof fn !== 'function') return null;
  try {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 54;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.save();
      (fn as CaptionRenderFn)(ctx, 'Hi', 48, 27, 96, 54);
      ctx.restore();
    }
  } catch { return null; }
  return fn as CaptionRenderFn;
}

function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last <= first) throw new Error('The AI styles came back in an unexpected format — try again.');
  const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1));
  if (!Array.isArray(parsed)) throw new Error('The AI styles were not a list — try again.');
  return parsed;
}

/**
 * One gpt-5.6-terra pass: a fresh canvas-render function per style brief.
 * Functions that fail to compile (or trip the sandbox check) silently fall
 * back to the built-in renderer for that brief, so the result is ALWAYS a
 * complete set of working styles.
 */
export async function generateCaptionStyles(): Promise<CaptionStyleOption[]> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const briefLines = STYLE_BRIEFS.map((b) => '- id "' + b.id + '" (' + b.name + '): ' + b.desc).join('\n');
  const prompt = [
    'You write small JavaScript canvas-rendering functions for video caption styles.',
    '',
    'For EACH style brief below, write ONE self-contained function with EXACTLY this signature:',
    'function renderCaption(ctx, text, x, y, videoWidth, videoHeight) { ... }',
    '',
    'STYLE BRIEFS:',
    briefLines,
    '',
    'Hard rules for every function:',
    '- Canvas 2D API only (ctx.*). NO window, document, fetch, timers, eval, imports, or any other global — the function must be a pure draw call.',
    '- Draw the caption CENTERED at (x, y). Derive every size from videoHeight (e.g. const fs = videoHeight * 0.05) so it scales with any resolution or aspect ratio.',
    '- Call ctx.save() first and ctx.restore() last so no state leaks.',
    '- Keep each function under 40 lines. It must not throw for any text string.',
    '',
    'Return ONLY a JSON array (no prose, no markdown), one element per brief, each exactly:',
    '{"id": "<brief id>", "name": "<display name>", "code": "<the full function source as a single JSON string>"}',
  ].join('\n');

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.error ? (typeof data.error === 'string' ? data.error : data.error.message || '') : '';
    throw new Error(detail || ('AI request failed (HTTP ' + res.status + ').'));
  }
  const first = data && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = first && first.message && typeof first.message.content === 'string' ? first.message.content : '';
  if (!content.trim()) throw new Error('The AI returned an empty response — try again.');

  const byId = new Map<string, { name: string; code: string; fn: CaptionRenderFn }>();
  for (const raw of extractJsonArray(content)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const code = typeof r.code === 'string' ? r.code : '';
    if (!id || byId.has(id)) continue;
    const fn = compileCaptionFn(code);
    if (!fn) continue;
    byId.set(id, { name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 32) : id, code, fn });
  }

  return STYLE_BRIEFS.map((b) => {
    const ai = byId.get(b.id);
    return ai
      ? { id: b.id, name: ai.name, code: ai.code, fn: ai.fn, source: 'ai' as const }
      : { id: b.id, name: b.name, code: '', fn: builtinFor(b.id), source: 'builtin' as const };
  });
}
