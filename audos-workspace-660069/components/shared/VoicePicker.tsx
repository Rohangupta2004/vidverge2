import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pause, Play, RefreshCw, Search } from 'lucide-react';
import {
  filterVoices,
  loadAllVoices,
  previewCosts,
  sampleFor,
  type Voice,
} from '../../lib/elevenLabsVoices';

export interface VoiceCatalogState {
  voices: Voice[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useVoiceCatalog(): VoiceCatalogState {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    loadAllVoices()
      .then((next) => {
        if (!live) return;
        setVoices(next);
        setLoading(false);
      })
      .catch((reason: any) => {
        if (!live) return;
        setError(String(reason?.message || 'The voice list could not be loaded.'));
        setLoading(false);
      });
    return () => { live = false; };
  }, [attempt]);

  return {
    voices,
    loading,
    error,
    reload: useCallback(() => setAttempt((value) => value + 1), []),
  };
}

export interface VoicePickerProps {
  value: string;
  onChange: (voiceId: string, voice: Voice) => void;
  catalog?: VoiceCatalogState;
  maxHeight?: number;
  disabled?: boolean;
  label?: string;
}

type FilterKey = 'gender' | 'accent' | 'language' | 'useCase';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'accent', label: 'Accent' },
  { key: 'language', label: 'Language' },
  { key: 'useCase', label: 'Use case' },
];

const CSS = `
.svp { display:flex; flex-direction:column; gap:12px; color:var(--space-text-primary); }
.svp * { box-sizing:border-box; }
.svp-search { position:relative; }
.svp-search svg { position:absolute; left:13px; top:50%; width:16px; height:16px; transform:translateY(-50%); color:var(--space-text-muted); pointer-events:none; }
.svp-search input, .svp-filter { width:100%; min-height:44px; border-radius:12px; border:1px solid var(--space-border-default); background:var(--space-surface-panel); color:var(--space-text-primary); font:inherit; outline:none; }
.svp-search input { padding:10px 14px 10px 40px; }
.svp-search input:focus, .svp-filter:focus { border-color:var(--space-brand-primary-500); box-shadow:0 0 0 3px color-mix(in srgb,var(--space-brand-primary-500) 18%,transparent); }
.svp-filters { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
.svp-filter-wrap { position:relative; }
.svp-filter { appearance:none; padding:9px 32px 9px 11px; font-size:12px; }
.svp-filter-wrap svg { position:absolute; right:10px; top:50%; width:14px; height:14px; transform:translateY(-50%); color:var(--space-text-muted); pointer-events:none; }
.svp-list { overflow-y:auto; overscroll-behavior:contain; border:1px solid var(--space-border-default); border-radius:14px; background:var(--space-surface-card); }
.svp-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; align-items:center; padding:11px 12px; border-bottom:1px solid var(--space-border-default); }
.svp-row:last-child { border-bottom:none; }
.svp-row.is-selected { background:color-mix(in srgb,var(--space-brand-primary-500) 12%,transparent); box-shadow:inset 3px 0 0 var(--space-brand-primary-500); }
.svp-name { display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:14px; font-weight:700; }
.svp-meta { display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; }
.svp-chip { border:1px solid var(--space-border-default); border-radius:999px; padding:2px 7px; background:var(--space-surface-muted); color:var(--space-text-secondary); font-size:10px; font-weight:600; }
.svp-chip.is-own { border-color:color-mix(in srgb,var(--space-brand-primary-500) 40%,transparent); color:var(--space-text-brand); }
.svp-button { display:inline-flex; min-height:44px; align-items:center; justify-content:center; gap:6px; border:1px solid var(--space-border-strong); border-radius:11px; padding:8px 11px; background:var(--space-surface-panel); color:var(--space-text-primary); font:inherit; font-size:12px; font-weight:700; cursor:pointer; }
.svp-button:hover { border-color:var(--space-brand-primary-500); }
.svp-button.primary { border-color:var(--space-brand-primary-600); background:var(--space-brand-primary-600); color:white; }
.svp-button:disabled { cursor:not-allowed; opacity:.55; }
.svp-empty { padding:24px 14px; text-align:center; color:var(--space-text-secondary); font-size:13px; line-height:1.5; }
.svp-note { margin:0; color:var(--space-text-muted); font-size:11px; line-height:1.5; }
.svp-error { color:var(--space-semantic-danger-500); }
@media (max-width:767px) { .svp-filters { grid-template-columns:repeat(2,minmax(0,1fr)); } .svp-row { grid-template-columns:minmax(0,1fr) auto; } .svp-row .svp-button.primary { grid-column:1/-1; width:100%; } }
`;

function clean(value: unknown): string {
  return String(value || '').trim();
}

