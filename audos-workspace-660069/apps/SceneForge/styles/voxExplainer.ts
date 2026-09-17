import type { ForgeStyle } from './registry';

export const voxExplainer: ForgeStyle = {
  id: 'vox-explainer',
  name: 'Vox-style explainer',
  description: 'Flat editorial vectors, bold colour, kinetic type and smooth pop-ins.',
  preview: 'linear-gradient(135deg,#F9C74F 0 34%,#F94144 34% 67%,#277DA1 67%)',
  palette: ['#F9C74F', '#F94144', '#277DA1', '#F7F3E8', '#171717'],
  fonts: ['Inter', 'Arial Black'],
  imagePromptPrefix: 'Flat editorial vector explainer artwork, strong geometric silhouettes, bold limited palette, crisp cut shapes, clean negative space, transparent background, no text,',
  motion: { easing: 'cubic-bezier(0.22,1,0.36,1)', enterFrames: 16, exitFrames: 10, transition: 'smooth pop and directional wipe' },
  componentTemplate: 'Layer transparent vector elements with spring pop-ins, 4% overshoot, kinetic labels authored in Remotion, and smooth directional wipes.',
};
