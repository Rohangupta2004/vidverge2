/**
 * Caption Motion Graphics — the caption treatment of the Video Enhancer.
 *
 * Instead of burning caption TEXT onto the video, every caption moment gets a
 * MOTION GRAPHIC that visually represents the concept being spoken ("fast
 * delivery" → a package moving across with an arrow, "growth" → a rising
 * chart, "collaboration" → nodes connecting), animated in and out in sync
 * with the segment's word-timed start/end.
 *
 * - Concept mapping: one gpt-5.6-terra pass (platform AI proxy —
 *   POST /proxy/openai/v1/chat/completions with the X-Workspace-DB-Token
 *   header, reasoning_effort "none", max_completion_tokens) returns STRICT
 *   JSON assigning each caption segment one archetype from the fixed set
 *   below plus parameters (label, direction, accent). A keyword heuristic
 *   fills any segment the AI misses and doubles as the offline fallback.
 * - Rendering: MOTION_GRAPHICS_LIB is a Remotion component library (animated
 *   SVG built from interpolate/spring motion primitives — no static images,
 *   no photorealistic scenes, no subtitle text) inlined into the export
 *   composition by enhancerRender.ts.
 */
import { CaptionSegment, workspaceToken } from './enhancerCore';

/** How captions are treated in the export: concept motion graphics (default) or classic text. */
export type CaptionRenderMode = 'motion' | 'text';

export type MotionArchetypeId =
  | 'rise-chart' | 'fall-chart' | 'arrow-move' | 'network' | 'bulb' | 'clock'
  | 'shield' | 'coins' | 'heart' | 'check' | 'gear' | 'globe' | 'star-burst' | 'target';

export type MotionAccentId = 'blue' | 'amber' | 'green' | 'pink' | 'violet' | 'cyan';

export interface MotionCue {
  id: string;
  /** Caption segment this cue is synced to. */
  segId: string;
  start: number;
  end: number;
  archetype: MotionArchetypeId;
  /** 1–3 punchy words shown under the graphic (concept label, not a subtitle). */
  label: string;
  dir: 'ltr' | 'rtl';
  accent: MotionAccentId;
  enabled: boolean;
}

export const MOTION_ACCENTS: Record<MotionAccentId, string> = {
  blue: '#3B82F6',
  amber: '#F59E0B',
  green: '#22C55E',
  pink: '#EC4899',
  violet: '#8B5CF6',
  cyan: '#06B6D4',
};

export const MOTION_ARCHETYPES: { id: MotionArchetypeId; label: string; emoji: string; hint: string; keywords: string[] }[] = [
  { id: 'rise-chart', label: 'Rising chart', emoji: '📈', hint: 'growth, increase, improvement, results, progress, getting more', keywords: ['grow', 'increas', 'improv', 'gain', 'rise', 'boost', 'scal', 'progress', 'better', 'double', 'more'] },
  { id: 'fall-chart', label: 'Falling chart', emoji: '📉', hint: 'decline, drop, reduction, fewer, shrinking', keywords: ['drop', 'decreas', 'declin', 'fall', 'reduc', 'lower', 'shrink', 'less', 'fewer'] },
  { id: 'arrow-move', label: 'Package on the move', emoji: '📦', hint: 'delivery, shipping, sending, speed, launching, forward motion', keywords: ['deliver', 'ship', 'send', 'fast', 'quick', 'speed', 'launch', 'move', 'transfer', 'instant'] },
  { id: 'network', label: 'Connecting nodes', emoji: '🤝', hint: 'collaboration, team, community, connection, integration, sharing', keywords: ['collab', 'team', 'together', 'connect', 'network', 'communit', 'partner', 'share', 'integrat', 'social', 'friend'] },
  { id: 'bulb', label: 'Idea bulb', emoji: '💡', hint: 'ideas, insight, innovation, creativity, learning, tips', keywords: ['idea', 'think', 'creativ', 'innovat', 'insight', 'learn', 'smart', 'imagin', 'solution', 'tip', 'know'] },
  { id: 'clock', label: 'Ticking clock', emoji: '⏱️', hint: 'time, deadlines, saving time, schedules, waiting, speed over time', keywords: ['time', 'minute', 'hour', 'day', 'week', 'schedul', 'deadline', 'wait', 'soon', 'today', 'now'] },
  { id: 'shield', label: 'Shield check', emoji: '🛡️', hint: 'security, safety, protection, privacy, trust, reliability', keywords: ['secur', 'safe', 'protect', 'priva', 'trust', 'guarantee', 'reliab', 'risk'] },
  { id: 'coins', label: 'Coin stack', emoji: '💰', hint: 'money, price, cost, revenue, savings, value, budget', keywords: ['money', 'price', 'cost', 'pay', 'revenue', 'profit', 'sav', 'dollar', 'budget', 'value', 'free', 'cash', 'earn', 'sell'] },
  { id: 'heart', label: 'Pulsing heart', emoji: '❤️', hint: 'love, passion, care, customers, warmth, enjoyment', keywords: ['love', 'heart', 'care', 'passion', 'happy', 'enjoy', 'customer', 'favorite', 'feel'] },
  { id: 'check', label: 'Check mark', emoji: '✅', hint: 'success, completion, done, correct, easy wins', keywords: ['done', 'complete', 'success', 'achiev', 'finish', 'correct', 'win', 'solve', 'easy', 'simple', 'works'] },
  { id: 'gear', label: 'Turning gears', emoji: '⚙️', hint: 'process, work, building, automation, systems, tools', keywords: ['work', 'build', 'process', 'system', 'automat', 'engine', 'tool', 'setting', 'machine', 'operat', 'creat', 'make'] },
  { id: 'globe', label: 'Spinning globe', emoji: '🌍', hint: 'the world, global reach, everywhere, international', keywords: ['world', 'global', 'everywhere', 'country', 'international', 'planet', 'anywhere', 'reach'] },
  { id: 'star-burst', label: 'Star burst', emoji: '⭐', hint: 'emphasis, quality, wow moments, highlights, excellence', keywords: ['amazing', 'best', 'great', 'wow', 'incredible', 'star', 'quality', 'perfect', 'awesome', 'premium', 'special'] },
  { id: 'target', label: 'Target hit', emoji: '🎯', hint: 'goals, focus, precision, aiming at an audience or outcome', keywords: ['goal', 'target', 'focus', 'aim', 'precis', 'exact', 'specific', 'audience', 'mission', 'right'] },
];

