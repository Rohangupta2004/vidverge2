/**
 * Short Video Enhancer — the collapsible control section.
 *
 * Every group in the control panel is one of these: icon, label, a one-line
 * hint, and a chevron that rotates 180° when the body is open. The open state
 * is held here rather than in the panel above, so a tab only has to say which
 * of its sections should start open — and because each section carries a
 * unique key, switching tabs returns to that default instead of inheriting
 * whatever the last tab was left in.
 *
 * The header is a single `<button>` on purpose: a nested button inside a
 * clickable header is invalid markup and, more practically, is how a header
 * ends up with two overlapping hit areas where one of them wins silently.
 * Anything actionable belongs in the body.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SveAccordionProps {
  /** Icon drawn in the 18px tile to the left of the label. */
  icon?: ReactNode;
  title: string;
  /** Short status line — counts, measured values, "Not generated". */
  hint?: string;
  /** Open on first render. Exactly one section per tab should set this. */
  defaultOpen?: boolean;
  /**
   * The feature has no implementation behind it yet. The section greys out,
   * says so in the header, and explains itself on hover rather than offering
   * controls that would change nothing.
   */
  soon?: boolean;
  /** Hover text for the header. Falls back to a plain open/close sentence. */
  tip?: string;
  children: ReactNode;
}

export function SveAccordion(props: SveAccordionProps) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  const label = props.soon
    ? props.tip || 'Coming soon — this is not wired to the renderer yet'
    : props.tip || (open ? `Collapse ${props.title}` : `Expand ${props.title}`);

  return (
    <section className={`vp-acc${open ? ' open' : ''}`}>
      <button
        type="button"
        className="vp-acchit"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {props.icon ? <span className="vp-accico">{props.icon}</span> : null}
        <h4>{props.title}</h4>
        {props.hint ? <span className="vp-hint">{props.hint}</span> : null}
        <span className="vp-accgap" />
        {props.soon ? <span className="vp-soonbadge">Soon</span> : null}
        <span className="vp-accchev"><ChevronDown size={13} /></span>
      </button>
      {open ? (
        <div className={`vp-accbody${props.soon ? ' vp-soon' : ''}`}>{props.children}</div>
      ) : null}
    </section>
  );
}

export default SveAccordion;
