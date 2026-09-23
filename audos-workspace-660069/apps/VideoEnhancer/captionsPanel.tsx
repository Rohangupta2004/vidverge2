/**
 * Video Enhancer — Captions panel.
 *
 * Auto-generates word-timed captions from the video's own audio (Deepgram,
 * WAV fallback), lets the creator toggle them on/off, pick a caption style
 * (the VidVerge brand look by default — Charcoal pill, warm white text,
 * coral word highlight), and edit or drop individual lines. The same
 * segments and style feed the live preview overlay and the export burn-in.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Captions as CaptionsIcon, Loader2, Wand2, Trash2, Eye, EyeOff, Pencil, Check, X,
} from 'lucide-react';
import type { CaptionSegment } from './enhancerCore';
import { formatTime } from './enhancerCore';
import { P } from './editSuite';
import { panelCard, PanelHeader, PrimaryButton, ErrLine } from './editorPanels';
import {
  CAPTION_STYLES, CAPTION_POSITIONS, DEMO_CAPTION_T, BRAND_CORAL, demoCaptionSegment, drawCaptionOverlay,
} from './captionSuite';
import type { CaptionStyleId, CaptionPosition } from './captionSuite';

function StylePreview({ id, active, onPick }: { id: CaptionStyleId; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, '#1B1E2C');
    grad.addColorStop(1, '#0B0D14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    try { drawCaptionOverlay(ctx, c.width, c.height, DEMO_CAPTION_T, [demoCaptionSegment()], id); } catch { /* swatch stays blank */ }
  }, [id]);
  const meta = CAPTION_STYLES.find((s) => s.id === id);
  return (
    <button
      type="button"
      onClick={onPick}
      className="ve-btn"
      title={meta?.hint}
      style={{
        display: 'flex', flexDirection: 'column', gap: 5, padding: 5, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        border: '2px solid ' + (active ? BRAND_CORAL : P.border),
        background: active ? 'color-mix(in srgb, ' + BRAND_CORAL + ' 12%, transparent)' : P.panelSoft,
      }}
    >
      <canvas ref={ref} width={180} height={82} style={{ width: '100%', display: 'block', borderRadius: 7 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: active ? BRAND_CORAL : P.sub, padding: '0 2px' }}>{meta?.label}</span>
    </button>
  );
}

