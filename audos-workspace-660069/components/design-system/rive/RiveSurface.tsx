/**
 * RiveSurface — the safe boundary around a Rive animation.
 *
 * Rive is an ENHANCEMENT, never a dependency: if the runtime fails to load,
 * the .riv URL 404s, or the WebAssembly binary is blocked, this component
 * reports failure and renders nothing, so the caller keeps showing its
 * built-in CSS/SVG LightBeam animation. A broken .riv must never leave a
 * blank rectangle where a loader used to be.
 *
 * The Rive runtime lives behind a lazy import, so a space with no .riv files
 * configured never downloads it.
 */
import { Component, Suspense, lazy } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { RiveStageProps } from './RiveStage';

const LazyRiveStage = lazy(() => import('./RiveStage'));

export type RiveStatus = 'loading' | 'ready' | 'failed';

export interface RiveSurfaceProps extends Omit<RiveStageProps, 'onReady' | 'onFail'> {
  /** Told 'ready' once the animation is live, 'failed' if anything went wrong. */
  onStatus?: (status: RiveStatus) => void;
}

interface BoundaryProps { children?: ReactNode; onFail: () => void }
interface BoundaryState { failed: boolean }

class RiveBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.warn('[Rive] animation could not render — falling back to the built-in LightBeam layer:', error);
    this.props.onFail();
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function RiveSurface({ onStatus, ...stage }: RiveSurfaceProps) {
  if (!stage.src) return null;
  return (
    <RiveBoundary onFail={() => onStatus?.('failed')}>
      <Suspense fallback={null}>
        <LazyRiveStage
          {...stage}
          onReady={() => onStatus?.('ready')}
          onFail={() => onStatus?.('failed')}
        />
      </Suspense>
    </RiveBoundary>
  );
}

/** Fills its positioned parent — the usual shape for an overlay slot. */
export const riveOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
};
