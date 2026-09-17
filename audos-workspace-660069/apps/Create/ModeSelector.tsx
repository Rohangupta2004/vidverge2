/**
 * The mode selector: AUTO | Faceless | Avatar | UI Motion | Ad | Long Series.
 *
 * AUTO IS THE DEFAULT AND IT LOOKS LIKE IT. Most people do not know (and should
 * not have to work out) whether their brief wants a faceless explainer or an ad,
 * so the first button is the one that reads the brief and decides — and it is
 * the one that is highlighted until they deliberately pick something else.
 *
 * AVATAR DEGRADES HONESTLY. HeyGen needs a key on this workspace, and app code
 * cannot ask whether a secret exists — the only way to find out is to use it.
 * So the selector PROBES ONCE on mount (the verdict is latched for the whole
 * page in agenticEngines), and if the answer is no the Avatar button is disabled
 * with a tooltip that says why, rather than accepting the pick and failing
 * several minutes into a render.
 */
import { useEffect, useState } from 'react';
import {
  Layers,
  Megaphone,
  MousePointerClick,
  Trophy,
  UserRound,
  Wand2,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { heygenAvailability, probeHeyGen } from './agenticEngines';
import { VIDEO_MODES, type VideoMode } from './agenticTypes';
import { FONT, SectionLabel, T } from './ui';

const ICONS: Record<string, LucideIcon> = {
  Wand2,
  Waves,
  UserRound,
  MousePointerClick,
  Megaphone,
  Layers,
};

/**
 * Ask once whether HeyGen can render here. The probe is a real request, so it
 * is deliberately fired from a single place and its verdict reused everywhere
 * — see the latch in agenticEngines.probeHeyGen.
 */
export function useHeygenAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(heygenAvailability());
  useEffect(() => {
    if (available !== null) return;
    let alive = true;
    void probeHeyGen().then((verdict) => {
      if (alive) setAvailable(verdict);
    });
    return () => {
      alive = false;
    };
  }, [available]);
  return available;
}

export default function ModeSelector({
  value,
  onChange,
  compact,
  label = 'Mode',
  onSports,
  sportsSelected,
}: {
  value: VideoMode;
  onChange: (mode: VideoMode) => void;
  compact?: boolean;
  label?: string | null;
  /**
   * When provided, a SPORTS & EVENTS pill is appended to the selector. It is
   * a Track A studio mode (Omni Flash chained image-to-video), not an agentic
   * VideoMode, so it routes through this callback instead of onChange — the
   * agentic pipeline never sees it.
   */
  onSports?: () => void;
  sportsSelected?: boolean;
}) {
  const heygen = useHeygenAvailability();

  return (
    <div>
      {label ? <SectionLabel style={{ marginBottom: 10 }}>{label}</SectionLabel> : null}
      <div
        role="radiogroup"
        aria-label="Video mode"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
        data-testid="mode-selector"
      >
        {VIDEO_MODES.map((mode) => {
          const Icon = ICONS[mode.icon] || Wand2;
          const selected = value === mode.id;
          const isAuto = mode.id === 'auto';
          // Only a definite "no" disables the button. While the probe is still
          // in flight (null) the button stays live, because guessing either way
          // would either block a working workspace or promise a broken one.
          const blocked = mode.needsCredential === 'heygen' && heygen === false;
          const title = blocked
            ? 'Avatar needs a HEYGEN_API_KEY on this workspace. Ask Otto to add one — until then, AUTO renders your presenter on Veo instead.'
            : `${mode.engine} — ${mode.blurb}`;

          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={blocked}
              title={title}
              onClick={() => {
                if (!blocked) onChange(mode.id);
              }}
              className="rc-press rc-ring"
              data-testid={`mode-${mode.id}`}
              data-selected={selected ? 'true' : 'false'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                minHeight: 44,
                padding: compact ? '8px 13px' : '10px 16px',
                borderRadius: 999,
                fontFamily: FONT,
                fontSize: compact ? 12.5 : 13.5,
                fontWeight: isAuto ? 750 : 600,
                letterSpacing: isAuto ? 0.4 : 0,
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.42 : 1,
                color: selected ? '#fff' : isAuto ? T.accentFg : T.sub,
                // AUTO keeps a visible brand ring even when it is NOT selected,
                // so the recommended path is legible at a glance.
                border: selected
                  ? `1px solid ${T.accentBorder}`
                  : isAuto
                    ? `1px solid ${T.accentBorder}`
                    : `1px solid ${T.border}`,
                background: selected
                  ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%)'
                  : isAuto
                    ? T.accentSoft
                    : 'transparent',
                boxShadow: selected ? '0 8px 24px -12px rgba(37,99,235,0.8)' : 'none',
                transition: 'all .16s ease',
              }}
            >
              <Icon size={compact ? 13 : 14} />
              {mode.label}
              {blocked ? (
                <span style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.8 }}>· needs a key</span>
              ) : null}
            </button>
          );
        })}
        {onSports ? (
          <button
            type="button"
            role="radio"
            aria-checked={!!sportsSelected}
            title="Omni Flash chained — a multi-scene sports or event script, rendered scene by scene with the same character carried through every clip."
            onClick={onSports}
            className="rc-press rc-ring"
            data-testid="mode-sports"
            data-selected={sportsSelected ? 'true' : 'false'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              minHeight: 44,
              padding: compact ? '8px 13px' : '10px 16px',
              borderRadius: 999,
              fontFamily: FONT,
              fontSize: compact ? 12.5 : 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              color: sportsSelected ? '#fff' : T.sub,
              border: sportsSelected ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
              background: sportsSelected
                ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%)'
                : 'transparent',
              boxShadow: sportsSelected ? '0 8px 24px -12px rgba(37,99,235,0.8)' : 'none',
              transition: 'all .16s ease',
            }}
          >
            <Trophy size={compact ? 13 : 14} />
            Sports & Events
          </button>
        ) : null}
      </div>

      {!compact ? (
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.6, color: T.muted }}>
          {value === 'auto'
            ? 'AUTO reads your brief and picks the mode — it also decides, shot by shot, which engine each shot needs.'
            : `${VIDEO_MODES.find((m) => m.id === value)?.engine} — ${
                VIDEO_MODES.find((m) => m.id === value)?.blurb
              }`}
        </p>
      ) : null}
    </div>
  );
}
