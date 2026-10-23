/**
 * Voice chooser for the Script-to-Video voiceover step.
 *
 * The chosen voice is shown first, with a single "Change voice" control. The
 * search, filters and results stay collapsed until it is opened, and the
 * results are paged instead of living in a nested scroller. It reads the same
 * voice catalog and plays the same samples as components/shared/VoicePicker —
 * only the layout differs, so the shared picker (used outside this app) is left
 * untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Pause, Play, RefreshCw, Search, X } from 'lucide-react';
import { filterVoices, previewCosts, sampleFor, type Voice } from '../../lib/elevenLabsVoices';
import type { VoiceCatalogState } from '../../components/shared/VoicePicker';
import { SelectField } from './audioUi';

type FilterKey = 'gender' | 'accent' | 'language' | 'useCase';

/** The same four facets the shared picker filters on. */
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'accent', label: 'Accent' },
  { key: 'language', label: 'Language' },
  { key: 'useCase', label: 'Use case' },
];

/** Rows shown per page: five rows of ~64px match the 260px list height this
 * step used before (AudioCards passed maxHeight={260} to the shared picker). */
const PAGE_SIZE = 5;

const CSS = `
.s2v-vc { display: flex; flex-direction: column; gap: 12px; }
.s2v-vc-search { position: relative; }
.s2v-vc-search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--vg-muted); pointer-events: none; }
.s2v-vc-search input { padding-left: 40px; }
.s2v-vc-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.s2v-vc-filter { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.s2v-vc-list { display: flex; flex-direction: column; }
.s2v-vc-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border-bottom: 1px solid var(--vg-border); }
.s2v-vc-row:last-child { border-bottom: 0; }
.s2v-vc-row.is-selected { border-radius: 10px; background: var(--vg-gradient-selected); box-shadow: inset 3px 0 0 var(--vg-accent); }
.s2v-vc-info { flex: 1 1 180px; min-width: 0; }
.s2v-vc-name { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 14px; font-weight: 700; color: var(--vg-text); }
.s2v-vc-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s2v-vc-own { flex-shrink: 0; padding: 1px 7px; border: 1px solid color-mix(in srgb, var(--vg-accent) 45%, transparent); border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--vg-accent); }
.s2v-vc-tags { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--vg-secondary); }
.s2v-vc-more { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
`;

function clean(value: unknown): string {
  return String(value || '').trim();
}

function valuesFor(voices: Voice[], key: FilterKey): string[] {
  const values = new Map<string, string>();
  voices.forEach((voice) => {
    const value = clean(voice[key]);
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  });
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}

function tagLine(voice: Voice): string {
  return [voice.gender, voice.accent, voice.language, voice.useCase].map(clean).filter(Boolean).join(' · ');
}

function useVoicePreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef('');
  const [playingId, setPlayingId] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const toggle = useCallback(async (voice: Voice) => {
    setError('');
    if (playingRef.current === voice.id && audioRef.current) {
      audioRef.current.pause();
      playingRef.current = '';
      setPlayingId('');
      return;
    }
    audioRef.current?.pause();
    playingRef.current = '';
    setPlayingId('');
    setLoadingId(voice.id);
    try {
      const url = await sampleFor(voice);
      const audio = new Audio(url);
      audio.onended = () => { playingRef.current = ''; setPlayingId(''); };
      audio.onerror = () => {
        playingRef.current = ''; setPlayingId('');
        setError(`${voice.name} could not be played. Try another voice.`);
      };
      audioRef.current = audio;
      await audio.play();
      playingRef.current = voice.id;
      setPlayingId(voice.id);
    } catch (reason: any) {
      setError(String(reason?.message || 'That sample could not be played.'));
    } finally {
      setLoadingId('');
    }
  }, []);

  return { playingId, loadingId, error, toggle };
}

