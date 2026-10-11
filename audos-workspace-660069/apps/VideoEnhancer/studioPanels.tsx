/**
 * Video Studio — the agentic surfaces.
 *
 *   CutPlanPanel     the reviewable cut plan: one card per suggested edit with
 *                    its reason, thumbnail, predicted retention and
 *                    Accept / Reject
 *   TranscriptPanel  transcript-first editing — click a word to seek, strike a
 *                    sentence to cut it from the video, one tap to clear every
 *                    filler word
 *   BrollPanel       the detected gaps, each one replaceable or generatable
 *   ChatPanel        the mid-session assistant that proposes more edits
 */
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Check, ChevronRight, Film, Loader2, MessageSquare, Mic, RotateCcw,
  Send, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import {
  BrollSlot, CARD_META, EditCard, LB, WordToken, fmtTimecode, retentionColor,
} from './studioModel';
import { fillerCounts, sentenceRanges } from './studioTranscript';

const panel: CSSProperties = {
  background: LB.bgCard,
  border: LB.border,
  borderRadius: 12,
  padding: 12,
};

const headRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, flexWrap: 'wrap',
};

const headText: CSSProperties = { color: LB.textPrimary, fontSize: 13, fontWeight: 700 };
const subText: CSSProperties = { color: LB.textMuted, fontSize: 11, fontWeight: 500 };

function ghostButton(active = false): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: active ? 'rgba(200,146,10,0.14)' : 'rgba(180,120,0,0.06)',
    border: `1px solid ${active ? 'rgba(200,146,10,0.5)' : 'rgba(180,120,0,0.14)'}`,
    color: active ? LB.accent : LB.textSecondary,
    borderRadius: 7, padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  };
}

// ---------------------------------------------------------------------------
// Cut plan
// ---------------------------------------------------------------------------

function RetentionBadge({ pct }: { pct: number }) {
  const color = retentionColor(pct);
  return (
    <span
      title="Predicted share of viewers still watching through this segment"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        color, borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 800,
      }}
    >
      {pct}% watch
    </span>
  );
}

