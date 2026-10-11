// Pick a card template, fill its variables, render it on its own.
//
// Each card is rendered as an INDEPENDENT clip and composited at the
// timestamp the customer picked, which is what keeps a ten-card video the
// same size of request as a one-card video.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import { CARD_TEMPLATES, cardSummary, templateOf } from '../lib/hyperFrames';
import type { BrandKit, CardLayer, CardTemplateId } from '../lib/motionEditor';

export default function HyperFrameCard(props: {
  /** Editing an existing card, or null when adding a new one. */
  card: CardLayer | null;
  kit: BrandKit;
  playhead: number;
  duration: number;
  rendering: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: { template: CardTemplateId; variables: Record<string, string>; start: number; duration: number; placement: 'overlay' | 'insert' }) => void;
}) {
  const { card, kit, playhead, duration, rendering, error } = props;
  const [template, setTemplate] = useState<CardTemplateId>(card?.template || 'feature-card');
  const [variables, setVariables] = useState<Record<string, string>>(card?.variables || {});
  const [start, setStart] = useState(card ? card.start : playhead);
  const [length, setLength] = useState(card ? card.duration : templateOf('feature-card').defaultDuration);
  const [placement, setPlacement] = useState<'overlay' | 'insert'>(card?.placement || 'overlay');
  const definition = useMemo(() => templateOf(template), [template]);

  useEffect(() => {
    if (card) return;
    setLength(templateOf(template).defaultDuration);
  }, [template, card]);

  // Optional fields are meant to be blank — a step sequence ships three steps as
  // happily as five — so only the required ones gate the render.
  const missing = definition.fields.filter((field) => !field.optional && !String(variables[field.key] || '').trim());
  const ready = missing.length === 0;

  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,#1A1000_35%,transparent)] p-4" onClick={props.onClose}>
    <div className="sfme-rise flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--space-border-strong)] bg-[var(--space-surface-card)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 border-b border-[var(--space-border-default)] px-5 py-3.5">
        <Sparkles className="h-4 w-4 text-[#C8920A]" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-[var(--space-text-primary)]">{card ? 'Edit card' : 'Add a card'}</h2>
          <p className="truncate text-[11px] text-[var(--space-text-muted)]">Rendered on its own, then composited at {start.toFixed(1)}s.</p>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#B4780A_10%,transparent)]"><X className="h-4 w-4" /></button>
      </header>

      <div className="grid flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {CARD_TEMPLATES.map((option) => <button key={option.id} type="button" onClick={() => { setTemplate(option.id); if (!card) setVariables({}); }}
            className={option.id === template
              ? 'w-full rounded-xl border-2 border-[#C8920A] bg-[color-mix(in_srgb,#C8920A_12%,transparent)] p-3 text-left'
              : 'w-full rounded-xl border border-[var(--space-border-default)] p-3 text-left hover:border-[#C8920A]'}>
            <span className="block text-xs font-bold text-[var(--space-text-primary)]">{option.name}</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--space-text-muted)]">{option.blurb}</span>
          </button>)}
        </div>

        <div className="space-y-3">
          {definition.fields.map((field) => <label key={field.key} className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">{field.label}</span>
            {field.multiline
              ? <textarea rows={3} value={variables[field.key] || ''} placeholder={field.placeholder} onChange={(event) => setVariables((old) => ({ ...old, [field.key]: event.target.value }))} className="sf-textarea mt-1" />
              : <input value={variables[field.key] || ''} placeholder={field.placeholder}
                aria-invalid={missing.some((entry) => entry.key === field.key) ? true : undefined}
                onChange={(event) => setVariables((old) => ({ ...old, [field.key]: event.target.value }))}
                className={missing.some((entry) => entry.key === field.key) ? 'sf-input sf-input--error mt-1' : 'sf-input mt-1'} />}
          </label>)}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Appears at (s)</span>
              <input type="number" min={0} max={Math.max(0, duration)} step={0.1} value={Math.round(start * 10) / 10} onChange={(event) => setStart(Math.max(0, Math.min(duration, Number(event.target.value) || 0)))} className="sf-input mt-1" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">On screen for (s)</span>
              <input type="number" min={1} max={20} step={0.5} value={length} onChange={(event) => setLength(Math.max(1, Number(event.target.value) || 1))} className="sf-input mt-1" />
            </label>
          </div>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">How it lands</span>
            <select value={placement} onChange={(event) => setPlacement(event.target.value as 'overlay' | 'insert')} className="sf-input mt-1">
              <option value="overlay">{'Overlay the presenter \u2014 keeps the length and shape'}</option>
              <option value="insert">{'Cut into the film \u2014 makes it longer'}</option>
            </select>
          </label>

          <div className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Preview</p>
            <div className="mt-2 rounded-xl p-4" style={{ background: 'linear-gradient(135deg, rgba(10,14,24,.95), rgba(40,31,16,.95))', borderTop: `3px solid ${kit.primary}` }}>
              {template === 'stat-counter'
                ? <div className="text-center">
                  <p className="text-3xl font-black" style={{ color: kit.accent }}>{variables.value || '0'}</p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: kit.textColor }}>{variables.label || 'What it measures'}</p>
                </div>
                : <div>
                  <p className="text-base font-extrabold leading-snug" style={{ color: kit.textColor }}>{template === 'quote-card' ? `\u201C${variables.quote || 'Your quote'}\u201D` : (variables.title || variables.headline || variables.leftTitle || variables.label || 'Your title')}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--space-text-secondary)]">{variables.body || variables.attribution || variables.step1 || variables.left1 || variables.detail || ''}</p>
                  {variables.cta ? <span className="mt-3 inline-block rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: kit.primary, color: kit.contrast }}>{variables.cta}</span> : null}
                </div>}
            </div>
          </div>

          {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-danger)]" />
            <span className="min-w-0 flex-1 leading-relaxed text-[var(--space-text-secondary)]">{error}</span>
          </div> : null}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--space-border-default)] px-5 py-3.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--space-text-muted)]">
          {ready ? cardSummary(template, variables) : `Still needed: ${missing.map((field) => field.label).join(', ')}.`}
        </span>
        <button type="button" onClick={props.onClose} className="rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)]">Cancel</button>
        <button type="button" disabled={!ready || rendering} onClick={() => props.onSubmit({ template, variables, start, duration: length, placement })}
          className="flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E8B737,#C8920A)] px-4 py-2 text-xs font-bold text-white shadow-[0_4px_16px_rgba(200,146,10,.35)] disabled:opacity-40">
          {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{rendering ? 'Rendering the card…' : card ? 'Re-render card' : 'Render card'}
        </button>
      </footer>
    </div>
  </div>;
}
