/**
 * VOX 3-LAYER SYSTEM — Documentary only. Do not enable for other styles
 * without founder approval.
 *
 * A composition surface with real depth rather than a flat preview pane.
 * Three stacked layers inside one container that matches the chosen aspect
 * ratio, and nothing about the film's own grammar changes because of it —
 * narration, beats and the rendered MP4 are untouched.
 *
 *   Layer 1 (z-0)  Background. The Seedance 2.0 img-to-vid plate, playing
 *                  muted and looping, full-bleed. Falls back to the still it
 *                  was generated from when motion is unavailable.
 *   Layer 2 (z-10) Midground annotations on a perspective plane — chapter
 *                  label, data callout, pull-quote keywords. Pushed toward
 *                  the viewer with translateZ and given a slow, small tilt so
 *                  the plane reads as floating rather than pasted on.
 *   Layer 3 (z-20) Foreground. Gradient vignettes framing the top and bottom
 *                  edges, the caption pill, and the generation status row.
 *
 * The tilt is time-driven and respects prefers-reduced-motion; the whole
 * animation loop stops when nothing is on screen to move.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { AspectId, DepthBackground } from '../types/editorial';
import { aspectOf } from '../lib/facelessOptions';

export interface DepthAnnotation {
  id: string;
  /** Small uppercase chapter label above the callout. */
  label: string;
  /** The callout itself — a pull-quote keyword or a data point. */
  value: string;
  /** Optional supporting line under the callout. */
  detail?: string;
}

export interface DepthStageProps {
  aspect: AspectId;
  background: DepthBackground | null;
  annotations: DepthAnnotation[];
  /** Which annotation is on screen. Changing it replays the entrance. */
  activeIndex: number;
  caption?: string | null;
  captionsEnabled?: boolean;
  /** Rendered into Layer 3: the generation progress indicator. */
  status?: ReactNode;
}

/** Degrees of tilt at the extremes. Small enough to feel like depth, not like a gimmick. */
const TILT_DEGREES = 2.4;
const TILT_PERIOD_MS = 14000;

/** The plane's resting position: pushed toward the viewer, square to the camera. */
const BASE_TRANSFORM = 'perspective(800px) translateZ(20px)';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

/**
 * A slow sine on each axis, written straight onto the node's transform rather
 * than through state. Sixty React renders a second for a two-degree tilt
 * would cost more than the effect is worth, and this subtree sits inside a
 * screen that is already re-rendering on a poll.
 */
function useTiltTransform(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (!active) {
      node.style.transform = BASE_TRANSFORM;
      return undefined;
    }
    let frame = 0;
    const started = Date.now();
    const step = () => {
      const phase = ((Date.now() - started) % TILT_PERIOD_MS) / TILT_PERIOD_MS;
      const angle = phase * Math.PI * 2;
      const x = (Math.sin(angle) * TILT_DEGREES * 0.6).toFixed(3);
      const y = (Math.cos(angle * 0.7) * TILT_DEGREES).toFixed(3);
      node.style.transform = `${BASE_TRANSFORM} rotateX(${x}deg) rotateY(${y}deg)`;
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return ref;
}

/** Replays the scale-up and fade whenever the active annotation changes. */
function useEntrance(key: string): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    const timer = window.setTimeout(() => setEntered(true), 24);
    return () => window.clearTimeout(timer);
  }, [key]);
  return entered;
}

function BackgroundLayer({ background }: { background: DepthBackground | null }) {
  const fit: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };

  if (background?.videoUrl) {
    return (
      <video
        key={background.videoUrl}
        src={background.videoUrl}
        autoPlay
        loop
        muted
        playsInline
        poster={background.stillUrl || undefined}
        style={fit}
      />
    );
  }
  if (background?.stillUrl) {
    // Still plate: a very slow CSS drift keeps the layer from reading as dead
    // while Seedance is still working on the motion version.
    return <img src={background.stillUrl} alt="" style={{ ...fit, transform: 'scale(1.06)' }} />;
  }
  return (
    <div
      style={{
        ...fit,
        background:
          'radial-gradient(ellipse 70% 60% at 32% 24%, color-mix(in srgb, var(--space-brand-primary-500) 22%, transparent) 0%, rgba(0,0,0,0) 62%), var(--space-surface-muted, #0d1220)',
      }}
    />
  );
}

export default function DepthStage(props: DepthStageProps) {
  const shape = aspectOf(props.aspect);
  const reducedMotion = usePrefersReducedMotion();
  const annotation = props.annotations[props.activeIndex] || props.annotations[0] || null;
  const entered = useEntrance(annotation ? annotation.id : 'none');
  const midgroundRef = useTiltTransform(Boolean(annotation) && !reducedMotion);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        aspectRatio: shape.css,
        background: '#000',
        // The shared perspective root: both the midground plane and anything
        // nested inside it resolve their depth against this camera.
        perspective: '1000px',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Layer 1 — background, full-bleed */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <BackgroundLayer background={props.background} />
      </div>

      {/* Layer 2 — midground annotations on a floating perspective plane */}
      <div
        ref={midgroundRef}
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-[8%]"
        style={{
          zIndex: 10,
          transformStyle: 'preserve-3d',
          transform: BASE_TRANSFORM,
        }}
      >
        {annotation && (
          <div
            className="max-w-[86%] text-center"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? 'scale(1)' : 'scale(0.94)',
              transition: 'opacity 460ms ease-out, transform 460ms cubic-bezier(0.16, 1, 0.3, 1)',
              textShadow: '0 18px 48px rgba(0,0,0,0.72)',
            }}
          >
            {annotation.label && (
              <div
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.34em]"
                style={{ color: 'var(--space-brand-primary-500, #f59e0b)' }}
              >
                {annotation.label}
              </div>
            )}
            <div
              className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
              style={{ color: 'var(--space-text-primary, #f1f5f9)' }}
            >
              {annotation.value}
            </div>
            {annotation.detail && (
              <div
                className="mt-2 text-xs leading-relaxed"
                style={{ color: 'color-mix(in srgb, var(--space-text-primary, #f1f5f9) 72%, transparent)' }}
              >
                {annotation.detail}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Layer 3 — foreground: vignette, caption pill, status */}
      <div className="pointer-events-none absolute inset-0" style={{ zIndex: 20 }}>
        <div
          className="absolute inset-x-0 top-0 h-[22%]"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0) 100%)' }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-[34%]"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0) 100%)' }}
        />

        {props.status && (
          <div className="pointer-events-auto absolute inset-x-0 top-0 flex justify-center p-3">{props.status}</div>
        )}

        {props.captionsEnabled && props.caption ? (
          <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
            <span
              className="max-w-[92%] rounded-xl px-3 py-1.5 text-center"
              style={{
                background: 'rgba(8,10,16,0.72)',
                color: '#ffffff',
                fontSize: 16,
                lineHeight: 1.38,
                backdropFilter: 'blur(6px)',
              }}
            >
              {props.caption}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