function valuesFor(voices: Voice[], key: FilterKey): string[] {
  const values = new Map<string, string>();
  voices.forEach((voice) => {
    const value = clean(voice[key]);
    if (!value) return;
    const normalized = value.toLowerCase();
    if (!values.has(normalized)) values.set(normalized, value);
  });
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}

function tagsFor(voice: Voice): string[] {
  return [voice.category === 'cloned' ? 'Your voice' : '', voice.gender, voice.accent, voice.language, voice.useCase]
    .map(clean)
    .filter(Boolean);
}

export default function VoicePicker({
  value,
  onChange,
  catalog,
  maxHeight = 360,
  disabled = false,
  label = 'Voice',
}: VoicePickerProps) {
  const ownCatalog = useVoiceCatalog();
  const source = catalog || ownCatalog;
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ gender: '', accent: '', language: '', useCase: '' });
  const [playingId, setPlayingId] = useState('');
  const [loadingSample, setLoadingSample] = useState('');
  const [sampleError, setSampleError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const shown = useMemo(() => filterVoices(source.voices, query).filter((voice) => (
    FILTERS.every(({ key }) => !filters[key] || clean(voice[key]).toLowerCase() === filters[key].toLowerCase())
  )), [source.voices, query, filters]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const preview = useCallback(async (voice: Voice) => {
    setSampleError('');
    if (playingId === voice.id && audioRef.current) {
      audioRef.current.pause();
      setPlayingId('');
      return;
    }
    audioRef.current?.pause();
    setLoadingSample(voice.id);
    try {
      const url = await sampleFor(voice);
      const audio = new Audio(url);
      audio.onended = () => setPlayingId('');
      audio.onerror = () => {
        setPlayingId('');
        setSampleError(`${voice.name} could not be played. Try another voice.`);
      };
      audioRef.current = audio;
      await audio.play();
      setPlayingId(voice.id);
    } catch (reason: any) {
      setSampleError(String(reason?.message || 'That sample could not be played.'));
    } finally {
      setLoadingSample('');
    }
  }, [playingId]);

  return (
    <section className="svp" aria-label={`${label} picker`}>
      <style>{CSS}</style>
      <div className="svp-search">
        <Search />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={source.loading ? 'Loading voices…' : 'Search voices by name, accent, language or use case'}
          aria-label="Search voices"
          disabled={disabled}
        />
      </div>

      <div className="svp-filters" aria-label="Voice filters">
        {FILTERS.map(({ key, label: filterLabel }) => {
          const options = valuesFor(source.voices, key);
          return (
            <div className="svp-filter-wrap" key={key}>
              <select
                className="svp-filter"
                aria-label={`Filter by ${filterLabel.toLowerCase()}`}
                value={filters[key]}
                onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
                disabled={disabled || source.loading}
              >
                <option value="">All {filterLabel.toLowerCase()}s</option>
                {options.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
              <ChevronDown />
            </div>
          );
        })}
      </div>

      <div className="svp-list" style={{ maxHeight }}>
        {source.loading ? (
          <div className="svp-empty"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading voices…</div>
        ) : source.error ? (
          <div className="svp-empty svp-error">
            <div>{source.error}</div>
            <button type="button" className="svp-button" style={{ marginTop: 10 }} onClick={source.reload}>
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : !shown.length ? (
          <div className="svp-empty">No voices match those filters. Clear a filter or try another search.</div>
        ) : shown.map((voice) => {
          const selected = voice.id === value;
          const playing = playingId === voice.id;
          const sampling = loadingSample === voice.id;
          return (
            <article className={`svp-row${selected ? ' is-selected' : ''}`} key={voice.id}>
              <div className="min-w-0">
                <div className="svp-name">{voice.name}{selected ? <Check className="h-4 w-4 text-[var(--space-text-brand)]" /> : null}</div>
                <div className="svp-meta">
                  {tagsFor(voice).map((tag) => <span className={`svp-chip${tag === 'Your voice' ? ' is-own' : ''}`} key={tag}>{tag}</span>)}
                </div>
              </div>
              <button
                type="button"
                className="svp-button"
                disabled={disabled || sampling}
                onClick={() => void preview(voice)}
                title={previewCosts(voice) ? 'Creates one short billed sample, then reuses it for this session.' : `Play ${voice.name}`}
              >
                {sampling ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? 'Pause' : 'Play preview'}
              </button>
              <button
                type="button"
                className="svp-button primary"
                disabled={disabled || selected}
                onClick={() => onChange(voice.id, voice)}
              >
                {selected ? 'Selected' : 'Use this voice'}
              </button>
            </article>
          );
        })}
      </div>

      {sampleError ? <p className="svp-note svp-error" role="alert">{sampleError}</p> : null}
      {!source.loading && !source.error ? <p className="svp-note">Showing {shown.length} of {source.voices.length} available voices.</p> : null}
    </section>
  );
}
