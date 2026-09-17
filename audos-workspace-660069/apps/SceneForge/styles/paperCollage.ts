import type { ForgeStyle } from './registry';

export const paperCollage: ForgeStyle = {
  id: 'paper-collage',
  name: 'Paper collage',
  description: 'Torn paper, hand-drawn marks and warm layered editorial texture.',
  preview: 'linear-gradient(135deg,#E9DFC8,#E2725B 52%,#1E1A16)',
  palette: ['#E9DFC8', '#E2725B', '#1E1A16', '#C59B36', '#F4F2EE'],
  fonts: ['Libre Baskerville', 'Inter', 'Courier New'],
  imagePromptPrefix: 'Hand-cut editorial paper collage, torn white edges, halftone print, warm off-white paper, tactile drop shadows, transparent background, no generated text,',
  motion: { easing: 'steps(8,end)', enterFrames: 22, exitFrames: 10, transition: 'torn-paper wipe and stepped collage build' },
  componentTemplate: 'Posterize movement to 12fps, slide rigid cutouts back-to-front, add shallow parallax and grain, then hold as a living poster.',
};
