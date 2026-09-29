/**
 * ENGINE SELECTOR — shared UI for picking a video generation engine.
 *
 *  <EnginePicker>  compact grouped dropdown + tier badge + capability note.
 *                  Used by Product Video, SceneForge, Script-to-Video,
 *                  Video Enhancer and Ads Studio next to their generate
 *                  buttons. Kling entries render disabled with [Coming Soon].
 *                  Runway entries (optional) come from RUNWAY_MODELS: the ids
 *                  the platform proxy actually accepts are selectable and
 *                  carry a ⚡ on the fast ones; the ids it rejects with 400
 *                  (act_two, gen4_image, gen4_image_turbo) render disabled
 *                  with the reason, so the gap is visible instead of being a
 *                  dropdown entry that fails at submit.
 *
 * The full card grid lives in the Creatables app; this component stays small
 * so existing apps embed it without layout surgery.
 */
import { CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  GROUP_A_MODELS, IMAGE_MODELS, KLING_MODELS, KLING_COMING_SOON_MESSAGE, RUNWAY_MODELS,
  groupAModel, isKlingModel, runwayInputLabel, runwayModel, runwayVideoModel,
  subscribeRunwayCatalog, syncRunwayCatalog, tierColor, EngineTier,
} from '../lib/videoEngines';

/** Keep the Runway roster live: kick one capabilities sync on mount and
 * re-render whenever the catalog moves (a model was enabled or disabled
 * platform-side). The sync is cached and shared — mounting many pickers
 * costs one request. */
function useRunwayCatalog(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    void syncRunwayCatalog();
    return subscribeRunwayCatalog(() => bump((r) => r + 1));
  }, []);
}

/**
 * Engine selection that survives the component unmounting (a closed wizard,
 * a switched tab) for the rest of the browser session. Falls back to plain
 * state when sessionStorage is unavailable.
 */
export function usePersistentEngine(storageKey: string, defaultId: string): [string, (id: string) => void] {
  const key = `engine:${storageKey}`;
  const [value, setValue] = useState<string>(() => {
    try { return window.sessionStorage.getItem(key) || defaultId; } catch { return defaultId; }
  });
  const set = useCallback((id: string) => {
    setValue(id);
    try { window.sessionStorage.setItem(key, id); } catch { /* preference only */ }
  }, [key]);
  return [value, set];
}

