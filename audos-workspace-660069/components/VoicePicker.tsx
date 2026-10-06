/**
 * VOICE PICKER — the shared ElevenLabs voice chooser.
 *
 * A scrollable PANEL rather than a dropdown, deliberately: the catalog runs to
 * dozens of voices plus this workspace's own clones, and a native <select>
 * gives no room for the labels or the sample that make one voice choosable
 * over another. Nothing here caps or pages the list — every voice the platform
 * returns is rendered, and the search box is how a long list gets narrowed.
 *
 * No ElevenLabs API key is involved. The catalog and the samples come from the
 * platform's managed endpoints via lib/elevenLabsVoices.ts, authenticated with
 * the workspace token.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pause, Play, RefreshCw, Search } from 'lucide-react';
import { colors } from './design-system/index';
import {
  filterVoices, loadAllVoices, previewCosts, sampleFor, voiceTags,
} from '../lib/elevenLabsVoices';
import type { Voice } from '../lib/elevenLabsVoices';

export interface VoiceCatalogState {
  voices: Voice[];
  loading: boolean;
  error: string;
  reload: () => void;
}

/** Load the full voice catalog once per mount. */
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
      .then((list) => {
        if (!live) return;
        setVoices(list);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!live) return;
        setError(String(e?.message || 'The voice list could not be loaded.'));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { voices, loading, error, reload };
}

const CSS = `
.vp-wrap { display: flex; flex-direction: column; gap: 10px; }
.vp-search { position: relative; }
.vp-search svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px;
  color: ${colors.textDim}; pointer-events: none; }
.vp-search input { width: 100%; min-height: 42px; padding: 10px 12px 10px 34px; border-radius: 10px; font: inherit;
  font-size: 13.5px; color: ${colors.textPrimary}; background: ${colors.bgGlass};
  border: 1px solid ${colors.borderSubtle}; outline: none; }
.vp-search input::placeholder { color: ${colors.textDim}; }
.vp-search input:focus { border-color: ${colors.borderActive}; background: ${colors.bgGlassHover}; }

.vp-panel { overflow-y: auto; overscroll-behavior: contain; border-radius: 12px;
  border: 1px solid ${colors.borderSubtle}; background: ${colors.bgGlass}; }
.vp-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; text-align: left;
  background: none; border: none; border-bottom: 1px solid ${colors.borderSubtle}; cursor: pointer;
  color: ${colors.textPrimary}; font: inherit; }
.vp-row:last-child { border-bottom: none; }
.vp-row:hover { background: ${colors.bgGlassHover}; }
.vp-row.is-on { background: color-mix(in srgb, ${colors.beamPrimary} 11%, transparent); }
.vp-name { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.vp-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.vp-tag { font-size: 10.5px; font-weight: 600; letter-spacing: .02em; padding: 2px 7px; border-radius: 999px;
  color: ${colors.textSecondary}; background: ${colors.bgGlassHover}; border: 1px solid ${colors.borderSubtle}; }
.vp-tag.is-clone { color: ${colors.beamPrimary};
  background: color-mix(in srgb, ${colors.beamPrimary} 12%, transparent);
  border-color: color-mix(in srgb, ${colors.beamPrimary} 36%, transparent); }
.vp-preview { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  min-width: 44px; min-height: 36px; padding: 0 10px; border-radius: 999px; cursor: pointer; font-size: 11.5px;
  font-weight: 700; color: ${colors.textSecondary}; background: ${colors.bgGlass};
  border: 1px solid ${colors.borderSubtle}; }
.vp-preview:hover { color: ${colors.beamPrimary}; border-color: ${colors.borderActive}; }
.vp-tick { flex: 0 0 auto; width: 18px; color: ${colors.beamPrimary}; }
.vp-note { font-size: 12px; line-height: 1.5; color: ${colors.textSecondary}; }
.vp-empty { padding: 18px 14px; text-align: center; font-size: 13px; color: ${colors.textSecondary}; }
`;

