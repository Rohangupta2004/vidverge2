/**
 * CAPTIONS — auto-generated from the scene's ACTUAL voiceover transcript.
 *
 * Each scene's narration line is chunked with smart line breaks (≈4-5 word
 * groups that respect punctuation), time-weighted across the measured
 * narration duration, and rendered as a GSAP + SVG overlay: a soft dark pill,
 * clean typography, keyword emphasis in the brand accent. The overlay is
 * recorded on PURE BLACK by the capture layer and composited in FFmpeg with
 * colorkey — the black vanishes, the pill + text survive on any footage.
 *
 * Captions COMPLEMENT the visual — short groups, never the whole line as
 * giant text, never more than one group on screen at a time.
 *
 * This module also builds the EXACT-TEXT OVERLAY (buildExactTextOverlay):
 * when an AI-video scene carries required on-screen text ("70% FASTER", a
 * price, a product name), that text is NEVER left to the generative model —
 * it is rendered here deterministically, recorded on pure black, and
 * composited over the footage in FFmpeg with colorkey. AI video tells the
 * story; deterministic graphics carry the precise information.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import type { BuiltAnimation } from '../../ScriptToVideo/pipeline/capture';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";
/** Pill fill — deliberately NOT near-black so the colorkey pass (which
 * removes the pure-black backdrop) leaves the pill intact. */
const PILL = '#232A3D';

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

interface CaptionChunk { words: string[]; weight: number }

/** Smart line breaks: split on punctuation first, then into ≤5-word groups. */
export function chunkNarration(narration: string): CaptionChunk[] {
  const clean = String(narration || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const phrases = clean.split(/(?<=[.,;:!?—])\s+/).filter(Boolean);
  const chunks: string[][] = [];
  for (const phrase of phrases) {
    const words = phrase.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i += 5) {
      const group = words.slice(i, i + 5);
      // Avoid a 1-word orphan group — fold it into the previous group.
      if (group.length === 1 && chunks.length && chunks[chunks.length - 1].length <= 5) chunks[chunks.length - 1].push(group[0]);
      else chunks.push(group);
    }
  }
  const totalChars = chunks.reduce((a, c) => a + c.join(' ').length, 0) || 1;
  return chunks.map((words) => ({ words, weight: words.join(' ').length / totalChars }));
}

