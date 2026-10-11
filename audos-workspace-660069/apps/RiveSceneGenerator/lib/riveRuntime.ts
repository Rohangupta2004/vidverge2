// Rive Web Runtime wiring — the real @rive-app/canvas runtime, running live
// beside the canvas renderer and driven by the SAME step list from Opus.
//
// @rive-app/canvas is a platform-allowed import (see the rive-animation
// integration), so it resolves to a pinned CDN build. Two things about HOW it
// is imported are load-bearing and must not be "tidied up":
//
//   * It must be a RUNTIME dynamic import, never a static bare one. The space
//     compiles to ONE ES module, so a static import is hoisted to the top of
//     that module and has to link before a single line of React runs. If it
//     cannot link, every app on the page renders blank and no error boundary
//     can catch it.
//   * The pinned build exposes Rive, RuntimeLoader, Layout, Fit and Alignment
//     as properties of its DEFAULT export, not as named exports, so
//     `import { Rive } from '@rive-app/canvas'` is exactly that unlinkable
//     import. Read them off the namespace instead.
//
// Everything here is defensive: a failed load, a missing state machine or an
// input the .riv does not define logs a warning and is skipped, never thrown.
// A .riv authored with the five state machines in lib/scenes.ts is driven for
// real; any other file still proves the runtime works and reports the inputs it
// actually exposes so they can be authored to match.

import type { InputKind } from './scenes';

// MUST match the @rive-app/canvas runtime version the platform pins.
const RIVE_WASM_URL = 'https://unpkg.com/@rive-app/canvas@2.38.1/rive.wasm';

/** A real, CORS-enabled Rive community file — the default proof-of-runtime. */
export const DEFAULT_RIV_URL = 'https://cdn.rive.app/animations/vehicles.riv';

export type RuntimeStatus = 'loading' | 'active' | 'unavailable';

export interface DiscoveredInput {
  name: string;
  kind: string;
}

export interface DiscoveredMachine {
  machine: string;
  inputs: DiscoveredInput[];
}

interface RiveApi {
  Rive: any;
  Layout: any;
  Fit: any;
  Alignment: any;
  RuntimeLoader?: any;
}

/** Fetched at most once per page and shared by every layer on it. */
let apiRequest: Promise<RiveApi | null> | null = null;

/** Resolves to the runtime classes, or to null if Rive is unusable here. */
function loadRiveApi(): Promise<RiveApi | null> {
  if (!apiRequest) {
    apiRequest = import('@rive-app/canvas').then(
      (mod: any) => {
        const api = mod?.default ?? mod;
        if (!api?.Rive || !api?.Layout || !api?.Fit || !api?.Alignment) {
          console.warn('[rive] runtime loaded without the expected classes — skipping Rive layers');
          return null;
        }
        // The #1 cause of a blank Rive canvas is this .wasm URL not resolving.
        try {
          api.RuntimeLoader?.setWasmUrl?.(RIVE_WASM_URL);
        } catch (e) {
          console.warn('[rive] could not set wasm url', e);
        }
        return api as RiveApi;
      },
      (e) => {
        console.warn('[rive] runtime could not be loaded', e);
        return null;
      },
    );
  }
  return apiRequest;
}

const INPUT_KIND_LABELS: Record<number, string> = { 56: 'number', 59: 'boolean', 58: 'trigger' };

function kindLabel(raw: unknown): string {
  if (typeof raw === 'string') return raw.toLowerCase();
  if (typeof raw === 'number' && INPUT_KIND_LABELS[raw]) return INPUT_KIND_LABELS[raw];
  return 'input';
}

export class RiveLayer {
  readonly url: string;
  canvas: HTMLCanvasElement;
  rive: any | null = null;
  loaded = false;
  failed = false;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** Inputs this layer applied vs skipped, for the UI's integration readout. */
  applied = 0;
  skipped = 0;
  private warned = new Set<string>();
  private disposed = false;

