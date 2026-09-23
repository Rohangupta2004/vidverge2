/**
 * Video Enhancer — adaptive overlay engine (graphics only, no captions).
 *
 * Three responsibilities:
 *   1. FRAME ANALYSIS — sample frames from the uploaded footage in-browser,
 *      send them to claude-opus-5 through the workspace Anthropic proxy
 *      (/proxy/anthropic/v1/messages, X-Workspace-DB-Token header), and get
 *      back an adaptive overlay direction: which graphic elements best serve
 *      THIS footage, where on the frame, and when on the timeline.
 *   2. LIVE RENDERER — draw the animated elements (motion-path arrows,
 *      callout boxes, numbered step badges, pulsing highlight rings, labels,
 *      mini flow diagrams) onto a canvas layered over the player.
 *   3. BURN-IN EXPORT — replay the footage through a canvas + MediaRecorder
 *      pass that composites the same overlays into a downloadable video file
 *      (WebM VP9/VP8) with the original audio track carried across.
 *
 * Hard rule inherited from the product spec: overlays are GRAPHIC elements
 * only — never subtitles and never a transcription of the speech.
 */

export type OverlayKind = 'arrow' | 'callout' | 'highlight' | 'step' | 'label' | 'diagram';

/** The multi-color accent palette: one vibrant hue per element family. */
export const OVERLAY_COLORS: Record<OverlayKind, string> = {
  arrow: '#3D8BFF',      // electric blue
  callout: '#FFB224',    // amber
  highlight: '#FF6B6B',  // coral
  step: '#34E0B0',       // mint
  label: '#A78BFA',      // violet
  diagram: '#22D3EE',    // cyan
};

export const OVERLAY_KIND_LABELS: Record<OverlayKind, string> = {
  arrow: 'Motion arrow',
  callout: 'Callout',
  highlight: 'Highlight ring',
  step: 'Step badge',
  label: 'Label',
  diagram: 'Flow diagram',
};

export interface OverlayElement {
  id: string;
  kind: OverlayKind;
  /** Window on the video timeline, in seconds. */
  start: number;
  end: number;
  /** Normalized anchor position (0..1 of frame width/height). */
  x: number;
  y: number;
  /** Normalized target — arrow tip / callout leader-line point. */
  x2?: number;
  y2?: number;
  /** Short label text (annotation, never a transcript). */
  text?: string;
  /** Step number for `step` badges. */
  step?: number;
  emphasis: 'low' | 'medium' | 'high';
  color: string;
  enabled: boolean;
}

export interface FrameSample { time: number; b64: string }

export interface AnalysisInsight {
  id: string;
  /** One plain-sentence finding about the footage (pacing, clarity, framing…). */
  text: string;
  /** PRD 3.2 — short display title for the finding. */
  title?: string;
  /** PRD 3.2 — the current (before) state of the footage on this point. */
  before?: string;
  /** PRD 3.2 — the improved (after) state once the suggestion is applied. */
  after?: string;
  /** PRD 3.2 — confidence 0-10 (one decimal); always shown with its scale. */
  confidence?: number;
  /** 0-100 rating — present only when the finding is a measurable score. */
  score?: number;
  /** Present only when the finding contrasts two states or moments. */
  compare?: { before: string; after: string };
  /** Present only when the finding is a multi-step explanation. */
  steps?: string[];
  /** Present only when a concrete fix is being recommended. */
  recommendation?: string;
}

