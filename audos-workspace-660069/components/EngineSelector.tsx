/**
 * ENGINE SELECTOR — shared UI for picking a video generation engine.
 *
 *  <EnginePicker>  compact grouped dropdown + tier badge + capability note.
 *                  Used by Product Video, SceneForge, Script-to-Video,
 *                  Video Enhancer and Ads Studio next to their generate
 *                  buttons.
 *
 * An entry the catalog marks unavailable stays visible but disabled, with the
 * real reason. Runway catalog entries that have a documented Omni fallback
 * remain selectable because they still produce a clip.
 *
 * Kling and Higgsfield route through /api/generate/kling/* and
 * /api/generate/higgsfield/* with X-Workspace-DB-Token on every call. The
 * Kling roster is live and selectable — only an entry that really is a preview
 * (or a shut-down id a stale selection still names) is called out.
 *
 * The full card grid lives in the Creatables app; this component stays small
 * so existing apps embed it without layout surgery.
 */
import { CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ENGINE_ID, GROUP_A_MODELS, HIGGSFIELD_VIDEO_MODELS, IMAGE_MODELS, KLING_MODELS, RUNWAY_MODELS,
  engineAvailabilityBadge, engineHealthWarning, groupAModel, isEngineAvailable, isKlingModel,
  isRetiredKlingModel, klingCapabilityNote, klingModel, klingUnsupportedMessage,
  runwayInputLabel, runwayModel, runwayVideoModel,
  subscribeRunwayCatalog, syncRunwayCatalog, tierColor, EngineTier,
} from '../lib/videoEngines';
import { OMNI_FALLBACK_LABEL } from '../lib/omniFallback';

/** What a Runway entry the proxy does not accept today is labelled with,
 * instead of being greyed out: it still generates, just on the stand-in. */
const VIA_FALLBACK = ` — via ${OMNI_FALLBACK_LABEL}`;

/**
 * The suffix an option carries when the last health sweep could not run that
 * model. A native <select> cannot render a badge element, so the state has to
 * travel in the option text — otherwise the only place it shows up is after
 * the customer has already spent a generation on it.
 *
 * Failed options remain visible so customers can see the catalog, but they are
 * disabled until a later health snapshot marks them working again.
 */
function availabilitySuffix(id: string): string {
  const badge = engineAvailabilityBadge(id);
  return badge ? ` — ⚠ ${badge.label}` : '';
}

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
    try {
      const stored = window.sessionStorage.getItem(key) || defaultId;
      return isEngineAvailable(stored) ? stored : (isEngineAvailable(defaultId) ? defaultId : DEFAULT_ENGINE_ID);
    } catch {
      return isEngineAvailable(defaultId) ? defaultId : DEFAULT_ENGINE_ID;
    }
  });
  const set = useCallback((id: string) => {
    const next = isEngineAvailable(id) ? id : (isEngineAvailable(defaultId) ? defaultId : DEFAULT_ENGINE_ID);
    setValue(next);
    try { window.sessionStorage.setItem(key, next); } catch { /* preference only */ }
  }, [defaultId, key]);
  return [value, set];
}

export function EngineBadge({ tier, label, style }: { tier: EngineTier | 'Coming Soon' | 'Gated' | 'Unavailable'; label?: string; style?: CSSProperties }) {
  const c = tier === 'Coming Soon' || tier === 'Unavailable'
    ? { bg: 'rgba(148,163,184,0.18)', fg: '#94A3B8' }
    : tier === 'Gated'
      ? { bg: 'rgba(240,180,41,0.16)', fg: '#F0B429' }
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
  /** List Kling models (default true). */
  includeKling?: boolean;
  /** List Higgsfield video models (default true). */
  includeHiggsfield?: boolean;
  disabled?: boolean;
  label?: string;
  /** Extra note under the picker (e.g. the app's default-model reminder). */
  note?: string;
  style?: CSSProperties;
}

export function engineDisplayName(id: string): string {
  return groupAModel(id)?.name || runwayModel(id)?.label || runwayVideoModel(id)?.name
    || KLING_MODELS.find((k) => k.id === id)?.name
    || HIGGSFIELD_VIDEO_MODELS.find((h) => h.id === id)?.name
    || id;
}