const ARCHETYPE_IDS = new Set<string>(MOTION_ARCHETYPES.map((a) => a.id));
const ACCENT_IDS: MotionAccentId[] = ['blue', 'amber', 'green', 'pink', 'violet', 'cyan'];
/** Rotation used when no keyword matches, so no-match segments still vary. */
const DEFAULT_ROTATION: MotionArchetypeId[] = ['star-burst', 'bulb', 'check', 'target'];
const MAX_SEGMENTS = 60;
const MAX_LABEL_CHARS = 18;

export function archetypeEmoji(id: string): string {
  const a = MOTION_ARCHETYPES.find((x) => x.id === id);
  return a ? a.emoji : '✨';
}

export function archetypeLabel(id: string): string {
  const a = MOTION_ARCHETYPES.find((x) => x.id === id);
  return a ? a.label : 'Graphic';
}

function cleanLabel(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}\s'&%$+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS);
}

/** Pick the concept label straight from the segment: emphasized words first, else the longest word. */
function labelFor(seg: CaptionSegment): string {
  const emphasized = seg.words.filter((w) => w.em).map((w) => w.t);
  if (emphasized.length) return cleanLabel(emphasized.slice(0, 2).join(' '));
  let longest = '';
  for (const w of seg.words) {
    const clean = w.t.replace(/[^\p{L}\p{N}']/gu, '');
    if (clean.length > longest.length) longest = clean;
  }
  return cleanLabel(longest);
}

function enabledSegments(segments: CaptionSegment[]): CaptionSegment[] {
  return segments.filter((s) => s.enabled && s.words.length > 0).slice(0, MAX_SEGMENTS);
}

function heuristicCueFor(seg: CaptionSegment, index: number): MotionCue {
  const text = seg.text.toLowerCase();
  let best: MotionArchetypeId | null = null;
  let bestScore = 0;
  for (const a of MOTION_ARCHETYPES) {
    let score = 0;
    for (const k of a.keywords) {
      if (text.includes(k)) score += k.length;
    }
    if (score > bestScore) { best = a.id; bestScore = score; }
  }
  const archetype = best || DEFAULT_ROTATION[index % DEFAULT_ROTATION.length];
  return {
    id: 'mcue-' + seg.id,
    segId: seg.id,
    start: seg.start,
    end: seg.end,
    archetype,
    label: labelFor(seg),
    dir: index % 2 === 0 ? 'ltr' : 'rtl',
    accent: ACCENT_IDS[index % ACCENT_IDS.length],
    enabled: true,
  };
}

/** Deterministic keyword mapping — instant, offline, and the per-segment fallback for the AI pass. */
export function heuristicMotionCues(segments: CaptionSegment[]): MotionCue[] {
  return enabledSegments(segments).map((seg, i) => heuristicCueFor(seg, i));
}

interface ChatChoice { message?: { content?: string | null } | null }
interface ChatResponse { choices?: ChatChoice[]; error?: { message?: string } | string | null }

function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last <= first) throw new Error('The AI mapping came back in an unexpected format — try again.');
  const parsed: unknown = JSON.parse(cleaned.slice(first, last + 1));
  if (!Array.isArray(parsed)) throw new Error('The AI mapping was not a list — try again.');
  return parsed;
}

