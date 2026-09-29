/**
 * RiveSlotView — “play this moment with Rive if a .riv is configured,
 * otherwise keep the LightBeam animation”.
 *
 * This is the component app code should reach for. Wrap the existing
 * LightBeam element as `children`; it stays the live implementation until the
 * founder points the slot at a .riv file, and comes straight back if that
 * file ever fails to load.
 *
 *   <RiveSlotView slot='pipeline' numberValue={activeStage} height={220}>
 *     <LightBeamPipeline activeStage={activeStage} stages={STAGES} />
 *   </RiveSlotView>
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import RiveSurface from './RiveSurface';
import type { RiveStatus } from './RiveSurface';
import { useRiveSlotConfig } from './riveSlots';
import type { RiveSlotId } from './riveSlots';

export interface RiveSlotViewProps {
  slot: RiveSlotId;
  /** The LightBeam fallback. Shown until Rive is ready, and forever if it fails. */
  children?: ReactNode;
  /** Value for the slot's configured Number input (stage index, 0–100 progress). */
  numberValue?: number;
  /** Value for the slot's configured Boolean input (e.g. isWorking). */
  booleanValue?: boolean;
  /** Change this to fire the slot's configured Trigger input. */
  triggerKey?: string | number;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export default function RiveSlotView({
  slot, children, numberValue, booleanValue, triggerKey,
  width, height, className, style, ariaLabel,
}: RiveSlotViewProps) {
  const config = useRiveSlotConfig(slot);
  const [status, setStatus] = useState<RiveStatus>('loading');

  // A new file gets a fresh chance, even if the previous one failed.
  useEffect(() => { setStatus('loading'); }, [config?.src]);

  // The dormant path must still honour className/style, otherwise wrapping an
  // element in a slot would silently drop its spacing everywhere a .riv is
  // not configured — which is the default state.
  const live = Boolean(config) && status !== 'failed';

  return (
    <div
      className={className}
      style={live ? { position: 'relative', width: width ?? '100%', ...style } : style}
    >
      {/* The LightBeam layer holds the space until Rive paints its first frame. */}
      {!live || status !== 'ready' ? children : null}
      {live && config ? (
        <div style={status === 'ready' ? undefined : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
          <RiveSurface
            src={config.src}
            stateMachine={config.stateMachine}
            numberInput={config.numberInput}
            numberValue={numberValue}
            booleanInput={config.booleanInput}
            booleanValue={booleanValue}
            triggerInput={config.triggerInput}
            triggerKey={triggerKey}
            width='100%'
            height={height ?? 160}
            ariaLabel={ariaLabel}
            onStatus={setStatus}
          />
        </div>
      ) : null}
    </div>
  );
}
