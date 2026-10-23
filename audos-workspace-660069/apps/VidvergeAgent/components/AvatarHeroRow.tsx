import { useEffect, useState } from 'react';
import { Check, User } from 'lucide-react';
import { HeygenUnavailableError, heygenErrorMessage, listHeygenAvatars } from '../lib/heygen';
import type { HeygenAvatar } from '../lib/heygen';

const ROW_CSS = `
.vv-hero-skeleton {
  background: linear-gradient(90deg, rgba(212,146,10,0.07), rgba(212,146,10,0.16), rgba(212,146,10,0.07));
  background-size: 220% 100%;
  animation: vv-hero-skeleton 1.4s ease-in-out infinite;
}
@keyframes vv-hero-skeleton {
  from { background-position: 180% 0; }
  to { background-position: -40% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .vv-hero-skeleton { animation: none; }
}
`;

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

interface AvatarHeroRowProps {
  selected: HeygenAvatar | null;
  onSelect: (avatar: HeygenAvatar | null) => void;
  /**
   * Reports whether a character can actually be picked. When HeyGen is not
   * connected (or the catalog cannot load) the hub waives the requirement so
   * briefs still route to the studios.
   */
  onAvailability: (available: boolean) => void;
}

/**
 * THE REQUIRED FIRST STEP of the hub: a horizontally scrollable row of HeyGen
 * characters shown above the brief input. No accordion, no skip framing — the
 * locked character rides along with the brief on submit.
 */
export default function AvatarHeroRow({ selected, onSelect, onAvailability }: AvatarHeroRowProps) {
  const [avatars, setAvatars] = useState<HeygenAvatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setNotice('');

    listHeygenAvatars()
      .then((rows) => {
        if (cancelled) return;
        setAvatars(rows);
        onAvailability(rows.length > 0);
      })
      .catch((cause) => {
        if (cancelled) return;
        // Either way the requirement is waived so creation is never dead-ended.
        onAvailability(false);
        if (cause instanceof HeygenUnavailableError) setNotice(cause.message);
        else setError(heygenErrorMessage(cause, 'Could not load the HeyGen characters.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, onAvailability]);

  return (
    <section className="mb-4">
      <style>{ROW_CSS}</style>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9E8B55]">
          Step 1 · Pick your character
        </span>
        {selected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--vv-gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--vv-gold)_12%,transparent)] py-1 pl-1 pr-3 text-[11px] font-medium text-[var(--vv-gold)]">
            {selected.previewImage ? (
              <img src={selected.previewImage} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <User size={12} className="ml-1" />
            )}
            Character locked ✓
            <span className="max-w-[140px] truncate text-[#F5E9C8]">{selected.name}</span>
          </span>
        ) : notice ? null : (
          <span className="rounded-full border border-[var(--vv-border)] px-2 py-[2px] text-[9px] uppercase tracking-[0.18em] text-[#9E8B55]">
            Required
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex gap-2 overflow-hidden pb-1">
          {SKELETON_KEYS.map((key) => (
            <div key={key} className="vv-hero-skeleton aspect-[3/4] w-[84px] shrink-0 rounded-xl border border-[var(--vv-border)]" />
          ))}
        </div>
      ) : notice ? (
        <p className="rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-4 py-3 text-[12px] text-[var(--vv-text-dim)]">
          {notice} Briefs route to the studios without a character for now.
        </p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-4 py-3">
          <p className="text-[12px] text-[var(--vv-error)]">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="shrink-0 rounded-full border border-[var(--vv-border)] px-3 py-1 text-[11px] text-[#9E8B55] transition-colors hover:text-[#F5E9C8]"
          >
            Try again
          </button>
        </div>
      ) : avatars.length === 0 ? (
        <p className="rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-4 py-3 text-[12px] text-[var(--vv-text-dim)]">
          This HeyGen account has no characters yet.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2" role="listbox" aria-label="HeyGen characters">
          {avatars.slice(0, 80).map((avatar) => {
            const chosen = selected?.id === avatar.id;
            return (
              <button
                key={`${avatar.kind}:${avatar.id}`}
                type="button"
                role="option"
                aria-selected={chosen}
                onClick={() => onSelect(chosen ? null : avatar)}
                className="group relative w-[84px] shrink-0 overflow-hidden rounded-xl border text-left transition-colors"
                style={{
                  borderColor: chosen ? 'var(--vv-gold)' : 'var(--vv-border)',
                  boxShadow: chosen ? '0 0 0 1px var(--vv-gold), 0 0 22px -10px var(--vv-gold-glow)' : 'none',
                }}
                title={avatar.name}
              >
                <span className="block aspect-[3/4] w-full bg-[rgba(255,255,255,0.04)]">
                  {avatar.previewImage ? (
                    <img src={avatar.previewImage} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[#6E5F38]">
                      <User size={16} />
                    </span>
                  )}
                </span>

                {chosen && (
                  <span
                    className="absolute right-1 top-1 flex items-center justify-center rounded-full text-white"
                    style={{ background: 'var(--vv-gold)', height: 18, width: 18 }}
                  >
                    <Check size={11} />
                  </span>
                )}

                <span
                  className="absolute inset-x-0 bottom-0 block truncate px-1.5 py-1 text-[9.5px] text-white/85"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}
                >
                  {avatar.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