export function CutPlanPanel(props: {
  cards: EditCard[];
  summary: string;
  hookVerdict: string;
  planning: boolean;
  planNote: string;
  planError: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onReplan: () => void;
  onSeek: (t: number) => void;
  hasFootage: boolean;
}) {
  const pending = props.cards.filter((c) => c.status === 'pending');
  const decided = props.cards.filter((c) => c.status !== 'pending');

  return (
    <div style={panel}>
      <div style={headRow}>
        <Sparkles size={14} color={LB.accent} />
        <span style={headText}>Cut plan</span>
        <span style={subText}>
          {props.planning ? 'Analysing…' : pending.length ? `${pending.length} suggestion${pending.length === 1 ? '' : 's'} to review` : props.cards.length ? 'All reviewed' : 'Upload footage to start'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {pending.length > 1 ? (
            <button type="button" className="vs-btn" onClick={props.onAcceptAll} style={ghostButton(true)}>
              <Check size={12} /> Accept all
            </button>
          ) : null}
          {props.hasFootage ? (
            <button type="button" className="vs-btn" disabled={props.planning} onClick={props.onReplan} style={ghostButton()}>
              {props.planning ? <Loader2 size={12} className="vs-spin" /> : <RotateCcw size={12} />} Re-plan
            </button>
          ) : null}
        </span>
      </div>

      {props.planning ? (
        <div style={{ color: LB.textSecondary, fontSize: 12, lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} className="vs-spin" color={LB.accent} />
          {props.planNote || 'Reading the footage…'}
        </div>
      ) : null}

      {!props.planning && props.summary ? (
        <div style={{ color: LB.textSecondary, fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
          {props.summary}
          {props.hookVerdict ? <div style={{ color: LB.textMuted, marginTop: 4 }}><strong style={{ color: LB.accent }}>Hook:</strong> {props.hookVerdict}</div> : null}
        </div>
      ) : null}

      {props.planError ? (
        <div style={{ color: '#B45309', fontSize: 11.5, lineHeight: 1.55, marginBottom: 10 }}>
          The measured edits below are ready. The creative pass could not run: {props.planError}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {pending.map((card) => {
          const meta = CARD_META[card.type];
          return (
            <div
              key={card.id}
              style={{
                display: 'flex', gap: 10, padding: 9, borderRadius: 10,
                background: 'rgba(180,120,0,0.05)',
                border: `1px solid color-mix(in srgb, ${meta.color} 34%, transparent)`,
                borderLeft: `3px solid ${meta.color}`,
              }}
            >
              <button
                type="button"
                className="vs-btn"
                onClick={() => props.onSeek(card.start)}
                title="Jump the playhead here"
                style={{
                  width: 78, height: 46, flexShrink: 0, borderRadius: 7, overflow: 'hidden', padding: 0,
                  border: '1px solid rgba(180,120,0,0.14)', background: '#000', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {card.thumbnail
                  ? <img src={card.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Film size={15} color={meta.color} />}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: meta.color, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>{meta.label}</span>
                  <span style={{ color: LB.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                    {fmtTimecode(card.start)}–{fmtTimecode(card.end)}
                  </span>
                  <RetentionBadge pct={card.retention} />
                </div>
                <div style={{ color: LB.textPrimary, fontSize: 12.5, fontWeight: 650, marginTop: 3 }}>{card.title}</div>
                <div style={{ color: LB.textMuted, fontSize: 11.5, lineHeight: 1.5, marginTop: 2 }}>{card.reason}</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                <button
                  type="button"
                  className="vs-btn"
                  onClick={() => props.onAccept(card.id)}
                  title="Apply this edit to the timeline"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 7, padding: '6px 11px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  <Check size={12} /> Accept
                </button>
                <button
                  type="button"
                  className="vs-btn"
                  onClick={() => props.onReject(card.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: '1px solid rgba(180,120,0,0.14)', color: LB.textMuted, borderRadius: 7, padding: '6px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  <X size={12} /> Reject
                </button>
              </div>
            </div>
          );
        })}

        {!props.planning && !pending.length && !props.cards.length && props.hasFootage ? (
          <div style={{ color: LB.textMuted, fontSize: 11.5 }}>No suggestions yet — press Re-plan to analyse the current cut.</div>
        ) : null}
      </div>

      {decided.length ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', color: LB.textMuted, fontSize: 11, fontWeight: 700, listStylePosition: 'inside' }}>
            Reviewed ({decided.length})
          </summary>
          <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
            {decided.map((card) => (
              <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: LB.textMuted }}>
                <span style={{ color: card.status === 'applied' ? '#166534' : card.status === 'failed' ? '#991B1B' : LB.textMuted, fontWeight: 800, width: 58, flexShrink: 0 }}>
                  {card.status === 'applied' ? 'Applied' : card.status === 'failed' ? 'Failed' : card.status === 'accepted' ? 'Accepted' : 'Rejected'}
                </span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.title}</span>
                {card.note ? <span style={{ color: '#991B1B', flexShrink: 0 }}>{card.note}</span> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export function TranscriptPanel(props: {
  words: WordToken[];
  transcribing: boolean;
  note: string;
  exactTimings: boolean;
  playheadSource: number;
  onTranscribe: () => void;
  onSeekSource: (t: number) => void;
  onRemove: (ids: string[]) => void;
  onRestore: (ids: string[]) => void;
  onRemoveAllFillers: () => void;
  hasFootage: boolean;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const fillers = useMemo(() => fillerCounts(props.words), [props.words]);
  const sentences = useMemo(() => sentenceRanges(props.words), [props.words]);
  const removedCount = props.words.filter((w) => w.removed).length;

  const pickWord = (id: string, shift: boolean) => {
    if (shift && anchorRef.current) {
      const a = props.words.findIndex((w) => w.id === anchorRef.current);
      const b = props.words.findIndex((w) => w.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelection(props.words.slice(lo, hi + 1).map((w) => w.id));
        return;
      }
    }
    anchorRef.current = id;
    setSelection((cur) => (cur.length === 1 && cur[0] === id ? [] : [id]));
  };

  return (
    <div style={panel}>
      <div style={headRow}>
        <Mic size={14} color={LB.accent} />
        <span style={headText}>Transcript</span>
        <span style={subText}>
          {props.words.length ? `${props.words.length - removedCount} of ${props.words.length} words kept` : 'Not transcribed yet'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {selection.length ? (
            <>
              <button type="button" className="vs-btn" onClick={() => { props.onRemove(selection); setSelection([]); }} style={ghostButton()}>
                <Trash2 size={12} /> Cut {selection.length} word{selection.length === 1 ? '' : 's'}
              </button>
              <button type="button" className="vs-btn" onClick={() => setSelection([])} style={ghostButton()}>Clear</button>
            </>
          ) : null}
          {fillers.length ? (
            <button type="button" className="vs-btn" onClick={props.onRemoveAllFillers} style={ghostButton(true)} title={fillers.map((f) => `${f.label} ×${f.count}`).join(' · ')}>
              Remove all fillers ({fillers.reduce((n, f) => n + f.count, 0)})
            </button>
          ) : null}
          {removedCount ? (
            <button type="button" className="vs-btn" onClick={() => props.onRestore(props.words.filter((w) => w.removed).map((w) => w.id))} style={ghostButton()}>
              <RotateCcw size={12} /> Restore all
            </button>
          ) : null}
          {!props.words.length ? (
            <button type="button" className="vs-btn" disabled={!props.hasFootage || props.transcribing} onClick={props.onTranscribe} style={ghostButton(true)}>
              {props.transcribing ? <Loader2 size={12} className="vs-spin" /> : <Mic size={12} />} Transcribe
            </button>
          ) : null}
        </span>
      </div>

      {props.note ? (
        <div style={{ color: props.exactTimings ? LB.textMuted : '#B45309', fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>{props.note}</div>
      ) : null}

      {props.words.length ? (
        <>
          <div style={{ color: LB.textMuted, fontSize: 10.5, marginBottom: 6 }}>
            Click a word to jump there · Shift-click for a range · cut text and the video cuts with it · filler words are underlined in amber
          </div>
          <div
            style={{
              maxHeight: 260, overflowY: 'auto', lineHeight: 2, fontSize: 13.5,
              background: 'rgba(255,250,235,0.9)', border: '1px solid rgba(180,120,0,0.10)',
              borderRadius: 9, padding: '10px 12px',
            }}
          >
            {sentences.map((range, si) => {
              const slice = props.words.slice(range.from, range.to + 1);
              if (!slice.length) return null;
              const allRemoved = slice.every((w) => w.removed);
              return (
                <span key={`s-${si}`} style={{ marginRight: 6 }}>
                  {slice.map((w) => {
                    const selected = selection.includes(w.id);
                    const live = props.playheadSource >= w.start && props.playheadSource <= w.end;
                    return (
                      <span
                        key={w.id}
                        onClick={(e) => { pickWord(w.id, e.shiftKey); props.onSeekSource(w.start); }}
                        onDoubleClick={() => (w.removed ? props.onRestore([w.id]) : props.onRemove([w.id]))}
                        title={w.removed ? 'Cut from the video — double-click to put it back' : `${w.start.toFixed(2)}s — double-click to cut it`}
                        style={{
                          cursor: 'pointer', padding: '1px 2px', borderRadius: 4, marginRight: 3,
                          color: w.removed ? 'rgba(153,27,27,0.7)' : live ? '#241503' : LB.textPrimary,
                          background: selected ? 'rgba(29,78,216,0.22)' : live ? LB.accent : 'transparent',
                          textDecoration: w.removed ? 'line-through' : w.filler ? 'underline' : 'none',
                          textDecorationColor: w.filler ? LB.accent : undefined,
                          textDecorationThickness: w.filler ? '2px' : undefined,
                          textUnderlineOffset: w.filler ? '3px' : undefined,
                        }}
                      >
                        {w.text}
                      </span>
                    );
                  })}
                  <button
                    type="button"
                    className="vs-btn"
                    onClick={() => (allRemoved
                      ? props.onRestore(slice.map((w) => w.id))
                      : props.onRemove(slice.map((w) => w.id)))}
                    title={allRemoved ? 'Restore this sentence' : 'Cut this whole sentence out of the video'}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px',
                      color: allRemoved ? '#166534' : 'rgba(180,120,0,0.45)', fontSize: 11, verticalAlign: 'middle',
                    }}
                  >
                    {allRemoved ? <RotateCcw size={11} /> : <Trash2 size={11} />}
                  </button>
                </span>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ color: LB.textMuted, fontSize: 11.5, lineHeight: 1.6 }}>
          The transcript is the index for the whole edit — captions, filler removal and the cut plan all read from it.
          It runs automatically on upload; press Transcribe to run it again.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// B-roll slots
// ---------------------------------------------------------------------------

export function BrollPanel(props: {
  slots: BrollSlot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPrompt: (id: string, prompt: string) => void;
  onGenerate: (id: string) => void;
  onReplaceFile: (id: string, file: File) => void;
  onPickStock: (id: string) => void;
  onRemove: (id: string) => void;
  onSeek: (t: number) => void;
  generatingLabel: string;
}) {
  if (!props.slots.length) {
    return (
      <div style={panel}>
        <div style={headRow}>
          <Film size={14} color="#166534" />
          <span style={headText}>B-roll slots</span>
        </div>
        <div style={{ color: LB.textMuted, fontSize: 11.5, lineHeight: 1.6 }}>
          Silent gaps, long pauses and near-static stretches are flagged here as cutaway candidates once the cut plan has run.
        </div>
      </div>
    );
  }
  return (
    <div style={panel}>
      <div style={headRow}>
        <Film size={14} color="#166534" />
        <span style={headText}>B-roll slots</span>
        <span style={subText}>{props.slots.length} candidate{props.slots.length === 1 ? '' : 's'}</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {props.slots.map((slot) => {
          const open = props.selectedId === slot.id;
          return (
            <div key={slot.id} style={{ position: 'relative', borderRadius: 10, border: '1px solid rgba(22,101,52,0.3)', background: 'rgba(22,101,52,0.06)', padding: 9 }}>
              <button
                type="button"
                className="vs-btn"
                onClick={() => { props.onSelect(open ? null : slot.id); props.onSeek(slot.start); }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, width: 'calc(100% - 30px)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
              >
                <ChevronRight size={13} color="#166534" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                <span style={{ color: LB.textPrimary, fontSize: 12, fontWeight: 650 }}>
                  {fmtTimecode(slot.start)}–{fmtTimecode(slot.end)}
                </span>
                <span style={{ color: LB.textMuted, fontSize: 11, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {slot.reason}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: slot.status === 'filled' ? '#166534' : slot.status === 'failed' ? '#991B1B' : '#B45309' }}>
                  {slot.status === 'generating' ? 'Generating' : slot.status === 'filled' ? 'Filled' : slot.status === 'failed' ? 'Failed' : 'Open'}
                </span>
              </button>
              <button
                type="button"
                className="vs-btn"
                onClick={() => props.onRemove(slot.id)}
                title={slot.status === 'filled' ? 'Delete this B-roll clip' : 'Delete this B-roll slot'}
                aria-label={slot.status === 'filled' ? 'Delete this B-roll clip' : 'Delete this B-roll slot'}
                style={{ position: 'absolute', top: 5, right: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 27, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.24)', color: '#991B1B', borderRadius: 7, cursor: 'pointer', padding: 0 }}
              >
                <Trash2 size={12} />
              </button>

              {open ? (
                <div style={{ marginTop: 9, display: 'grid', gap: 8 }}>
                  <textarea
                    className="ve-input vs-input"
                    value={slot.prompt}
                    onChange={(e) => props.onPrompt(slot.id, e.target.value)}
                    rows={3}
                    placeholder="What should the cutaway show?"
                    style={{ width: '100%', background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 8, padding: 8, color: LB.textPrimary, fontSize: 12, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                  {slot.error ? <div style={{ color: '#991B1B', fontSize: 11, lineHeight: 1.5 }}>{slot.error}</div> : null}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="vs-btn"
                      disabled={slot.status === 'generating' || slot.prompt.trim().length < 10}
                      onClick={() => props.onGenerate(slot.id)}
                      style={{ ...ghostButton(true), background: LB.accentGradient, color: '#241503', border: 'none', fontWeight: 800 }}
                    >
                      {slot.status === 'generating' ? <Loader2 size={12} className="vs-spin" /> : <Sparkles size={12} />}
                      {slot.status === 'generating' ? (props.generatingLabel || 'Generating…') : 'Generate'}
                    </button>
                    <label className="vs-btn" style={{ ...ghostButton(), cursor: 'pointer' }}>
                      <Upload size={12} /> Replace with my clip
                      <input
                        type="file"
                        accept="video/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onReplaceFile(slot.id, f); e.target.value = ''; }}
                      />
                    </label>
                    <button type="button" className="vs-btn" onClick={() => props.onPickStock(slot.id)} style={ghostButton()}>
                      Stock footage
                    </button>
                    <button type="button" className="vs-btn" onClick={() => props.onRemove(slot.id)} style={{ ...ghostButton(), color: '#991B1B' }}>
                      <X size={12} /> Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mid-session chat
// ---------------------------------------------------------------------------

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string }

const QUICK_PROMPTS = ['Make this punchy', 'Remove all silences', 'Add captions', 'Reframe for TikTok', 'Where am I losing viewers?'];

export function ChatPanel(props: {
  messages: ChatMessage[];
  busy: boolean;
  hasFootage: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const send = (text: string) => {
    const value = text.trim();
    if (!value || props.busy) return;
    props.onSend(value);
    setDraft('');
  };

  return (
    <div style={{ ...panel, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={headRow}>
        <MessageSquare size={14} color={LB.accent} />
        <span style={headText}>Ask the editor</span>
        <span style={subText}>It answers with edits you can accept</span>
      </div>

      <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflowY: 'auto', marginBottom: 9 }}>
        {props.messages.length ? props.messages.map((m) => (
          <div
            key={m.id}
            style={{
              justifySelf: m.role === 'user' ? 'end' : 'start',
              maxWidth: '92%',
              background: m.role === 'user' ? 'rgba(200,146,10,0.14)' : 'rgba(180,120,0,0.06)',
              border: `1px solid ${m.role === 'user' ? 'rgba(200,146,10,0.32)' : 'rgba(180,120,0,0.12)'}`,
              borderRadius: 10, padding: '7px 10px',
              color: m.role === 'user' ? LB.textPrimary : LB.textSecondary,
              fontSize: 12, lineHeight: 1.55,
            }}
          >
            {m.content}
          </div>
        )) : (
          <div style={{ color: LB.textMuted, fontSize: 11.5, lineHeight: 1.6 }}>
            Tell it what you want in plain English and it adds cards to the cut plan — “cut the rambling bit in the middle”, “put a text beat on the promise”, “make the pacing tighter”.
          </div>
        )}
        {props.busy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: LB.textMuted, fontSize: 11.5 }}>
            <Loader2 size={13} className="vs-spin" color={LB.accent} /> Thinking about your cut…
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {QUICK_PROMPTS.map((q) => (
          <button key={q} type="button" className="vs-btn" disabled={!props.hasFootage || props.busy} onClick={() => send(q)} style={{ ...ghostButton(), fontSize: 11 }}>
            {q}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="ve-input vs-input"
          value={draft}
          disabled={!props.hasFootage}
          placeholder={props.hasFootage ? 'Ask for an edit…' : 'Upload footage first'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 8, padding: '8px 10px', color: LB.textPrimary, fontSize: 12.5, fontFamily: 'inherit' }}
        />
        <button
          type="button"
          className="vs-btn"
          disabled={props.busy || !draft.trim()}
          onClick={() => send(draft)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
