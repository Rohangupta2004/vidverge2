import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pause, Play, Search } from 'lucide-react';
import {
  DEFAULT_VOICE_SETTINGS,
  PREVIEW_SAMPLE_LINE,
  hasCachedSample,
  previewVoiceSample,
  shortVoiceName,
  type ElevenVoice,
  type VoiceSettings,
} from '../lib/elevenLabs';

// The one ElevenLabs voice list for every SceneForge surface — the single-
// script Avatar Studio and the storyboard's Audio panel both mount it, so a
// voice looks and behaves the same wherever the customer meets it.
//
// Every voice the catalog returned is rendered. The catalog routes have no
// server-side paging, so a cap here would be the only reason a voice could be
// missing, and that is exactly the complaint it replaces: a customer who had
// cloned their own voice and could not find it. Filtering is the way to
// narrow the list; the list itself just scrolls.

// Only `--space-*` tokens are used because the workbench's `--sf-*` set is
// derived from them; the picker therefore sits correctly on either surface.
const FIELD = 'w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] py-2.5 pl-9 pr-3 text-sm text-[var(--space-text-primary)] outline-none placeholder:text-[var(--space-text-muted)] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_color-mix(in_srgb,#8b5cf6_18%,transparent)]';
const CHIP_ON = 'rounded-lg bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-3 py-2 text-xs font-semibold text-white';
const CHIP_OFF = 'rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]';
const ICON_BUTTON = 'flex shrink-0 items-center gap-1 rounded-lg border border-[var(--space-border-strong)] px-2 py-2 text-[var(--space-text-secondary)] hover:text-[var(--space-text-primary)] disabled:opacity-50';

/** ElevenLabs' category tags, worded for a customer rather than an API. */
function categoryLabel(category: string): string {
  switch (category) {
    case 'cloned': return 'Yours';
    case 'premade': return 'Premade';
    case 'professional': return 'Pro clone';
    case 'generated': return 'Designed';
    case 'famous': return 'Famous';
    default: return category ? category.replace(/_/g, ' ') : '';
  }
}

export interface ElevenVoicePickerProps {
  voices: ElevenVoice[];
  value: string;
  onChange: (voiceId: string) => void;
  /** Delivery settings a billed sample is spoken with; defaults to the platform's. */
  settings?: VoiceSettings;
  loading?: boolean;
  error?: string;
  /** Extra controls on the right of a row — the studio hangs its delete button here. */
  renderActions?: (voice: ElevenVoice) => any;
  /** Extra controls on the search row, after the Indian filter. */
  toolbar?: any;
  /** Tailwind max-height for the scrolling list; the panel itself never paginates. */
  listHeightClass?: string;
  /** Set when the picker should not be used at all (e.g. while a batch is being narrated). */
  disabled?: boolean;
}

