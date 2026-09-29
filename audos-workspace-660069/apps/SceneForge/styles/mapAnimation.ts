import type { ForgeStyle } from './registry';

export const mapAnimation: ForgeStyle = {
  id: 'map-animation',
  name: 'Map animation',
  description: 'Illustrated topography, route zooms and precise marker drops.',
  preview: '#0b0d12 url("https://storage.googleapis.com/audos-images/generated-images/agent/workspace-660069/img-1790666772255-qam2gt.png") center/cover no-repeat',
  palette: ['#E8DFC8', '#7FA38A', '#305B50', '#D56D4C', '#24323A'],
  fonts: ['Inter', 'IBM Plex Mono'],
  imagePromptPrefix: 'Editorial illustrated map element, topographic contour lines, cartographic ink texture, warm parchment and forest palette, transparent background, no labels or text,',
  motion: { easing: 'cubic-bezier(0.4,0,0.2,1)', enterFrames: 18, exitFrames: 12, transition: 'route-follow zoom and marker drop' },
  componentTemplate: 'Animate routes with SVG strokeDashoffset, ease camera between bounds, spring markers from 1.25 scale, and keep labels separate in Remotion.',
};