/** Emphasis: numbers, %/$ figures, and Capitalized product-ish words. */
function isKeyword(word: string, idx: number): boolean {
  const w = word.replace(/[.,;:!?—"']/g, '');
  if (/\d/.test(w)) return true;
  if (idx > 0 && /^[A-Z][a-zA-Z]{2,}/.test(w)) return true;
  return false;
}

/**
 * Build the caption overlay for ONE scene. `durationSec` is the scene's final
 * (voice-derived) duration; `voicedSec` is the measured narration length —
 * caption groups are spread across the voiced span, not the trailing breath.
 */
export function buildCaptionOverlay(
  narration: string,
  durationSec: number,
  voicedSec: number,
  W: number,
  H: number,
  accent: string,
): BuiltAnimation | null {
  const chunks = chunkNarration(narration);
  if (!chunks.length) return null;
  const total = Math.max(2, durationSec);
  const speech = Math.min(total, Math.max(1, voicedSec || total - 0.6));

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  // Pure black backdrop — removed by the colorkey composite.
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#000000' }, svg);
  const tl = gsap.timeline({ paused: true });

  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  const fontSize = (portrait ? 40 : 34) * u;
  const baseline = portrait ? H * 0.78 : H * 0.855; // safe zone above platform UI
  const padX = 26 * u;
  const pillH = fontSize * 1.9;

  let cursor = 0.15; // slight lead-in so the first group lands with the voice
  chunks.forEach((chunk, ci) => {
    const span = Math.max(0.5, chunk.weight * (speech - 0.15));
    const text = chunk.words.join(' ');
    const width = Math.min(W * 0.9, text.length * fontSize * 0.56 + padX * 2);

    const group = el<SVGGElement>('g', { opacity: 0 }, svg);
    el('rect', {
      x: W / 2 - width / 2, y: baseline - pillH / 2, width, height: pillH,
      rx: pillH / 2, fill: PILL, opacity: 0.94,
    }, group);
    const t = el<SVGTextElement>('text', {
      x: W / 2, y: baseline + fontSize * 0.34,
      'font-family': FONT, 'font-size': fontSize, 'font-weight': 600,
      fill: '#FFFFFF', 'text-anchor': 'middle', 'letter-spacing': 0.2 * u,
    }, group);
    chunk.words.forEach((word, wi) => {
      const span_ = document.createElementNS(SVG_NS, 'tspan');
      if (isKeyword(word, wi)) { span_.setAttribute('fill', accent); span_.setAttribute('font-weight', '800'); }
      span_.textContent = (wi ? ' ' : '') + word;
      t.appendChild(span_);
    });

    gsap.set(group, { y: 14 * u, transformOrigin: '50% 100%' });
    tl.to(group, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' }, cursor);
    const holdEnd = ci === chunks.length - 1 ? Math.min(total - 0.25, cursor + span + 0.5) : cursor + span;
    tl.to(group, { opacity: 0, y: -8 * u, duration: 0.18, ease: 'power1.in' }, Math.max(cursor + 0.35, holdEnd - 0.18));
    cursor += span;
  });

  return { svg, timeline: tl, durationSec: total };
}

/**
 * EXACT-TEXT OVERLAY — deterministic kinetic headline for an AI-video scene.
 * The required string renders byte-exact in SVG (numbers, prices, product
 * names, CTAs), slides in over the footage's upper third, holds for most of
 * the scene, and eases out. Recorded on PURE BLACK and colorkeyed in FFmpeg,
 * so what survives on the footage is the pill + typography only.
 */
export function buildExactTextOverlay(
  text: string,
  durationSec: number,
  W: number,
  H: number,
  accent: string,
): BuiltAnimation | null {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const total = Math.max(2, durationSec);

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  // Pure black backdrop — removed by the colorkey composite.
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#000000' }, svg);
  const tl = gsap.timeline({ paused: true });

  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  // Big enough to be the headline, small enough never to fight the captions
  // pinned to the bottom safe zone.
  const fontSize = Math.min((portrait ? 72 : 64) * u, (W * 0.9) / Math.max(4, clean.length * 0.6));
  const baseline = portrait ? H * 0.24 : H * 0.2;
  const padX = 34 * u;
  const pillH = fontSize * 1.7;
  const width = Math.min(W * 0.92, clean.length * fontSize * 0.6 + padX * 2);

  const group = el<SVGGElement>('g', { opacity: 0 }, svg);
  el('rect', {
    x: W / 2 - width / 2, y: baseline - pillH / 2, width, height: pillH,
    rx: 14 * u, fill: PILL, opacity: 0.9,
  }, group);
  el('rect', {
    x: W / 2 - width / 2, y: baseline + pillH / 2 - 4 * u, width, height: 4 * u,
    fill: accent,
  }, group);
  const t = el<SVGTextElement>('text', {
    x: W / 2, y: baseline + fontSize * 0.34,
    'font-family': FONT, 'font-size': fontSize, 'font-weight': 800,
    fill: '#FFFFFF', 'text-anchor': 'middle', 'letter-spacing': 0.5 * u,
  }, group);
  clean.split(' ').forEach((word, wi) => {
    const span = document.createElementNS(SVG_NS, 'tspan');
    if (isKeyword(word, wi)) { span.setAttribute('fill', accent); }
    span.textContent = (wi ? ' ' : '') + word;
    t.appendChild(span);
  });

  gsap.set(group, { y: -18 * u, transformOrigin: '50% 0%' });
  const inAt = Math.min(0.6, total * 0.12);
  const outAt = Math.max(inAt + 0.8, total - 0.45);
  tl.to(group, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, inAt);
  tl.to(group, { opacity: 0, y: -12 * u, duration: 0.3, ease: 'power1.in' }, outAt);

  return { svg, timeline: tl, durationSec: total };
}
