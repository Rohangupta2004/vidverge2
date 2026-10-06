/**
 * Short Video Enhancer — the two AI review surfaces.
 *
 *   PacingPanel   the short-form pacing plan, as an editable list
 *   InsertsPanel  suggested visual inserts, each accept / reject / swap
 *
 * Both exist because an automatic edit that cannot be reviewed is a worse
 * product than no automatic edit at all. Nothing in either panel has touched
 * the project: the pacing plan is a separate document until Apply is pressed,
 * and an insert becomes a real motion-graphic layer only when it is accepted.
 * Applied and accepted items say so, so it is always clear what is live.
 */

import {
  Check, ChevronDown, Loader2, RefreshCw, Sparkles, Wand2, X,
} from 'lucide-react';
import {
  INSERT_KINDS, formatTime, graphicSpec, pacingKindLabel,
  type InsertSuggestion, type PacingPlan,
} from '../lib/model';
import { Btn, Empty, MONO, P, Panel, Pill, SectionHeader } from './controls';

const KIND_COLOR: Record<string, string> = {
  zoomPunch: P.video,
  cameraMove: P.video,
  captionEmphasis: P.caption,
  captionStyleSwitch: P.caption,
  hookCaption: P.caption,
  transitionTrigger: P.trans,
  graphicAccent: P.gfxFg,
};

