/**
 * The 12 UI motion ops. Each ends pixel-identical to the source crop via
 * PLATE MATCHING: the analyse stage samples a 4px inset ring around the
 * region; if the ring is uniform (≤6% luminance variance) its colour becomes
 * the op's plate, and the plate dissolves out over the op's final 6 frames so
 * the true pixels return. If the ring varies more, the planner must SKIP the
 * op and fall back to the highlight accent — that rule is enforced in
 * src/plan/validate.ts, not here.
 *
 * BUDGET (also enforced by the validator): max 2 UI ops per scene with no
 * time overlap; a cursor-accent scene fires exactly 1 UI op after the click;
 * no UI op repeats more than twice across the full video.
 */
import { countUp } from './countUp';
import { chartDraw } from './chartDraw';
import { listStagger } from './listStagger';
import { skeleton } from './skeleton';
import { typeIn } from './typeIn';
import { progressFill } from './progressFill';
import { toggleFlip } from './toggleFlip';
import { statusFlip } from './statusFlip';
import { notify } from './notify';
import { badgePop } from './badgePop';
import { tabSlide } from './tabSlide';
import { ripple } from './ripple';

export const UI_OPS = {
  countUp, chartDraw, listStagger, skeleton, typeIn, progressFill,
  toggleFlip, statusFlip, notify, badgePop, tabSlide, ripple,
} as const;

/** Region roles each op may attach to (plan validation). */
export const UI_OP_ROLES: Record<string, string[] | null> = {
  countUp: ['metric'],
  chartDraw: ['media', 'panel', 'chart'],
  listStagger: ['row', 'card', 'list', 'table'],
  skeleton: null, // any region
  typeIn: ['headline', 'form'],
  progressFill: ['metric', 'panel'],
  toggleFlip: ['row'],
  statusFlip: ['row', 'card', 'badge'],
  notify: null, // frame-anchored
  badgePop: ['nav', 'row'],
  tabSlide: ['nav'],
  ripple: ['cta'],
};

export { countUp, chartDraw, listStagger, skeleton, typeIn, progressFill, toggleFlip, statusFlip, notify, badgePop, tabSlide, ripple };
