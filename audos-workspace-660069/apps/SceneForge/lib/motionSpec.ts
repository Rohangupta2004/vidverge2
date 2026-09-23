// MOTION SPEC — the structured, deterministic description of a middle visual
// scene. The single orchestrator LLM writes these specs (agents/orchestrator);
// the GSAP + SVG motion-graphics engine (components/MotionGraphicPlayer)
// renders EXACTLY the strings and numbers stored here — no text is ever
// generated inside an AI video and nothing is hallucinated at render time.

export type MotionKind =
  | 'branching_diagram' // root node fanning out to branches
  | 'flowchart'         // left-to-right steps joined by drawn arrows
  | 'timeline'          // dated beats along a horizontal line
  | 'comparison'        // two columns, side by side
  | 'list_reveal'       // headline + staggered bullet reveals
  | 'big_stat'          // one number counting up with a label
  | 'bar_chart'         // labeled bars growing to exact values
  | 'node_graph'        // connected nodes (networks, maps of relationships)
  | 'annotated_image'   // a still image with drawn callout annotations
  | 'text_reveal';      // pure animated text (the text_overlay scene type)

export interface MotionItem {
  label: string;
  sublabel?: string;
  /** Exact numeric value for bar_chart bars (and shown beside the bar). */
  value?: number;
  /** Optional image drawn inside the node/branch (fetched + inlined at capture). */
  imageUrl?: string;
}

export interface MotionStat { value: number; prefix?: string; suffix?: string; label?: string }

export interface MotionSpec {
  kind: MotionKind;
  title?: string;
  subtitle?: string;
  /** branching_diagram: the central/root node label. */
  root?: string;
  /** branches / steps / beats / bullets / bars / nodes / annotations. */
  items: MotionItem[];
  /** comparison columns. */
  leftTitle?: string;
  rightTitle?: string;
  leftItems?: string[];
  rightItems?: string[];
  /** big_stat payload. */
  stat?: MotionStat;
  /** annotated_image backdrop (also usable as a soft backdrop on other kinds). */
  imageUrl?: string;
  /** Accent hex; defaults to the brand blue family per kind. */
  accent?: string;
  durationSec?: number;
}

const KIND_ALIASES: Record<string, MotionKind> = {
  branching_diagram: 'branching_diagram', branching: 'branching_diagram', branches: 'branching_diagram', diagram: 'branching_diagram', mindmap: 'branching_diagram', radial: 'branching_diagram',
  flowchart: 'flowchart', flow: 'flowchart', process: 'flowchart', steps: 'flowchart', pipeline: 'flowchart',
  timeline: 'timeline', chronology: 'timeline', history: 'timeline',
  comparison: 'comparison', compare: 'comparison', versus: 'comparison', vs: 'comparison', table: 'comparison',
  list_reveal: 'list_reveal', list: 'list_reveal', bullets: 'list_reveal', checklist: 'list_reveal',
  big_stat: 'big_stat', stat: 'big_stat', number: 'big_stat', counter: 'big_stat', statistic: 'big_stat',
  bar_chart: 'bar_chart', chart: 'bar_chart', bars: 'bar_chart', graph: 'bar_chart',
  node_graph: 'node_graph', network: 'node_graph', nodes: 'node_graph', map: 'node_graph', connections: 'node_graph',
  annotated_image: 'annotated_image', annotated: 'annotated_image', callouts: 'annotated_image', image_annotation: 'annotated_image',
  text_reveal: 'text_reveal', text: 'text_reveal', animated_text: 'text_reveal', text_overlay: 'text_reveal', title_card: 'text_reveal', quote: 'text_reveal',
};

const str = (value: unknown, max = 160) => String(value == null ? '' : value).trim().slice(0, max);
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : undefined; };

/** A usable image reference: an https URL, or a data: URL (the capture path
 * inlines remote images as data: URLs and then re-normalizes the spec, so
 * rejecting them here silently stripped every image out of captured clips). */
