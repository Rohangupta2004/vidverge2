/**
 * Create screen — paste the script (source of truth, never rewritten), pick
 * the aspect, optionally attach a reference image (a character, product or
 * scene visual the director can lock as a generation reference) and a
 * director note. Submitting hands the WHOLE script to Opus 5, which reads the
 * complete story before segmenting it into sequential 4/6/8/10-second clips.
 * The plan review happens on the sequential board — one prompt at a time.
 */
import { useRef, useState } from 'react';
import { Clapperboard, FileUp, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Aspect, T, uploadBlob } from './api';
import { VIDEO_MODEL, VIDEO_MODELS } from './pipeline/videoModelService';

export function CreateScreen(props: {
  initialText?: string;
  busy: boolean;
  onSubmit: (params: { script: string; aspect: Aspect; screenshotUrl: string | null; note: string; videoModel: string }) => void;
}) {
  const { initialText, busy, onSubmit } = props;
  const [text, setText] = useState(initialText || '');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [videoModel, setVideoModel] = useState<string>(VIDEO_MODEL.id);
  const [note, setNote] = useState('');
  const [shotUrl, setShotUrl] = useState('');
  const [shotBusy, setShotBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const scriptRef = useRef<HTMLInputElement>(null);

  const canGo = text.trim().split(/\s+/).filter(Boolean).length >= 3;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 140px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ color: T.bone, fontSize: 25, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>What are we filming?</div>
        <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 22 }}>
          Paste your script. The director reads the whole story, breaks it into sequential AI video clips, and prepares one detailed prompt at a time — you trigger each generation, and FFmpeg carries the final frame of every clip into the next one.
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your script — we never rewrite it."
          rows={Math.min(16, Math.max(5, text.split('\n').length + 2))}
          style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, color: T.bone, fontSize: 15, lineHeight: 1.55, padding: '16px 18px', outline: 'none', resize: 'vertical', fontFamily: T.sans }}
        />

        <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="s2v-ghost" onClick={() => scriptRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', padding: '5px 8px', margin: '-5px -8px', borderRadius: 7 }}>
            <FileUp size={14} /> Upload script file
          </button>
          <span style={{ color: T.dim, fontSize: 12 }}>.txt · .md</span>
          <input
            ref={scriptRef} type="file" accept=".txt,.md" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { setText(await f.text()); setErr(''); } catch (ex: any) { setErr(String(ex?.message || ex)); }
              e.target.value = '';
            }}
          />
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>Format</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['16:9', '9:16'] as Aspect[]).map((a) => (
            <button key={a} onClick={() => setAspect(a)} style={{ background: aspect === a ? T.bone : T.raised, color: aspect === a ? T.canvas : T.muted, border: `1px solid ${aspect === a ? T.bone : T.dim}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {a === '16:9' ? 'Wide 16:9' : 'Vertical 9:16'}
            </button>
          ))}
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>Video model</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {VIDEO_MODELS.map((m) => (
            <button key={m.id} onClick={() => setVideoModel(m.id)} title={m.availabilityNote || ''} style={{ background: videoModel === m.id ? T.bone : T.raised, color: videoModel === m.id ? T.canvas : T.muted, border: `1px solid ${videoModel === m.id ? T.bone : T.dim}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {m.label}
            </button>
          ))}
        </div>
        {(() => {
          const chosen = VIDEO_MODELS.find((m) => m.id === videoModel);
          return chosen?.availabilityNote
            ? <div style={{ color: T.live, fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>{chosen.availabilityNote}</div>
            : <div style={{ color: T.dim, fontSize: 12, marginTop: 8 }}>Every clip of this film renders on the chosen model.</div>;
        })()}

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Reference image <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — a character, product or scene visual the director can reference)</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="s2v-ghost" disabled={shotBusy} onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.raised, border: `1px solid ${T.dim}`, color: T.bone, fontSize: 13, cursor: 'pointer', padding: '9px 14px', borderRadius: 8 }}>
            {shotBusy ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />} {shotUrl ? 'Replace image' : 'Attach image'}
          </button>
          {shotUrl ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src={shotUrl} alt="" style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.dim}` }} />
              <button onClick={() => setShotUrl('')} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', padding: 2 }}><X size={14} /></button>
            </span>
          ) : (
            <span style={{ color: T.dim, fontSize: 12 }}>Scenes that fit it can use it as a visual reference.</span>
          )}
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setShotBusy(true); setErr('');
              try { setShotUrl(await uploadBlob(f, f.name)); }
              catch (ex: any) { setErr(String(ex?.message || ex)); }
              finally { setShotBusy(false); e.target.value = ''; }
            }}
          />
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Director note <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='e.g. "documentary feel, warm palette, handheld camera"'
          style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13.5, padding: '11px 14px', outline: 'none' }}
        />

        {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        <button
          className="s2v-lift"
          disabled={!canGo || busy || shotBusy}
          onClick={() => onSubmit({ script: text.trim(), aspect, screenshotUrl: shotUrl || null, note: note.trim(), videoModel })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, background: canGo && !busy ? T.live : T.raised, color: canGo && !busy ? '#1A1205' : T.dim, border: 'none', borderRadius: 11, padding: '14px 28px', fontSize: 15, fontWeight: 700, cursor: canGo && !busy ? 'pointer' : 'default', boxShadow: canGo && !busy ? '0 2px 12px rgba(232,163,60,0.25)' : 'none' }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Clapperboard size={17} />}
          {busy ? 'The director is reading your story…' : 'Plan my film'}
        </button>
        {busy ? <div style={{ color: T.muted, fontSize: 12.5, marginTop: 12 }}>Opus is reading the ENTIRE script, understanding the story, splitting it into sequential clips and preparing the first prompt — about a minute.</div> : null}
      </div>
    </div>
  );
}
