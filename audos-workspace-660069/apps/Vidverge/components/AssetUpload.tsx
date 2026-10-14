import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';

import {
  isVideoUrl,
  MAX_UPLOAD_LABEL,
  MAX_UPLOAD_BYTES,
  TOO_LARGE_MESSAGE,
  uploadAsset,
} from '../lib/upload';

/**
 * THE ONLY UPLOAD CONTROL IN THIS APP.
 *
 * Every image and video input — Pipeline C's opening frame and all seven
 * Runway recipes — renders this component, so the four states behave the same
 * everywhere: idle, uploading, done (thumbnail + remove), and error (message +
 * retry). A file never reaches Runway as bytes: it is uploaded to platform
 * storage first and only the returned public URL is held in state.
 */

type Phase = 'idle' | 'uploading' | 'error';

export default function AssetUpload({
  label,
  hint,
  accept = 'image/*',
  value,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  hint?: string;
  accept?: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  /** Drop the label row — used inside a multi-slot grid that labels itself. */
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastFile = useRef<File | null>(null);

  async function send(file: File) {
    lastFile.current = file;
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhase('error');
      setError(TOO_LARGE_MESSAGE);
      return;
    }
    setPhase('uploading');
    setError('');
    try {
      const url = await uploadAsset(file);
      onChange(url);
      setPhase('idle');
    } catch (caught: any) {
      setPhase('error');
      setError(String(caught?.message || caught || 'The upload failed.'));
    }
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void send(file);
  }

  function clear() {
    onChange(null);
    setPhase('idle');
    setError('');
    lastFile.current = null;
    if (inputRef.current) inputRef.current.value = '';
  }

  function retry() {
    const file = lastFile.current;
    if (file) {
      void send(file);
      return;
    }
    setPhase('idle');
    setError('');
    inputRef.current?.click();
  }

  const wantsVideo = accept.indexOf('video') >= 0;

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && (
        <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">{label}</span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={pick}
        disabled={disabled || phase === 'uploading'}
        className="hidden"
      />

      {value ? (
        <div className="flex items-center gap-3">
          <div
            className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black"
            title={label}
          >
            {isVideoUrl(value) ? (
              <video
                src={value}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <img
                src={value}
                alt={label}
                className="h-full w-full"
                style={{ objectFit: 'cover' }}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {compact && (
              <p className="truncate text-[12px] font-medium text-[var(--space-text-secondary)]">
                {label}
              </p>
            )}
            <p className="truncate text-[11.5px] text-[var(--space-text-muted)]">{value}</p>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2 py-1 text-[11.5px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)] disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Remove
            </button>
          </div>
        </div>
      ) : phase === 'uploading' ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--space-border-default)] px-3.5 py-3 text-[12.5px] text-[var(--space-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--space-brand-highlight)]" />
          {'Uploading\u2026'}
        </div>
      ) : phase === 'error' ? (
        <div
          className="flex flex-col gap-2 rounded-xl px-3.5 py-3"
          style={{
            background: 'color-mix(in srgb, var(--space-semantic-danger-500) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--space-semantic-danger-500) 36%, transparent)',
          }}
        >
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[var(--space-text-primary)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-danger-500)]" />
            <span>{error}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={retry}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1 text-[12px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)] disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase('idle');
                setError('');
                inputRef.current?.click();
              }}
              disabled={disabled}
              className="text-[12px] font-medium text-[var(--space-text-muted)] underline-offset-2 transition-colors hover:text-[var(--space-text-primary)] hover:underline disabled:opacity-50"
            >
              Choose another file
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--space-border-default)] px-3.5 py-3 text-left text-[12.5px] text-[var(--space-text-secondary)] transition-colors hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_55%,transparent)] hover:text-[var(--space-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4 text-[var(--space-brand-highlight)]" />
          <span>
            {compact ? label : `Choose ${wantsVideo ? 'a video' : 'an image'}`}
            <span className="ml-1.5 text-[var(--space-text-muted)]">max {MAX_UPLOAD_LABEL}</span>
          </span>
        </button>
      )}

      {hint && !compact && (
        <span className="text-[11.5px] text-[var(--space-text-muted)]">{hint}</span>
      )}
    </div>
  );
}

/**
 * The same control, repeated for an ordered list of references (product shots,
 * style frames, replacement products). One empty slot is always offered until
 * `max` is reached, and removing a slot closes the gap.
 */
export function MultiAssetUpload({
  label,
  hint,
  accept = 'image/*',
  values,
  onChange,
  max,
  disabled,
  slotLabel,
}: {
  label: string;
  hint?: string;
  accept?: string;
  values: string[];
  onChange: (urls: string[]) => void;
  max: number;
  disabled?: boolean;
  /** "Product image" → "Product image 1". */
  slotLabel: string;
}) {
  const slots = values.slice(0, max);
  const showEmpty = slots.length < max;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">{label}</span>
        <span className="text-[11.5px] text-[var(--space-text-muted)]">
          {slots.length} of {max}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((url, index) => (
          <AssetUpload
            key={`${url}-${index}`}
            compact
            label={`${slotLabel} ${index + 1}`}
            accept={accept}
            value={url}
            disabled={disabled}
            onChange={(next) => {
              const copy = slots.slice();
              if (next) copy[index] = next;
              else copy.splice(index, 1);
              onChange(copy);
            }}
          />
        ))}
        {showEmpty && (
          <AssetUpload
            key={`empty-${slots.length}`}
            compact
            label={`Add ${slotLabel.toLowerCase()} ${slots.length + 1}`}
            accept={accept}
            value={null}
            disabled={disabled}
            onChange={(next) => {
              if (next) onChange([...slots, next]);
            }}
          />
        )}
      </div>

      {hint && <span className="text-[11.5px] text-[var(--space-text-muted)]">{hint}</span>}
    </div>
  );
}
