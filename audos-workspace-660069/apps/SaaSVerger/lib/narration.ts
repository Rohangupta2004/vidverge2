import type { ScreenKey, ScriptAct, VisualAsset, VisualMatch } from '../types';

export const MISSING_VISUAL_WARNING_EN = 'No relevant visual found for this scene. Please upload a screenshot or image.';
export const MISSING_VISUAL_WARNING_HI = 'Is scene ke liye koi relevant visual nahi mila. Ek screenshot ya image upload karein.';
export const OVERLAY_NARRATION_NOTICE = 'Voice generation is unavailable right now, so each scene keeps its narration as a burned-in on-screen text overlay instead.';

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  screen1: 'Workspace screen',
  screen2: 'Automation screen',
  screen3: 'Analytics screen',
  cta: 'Closing CTA',
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'yours', 'that', 'this', 'these', 'those', 'from', 'into', 'onto', 'out',
  'are', 'was', 'were', 'will', 'would', 'could', 'should', 'can', 'not', 'but', 'all', 'any', 'our', 'ours', 'their',
  'has', 'have', 'had', 'get', 'got', 'who', 'how', 'why', 'what', 'when', 'where', 'which', 'while', 'then', 'than',
  'they', 'them', 'there', 'here', 'just', 'like', 'more', 'most', 'much', 'very', 'even', 'also', 'its', 'it', 'his',
  'her', 'him', 'she', 'one', 'two', 'now', 'new', 'own', 'off', 'per', 'via', 'yet', 'about', 'after', 'again',
  'because', 'been', 'before', 'being', 'between', 'both', 'does', 'doing', 'done', 'each', 'every', 'few', 'over',
  'same', 'some', 'such', 'take', 'takes', 'thing', 'things', 'through', 'under', 'until', 'upon',
  'use', 'used', 'uses', 'want', 'wants', 'way', 'ways', 'well', 'without', 'let', 'lets',
  'make', 'makes', 'made', 'need', 'needs', 'see', 'sees', 'say', 'says', 'know', 'knows', 'mp4', 'png', 'jpg', 'jpeg',
  'webp', 'mov', 'screenshot', 'screen', 'image', 'video', 'clip', 'shot', 'scene', 'final', 'copy', 'file', 'untitled',
]);

/** Lowercase word tokens with punctuation, stop words and very short words removed. */
export function tokenize(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

/** Most-repeated tokens first, ties resolved by where they first appear. */
export function extractKeywords(value: string, limit = 14): string[] {
  const counts = new Map<string, { count: number; first: number }>();
  tokenize(value).forEach((word, index) => {
    const entry = counts.get(word);
    if (entry) entry.count += 1;
    else counts.set(word, { count: 1, first: index });
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1].count - left[1].count || left[1].first - right[1].first)
    .slice(0, limit)
    .map(([word]) => word);
}

/** Crude singular/gerund folding so "dashboards" matches "dashboard". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ers')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function stripExtension(name: string): string {
  return String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Usable words supplied by the file name alone. Sparse names are candidates for visual auto-tagging. */
export function filenameKeywords(name: string): string[] {
  return extractKeywords(stripExtension(name), 14);
}

/** Everything searchable about an asset: its file name, its tags and its description. */
export function assetKeywords(asset: VisualAsset): string[] {
  return extractKeywords([stripExtension(asset.name), asset.tags, asset.description].join(' '), 30);
}

export function narrationKeywords(narration: string): string[] {
  return extractKeywords(narration, 12);
}

function scoreAsset(keywords: string[], asset: VisualAsset): VisualMatch {
  const assetStems = new Set(assetKeywords(asset).map(stem));
  const matched = keywords.filter((word) => assetStems.has(stem(word)));
  const denominator = Math.min(Math.max(keywords.length, 1), 6);
  return { asset, score: Math.min(1, matched.length / denominator), matched };
}

/** Top keyword matches for one scene's narration, best first. */
export function suggestVisuals(narration: string, assets: VisualAsset[], limit = 3): VisualMatch[] {
  const keywords = narrationKeywords(narration);
  if (!keywords.length) return [];
  return assets
    .map((asset) => scoreAsset(keywords, asset))
    .filter((match) => match.matched.length > 0)
    .sort((left, right) => right.score - left.score || right.matched.length - left.matched.length)
    .slice(0, limit);
}

export type SceneStatus = 'empty' | 'attached' | 'suggested' | 'missing';

export type SceneAnalysis = {
  index: number;
  narration: string;
  keywords: string[];
  suggestions: VisualMatch[];
  status: SceneStatus;
};

export type NarrationAnalysis = {
  scenes: SceneAnalysis[];
  /** Scenes with narration but nothing attached and nothing relevant found. */
  missingCount: number;
  /** Scenes with narration and a relevant match available, but nothing attached yet. */
  suggestedCount: number;
  /** Every scene with narration that has no visual attached. */
  withoutVisualCount: number;
  narratedCount: number;
};

export function analyzeScenes(acts: ScriptAct[], assets: VisualAsset[]): NarrationAnalysis {
  const scenes: SceneAnalysis[] = acts.map((act, index) => {
    const narration = String(act.narration ?? act.text ?? '').trim();
    const attached = Boolean(act.visual);
    const suggestions = attached || !narration ? [] : suggestVisuals(narration, assets);
    const status: SceneStatus = !narration ? 'empty' : attached ? 'attached' : suggestions.length ? 'suggested' : 'missing';
    return { index, narration, keywords: narrationKeywords(narration), suggestions, status };
  });
  return {
    scenes,
    missingCount: scenes.filter((scene) => scene.status === 'missing').length,
    suggestedCount: scenes.filter((scene) => scene.status === 'suggested').length,
    withoutVisualCount: scenes.filter((scene) => scene.status === 'missing' || scene.status === 'suggested').length,
    narratedCount: scenes.filter((scene) => scene.status !== 'empty').length,
  };
}

export function sceneCountLabel(count: number, noun = 'scene'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
