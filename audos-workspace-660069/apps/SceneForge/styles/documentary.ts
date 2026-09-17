import type { ForgeStyle } from './registry';

export const documentary: ForgeStyle = {
  id: 'documentary',
  name: 'Documentary',
  description: 'Desaturated photography, film grain and patient Ken Burns movement.',
  preview: 'linear-gradient(135deg,#1F2933,#8D8478 58%,#D6CFC4)',
  palette: ['#1F2933', '#8D8478', '#D6CFC4', '#F2EEE8', '#B44C43'],
  fonts: ['Libre Baskerville', 'Inter'],
  imagePromptPrefix: 'Desaturated archival documentary photography, natural available light, subtle 35mm grain, restrained contrast, transparent isolated subject when possible, no text,',
  motion: { easing: 'ease-in-out', enterFrames: 24, exitFrames: 18, transition: 'slow dissolve with Ken Burns drift' },
  componentTemplate: 'Use slow 103% Ken Burns scale, gentle pan, multiply film grain, soft dissolves and restrained serif title cards.',
};
