/**
 * Short Video Enhancer — the AUTO B-ROLL / VISUAL INSERT engine.
 *
 * Talking-head short-form needs something to look at while the voice carries
 * the point. This module reads the transcript for CONCRETE things — a product
 * name, a number, a sequence of steps, an idea — and proposes a visual for each
 * one, mapped by what kind of thing it is:
 *
 *   SaaS / product mention  -> UI card, browser mockup or phone mockup
 *   data / number mention   -> stat card with the figure counting up
 *   process / workflow      -> animated arrow diagram of the steps
 *   vague concept           -> relevant animated icon
 *
 * Two things make this safe to run on someone's edit. First, every suggestion
 * is a PROPOSAL: nothing reaches the timeline until it is accepted, and an
 * accepted insert is an ordinary foreground motion-graphic layer afterwards —
 * nothing is ever baked into the clip. Second, the AI pass is optional: the
 * local heuristic below finds numbers, product-shaped names and step words on
 * its own, so the feature still works when the text model is unavailable.
 */

import {
  CANVAS_H, CANVAS_W,
  newGraphic, round3, uid,
  type GraphicType, type IconId, type InsertKind, type InsertSuggestion, type Project,
} from './model';
import type { ConceptHit } from './api';
import { centreOrClamp, type PresetPack } from './presets';

/** The visual vocabulary for each kind, in swap order. */
export const KIND_GRAPHICS: Record<InsertKind, GraphicType[]> = {
  product: ['uiCard', 'browserMockup', 'phoneMockup', 'featureCard', 'notification', 'label'],
  data: ['statCard', 'progressBar', 'label'],
  process: ['arrowDiagram', 'arrow', 'dots', 'cursorClick'],
  concept: ['icon', 'glow', 'glowRing', 'callout'],
};

/** How long an insert holds by default, per kind. */
const KIND_DURATION: Record<InsertKind, number> = { product: 2.8, data: 2.4, process: 3.2, concept: 2 };

const PROCESS_WORDS = ['step', 'steps', 'first', 'then', 'next', 'finally', 'process', 'workflow', 'pipeline', 'stage', 'phase'];
const PRODUCT_HINTS = ['app', 'tool', 'platform', 'dashboard', 'software', 'saas', 'website', 'site', 'product', 'crm', 'api', 'plugin', 'extension'];

const CONCEPT_ICONS: { match: string[]; icon: IconId }[] = [
  { match: ['idea', 'think', 'learn', 'understand', 'insight'], icon: 'bulb' },
  { match: ['fast', 'faster', 'speed', 'quick', 'instant', 'instantly'], icon: 'bolt' },
  { match: ['grow', 'growth', 'scale', 'increase', 'revenue', 'sales'], icon: 'chart' },
  { match: ['safe', 'secure', 'security', 'private', 'privacy', 'protect'], icon: 'lock' },
  { match: ['cloud', 'hosted', 'server', 'online', 'sync'], icon: 'cloud' },
  { match: ['goal', 'target', 'focus', 'aim', 'audience'], icon: 'target' },
  { match: ['launch', 'ship', 'start', 'build', 'release'], icon: 'rocket' },
  { match: ['process', 'workflow', 'automate', 'automation', 'system'], icon: 'gear' },
  { match: ['done', 'works', 'proven', 'verified', 'right'], icon: 'check' },
];

function iconFor(concept: string): IconId {
  const text = concept.toLowerCase();
  for (const entry of CONCEPT_ICONS) {
    if (entry.match.some((m) => text.indexOf(m) >= 0)) return entry.icon;
  }
  return 'spark';
}

