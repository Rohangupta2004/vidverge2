import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, Search } from 'lucide-react';
import { HeygenUnavailableError, heygenErrorMessage, listHeygenVoices } from '../lib/heygen';
import type { HeygenVoice } from '../lib/heygen';

interface HeygenVoicePickerProps {
  /** The catalog is only fetched once the section has actually been opened. */
  active: boolean;
  selected: HeygenVoice | null;
  onSelect: (voice: HeygenVoice | null) => void;
}

type GenderFilter = 'all' | 'male' | 'female';

const GENDERS: { id: GenderFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e'];

export default function HeygenVoicePicker({ active, selected, onSelect }: HeygenVoicePickerProps) {
  const [voices, setVoices] = useState<HeygenVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [playing, setPlaying] = useState('');
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    let cancelled = false;
    setLoading(true);
    setError('');
    setNotice('');

    listHeygenVoices()
      .then((rows) => {
        if (!cancelled) setVoices(rows);
      })
      .catch((cause) => {
        if (cancelled) return;
        loaded.current = false;
        if (cause instanceof HeygenUnavailableError) setNotice(cause.message);
        else setError(heygenErrorMessage(cause, 'Could not load the HeyGen voices.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, attempt]);

  useEffect(
    () => () => {
      if (audio.current) audio.current.pause();
    },
    [],
  );

  function togglePreview(voice: HeygenVoice) {
    if (!voice.previewAudio) return;
    if (audio.current) audio.current.pause();
    if (playing === voice.id) {
      setPlaying('');
      return;
    }
    const player = new Audio(voice.previewAudio);
    player.onended = () => setPlaying('');
    player.onerror = () => setPlaying('');
    audio.current = player;
    setPlaying(voice.id);
    void player.play().catch(() => setPlaying(''));
  }

  const term = query.trim().toLowerCase();
  const visible = voices.filter((voice) => {
    if (gender !== 'all' && voice.gender.toLowerCase() !== gender) return false;
    if (!term) return true;
    return `${voice.name} ${voice.language}`.toLowerCase().includes(term);
  });

  if (notice) {
    return <p className="text-[12px] text-[var(--vv-text-dim)]">{notice}</p>;
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="vv-skeleton h-11 rounded-xl border border-[var(--vv-border)]" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--vv-error)]">{error}</p>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="shrink-0 rounded-full border border-[var(--vv-border)] px-3 py-1 text-[11px] text-[#3D2800] transition-colors hover:text-[#1A1000]"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex min-w-[160px] flex-1 items-center gap-2 rounded-full border border-[var(--vv-border)] px-3 py-1.5">
          <Search size={13} className="shrink-0 text-[#A08B5F]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search voices or language"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#1A1000] outline-none placeholder:text-[#A08B5F]"
            aria-label="Search HeyGen voices"
          />
        </span>

        <span className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--vv-border)] p-0.5">
          {GENDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGender(option.id)}
              className="rounded-full px-2.5 py-1 text-[11px] transition-colors"
              style={
                gender === option.id
                  ? { background: 'color-mix(in srgb, var(--vv-gold) 18%, transparent)', color: 'var(--vv-gold)' }
                  : { color: '#7A6030' }
              }
            >
              {option.label}
            </button>
          ))}
        </span>

        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 rounded-full border border-[var(--vv-border)] px-3 py-1.5 text-[11px] text-[#3D2800] transition-colors hover:text-[#1A1000]"
          >
            Skip voice
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-[12px] text-[var(--vv-text-dim)]">
          {voices.length ? 'No voice matches those filters.' : 'This HeyGen account has no voices yet.'}
        </p>
      ) : (
        <ul className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1">
          {visible.slice(0, 150).map((voice) => {
            const chosen = selected?.id === voice.id;
            return (
              <li key={voice.id}>
                <div
                  className="flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors"
                  style={{
                    borderColor: chosen ? 'var(--vv-gold)' : 'var(--vv-border)',
                    background: chosen ? 'color-mix(in srgb, var(--vv-gold) 8%, transparent)' : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => togglePreview(voice)}
                    disabled={!voice.previewAudio}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--vv-border)] text-[#7A6030] transition-colors hover:text-[#1A1000] disabled:opacity-25"
                    aria-label={voice.previewAudio ? `Preview ${voice.name}` : 'No preview available'}
                    title={voice.previewAudio ? `Preview ${voice.name}` : 'No preview available'}
                  >
                    {playing === voice.id ? <Pause size={12} /> : <Play size={12} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelect(chosen ? null : voice)}
                    aria-pressed={chosen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[12.5px] text-[#1A1000]">{voice.name}</span>
                    <span className="block truncate text-[11px] text-[var(--vv-text-dim)]">
                      {voice.language}
                      {voice.gender ? ` · ${voice.gender}` : ''}
                    </span>
                  </button>

                  {chosen && (
                    <span className="shrink-0 text-[var(--vv-gold)]">
                      <Check size={14} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