/**
 * One gpt-5.6-terra pass over the caption segments: strict JSON mapping each
 * segment to one archetype of the fixed set + parameters. Throws when the
 * proxy call fails — the caller falls back to heuristicMotionCues.
 */
export async function mapCaptionsToMotionCues(segments: CaptionSegment[]): Promise<MotionCue[]> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const segs = enabledSegments(segments);
  if (!segs.length) return [];
  const payload = segs.map((s, i) => ({ i, start: s.start, end: s.end, text: s.text.slice(0, 160) }));
  const archetypeLines = MOTION_ARCHETYPES.map((a) => '- "' + a.id + '" — ' + a.hint).join('\n');
  const prompt = [
    'You are a motion-graphics director for a video editor. For EACH caption segment of a spoken video below, pick the ONE motion-graphic archetype that best visualizes the CONCEPT being said at that moment (e.g. "fast delivery" → arrow-move, "our numbers grew" → rise-chart, "we built this together" → network), plus a short concept label.',
    '',
    'ARCHETYPES (use the id exactly):',
    archetypeLines,
    '',
    'CAPTION SEGMENTS (JSON, times in seconds):',
    JSON.stringify(payload),
    '',
    'Return ONLY a JSON array, no prose and no markdown, with EXACTLY one element per segment, each exactly this shape:',
    '{"i": <segment index>, "a": "<archetype id>", "label": "<1-3 punchy words naming the concept, max ' + MAX_LABEL_CHARS + ' chars>", "dir": "ltr" | "rtl", "accent": "blue" | "amber" | "green" | "pink" | "violet" | "cyan"}',
    '',
    'Rules:',
    '- "a" MUST be one of the archetype ids listed above.',
    '- Vary the archetypes — never the same id twice in a row unless the concept truly repeats.',
    '- "label" is a concept name (often an emphasized word from the segment), NEVER the full caption text.',
    '- "dir" is the entrance direction; alternate for rhythm. "accent" picks the highlight colour.',
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
  const data = (await res.json().catch(() => null)) as ChatResponse | null;
  if (!res.ok) {
    const err = data && data.error ? (typeof data.error === 'string' ? data.error : data.error.message || '') : '';
    throw new Error(err || ('AI request failed (HTTP ' + res.status + ').'));
  }
  const first = data && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = first && first.message && typeof first.message.content === 'string' ? first.message.content : '';
  if (!content.trim()) throw new Error('The AI returned an empty response — try again.');

  const byIndex = new Map<number, { a: MotionArchetypeId; label: string; dir: 'ltr' | 'rtl'; accent: MotionAccentId }>();
  for (const raw of extractJsonArray(content)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const i = Number(r.i);
    const a = typeof r.a === 'string' ? r.a : '';
    if (!Number.isInteger(i) || i < 0 || i >= segs.length || !ARCHETYPE_IDS.has(a)) continue;
    byIndex.set(i, {
      a: a as MotionArchetypeId,
      label: cleanLabel(typeof r.label === 'string' ? r.label : ''),
      dir: r.dir === 'rtl' ? 'rtl' : 'ltr',
      accent: ACCENT_IDS.includes(r.accent as MotionAccentId) ? (r.accent as MotionAccentId) : ACCENT_IDS[i % ACCENT_IDS.length],
    });
  }
  if (!byIndex.size) throw new Error('The AI mapping contained no usable cues — try again.');

  return segs.map((seg, i) => {
    const mapped = byIndex.get(i);
    if (!mapped) return heuristicCueFor(seg, i);
    return {
      id: 'mcue-' + seg.id,
      segId: seg.id,
      start: seg.start,
      end: seg.end,
      archetype: mapped.a,
      label: mapped.label || labelFor(seg),
      dir: mapped.dir,
      accent: mapped.accent,
      enabled: true,
    };
  });
}