function toImageRef(value: unknown): string | undefined {
  const raw = String(value == null ? '' : value).trim();
  if (/^data:image\//i.test(raw)) return raw; // never truncate a data: URL
  const url = raw.slice(0, 500);
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function toItem(raw: any): MotionItem | null {
  if (raw == null) return null;
  if (typeof raw === 'string' || typeof raw === 'number') { const label = str(raw, 90); return label ? { label } : null; }
  if (typeof raw !== 'object') return null;
  const label = str(raw.label ?? raw.text ?? raw.name ?? raw.title ?? raw.year ?? raw.date ?? '', 90);
  if (!label) return null;
  const item: MotionItem = { label };
  const sub = str(raw.sublabel ?? raw.detail ?? raw.description ?? raw.caption ?? raw.event ?? '', 140);
  if (sub && sub !== label) item.sublabel = sub;
  const value = num(raw.value ?? raw.amount ?? raw.count ?? raw.percent);
  if (value !== undefined) item.value = value;
  const image = toImageRef(raw.imageUrl ?? raw.image_url ?? raw.image);
  if (image) item.imageUrl = image;
  return item;
}

const toStrings = (raw: any, max = 6): string[] => (Array.isArray(raw) ? raw : []).map((entry) => typeof entry === 'object' && entry ? str(entry.label ?? entry.text ?? '', 90) : str(entry, 90)).filter(Boolean).slice(0, max);

/**
 * Coerce whatever layout object the LLM (or an older scene row) carries into a
 * renderable MotionSpec. Unknown kinds fall back to text_reveal so a scene is
 * never unrenderable; item lists accept every alias the schema has used
 * (branches, steps, entries, points, bars, nodes, annotations, bullets).
 */
export function normalizeMotionSpec(raw: any, fallbackText = ''): MotionSpec {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = KIND_ALIASES[String(source.kind ?? source.layout_kind ?? source.type ?? '').toLowerCase().trim()] || 'text_reveal';
  const rawItems = source.items ?? source.branches ?? source.steps ?? source.beats ?? source.entries ?? source.points ?? source.bars ?? source.nodes ?? source.annotations ?? source.bullets ?? source.events ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : []).map(toItem).filter(Boolean).slice(0, 8) as MotionItem[];
  const spec: MotionSpec = {
    kind,
    items,
    title: str(source.title ?? source.headline ?? source.text ?? '', 110) || (kind === 'text_reveal' ? str(fallbackText, 110) : undefined),
    subtitle: str(source.subtitle ?? source.subtext ?? source.supporting_line ?? '', 160) || undefined,
    root: str(source.root ?? source.center ?? source.hub ?? '', 60) || undefined,
    leftTitle: str(source.leftTitle ?? source.left_title ?? source.left?.title ?? '', 60) || undefined,
    rightTitle: str(source.rightTitle ?? source.right_title ?? source.right?.title ?? '', 60) || undefined,
    leftItems: toStrings(source.leftItems ?? source.left_items ?? source.left?.items ?? source.left),
    rightItems: toStrings(source.rightItems ?? source.right_items ?? source.right?.items ?? source.right),
    accent: /^#[0-9a-fA-F]{3,8}$/.test(str(source.accent ?? source.color ?? '', 16)) ? str(source.accent ?? source.color, 16) : undefined,
    durationSec: num(source.durationSec ?? source.duration_sec),
  };
  const statRaw = source.stat ?? (kind === 'big_stat' ? source : null);
  const statValue = num(statRaw?.value ?? statRaw?.number ?? statRaw?.stat);
  if (statValue !== undefined) spec.stat = { value: statValue, prefix: str(statRaw?.prefix ?? '', 12) || undefined, suffix: str(statRaw?.suffix ?? statRaw?.unit ?? '', 16) || undefined, label: str(statRaw?.label ?? statRaw?.caption ?? '', 110) || undefined };
  const image = toImageRef(source.imageUrl ?? source.image_url ?? source.image ?? source.backdrop);
  if (image) spec.imageUrl = image;
  if (!spec.leftItems?.length) delete spec.leftItems;
  if (!spec.rightItems?.length) delete spec.rightItems;
  return spec;
}

// ---------------------------------------------------------------------------
// VISUAL VARIETY — content-aware accent selection. When a spec carries no
// explicit accent, the engine derives one deterministically from WHAT the
// scene is about (keywords) and HOW it is laid out (kind), instead of painting
// every middle scene the same brand blue. Deterministic on purpose: preview
// and capture always agree, and the accent is computed at render so it never
// changes a spec's fingerprint (existing captured clips stay valid).
// ---------------------------------------------------------------------------

const ACCENT_ROTATION = ['#3B82F6', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#2DD4BF', '#F472B6'];

const TOPIC_ACCENTS: { pattern: RegExp; accent: string }[] = [
  { pattern: /\b(data|science|scientific|research|study|studies|experiment|measure|percent|rate|statistic)/i, accent: '#06B6D4' }, // data-viz cyan
  { pattern: /\b(money|price|cost|revenue|profit|market|sales|invest|fund|dollar|econom|growth)/i, accent: '#10B981' },            // finance emerald
  { pattern: /\b(history|histor|year|decade|century|era|ancient|founded|timeline|evolution)/i, accent: '#F59E0B' },                // historic amber
  { pattern: /\b(risk|danger|warning|threat|decline|loss|fail|crash|crisis|mistake)/i, accent: '#F43F5E' },                        // caution rose
  { pattern: /\b(health|body|brain|medical|medicine|biology|cell|heart)/i, accent: '#14B8A6' },                                    // clinical teal
  { pattern: /\b(product|app|tech|software|ai|robot|digital|device|platform|feature)/i, accent: '#8B5CF6' },                       // product violet
  { pattern: /\b(nature|climate|earth|planet|energy|solar|forest|ocean|environment)/i, accent: '#84CC16' },                        // organic lime
];

const KIND_ACCENTS: Partial<Record<MotionKind, string>> = {
  bar_chart: '#06B6D4',
  big_stat: '#06B6D4',
  timeline: '#F59E0B',
  comparison: '#10B981',
  flowchart: '#8B5CF6',
  node_graph: '#38BDF8',
  list_reveal: '#2DD4BF',
};

function specSeedText(spec: MotionSpec): string {
  return [spec.title, spec.subtitle, spec.root, spec.stat?.label, ...spec.items.map((item) => item.label)].filter(Boolean).join(' ');
}

/** The accent this spec renders with: explicit accent > topic keyword > kind default > deterministic rotation. */
export function accentForSpec(spec: MotionSpec, extraSeed = ''): string {
  if (spec.accent && /^#[0-9a-fA-F]{3,8}$/.test(spec.accent)) return spec.accent;
  const text = `${specSeedText(spec)} ${extraSeed}`;
  const topical = TOPIC_ACCENTS.find((entry) => entry.pattern.test(text));
  if (topical) return topical.accent;
  if (KIND_ACCENTS[spec.kind]) return KIND_ACCENTS[spec.kind] as string;
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return ACCENT_ROTATION[hash % ACCENT_ROTATION.length];
}

/** A visually opposing accent — used for the right column of comparisons so the two sides read as genuinely different. */
export function contrastAccent(accent: string): string {
  const pairs: Record<string, string> = {
    '#3B82F6': '#F59E0B', '#06B6D4': '#F472B6', '#10B981': '#F43F5E', '#F59E0B': '#3B82F6',
    '#8B5CF6': '#22D3EE', '#14B8A6': '#FB7185', '#2DD4BF': '#F59E0B', '#38BDF8': '#FBBF24',
    '#84CC16': '#8B5CF6', '#F43F5E': '#10B981', '#F472B6': '#06B6D4',
  };
  return pairs[accent.toUpperCase()] || pairs[accent] || '#F59E0B';
}

/** A text_reveal spec derived from a scene's overlay copy (the text_overlay scene type). */
export function specFromOverlay(overlay: { text?: string; subtext?: string } | null | undefined, description = ''): MotionSpec {
  const title = str(overlay?.text || '', 110) || str(description.split(/[.!?]/)[0] || '', 110);
  return { kind: 'text_reveal', title, subtitle: str(overlay?.subtext || '', 160) || undefined, items: [] };
}

/**
 * Stable fingerprint of a spec, stored in the scene's video_prompt column when
 * a motion-graphic capture lands. A scene whose fingerprint matches its stored
 * clip is settled; editing the spec changes the fingerprint and the clip is
 * re-captured — never silently reused for different content.
 */
export function motionFingerprint(spec: MotionSpec): string {
  const ordered = JSON.stringify(spec, Object.keys(spec as Record<string, unknown>).sort());
  let hash = 5381;
  for (let i = 0; i < ordered.length; i += 1) hash = ((hash << 5) + hash + ordered.charCodeAt(i)) >>> 0;
  return `mg:${hash.toString(36)}:${ordered.length.toString(36)}`;
}

export const isMotionFingerprint = (value?: string | null) => String(value || '').startsWith('mg:');

export const MOTION_KINDS: { id: MotionKind; label: string; detail: string }[] = [
  { id: 'branching_diagram', label: 'Branching diagram', detail: 'One root fanning out to branches' },
  { id: 'flowchart', label: 'Flowchart', detail: 'Steps joined by drawn arrows' },
  { id: 'timeline', label: 'Timeline', detail: 'Dated beats along a line' },
  { id: 'comparison', label: 'Comparison', detail: 'Two columns side by side' },
  { id: 'list_reveal', label: 'List reveal', detail: 'Headline + staggered bullets' },
  { id: 'big_stat', label: 'Big stat', detail: 'A number counting up' },
  { id: 'bar_chart', label: 'Bar chart', detail: 'Bars growing to exact values' },
  { id: 'node_graph', label: 'Node graph', detail: 'Connected nodes / relationships' },
  { id: 'annotated_image', label: 'Annotated image', detail: 'A still with drawn callouts' },
  { id: 'text_reveal', label: 'Text reveal', detail: 'Pure animated headline' },
];

/** Short human summary for scene cards. */
export function specSummary(spec?: MotionSpec | null): string {
  if (!spec) return 'motion graphic';
  const meta = MOTION_KINDS.find((kind) => kind.id === spec.kind);
  const head = spec.title || spec.root || spec.stat?.label || spec.items[0]?.label || '';
  return [meta?.label || spec.kind, head].filter(Boolean).join(' · ').slice(0, 90);
}
