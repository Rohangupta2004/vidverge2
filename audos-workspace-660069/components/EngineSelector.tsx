/**
 * ENGINE SELECTOR — shared UI for picking a video generation engine.
 *
 *  <EnginePicker>  compact grouped dropdown + tier badge + capability note.
 *                  Used by Product Video, SceneForge, Script-to-Video,
 *                  Video Enhancer and Ads Studio next to their generate
 *                  buttons. Kling entries render disabled with [Coming Soon];
 *                  Runway entries (optional) carry a "Gated" badge.
 *
 * The full card grid lives in the Creatables app; this component stays small
 * so existing apps embed it without layout surgery.
 */
import { CSSProperties } from 'react';
import {
  GROUP_A_MODELS, KLING_MODELS, KLING_COMING_SOON_MESSAGE, RUNWAY_VIDEO_MODELS,
  groupAModel, isKlingModel, runwayVideoModel, tierColor, EngineTier,
} from '../lib/videoEngines';

export function EngineBadge({ tier, label, style }: { tier: EngineTier | 'Coming Soon' | 'Gated'; label?: string; style?: CSSProperties }) {
  const c = tier === 'Coming Soon'
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
  /** Also list Runway Gen 4.5 / Gen 4 Turbo (gated — may answer 503). */
  includeRunway?: boolean;
  /** List Kling models as disabled [Coming Soon] entries (default true). */
  includeKling?: boolean;
  disabled?: boolean;
  label?: string;
  /** Extra note under the picker (e.g. the app's default-model reminder). */
  note?: string;
  style?: CSSProperties;
}

export function engineDisplayName(id: string): string {
  return groupAModel(id)?.name || runwayVideoModel(id)?.name || KLING_MODELS.find((k) => k.id === id)?.name || id;
}

export function EnginePicker(props: EnginePickerProps) {
  const groupA = props.groupAIds === 'all' || !props.groupAIds
    ? GROUP_A_MODELS
    : GROUP_A_MODELS.filter((m) => (props.groupAIds as string[]).includes(m.id));
  const includeKling = props.includeKling !== false;
  const selectedA = groupAModel(props.value);
  const selectedRunway = runwayVideoModel(props.value);
  const selectedKling = isKlingModel(props.value);
  const tier = selectedA?.tier || selectedRunway?.tier;

  const capabilityNote = selectedA
    ? [
        selectedA.supportsReferenceImages ? (selectedA.refsExclusiveWithSeed ? 'reference images (excl. seed/last frame)' : 'reference images + seed image') : 'single seed image only',
        selectedA.supportsLastFrame ? 'last-frame lock' : null,
        selectedA.supports4k ? '4K' : null,
        selectedA.supportsAudio ? 'audio' : null,
      ].filter(Boolean).join(' · ')
    : selectedRunway
      ? `${selectedRunway.textToVideo ? 'text-to-video + image-to-video' : 'image-to-video only'} · pixel-pair ratios · $${selectedRunway.pricePerSecondUsd.toFixed(2)}/s`
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
            if (isKlingModel(id)) return; // disabled options guard (some browsers)
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
            <optgroup label="Runway (gated — may still be enabling)">
              {RUNWAY_VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {m.tier} · Gated</option>
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
        {tier ? <EngineBadge tier={tier} /> : null}
        {selectedRunway ? <EngineBadge tier="Gated" /> : null}
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

export default EnginePicker;
