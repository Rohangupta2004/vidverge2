import { Plus, X } from 'lucide-react';

import AssetUpload from './AssetUpload';
import {
  MAX_SHOTS,
  MAX_STORY_CHARS,
  MIN_SHOT_CHARS,
  MIN_SHOTS,
  MIN_STORY_CHARS,
  multiShotDurationHint,
  multiShotReady,
} from '../lib/pipelines';
import type { MultiShotDuration, MultiShotRunInput } from '../lib/pipelines';

/**
 * THE MULTI-SHOT BRIEF, in one place.
 *
 * Pipeline C and the `multi_shot_video` recipe are the same ask, so they render
 * the same form rather than two that drift apart. The value is a plain object
 * the caller owns, and `toRunInput` turns it into the shape the orchestrator
 * and the recipe payload builder both take.
 */

export interface MultiShotFormValue {
  mode: 'auto' | 'custom';
  storyPrompt: string;
  shots: string[];
  firstFrameUrl: string | null;
  duration: MultiShotDuration;
  audio: boolean;
}

export const DURATIONS: MultiShotDuration[] = [5, 10, 15];

export function emptyMultiShot(): MultiShotFormValue {
  return {
    mode: 'custom',
    storyPrompt: '',
    shots: ['', '', ''],
    firstFrameUrl: null,
    duration: 15,
    audio: true,
  };
}

export function toRunInput(value: MultiShotFormValue, projectName: string): MultiShotRunInput {
  return {
    projectName,
    mode: value.mode,
    storyPrompt: value.storyPrompt,
    shots: value.shots.map((prompt) => ({ prompt })),
    firstFrameUrl: value.firstFrameUrl,
    duration: value.duration,
    audio: value.audio,
  };
}

/** Whether this brief can be submitted — the same rule the pipeline enforces. */
export function canSubmitMultiShot(value: MultiShotFormValue): boolean {
  return multiShotReady(toRunInput(value, 'preview'));
}

