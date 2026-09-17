/**
 * Step 3 — the OPTIONAL add-ons: a character and an app mockup.
 *
 * Both are collapsed rows that read "Skip" until the visitor opens them, so
 * nothing on the confirm screen looks like a required field. Opening a row
 * reveals the existing full pickers rather than a second, lesser copy of them:
 *   • Character — apps/Create/CharacterStep (saved quick-picks, AI generate,
 *     upload) exactly as the old wizard used it.
 *   • Mockup    — components/MockupStudio's MockupManager in compact mode. It
 *     owns the shared selection (a per-visit pick + a broadcast event), so this
 *     panel just listens and mirrors the choice into the studio store. The
 *     mirror reads getEffectiveMockupId(), which answers null unless the visitor
 *     has switched the mockup option on AND picked a screen — that is what keeps
 *     an app mockup out of a render nobody asked one for.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Smartphone, User, X } from 'lucide-react';
import CharacterStep from './CharacterStep';
import { MockupManager } from '../../components/MockupStudio';
import {
  getEffectiveMockupId,
  listRows,
  setGenerationOptions,
  setSelectedMockupId,
  STUDIO_EVENTS,
  type Mockup,
} from '../../lib/reelioStudio';
import { setCharacter, setMockup, useVideoStudio } from './videoStore';
import { SectionLabel, T } from './ui';

type Panel = 'none' | 'character' | 'mockup';

function Row({
  icon,
  label,
  emptyLabel,
  value,
  thumb,
  open,
  onToggle,
  onClear,
  testId,
}: {
  icon: ReactNode;
  label: string;
  /** What the row says when nothing is chosen. Never a requirement. */
  emptyLabel?: string;
  value: string | null;
  thumb?: string | null;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  testId: string;
}) {
  const chosen = !!value;
  return (
    <div className="rc-addon-row rc-interactive-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}> 
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 9,
          flexShrink: 0,
          overflow: 'hidden',
          color: chosen ? T.accentFg : T.muted,
          border: `1px solid ${chosen ? T.accentBorder : T.border}`,
          background: chosen ? T.accentSoft : 'rgba(255,255,255,0.03)',
        }}
      >
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          icon
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: T.text }}>{label}</span>
        <span
          style={{
            display: 'block',
            marginTop: 1,
            fontSize: 12,
            color: chosen ? T.accentFg : T.muted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          data-testid={`${testId}-value`}
        >
          {chosen ? value : emptyLabel || 'Optional — skipped'}
        </span>
      </span>
      {chosen && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="rc-iconbtn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            background: 'transparent',
            color: T.muted,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          data-testid={`${testId}-clear`}
        >
          <X size={13} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        className="rc-ghost"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          padding: '9px 14px',
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 600,
          color: T.sub,
          border: `1px solid ${T.border}`,
          background: 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        data-testid={testId}
      >
        {open ? 'Close' : chosen ? 'Change' : 'Add'}
        <ChevronDown
          size={13}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s ease' }}
        />
      </button>
    </div>
  );
}

export default function AddOns() {
  const studio = useVideoStudio();
  const [panel, setPanel] = useState<Panel>('none');
  const [mockups, setMockups] = useState<Mockup[]>([]);

  // Mirror the shared mockup selection (owned by MockupManager) into the store.
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const rows = await listRows<Mockup>('mockups');
      if (!alive) return;
      setMockups(rows);
      const id = getEffectiveMockupId();
      const row = id ? rows.find((m) => m.id === id) : null;
      if (row && row.image_url) {
        setMockup({ id: row.id, name: row.name, imageUrl: row.image_url });
      } else {
        setMockup(null);
      }
    };
    void sync();
    const onChange = () => void sync();
    window.addEventListener(STUDIO_EVENTS.selectionChanged, onChange);
    window.addEventListener(STUDIO_EVENTS.dataChanged, onChange);
    window.addEventListener(STUDIO_EVENTS.optionsChanged, onChange);
    return () => {
      alive = false;
      window.removeEventListener(STUDIO_EVENTS.selectionChanged, onChange);
      window.removeEventListener(STUDIO_EVENTS.dataChanged, onChange);
      window.removeEventListener(STUDIO_EVENTS.optionsChanged, onChange);
    };
  }, []);

  const toggle = (next: Panel) => setPanel((p) => (p === next ? 'none' : next));

  return (
    <div>
      <SectionLabel style={{ marginBottom: 10 }}>Optional add-ons</SectionLabel>
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${T.border}`,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
          overflow: 'hidden',
        }}
      >
        <Row
          icon={<User size={15} />}
          label="On-camera character"
          emptyLabel="Optional — skip to generate without a character"
          value={studio.character ? studio.character.name : null}
          thumb={studio.character ? studio.character.imageUrl : null}
          open={panel === 'character'}
          onToggle={() => toggle('character')}
          onClear={() => setCharacter(null)}
          testId="button-addon-character"
        />
        {panel === 'character' ? (
          <div
            className="rc-fade"
            style={{ padding: '4px 14px 18px', borderTop: `1px solid ${T.border}` }}
            data-testid="panel-character"
          >
            <CharacterStep
              required={false}
              subtitle="Pick a saved character, generate one, or upload a photo — they stay identical in every scene. Skipping is fine."
              onBack={() => setPanel('none')}
              onDone={(character) => {
                setCharacter(character);
                setPanel('none');
              }}
              onSkip={() => {
                setCharacter(null);
                setPanel('none');
              }}
            />
          </div>
        ) : null}

        <div style={{ height: 1, background: T.border }} />

        <Row
          icon={<Smartphone size={15} />}
          label="App mockup"
          value={studio.mockup ? studio.mockup.name : null}
          thumb={studio.mockup ? studio.mockup.imageUrl : null}
          open={panel === 'mockup'}
          onToggle={() => toggle('mockup')}
          onClear={() => {
            setSelectedMockupId(null);
            setGenerationOptions({ mockupEnabled: false });
          }}
          testId="button-addon-mockup"
        />
        {panel === 'mockup' ? (
          <div
            className="rc-fade"
            style={{ padding: '16px 14px 18px', borderTop: `1px solid ${T.border}` }}
            data-testid="panel-mockup"
          >
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
              A mockup is the screen your character is shown holding — and it only appears in a video
              once you tap “Use this” on one. Pick one you’ve made, upload your own, generate a new one below — or
              skip it entirely.
              {mockups.length > 0 && !studio.mockup ? ' Tap “Use this” on a card to attach it.' : ''}
            </p>
            <MockupManager compact />
          </div>
        ) : null}
      </div>

      {studio.character || studio.mockup ? (
        <p
          style={{
            margin: '10px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: T.success,
          }}
        >
          <Check size={13} /> Add-ons attached — they’ll appear in the render.
        </p>
      ) : null}
    </div>
  );
}