function PreviewButton(props: { voice: Voice; preview: ReturnType<typeof useVoicePreview>; disabled: boolean }) {
  const { voice, preview } = props;
  const playing = preview.playingId === voice.id;
  const loading = preview.loadingId === voice.id;
  return (
    <button
      type="button"
      className="s2v-au-btn"
      disabled={props.disabled || loading}
      onClick={() => void preview.toggle(voice)}
      aria-label={`${playing ? 'Pause' : 'Preview'} ${voice.name}`}
      title={previewCosts(voice) ? 'Creates one short billed sample, then reuses it for this session.' : `Play a sample of ${voice.name}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : playing ? <Pause size={16} /> : <Play size={16} />}
      {playing ? 'Pause' : 'Preview'}
    </button>
  );
}

export default function VoiceChooser(props: {
  catalog: VoiceCatalogState;
  /** The voice id stored on the film's voice plan ('' before one is chosen). */
  value: string;
  /** The stored name, shown while the catalog is still loading or if the voice has left it. */
  valueName?: string;
  disabled?: boolean;
  onChange: (voiceId: string, voice: Voice) => void;
}) {
  const { catalog, value } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ gender: '', accent: '', language: '', useCase: '' });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const preview = useVoicePreview();

  const current = catalog.voices.find((voice) => voice.id === value) || null;
  const filtersActive = FILTERS.some(({ key }) => filters[key]);
  const active = filtersActive || query.trim() !== '';

  const matches = useMemo(() => filterVoices(catalog.voices, query).filter((voice) => (
    FILTERS.every(({ key }) => !filters[key] || clean(voice[key]).toLowerCase() === filters[key].toLowerCase())
  )), [catalog.voices, query, filters]);
  const shown = matches.slice(0, limit);
  const anyBilled = shown.some((voice) => previewCosts(voice));

  const reset = () => { setQuery(''); setFilters({ gender: '', accent: '', language: '', useCase: '' }); setLimit(PAGE_SIZE); };
  const toggleOpen = () => { setOpen((v) => !v); setLimit(PAGE_SIZE); };

  const currentName = current?.name || clean(props.valueName);

  return (
    <section className="s2v-vc" aria-label="Narration voice">
      <style>{CSS}</style>
      <div className="s2v-au-item">
        <div className="s2v-au-item-main">
          <div className="s2v-au-item-text">
            <div className="s2v-au-label">Narration voice</div>
            <div className="s2v-au-item-title" title={currentName || undefined}>{currentName || 'No voice chosen yet'}</div>
            <div className="s2v-au-item-sub">
              {current ? [current.category === 'cloned' ? 'Your voice' : '', tagLine(current)].filter(Boolean).join(' · ') || 'Catalog voice'
                : currentName ? (catalog.loading ? 'Loading voice details…' : catalog.error ? 'Voice details unavailable' : 'Not in the current catalog')
                  : 'The audio plan picks one when narration is generated, or choose one now.'}
            </div>
          </div>
        </div>
        <div className="s2v-au-actions">
          {current ? <PreviewButton voice={current} preview={preview} disabled={!!props.disabled} /> : null}
          <button type="button" className="s2v-au-btn" aria-expanded={open} onClick={toggleOpen} disabled={props.disabled}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {open ? 'Close' : 'Change voice'}
          </button>
        </div>
      </div>

      {open ? (
        <>
          <div className="s2v-vc-search">
            <Search size={16} />
            <input
              type="search"
              className="s2v-au-field"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
              placeholder={catalog.loading ? 'Loading voices…' : 'Search by name, accent or use case'}
              aria-label="Search voices"
              disabled={props.disabled || !!catalog.error}
            />
          </div>
          <div className="s2v-vc-filters">
            {FILTERS.map(({ key, label }) => (
              <label className="s2v-vc-filter" key={key}>
                <span className="s2v-au-label">{label}</span>
                <SelectField
                  value={filters[key]}
                  onChange={(event) => { setFilters((currentFilters) => ({ ...currentFilters, [key]: event.target.value })); setLimit(PAGE_SIZE); }}
                  disabled={props.disabled || catalog.loading || !!catalog.error}
                >
                  <option value="">Any</option>
                  {valuesFor(catalog.voices, key).map((option) => <option value={option} key={option}>{option}</option>)}
                </SelectField>
              </label>
            ))}
          </div>

          {catalog.loading ? (
            <p className="s2v-au-msg"><Loader2 size={14} className="animate-spin" style={{ display: 'inline', verticalAlign: '-2px' }} /> Loading voices…</p>
          ) : catalog.error ? (
            <div className="s2v-au-alert" role="alert">
              <X size={16} />
              <span>{catalog.error}</span>
              <button type="button" className="s2v-au-btn" style={{ marginLeft: 'auto' }} onClick={catalog.reload}><RefreshCw size={14} /> Try again</button>
            </div>
          ) : !shown.length ? (
            <div className="s2v-au-item">
              <p className="s2v-au-msg" style={{ flex: '1 1 200px' }}>No voices match{active ? ' those filters' : ''}.</p>
              {active ? <button type="button" className="s2v-au-btn" onClick={reset}>Reset filters</button> : null}
            </div>
          ) : (
            <>
              <div className="s2v-vc-list" role="list">
                {shown.map((voice) => {
                  const selected = voice.id === value;
                  return (
                    <div className={`s2v-vc-row${selected ? ' is-selected' : ''}`} role="listitem" key={voice.id}>
                      <div className="s2v-vc-info">
                        <div className="s2v-vc-name">
                          <span className="s2v-vc-name-text" title={voice.name}>{voice.name}</span>
                          {voice.category === 'cloned' ? <span className="s2v-vc-own">Your voice</span> : null}
                        </div>
                        <div className="s2v-vc-tags" title={tagLine(voice) || undefined}>{tagLine(voice) || 'No details listed'}</div>
                      </div>
                      <div className="s2v-au-actions">
                        <PreviewButton voice={voice} preview={preview} disabled={!!props.disabled} />
                        <button
                          type="button"
                          className={`s2v-au-btn${selected ? '' : ' is-primary'}`}
                          disabled={props.disabled || selected}
                          onClick={() => { props.onChange(voice.id, voice); setOpen(false); }}
                        >
                          {selected ? <><Check size={16} /> Selected</> : 'Use voice'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="s2v-vc-more">
                <p className="s2v-au-help">
                  Showing {shown.length} of {matches.length} {active ? 'matching' : 'available'} voices.
                </p>
                <div className="s2v-au-actions">
                  {active ? <button type="button" className="s2v-au-btn" onClick={reset}>Reset filters</button> : null}
                  {matches.length > shown.length ? (
                    <button type="button" className="s2v-au-btn" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                      Show {Math.min(PAGE_SIZE, matches.length - shown.length)} more
                    </button>
                  ) : null}
                </div>
              </div>
              {anyBilled ? <p className="s2v-au-help">Some listed voices have no stock sample; previewing them creates a short sample that uses credits.</p> : null}
            </>
          )}
        </>
      ) : null}
      {preview.error ? <p className="s2v-au-msg" role="alert" style={{ color: 'var(--vg-danger)' }}>{preview.error}</p> : null}
    </section>
  );
}