export function EngineBadge({ tier, label, style }: { tier: EngineTier | 'Coming Soon' | 'Gated' | 'Unavailable'; label?: string; style?: CSSProperties }) {
  const c = tier === 'Coming Soon' || tier === 'Unavailable'
    ? { bg: 'rgba(148,163,184,0.18)', fg: '#94A3B8' }
    : tier === 'Gated'
      ? { bg: 'rgba(232,163,60,0.16)', fg: '#E8A33C' }
      : tierColor(tier);
  return (
    <span style={{ display: 'inline-block', background: c.bg, color: c.fg, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap', ...style }}>
      {label || tier}
    </span>
  );
}

export interface EnginePickerProps {
  /** Selected engine id (Group A model string, runway id, or kling id). */
  value: string;
  onChange: (id: string) => void;
  /** Restrict the Group A list ('all' = every model). */
  groupAIds?: string[] | 'all';
  /** Also list the Runway models (generation enabled — verified 28 Sep 2026). */
  includeRunway?: boolean;
  /** Which Runway entries to list: video models (default), the image entries
   * that resolve to Runway's image recipes, or both. */
  runwayKinds?: 'video' | 'image' | 'all';
  /** List Kling models as disabled [Coming Soon] entries (default true). */
  includeKling?: boolean;
  disabled?: boolean;
  label?: string;
  /** Extra note under the picker (e.g. the app's default-model reminder). */
  note?: string;
  style?: CSSProperties;
}

export function engineDisplayName(id: string): string {
  return groupAModel(id)?.name || runwayModel(id)?.label || runwayVideoModel(id)?.name
    || KLING_MODELS.find((k) => k.id === id)?.name || id;
}

export function EnginePicker(props: EnginePickerProps) {
  useRunwayCatalog();
  const groupA = props.groupAIds === 'all' || !props.groupAIds
    ? GROUP_A_MODELS
    : GROUP_A_MODELS.filter((m) => (props.groupAIds as string[]).includes(m.id));
  const includeKling = props.includeKling !== false;
  const runwayKinds = props.runwayKinds || 'video';
  const runway = RUNWAY_MODELS.filter((m) => runwayKinds === 'all' || m.type === runwayKinds);
  const selectedA = groupAModel(props.value);
  const selectedRunway = runwayModel(props.value);
  const selectedKling = isKlingModel(props.value);
  const tier: EngineTier | undefined = selectedA?.tier
    || (selectedRunway && selectedRunway.available
      ? (selectedRunway.speed === 'fast' ? 'Fast' : selectedRunway.type === 'image' ? 'Recipe' : 'Cinematic')
      : undefined);

  // Capability + comparison line (folded in from the retired Model Lab):
  // alongside the input rules, each model shows its clip ceiling and cost
  // hint so engines can be compared right inside the picker.
  const capabilityNote = selectedA
    ? [
        selectedA.supportsReferenceImages ? (selectedA.refsExclusiveWithSeed ? 'reference images (excl. seed/last frame)' : 'reference images + seed image') : 'single seed image only',
        selectedA.supportsLastFrame ? 'last-frame lock' : null,
        selectedA.supports4k ? '4K' : null,
        selectedA.supportsAudio ? 'audio' : null,
        `up to ${selectedA.maxDurationS}s`,
        selectedA.costHint,
      ].filter(Boolean).join(' · ')
    : selectedRunway
      ? (selectedRunway.available
        ? `${runwayInputLabel(selectedRunway)} · ${selectedRunway.blurb} · ${selectedRunway.priceNote}`
        : `${runwayInputLabel(selectedRunway)} · ${selectedRunway.unavailableReason || ''}`)
      : selectedKling ? KLING_COMING_SOON_MESSAGE : '';

  return (
    <div style={props.style}>
      {props.label ? (
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--space-text-muted, #94A3B8)', marginBottom: 6 }}>
          {props.label}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => {
            const id = e.target.value;
            // Disabled-option guard — some browsers still fire change for them.
            if (isKlingModel(id)) return;
            const rw = runwayModel(id);
            if (rw && !rw.available) return;
            props.onChange(id);
          }}
          style={{
            background: 'var(--space-surface-card, #10182A)', color: 'var(--space-text-primary, #F8FAFC)',
            border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))', borderRadius: 9,
            padding: '8px 10px', fontSize: 12.5, fontWeight: 600, cursor: props.disabled ? 'default' : 'pointer',
            maxWidth: '100%', minWidth: 0,
          }}
        >
          <optgroup label="Google / OpenAI / OpenRouter">
            {groupA.map((m) => (
              <option key={m.id} value={m.id}>{m.name} — {m.tier}</option>
            ))}
          </optgroup>
          {props.includeRunway ? (
            <optgroup label="Runway">
              {runway.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available}>
                  {m.speed === 'fast' ? '⚡ ' : ''}{m.label} · {runwayInputLabel(m).toLowerCase()}{m.available ? '' : ' — unavailable on this platform'}
                </option>
              ))}
            </optgroup>
          ) : null}
          {includeKling ? (
            <optgroup label="Kling — Coming Soon">
              {KLING_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled>{m.name} — Coming Soon</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {tier ? <EngineBadge tier={tier} label={selectedRunway?.speed === 'fast' ? '⚡ Fast' : undefined} /> : null}
        {selectedRunway && !selectedRunway.available ? <EngineBadge tier="Unavailable" /> : null}
        {selectedKling ? <EngineBadge tier="Coming Soon" /> : null}
      </div>
      {capabilityNote ? (
        <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)', marginTop: 5, lineHeight: 1.45 }}>{capabilityNote}</div>
      ) : null}
      {props.note ? (
        <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)', marginTop: 3, lineHeight: 1.45 }}>{props.note}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IMAGE ENGINE PICKER — the same idea for the stills surfaces (Character
// Generator, Motion Verger's source frame, product shots). Lists the platform
// image models alongside Runway's image entries, which resolve to the
// marketing_stock_image / product_campaign_image recipes — the platform's only
// Runway image path, since the proxy exposes no image MODEL route.
// ---------------------------------------------------------------------------

/** What every image surface falls back to when nothing is chosen. */
export const DEFAULT_IMAGE_ENGINE_ID = 'gemini-3.1-flash-image';

export interface ImageEnginePickerProps {
  value: string;
  onChange: (id: string) => void;
  /** Restrict the platform entries to the ones this surface really calls. */
  platformIds?: string[];
  /** Restrict the Runway entries (e.g. only the stock-image recipe). */
  runwayIds?: string[];
  disabled?: boolean;
  label?: string;
  note?: string;
  style?: CSSProperties;
}

export function imageEngineDisplayName(id: string): string {
  return IMAGE_MODELS.filter((m) => m.id === id)[0]?.name || runwayModel(id)?.label || id;
}

export function ImageEnginePicker(props: ImageEnginePickerProps) {
  useRunwayCatalog();
  const platformModels = IMAGE_MODELS.filter((m) => !props.platformIds || props.platformIds.indexOf(m.id) >= 0);
  const runway = RUNWAY_MODELS.filter((m) => m.type === 'image'
    && (!props.runwayIds || props.runwayIds.indexOf(m.id) >= 0));
  const platform = platformModels.filter((m) => m.id === props.value)[0];
  const selectedRunway = runwayModel(props.value);
  const note = platform
    ? platform.note
    : selectedRunway
      ? (selectedRunway.available
        ? `${runwayInputLabel(selectedRunway)} · ${selectedRunway.blurb} · ${selectedRunway.priceNote}`
        : `${runwayInputLabel(selectedRunway)} · ${selectedRunway.unavailableReason || ''}`)
      : '';

  return (
    <div style={props.style}>
      {props.label ? (
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--space-text-muted, #94A3B8)', marginBottom: 6 }}>
          {props.label}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => {
            const id = e.target.value;
            const rw = runwayModel(id);
            if (rw && !rw.available) return;
            props.onChange(id);
          }}
          style={{
            background: 'var(--space-surface-card, #10182A)', color: 'var(--space-text-primary, #F8FAFC)',
            border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))', borderRadius: 9,
            padding: '8px 10px', fontSize: 12.5, fontWeight: 600, cursor: props.disabled ? 'default' : 'pointer',
            maxWidth: '100%', minWidth: 0,
          }}
        >
          <optgroup label="Platform">
            {platformModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </optgroup>
          <optgroup label="Runway">
            {runway.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.speed === 'fast' ? '⚡ ' : ''}{m.label}{m.available ? '' : ' — unavailable on this platform'}
              </option>
            ))}
          </optgroup>
        </select>
        {selectedRunway?.available && selectedRunway.speed === 'fast' ? <EngineBadge tier="Fast" label="⚡ Fast" /> : null}
        {selectedRunway && !selectedRunway.available ? <EngineBadge tier="Unavailable" /> : null}
      </div>
      {note ? (
        <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)', marginTop: 5, lineHeight: 1.45 }}>{note}</div>
      ) : null}
      {props.note ? (
        <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)', marginTop: 3, lineHeight: 1.45 }}>{props.note}</div>
      ) : null}
    </div>
  );
}

export default EnginePicker;