function SegmentRow({ seg, onToggle, onDelete, onEdit, onSeek }: {
  seg: CaptionSegment; onToggle: () => void; onDelete: () => void; onEdit: (text: string) => void; onSeek: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seg.text);
  useEffect(() => { if (!editing) setDraft(seg.text); }, [seg.text, editing]);
  const commit = () => { onEdit(draft); setEditing(false); };
  return (
    <div
      className="ve-elcard"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9,
        background: P.panelSoft, border: '1px solid ' + P.borderSoft, opacity: seg.enabled ? 1 : 0.5,
      }}
    >
      <button onClick={onSeek} title="Seek here" style={{ fontSize: 10.5, color: P.muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
        {formatTime(seg.start)}
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{ flex: 1, minWidth: 0, fontSize: 12, color: P.text, background: 'rgba(7,10,18,0.6)', border: '1px solid ' + P.border, borderRadius: 6, padding: '4px 7px', outline: 'none' }}
        />
      ) : (
        <button onClick={onSeek} style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 12, color: P.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          {seg.text || '(empty)'}
        </button>
      )}
      {editing ? (
        <>
          <button onClick={commit} className="ve-btn" title="Save" style={{ display: 'flex', color: P.mint, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}><Check size={13} /></button>
          <button onClick={() => setEditing(false)} className="ve-btn" title="Cancel" style={{ display: 'flex', color: P.muted, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}><X size={13} /></button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} className="ve-btn" title="Edit this line" style={{ display: 'flex', color: P.muted, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}><Pencil size={12} /></button>
      )}
      <button onClick={onToggle} className="ve-btn" title={seg.enabled ? 'Hide this line' : 'Show this line'} style={{ display: 'flex', color: seg.enabled ? P.mint : P.muted, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
        {seg.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <button onClick={onDelete} className="ve-btn" title="Delete this line" style={{ display: 'flex', color: P.coral, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}><Trash2 size={13} /></button>
    </div>
  );
}

export function CaptionsPanel({
  captionsOn, styleId, position, segments, transcribing, note, err, hasVideo, disabled,
  onToggleOn, onStyle, onPosition, onGenerate, onToggleSegment, onDeleteSegment, onEditSegment, onSeek,
}: {
  captionsOn: boolean; styleId: CaptionStyleId; position: CaptionPosition; segments: CaptionSegment[];
  transcribing: boolean; note: string; err: string; hasVideo: boolean; disabled: boolean;
  onToggleOn: (v: boolean) => void; onStyle: (s: CaptionStyleId) => void; onPosition: (p: CaptionPosition) => void; onGenerate: () => void;
  onToggleSegment: (id: string) => void; onDeleteSegment: (id: string) => void;
  onEditSegment: (id: string, text: string) => void; onSeek: (t: number) => void;
}) {
  const enabledCount = segments.filter((s) => s.enabled).length;
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<CaptionsIcon size={15} />}
          color={BRAND_CORAL}
          title="Auto captions"
          right={
            <button
              type="button"
              onClick={() => onToggleOn(!captionsOn)}
              disabled={!segments.length}
              className="ve-btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, borderRadius: 999,
                padding: '4px 10px', border: '1px solid ' + (captionsOn ? BRAND_CORAL : P.border), cursor: segments.length ? 'pointer' : 'not-allowed',
                background: captionsOn ? 'color-mix(in srgb, ' + BRAND_CORAL + ' 16%, transparent)' : 'transparent',
                color: captionsOn ? BRAND_CORAL : P.muted, opacity: segments.length ? 1 : 0.5,
              }}
            >
              {captionsOn ? <Eye size={12} /> : <EyeOff size={12} />} {captionsOn ? 'On' : 'Off'}
            </button>
          }
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55, marginBottom: 12 }}>
          Transcribes your footage word-for-word and times captions to the spoken audio — styled to match VidVerge, overlaid live on the preview and burned into the download.
        </div>
        <PrimaryButton
          onClick={onGenerate}
          disabled={!hasVideo || disabled}
          busy={transcribing}
          gradient={'linear-gradient(100deg, ' + BRAND_CORAL + ', ' + P.amber + ')'}
          shadow="0 12px 30px -14px rgba(255,107,74,0.55)"
        >
          {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {transcribing ? 'Transcribing…' : segments.length ? 'Regenerate captions' : 'Generate captions'}
        </PrimaryButton>
        {!hasVideo && <div style={{ fontSize: 12, color: P.muted, marginTop: 8 }}>Upload a video first.</div>}
        {transcribing && note && (
          <div className="ve-pulse" style={{ fontSize: 12, color: BRAND_CORAL, marginTop: 9, display: 'flex', gap: 7, alignItems: 'center' }}>
            <Loader2 size={12} className="animate-spin" /> {note}
          </div>
        )}
        {!transcribing && note && <div style={{ fontSize: 12, color: P.sub, marginTop: 8 }}>{note}</div>}
        {err && <ErrLine>{err}</ErrLine>}
      </div>

      {segments.length > 0 && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader icon={<Wand2 size={15} />} color={BRAND_CORAL} title="Style" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8 }}>
            {CAPTION_STYLES.map((s) => (
              <StylePreview key={s.id} id={s.id} active={styleId === s.id} onPick={() => onStyle(s.id)} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: P.sub }}>Position</span>
            {CAPTION_POSITIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ve-btn"
                onClick={() => onPosition(p.id)}
                style={{
                  fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '4px 12px', cursor: 'pointer',
                  border: '1px solid ' + (position === p.id ? BRAND_CORAL : P.border),
                  background: position === p.id ? 'color-mix(in srgb, ' + BRAND_CORAL + ' 14%, transparent)' : 'transparent',
                  color: position === p.id ? BRAND_CORAL : P.muted,
                }}
              >
                {p.label}
              </button>
            ))}
            <span style={{ fontSize: 11, color: P.muted }}>applies to the preview and the export</span>
          </div>
        </div>
      )}

      {segments.length > 0 && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader icon={<CaptionsIcon size={15} />} color={P.violet} title="Lines" right={<span style={{ fontSize: 11, color: P.muted }}>{enabledCount} of {segments.length} shown</span>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {segments.map((seg) => (
              <SegmentRow
                key={seg.id}
                seg={seg}
                onToggle={() => onToggleSegment(seg.id)}
                onDelete={() => onDeleteSegment(seg.id)}
                onEdit={(text) => onEditSegment(seg.id, text)}
                onSeek={() => onSeek(seg.start)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