/** The shape a cue travels in as a Remotion inputProp (times in SOURCE seconds). */
export interface RenderMotionCue { start: number; end: number; archetype: string; label: string; dir: string; color: string }

export function toRenderMotionCues(cues: MotionCue[]): RenderMotionCue[] {
  return cues
    .filter((c) => c.enabled && c.end - c.start > 0.15)
    .map((c) => ({
      start: c.start,
      end: c.end,
      archetype: c.archetype,
      label: c.label,
      dir: c.dir,
      color: MOTION_ACCENTS[c.accent] || MOTION_ACCENTS.blue,
    }));
}

/**
 * Remotion motion-primitives library (plain JS/JSX, no TypeScript syntax),
 * inlined into the export composition string by enhancerRender.ts. Everything
 * is animated SVG driven by interpolate/spring — clean explainer-style motion
 * graphics that enter with a spring, live for the segment, and fade out.
 * It relies on AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate and
 * spring being imported at the top of the host composition. Nothing here may
 * throw when props are absent (the render service probes with empty props).
 */
export const MOTION_GRAPHICS_LIB = `
const MG_CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const MG_FONT = "'Inter', system-ui, -apple-system, sans-serif";
const MG_WHITE = 'rgba(255,255,255,0.94)';

function MotionGlyph({ a, frame, fps, C }) {
  const sp = spring({ frame, fps, config: { damping: 12, stiffness: 150 } });
  const draw = interpolate(frame, [0, 18], [0, 1], MG_CLAMP);
  const loop = frame / Math.max(1, fps);
  if (a === 'rise-chart' || a === 'fall-chart') {
    const up = a === 'rise-chart';
    const heights = [52, 86, 120, 152];
    return (
      <g>
        {heights.map((h, i) => {
          const g = spring({ frame: Math.max(0, frame - i * 3), fps, config: { damping: 13, stiffness: 170 } });
          const hh = Math.max(1, (up ? heights[i] : heights[heights.length - 1 - i]) * g);
          return <rect key={i} x={18 + i * 44} y={176 - hh} width={32} height={hh} rx={7} fill={i === 3 ? C : MG_WHITE} />;
        })}
        <path d={up ? 'M14 128 L84 88 L120 106 L186 40' : 'M14 40 L80 100 L118 84 L186 148'} stroke={C} strokeWidth={11} fill='none' strokeLinecap='round' strokeLinejoin='round' strokeDasharray={300} strokeDashoffset={300 * (1 - draw)} />
        <path d={up ? 'M186 40 L156 42 L176 68 Z' : 'M186 148 L156 146 L176 120 Z'} fill={C} opacity={draw} />
      </g>
    );
  }
  if (a === 'arrow-move') {
    const x = interpolate(sp, [0, 1], [-70, 0]) + Math.sin(loop * 4) * 4;
    return (
      <g transform={'translate(' + x + ' 0)'}>
        <rect x={54} y={90} width={72} height={56} rx={8} fill={MG_WHITE} />
        <path d='M54 106 L126 106' stroke='rgba(0,0,0,0.22)' strokeWidth={4} />
        <path d='M90 90 L90 146' stroke='rgba(0,0,0,0.16)' strokeWidth={4} />
        <path d='M134 118 L182 118' stroke={C} strokeWidth={12} strokeLinecap='round' strokeDasharray={48} strokeDashoffset={48 * (1 - draw)} />
        <path d='M170 99 L192 118 L170 137 Z' fill={C} opacity={draw} />
        <path d='M16 102 L44 102 M8 120 L40 120 M18 138 L44 138' stroke={MG_WHITE} strokeWidth={7} strokeLinecap='round' opacity={0.35 + 0.5 * Math.abs(Math.sin(loop * 6))} />
      </g>
    );
  }
  if (a === 'network') {
    const nodes = [[100, 44], [40, 126], [160, 126], [72, 176], [136, 176]];
    const links = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]];
    return (
      <g>
        {links.map((l, i) => {
          const d = interpolate(frame, [i * 3, i * 3 + 14], [0, 1], MG_CLAMP);
          const A = nodes[l[0]];
          const B = nodes[l[1]];
          return <line key={i} x1={A[0]} y1={A[1]} x2={A[0] + (B[0] - A[0]) * d} y2={A[1] + (B[1] - A[1]) * d} stroke={MG_WHITE} strokeWidth={5} opacity={0.8} />;
        })}
        {nodes.map((n, i) => {
          const g = spring({ frame: Math.max(0, frame - i * 2), fps, config: { damping: 10, stiffness: 190 } });
          return <circle key={i} cx={n[0]} cy={n[1]} r={Math.max(0.5, (i === 0 ? 20 : 15) * g)} fill={i === 0 ? C : MG_WHITE} />;
        })}
      </g>
    );
  }
  if (a === 'bulb') {
    const glow = 0.55 + 0.45 * Math.abs(Math.sin(loop * 3.2));
    const rays = [0, 1, 2, 3, 4];
    return (
      <g>
        {rays.map((i) => {
          const ang = (-90 + (i - 2) * 32) * Math.PI / 180;
          return <line key={i} x1={100 + Math.cos(ang) * 62} y1={92 + Math.sin(ang) * 62} x2={100 + Math.cos(ang) * 84} y2={92 + Math.sin(ang) * 84} stroke={C} strokeWidth={8} strokeLinecap='round' opacity={glow * draw} />;
        })}
        <circle cx={100} cy={92} r={Math.max(0.5, 44 * sp)} fill={C} opacity={0.92} />
        <rect x={84} y={138} width={32} height={12} rx={4} fill={MG_WHITE} opacity={sp} />
        <rect x={88} y={154} width={24} height={10} rx={4} fill={MG_WHITE} opacity={sp} />
      </g>
    );
  }
  if (a === 'clock') {
    return (
      <g>
        <circle cx={100} cy={100} r={Math.max(0.5, 70 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={10} />
        <g transform={'rotate(' + (loop * 260) + ' 100 100)'}>
          <line x1={100} y1={100} x2={100} y2={48} stroke={C} strokeWidth={9} strokeLinecap='round' />
        </g>
        <line x1={100} y1={100} x2={132} y2={112} stroke={MG_WHITE} strokeWidth={8} strokeLinecap='round' opacity={sp} />
        <circle cx={100} cy={100} r={8} fill={C} />
      </g>
    );
  }
  if (a === 'shield') {
    const s = 0.6 + 0.4 * sp;
    return (
      <g>
        <path d='M100 22 L164 46 L164 106 C164 148 136 170 100 182 C64 170 36 148 36 106 L36 46 Z' fill={MG_WHITE} transform={'translate(100 100) scale(' + s + ') translate(-100 -100)'} />
        <path d='M68 102 L92 128 L138 74' stroke={C} strokeWidth={14} fill='none' strokeLinecap='round' strokeLinejoin='round' strokeDasharray={120} strokeDashoffset={120 * (1 - draw)} />
      </g>
    );
  }
  if (a === 'coins') {
    const dropY = interpolate(sp, [0, 1], [-70, 0]);
    return (
      <g>
        {[0, 1, 2].map((i) => (
          <ellipse key={i} cx={100} cy={162 - i * 22} rx={58} ry={16} fill={i === 1 ? C : MG_WHITE} opacity={0.95} />
        ))}
        <g transform={'translate(0 ' + dropY + ')'} opacity={sp}>
          <circle cx={100} cy={72} r={30} fill={C} />
          <text x={100} y={84} textAnchor='middle' fontFamily={MG_FONT} fontWeight={900} fontSize={34} fill='#FFFFFF'>$</text>
        </g>
      </g>
    );
  }
  if (a === 'heart') {
    const beat = 1 + 0.08 * Math.sin(loop * 5.4);
    const s = Math.max(0.001, sp * beat);
    return (
      <g transform={'translate(100 104) scale(' + s + ') translate(-100 -104)'}>
        <path d='M100 170 C40 128 28 92 46 66 C62 44 92 48 100 74 C108 48 138 44 154 66 C172 92 160 128 100 170 Z' fill={C} />
      </g>
    );
  }
  if (a === 'check') {
    return (
      <g>
        <circle cx={100} cy={100} r={Math.max(0.5, 74 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={10} />
        <path d='M62 104 L90 132 L142 68' stroke={C} strokeWidth={16} fill='none' strokeLinecap='round' strokeLinejoin='round' strokeDasharray={140} strokeDashoffset={140 * (1 - draw)} />
      </g>
    );
  }
  if (a === 'gear') {
    const rot = loop * 60;
    const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
    return (
      <g opacity={Math.min(1, sp * 1.3)}>
        <g transform={'rotate(' + rot + ' 78 112)'}>
          {teeth.map((td) => <rect key={td} x={70} y={56} width={16} height={20} rx={4} fill={MG_WHITE} transform={'rotate(' + td + ' 78 112)'} />)}
          <circle cx={78} cy={112} r={42} fill={MG_WHITE} />
          <circle cx={78} cy={112} r={16} fill='rgba(0,0,0,0.55)' />
        </g>
        <g transform={'rotate(' + (-rot * 1.4) + ' 148 62)'}>
          {teeth.map((td) => <rect key={td} x={143} y={26} width={10} height={14} rx={3} fill={C} transform={'rotate(' + td + ' 148 62)'} />)}
          <circle cx={148} cy={62} r={26} fill={C} />
          <circle cx={148} cy={62} r={10} fill='rgba(0,0,0,0.55)' />
        </g>
      </g>
    );
  }
  if (a === 'globe') {
    const orbit = loop * 3.4;
    return (
      <g>
        <circle cx={100} cy={100} r={Math.max(0.5, 62 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={9} />
        <ellipse cx={100} cy={100} rx={Math.max(0.5, 62 * sp)} ry={Math.max(0.5, 24 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={5} opacity={0.7} />
        <line x1={100} y1={38} x2={100} y2={162} stroke={MG_WHITE} strokeWidth={5} opacity={0.7 * sp} />
        <circle cx={100 + Math.cos(orbit) * 86} cy={100 + Math.sin(orbit) * 30} r={11} fill={C} opacity={draw} />
      </g>
    );
  }
  if (a === 'target') {
    const hit = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 9, stiffness: 200 } });
    return (
      <g>
        <circle cx={100} cy={100} r={Math.max(0.5, 78 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={9} />
        <circle cx={100} cy={100} r={Math.max(0.5, 52 * sp)} fill='none' stroke={C} strokeWidth={9} />
        <circle cx={100} cy={100} r={Math.max(0.5, 26 * sp)} fill='none' stroke={MG_WHITE} strokeWidth={9} />
        <circle cx={100} cy={100} r={Math.max(0.5, 13 * hit)} fill={C} />
      </g>
    );
  }
  // 'star-burst' and any unknown archetype: star pop with a particle burst.
  const burstR = interpolate(frame, [4, 22], [30, 92], MG_CLAMP);
  const burstOp = interpolate(frame, [4, 14, 26], [0, 1, 0], MG_CLAMP);
  return (
    <g>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const ang = i * 45 * Math.PI / 180;
        return <circle key={i} cx={100 + Math.cos(ang) * burstR} cy={100 + Math.sin(ang) * burstR} r={6} fill={C} opacity={burstOp} />;
      })}
      <path d='M100 26 L118 76 L172 78 L130 112 L146 166 L100 134 L54 166 L70 112 L28 78 L82 76 Z' fill={MG_WHITE} transform={'translate(100 100) scale(' + Math.max(0.001, sp) + ') translate(-100 -100)'} />
      <circle cx={100} cy={98} r={Math.max(0.5, 14 * sp)} fill={C} />
    </g>
  );
}

function MotionCueFx({ label, kind, dir, color, dur, scale }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sc = Number(scale) > 0 ? Number(scale) : 1;
  const sIn = spring({ frame, fps, config: { damping: 13, stiffness: 140 } });
  const out = interpolate(frame, [Math.max(1, dur - 9), dur], [1, 0], MG_CLAMP);
  const C = typeof color === 'string' && color ? color : '#3B82F6';
  const slide = (dir === 'rtl' ? 1 : -1) * (1 - sIn) * 70;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 58 * sc, pointerEvents: 'none' }}>
      <div style={{ opacity: Math.min(1, sIn * 1.3) * out, transform: 'translateX(' + (slide * sc) + 'px) scale(' + (0.82 + 0.18 * sIn) + ')', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width={205 * sc} height={205 * sc} viewBox='0 0 200 200' style={{ filter: 'drop-shadow(0 10px 26px rgba(0,0,0,0.5))' }}>
          <MotionGlyph a={kind} frame={frame} fps={fps} C={C} />
        </svg>
        {label ? (
          <div style={{ marginTop: 8 * sc, fontFamily: MG_FONT, fontWeight: 900, fontSize: 38 * sc, letterSpacing: 1.5, textTransform: 'uppercase', color: '#FFFFFF', textShadow: '0 4px 18px rgba(0,0,0,0.65)', background: 'rgba(8,10,20,0.55)', padding: (5 * sc) + 'px ' + (18 * sc) + 'px', borderRadius: 12 * sc, borderBottom: (4 * sc) + 'px solid ' + C }}>{label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
`;