export default function MultiShotForm({
  value,
  onChange,
  disabled,
}: {
  value: MultiShotFormValue;
  onChange: (next: MultiShotFormValue) => void;
  disabled?: boolean;
}) {
  const patch = (changes: Partial<MultiShotFormValue>) => onChange({ ...value, ...changes });

  const setShot = (index: number, text: string) => {
    const shots = value.shots.slice();
    shots[index] = text;
    patch({ shots });
  };

  const addShot = () => {
    if (value.shots.length >= MAX_SHOTS) return;
    patch({ shots: [...value.shots, ''] });
  };

  const removeShot = (index: number) => {
    if (value.shots.length <= MIN_SHOTS) return;
    patch({ shots: value.shots.filter((_, position) => position !== index) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-1">
        {(['custom', 'auto'] as const).map((mode) => {
          const active = value.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => patch({ mode })}
              className="flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
              style={{
                background: active ? 'var(--space-brand-primary-500)' : 'transparent',
                color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)',
              }}
            >
              {mode === 'custom' ? 'Custom shots' : 'Auto story'}
            </button>
          );
        })}
      </div>

      {value.mode === 'custom' ? (
        <div className="flex flex-col gap-3">
          {value.shots.map((shot, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">
                  Shot {index + 1}
                </span>
                {value.shots.length > MIN_SHOTS && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeShot(index)}
                    aria-label={`Remove shot ${index + 1}`}
                    className="rounded-lg border border-[var(--space-border-default)] p-1 text-[var(--space-text-muted)] transition-colors hover:text-[var(--space-text-primary)] disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <textarea
                value={shot}
                onChange={(event) => setShot(index, event.target.value)}
                disabled={disabled}
                rows={2}
                maxLength={700}
                placeholder={SHOT_PLACEHOLDERS[index] || 'Describe what happens in this shot.'}
                className={inputClass + ' resize-y'}
              />
              <span className="text-[11px] text-[var(--space-text-muted)]">
                {shot.trim().length < MIN_SHOT_CHARS
                  ? `At least ${MIN_SHOT_CHARS} characters.`
                  : `${shot.trim().length} characters`}
              </span>
            </div>
          ))}

          <button
            type="button"
            onClick={addShot}
            disabled={disabled || value.shots.length >= MAX_SHOTS}
            className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-3.5 w-3.5" />
            Add shot
            <span className="text-[var(--space-text-muted)]">
              ({value.shots.length}/{MAX_SHOTS})
            </span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">
            The whole story
          </span>
          <textarea
            value={value.storyPrompt}
            onChange={(event) => patch({ storyPrompt: event.target.value.slice(0, MAX_STORY_CHARS) })}
            disabled={disabled}
            rows={5}
            maxLength={MAX_STORY_CHARS}
            placeholder="A tired founder drowning in tabs finds one tool that clears the mess, ships the launch, and closes on the logo with a sign-up line."
            className={inputClass + ' resize-y'}
          />
          <span className="text-[11px] text-[var(--space-text-muted)]">
            {value.storyPrompt.trim().length < MIN_STORY_CHARS
              ? `At least ${MIN_STORY_CHARS} characters \u2014 Runway breaks this into the shots itself.`
              : `${value.storyPrompt.length} / ${MAX_STORY_CHARS} characters`}
          </span>
        </div>
      )}

      <AssetUpload
        label="Opening frame (optional)"
        hint={'Anchors the first shot to a real still — a product shot, a hero image, a screenshot.'}
        accept="image/*"
        value={value.firstFrameUrl}
        disabled={disabled}
        onChange={(url) => patch({ firstFrameUrl: url })}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">Duration</span>
          <div className="flex items-center gap-1.5">
            {DURATIONS.map((seconds) => {
              const active = value.duration === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ duration: seconds })}
                  className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                  style={{
                    background: active
                      ? 'color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent)'
                      : 'transparent',
                    border: `1px solid ${
                      active ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'
                    }`,
                    color: active ? 'var(--space-brand-highlight)' : 'var(--space-text-secondary)',
                  }}
                >
                  {seconds}s
                </button>
              );
            })}
          </div>
          <span className="max-w-[360px] text-[11px] leading-relaxed text-[var(--space-text-muted)]">
            {multiShotDurationHint(toRunInput(value, 'preview'))}
          </span>
        </div>

        <AudioToggle
          on={value.audio}
          disabled={disabled}
          onToggle={() => patch({ audio: !value.audio })}
        />
      </div>
    </div>
  );
}

const SHOT_PLACEHOLDERS = [
  'The problem: a close shot of the mess your product removes.',
  'The product: the interface or object entering the frame.',
  'The solution: the moment it visibly works.',
  'The proof: a reaction, a result, a number on screen.',
  'The CTA: logo, line, and where to go next.',
];

export const inputClass = [
  'w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)]',
  'px-3.5 py-2.5 text-[13.5px] text-[var(--space-text-primary)]',
  'placeholder:text-[var(--space-text-muted)]',
  'outline-none transition-colors',
  'focus:border-[var(--space-brand-primary-500)]',
  'disabled:opacity-60',
].join(' ');

/** Shared by the Multi-Shot form and the recipe forms that offer audio. */
export function AudioToggle({
  on,
  onToggle,
  disabled,
  label = 'Audio',
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-[12.5px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)] disabled:opacity-50"
    >
      <span
        className="relative h-4 w-7 rounded-full transition-colors"
        style={{
          background: on
            ? 'var(--space-brand-primary-500)'
            : 'color-mix(in srgb, var(--space-text-primary) 18%, transparent)',
        }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
          style={{ left: on ? 14 : 2 }}
        />
      </span>
      {label}
      <span className="text-[var(--space-text-muted)]">{on ? 'on' : 'off'}</span>
    </button>
  );
}
