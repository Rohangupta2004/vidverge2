import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { ArrowUp, Check, ChevronDown, Paperclip, X } from 'lucide-react';
import type { TargetApp } from '../types';

interface CreateBarProps {
  apps: TargetApp[];
  selectedAppId: string;
  onSelectApp: (id: string) => void;
  onSubmit: (prompt: string, appId: string, attachment: File | null) => Promise<void>;
  busy?: boolean;
}

export default function CreateBar({ apps, selectedAppId, onSelectApp, onSubmit, busy = false }: CreateBarProps) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = apps.find((app) => app.id === selectedAppId) || apps[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit(prompt, selected.id, attachment);
      setValue('');
      setAttachment(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The brief could not be handed off.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files && event.target.files[0];
    setAttachment(file || null);
    setSubmitError('');
    event.target.value = '';
  }

  return (
    <div className="relative w-full">
      {attachment && (
        <div className="mb-3 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--vv-border)] bg-[var(--vv-surface)] px-3 py-1.5 text-[12px] text-[#3D2800]">
            <Paperclip size={12} className="text-[var(--vv-gold)]" />
            <span className="max-w-[220px] truncate">{attachment.name}</span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-[#7A6030] transition-colors hover:text-[#1A1000]"
              aria-label="Remove attachment"
            >
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {submitError ? <p className="mb-2 text-center text-[11px] text-[var(--vv-error)]">{submitError}</p> : null}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 rounded-[28px] border border-[var(--vv-border)] px-2 py-2 backdrop-blur-xl transition-colors focus-within:border-[var(--vv-border-hover)]"
        style={{
          background: 'rgba(255,255,255,0.9)',
          boxShadow:
            '0 24px 60px -28px rgba(120,80,0,0.12), 0 0 28px -14px rgba(200,146,10,0.5), inset 0 1px 0 rgba(180,120,0,0.06)',
        }}
      >
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
        <button
          type="button"
          onClick={() => fileRef.current && fileRef.current.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#7A6030] transition-colors hover:bg-[rgba(180,120,0,0.06)] hover:text-[#1A1000]"
          aria-label="Attach a file"
          title="Attach a reference, script or clip"
        >
          <Paperclip size={16} />
        </button>

        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="What do you want to create?"
          className="min-w-0 flex-1 bg-transparent px-1 text-[15px] text-[#1A1000] outline-none placeholder:text-[#A08B5F]"
          aria-label="Describe what you want to create"
        />

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--vv-border)] px-3 text-[12px] text-[#3D2800] transition-colors hover:border-[color-mix(in_srgb,var(--vv-gold)_30%,transparent)] hover:text-[#1A1000]"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="max-w-[120px] truncate">{selected.name}</span>
            <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>

          {open && (
            <div
              role="listbox"
              className="absolute bottom-full right-0 z-20 mb-3 w-[268px] overflow-hidden rounded-2xl border border-[var(--vv-border)] p-1.5"
              style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 30px 70px -30px rgba(120,80,0,0.16)' }}
            >
              {apps.map((app) => {
                const active = app.id === selected.id;
                return (
                  <button
                    key={app.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onSelectApp(app.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[rgba(180,120,0,0.06)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[#1A1000]">{app.name}</span>
                      <span className="block truncate text-[11px] text-[var(--vv-text-dim)]">{app.tagline}</span>
                    </span>
                    {active && <Check size={14} className="shrink-0 text-[var(--vv-gold)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, var(--vv-gold, #C8920A), var(--vv-accent, #B4720A))',
            boxShadow: '0 0 24px -4px var(--vv-gold-glow, rgba(200,146,10,0.45))',
          }}
          disabled={!value.trim() || submitting}
        >
          <span className="hidden sm:inline">{submitting ? 'Sending' : busy ? 'Queue' : 'Create'}</span>
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  );
}
