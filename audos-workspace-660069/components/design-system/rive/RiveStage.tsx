/**
 * RiveStage — the real Rive renderer (platform `rive-animation` integration).
 *
 * `@rive-app/react-canvas` is loaded with a RUNTIME dynamic import, never a
 * static one, and that is load-bearing rather than stylistic. The space
 * compiles to ONE ES module, and a static bare import anywhere in the graph
 * is hoisted to the top of that module even when the only thing that reaches
 * it is a React.lazy() boundary. The Rive runtime then has to be fetched and
 * evaluated from the CDN before a single line of React runs, on every page
 * load, for every visitor — and if that one response fails the whole space
 * renders a blank page that no error boundary can catch. A dynamic import
 * stays dynamic, which is what makes this module's promise true in the
 * published bundle: a space with no .riv files configured never downloads
 * the runtime.
 *
 * Keep the bare specifier. It resolves through the page's import map to a
 * build that shares the host React 18 instance, which is what lets Rive's
 * hooks run inside this tree; an esm.sh URL would load a second React.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/** Rive's own default when a designer does not rename the machine. */
export const DEFAULT_STATE_MACHINE = 'State Machine 1';

export interface RiveStageProps {
  /** Public URL of a .riv file. */
  src: string;
  stateMachine?: string;
  /** Name of a Number input to drive (e.g. an active-stage index). */
  numberInput?: string;
  numberValue?: number;
  /** Name of a Boolean input to drive (e.g. isWorking). */
  booleanInput?: string;
  booleanValue?: boolean;
  /** Name of a Trigger input; fires whenever `triggerKey` changes. */
  triggerInput?: string;
  triggerKey?: string | number;
  /** A canvas with no size renders blank, so both are always set. */
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** Called once the runtime reports the file loaded. */
  onReady?: () => void;
  /** Called when the Rive runtime itself could not be loaded at all. */
  onFail?: () => void;
}

interface RiveRuntime {
  useRive: any;
  useStateMachineInput: any;
}

/** Fetched at most once per page and shared by every stage on it. */
let runtimeRequest: Promise<RiveRuntime> | null = null;

// MUST match the @rive-app/canvas runtime bundled by
// @rive-app/react-canvas@4.29.1, which is @rive-app/canvas@2.38.1.
const RIVE_WASM_URL = 'https://unpkg.com/@rive-app/canvas@2.38.1/rive.wasm';

/**
 * REQUIRED, once. Rive downloads a separate rive.wasm the first time a canvas
 * mounts; if that URL does not resolve the canvas stays blank with no error.
 *
 * The pinned react-canvas build does NOT re-export `RuntimeLoader`, so reading
 * it straight off that namespace throws on undefined. Fall back to the canvas
 * runtime, where it lives on the default export. Pinning is best-effort either
 * way: a miss must never reject, or every stage would report total failure over
 * a .wasm URL the runtime can still resolve on its own.
 */
async function pinRiveWasmUrl(reactCanvas: any): Promise<void> {
  try {
    let loader: any = reactCanvas?.RuntimeLoader;
    if (!loader?.setWasmUrl) {
      const canvas: any = await import('@rive-app/canvas');
      loader = (canvas?.default ?? canvas)?.RuntimeLoader;
    }
    loader?.setWasmUrl?.(RIVE_WASM_URL);
  } catch (error) {
    console.warn('[Rive] could not pin the rive.wasm URL', error);
  }
}

function loadRiveRuntime(): Promise<RiveRuntime> {
  if (!runtimeRequest) {
    runtimeRequest = import('@rive-app/react-canvas').then(async (mod: any) => {
      await pinRiveWasmUrl(mod);
      if (typeof mod?.useRive !== 'function' || typeof mod?.useStateMachineInput !== 'function') {
        throw new Error('@rive-app/react-canvas did not provide the hooks this stage needs');
      }
      return { useRive: mod.useRive, useStateMachineInput: mod.useStateMachineInput };
    });
  }
  return runtimeRequest;
}

// useStateMachineInput must be called unconditionally. A name that does not
// exist simply returns null, which is the documented behaviour, so an unused
// slot passes this sentinel instead of branching on the hook.
const NO_INPUT = '__vidverge_unused_input__';

/**
 * The canvas itself. Mounted only once the runtime has resolved, so the Rive
 * hooks below are always available and always called in the same order.
 */
function RiveCanvas({
  runtime, src, stateMachine, numberInput, numberValue, booleanInput, booleanValue,
  triggerInput, triggerKey, width = '100%', height = 160, className, style, ariaLabel, onReady,
}: RiveStageProps & { runtime: RiveRuntime }) {
  const machine = stateMachine || DEFAULT_STATE_MACHINE;
  const { rive, RiveComponent } = runtime.useRive({ src, stateMachines: machine, autoplay: true });

  const numeric = runtime.useStateMachineInput(rive, machine, numberInput || NO_INPUT);
  const boolean = runtime.useStateMachineInput(rive, machine, booleanInput || NO_INPUT);
  const trigger = runtime.useStateMachineInput(rive, machine, triggerInput || NO_INPUT);

  useEffect(() => { if (rive && onReady) onReady(); }, [rive, onReady]);
  useEffect(() => { if (numeric && typeof numberValue === 'number') numeric.value = numberValue; }, [numeric, numberValue]);
  useEffect(() => { if (boolean && typeof booleanValue === 'boolean') boolean.value = booleanValue; }, [boolean, booleanValue]);

  // Skip the mount pass so opening a screen does not immediately fire a
  // one-shot animation the customer never asked for.
  const armed = useRef(false);
  useEffect(() => {
    if (!armed.current) { armed.current = true; return; }
    if (trigger && typeof trigger.fire === 'function') trigger.fire();
  }, [triggerKey, trigger]);

  return (
    <RiveComponent
      className={className}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      style={{ width, height, display: 'block', ...style }}
    />
  );
}

export default function RiveStage({ onFail, ...stage }: RiveStageProps) {
  const [runtime, setRuntime] = useState<RiveRuntime | null>(null);
  const onFailRef = useRef<(() => void) | undefined>(onFail);
  const reportedFailure = useRef(false);

  useEffect(() => { onFailRef.current = onFail; }, [onFail]);

  useEffect(() => {
    let alive = true;
    loadRiveRuntime().then(
      (mod) => { if (alive) setRuntime(mod); },
      (error) => {
        console.warn('[Rive] runtime could not be loaded — keeping the built-in LightBeam layer:', error);
        if (!alive || reportedFailure.current) return;
        reportedFailure.current = true;
        onFailRef.current?.();
      },
    );
    return () => { alive = false; };
  }, []);

  // Nothing to paint until the runtime lands. The caller is still showing its
  // LightBeam layer, so this is a hand-off rather than a gap.
  if (!runtime) return null;

  return <RiveCanvas runtime={runtime} {...stage} />;
}
