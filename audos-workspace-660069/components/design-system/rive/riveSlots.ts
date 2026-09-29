/**
 * The Rive slot registry.
 *
 * A "slot" is a named moment in the UI that can be played by a .riv file
 * instead of its built-in CSS/SVG LightBeam animation. Slots start EMPTY:
 * until the founder points one at an uploaded .riv, the LightBeam layer is
 * the live implementation and no Rive runtime is downloaded at all.
 *
 * SceneForge persists its map on `sceneforge_settings.rive_assets` and calls
 * `setRiveSlots()` once settings load, so the configuration follows the
 * workspace rather than the browser.
 */
import { useSyncExternalStore } from 'react';

export type RiveSlotId =
  | 'hero'        // the SceneForge entry screen mark
  | 'pipeline'    // the production pipeline
  | 'render'      // final assembly
  | 'complete'    // the film is ready
  | 'loader'      // indeterminate waits
  | 'processing'; // sustained scene production

export interface RiveSlotConfig {
  /** Public URL of a .riv file (uploaded through /api/upload/file). */
  src: string;
  /** Defaults to Rive's own 'State Machine 1' when omitted. */
  stateMachine?: string;
  numberInput?: string;
  booleanInput?: string;
  triggerInput?: string;
}

export type RiveSlotMap = Partial<Record<RiveSlotId, RiveSlotConfig>>;

/** The slots the settings screen offers, in the order a customer meets them. */
export const RIVE_SLOTS: { id: RiveSlotId; label: string; hint: string }[] = [
  { id: 'hero', label: 'Entry screen', hint: 'The mark on “What should Verger explain?”. Plays idle, and speeds up while the research agent is working.' },
  { id: 'pipeline', label: 'Production pipeline', hint: 'The stage tracker. Receives the active stage index on its Number input.' },
  { id: 'processing', label: 'Scene production', hint: 'Plays while supporting scenes are being generated. Receives 0–100 progress on its Number input.' },
  { id: 'render', label: 'Final assembly', hint: 'Plays during the final render. Receives 0–100 progress on its Number input.' },
  { id: 'complete', label: 'Film ready', hint: 'One-shot celebration when the finished film lands. Fires its Trigger input.' },
  { id: 'loader', label: 'Waiting states', hint: 'Replaces the beam loader on every “working…” screen.' },
];

let slots: RiveSlotMap = {};
const listeners = new Set<() => void>();

function emit() { listeners.forEach((listener) => listener()); }

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Replace the whole map (called once when the app's settings load). */
export function setRiveSlots(next: RiveSlotMap | null | undefined): void {
  slots = normalizeRiveSlots(next);
  emit();
}

export function getRiveSlots(): RiveSlotMap { return slots; }

export function getRiveSlot(id: RiveSlotId): RiveSlotConfig | null {
  const found = slots[id];
  return found && found.src ? found : null;
}

/** Subscribe a component to the map. */
export function useRiveSlots(): RiveSlotMap {
  return useSyncExternalStore(subscribe, getRiveSlots, getRiveSlots);
}

/** Read one slot reactively; null means “use the LightBeam layer”. */
export function useRiveSlotConfig(id: RiveSlotId): RiveSlotConfig | null {
  const map = useRiveSlots();
  const found = map[id];
  return found && found.src ? found : null;
}

const SLOT_IDS = RIVE_SLOTS.map((slot) => slot.id);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Coerce whatever came back from the settings row into a safe map. Anything
 * malformed is dropped rather than thrown — a bad value in one slot must not
 * stop the app from opening.
 */
export function normalizeRiveSlots(raw: unknown): RiveSlotMap {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: RiveSlotMap = {};
  for (const id of SLOT_IDS) {
    const entry = source[id];
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const src = text(record.src);
    if (!src || !/^https?:\/\//i.test(src)) continue;
    out[id] = {
      src,
      stateMachine: text(record.stateMachine),
      numberInput: text(record.numberInput),
      booleanInput: text(record.booleanInput),
      triggerInput: text(record.triggerInput),
    };
  }
  return out;
}

/** Strip empties so the stored JSON stays small and readable. */
export function serializeRiveSlots(map: RiveSlotMap): Record<string, RiveSlotConfig> {
  const out: Record<string, RiveSlotConfig> = {};
  for (const id of SLOT_IDS) {
    const entry = map[id];
    if (!entry || !entry.src) continue;
    out[id] = {
      src: entry.src,
      ...(entry.stateMachine ? { stateMachine: entry.stateMachine } : {}),
      ...(entry.numberInput ? { numberInput: entry.numberInput } : {}),
      ...(entry.booleanInput ? { booleanInput: entry.booleanInput } : {}),
      ...(entry.triggerInput ? { triggerInput: entry.triggerInput } : {}),
    };
  }
  return out;
}
