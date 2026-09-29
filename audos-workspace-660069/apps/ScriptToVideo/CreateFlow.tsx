/**
 * Create screen — paste the script (source of truth, never rewritten), pick
 * the aspect, optionally attach a reference image (a character, product or
 * scene visual the director can lock as a generation reference) and a
 * director note. Submitting hands the WHOLE script to Opus 5, which reads the
 * complete story before segmenting it into sequential 4/6/8/10-second clips.
 * The plan review happens on the sequential board — one prompt at a time.
 */
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, FileUp, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Aspect, T, uploadBlob } from './api';
import { DEFAULT_FILM_MODEL, VIDEO_MODELS, VideoModelConfig } from './pipeline/videoModelService';
import ModelGrid, { ModelGridOption } from './ModelGrid';
import {
  rosterInputLabel, rosterModel, rosterNote, rosterState,
  subscribeRunwayRoster, syncRunwayRoster,
} from './runwayRoster';

export function CreateScreen(props: {
  initialText?: string;
  busy: boolean;
  onSubmit: (params: { script: string; aspect: Aspect; screenshotUrl: string | null; note: string; videoModel: string }) => void;
}) {
  const { initialText, busy, onSubmit } = props;
  const [text, setText] = useState(initialText || '');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  // The model choice survives this screen unmounting for the rest of the
  // browser session, so the last-used engine stays selected between films.
  const [videoModel, setVideoModel] = useState<string>(() => {
    try { return window.sessionStorage.getItem('s2v:videoModel') || DEFAULT_FILM_MODEL.id; } catch { return DEFAULT_FILM_MODEL.id; }
  });
  const [modelMode, setModelMode] = useState<'auto' | 'manual'>(() => {
    try { return window.sessionStorage.getItem('s2v:modelMode') === 'manual' ? 'manual' : 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem('s2v:videoModel', videoModel);
      window.sessionStorage.setItem('s2v:modelMode', modelMode);
    } catch { /* preference only */ }
  }, [videoModel, modelMode]);
  // Keep Runway availability live — a model the platform enables becomes
  // selectable here without a code change.
  const [, setRwRev] = useState(0);
  useEffect(() => {
    void syncRunwayRoster();
    return subscribeRunwayRoster(() => setRwRev((r) => r + 1));
  }, []);

  const liveOf = (m: VideoModelConfig) => (m.provider === 'runway' ? rosterModel(m.apiModel) : null);
  /** An opening scene has no seed frame, so an image-only model can never
   * start a film — those are offered but never auto-picked. */
  const canOpenAFilm = (m: VideoModelConfig) => {
    const live = liveOf(m);
    if (live) return live.available && live.inputType !== 'image';
    return !m.availabilityNote;
  };

  // "Auto — Director picks" resolves to a concrete model at submit time so the
  // pipeline always receives a real, accepted id. Gen 4.5 is this app's
  // default engine; anything else only wins when the platform has Gen 4.5
  // switched off.
  const autoPick = (canOpenAFilm(DEFAULT_FILM_MODEL) ? DEFAULT_FILM_MODEL : VIDEO_MODELS.find(canOpenAFilm)) || DEFAULT_FILM_MODEL;
  const autoPickReason = autoPick.id === DEFAULT_FILM_MODEL.id
    ? 'Runway Gen 4.5 is the default engine: the most dependable text-to-video model on the platform, and it animates each continuation scene from the previous clip’s final frame. Pick any other model below to override it for this film.'
    : `Runway Gen 4.5 is not enabled on the platform right now, so the director falls back to ${autoPick.label} — the strongest engine that can open a film today.`;

  const chosenModel = VIDEO_MODELS.find((m) => m.id === videoModel) || autoPick;
  const chosenLive = liveOf(chosenModel);
  const modelNote = modelMode === 'auto'
    ? autoPickReason
    : chosenLive
      ? `${rosterInputLabel(chosenLive)} · ${chosenLive.blurb} ${chosenLive.available ? chosenLive.priceNote : chosenLive.unavailableReason}`
      : (chosenModel.availabilityNote || 'Every clip of this film renders on this model.');
  const catalogLine = rosterState() === 'loading' ? 'Checking the live Runway catalog…' : rosterNote();

  const modelOptions: ModelGridOption[] = VIDEO_MODELS.map((m) => {
    const live = liveOf(m);
    const fallbackFamily = m.provider === 'google' ? 'Google' : m.provider === 'kling' ? 'Kling' : 'OpenRouter';
    return {
      id: m.id,
      label: m.label,
      family: live ? live.family : fallbackFamily,
      blurb: live ? live.blurb : 'Runs every clip of this film.',
      meta: live
        ? `${rosterInputLabel(live)} · ${live.minDurationS}–${live.maxDurationS}s`
        : `Clips up to ${m.safeMaxDuration}s · ${m.maxReferenceImages} reference images`,
      badge: m.id === DEFAULT_FILM_MODEL.id ? 'Default' : live?.speed === 'fast' ? 'Fast' : live?.speed === 'cinematic' ? 'Cinematic' : '',
      available: live ? live.available : !m.availabilityNote,
      unavailableReason: live ? live.unavailableReason : m.availabilityNote,
    };
  });
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

        <details style={{ marginTop: 26, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '12px 14px' }}>
          <summary style={{ cursor: 'pointer', color: T.bone, fontSize: 13, fontWeight: 700, listStylePosition: 'inside' }}>
            Advanced <span style={{ color: T.muted, fontWeight: 500 }}>— {aspect === '16:9' ? 'Widescreen' : 'Vertical'} · {modelMode === 'auto' ? `Director picks (${autoPick.label})` : chosenModel.label}</span>
          </summary>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 }}>Format</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['16:9', '9:16'] as Aspect[]).map((a) => (
            <button key={a} onClick={() => setAspect(a)} style={{ background: aspect === a ? T.bone : T.raised, color: aspect === a ? T.canvas : T.muted, border: `1px solid ${aspect === a ? T.bone : T.dim}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {a === '16:9' ? 'Wide 16:9' : 'Vertical 9:16'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 30, marginBottom: 10 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Video model</div>
          <div style={{ color: T.dim, fontSize: 11 }}>{catalogLine}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setModelMode('auto')} style={{ background: modelMode === 'auto' ? T.live : T.raised, color: modelMode === 'auto' ? '#1A1205' : T.muted, border: `1px solid ${modelMode === 'auto' ? T.live : T.dim}`, borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            Auto — Director picks ({autoPick.label})
          </button>
          {modelMode === 'manual' && videoModel !== DEFAULT_FILM_MODEL.id ? (
            <button className="s2v-ghost" onClick={() => setVideoModel(DEFAULT_FILM_MODEL.id)} style={{ background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Back to {DEFAULT_FILM_MODEL.label}
            </button>
          ) : null}
        </div>
        <ModelGrid
          options={modelOptions}
          value={modelMode === 'manual' ? videoModel : autoPick.id}
          onChange={(id) => { setModelMode('manual'); setVideoModel(id); }}
          disabled={busy}
        />
        <div style={{ marginTop: 10, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '11px 14px' }}>
          <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            {modelMode === 'auto' ? `Director's pick: ${autoPick.label}` : `Every clip renders on ${chosenModel.label}`}
          </div>
          <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.55 }}>{modelNote}</div>
        </div>

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
            style={{ width: '100%', background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13.5, padding: '11px 14px', outline: 'none' }}
          />
        </details>

        {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        <button
          className="s2v-lift"
          disabled={!canGo || busy || shotBusy}
          onClick={() => onSubmit({ script: text.trim(), aspect, screenshotUrl: shotUrl || null, note: note.trim(), videoModel: modelMode === 'auto' ? autoPick.id : videoModel })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, background: canGo && !busy ? T.live : T.raised, color: canGo && !busy ? '#1A1205' : T.dim, border: 'none', borderRadius: 11, padding: '14px 28px', fontSize: 15, fontWeight: 700, cursor: canGo && !busy ? 'pointer' : 'default', boxShadow: canGo && !busy ? '0 2px 12px rgba(245,158,11,0.25)' : 'none' }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Clapperboard size={17} />}
          {busy ? 'The director is reading your story…' : 'Plan my film'}
        </button>
        {busy ? <div style={{ color: T.muted, fontSize: 12.5, marginTop: 12 }}>Your director is reading the entire script, understanding the story, splitting it into sequential clips and preparing the first prompt — about a minute.</div> : null}
      </div>
    </div>
  );
}
