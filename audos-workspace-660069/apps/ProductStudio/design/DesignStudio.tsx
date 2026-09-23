/**
 * DESIGN WITH AI — the studio surface (new, additive Product Video mode).
 *
 * Upload video → click “Design My Video” → done. Four guided steps:
 *   ① Upload Video (drop or click — up to 500MB via the platform's signed
 *      upload channel; the original is stored durably and never modified)
 *   ② Transcript — Auto Generate (word-level timestamps) or Import SRT/VTT
 *      (skips retranscription); editable afterwards in the editor
 *   ③ Visual Style — Auto Brand / Minimal / Cinematic + optional product URL
 *      for brand context + optional real screenshots for image cards
 *   ④ Design My Video — the agentic pipeline runs with live progress
 *      (Generating Visual Plan → Creating Graphics → Syncing to Transcript →
 *      Quality Check → Preview Ready) and persists every stage, so a reload
 *      resumes where it left off.
 *
 * Finished projects open the full editor (preview + timeline + per-graphic
 * editing + export). Entirely separate state from the AI Film / My Videos /
 * Script flows — nothing existing is touched.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, FileText, Film as FilmIcon, ImagePlus,
  Import, Loader2, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { uploadVideo, fetchVideoAsFile } from '../../VideoEnhancer/enhancerCore';
import { uploadImageFile } from '../film/api';
import {
  DESIGN_STAGES, DesignProject, DesignTranscript, StylePref, T, designDb,
  designStageIndex, fmtTime, probeVideoFile, wsToken,
} from './api';
import { autoTranscribe, parseSubtitles } from './transcript';
import { runDesign } from './designRun';
import DesignEditor from './DesignEditor';

interface Note { at: number; text: string }

const statusChip: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'DRAFT', color: T.muted, bg: 'rgba(141,139,148,0.12)' },
  transcribing: { label: 'TRANSCRIBING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  planning: { label: 'PLANNING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  generating: { label: 'DESIGNING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  syncing: { label: 'SYNCING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  checking: { label: 'QUALITY CHECK', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  ready: { label: 'READY', color: T.done, bg: 'rgba(127,212,180,0.14)' },
  error: { label: 'NEEDS ATTENTION', color: T.fault, bg: 'rgba(226,114,111,0.14)' },
};

const PIPELINE_STATUSES = ['planning', 'generating', 'syncing', 'checking'];

export default function DesignStudio() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [open, setOpen] = useState<DesignProject | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');

  // Wizard state (before the pipeline runs)
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const pendingFileRef = useRef<File | null>(null);

  const runLock = useRef(false);
  const openRef = useRef<DesignProject | null>(null);
  openRef.current = open;

  const say = (text: string) => setNotes((n) => [...n.slice(-160), { at: Date.now(), text }]);

  const refresh = async () => {
    try { setProjects(await designDb.list()); setLoadError(''); }
    catch (e: any) { setLoadError(String(e?.message || e)); }
  };
  useEffect(() => { void refresh(); }, []);

  const applyPatch = async (patch: Partial<DesignProject>) => {
    const cur = openRef.current;
    if (!cur) return;
    await designDb.update(cur.id, patch);
    setOpen((p) => (p && p.id === cur.id ? { ...p, ...patch } as DesignProject : p));
  };

  const hooks = useMemo(() => ({
    onProject: (patch: Partial<DesignProject>) => setOpen((p) => (p ? { ...p, ...patch } as DesignProject : p)),
    onNote: say,
  }), []);

  async function drive(project: DesignProject, directive?: string | null) {
    if (runLock.current) return;
    runLock.current = true;
    setRunning(true);
    try {
      await runDesign(project, hooks, directive);
    } catch (e: any) {
      say(`Stopped: ${String(e?.message || e)}`);
    } finally {
      runLock.current = false;
      setRunning(false);
      try {
        const fresh = await designDb.get(project.id);
        if (fresh && openRef.current?.id === project.id) setOpen(fresh);
      } catch { /* view refresh is cosmetic */ }
      void refresh();
    }
  }

  async function openProject(id: number) {
    let p = await designDb.get(id);
    if (!p) return;
    // A tab closed mid-transcription leaves the row on 'transcribing' — the
    // upload is durable, so reset to draft and let the user restart step ②.
    if (p.status === 'transcribing') {
      await designDb.update(p.id, { status: 'draft', stage_note: 'Transcription was interrupted — run it again.' }).catch(() => undefined);
      p = { ...p, status: 'draft', stage_note: 'Transcription was interrupted — run it again.' };
    }
    setOpen(p); setNotes([]); setFormError('');
    if (p.status && PIPELINE_STATUSES.includes(p.status) && p.transcript?.segments?.length) {
      say('Resuming this design where it left off…');
      void drive(p);
    }
  }

  // ------------------------------------------------------------ wizard steps
  async function onPickVideo(file: File | null) {
    if (!file) return;
    if (!wsToken()) { setFormError('Your workspace session is still loading — try again in a moment.'); return; }
    setUploading(true); setFormError('');
    try {
      const meta = await probeVideoFile(file);
      if (!meta.duration || meta.duration < 2) throw new Error('This video is too short to design (under 2 seconds).');
      const { url } = await uploadVideo(file);
      pendingFileRef.current = file;
      const project = await designDb.create({
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || `Design ${Date.now()}`,
        video_url: url,
        video_w: meta.w || null,
        video_h: meta.h || null,
        video_duration_s: Math.round(meta.duration * 100) / 100,
        style: 'auto_brand',
        density: 'balanced',
        layout_pref: 'auto',
        status: 'draft',
        stage_note: 'Video uploaded — add a transcript next.',
      });
      setOpen(project); setNotes([]);
      void refresh();
    } catch (e: any) { setFormError(String(e?.message || e)); }
    finally { setUploading(false); }
  }

  async function generateTranscript() {
    const p = openRef.current;
    if (!p) return;
    setTranscribing(true); setFormError('');
    try {
      await applyPatch({ status: 'transcribing', stage_note: 'Transcribing with word-level timestamps…' });
      let file = pendingFileRef.current;
      if (!file) {
        say('Re-fetching the stored video for transcription…');
        file = await fetchVideoAsFile(p.video_url || '');
        pendingFileRef.current = file;
      }
      const transcript = await autoTranscribe(file, say);
      await applyPatch({ transcript, status: 'draft', stage_note: `Transcript ready — ${transcript.segments.length} lines.` });
      say(`Transcript ready — ${transcript.segments.length} timestamped lines${transcript.words.length ? '' : ' (no word timings — consider importing an SRT for tighter sync)'}.`);
    } catch (e: any) {
      setFormError(String(e?.message || e));
      await applyPatch({ status: 'draft', stage_note: null });
    } finally { setTranscribing(false); }
  }

  async function importSubtitles(file: File) {
    setFormError('');
    try {
      const parsed: DesignTranscript = parseSubtitles(await file.text());
      await applyPatch({ transcript: parsed, status: 'draft', stage_note: `Transcript imported — ${parsed.segments.length} cues (no retranscription needed).` });
      say(`Imported ${parsed.segments.length} cues from ${file.name}.`);
    } catch (e: any) { setFormError(String(e?.message || e)); }
  }

  async function onPickAssets(files: FileList | null) {
    const p = openRef.current;
    if (!files || !files.length || !p) return;
    setAssetBusy(true); setFormError('');
    try {
      const next = [...(p.assets || [])];
      for (const file of Array.from(files).slice(0, 6)) {
        const url = await uploadImageFile(file);
        next.push({ url, shows: file.name.replace(/\.[^.]+$/, '').slice(0, 120) });
      }
      await applyPatch({ assets: next.slice(0, 10) });
    } catch (e: any) { setFormError(String(e?.message || e)); }
    finally { setAssetBusy(false); }
  }

  function designMyVideo() {
    const p = openRef.current;
    if (!p) return;
    if (!p.transcript?.segments?.length) { setFormError('Generate or import a transcript first — the visual plan is timed to it.'); return; }
    setFormError('');
    say('The visual director has the transcript. Starting…');
    void drive(p);
  }

  async function removeProject(p: DesignProject) {
    if (!window.confirm(`Delete “${p.title || 'this design'}”? The uploaded original video and any exported files stay in storage.`)) return;
    try { await designDb.remove(p.id); } catch { /* row may be gone */ }
    if (open?.id === p.id) setOpen(null);
    void refresh();
  }

  const btn = (primary = false, disabled = false): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 7, background: primary ? T.coral : 'transparent', color: primary ? '#1A0E08' : T.muted, border: primary ? 'none' : `1px solid ${T.line}`, borderRadius: 10, padding: primary ? '11px 22px' : '8px 14px', fontSize: primary ? 13 : 12, fontWeight: 800, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 });
  const inputStyle: React.CSSProperties = { width: '100%', background: T.canvas, border: `1px solid ${T.line}`, borderRadius: 10, color: T.bone, fontSize: 13, padding: '11px 13px', fontFamily: T.sans, boxSizing: 'border-box' };
  const stepBadge = (n: string, done: boolean, active: boolean) => (
    <span style={{ width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11.5, fontWeight: 800, background: done ? 'rgba(127,212,180,0.16)' : active ? 'rgba(255,107,74,0.16)' : 'rgba(141,139,148,0.12)', color: done ? T.done : active ? T.coral : T.dim, border: `1px solid ${done ? 'rgba(127,212,180,0.4)' : active ? 'rgba(255,107,74,0.4)' : T.line}` }}>{done ? <Check size={12} /> : n}</span>
  );

  // -------------------------------------------------------------- gallery
  if (!open) {
    return (
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', fontFamily: T.sans }}>
        <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 18, padding: 'clamp(18px, 3vw, 28px)', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,107,74,0.12)', border: '1px solid rgba(255,107,74,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wand2 size={17} color={T.coral} />
            </div>
            <div>
              <div style={{ color: T.bone, fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>Design with AI</div>
              <div style={{ color: T.muted, fontSize: 12.5 }}>Upload a talking video — an AI visual director transcribes it, designs timestamped motion graphics around your talking head, quality-checks its own work, and hands you an editable timeline. The original footage is never modified.</div>
            </div>
          </div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && !uploading) void onPickVideo(f); }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1.5px dashed ${T.lineStrong}`, borderRadius: 14, padding: '34px 16px', color: T.muted, fontSize: 13, cursor: 'pointer', background: T.canvas }} data-testid="dropzone-design-upload">
            {uploading ? <Loader2 size={22} color={T.coral} className="animate-spin" /> : <Upload size={22} color={T.coral} />}
            <span style={{ fontWeight: 700, color: T.bone }}>{uploading ? 'Uploading your video…' : 'Drop video here or click to upload'}</span>
            <span style={{ fontSize: 11.5, color: T.dim }}>MP4 / WebM / MOV · up to 500MB · your original is stored safely and never modified</span>
            <input type="file" accept="video/*" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { void onPickVideo(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
          {formError ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.fault, fontSize: 12, marginTop: 12 }}><AlertTriangle size={13} /> {formError}</div> : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>My Designs</span>
          <button type="button" onClick={() => void refresh()} style={btn()}>Refresh</button>
        </div>
        {loadError ? <div style={{ color: T.fault, fontSize: 12.5 }}>{loadError}</div> : null}
        {projects.length === 0 && !loadError ? (
          <div style={{ color: T.dim, fontSize: 13, padding: '26px 0', textAlign: 'center' }}>No designs yet — your first one starts with an upload above.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
            {projects.map((p) => {
              const chip = statusChip[String(p.status || 'draft')] || statusChip.draft;
              return (
                <div key={p.id} role="button" tabIndex={0} onClick={() => void openProject(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') void openProject(p.id); }} style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer' }} data-testid={`card-design-${p.id}`}>
                  <div style={{ height: 118, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.final_video_url ? <video src={p.final_video_url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : p.video_url ? <video src={p.video_url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <FilmIcon size={24} color={T.dim} />}
                  </div>
                  <div style={{ padding: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: T.bone, fontSize: 13, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>{p.title || `Design ${p.id}`}</span>
                      <span style={{ flexShrink: 0, color: chip.color, background: chip.bg, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, borderRadius: 999, padding: '3px 8px' }}>{chip.label}</span>
                    </div>
                    <div style={{ color: T.muted, fontSize: 11, marginTop: 5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.stage_note || (p.video_duration_s ? `${Math.round(Number(p.video_duration_s))}s · ${(p.graphics || []).length} graphics` : '')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- open project
  const status = String(open.status || 'draft');
  const inPipeline = PIPELINE_STATUSES.includes(status) || running;
  const hasTranscript = !!open.transcript?.segments?.length;

  // The finished editor.
  if (status === 'ready' && !running) {
    return (
      <DesignEditor
        project={open}
        onBack={() => { setOpen(null); void refresh(); }}
        applyPatch={applyPatch}
        running={running}
        onRunDirective={(directive) => { say(`Design directive: ${directive}`); void drive(open, directive); }}
      />
    );
  }

  const chip = statusChip[status] || statusChip.draft;
  const stageIdx = designStageIndex(open.status);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', fontFamily: T.sans }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" onClick={() => { setOpen(null); void refresh(); }} style={btn()} data-testid="button-design-back"><ArrowLeft size={13} /> My Designs</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: T.bone, fontSize: 16, fontWeight: 800, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{open.title || `Design ${open.id}`}</div>
          <div style={{ color: T.muted, fontSize: 11.5 }}>{open.video_duration_s ? `${Math.round(Number(open.video_duration_s))}s video` : ''}{running ? ' · working…' : ''}</div>
        </div>
        <span style={{ color: chip.color, background: chip.bg, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, borderRadius: 999, padding: '5px 11px' }}>{chip.label}</span>
        <button type="button" onClick={() => void removeProject(open)} title="Delete design" style={{ ...btn(), padding: 9 }}><Trash2 size={13} /></button>
      </div>

      {open.error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.2)', borderRadius: 10, padding: '10px 13px', marginBottom: 14 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{open.error}</span>
        </div>
      ) : null}

      {inPipeline ? (
        <>
          {/* agentic stage rail */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {DESIGN_STAGES.map((s, i) => {
              const state = open.status === 'ready' || i < stageIdx ? 'done' : i === stageIdx ? 'live' : 'todo';
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999, border: `1px solid ${state === 'live' ? T.gold : state === 'done' ? 'rgba(127,212,180,0.4)' : T.line}`, background: state === 'live' ? 'rgba(232,163,60,0.1)' : state === 'done' ? 'rgba(127,212,180,0.08)' : 'transparent' }}>
                  {state === 'done' ? <Check size={12} color={T.done} /> : state === 'live' ? <Loader2 size={12} color={T.gold} className={running ? 'animate-spin' : ''} /> : <span style={{ width: 12 }} />}
                  <span style={{ color: state === 'todo' ? T.dim : T.bone, fontSize: 11.5, fontWeight: 700 }}>{s.label}</span>
                </div>
              );
            })}
          </div>
          {open.stage_note ? <div style={{ color: T.muted, fontSize: 12.5, background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: '11px 14px', marginBottom: 14 }}>{open.stage_note}</div> : null}
          {status === 'error' && !running ? (
            <button type="button" style={btn(true)} onClick={() => { say('Retrying…'); void drive(open); }}><Sparkles size={13} /> Retry from where it stopped</button>
          ) : null}
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14, marginTop: 14 }}>
            <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Director feed</div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.length === 0 ? <div style={{ color: T.dim, fontSize: 11.5 }}>Live design notes appear here.</div>
                : [...notes].reverse().map((n) => (
                  <div key={`${n.at}-${n.text.slice(0, 18)}`} style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5 }}>
                    <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 10 }}>{new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {n.text}
                  </div>
                ))}
            </div>
          </div>
        </>
      ) : (
        /* -------- wizard: steps ② ③ ④ (① done — the video is uploaded) -------- */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {stepBadge('1', true, false)}
              <span style={{ color: T.bone, fontSize: 13.5, fontWeight: 800 }}>Video uploaded</span>
              <span style={{ color: T.dim, fontSize: 11.5 }}>{open.video_w && open.video_h ? `${open.video_w}×${open.video_h} · ` : ''}{open.video_duration_s ? fmtTime(Number(open.video_duration_s)) : ''}</span>
            </div>
            {open.video_url ? <video src={open.video_url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 300, borderRadius: 10, background: '#000' }} /> : null}
          </div>

          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {stepBadge('2', hasTranscript, !hasTranscript)}
              <span style={{ color: T.bone, fontSize: 13.5, fontWeight: 800 }}>Transcript</span>
              {hasTranscript ? <span style={{ color: T.dim, fontSize: 11.5 }}>{open.transcript!.segments.length} timestamped lines · {open.transcript!.source === 'auto' ? 'auto-generated' : `imported ${open.transcript!.source.toUpperCase()}`}</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={transcribing || status === 'transcribing'} onClick={() => void generateTranscript()} style={btn(!hasTranscript, transcribing)} data-testid="button-auto-transcribe">
                {transcribing || status === 'transcribing' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} {hasTranscript ? 'Re-transcribe' : 'Auto Generate'}
              </button>
              <label style={{ ...btn(), cursor: 'pointer' }}><Import size={12} /> Import SRT / VTT<input type="file" accept=".srt,.vtt,text/plain" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSubtitles(f); e.target.value = ''; }} /></label>
            </div>
            {hasTranscript ? (
              <div style={{ maxHeight: 190, overflowY: 'auto', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {open.transcript!.segments.slice(0, 60).map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 8, color: T.muted, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: T.gold, fontFamily: T.mono, fontSize: 10, minWidth: 44, textAlign: 'right', paddingTop: 2 }}>{fmtTime(s.start)}</span>
                    <span>{s.speaker ? <b style={{ color: T.bone }}>{s.speaker}: </b> : null}{s.text}</span>
                  </div>
                ))}
                {open.transcript!.segments.length > 60 ? <div style={{ color: T.dim, fontSize: 11 }}>…and {open.transcript!.segments.length - 60} more lines (fully editable in the editor).</div> : null}
              </div>
            ) : null}
          </div>

          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {stepBadge('3', false, hasTranscript)}
              <span style={{ color: T.bone, fontSize: 13.5, fontWeight: 800 }}>Visual style</span>
            </div>
            <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, border: `1px solid ${T.line}`, flexWrap: 'wrap' }}>
              {([['auto_brand', 'Auto Brand'], ['minimal', 'Minimal'], ['cinematic', 'Cinematic']] as [StylePref, string][]).map(([id, lbl]) => (
                <button key={id} type="button" onClick={() => void applyPatch({ style: id })} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: (open.style || 'auto_brand') === id ? T.coral : 'transparent', color: (open.style || 'auto_brand') === id ? '#1A0E08' : T.muted }} data-testid={`button-style-${id}`}>{lbl}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 14 }}>
              <div>
                <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Product URL (optional — brand context)</div>
                <input style={inputStyle} placeholder="https://yourproduct.com" value={open.product_url || ''} onChange={(e) => setOpen((p) => (p ? { ...p, product_url: e.target.value } : p))} onBlur={(e) => void applyPatch({ product_url: e.target.value.trim() || null })} data-testid="input-design-product-url" />
              </div>
              <div>
                <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Screenshots / assets (optional)</div>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1px dashed ${T.lineStrong}`, borderRadius: 10, padding: '11px 12px', color: T.muted, fontSize: 12, cursor: 'pointer' }}>
                  {assetBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} {assetBusy ? 'Uploading…' : 'Add product screenshots (up to 6)'}
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void onPickAssets(e.target.files); e.target.value = ''; }} />
                </label>
                {(open.assets || []).length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {(open.assets || []).map((a) => (
                      <div key={a.url} style={{ position: 'relative' }}>
                        <img src={a.url} alt={a.shows} style={{ width: 66, height: 46, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.line}` }} />
                        <button type="button" onClick={() => void applyPatch({ assets: (open.assets || []).filter((x) => x.url !== a.url) })} title="Remove" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: 'none', background: T.fault, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {formError ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.fault, fontSize: 12 }}><AlertTriangle size={13} /> {formError}</div> : null}

          <div>
            <button type="button" disabled={!hasTranscript || transcribing} onClick={designMyVideo} style={{ ...btn(true, !hasTranscript || transcribing), padding: '13px 30px', fontSize: 14, boxShadow: '0 2px 10px rgba(255,107,74,0.25)' }} data-testid="button-design-my-video">
              <Sparkles size={15} /> Design My Video
            </button>
            <div style={{ color: T.dim, fontSize: 11.5, marginTop: 8 }}>Opus 5 will plan graphics per timestamp, build them with GSAP + SVG, sync them to your words, and quality-check its own work — then everything is editable.</div>
          </div>
        </div>
      )}
    </div>
  );
}
