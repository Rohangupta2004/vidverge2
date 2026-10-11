/**
 * Toasts — the quiet channel.
 *
 * Faceless already has two loud ways to report trouble: the stage list marks
 * a failed stage, and the Notice panel stops the run. Toasts are for the
 * third kind, which neither of those fits: something optional degraded, the
 * film is fine, and the user should know once and then be left alone.
 */

import { useCallback, useRef, useState } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';

export type ToastTone = 'info' | 'warn' | 'success';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const DEFAULT_TTL_MS = 6000;
const MAX_VISIBLE = 3;

export interface ToastController {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): ToastController {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const text = String(message || '').trim();
      if (!text) return;
      const id = nextId.current;
      nextId.current += 1;
      setToasts((previous) => {
        // The same degradation can be reported by two stages in one run; saying
        // it twice in the same breath is noise, not information.
        if (previous.some((toast) => toast.message === text)) return previous;
        return [...previous, { id, tone, message: text }].slice(-MAX_VISIBLE);
      });
      const timer = window.setTimeout(() => dismiss(id), DEFAULT_TTL_MS);
      timers.current = [...timers.current.slice(-20), timer];
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

function toneColour(tone: ToastTone): string {
  if (tone === 'warn') return 'var(--space-semantic-warning-500, #f59e0b)';
  if (tone === 'success') return 'var(--space-semantic-success-500, #22c55e)';
  return 'var(--space-brand-primary-500, #f59e0b)';
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  const className = 'h-4 w-4 shrink-0';
  if (tone === 'warn') return <AlertCircle className={className} />;
  if (tone === 'success') return <Check className={className} />;
  return <Info className={className} />;
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((toast) => {
        const colour = toneColour(toast.tone);
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed shadow-lg backdrop-blur"
            style={{
              background: 'color-mix(in srgb, var(--space-surface-panel, #101623) 92%, transparent)',
              borderColor: `color-mix(in srgb, ${colour} 38%, transparent)`,
              color: 'var(--space-text-secondary, #CBD5E1)',
            }}
          >
            <span className="mt-0.5" style={{ color: colour }}>
              <ToneIcon tone={toast.tone} />
            </span>
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(toast.id)}
              className="mt-0.5 shrink-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