export interface VoicePickerProps {
  /** Currently chosen voice id. */
  value: string;
  onChange: (voiceId: string, voice: Voice) => void;
  /** Height of the scrolling panel in pixels. */
  maxHeight?: number;
  /** Pre-loaded catalog, when the parent already holds one. */
  catalog?: VoiceCatalogState;
}

export default function VoicePicker({ value, onChange, maxHeight = 300, catalog }: VoicePickerProps) {
  const own = useVoiceCatalog();
  const { voices, loading, error, reload } = catalog || own;

  const [query, setQuery] = useState('');
  const [playingId, setPlayingId] = useState('');
  const [loadingSample, setLoadingSample] = useState('');
  const [sampleError, setSampleError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const shown = useMemo(() => filterVoices(voices, query), [voices, query]);

  // One element for the whole panel, so starting a sample always stops the
  // previous one instead of layering two voices over each other.
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const preview = useCallback(async (voice: Voice) => {
    setSampleError('');
    const current = audioRef.current;
    if (playingId === voice.id && current) {
      current.pause();
      setPlayingId('');
      return;
    }
    current?.pause();

    setLoadingSample(voice.id);
    try {
      const url = await sampleFor(voice);
      const audio = new Audio(url);
      audio.onended = () => setPlayingId('');
      audio.onerror = () => {
        setPlayingId('');
        setSampleError(`${voice.name} could not be played.`);
      };
      audioRef.current = audio;
      await audio.play();
      setPlayingId(voice.id);
    } catch (e: any) {
      setSampleError(String(e?.message || 'That sample could not be played.'));
    } finally {
      setLoadingSample('');
    }
  }, [playingId]);

  return (
    <div className="vp-wrap">
      <style>{CSS}</style>

      <div className="vp-search">
        <Search />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? 'Loading voices…' : `Search ${voices.length} voices by name, accent or gender…`}
          aria-label="Search voices"
        />
      </div>

      <div className="vp-panel" style={{ maxHeight }}>
        {loading ? (
          <div className="vp-empty">
            <Loader2 className="w-4 h-4 animate-spin" style={{ display: 'inline-block', verticalAlign: '-2px' }} />
            {' '}Loading every available voice…
          </div>
        ) : error ? (
          <div className="vp-empty">
            <div>{error}</div>
            <button type="button" className="vp-preview" style={{ marginTop: 10 }} onClick={reload}>
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          </div>
        ) : !shown.length ? (
          <div className="vp-empty">No voice matches “{query}”.</div>
        ) : (
          shown.map((voice) => {
            const chosen = voice.id === value;
            return (
              <div
                key={voice.id}
                className={`vp-row${chosen ? ' is-on' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                onClick={() => onChange(voice.id, voice)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(voice.id, voice);
                  }
                }}
              >
                <span className="vp-tick">{chosen ? <Check className="w-4 h-4" /> : null}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="vp-name">{voice.name}</span>
                  <span className="vp-tags">
                    {voiceTags(voice).map((tag) => (
                      <span key={tag} className={`vp-tag${tag === 'Your clone' ? ' is-clone' : ''}`}>{tag}</span>
                    ))}
                  </span>
                </span>
                <button
                  type="button"
                  className="vp-preview"
                  title={previewCosts(voice)
                    ? 'This voice has no stock sample, so one short line is generated and billed once.'
                    : `Hear ${voice.name}`}
                  onClick={(e) => {
                    // The row itself selects; the button must only audition.
                    e.stopPropagation();
                    void preview(voice);
                  }}
                >
                  {loadingSample === voice.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : playingId === voice.id ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Preview
                </button>
              </div>
            );
          })
        )}
      </div>

      {sampleError ? <p className="vp-note" style={{ color: colors.error }}>{sampleError}</p> : null}
      {!loading && !error ? (
        <p className="vp-note">
          {shown.length === voices.length
            ? `${voices.length} voices available · your cloned voices are listed first.`
            : `${shown.length} of ${voices.length} voices match.`}
        </p>
      ) : null}
    </div>
  );
}