export interface AnalysisResult {
  summary: string;
  insights: AnalysisInsight[];
  elements: OverlayElement[];
  framesUsed: number;
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// ---------------------------------------------------------------------------
// 1a. Frame extraction (in-browser, no network)
// ---------------------------------------------------------------------------

function waitEvent(el: HTMLVideoElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      window.clearTimeout(timer);
      if (err) reject(err); else resolve();
    };
    const onOk = () => finish();
    const onErr = () => finish(new Error('The browser could not decode this video.'));
    const timer = window.setTimeout(() => finish(new Error('Timed out waiting for the video to ' + ok + '.')), timeoutMs);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

/** Sample `count` frames evenly across the clip, downscaled JPEG base64. */
export async function extractFrames(source: Blob, count: number, maxWidth: number, onNote?: (n: string) => void): Promise<{ frames: FrameSample[]; duration: number }> {
  const url = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await waitEvent(video, 'loadedmetadata', 12000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth) throw new Error('The video has no readable duration or dimensions.');
    const n = Math.max(2, Math.min(12, Math.round(count)));
    const margin = Math.min(0.5, duration * 0.04);
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the frame-capture canvas.');
    const frames: FrameSample[] = [];
    for (let i = 0; i < n; i++) {
      const t = margin + (duration - margin * 2) * (n === 1 ? 0.5 : i / (n - 1));
      onNote?.('Sampling frame ' + (i + 1) + ' of ' + n + ' (' + t.toFixed(1) + 's)…');
      video.currentTime = t;
      await waitEvent(video, 'seeked', 8000);
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
      const b64 = dataUrl.split(',')[1] || '';
      if (b64) frames.push({ time: Math.round(t * 10) / 10, b64 });
    }
    if (!frames.length) throw new Error('No frames could be captured from the video.');
    return { frames, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// 1b. claude-opus-5 vision analysis (workspace Anthropic proxy)
// ---------------------------------------------------------------------------

const DIRECTOR_SYSTEM = [
  'You are the overlay director of a video enhancement tool. You are shown still frames sampled evenly from ONE continuous video, each labeled with its timestamp. Design the GRAPHIC overlay elements that best serve this specific footage — chosen adaptively from what is actually happening in it.',
  '',
  'HARD RULES:',
  '- Graphic elements ONLY. Never captions, never subtitles, never a transcription of anything being said.',
  '- Any "text" field is a SHORT annotation label (max 42 characters) — a name, a step title, a callout like "Watch the elbow angle" — never spoken words.',
  '- Choose element types that fit the content: a tutorial or physical demonstration wants step badges, motion arrows and highlight rings on the relevant body part or object; a product/screen video wants callouts, labels and highlight rings on UI regions; a process explanation wants a flow diagram.',
  '- Never cover a person\u2019s face: keep elements off the face region you can see in the frames.',
  '- At most 2 elements visible at the same moment; 6 to 14 elements across the whole video; each visible 1.5 to 6 seconds.',
  '- THE ANALYSIS MUST BE VISIBLE ON THE FOOTAGE, not just written down: every insight that carries a recommendation, score or comparison must ALSO be expressed as an on-video element (a callout, label, arrow or highlight) at the moment on the timeline it applies to.',
  '',
  'ELEMENT TYPES:',
  '- "arrow": a motion-path arrow that draws itself from (x,y) to (x2,y2) — use it to show direction of movement or to point at the thing being discussed.',
  '- "callout": an annotation box anchored at (x,y) with a leader line to the point of interest at (x2,y2); requires "text".',
  '- "highlight": a pulsing ring centered on (x,y) — use it to focus attention on a region.',
  '- "step": a numbered badge at (x,y) with an optional short "text" title; requires "step" (1, 2, 3, …) — use it for sequences and tutorials.',
  '- "label": a small titled pill at (x,y); requires "text".',
  '- "diagram": a mini flow of 2-4 chips rendered at (x,y); write "text" as "A \u2192 B \u2192 C".',
  '',
  'COORDINATES: x, y, x2, y2 are normalized 0..1 relative to the frame (0,0 = top-left). TIMES: "start" and "end" are seconds on the video timeline.',
  '',
  'ANALYSIS INSIGHTS: alongside the elements, report 3 to 6 findings about the footage itself — pacing, visual clarity, framing, lighting, motion, audio-visual balance. EVERY finding MUST carry ALL of: "title" (max 40 chars — a plain-language name for the finding), "text" (ONE plain sentence), "before" (max 32 chars — the current state of the footage on this point), "after" (max 32 chars — the improved or desired state once the suggested fix is applied), and "confidence" (a number from 0 to 10, one decimal — how confident you are in this finding). Attach the additional structured fields ONLY when the finding genuinely carries them: "score" (integer 0-100) when it is a measurable rating; "steps" (2-4 short strings) when it is a multi-step explanation; "recommendation" (one short imperative sentence) when a concrete fix is suggested.',
  '',
  'Return ONLY one JSON object, no prose, exactly: {"summary": "one sentence describing what the video shows", "insights": [{"title": "…", "text": "…", "before": "…", "after": "…", "confidence": 0-10, "score": 0-100, "steps": ["…"], "recommendation": "…"}], "elements": [{"type": "arrow|callout|highlight|step|label|diagram", "start": seconds, "end": seconds, "x": 0..1, "y": 0..1, "x2": 0..1, "y2": 0..1, "text": "…", "step": 1, "emphasis": "low|medium|high"}]}',
].join('\n');

function parseJsonBlock(text: string): any {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('The AI returned an unexpected format instead of the overlay JSON.');
  return JSON.parse(cleaned.slice(first, last + 1));
}

const KINDS: OverlayKind[] = ['arrow', 'callout', 'highlight', 'step', 'label', 'diagram'];

function sanitizeElements(parsed: any, duration: number): OverlayElement[] {
  const raw = Array.isArray(parsed?.elements) ? parsed.elements : [];
  const out: OverlayElement[] = [];
  let stepCounter = 0;
  for (let i = 0; i < raw.length && out.length < 18; i++) {
    const e = raw[i] || {};
    const kind = KINDS.includes(e.type) ? (e.type as OverlayKind) : null;
    if (!kind) continue;
    let start = clamp(Number(e.start) || 0, 0, Math.max(0, duration - 0.5));
    let end = clamp(Number(e.end) || 0, 0, duration);
    if (end - start < 1.2) end = Math.min(duration, start + 1.8);
    if (end - start < 0.6) continue;
    const text = typeof e.text === 'string' ? e.text.trim().slice(0, 48) : '';
    if ((kind === 'callout' || kind === 'label' || kind === 'diagram') && !text) continue;
    if (kind === 'step') stepCounter++;
    out.push({
      id: 'ov-' + i + '-' + Math.random().toString(36).slice(2, 7),
      kind,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
      x: clamp(Number(e.x) || 0.5, 0.02, 0.98),
      y: clamp(Number(e.y) || 0.5, 0.02, 0.98),
      x2: Number.isFinite(Number(e.x2)) ? clamp(Number(e.x2), 0.02, 0.98) : undefined,
      y2: Number.isFinite(Number(e.y2)) ? clamp(Number(e.y2), 0.02, 0.98) : undefined,
      text: text || undefined,
      step: kind === 'step' ? (Number(e.step) > 0 ? Math.round(Number(e.step)) : stepCounter) : undefined,
      emphasis: e.emphasis === 'high' ? 'high' : e.emphasis === 'low' ? 'low' : 'medium',
      color: OVERLAY_COLORS[kind],
      enabled: true,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function sanitizeInsights(parsed: any): AnalysisInsight[] {
  const raw = Array.isArray(parsed?.insights) ? parsed.insights : [];
  const out: AnalysisInsight[] = [];
  for (let i = 0; i < raw.length && out.length < 8; i++) {
    const e = raw[i] || {};
    const text = typeof e.text === 'string' ? e.text.trim().slice(0, 220) : '';
    if (!text) continue;
    const ins: AnalysisInsight = { id: 'ins-' + i + '-' + Math.random().toString(36).slice(2, 6), text };
    // PRD 3.2: every finding carries a title, before/after states and a 0-10
    // confidence. Missing pieces fall back gracefully (old stored plans too).
    const title = typeof e.title === 'string' ? e.title.trim().slice(0, 48) : '';
    ins.title = title || text.split(/\s+/).slice(0, 6).join(' ');
    if (typeof e.before === 'string' && e.before.trim()) ins.before = e.before.trim().slice(0, 40);
    if (typeof e.after === 'string' && e.after.trim()) ins.after = e.after.trim().slice(0, 40);
    const conf = Number(e.confidence);
    if (Number.isFinite(conf) && conf >= 0 && conf <= 10) ins.confidence = Math.round(conf * 10) / 10;
    const score = Number(e.score);
    if (Number.isFinite(score) && score >= 0 && score <= 100) ins.score = Math.round(score);
    if (e.compare && typeof e.compare.before === 'string' && typeof e.compare.after === 'string' && e.compare.before.trim() && e.compare.after.trim()) {
      ins.compare = { before: e.compare.before.trim().slice(0, 40), after: e.compare.after.trim().slice(0, 40) };
    }
    if (Array.isArray(e.steps)) {
      const steps = e.steps.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().slice(0, 72)).slice(0, 4);
      if (steps.length >= 2) ins.steps = steps;
    }
    if (typeof e.recommendation === 'string' && e.recommendation.trim()) ins.recommendation = e.recommendation.trim().slice(0, 160);
    out.push(ins);
  }
  return out;
}

// VISUAL-FIRST GUARANTEE (Sep 20 2026): the analysis must never come back as
// text-only advice. When the model returns too few overlay elements, the
// findings themselves are converted into deterministic on-video graphics —
// score labels, recommendation callouts, step flow diagrams — spread across
// the timeline in safe screen corners, so something always shows ON the video.
const SAFE_SPOTS: { x: number; y: number }[] = [
  { x: 0.30, y: 0.18 }, { x: 0.70, y: 0.18 }, { x: 0.30, y: 0.80 }, { x: 0.70, y: 0.80 },
];
export function synthesizeElementsFromInsights(insights: AnalysisInsight[], duration: number, existing: OverlayElement[], minCount = 5): OverlayElement[] {
  const out = existing.slice();
  if (!insights.length || out.length >= minCount) return out;
  const need = Math.min(insights.length, minCount - out.length);
  const span = Math.max(2.4, (duration - 1) / Math.max(1, need));
  for (let i = 0; i < need; i++) {
    const ins = insights[i];
    const start = clamp(0.5 + i * span, 0, Math.max(0, duration - 2));
    const end = clamp(start + Math.min(4.5, Math.max(2, span * 0.8)), start + 1.5, duration || start + 2);
    const spot = SAFE_SPOTS[i % SAFE_SPOTS.length];
    let kind: OverlayKind = 'label';
    let text = (ins.title || ins.text || '').slice(0, 42);
    let x2: number | undefined;
    let y2: number | undefined;
    if (Number.isFinite(ins.score as number)) {
      kind = 'label';
      text = ((ins.title || 'Score') + ' \u00b7 ' + Math.round(Number(ins.score)) + '/100').slice(0, 42);
    } else if (Array.isArray(ins.steps) && ins.steps.length >= 2) {
      kind = 'diagram';
      text = ins.steps.slice(0, 3).map((s) => s.split(/\s+/).slice(0, 2).join(' ')).join(' \u2192 ').slice(0, 46);
    } else if (ins.recommendation) {
      kind = 'callout';
      text = ins.recommendation.slice(0, 42);
      x2 = 0.5; y2 = 0.5;
    } else if (ins.compare) {
      kind = 'diagram';
      text = (ins.compare.before + ' \u2192 ' + ins.compare.after).slice(0, 46);
    }
    if (!text) continue;
    out.push({
      id: 'ins-ov-' + i + '-' + Math.random().toString(36).slice(2, 6),
      kind, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10,
      x: spot.x, y: spot.y, x2, y2, text,
      emphasis: 'medium', color: OVERLAY_COLORS[kind], enabled: true,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

async function callOpusWithFrames(frames: FrameSample[], duration: number): Promise<any> {
  const token = String((window as any).__workspaceDb?.token || '');
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const content: any[] = [];
  for (const f of frames) {
    content.push({ type: 'text', text: 'Frame sampled at ' + f.time.toFixed(1) + 's of ' + duration.toFixed(1) + 's:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.b64 } });
  }
  content.push({
    type: 'text',
    text: 'The full video runs ' + duration.toFixed(1) + ' seconds. Design the overlay direction now. Remember: graphic elements only, no captions or subtitle text of any kind, keep faces clear, and return ONLY the JSON object.',
  });
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': (window as any).__workspaceDb?.token },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: DIRECTOR_SYSTEM,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || data?.code || ('HTTP ' + res.status);
    const err: any = new Error('The video analysis failed: ' + String(detail));
    err.status = res.status;
    throw err;
  }
  const raw = Array.isArray(data?.content) ? data.content.map((b: any) => b?.text || '').join('') : '';
  if (!raw) throw new Error('The analysis returned an empty response — try again.');
  return parseJsonBlock(raw);
}

/**
 * Full analysis pass: claude-opus-5 looks at the sampled frames and returns
 * the adaptive overlay plan. If the request is rejected for size, it retries
 * with half the frames before surfacing the error.
 */
export async function analyzeFrames(frames: FrameSample[], duration: number, onNote?: (n: string) => void): Promise<AnalysisResult> {
  let attempt = frames;
  for (let round = 0; round < 3; round++) {
    try {
      onNote?.('The AI is studying ' + attempt.length + ' frames of your footage…');
      const parsed = await callOpusWithFrames(attempt, duration);
      const insights = sanitizeInsights(parsed);
      // Visual-first: pad thin element sets from the findings themselves, so
      // the analysis always lands as graphics ON the video, never text alone.
      const elements = synthesizeElementsFromInsights(insights, duration, sanitizeElements(parsed, duration));
      if (!elements.length && !insights.length) throw new Error('The analysis returned no usable findings — try again.');
      return {
        summary: typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 300) : '',
        insights,
        elements,
        framesUsed: attempt.length,
      };
    } catch (e: any) {
      const status = Number(e?.status) || 0;
      const tooBig = status === 413 || /too large|payload|request size|exceeds/i.test(msg(e));
      if (tooBig && attempt.length > 3) {
        attempt = attempt.filter((_, i) => i % 2 === 0);
        onNote?.('The frame batch was too large — retrying with ' + attempt.length + ' frames…');
        continue;
      }
      throw e;
    }
  }
  throw new Error('The frame analysis could not be completed.');
}

// ---------------------------------------------------------------------------
// 2. Canvas renderer (shared by the live preview and the burn-in export)
// ---------------------------------------------------------------------------

function easeOutCubic(p: number): number { const q = 1 - p; return 1 - q * q * q; }
function easeOutBack(p: number): number { const c = 1.70158; const q = p - 1; return 1 + (c + 1) * q * q * q + c * q * q; }

interface Phase { alpha: number; enter: number; local: number }

function phaseFor(el: OverlayElement, t: number): Phase | null {
  if (t < el.start || t > el.end) return null;
  const local = t - el.start;
  const total = el.end - el.start;
  const enter = easeOutCubic(clamp(local / 0.6, 0, 1));
  const exit = clamp((el.end - t) / 0.4, 0, 1);
  return { alpha: Math.min(enter, exit), enter, local };
}

function fontPx(H: number, f: number): number { return Math.max(10, Math.round(H * f)); }

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function pillWithText(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, fs: number, color: string, alpha: number, W: number): void {
  ctx.font = '700 ' + fs + "px 'Inter', system-ui, sans-serif";
  const tw = ctx.measureText(text).width;
  const padX = fs * 0.7;
  const w = Math.min(W * 0.86, tw + padX * 2);
  const h = fs * 1.9;
  const x = clamp(cx - w / 2, 4, W - w - 4);
  const y = cy - h / 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(7,10,18,0.82)';
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, fs * 0.09);
  rr(ctx, x, y, w, h, h / 2);
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + fs * 0.05, w - padX * 1.4);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

function drawArrow(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  const x0 = el.x * W, y0 = el.y * H;
  const x1 = (el.x2 ?? clamp(el.x + 0.18, 0.02, 0.98)) * W;
  const y1 = (el.y2 ?? el.y) * H;
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.max(1, Math.hypot(dx, dy));
  // Curved motion path: control point offset perpendicular to the chord.
  const cx = (x0 + x1) / 2 - dy * 0.22;
  const cy = (y0 + y1) / 2 + dx * 0.22;
  const progress = easeOutCubic(clamp(ph.local / 0.7, 0, 1));
  const steps = 40;
  const upto = Math.max(2, Math.round(steps * progress));
  ctx.globalAlpha = ph.alpha;
  ctx.strokeStyle = el.color;
  ctx.lineWidth = Math.max(2.5, H * (el.emphasis === 'high' ? 0.011 : 0.008));
  ctx.lineCap = 'round';
  ctx.shadowColor = el.color;
  ctx.shadowBlur = H * 0.02;
  ctx.beginPath();
  let px = x0, py = y0, tx = x0, ty = y0;
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= upto; i++) {
    const s = i / steps;
    const ix = (1 - s) * (1 - s) * x0 + 2 * (1 - s) * s * cx + s * s * x1;
    const iy = (1 - s) * (1 - s) * y0 + 2 * (1 - s) * s * cy + s * s * y1;
    px = tx; py = ty; tx = ix; ty = iy;
    ctx.lineTo(ix, iy);
  }
  ctx.stroke();
  // Arrowhead at the moving tip, aligned with the local tangent.
  const ang = Math.atan2(ty - py, tx - px);
  const headLen = Math.max(9, dist * 0.09);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - headLen * Math.cos(ang - 0.5), ty - headLen * Math.sin(ang - 0.5));
  ctx.lineTo(tx - headLen * Math.cos(ang + 0.5), ty - headLen * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fillStyle = el.color;
  ctx.fill();
  ctx.shadowBlur = 0;
  if (el.text) pillWithText(ctx, x0, y0 - fontPx(H, 0.03) * 1.6, el.text, fontPx(H, 0.026), el.color, ph.alpha, W);
  ctx.globalAlpha = 1;
}

function drawHighlight(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  const cx = el.x * W, cy = el.y * H;
  const base = Math.min(W, H) * (el.emphasis === 'high' ? 0.15 : el.emphasis === 'low' ? 0.08 : 0.11);
  const pulse = 1 + 0.055 * Math.sin(ph.local * 3.4);
  const r = base * pulse * (0.7 + 0.3 * ph.enter);
  ctx.globalAlpha = ph.alpha;
  ctx.strokeStyle = el.color;
  ctx.lineWidth = Math.max(2.5, H * 0.007);
  ctx.shadowColor = el.color;
  ctx.shadowBlur = H * 0.025;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.82, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = ph.alpha * 0.35;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.28, r * 1.05, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (el.text) pillWithText(ctx, cx, cy + r * 1.05 + fontPx(H, 0.03), el.text, fontPx(H, 0.024), el.color, ph.alpha, W);
  ctx.globalAlpha = 1;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const cand = line ? line + ' ' + w : w;
    if (line && ctx.measureText(cand).width > maxW) { lines.push(line); line = w; }
    else line = cand;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*$/, '') + '…';
    return kept;
  }
  return lines;
}

function drawCallout(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  const fs = fontPx(H, 0.027);
  ctx.font = '700 ' + fs + "px 'Inter', system-ui, sans-serif";
  const maxW = W * 0.3;
  const lines = wrapText(ctx, el.text || '', maxW, 2);
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
  const padX = fs * 0.75, padY = fs * 0.55;
  const boxW = widest + padX * 2;
  const boxH = lines.length * fs * 1.32 + padY * 2;
  const slide = (1 - ph.enter) * fs * 1.2;
  const bx = clamp(el.x * W - boxW / 2, 6, W - boxW - 6);
  const by = clamp(el.y * H - boxH / 2, 6, H - boxH - 6) + slide;
  ctx.globalAlpha = ph.alpha;
  // Leader line + target dot.
  if (el.x2 !== undefined && el.y2 !== undefined) {
    const tx = el.x2 * W, ty = el.y2 * H;
    const fromX = clamp(tx, bx, bx + boxW);
    const fromY = ty > by + boxH / 2 ? by + boxH : by;
    ctx.strokeStyle = el.color;
    ctx.lineWidth = Math.max(1.5, H * 0.0035);
    ctx.setLineDash([H * 0.012, H * 0.009]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = el.color;
    ctx.beginPath();
    ctx.arc(tx, ty, Math.max(3, H * 0.007), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(7,10,18,0.85)';
  rr(ctx, bx, by, boxW, boxH, fs * 0.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  rr(ctx, bx, by, boxW, boxH, fs * 0.5);
  ctx.stroke();
  ctx.fillStyle = el.color;
  rr(ctx, bx, by, Math.max(3, fs * 0.22), boxH, 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillText(l, bx + padX, by + padY + i * fs * 1.32 + fs * 0.66);
  });
  ctx.globalAlpha = 1;
}

function drawStep(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  const r = Math.min(W, H) * (el.emphasis === 'high' ? 0.052 : 0.042);
  const pop = easeOutBack(clamp(ph.local / 0.5, 0, 1));
  const cx = el.x * W, cy = el.y * H;
  ctx.globalAlpha = ph.alpha;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.shadowColor = el.color;
  ctx.shadowBlur = H * 0.02;
  ctx.fillStyle = 'rgba(7,10,18,0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = el.color;
  ctx.lineWidth = Math.max(2.5, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = el.color;
  ctx.font = '800 ' + Math.round(r * 1.1) + "px 'Inter', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(el.step || 1), 0, r * 0.06);
  ctx.textAlign = 'left';
  ctx.restore();
  if (el.text) pillWithText(ctx, cx, cy - r - fontPx(H, 0.03) * 1.15, el.text, fontPx(H, 0.024), el.color, ph.alpha, W);
  ctx.globalAlpha = 1;
}

function drawLabel(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  pillWithText(ctx, el.x * W, el.y * H + (1 - ph.enter) * H * 0.015, el.text || '', fontPx(H, el.emphasis === 'high' ? 0.032 : 0.026), el.color, ph.alpha, W);
}

function drawDiagram(ctx: CanvasRenderingContext2D, W: number, H: number, el: OverlayElement, ph: Phase): void {
  const parts = String(el.text || '').split(/→|->/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!parts.length) return;
  const fs = fontPx(H, 0.024);
  ctx.font = '700 ' + fs + "px 'Inter', system-ui, sans-serif";
  const padX = fs * 0.65, gap = fs * 1.5;
  const widths = parts.map((p) => Math.min(W * 0.24, ctx.measureText(p).width) + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
  const chipH = fs * 2.1;
  let x = clamp(el.x * W - total / 2, 6, Math.max(6, W - total - 6));
  const y = clamp(el.y * H - chipH / 2, 6, H - chipH - 6);
  parts.forEach((p, i) => {
    const appear = easeOutCubic(clamp((ph.local - i * 0.22) / 0.4, 0, 1));
    const w = widths[i];
    ctx.globalAlpha = ph.alpha * appear;
    ctx.fillStyle = 'rgba(7,10,18,0.85)';
    rr(ctx, x, y, w, chipH, fs * 0.5);
    ctx.fill();
    ctx.strokeStyle = el.color;
    ctx.lineWidth = Math.max(1.5, fs * 0.09);
    rr(ctx, x, y, w, chipH, fs * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(p, x + w / 2, y + chipH / 2 + fs * 0.05, w - padX * 1.2);
    ctx.textAlign = 'left';
    if (i < parts.length - 1) {
      const ax = x + w + gap * 0.18;
      ctx.strokeStyle = el.color;
      ctx.beginPath();
      ctx.moveTo(ax, y + chipH / 2);
      ctx.lineTo(ax + gap * 0.64, y + chipH / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax + gap * 0.64, y + chipH / 2);
      ctx.lineTo(ax + gap * 0.4, y + chipH / 2 - fs * 0.32);
      ctx.moveTo(ax + gap * 0.64, y + chipH / 2);
      ctx.lineTo(ax + gap * 0.4, y + chipH / 2 + fs * 0.32);
      ctx.stroke();
    }
    x += w + gap;
  });
  ctx.globalAlpha = 1;
}

/** Draw every active overlay for time `t` onto the given canvas context. */
export function drawOverlays(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, elements: OverlayElement[]): void {
  for (const el of elements) {
    if (!el.enabled) continue;
    const ph = phaseFor(el, t);
    if (!ph) continue;
    try {
      if (el.kind === 'arrow') drawArrow(ctx, W, H, el, ph);
      else if (el.kind === 'highlight') drawHighlight(ctx, W, H, el, ph);
      else if (el.kind === 'callout') drawCallout(ctx, W, H, el, ph);
      else if (el.kind === 'step') drawStep(ctx, W, H, el, ph);
      else if (el.kind === 'label') drawLabel(ctx, W, H, el, ph);
      else if (el.kind === 'diagram') drawDiagram(ctx, W, H, el, ph);
    } catch (e) {
      console.warn('[VideoEnhancer] overlay ' + el.id + ' draw failed: ' + msg(e));
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Burn-in export (canvas + MediaRecorder; original audio carried across)
// ---------------------------------------------------------------------------

export interface BurnInResult { blob: Blob; mimeType: string; extension: string }

function pickRecorderMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of candidates) {
    try { if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return '';
}

export async function burnInOverlays(source: Blob, elements: OverlayElement[], onProgress?: (p: number, note?: string) => void): Promise<BurnInResult> {
  const mime = pickRecorderMime();
  if (!mime) throw new Error('This browser cannot record video (MediaRecorder/WebM unsupported).');
  const url = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await waitEvent(video, 'loadedmetadata', 12000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth) throw new Error('The video has no readable duration or dimensions.');
    const scale = Math.min(1, 1920 / video.videoWidth);
    const W = Math.max(2, Math.round(video.videoWidth * scale));
    const H = Math.max(2, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the export canvas.');

    // Route the element's audio into the recording (and away from speakers).
    let audioTracks: MediaStreamTrack[] = [];
    let acx: any = null;
    try {
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) {
        acx = new AC();
        const srcNode = acx.createMediaElementSource(video);
        const dest = acx.createMediaStreamDestination();
        srcNode.connect(dest);
        audioTracks = dest.stream.getAudioTracks();
        if (acx.state === 'suspended') await acx.resume();
      }
    } catch (e) {
      console.warn('[VideoEnhancer] export continues without audio: ' + msg(e));
      video.muted = true;
    }

    const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
    if (!canvasStream) throw new Error('This browser cannot capture a canvas stream.');
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });

    const active = elements.filter((e) => e.enabled);
    let running = true;
    const paint = () => {
      ctx.drawImage(video, 0, 0, W, H);
      drawOverlays(ctx, W, H, video.currentTime, active);
    };
    const loop = () => {
      if (!running) return;
      paint();
      onProgress?.(clamp(video.currentTime / duration, 0, 1));
      if ((video as any).requestVideoFrameCallback) (video as any).requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };

    paint();
    rec.start(500);
    await video.play();
    loop();
    await new Promise<void>((resolve) => { video.onended = () => resolve(); });
    running = false;
    paint();
    await new Promise((r) => { setTimeout(r, 220); });
    rec.stop();
    await stopped;
    try { if (acx) acx.close(); } catch { /* no-op */ }
    canvasStream.getTracks().forEach((tr: MediaStreamTrack) => tr.stop());
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (!blob.size) throw new Error('The export produced no data — try again.');
    onProgress?.(1, 'done');
    return { blob, mimeType: mime.split(';')[0], extension: 'webm' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
