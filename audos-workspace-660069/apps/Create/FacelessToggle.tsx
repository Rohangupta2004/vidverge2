/**
 * VidVerge — THE FACELESS TOGGLE.
 *
 * THE PROBLEM IT SOLVES. Every character-led flow in this app used to open with
 * a question the visitor could not answer yet: whose face is in this video? A
 * character upload sat between them and their first render, and for the great
 * majority of what people actually make — product ads, UI walkthroughs, slide
 * decks, explainers — there is no face in the piece at all.
 *
 * SO FACELESS IS ON BY DEFAULT, and it is a real switch rather than a checkbox
 * hidden in an "advanced" panel: two big options, the recommended one already
 * chosen, and a plain sentence saying what each actually does. Adding a face is
 * an opt-in, never a prerequisite.
 *
 * WHAT FACELESS ACTUALLY CHANGES (so this is not decoration):
 *   • no character image is required, requested, or drawn anywhere;
 *   • the director is told there is no person on camera and plans abstract
 *     motion, silhouettes and object-focused visuals instead;
 *   • the router never sends a shot down the presenter path;
 *   • the continuity check stops asking "is this the same face?" and holds the
 *     visual bible instead.
 *
 * It is used by the agentic studio's brief, the home screen and the classic
 * character step, so all three read the same way.
 */
import type { ReactNode } from 'react';
import { Sparkles, UserRound } from 'lucide-react';
import { FONT, SectionLabel, T } from './ui';

function Option({
  selected,
  title,
  note,
  icon,
  pill,
  compact,
  onClick,
  testId,
}: {
  selected: boolean;
  title: string;
  note: string;
  icon: ReactNode;
  pill?: string;
  compact?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="rc-press rc-ring rc-lift-hover"
      data-testid={testId}
      data-selected={selected ? 'true' : 'false'}
      style={{
        display: 'flex',
        flex: '1 1 220px',
        alignItems: 'flex-start',
        gap: 11,
        minWidth: 0,
        minHeight: compact ? 56 : 72,
        padding: compact ? '11px 13px' : '14px 16px',
        borderRadius: 14,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: FONT,
        color: T.text,
        border: selected ? `1px solid ${T.accentFg}` : `1px solid ${T.border}`,
        background: selected
          ? 'linear-gradient(135deg, rgba(37,99,235,0.24), rgba(45,212,191,0.12))'
          : 'rgba(255,255,255,0.028)',
        boxShadow: selected ? '0 14px 38px -22px rgba(37,99,235,0.9)' : 'none',
        transition: 'all .16s ease',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 10,
          flexShrink: 0,
          color: selected ? '#fff' : T.muted,
          border: `1px solid ${selected ? T.accentBorder : T.border}`,
          background: selected ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{title}</span>
          {pill ? (
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 999,
                fontSize: 9.5,
                fontWeight: 750,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: T.accentFg,
                border: `1px solid ${T.accentBorder}`,
                background: T.accentSoft,
              }}
            >
              {pill}
            </span>
          ) : null}
        </span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, lineHeight: 1.5, color: T.muted }}>{note}</span>
      </span>
    </button>
  );
}

export default function FacelessToggle({
  faceless,
  onChange,
  compact,
  label = 'Who is on camera?',
  /** Named so the copy can say what THIS piece is, e.g. "this UI walkthrough". */
  subject = 'this video',
}: {
  faceless: boolean;
  onChange: (faceless: boolean) => void;
  compact?: boolean;
  label?: string | null;
  subject?: string;
}) {
  return (
    <div data-testid="faceless-toggle" data-faceless={faceless ? 'true' : 'false'}>
      {label ? <SectionLabel style={{ marginBottom: 10 }}>{label}</SectionLabel> : null}
      <div
        role="radiogroup"
        aria-label="Faceless or a character on camera"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}
      >
        <Option
          selected={faceless}
          title="Faceless"
          pill="Recommended"
          note={`Nobody on camera. ${subject} is carried by motion graphics, silhouettes and the product itself — no character image needed.`}
          icon={<Sparkles size={15} />}
          compact={compact}
          onClick={() => onChange(true)}
          testId="button-faceless-on"
        />
        <Option
          selected={!faceless}
          title="With a character"
          note="Opt in to one recurring person on camera. You can add a photo, or we design and lock an original character for you."
          icon={<UserRound size={15} />}
          compact={compact}
          onClick={() => onChange(false)}
          testId="button-faceless-off"
        />
      </div>
    </div>
  );
}
