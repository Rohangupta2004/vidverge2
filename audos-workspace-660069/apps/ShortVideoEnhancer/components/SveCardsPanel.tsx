/**
 * Short Video Enhancer — graphic cards.
 *
 * Title-card hooks, lower thirds and end CTAs. All three are drawn by Remotion
 * in the export, not by a canvas overlay, so the type is crisp and the drop
 * shadows survive the encode.
 */

import { Layers, Trash2, Type } from 'lucide-react';
import { clamp, formatClock, type CardKind, type EditDoc, type GraphicCard } from '../lib/sveTypes';
import { Field, Note, Section, Slider } from './SveControls';

const KINDS: { id: CardKind; label: string; hint: string }[] = [
  { id: 'hook', label: 'Title hook', hint: 'Opens the video in the first seconds' },
  { id: 'lower', label: 'Lower third', hint: 'Name / claim bar near the bottom' },
  { id: 'cta', label: 'End CTA', hint: 'Contrasting card that closes the video' },
];

export interface CardsPanelProps {
  doc: EditDoc;
  open: boolean;
  onToggleOpen: () => void;
  hasSource: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (patch: (doc: EditDoc) => EditDoc, label?: string) => void;
  onAdd: (kind: CardKind) => void;
}

export function SveCardsPanel(props: CardsPanelProps) {
  const { doc } = props;
  const duration = Math.max(0.6, doc.durationS);
  const selected = doc.cards.find((c) => c.id === props.selectedId) || null;

  const patch = (id: string, change: Partial<GraphicCard>, label?: string) => {
    props.onUpdate((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...change } : c)) }), label);
  };

  const remove = (id: string) => {
    props.onUpdate((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
    if (props.selectedId === id) props.onSelect(null);
  };

  return (
    <Section id="cards" title="Graphics & Cards" open={props.open} onToggle={props.onToggleOpen}>
      {!props.hasSource && <Note>Upload a clip first so cards have a timeline to sit on.</Note>}

      <Field label="Add a card">
        <div className="sve-segmented">
          {KINDS.map((kind) => (
            <button key={kind.id} title={kind.hint} disabled={!props.hasSource} onClick={() => props.onAdd(kind.id)}>
              {kind.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="sve-broll-list">
        {doc.cards.map((card) => (
          <div
            key={card.id}
            className={'sve-broll-row ' + (props.selectedId === card.id ? 'selected' : '')}
            style={{ gridTemplateColumns: '28px 1fr auto' }}
            onClick={() => props.onSelect(card.id === props.selectedId ? null : card.id)}
          >
            <span className="sve-layer-icon" style={{ width: 28, height: 28 }}>
              {card.kind === 'lower' ? <Layers size={13} /> : <Type size={13} />}
            </span>
            <span className="sve-broll-meta">
              <strong>{card.title || '(empty card)'}</strong>
              <small>{KINDS.find((k) => k.id === card.kind)?.label} · {formatClock(card.start)}–{formatClock(card.end)}</small>
            </span>
            <span
              role="button"
              tabIndex={0}
              title="Delete card"
              style={{ color: '#991B1B', display: 'grid', placeItems: 'center', width: 26, height: 26 }}
              onClick={(event) => { event.stopPropagation(); remove(card.id); }}
            >
              <Trash2 size={14} />
            </span>
          </div>
        ))}
        {doc.cards.length === 0 && props.hasSource && (
          <p className="sve-muted" style={{ margin: 0 }}>No cards yet. A title hook in the first 3 seconds is the single highest-impact one.</p>
        )}
      </div>

      {selected && (
        <>
          <Field label="Headline">
            <input
              value={selected.title}
              maxLength={48}
              onChange={(event) => patch(selected.id, { title: event.target.value }, 'card-title')}
            />
          </Field>
          <Field label="Sub-line (optional)">
            <input
              value={selected.subtitle}
              maxLength={48}
              onChange={(event) => patch(selected.id, { subtitle: event.target.value }, 'card-sub')}
            />
          </Field>
          <Slider
            label="Start" value={Number(selected.start.toFixed(1))} min={0} max={Number((duration - 0.4).toFixed(1))} step={0.1} suffix="s"
            onChange={(start) => patch(selected.id, { start, end: Math.max(start + 0.4, selected.end) }, 'card-start')}
          />
          <Slider
            label="End" value={Number(selected.end.toFixed(1))} min={0.4} max={Number(duration.toFixed(1))} step={0.1} suffix="s"
            onChange={(end) => patch(selected.id, { end, start: Math.min(selected.start, end - 0.4) }, 'card-end')}
          />
          <Field label="Accent colour">
            <input type="color" value={selected.color} onChange={(event) => patch(selected.id, { color: event.target.value }, 'card-color')} />
          </Field>
          <p className="sve-muted">
            Scrub the preview to {formatClock(clamp(selected.start, 0, duration))} to see this card in place.
          </p>
        </>
      )}
    </Section>
  );
}
