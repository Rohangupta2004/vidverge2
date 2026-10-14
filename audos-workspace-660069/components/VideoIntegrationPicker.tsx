/**
 * Two-step selector: native Audos video integration, then model within it.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  VIDEO_INTEGRATIONS,
  type VideoIntegrationId,
  defaultModelForIntegration,
  modelsForIntegration,
  integrationMeta,
} from '../lib/videoIntegrations';
import { engineAvailabilityBadge, isEngineAvailable } from '../lib/videoEngines';

export interface VideoIntegrationPickerProps {
  integration: VideoIntegrationId;
  model: string;
  onChange: (integration: VideoIntegrationId, model: string) => void;
  disabled?: boolean;
  label?: string;
  note?: string;
  /** Hide presenter-only integrations (HeyGen) when this surface only films scenes. */
  sceneOnly?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function VideoIntegrationPicker(props: VideoIntegrationPickerProps) {
  const integrations = useMemo(
    () => VIDEO_INTEGRATIONS.filter((entry) => !props.sceneOnly || entry.role === 'scene'),
    [props.sceneOnly],
  );
  const models = useMemo(() => modelsForIntegration(props.integration), [props.integration]);
  const [modelError, setModelError] = useState('');

  useEffect(() => {
    if (models.some((m) => m.id === props.model)) {
      setModelError('');
      return;
    }
    const fallback = defaultModelForIntegration(props.integration);
    if (fallback && fallback !== props.model) {
      props.onChange(props.integration, fallback);
    }
  }, [props.integration, props.model, models, props.onChange]);

  const meta = integrationMeta(props.integration);
  const selectedAvailability = engineAvailabilityBadge(props.model);
  const selectClass = props.className || 'mt-1 w-full rounded-lg border border-[color-mix(in_srgb,var(--space-border-default)_80%,transparent)] bg-[var(--space-surface-card,#15120A)] px-3 py-2 text-sm text-[var(--space-text-primary,#F5E9C8)] outline-none focus:border-[var(--space-brand-primary-500,#D4920A)]';

  return (
    <div style={props.style} className={props.className ? undefined : 'space-y-2'}>
      {props.label ? (
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted,#94A3B8)]">
          {props.label}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-[var(--space-text-muted,#94A3B8)]">
          Provider
          <select
            className={selectClass}
            disabled={props.disabled}
            value={props.integration}
            onChange={(event) => {
              const next = event.target.value as VideoIntegrationId;
              const nextModel = defaultModelForIntegration(next);
              props.onChange(next, nextModel);
              setModelError('');
            }}
          >
            {integrations.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[var(--space-text-muted,#94A3B8)]">
          Model
          <select
            className={selectClass}
            disabled={props.disabled || props.integration === 'heygen-video'}
            value={props.model}
            onChange={(event) => {
              setModelError('');
              props.onChange(props.integration, event.target.value);
            }}
          >
            {models.map((m) => {
              const badge = engineAvailabilityBadge(m.id);
              return (
                <option key={m.id} value={m.id} disabled={!isEngineAvailable(m.id)} title={badge?.title || m.hint}>
                  {m.label}{badge ? ` — ${badge.label}` : ''}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      {meta?.blurb ? (
        <p className="text-[11px] leading-relaxed text-[var(--space-text-muted,#9E8B55)]">{meta.blurb}</p>
      ) : null}
      {selectedAvailability ? (
        <p className="text-[11px] leading-relaxed text-[var(--space-semantic-warning,#fbbf24)]">
          {selectedAvailability.label}: {selectedAvailability.title}
        </p>
      ) : null}
      {modelError ? <p className="text-[11px] text-[var(--space-semantic-danger,#f87171)]">{modelError}</p> : null}
      {props.note ? <p className="text-[11px] text-[var(--space-text-muted,#94A3B8)]">{props.note}</p> : null}
    </div>
  );
}

export default VideoIntegrationPicker;
