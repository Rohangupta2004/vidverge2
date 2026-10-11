import { useRef, useState } from 'react';
import { Download, GripVertical, Loader2, Music2, Play, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { LB, MusicStyleId, StudioClip, SubjectProfile, fmtTimecode } from './studioModel';
import { HelpTip } from './uiControls';
import { VE, vePrimary, veGhost } from './studioGuide';

const card = { background: '#FFFFFF', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 12 } as const;
const ghost = { border: '1px solid rgba(180,120,0,0.14)', background: 'transparent', color: LB.textSecondary, borderRadius: 8, cursor: 'pointer' } as const;

export function ClipManagerPanel(props: {
  clips: StudioClip[];
  selectedIds: string[];
  analyzingId: string;
  onAdd: (file: File) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClearAll: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragIndex = useRef<number | null>(null);
  return (
    <div style={{ ...card, padding: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: LB.textPrimary, fontSize: 13, fontWeight: 800 }}>Clips</span>
        <span style={{ color: LB.textMuted, fontSize: 11 }}>{props.clips.length}</span>
        <HelpTip text="Your footage in playing order. Drag to reorder, bin to remove." />
        {props.clips.length ? (
          <button
            type="button"
            className="vs-btn ve-tap"
            aria-label="Clear all clips"
            title="Removes every clip. We ask you to confirm first."
            onClick={props.onClearAll}
            style={{ ...ghost, marginLeft: 'auto', minHeight: 40, padding: '0 12px', fontSize: 12, fontWeight: 700, color: '#991B1B' }}
          >
            Clear all
          </button>
        ) : null}
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) props.onAdd(f); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 9, minHeight: 44, padding: '10px 9px', borderRadius: 8, cursor: 'pointer', border: dragOver ? '2px dashed #C8920A' : '1px dashed rgba(200,146,10,0.5)', background: dragOver ? 'rgba(200,146,10,0.12)' : 'rgba(200,146,10,0.07)', color: '#B4720A', fontSize: 13, fontWeight: 700 }}>
        <UploadCloud size={15} /> Add another clip
        <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onAdd(f); e.target.value = ''; }} />
      </label>

      <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
        {props.clips.map((clip, index) => {
          const selected = props.selectedIds.includes(clip.id);
          return (
            <div
              key={clip.id}
              draggable
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const from = dragIndex.current; dragIndex.current = null; if (from != null && from !== index) props.onReorder(from, index); }}
              onDragEnd={() => { dragIndex.current = null; }}
              onClick={() => props.onSelect(clip.id)}
              style={{ position: 'relative', display: 'grid', gridTemplateColumns: '16px 68px minmax(0,1fr)', gap: 8, alignItems: 'center', padding: 7, borderRadius: 10, cursor: 'pointer', background: selected ? 'rgba(200,146,10,0.16)' : '#FFFAEB', border: selected ? '1px solid rgba(200,146,10,0.5)' : '1px solid rgba(180,120,0,0.14)' }}
            >
              <GripVertical size={14} color={LB.textMuted} style={{ cursor: 'grab' }} />
              <video src={clip.previewUrl || clip.url} muted preload="metadata" style={{ width: 68, height: 42, objectFit: 'cover', background: '#000', borderRadius: 7 }} />
              <div style={{ minWidth: 0, paddingRight: 24 }}>
                <div title={clip.label} style={{ color: LB.textPrimary, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.label}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <span style={{ color: LB.textMuted, fontSize: 9.5, borderRadius: 999, background: 'rgba(180,120,0,0.08)', padding: '2px 6px' }}>{fmtTimecode(Math.max(0, clip.out - clip.in))}</span>
                  <span style={{ color: clip.kind === 'broll' ? '#166534' : LB.textMuted, fontSize: 9.5 }}>{clip.kind === 'broll' ? 'B-roll' : clip.adjust.speed === 1 ? 'Main' : `${clip.adjust.speed.toFixed(2)}×`}</span>
                </div>
                {clip.subject ? (
                  <div title={`${clip.subject.backgroundDescription} · ${clip.subject.mood}`} style={{ marginTop: 5, display: 'inline-flex', maxWidth: '100%', color: '#B4720A', background: 'rgba(200,146,10,0.15)', border: '1px solid rgba(200,146,10,0.38)', borderRadius: 999, padding: '2px 7px', fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Subject detected: {clip.subject.subjectType}
                  </div>
                ) : props.analyzingId === clip.id ? (
                  <div style={{ marginTop: 5, color: LB.textMuted, fontSize: 9.5, display: 'flex', alignItems: 'center', gap: 4 }}><Loader2 size={10} className="vs-spin" /> Detecting subject…</div>
                ) : null}
              </div>
              <button
                type="button"
                className="vs-btn ve-tap"
                aria-label={`Remove ${clip.label}`}
                title="Remove this clip — you get five seconds to undo"
                onClick={(e) => { e.stopPropagation(); props.onDelete(clip.id); }}
                style={{ position: 'absolute', top: 0, right: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, border: 'none', background: 'transparent', color: '#991B1B', borderRadius: 10, cursor: 'pointer', padding: 0 }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: 'rgba(180,120,0,0.10)' }}><Trash2 size={13} /></span>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ color: LB.textMuted, fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>Drag cards to reorder. The preview and timeline update straight away.</div>
    </div>
  );
}

const MUSIC_STYLES: { id: MusicStyleId; label: string }[] = [
  { id: 'auto', label: 'Auto (AI)' },
  { id: 'uptempo', label: 'Uptempo' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'playful', label: 'Playful' },
  { id: 'none', label: 'No Music' },
];

export function AiMusicPanel(props: {
  profile: SubjectProfile | null;
  style: MusicStyleId;
  prompt: string;
  url: string;
  variation: number;
  busy: boolean;
  note: string;
  error: string;
  onStyle: (style: MusicStyleId) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div style={{ ...card, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Music2 size={14} color={VE.accent} /><span style={{ color: LB.textPrimary, fontSize: 13, fontWeight: 800 }}>AI music</span></div>
      <div style={{ color: LB.textMuted, fontSize: 11, lineHeight: 1.55, marginTop: 5 }}>The detected mood picks a genre and energy profile. Override it any time before export.</div>
      {props.profile ? (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <span style={{ color: '#B4720A', background: 'rgba(200,146,10,0.15)', border: '1px solid rgba(200,146,10,0.35)', borderRadius: 999, padding: '3px 8px', fontSize: 10.5 }}>{props.profile.mood}</span>
          <span style={{ color: LB.textSecondary, background: 'rgba(180,120,0,0.08)', borderRadius: 999, padding: '3px 8px', fontSize: 10.5 }}>{props.profile.subjectType}</span>
        </div>
      ) : null}
      <label style={{ display: 'block', color: LB.textSecondary, fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          Music style
          <HelpTip text="The vibe of the soundtrack. Auto matches what we saw in your clip." />
        </span>
        <select value={props.style} aria-label="Music style" onChange={(e) => props.onStyle(e.target.value as MusicStyleId)} className="ve-input vs-input" style={{ width: '100%', marginTop: 5, minHeight: 44, background: '#FFFFFF', border: '1px solid rgba(180,120,0,0.14)', color: LB.textPrimary, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>
          {MUSIC_STYLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {props.prompt ? <div style={{ color: LB.textMuted, fontSize: 10.5, fontStyle: 'italic', lineHeight: 1.5, marginTop: 8 }}>“{props.prompt}”</div> : null}
      {props.url ? <audio src={props.url} controls preload="metadata" style={{ width: '100%', height: 34, marginTop: 9 }} /> : null}
      <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
        <button type="button" className="vs-btn ve-tap" disabled={props.busy || props.style === 'none'} onClick={props.url ? props.onRegenerate : props.onGenerate} style={{ ...vePrimary, flex: 1 }}>
          {props.busy ? <Loader2 size={14} className="vs-spin" /> : <Sparkles size={14} />}
          {props.url ? 'Make another track' : 'Make music'}
        </button>
      </div>
      {props.note ? <div style={{ color: '#166534', fontSize: 11, marginTop: 7 }}>{props.note}</div> : null}
      {props.error ? <div style={{ color: '#991B1B', fontSize: 11, lineHeight: 1.5, marginTop: 7 }}>{props.error}</div> : null}
    </div>
  );
}

export function StickyExportBar(props: {
  clipCount: number;
  duration: number;
  resolution: string;
  exporting: boolean;
  onPreview: () => void;
  onExport: () => void;
}) {
  return (
    <div style={{ position: 'sticky', bottom: 0, zIndex: 8, ...card, padding: 10, boxShadow: '0 -14px 30px rgba(120,80,0,0.12)' }}>
      <div style={{ color: LB.textMuted, fontSize: 11, marginBottom: 7 }}>{props.clipCount} clip{props.clipCount === 1 ? '' : 's'} · {fmtTimecode(props.duration)} · {props.resolution}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="vs-btn ve-tap" onClick={props.onPreview} style={{ ...veGhost, flex: 1, background: VE.card }}><Play size={14} /> Watch it</button>
        <button type="button" className="vs-btn ve-tap" disabled={!props.clipCount || props.exporting} onClick={props.onExport} style={{ ...vePrimary, flex: 1 }}>{props.exporting ? <Loader2 size={14} className="vs-spin" /> : <Download size={14} />} Export Video</button>
      </div>
    </div>
  );
}