  constructor(url: string, w = 1280, h = 720) {
    this.url = url;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    // Resolves on a later tick, so the caller's onReady/onError assignments
    // always land before either one can fire.
    void loadRiveApi().then((api) => this.attach(api));
  }

  /** Put this layer's canvas on screen inside `container`. */
  mount(container: HTMLElement) {
    if (this.canvas.parentElement !== container) {
      container.innerHTML = '';
      container.appendChild(this.canvas);
    }
    try {
      this.rive?.resizeDrawingSurfaceToCanvas();
    } catch {
      /* noop */
    }
  }

  private fail(reason: unknown) {
    this.failed = true;
    const message = reason instanceof Error ? reason.message : String(reason);
    console.warn(`[rive] layer unavailable for ${this.url}`, reason);
    this.onError?.(message);
  }

  private attach(api: RiveApi | null) {
    if (this.disposed) return;
    if (!api) {
      this.fail('Rive runtime unavailable in this browser');
      return;
    }
    try {
      this.rive = new api.Rive({
        src: this.url,
        canvas: this.canvas,
        autoplay: true,
        layout: new api.Layout({ fit: api.Fit.Contain, alignment: api.Alignment.Center }),
        onLoad: () => {
          this.loaded = true;
          try {
            this.rive?.resizeDrawingSurfaceToCanvas();
          } catch {
            /* noop */
          }
          this.onReady?.();
        },
        onLoadError: (err: unknown) => this.fail(err),
      });
    } catch (e) {
      this.fail(e);
    }
  }

  /** Names of the state machines detected on the loaded artboard. */
  stateMachineNames(): string[] {
    try {
      return (this.rive?.stateMachineNames as string[]) || [];
    } catch {
      return [];
    }
  }

  /** Every state machine and input the loaded .riv actually exposes. */
  discover(): DiscoveredMachine[] {
    const out: DiscoveredMachine[] = [];
    for (const machine of this.stateMachineNames()) {
      let inputs: DiscoveredInput[] = [];
      try {
        inputs = ((this.rive?.stateMachineInputs(machine) as any[]) || []).map((i) => ({
          name: String(i?.name ?? ''),
          kind: kindLabel(i?.type),
        }));
      } catch {
        inputs = [];
      }
      out.push({ machine, inputs });
    }
    return out;
  }

  private inputHandle(name: string): any | null {
    if (!this.rive) return null;
    for (const sm of this.stateMachineNames()) {
      try {
        const inputs = this.rive.stateMachineInputs(sm) || [];
        const match = inputs.find((i: any) => i?.name === name);
        if (match) return match;
      } catch {
        /* try the next state machine */
      }
    }
    if (!this.warned.has(name)) {
      this.warned.add(name);
      console.warn(`[rive] input "${name}" not found on ${this.url} — skipping`);
    }
    return null;
  }

  /** Apply one plan step to the real .riv, by exact input name. */
  applyInput(name: string, kind: InputKind, value?: number | string | boolean) {
    if (!this.loaded) return;
    const handle = this.inputHandle(name);
    if (!handle) {
      this.skipped++;
      return;
    }
    try {
      if (kind === 'trigger') {
        handle.fire();
      } else if (kind === 'number') {
        handle.value = Number(value) || 0;
      } else {
        // Rive state machines have no string input; a text run is set through
        // the artboard's text API instead, which this file does not assume.
        this.skipped++;
        return;
      }
      this.applied++;
    } catch (e) {
      this.skipped++;
      console.warn(`[rive] could not apply input "${name}"`, e);
    }
  }

  reset() {
    this.applied = 0;
    this.skipped = 0;
    try {
      this.rive?.reset();
      this.rive?.play();
    } catch {
      /* noop */
    }
  }

  cleanup() {
    this.disposed = true;
    try {
      this.rive?.cleanup();
    } catch {
      /* noop */
    }
    this.rive = null;
  }
}
