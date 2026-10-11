// Caption segments, one row each, editable.
//
// The segments come from real timestamped transcription of the base video's
// own audio (Deepgram word timings, grouped by the caption server function),
// so the timings are the presenter's actual timings — nothing is guessed from
// the script text.
import { useMemo, useState } from 'react';
import { Clock, Loader2, Plus, Subtitles, Trash2, X } from 'lucide-react';
import { formatClock, type CaptionSegment } from '../lib/motionEditor';

export default function CaptionEditor(props: {
  segments: CaptionSegment[];
  duration: number;
  playhead: number;
  busy: boolean;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  onChange: (id: string, patch: Partial<CaptionSegment>) => void;
  onRemove: (id: string) => void;
  onAdd: (atSec: number) => void;
  onRegenerate: () => void;
}) {
  const { segments, duration, playhead, busy } = props;
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => [...segments].sort((a, b) => a.start - b.start), [segments]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? ordered.filter((segment) => segment.text.toLowerCase().includes(needle)) : ordered;
  }, [ordered, query]);
  const overlaps = useMemo(() => {
    const flagged = new Set<string>();
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].start < ordered[i - 1].end - 0.05) flagged.add(ordered[i].id);
    }
    return flagged;
  }, [ordered]);

  return <div className="absolute inset-0 z-50 flex justify-end bg-[color-mix(in_srgb,#1A1000_35%,transparent)]" onClick={props.onClose}>
    <aside className="sfme-rise flex h-full w-full max-w-xl flex-col border-l border-[var(--space-border-strong)] bg-[var(--space-surface-card)]" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 border-b border-[var(--space-border-default)] px-5 py-3.5">
        <Subtitles className="h-4 w-4 text-[#166534]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-[var(--space-text-primary)]">Captions</h2>
          <p className="text-[11px] text-[var(--space-text-muted)]">{ordered.length} segment{ordered.length === 1 ? '' : 's'} from the presenter&rsquo;s own audio.</p>
        </div>
        <button type="button" onClick={props.onRegenerate} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)] disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}Re-transcribe
        </button>
        <button type="button" onClick={props.onClose} aria-label="Close captions" className="rounded-lg p-1.5 text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#B4780A_10%,transparent)]"><X className="h-4 w-4" /></button>
      </header>

      <div className="flex items-center gap-2 border-b border-[var(--space-border-default)] px-5 py-2.5">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a line" className="sf-input" />
        <button type="button" onClick={() => props.onAdd(playhead)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#166534,#15803D)] px-3 py-2 text-[11px] font-bold text-white"><Plus className="h-3.5 w-3.5" />At playhead</button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {visible.map((segment) => {
          const live = playhead >= segment.start && playhead <= segment.end;
          return <div key={segment.id} className={live
            ? 'rounded-xl border border-[#166534] bg-[color-mix(in_srgb,#166534_10%,transparent)] p-3'
            : 'rounded-xl border border-[var(--space-border-default)] p-3'}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => props.onSeek(segment.start)} className="rounded-md bg-[color-mix(in_srgb,#B4780A_12%,transparent)] px-2 py-1 font-mono text-[10px] text-[var(--space-text-secondary)]">{formatClock(segment.start)}</button>
              <input type="number" min={0} max={duration} step={0.05} value={Math.round(segment.start * 100) / 100}
                onChange={(event) => props.onChange(segment.id, { start: Math.max(0, Math.min(duration, Number(event.target.value) || 0)) })}
                aria-label="Start second" className="sf-input max-w-[5.5rem] py-1 text-xs" />
              <span className="text-[10px] text-[var(--space-text-muted)]">to</span>
              <input type="number" min={0} max={duration} step={0.05} value={Math.round(segment.end * 100) / 100}
                onChange={(event) => props.onChange(segment.id, { end: Math.max(0.2, Math.min(duration, Number(event.target.value) || 0)) })}
                aria-label="End second" className="sf-input max-w-[5.5rem] py-1 text-xs" />
              <button type="button" onClick={() => props.onRemove(segment.id)} aria-label="Delete segment" className="ml-auto rounded p-1 text-[var(--space-text-muted)] hover:text-[var(--space-semantic-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <textarea value={segment.text} rows={2} onChange={(event) => props.onChange(segment.id, { text: event.target.value })} className="sf-input mt-2 resize-y text-sm" />
            {overlaps.has(segment.id) ? <p className="mt-1.5 text-[10px] text-[#B45309]">This line starts before the previous one ends — the later caption will cover the earlier one on screen.</p> : null}
            {segment.end <= segment.start ? <p className="mt-1.5 text-[10px] text-[var(--space-semantic-danger)]">The end second must be after the start second.</p> : null}
          </div>;
        })}
        {!ordered.length ? <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--space-border-strong)] px-6 py-12 text-center">
          <Subtitles className="h-6 w-6 text-[#166534]" />
          <p className="text-sm font-semibold text-[var(--space-text-primary)]">No captions yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-[var(--space-text-muted)]">Press Re-transcribe to read the presenter&rsquo;s audio and lay the lines out on the timeline, or add one at the playhead and type it yourself.</p>
        </div> : null}
        {ordered.length && !visible.length ? <p className="py-8 text-center text-xs text-[var(--space-text-muted)]">No caption matches that search.</p> : null}
      </div>
    </aside>
  </div>;
}
