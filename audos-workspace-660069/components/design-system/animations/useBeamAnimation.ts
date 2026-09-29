/**
 * VidVerge LightBeam — shared animation hooks.
 *
 *   useBeamStyles()    injects the keyframe sheet once per document
 *   useBeamAnimation() drives a ONE-SHOT beam (hover, click, route change)
 *   useRiveSlot()      the dormant Rive slot every component exposes
 *
 * A dormant card must be completely still, so one-shot beams are driven by a
 * run counter rather than a CSS `:hover` animation that would restart on
 * every pointer move.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BEAM_KEYFRAMES, BEAM_STYLE_ID, GLOBAL_RESET_CSS } from './beamKeyframes';
import RiveSurface from '../rive/RiveSurface';

let stylesInjected = false;

/** Inject the LightBeam keyframes + Shell surface rules once per document. */
export function useBeamStyles(): void {
  useEffect(() => {
    if (stylesInjected || typeof document === 'undefined') return;
    if (document.getElementById(BEAM_STYLE_ID)) { stylesInjected = true; return; }
    const el = document.createElement('style');
    el.id = BEAM_STYLE_ID;
    el.textContent = BEAM_KEYFRAMES + GLOBAL_RESET_CSS;
    document.head.appendChild(el);
    stylesInjected = true;
  }, []);
}

export interface BeamAnimationOptions {
  /** Length of one pass, in ms. */
  durationMs?: number;
  /** Fire a pass as soon as the component mounts. */
  autoStart?: boolean;
}

export interface BeamAnimationState {
  /** Changes on every pass — use it as the React `key` so the beam restarts. */
  runId: number;
  /** True only while a pass is in flight; false means render nothing. */
  running: boolean;
  /** Start a pass. Ignored while one is already travelling. */
  trigger: () => void;
  /** Start a pass, cutting any pass already in flight (used on click). */
  restart: () => void;
}

/**
 * One-shot beam driver. `trigger()` is deliberately a no-op while a pass is
 * running: continued hover must not loop the beam.
 */
export function useBeamAnimation(options: BeamAnimationOptions = {}): BeamAnimationState {
  const durationMs = options.durationMs ?? 500;
  const [runId, setRunId] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const begin = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setRunId((n) => n + 1);
    setRunning(true);
    timer.current = setTimeout(() => { if (alive.current) setRunning(false); }, durationMs);
  }, [durationMs]);

  const trigger = useCallback(() => { if (!running) begin(); }, [running, begin]);

  useEffect(() => {
    if (options.autoStart) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { runId, running, trigger, restart: begin };
}

export interface RiveSlot {
  /** A ready-to-render Rive component, or null when this slot is dormant. */
  Rive: any | null;
  /** True when the CSS layer must step aside for Rive. */
  active: boolean;
}

/**
 * The per-component Rive slot.
 *
 * Without a `riveSrc` this costs nothing: no network request, no runtime, and
 * the component's CSS/SVG layer stays the live animation. Hand it a `.riv`
 * file and the Rive runtime is lazily loaded (see rive/RiveSurface) and the
 * CSS layer steps aside — but only while Rive is healthy. If the file or the
 * runtime fails, `active` goes back to false and the LightBeam layer returns,
 * so a broken .riv can never leave a blank rectangle behind.
 */
export function useRiveSlot(riveSrc?: string): RiveSlot {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [riveSrc]);

  const Rive = useMemo(() => {
    if (!riveSrc || failed) return null;
    return (props: Record<string, unknown>) => createElement(RiveSurface, {
      ...props,
      onStatus: (status: string) => { if (status === 'failed') setFailed(true); },
    } as any);
  }, [riveSrc, failed]);

  return { Rive, active: !!riveSrc && !failed };
}

/** Staggered delays for the multi-row beams in LightBeamProcessing. */
export function staggerDelays(rows: number, stepMs = 120): string[] {
  return Array.from({ length: Math.max(1, rows) }, (_, i) => `${i * stepMs}ms`);
}

export default useBeamAnimation;
