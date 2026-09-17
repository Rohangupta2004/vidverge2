/**
 * The video format picker — SECONDARY on the entry screen. The hero (one
 * product-URL input, in App.tsx) is the dominant path; this grid of 8 format
 * cards sits below it for everything that isn't a straight product ad.
 * My Videos renders below it (from App.tsx).
 */
import {
  Megaphone,
  Zap,
  Clapperboard,
  Presentation,
  User,
  Heart,
  ListOrdered,
  PenLine,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { VIDEO_TYPES } from './videoTypes';
import { T } from './ui';

const ICONS: Record<string, ComponentType<any>> = {
  Megaphone,
  Zap,
  Clapperboard,
  Presentation,
  User,
  Heart,
  ListOrdered,
  PenLine,
};

export default function TypePicker({ onPick }: { onPick: (typeId: string) => void }) {
  return (
    <div className="rc-fade">
      <div style={{ margin: '8px 0 18px' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: -0.2, color: T.sub }}>
          Or start from a format
        </h2>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: T.muted }}>
          Each one asks only for what it needs — you approve a full visual storyboard before anything renders.
        </p>
      </div>

      <div
        className="rc-responsive-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: 16,
        }}
      >
        {VIDEO_TYPES.map((t, i) => {
          const Icon = ICONS[t.icon] || Clapperboard;
          return (
            <button
              key={t.id}
              type="button"
              className="rc-card rc-fade rc-lift-hover rc-press rc-ring"
              onClick={() => onPick(t.id)}
              data-testid={`type-card-${t.id}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 12,
                minHeight: 132,
                padding: '20px 18px',
                borderRadius: 16,
                border: `1px solid ${T.border}`,
                background: T.panel,
                cursor: 'pointer',
                textAlign: 'left',
                animationDelay: `${Math.min(i * 40, 320)}ms`,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: T.accentSoft,
                  border: `1px solid ${T.accentBorder}`,
                }}
              >
                <Icon size={18} color={T.accentFg} />
              </span>
              <span style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: T.text }}>{t.name}</span>
                <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
                  {t.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