export default function ElevenVoicePicker({
  voices, value, onChange, settings = DEFAULT_VOICE_SETTINGS, loading = false, error = '',
  renderActions, toolbar, listHeightClass = 'max-h-80', disabled = false,
}: ElevenVoicePickerProps) {
  const [query, setQuery] = useState('');
  const [onlyIndian, setOnlyIndian] = useState(false);
  const [playingId, setPlayingId] = useState('');
  const [samplingId, setSamplingId] = useState('');
  const [sampleError, setSampleError] = useState('');
  // Re-rendered after a billed sample lands so the row can switch its hint
  // from "costs a generation" to "ready" — the cache itself lives in the lib.
  const [, setSampleTick] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const indian = useMemo(() => voices.filter((voice) => voice.indian), [voices]);
  const cloned = useMemo(() => voices.filter((voice) => voice.category === 'cloned').length, [voices]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = onlyIndian ? indian : voices;
    if (!needle) return pool;
    return pool.filter((voice) => `${voice.name} ${voice.descriptor} ${voice.category} ${categoryLabel(voice.category)}`.toLowerCase().includes(needle));
  }, [voices, indian, onlyIndian, query]);

  // A selection made outside the list (a clone that was just created and
  // auto-selected, a project reopening on a saved voice) must be visible, so
  // a filter that would hide it is cleared — once per selection, as soon as
  // the catalog actually contains it. Typing a query afterwards that hides
  // the chosen voice is the customer's own doing and is left alone.
  const revealed = useRef('');
  useEffect(() => {
    if (revealed.current === value) return;
    if (!value || !voices.some((voice) => voice.id === value)) return;
    revealed.current = value;
    if (visible.some((voice) => voice.id === value)) return;
    setQuery('');
    setOnlyIndian(false);
  }, [value, voices, visible]);

  // One shared <audio> for every preview: a per-row element would let two
  // voices talk over each other, which makes auditioning them pointless.
  const stop = useCallback(() => {
    audio.current?.pause();
    setPlayingId('');
  }, []);

  const preview = useCallback(async (voice: ElevenVoice) => {
    if (playingId === voice.id) { stop(); return; }
    const billed = !voice.previewUrl && !hasCachedSample(voice.id);
    setSampleError('');
    if (billed) setSamplingId(voice.id);
    try {
      const url = await previewVoiceSample(voice, settings);
      setSampleTick((tick) => tick + 1);
      const element = audio.current || new Audio();
      audio.current = element;
      element.pause();
      element.src = url;
      element.onended = () => setPlayingId('');
      element.onerror = () => setPlayingId('');
      setPlayingId(voice.id);
      await element.play().catch(() => setPlayingId(''));
    } catch (e: any) {
      setSampleError(String(e?.message || 'The sample could not be generated.'));
    } finally {
      setSamplingId((current) => (current === voice.id ? '' : current));
    }
  }, [playingId, settings, stop]);

  useEffect(() => () => { audio.current?.pause(); }, []);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[160px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} inputMode="search" autoComplete="off"
          placeholder="Search by name, language, accent or type" className={FIELD} />
      </div>
      <button type="button" aria-pressed={onlyIndian} onClick={() => setOnlyIndian((on) => !on)} className={onlyIndian ? CHIP_ON : CHIP_OFF}>
        {'\u{1F1EE}\u{1F1F3}'} Indian only ({indian.length})
      </button>
      {toolbar}
    </div>

    {loading && !voices.length
      ? <div className="h-28 animate-pulse rounded-xl bg-[var(--space-surface-muted)]" />
      : error && !voices.length
        ? <div role="alert" className="rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] p-3 text-xs text-[var(--space-text-secondary)]">
          <strong className="block text-[var(--space-text-primary)]">The ElevenLabs voice catalog did not load</strong>{error}
        </div>
        : !visible.length
          ? <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] p-4 text-xs leading-relaxed text-[var(--space-text-secondary)]">
            <span className="min-w-[min(100%,220px)] flex-1">
              <strong className="block text-[var(--space-text-primary)]">{onlyIndian ? 'No Indian voices matched' : 'No voices match that search'}</strong>
              {onlyIndian
                ? 'ElevenLabs does not tag voices by country, so this filter reads each voice\u2019s own language, accent and name. Clear it to browse the whole catalog.'
                : 'Try a different name, language, accent or type.'}
            </span>
            {onlyIndian ? <button type="button" onClick={() => setOnlyIndian(false)} className="rounded-lg border border-[var(--space-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--space-text-primary)]">Show all voices</button> : null}
          </div>
          : <>
            <p className="text-[11px] text-[var(--space-text-muted)]">
              Showing {visible.length === voices.length ? `all ${voices.length}` : `${visible.length} of ${voices.length}`} voices{cloned ? ` · ${cloned} cloned by you` : ''}. Premade voices preview for free; a cloned voice has no sample until one short line is generated, which is billed once per voice per session.
            </p>
            <ul className={`${listHeightClass} space-y-1.5 overflow-y-auto pr-1`}>
              {visible.map((voice) => {
                const selected = voice.id === value;
                const playing = playingId === voice.id;
                const sampling = samplingId === voice.id;
                const free = Boolean(voice.previewUrl);
                const ready = free || hasCachedSample(voice.id);
                const label = categoryLabel(voice.category);
                const previewTitle = free
                  ? `Preview ${shortVoiceName(voice.name)} (free sample)`
                  : ready
                    ? `Replay the generated sample of ${shortVoiceName(voice.name)} (already paid for)`
                    : `Generate a short sample of ${shortVoiceName(voice.name)} \u2014 billed as one short voiceover (\u201c${PREVIEW_SAMPLE_LINE.slice(0, 32)}\u2026\u201d)`;
                return <li key={voice.id} className={selected
                  ? 'flex items-center gap-2 rounded-xl border-2 border-[#8b5cf6] bg-[color-mix(in_srgb,#8b5cf6_12%,transparent)] p-2.5'
                  : voice.indian
                    ? 'flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,#f59e0b_48%,transparent)] bg-[color-mix(in_srgb,#f59e0b_7%,transparent)] p-2.5 hover:border-[#6366f1]'
                    : 'flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] p-2.5 hover:border-[#6366f1]'}>
                  <button type="button" onClick={() => onChange(voice.id)} aria-pressed={selected} disabled={disabled} className="min-w-0 flex-1 text-left disabled:opacity-60">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-[var(--space-text-primary)]">{shortVoiceName(voice.name)}</span>
                      {label ? <span className={voice.category === 'cloned'
                        ? 'shrink-0 rounded-full bg-[color-mix(in_srgb,#34d399_22%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6ee7b7]'
                        : 'shrink-0 rounded-full bg-[color-mix(in_srgb,#ffffff_8%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]'}>{label}</span> : null}
                      {voice.indian ? <span title={voice.indianReason} className="shrink-0 rounded-full bg-[color-mix(in_srgb,#f59e0b_26%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#fcd34d]">{'\u{1F1EE}\u{1F1F3}'} India</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--space-text-muted)]">{voice.descriptor || (voice.category === 'cloned' ? 'Cloned from your own samples' : 'ElevenLabs voice')}</span>
                  </button>
                  <button type="button" onClick={() => void preview(voice)} disabled={sampling || Boolean(samplingId && !playing)} aria-label={previewTitle} title={previewTitle} className={ICON_BUTTON}>
                    {sampling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {!free && !ready ? <span className="text-[9px] font-bold uppercase tracking-wide text-[#fcd34d]">Billed</span> : null}
                  </button>
                  {renderActions ? renderActions(voice) : null}
                  {selected ? <Check className="h-4 w-4 shrink-0 text-[#a78bfa]" /> : null}
                </li>;
              })}
            </ul>
          </>}

    {sampleError ? <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] px-3 py-2 text-xs text-[var(--space-text-secondary)]">{sampleError}</p> : null}
  </div>;
}
