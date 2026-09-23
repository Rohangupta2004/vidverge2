import type { ForgeStyle } from './registry';

// THE PAPER-CUT LANGUAGE (Vox-style): a motion-designed magazine spread,
// never a filmed scene. Warm paper field, near-black ink, ONE
// highlighter-yellow accent, torn-edge cutouts seated by a two-shadow stack,
// halftone/newsprint texture, heavy display type, hard cuts. The motion
// engine renders this style with the 'papercut' theme (lib/motionKit) —
// palette DISCIPLINE is the point: 1 base + 1-2 accents, and colour means
// "look here" (only the answer element carries the accent).
export const voxExplainer: ForgeStyle = {
  id: 'vox-explainer',
  name: 'Vox-style explainer',
  description: 'Paper-cut editorial collage: warm paper, ink type, one highlighter-yellow accent, torn edges and halftone texture.',
  preview: 'linear-gradient(135deg,#F2EDE4 0 55%,#FFEB00 55% 82%,#1A1A1A 82%)',
  palette: ['#F2EDE4', '#1A1A1A', '#FFEB00', '#E4572E', '#C9C2B6'],
  fonts: ['Archivo Black', 'Work Sans'],
  imagePromptPrefix: 'Paper-cut editorial collage artwork, flat 2D shapes with torn paper edges, desaturated duotone photography pulled into a warm cream and ink palette, halftone newsprint texture, paper background, near-black ink, a single highlighter-yellow accent, handcrafted magazine-spread look, no text,',
  motion: { easing: 'back.out(1.4)', enterFrames: 14, exitFrames: 8, transition: 'hard cut with the energy on the incoming element' },
  componentTemplate: 'Stack flat paper cutouts with torn edges and a two-shadow stack on a warm paper field; entrances scale in place 90% to 100% with back.out(1.4); one highlighter sweep behind the key phrase per scene, landing just after the words settle; hard cuts, never dissolves.',
};
