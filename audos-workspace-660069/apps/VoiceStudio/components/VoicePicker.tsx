// The voice dropdown shared by Text to Speech, Speech to Speech and Avatar
// Lip-Sync. Indian voices are badged and sorted first, this workspace's cloned
// voices come next, and any voice can be auditioned from its real ElevenLabs
// sample before a single credit is spent.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Flag, Loader2, Play, RefreshCw, Search, Square } from 'lucide-react';
import { setVoiceOverride, sortVoices, type Voice } from '../lib/elevenlabs';
import { Badge, Field, Skeleton, T } from './Ui';

export function VoicePicker({
  voices,
  loading,
  error,
  value,
  onChange,
  onReload,
  onVoicesChange,
}: {
  voices: Voice[];
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (voiceId: string) => void;
  onReload: () => void;
  onVoicesChange: (voices: Voice[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [indianOnly, setIndianOnly] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return voices.filter((voice) => {
      if (indianOnly && !voice.indian) return false;
      if (!needle) return true;
      return `${voice.name} ${voice.accent || ''} ${voice.description || ''} ${voice.category}`.toLowerCase().includes(needle);
    });
  }, [voices, query, indianOnly]);

  const indianCount = voices.filter((voice) => voice.indian).length;

  const preview = (voice: Voice) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewing === voice.id) {
      audio.pause();
      setPreviewing(null);
      return;
    }
    if (!voice.previewUrl) return;
    audio.src = voice.previewUrl;
    audio.play().then(() => setPreviewing(voice.id)).catch(() => setPreviewing(null));
  };

  const flag = (voice: Voice) => {
    const next = !voice.indian;
    setVoiceOverride(voice.id, next);
    onVoicesChange(sortVoices(voices.map((entry) => (entry.id === voice.id ? { ...entry, indian: next } : entry))));
  };

  return (
    <Field label="Voice" hint={loading ? 'Loading catalog…' : `${voices.length} available`}>
      <div className="rounded-xl" style={{ background: T.inset, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: T.border }}>
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: T.textMuted }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or accent…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: T.text }}
          />
          {indianCount > 0 ? (
            <button
              type="button"
              onClick={() => setIndianOnly((prev) => !prev)}
              className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: indianOnly ? T.accent : T.accentSoft,
                color: indianOnly ? '#FFFFFF' : T.accentBright,
                border: `1px solid ${T.accentLine}`,
              }}
            >
              🇮🇳 Indian only ({indianCount})
            </button>
          ) : null}
          <button type="button" onClick={onReload} aria-label="Reload voices" className="shrink-0">
            <RefreshCw className="h-3.5 w-3.5" style={{ color: T.textMuted }} />
          </button>
        </div>

        <div className="vs-scroll max-h-64 overflow-y-auto p-1.5">
          {loading ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <p className="px-2 py-6 text-center text-[13px] leading-relaxed" style={{ color: T.danger }}>
              {error}
            </p>
          ) : !filtered.length ? (
            <p className="px-2 py-6 text-center text-[13px]" style={{ color: T.textMuted }}>
              No voice matches that search.
            </p>
          ) : (
            filtered.map((voice) => {
              const selected = voice.id === value;
              return (
                <div
                  key={voice.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  style={{ background: selected ? T.accentSoft : 'transparent' }}
                >
                  <button type="button" onClick={() => onChange(voice.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-full"
                      style={{ border: `1px solid ${selected ? T.accent : T.borderStrong}`, background: selected ? T.accent : 'transparent' }}
                    >
                      {selected ? <Check className="h-2.5 w-2.5" style={{ color: '#FFFFFF' }} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm" style={{ color: T.text }}>
                          {voice.name}
                        </span>
                        {voice.indian ? <span className="shrink-0 text-xs">🇮🇳</span> : null}
                        {voice.category === 'cloned' ? <Badge tone="success">Cloned</Badge> : null}
                      </span>
                      {voice.accent || voice.gender ? (
                        <span className="block truncate text-[11px]" style={{ color: T.textMuted }}>
                          {[voice.accent, voice.gender].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => flag(voice)}
                    aria-label={voice.indian ? 'Remove from Indian voices' : 'Add to Indian voices'}
                    title={voice.indian ? 'Remove the Indian badge' : 'Flag this as an Indian voice'}
                    className="shrink-0 p-1"
                  >
                    <Flag className="h-3.5 w-3.5" style={{ color: voice.indian ? T.accentBright : T.textMuted }} />
                  </button>
                  {voice.previewUrl ? (
                    <button type="button" onClick={() => preview(voice)} aria-label="Preview voice" className="shrink-0 p-1">
                      {previewing === voice.id ? (
                        <Square className="h-3.5 w-3.5" style={{ color: T.accentBright }} />
                      ) : (
                        <Play className="h-3.5 w-3.5" style={{ color: T.textMuted }} />
                      )}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
      <audio ref={audioRef} className="hidden" onEnded={() => setPreviewing(null)} onPause={() => setPreviewing(null)} />
    </Field>
  );
}

export function VoiceLoadingHint({ busy, label }: { busy: boolean; label: string }) {
  if (!busy) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: T.textMuted }}>
      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
      {label}
    </span>
  );
}
