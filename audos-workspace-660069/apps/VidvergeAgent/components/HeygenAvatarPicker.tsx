import { useEffect, useRef, useState } from 'react';
import { Check, Search, User } from 'lucide-react';
import { HeygenUnavailableError, heygenErrorMessage, listHeygenAvatars } from '../lib/heygen';
import type { HeygenAvatar } from '../lib/heygen';

interface HeygenAvatarPickerProps {
  /** The catalog is only fetched once the section has actually been opened. */
  active: boolean;
  selected: HeygenAvatar | null;
  onSelect: (avatar: HeygenAvatar | null) => void;
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export default function HeygenAvatarPicker({ active, selected, onSelect }: HeygenAvatarPickerProps) {
  const [avatars, setAvatars] = useState<HeygenAvatar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    let cancelled = false;
    setLoading(true);
    setError('');
    setNotice('');

    listHeygenAvatars()
      .then((rows) => {
        if (!cancelled) setAvatars(rows);
      })
      .catch((cause) => {
        if (cancelled) return;
        loaded.current = false;
        if (cause instanceof HeygenUnavailableError) setNotice(cause.message);
        else setError(heygenErrorMessage(cause, 'Could not load the HeyGen characters.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, attempt]);

  const term = query.trim().toLowerCase();
  const visible = term
    ? avatars.filter((avatar) => `${avatar.name} ${avatar.gender}`.toLowerCase().includes(term))
    : avatars;

  if (notice) {
    return <p className="text-[12px] text-[var(--vv-text-dim)]">{notice}</p>;
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="vv-skeleton aspect-[3/4] rounded-xl border border-[var(--vv-border)]" />
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
          className="shrink-0 rounded-full border border-[var(--vv-border)] px-3 py-1 text-[11px] text-white/70 transition-colors hover:text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--vv-border)] px-3 py-1.5">
          <Search size={13} className="shrink-0 text-white/30" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search characters"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/30"
            aria-label="Search HeyGen characters"
          />
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 rounded-full border border-[var(--vv-border)] px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:text-white"
          >
            Skip character
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-[12px] text-[var(--vv-text-dim)]">
          {avatars.length ? 'No character matches that search.' : 'This HeyGen account has no characters yet.'}
        </p>
      ) : (
        <div className="max-h-[270px] overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {visible.slice(0, 120).map((avatar) => {
              const chosen = selected?.id === avatar.id;
              return (
                <button
                  key={`${avatar.kind}:${avatar.id}`}
                  type="button"
                  onClick={() => onSelect(chosen ? null : avatar)}
                  aria-pressed={chosen}
                  className="group relative overflow-hidden rounded-xl border text-left transition-colors"
                  style={{
                    borderColor: chosen ? 'var(--vv-gold)' : 'var(--vv-border)',
                    boxShadow: chosen ? '0 0 0 1px var(--vv-gold), 0 0 22px -10px var(--vv-gold-glow)' : 'none',
                  }}
                  title={avatar.name}
                >
                  <span className="block aspect-[3/4] w-full bg-white/[0.04]">
                    {avatar.previewImage ? (
                      <img
                        src={avatar.previewImage}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-white/20">
                        <User size={18} />
                      </span>
                    )}
                  </span>

                  {chosen && (
                    <span
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[#1a1203]"
                      style={{ background: 'var(--vv-gold)' }}
                    >
                      <Check size={12} />
                    </span>
                  )}

                  <span
                    className="absolute inset-x-0 bottom-0 block truncate px-2 py-1.5 text-[10px] text-white/85"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}
                  >
                    {avatar.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