export function EnginePicker(props: EnginePickerProps) {
  useRunwayCatalog();
  const groupA = props.groupAIds === 'all' || !props.groupAIds
    ? GROUP_A_MODELS
    : GROUP_A_MODELS.filter((m) => (props.groupAIds as string[]).includes(m.id));
  const includeKling = props.includeKling !== false;
  const includeHiggsfield = props.includeHiggsfield !== false;
  const runwayKinds = props.runwayKinds || 'video';
  const runway = RUNWAY_MODELS.filter((m) => runwayKinds === 'all' || m.type === runwayKinds);
  const selectedA = groupAModel(props.value);
  const selectedRunway = runwayModel(props.value);
  const selectedKling = isKlingModel(props.value);
  const selectedKlingModel = klingModel(props.value);
  // A live Kling model is an ordinary choice. Only a genuine preview entry, or
  // a shut-down id a saved selection still names, gets called out.
  const klingPreview = Boolean(selectedKlingModel?.comingSoon)
    || isRetiredKlingModel(props.value);
  const tier: EngineTier | undefined = selectedA?.tier
    || (selectedRunway && selectedRunway.available
      ? (selectedRunway.speed === 'fast' ? 'Fast' : selectedRunway.type === 'image' ? 'Recipe' : 'Cinematic')
      : undefined);
  const viaFallback = Boolean(selectedRunway && !selectedRunway.available);
  // Health of the id that is actually selected, so the warning sits next to
  // the generate button rather than only inside the dropdown list.
  const selectedBadge = engineAvailabilityBadge(props.value);
  const selectedWarning = isEngineAvailable(props.value) ? null : engineHealthWarning(props.value);

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
        : `${runwayInputLabel(selectedRunway)} · The platform does not accept this model today, so it renders on ${OMNI_FALLBACK_LABEL}. ${selectedRunway.unavailableReason || ''}`)
      : selectedKlingModel ? klingCapabilityNote(props.value)
        : selectedKling ? klingUnsupportedMessage(props.value) : '';

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
          onChange={(e) => props.onChange(e.target.value)}
          style={{
            background: 'var(--space-surface-muted, #18150A)', color: 'var(--space-text-primary, #F5E9C8)',
            border: '1px solid var(--space-border-default, rgba(255,255,255,0.1))', borderRadius: 8,
            padding: '8px 10px', fontSize: 12.5, fontWeight: 600, cursor: props.disabled ? 'default' : 'pointer',
            maxWidth: '100%', minWidth: 0,
          }}
        >
          <optgroup label="Google / OpenAI / OpenRouter">
            {groupA.map((m) => (
              <option key={m.id} value={m.id} disabled={!isEngineAvailable(m.id)} title={engineHealthWarning(m.id) || undefined}>
                {m.name} — {m.tier}{availabilitySuffix(m.id)}
              </option>
            ))}
          </optgroup>
          {props.includeRunway ? (
            <optgroup label="Runway">
              {runway.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.speed === 'fast' ? '⚡ ' : ''}{m.label} · {runwayInputLabel(m).toLowerCase()}{m.available ? '' : VIA_FALLBACK}
                </option>
              ))}
            </optgroup>
          ) : null}
          {includeKling ? (
            <optgroup label="Kling">
              {KLING_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled={!isEngineAvailable(m.id)} title={engineHealthWarning(m.id) || undefined}>
                  {m.name} — {m.tier}{availabilitySuffix(m.id)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {includeHiggsfield ? (
            <optgroup label="Higgsfield">
              {HIGGSFIELD_VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled={!isEngineAvailable(m.id)} title={engineHealthWarning(m.id) || undefined}>
                  {m.name}{availabilitySuffix(m.id)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {tier ? <EngineBadge tier={tier} label={selectedRunway?.speed === 'fast' ? '⚡ Fast' : undefined} /> : null}
        {viaFallback ? <EngineBadge tier="Gated" label={OMNI_FALLBACK_LABEL} /> : null}
        {selectedKlingModel?.tier && !klingPreview ? <EngineBadge tier={selectedKlingModel.tier} /> : null}
        {klingPreview ? <EngineBadge tier="Coming Soon" /> : null}
        {selectedBadge ? <EngineBadge tier="Unavailable" label={selectedBadge.label} /> : null}
      </div>
      {/* The health warning goes ABOVE the capability line: what a model can
          accept does not matter if the proxy will refuse it. */}
      {selectedWarning ? (
        <div style={{ fontSize: 11, color: 'var(--space-semantic-danger, #f87171)', marginTop: 5, lineHeight: 1.45 }}>
          {selectedWarning}
        </div>
      ) : null}
      {capabilityNote ? (
        <div style={{ fontSize: 11, color: 'var(--space-text-muted, #9E8B55)', marginTop: 5, lineHeight: 1.45 }}>{capabilityNote}</div>
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
//
// The unavailable entries here stay DISABLED, unlike the video picker above:
// Omni Flash is a video stand-in, so there is nothing for an image entry to
// fall back to and a selectable one would only buy the customer a 400.
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
            background: 'var(--space-surface-muted, #18150A)', color: 'var(--space-text-primary, #F5E9C8)',
            border: '1px solid var(--space-border-default, rgba(255,255,255,0.1))', borderRadius: 8,
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
