/**
 * The 12 camera ops. Bed ops (exactly one per scene): push, pan, scrollSim,
 * deviceTilt. Accent ops (0–2 per scene): focus, lift, parallax, cursor,
 * highlight, callout, maskWipe, compare.
 *
 * Every op is a self-contained pure frame→transform function so the
 * composition assembler can embed it verbatim with Function.prototype.toString.
 */
import { push } from './push';
import { pan } from './pan';
import { scrollSim } from './scrollSim';
import { deviceTilt } from './deviceTilt';
import { focus } from './focus';
import { lift } from './lift';
import { parallax } from './parallax';
import { cursor } from './cursor';
import { highlight } from './highlight';
import { callout } from './callout';
import { maskWipe } from './maskWipe';
import { compare } from './compare';

export const BED_OPS = { push, pan, scrollSim, deviceTilt } as const;
export const ACCENT_OPS = { focus, lift, parallax, cursor, highlight, callout, maskWipe, compare } as const;
export const CAMERA_OPS = { ...BED_OPS, ...ACCENT_OPS } as const;
export { push, pan, scrollSim, deviceTilt, focus, lift, parallax, cursor, highlight, callout, maskWipe, compare };