function normalise(raw: string): string {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9'%$. ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Locating a phrase on the timeline
// ---------------------------------------------------------------------------

interface TimedToken { text: string; start: number; end: number }

/**
 * The spoken words with their timeline positions. Caption cues win because
 * they are already in timeline seconds; the raw transcript is mapped through
 * clip 1's in-point and speed, exactly as the caption builder does it.
 */
function timedTokens(project: Project, duration: number): TimedToken[] {
  const cues = project.captions.filter((c) => c.enabled && c.words.length);
  if (cues.length) {
    const out: TimedToken[] = [];
    for (const cue of cues) {
      for (const w of cue.words) out.push({ text: normalise(w.text), start: w.start, end: w.end });
    }
    return out.sort((a, b) => a.start - b.start);
  }
  const clip = project.clips[0];
  const words = project.transcript.filter((w) => w && typeof w.word === 'string' && w.word.trim());
  // Clip 1 starts after the hook's lead-in, so the words it carries do too.
  const leadIn = project.hook && project.hook.enabled ? Math.max(0, project.hook.leadIn) : 0;
  if (clip && words.length) {
    const out: TimedToken[] = [];
    for (const w of words) {
      if (w.start < clip.in - 0.001 || w.start > clip.out + 0.001) continue;
      const s = round3(leadIn + (w.start - clip.in) / Math.max(0.1, clip.speed));
      const e = round3(leadIn + (Math.max(w.start + 0.08, w.end) - clip.in) / Math.max(0.1, clip.speed));
      out.push({ text: normalise(w.word), start: s, end: Math.max(s + 0.08, e) });
    }
    return out;
  }
  const tokens = project.transcriptText.trim().split(/\s+/).filter(Boolean).slice(0, 400);
  const per = Math.max(0.5, duration - leadIn) / Math.max(1, tokens.length);
  return tokens.map((text, i) => ({ text: normalise(text), start: round3(leadIn + i * per), end: round3(leadIn + (i + 1) * per) }));
}

/** Where a phrase is spoken, or null when it is not in the transcript at all. */
function findPhrase(tokens: TimedToken[], phrase: string): { start: number; end: number } | null {
  const wanted = normalise(phrase).split(' ').filter(Boolean);
  if (!wanted.length || !tokens.length) return null;
  for (let i = 0; i <= tokens.length - wanted.length; i++) {
    let hit = true;
    for (let k = 0; k < wanted.length; k++) {
      if (tokens[i + k].text.indexOf(wanted[k]) !== 0) { hit = false; break; }
    }
    if (hit) return { start: tokens[i].start, end: tokens[i + wanted.length - 1].end };
  }
  // A single distinctive word is still a useful anchor for a multi-word phrase.
  const longest = wanted.slice().sort((a, b) => b.length - a.length)[0];
  const loose = tokens.find((t) => t.text === longest);
  return loose ? { start: loose.start, end: loose.end } : null;
}

// ---------------------------------------------------------------------------
// The local heuristic (runs with or without the text model)
// ---------------------------------------------------------------------------

/**
 * Concrete mentions found without any model: figures, product-shaped names and
 * step language. Deliberately conservative — the AI pass is what finds the
 * subtler concepts, this is what guarantees the feature is never empty.
 */
export function localConcepts(project: Project, duration: number): ConceptHit[] {
  const tokens = timedTokens(project, duration);
  const out: ConceptHit[] = [];
  const seen = new Set<string>();
  const push = (hit: ConceptHit) => {
    const key = hit.kind + ':' + hit.phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(hit);
  };

  const source = project.transcriptText.trim() || tokens.map((t) => t.text).join(' ');
  const words = source.split(/\s+/).filter(Boolean);

  words.forEach((raw, i) => {
    const word = raw.replace(/[^A-Za-z0-9%$.,'-]/g, '');
    if (!word) return;
    const lower = word.toLowerCase();

    // A figure is the strongest possible insert cue.
    if (/[0-9]/.test(word) && /[0-9%x$]/i.test(word)) {
      const after = (words[i + 1] || '').replace(/[^A-Za-z]/g, '');
      push({
        phrase: word,
        concept: 'the figure ' + word,
        kind: 'data',
        label: word + (after ? '|' + after.toLowerCase() : ''),
        icon: 'chart',
      });
      return;
    }
    // A product-shaped mention: a hint word, or a capitalised name mid-sentence.
    if (PRODUCT_HINTS.indexOf(lower) >= 0) {
      const before = (words[i - 1] || '').replace(/[^A-Za-z0-9]/g, '');
      push({ phrase: word, concept: (before ? before + ' ' : '') + lower, kind: 'product', label: before || 'Product', icon: 'spark' });
      return;
    }
    if (i > 0 && /^[A-Z][a-zA-Z]{3,}$/.test(word) && !/[.!?]$/.test(words[i - 1] || '')) {
      push({ phrase: word, concept: word, kind: 'product', label: word, icon: 'spark' });
      return;
    }
    if (PROCESS_WORDS.indexOf(lower) >= 0) {
      const steps = words.slice(i + 1, i + 4).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
      push({
        phrase: word,
        concept: 'a ' + lower + ' in the workflow',
        kind: 'process',
        label: (steps.length >= 2 ? steps : ['Brief', 'Draft', 'Ship']).slice(0, 3).join('|'),
        icon: 'gear',
      });
      return;
    }
    if (word.length >= 8 && /^[a-z]+$/.test(lower)) {
      push({ phrase: word, concept: lower, kind: 'concept', label: lower, icon: iconFor(lower) });
    }
  });

  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Building the suggestions
// ---------------------------------------------------------------------------

/**
 * Turn concepts (from the text model, the local heuristic, or both) into timed
 * suggestions. Suggestions whose phrase is not actually spoken anywhere are
 * dropped rather than parked at zero, and two suggestions never land within
 * 1.2s of each other — stacked inserts read as a glitch.
 */
export function suggestInserts(project: Project, duration: number, concepts: ConceptHit[]): InsertSuggestion[] {
  const tokens = timedTokens(project, duration);
  const kept: InsertSuggestion[] = [];
  const existing = new Set(project.inserts.map((i) => i.kind + ':' + i.phrase.toLowerCase()));

  const timed = concepts
    .map((hit) => ({ hit, window: findPhrase(tokens, hit.phrase) }))
    .filter((entry) => !!entry.window)
    .sort((a, b) => (a.window as { start: number }).start - (b.window as { start: number }).start);

  for (const entry of timed) {
    const hit = entry.hit;
    const window = entry.window as { start: number; end: number };
    const key = hit.kind + ':' + hit.phrase.toLowerCase();
    if (existing.has(key)) continue;
    const previous = kept[kept.length - 1];
    if (previous && window.start - previous.at < 1.2) continue;
    const hold = KIND_DURATION[hit.kind] || 2.4;
    const at = round3(Math.max(0, window.start - 0.1));
    if (at > duration - 0.6) continue;
    existing.add(key);
    kept.push({
      id: uid('ins'),
      at,
      end: round3(Math.min(duration, at + hold)),
      phrase: hit.phrase,
      concept: hit.concept,
      kind: hit.kind,
      graphicType: KIND_GRAPHICS[hit.kind][0],
      icon: hit.icon || iconFor(hit.concept),
      text: hit.label || hit.concept,
      // Inserts arrive as FOREGROUND layers; the Z-order selector on the layer
      // moves one behind the presenter when that reads better.
      band: 'foreground',
      reason: reasonFor(hit.kind, hit.phrase),
      status: 'pending',
      graphicId: null,
    });
  }
  return kept;
}

function reasonFor(kind: InsertKind, phrase: string): string {
  if (kind === 'product') return '“' + phrase + '” names a product, so a UI surface gives the viewer something to look at.';
  if (kind === 'data') return '“' + phrase + '” is a figure — a stat card counting up makes the number land.';
  if (kind === 'process') return '“' + phrase + '” describes a sequence, which an arrow diagram shows faster than words.';
  return '“' + phrase + '” is abstract, so an icon anchors it without competing with the captions.';
}

// ---------------------------------------------------------------------------
// Accept / reject / swap
// ---------------------------------------------------------------------------

/** Layout slots for accepted inserts, kept clear of the caption band. */
const SLOTS = [
  { x: 0.5, y: 0.3 },
  { x: 0.34, y: 0.42 },
  { x: 0.66, y: 0.34 },
  { x: 0.5, y: 0.46 },
];

/**
 * Accept a suggestion: build the real motion-graphic layer. Everything about
 * the layer is editable afterwards, including its Z-order band — accepting is
 * just a faster way of adding a graphic, not a separate mode.
 */
export function acceptInsert(project: Project, id: string, pack: PresetPack, slotIndex = 0): Project {
  const suggestion = project.inserts.find((i) => i.id === id);
  if (!suggestion) return project;
  if (suggestion.status === 'accepted' && suggestion.graphicId) return project;

  const g = newGraphic(suggestion.graphicType, suggestion.at, suggestion.end, pack.accent, pack.accent2);
  const slot = SLOTS[slotIndex % SLOTS.length];
  g.band = suggestion.band;
  g.icon = suggestion.icon;
  g.text = suggestion.text;
  g.easing = pack.easing === 'easeInOut' ? 'expoOut' : pack.easing;
  g.x = Math.round(CANVAS_W * slot.x);
  g.y = Math.round(CANVAS_H * slot.y);
  if (suggestion.graphicType === 'phoneMockup') { g.w = 440; g.h = 860; g.y = Math.round(CANVAS_H * 0.4); }
  if (suggestion.graphicType === 'gridOverlay' || suggestion.graphicType === 'glow') { g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H / 2); }
  if (suggestion.graphicType === 'featureCard') { g.w = 740; g.h = 290; g.x = Math.round(CANVAS_W / 2); }
  if (suggestion.graphicType === 'notification') { g.w = 820; g.h = 220; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.22); }
  // Keep the whole box inside the safe area at its largest scale — or dead
  // centre when it is bigger than the safe area and cannot satisfy it.
  centreOrClamp(g);

  return {
    ...project,
    graphics: [...project.graphics, g],
    inserts: project.inserts.map((i) => (i.id === id ? { ...i, status: 'accepted' as const, graphicId: g.id } : i)),
  };
}

/** Reject a suggestion, removing the layer it created if it was accepted. */
export function rejectInsert(project: Project, id: string): Project {
  const suggestion = project.inserts.find((i) => i.id === id);
  if (!suggestion) return project;
  return {
    ...project,
    graphics: suggestion.graphicId ? project.graphics.filter((g) => g.id !== suggestion.graphicId) : project.graphics,
    inserts: project.inserts.map((i) => (i.id === id ? { ...i, status: 'rejected' as const, graphicId: null } : i)),
  };
}

/**
 * Swap the visual for the next one in that kind's vocabulary. An accepted
 * insert swaps in place, so the layer keeps its timing and position.
 */
export function swapInsert(project: Project, id: string): Project {
  const suggestion = project.inserts.find((i) => i.id === id);
  if (!suggestion) return project;
  const options = KIND_GRAPHICS[suggestion.kind];
  const next = options[(options.indexOf(suggestion.graphicType) + 1) % options.length];
  return {
    ...project,
    graphics: project.graphics.map((g) => (g.id === suggestion.graphicId ? { ...g, type: next } : g)),
    inserts: project.inserts.map((i) => (i.id === id ? { ...i, graphicType: next } : i)),
  };
}
