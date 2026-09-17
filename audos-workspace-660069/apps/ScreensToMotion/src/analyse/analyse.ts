/**
 * Stage 2 — Analyse. One vision-model call per screenshot (GPT-4o through the
 * workspace AI proxy, authenticated with the workspace DB token), returning a
 * schema-validated ScreenAnalysis. The SAME JSON Schema
 * (schema/screen-analysis.schema.json) serves Claude and GPT structured
 * outputs — here it is embedded into the prompt and enforced client-side.
 *
 * PLATE MATCHING happens here, not in the model: for every region we sample a
 * 4px inset ring around its bbox on the normalised canvas. If the ring's
 * luminance varies more than 6%, plateColor is null and the planner must skip
 * plate-dependent UI ops for that region (falling back to highlight).
 */
import screenAnalysisSchema from '../../schema/screen-analysis.schema.json';
import { assertValid } from '../plan/jsonSchema';
import type { IngestResult } from './ingest';
import type { ScreenAnalysis, Region, BBox } from '../types';

const MAX_REGIONS = 8;
const RING_LUMINANCE_TOLERANCE = 0.06;

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

/** Downscale for the vision call — analysis geometry is normalised anyway. */
function visionDataUrl(canvas: HTMLCanvasElement): string {
  const maxW = 1568;
  if (canvas.width <= maxW) return canvas.toDataURL('image/jpeg', 0.85);
  const scale = maxW / canvas.width;
  const small = document.createElement('canvas');
  small.width = maxW;
  small.height = Math.round(canvas.height * scale);
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.85);
}

/**
 * Sample the 4px inset ring just inside a region's bbox. Returns the mean
 * colour when uniform (≤6% luminance spread), or null when the ring varies —
 * the pixel-identical plate rule cannot hold there.
 */
export function samplePlateRing(canvas: HTMLCanvasElement, bbox: BBox): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const x = Math.round(bbox[0] * canvas.width);
  const y = Math.round(bbox[1] * canvas.height);
  const w = Math.max(12, Math.round(bbox[2] * canvas.width));
  const h = Math.max(12, Math.round(bbox[3] * canvas.height));
  const inset = 4;
  const samples: number[][] = [];
  const grab = (sx: number, sy: number, sw: number, sh: number) => {
    const data = ctx.getImageData(
      Math.max(0, Math.min(canvas.width - 1, sx)),
      Math.max(0, Math.min(canvas.height - 1, sy)),
      Math.max(1, Math.min(sw, canvas.width - sx)),
      Math.max(1, Math.min(sh, canvas.height - sy)),
    ).data;
    for (let i = 0; i < data.length; i += 16) samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  grab(x + inset, y + inset, w - inset * 2, inset);              // top edge
  grab(x + inset, y + h - inset * 2, w - inset * 2, inset);      // bottom edge
  grab(x + inset, y + inset, inset, h - inset * 2);              // left edge
  grab(x + w - inset * 2, y + inset, inset, h - inset * 2);      // right edge
  if (samples.length < 8) return null;
  const lum = (rgb: number[]) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  let minL = 1, maxL = 0;
  const mean = [0, 0, 0];
  for (const s of samples) {
    const l = lum(s);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    mean[0] += s[0]; mean[1] += s[1]; mean[2] += s[2];
  }
  if (maxL - minL > RING_LUMINANCE_TOLERANCE) return null;
  const hex = mean.map((v) => Math.round(v / samples.length).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

const SYSTEM_PROMPT = [
  'You analyse ONE product screenshot for an automated motion-design pipeline.',
  'Return ONLY a JSON object matching the provided JSON Schema — no markdown, no commentary.',
  'Rules:',
  `- At most ${MAX_REGIONS} regions. Score salience 0-1 by visual weight combined with product importance.`,
  '- bbox values are [x, y, w, h], each normalised 0-1 relative to the full image.',
  '- "text" is a TRANSCRIPTION of exactly what the region shows. Never invent, summarise, or complete text. Use null when illegible.',
  '- safeCrops are rectangles that can be cropped without cutting through a word or a control.',
  '- palette: dominant surface colour, primary text ink, strongest brand accent, and whether the UI is dark.',
].join('\n');

export async function analyseScreen(item: IngestResult): Promise<ScreenAnalysis> {
  const token = workspaceToken();
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_completion_tokens: 2400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `screenId: ${item.screen.screenId}\nTrue pixel size: ${item.screen.width}x${item.screen.height}\n\nJSON Schema to satisfy exactly:\n${JSON.stringify(screenAnalysisSchema)}`,
            },
            { type: 'image_url', image_url: { url: visionDataUrl(item.canvas), detail: 'high' } },
          ],
        },
      ],
      stream: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `Vision analysis failed for ${item.screen.filename} (${response.status}).`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(String(body?.choices?.[0]?.message?.content || ''));
  } catch {
    throw new Error(`Vision analysis for ${item.screen.filename} returned unparseable JSON.`);
  }
  parsed.screenId = item.screen.screenId; // authoritative
  if (Array.isArray(parsed.regions)) {
    parsed.regions = parsed.regions.slice(0, MAX_REGIONS).map((region: Region, i: number) => ({
      ...region,
      id: region.id || `r${i + 1}`,
      // Plate sampling is deterministic client-side work on the true pixels.
      plateColor: Array.isArray(region.bbox) && region.bbox.length === 4 ? samplePlateRing(item.canvas, region.bbox as BBox) : null,
    }));
  }
  assertValid(parsed, screenAnalysisSchema, `ScreenAnalysis (${item.screen.filename})`);
  return parsed as ScreenAnalysis;
}

/** Stage 2 driver: one call per screenshot, sequential to respect rate limits. */
export async function analyseAll(items: IngestResult[], onProgress?: (done: number, total: number) => void): Promise<ScreenAnalysis[]> {
  const out: ScreenAnalysis[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(await analyseScreen(items[i]));
    onProgress?.(i + 1, items.length);
  }
  return out;
}
