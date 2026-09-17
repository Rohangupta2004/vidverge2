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
