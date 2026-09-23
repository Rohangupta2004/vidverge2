import archived from './styles-archive.json';
import { voxExplainer } from './voxExplainer';
import { documentary } from './documentary';
import { mapAnimation } from './mapAnimation';
import { paperCollage } from './paperCollage';

export interface ForgeStyle {
  id: string;
  name: string;
  description: string;
  preview: string;
  palette: string[];
  fonts: string[];
  imagePromptPrefix: string;
  motion: { easing: string; enterFrames: number; exitFrames: number; transition: string };
  componentTemplate: string;
}

export type EditingPresetId = 'documentary' | 'vox_explainer' | 'cinematic' | 'educational' | 'product_demo' | 'social_reel' | 'talking_head' | 'minimal';
export interface EditingPreset {
  id: EditingPresetId;
  name: string;
  description: string;
  planningBias: { graphicDensity: string; bRollFrequency: string; textOverlayUsage: string; pacing: string };
}

/** Planning strategies, separate from visual skins. These bias scene selection
 * and pacing while STYLE_REGISTRY continues to own palette and typography. */
export const EDITING_PRESETS: EditingPreset[] = [
  { id: 'documentary', name: 'Documentary', description: 'Measured reporting with evidence-led B-roll and restrained graphics.', planningBias: { graphicDensity: 'medium; exact graphics for evidence and structure', bRollFrequency: 'medium-high; real places, actions and archival-feeling establishing shots', textOverlayUsage: 'low-medium; names, dates and short quotes only', pacing: 'patient 4–8 second beats with breathing room' } },
  { id: 'vox_explainer', name: 'Vox-style Explainer', description: 'Fast editorial rhythm, diagrams, maps and crisp on-presenter callouts.', planningBias: { graphicDensity: 'high; frequent charts, maps, comparisons and node diagrams', bRollFrequency: 'medium; use only when footage communicates better than a diagram', textOverlayUsage: 'high; concise labels and key-number callouts', pacing: 'brisk 2–5 second beats with purposeful pattern changes' } },
  { id: 'cinematic', name: 'Cinematic', description: 'Longer visual beats, composed AI footage and minimal typography.', planningBias: { graphicDensity: 'low', bRollFrequency: 'high; hero shots and visual continuity across sequences', textOverlayUsage: 'very low; title and CTA only', pacing: 'slow 5–10 second shots with motivated transitions' } },
  { id: 'educational', name: 'Educational', description: 'Stepwise teaching with legible diagrams, recap labels and moderate pacing.', planningBias: { graphicDensity: 'high; processes, definitions, lists and recaps', bRollFrequency: 'low-medium', textOverlayUsage: 'high; definitions and chapter cues', pacing: 'clear 4–7 second teaching beats; never outrun comprehension' } },
  { id: 'product_demo', name: 'Product Demo', description: 'Feature-proof pacing with UI/product focus and benefit callouts.', planningBias: { graphicDensity: 'medium-high; exact product labels and comparisons', bRollFrequency: 'medium; product-in-use footage', textOverlayUsage: 'high; feature and outcome labels', pacing: 'brisk setup → feature → proof → CTA progression' } },
  { id: 'social_reel', name: 'Social / Reel', description: 'Hook-first vertical pacing with frequent captions and visual changes.', planningBias: { graphicDensity: 'medium-high', bRollFrequency: 'high; rapid pattern interrupts', textOverlayUsage: 'very high; short safe-zone captions and punch lines', pacing: 'fast 1.5–4 second beats; strongest visual in the first seconds after the hook' } },
  { id: 'talking_head', name: 'Talking Head', description: 'Presenter-led edit with occasional supportive cutaways and labels.', planningBias: { graphicDensity: 'low', bRollFrequency: 'low', textOverlayUsage: 'medium; key phrases over the avatar', pacing: 'presenter-first; cut away only when the beat gains real clarity' } },
  { id: 'minimal', name: 'Minimal', description: 'Quiet edit with sparse visuals and almost no decoration.', planningBias: { graphicDensity: 'very low', bRollFrequency: 'low', textOverlayUsage: 'very low', pacing: 'calm, long holds; preserve negative space' } },
];
export const getEditingPreset = (id?: string) => EDITING_PRESETS.find((preset) => preset.id === id) || EDITING_PRESETS[0];

type ArchivedStyle = { name: string; look: string; colors: string[]; fonts: string[]; motionRules: string; promptTemplate: string };

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const archivedStyles: ForgeStyle[] = (archived as ArchivedStyle[]).map((style) => ({
  id: `archive-${slug(style.name)}`,
  name: style.name,
  description: style.look,
  preview: `linear-gradient(135deg,${style.colors.join(',')})`,
  palette: style.colors,
  fonts: style.fonts,
  imagePromptPrefix: `${style.promptTemplate} Isolated compositing element on a transparent background,`,
  motion: { easing: 'ease-out', enterFrames: 18, exitFrames: 12, transition: style.motionRules },
  componentTemplate: style.motionRules,
}));

export const STYLE_REGISTRY: ForgeStyle[] = [voxExplainer, documentary, mapAnimation, paperCollage, ...archivedStyles];
export const getStyle = (id?: string) => STYLE_REGISTRY.find((style) => style.id === id) || voxExplainer;