export function PacingPanel({ plan, busy, onGenerate, onToggle, onSetAll, onApply, onSeek, onClose }: {
  plan: PacingPlan;
  busy: boolean;
  onGenerate: () => void;
  onToggle: (id: string) => void;
  onSetAll: (enabled: boolean) => void;
  onApply: () => void;
  onSeek: (s: number) => void;
  onClose: () => void;
}) {
  const pending = plan.items.filter((i) => i.enabled && !i.applied);
  const appliedCount = plan.items.filter((i) => i.applied).length;

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionHeader
        icon={<Wand2 size={12} />}
        label="Pacing plan"
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {appliedCount ? <Pill color={P.ok}>{appliedCount} applied</Pill> : null}
            <Pill color={pending.length ? P.accent : P.muted}>{pending.length} to apply</Pill>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}>
              <ChevronDown size={14} />
            </button>
          </span>
        }
      />

      <div style={{ display: 'flex', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + P.border, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 size={12} /> : <RefreshCw size={12} />} {plan.generatedAt ? 'Re-plan' : 'Plan the pacing'}
        </Btn>
        {plan.items.length ? (
          <>
            <Btn onClick={() => onSetAll(true)}>Tick all</Btn>
            <Btn onClick={() => onSetAll(false)}>Untick all</Btn>
            <div style={{ flex: 1 }} />
            <Btn tone="primary" onClick={onApply} disabled={!pending.length}>
              <Check size={12} /> Apply {pending.length || ''}
            </Btn>
          </>
        ) : null}
      </div>

      {plan.note ? (
        <div style={{ padding: '8px 11px', fontSize: 11, color: P.sub, lineHeight: 1.5, borderBottom: '1px solid ' + P.border }}>{plan.note}</div>
      ) : null}

      <div style={{ overflowY: 'auto', minHeight: 0, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.items.length ? plan.items.map((item) => {
          const colour = KIND_COLOR[item.kind] || P.accent;
          return (
            <div key={item.id} style={{
              display: 'flex', gap: 9, padding: 9, borderRadius: 10,
              background: item.applied ? 'color-mix(in srgb, ' + P.ok + ' 8%, transparent)' : P.card,
              border: '1px solid ' + (item.applied
                ? 'color-mix(in srgb, ' + P.ok + ' 32%, transparent)'
                : item.blockedBy ? 'color-mix(in srgb, ' + P.warn + ' 34%, transparent)' : P.border),
              opacity: item.enabled || item.applied ? 1 : 0.5,
            }}>
              <input type="checkbox" checked={item.enabled} disabled={item.applied}
                onChange={() => onToggle(item.id)} style={{ marginTop: 2, accentColor: 'var(--space-brand-primary-500, #F59E0B)' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colour, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{pacingKindLabel(item.kind)}</span>
                  <button onClick={() => onSeek(item.at)} title="Jump the playhead here"
                    style={{ background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.sub, fontSize: 10, fontFamily: MONO, padding: '2px 5px', cursor: 'pointer' }}>
                    {formatTime(item.at)}
                  </button>
                  <span style={{ fontSize: 10, color: P.muted, fontFamily: MONO }}>{Math.round(item.intensity * 100)}%</span>
                  {item.applied ? <Pill color={P.ok}>applied</Pill> : null}
                </div>
                <div style={{ fontSize: 11.5, color: P.sub, lineHeight: 1.5 }}>{item.reason}</div>
                {item.trigger ? (
                  <div style={{ fontSize: 10.5, color: P.muted, marginTop: 2 }}>Triggered by “{item.trigger}”</div>
                ) : null}
                {item.blockedBy ? (
                  <div style={{ fontSize: 11, color: P.warn, marginTop: 4, lineHeight: 1.45 }}>
                    Held back — {item.blockedBy}. Unlock that layer if you want this decision applied.
                  </div>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <Empty>
            No plan yet. The pacing engine reads your captions (or the raw word timestamps) and proposes where to put a
            punch-in, a camera move, a caption emphasis or a transition — then you decide what gets applied.
          </Empty>
        )}
      </div>
    </Panel>
  );
}

export function InsertsPanel({ inserts, busy, note, onGenerate, onAccept, onReject, onSwap, onSeek, onClose }: {
  inserts: InsertSuggestion[];
  busy: boolean;
  note: string;
  onGenerate: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onSwap: (id: string) => void;
  onSeek: (s: number) => void;
  onClose: () => void;
}) {
  const pending = inserts.filter((i) => i.status === 'pending');
  const accepted = inserts.filter((i) => i.status === 'accepted');

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionHeader
        icon={<Sparkles size={12} />}
        label="Visual inserts"
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {accepted.length ? <Pill color={P.ok}>{accepted.length} on the timeline</Pill> : null}
            <Pill color={pending.length ? P.accent : P.muted}>{pending.length} to review</Pill>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}>
              <ChevronDown size={14} />
            </button>
          </span>
        }
      />

      <div style={{ display: 'flex', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + P.border, alignItems: 'center' }}>
        <Btn onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 size={12} /> : <RefreshCw size={12} />} {inserts.length ? 'Find more inserts' : 'Suggest inserts'}
        </Btn>
      </div>

      {note ? (
        <div style={{ padding: '8px 11px', fontSize: 11, color: P.sub, lineHeight: 1.5, borderBottom: '1px solid ' + P.border }}>{note}</div>
      ) : null}

      <div style={{ overflowY: 'auto', minHeight: 0, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {inserts.length ? inserts.map((ins) => {
          const kind = INSERT_KINDS.find((k) => k.id === ins.kind);
          const rejected = ins.status === 'rejected';
          return (
            <div key={ins.id} style={{
              padding: 9, borderRadius: 10,
              background: ins.status === 'accepted' ? 'color-mix(in srgb, ' + P.ok + ' 8%, transparent)' : P.card,
              border: '1px solid ' + (ins.status === 'accepted' ? 'color-mix(in srgb, ' + P.ok + ' 32%, transparent)' : P.border),
              opacity: rejected ? 0.45 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{graphicSpec(ins.graphicType).label}</span>
                <Pill color={P.gfxFg}>{kind ? kind.label : ins.kind}</Pill>
                <button onClick={() => onSeek(ins.at)} title="Jump the playhead here"
                  style={{ background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.sub, fontSize: 10, fontFamily: MONO, padding: '2px 5px', cursor: 'pointer' }}>
                  {formatTime(ins.at)} → {formatTime(ins.end)}
                </button>
                {ins.status === 'accepted' ? <Pill color={P.ok}>on the timeline</Pill> : null}
                {rejected ? <Pill color={P.muted}>rejected</Pill> : null}
              </div>
              <div style={{ fontSize: 11.5, color: P.sub, lineHeight: 1.5 }}>{ins.reason}</div>
              <div style={{ fontSize: 10.5, color: P.muted, marginTop: 3 }}>Shows: “{ins.text.split('|').join(' · ')}”</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {ins.status !== 'accepted' ? (
                  <Btn tone="primary" onClick={() => onAccept(ins.id)}><Check size={12} /> Accept</Btn>
                ) : null}
                <Btn onClick={() => onSwap(ins.id)}><RefreshCw size={12} /> Swap visual</Btn>
                {!rejected ? (
                  <Btn tone="danger" onClick={() => onReject(ins.id)}>
                    <X size={12} /> {ins.status === 'accepted' ? 'Remove' : 'Reject'}
                  </Btn>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <Empty>
            No suggestions yet. The insert engine reads the transcript for products, figures, workflows and ideas, then
            proposes a UI card, a counting stat card, an arrow diagram or an icon for each one. Accepting puts a normal
            foreground graphic on the timeline — nothing is ever baked into the clip.
          </Empty>
        )}
      </div>
    </Panel>
  );
}
