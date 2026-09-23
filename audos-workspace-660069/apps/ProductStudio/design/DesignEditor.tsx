/**
 * DESIGN WITH AI — the post-generation editor.
 *
 * Large live preview (the ORIGINAL video with GSAP/SVG overlays seeked to the
 * playhead — no render needed), an editable multi-row timeline (video /
 * graphics / captions / audio), a clip inspector for the selected graphic
 * (move, resize, reposition, animations, text, opacity, scale, duplicate,
 * delete, AI regenerate), whole-design AI controls (regenerate / more
 * dynamic / minimal / product-focused / cinematic / professional / brand
 * style + layout + density), the editable transcript with SRT import/export,
 * the agentic quality report, and the canvas+FFmpeg export.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Copy, Download, Loader2, Pause, Play,
  RefreshCw, ShieldCheck, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import {
  AnimIn, AnimOut, DesignGraphic, DesignProject, LayoutPref, OverlayPosition,
  OverlayTreatment, T, clamp, designFrameSize, fmtTime, newGraphicId, paletteFromBrand,
} from './api';
import { downloadText, parseSubtitles, retimeSegment, toSrt } from './transcript';
import { regenerateGraphic } from './designDirector';
import { BuiltOverlay, buildOverlayGraphic, slotRegion } from './overlayGraphics';
import { pollVeo, submitVeo } from '../../ScriptToVideo/pipeline/veo';
import { exportDesign } from './designExport';
import { recheckQuality, resolveOverlaps } from './designRun';

const TREATMENT_LABEL: Record<string, string> = {
  kinetic_type: 'Kinetic type', lower_third: 'Lower third', stat: 'Stat', bar_chart: 'Bar chart',
  decay_chart: 'Decay chart', list_reveal: 'Checklist', callout: 'Callout', arrow_flow: 'Step flow',
  icon_badge: 'Icon badge', diagram: 'Diagram', progress: 'Progress', compare: 'Compare',
  quote_card: 'Quote', image_card: 'Screenshot card', broll: 'AI footage',
};
const POSITIONS: OverlayPosition[] = ['left_third', 'right_third', 'top_third', 'bottom_third', 'lower_third', 'center', 'full'];
const ANIMS_IN: AnimIn[] = ['fade', 'fade_slide_left', 'fade_slide_right', 'fade_slide_up', 'fade_slide_down', 'pop', 'wipe'];
const ANIMS_OUT: AnimOut[] = ['fade', 'slide_left', 'slide_right', 'slide_down', 'shrink'];
const TREATMENTS = Object.keys(TREATMENT_LABEL) as OverlayTreatment[];

const LANE_COLORS: Record<string, string> = {
  kinetic_type: '#E8A33C', lower_third: '#7FB7D9', stat: '#7FD4B4', bar_chart: '#7FD4B4',
  decay_chart: '#7FD4B4', list_reveal: '#B387F5', callout: '#FF6B4A', arrow_flow: '#B387F5',
  icon_badge: '#E8A33C', diagram: '#B387F5', progress: '#7FD4B4', compare: '#7FB7D9',
  quote_card: '#F26D6D', image_card: '#5EA8FF', broll: '#D98BFF',
};

interface Props {
  project: DesignProject;
  onBack: () => void;
  /** Persist a patch to the row and mirror it into parent state. */
  applyPatch: (patch: Partial<DesignProject>) => Promise<void>;
  /** Whole-design AI redesign (hands off to the progress pipeline). */
  onRunDirective: (directive: string) => void;
  running: boolean;
}

export default function DesignEditor({ project, onBack, applyPatch, onRunDirective, running }: Props) {
  const graphics = useMemo(() => (project.graphics || []).slice().sort((a, b) => a.start - b.start), [project.graphics]);
  const duration = Math.max(1, Number(project.video_duration_s) || 1);
  const palette = project.plan?.palette || paletteFromBrand(project.brand);
  const { W, H } = designFrameSize(project);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const overlaysRef = useRef<Map<string, BuiltOverlay>>(new Map());
  const brollRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [exportNote, setExportNote] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [editingSeg, setEditingSeg] = useState<string | null>(null);
  const [segDraft, setSegDraft] = useState('');

  const selected = graphics.find((g) => g.id === selectedId) || null;

  // ------------------------------------------------ live overlay preview
  const overlayKey = useMemo(() => graphics.map((g) => `${g.id}:${g.rev}:${g.enabled ? 1 : 0}:${g.start}:${g.end}:${g.position}:${g.scale}:${g.opacity}:${g.anim_in}:${g.anim_out}`).join('|'), [graphics]);
  useEffect(() => {
    let cancelled = false;
    const host = overlayHostRef.current;
    if (!host) return undefined;
    (async () => {
      const next = new Map<string, BuiltOverlay>();
      for (const g of graphics.filter((x) => x.enabled && !x.use_omni)) {
        try {
          const built = await buildOverlayGraphic(g, W, H, palette, project.head);
          if (cancelled) { try { built.timeline.kill(); } catch { /* released */ } return; }
          built.svg.style.position = 'absolute';
          built.svg.style.inset = '0';
          built.svg.style.width = '100%';
          built.svg.style.height = '100%';
          built.svg.style.display = 'none';
          built.svg.style.pointerEvents = 'none';
          next.set(g.id, built);
        } catch { /* a broken graphic simply doesn't preview */ }
      }
      if (cancelled) return;
      overlaysRef.current.forEach((b) => { try { b.timeline.kill(); } catch { /* released */ } b.svg.remove(); });
      overlaysRef.current = next;
      next.forEach((b) => host.appendChild(b.svg));
    })();
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((b) => { try { b.timeline.kill(); } catch { /* released */ } b.svg.remove(); });
      overlaysRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, W, H, palette.bg, palette.ink, palette.accent, palette.accent2, project.head]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const now = v.currentTime;
        setT(now);
        graphics.forEach((g) => {
          const built = overlaysRef.current.get(g.id);
          if (!built) return;
          const active = g.enabled && now >= g.start && now < g.end;
          built.svg.style.display = active ? '' : 'none';
          if (active) { try { built.timeline.seek(Math.max(0.001, now - g.start), false); } catch { /* seek race */ } }
        });
        graphics.forEach((g) => {
          if (!g.use_omni) return;
          const el = brollRefs.current.get(g.id);
          if (!el) return;
          const active = g.enabled && !!g.clip_url && now >= g.start && now < g.end;
          el.style.display = active ? '' : 'none';
          if (!active) { if (!el.paused) el.pause(); return; }
          const local = Math.max(0, Math.min(now - g.start, Math.max(0.1, (Number(el.duration) || 8) - 0.05)));
          if (Math.abs(el.currentTime - local) > 0.35) { try { el.currentTime = local; } catch { /* seek race */ } }
          if (!v.paused && el.paused) { void el.play().catch(() => undefined); }
          if (v.paused && !el.paused) el.pause();
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graphics]);

  const seek = (to: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = clamp(to, 0, duration - 0.01);
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  // ------------------------------------------------ graphics mutations
  const saveGraphics = (gs: DesignGraphic[]) => { void applyPatch({ graphics: gs }); };
  const patchGraphic = (id: string, patch: Partial<DesignGraphic>, bumpRev = true) => {
    saveGraphics(graphics.map((g) => (g.id === id ? { ...g, ...patch, rev: bumpRev ? g.rev + 1 : g.rev } : g)));
  };
  const removeGraphic = (id: string) => {
    if (selectedId === id) setSelectedId(null);
    saveGraphics(graphics.filter((g) => g.id !== id));
  };
  const duplicateGraphic = (g: DesignGraphic) => {
    const copy: DesignGraphic = { ...g, id: newGraphicId(), start: Math.min(duration - 1.4, g.end + 0.3), end: Math.min(duration, g.end + 0.3 + (g.end - g.start)), rev: 0 };
    saveGraphics(resolveOverlaps([...graphics, copy], duration));
    setSelectedId(copy.id);
  };
  const regenOne = async (g: DesignGraphic, withNote: boolean) => {
    let instruction: string | undefined;
    if (withNote) {
      const answer = window.prompt('What should change about this graphic?', '');
      if (answer === null) return;
      instruction = answer.trim() || undefined;
    }
    setBusy(`Regenerating “${TREATMENT_LABEL[g.treatment] || g.treatment}”…`);
    try {
      let fixed = await regenerateGraphic(g, {
        plan: project.plan, head: project.head, brand: project.brand, assets: project.assets || [],
        videoDuration: duration, segments: project.transcript?.segments || [],
      }, instruction);
      if (fixed.use_omni) {
        setBusy('Generating the AI footage for the redesigned cue…');
        try { fixed = { ...fixed, clip_url: await generateClip(fixed), clip_error: null }; }
        catch (e: any) { fixed = { ...fixed, clip_error: String(e?.message || e).slice(0, 240) }; }
      }
      saveGraphics(resolveOverlaps(graphics.map((x) => (x.id === g.id ? fixed : x)), duration));
      setNote(fixed.use_omni && fixed.clip_error ? `Graphic regenerated, but its footage failed: ${fixed.clip_error}` : 'Graphic regenerated — only this one changed.');
    } catch (e: any) { setNote(String(e?.message || e)); }
    finally { setBusy(''); }
  };

  // ------------------------------------------------ Omni footage (broll cues)
  /** Generate the Omni footage clip for one cutaway cue (browser-orchestrated,
   * same submit/poll pattern as the Script-to-Video pipeline). */
  const generateClip = async (g: DesignGraphic): Promise<string> => {
    const prompt = String(g.omni_prompt || g.visual_concept || g.narration_ref || '').trim();
    if (!prompt) throw new Error('This cue has no footage prompt — add one in the inspector first.');
    const aspect = (Number(project.video_w) || 16) >= (Number(project.video_h) || 9) ? '16:9' as const : '9:16' as const;
    const { operationId } = await submitVeo({ prompt, aspect, durationS: Math.min(8, Math.max(4, g.end - g.start)) });
    return pollVeo(operationId);
  };
  const regenFootage = async (g: DesignGraphic) => {
    setBusy('Generating AI footage — this takes a minute or two…');
    try {
      const url = await generateClip(g);
      patchGraphic(g.id, { clip_url: url, clip_error: null, enabled: true });
      setNote('Footage ready — it previews and exports at its timestamp.');
    } catch (e: any) {
      patchGraphic(g.id, { clip_error: String(e?.message || e).slice(0, 240) }, false);
      setNote(String(e?.message || e));
    } finally { setBusy(''); }
  };

  // ------------------------------------------------ timeline drag
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; mode: 'move' | 'left' | 'right'; x0: number; s0: number; e0: number } | null>(null);
  const [dragTimes, setDragTimes] = useState<{ id: string; start: number; end: number } | null>(null);

  const pxPerSec = () => (laneRef.current ? laneRef.current.clientWidth / duration : 10);
  const onBlockDown = (e: React.PointerEvent, g: DesignGraphic, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: g.id, mode, x0: e.clientX, s0: g.start, e0: g.end };
    setSelectedId(g.id);
  };
  const onLaneMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / pxPerSec();
    let s = d.s0; let en = d.e0;
    if (d.mode === 'move') { const len = d.e0 - d.s0; s = clamp(d.s0 + dt, 0, duration - len); en = s + len; }
    else if (d.mode === 'left') s = clamp(d.s0 + dt, 0, d.e0 - 1);
    else en = clamp(d.e0 + dt, d.s0 + 1, duration);
    setDragTimes({ id: d.id, start: Math.round(s * 20) / 20, end: Math.round(en * 20) / 20 });
  };
  const onLaneUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && dragTimes && dragTimes.id === d.id) {
      patchGraphic(d.id, { start: dragTimes.start, end: dragTimes.end });
    }
    setDragTimes(null);
  };
  const timesOf = (g: DesignGraphic) => (dragTimes && dragTimes.id === g.id ? dragTimes : { start: g.start, end: g.end });

  // ------------------------------------------------ transcript edits
  const commitSegment = (segId: string) => {
    const tr = project.transcript;
    if (!tr) return;
    const segments = tr.segments.map((s) => (s.id === segId ? retimeSegment(s, segDraft) : s));
    void applyPatch({ transcript: { ...tr, segments, words: segments.flatMap((s) => s.words) } });
    setEditingSeg(null);
  };
  const importSrt = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseSubtitles(text);
      if (!window.confirm(`Replace the current transcript with ${parsed.segments.length} imported cues? Graphics keep their timing until you regenerate.`)) return;
      void applyPatch({ transcript: parsed });
      setNote('Transcript replaced from the imported file — no retranscription needed.');
    } catch (e: any) { setNote(String(e?.message || e)); }
  };

  // ------------------------------------------------ QA + export
  const [qaBusy, setQaBusy] = useState(false);
  const runQa = async () => {
    setQaBusy(true);
    try { await recheckQuality(project, { onProject: (patch) => void applyPatch(patch), onNote: setNote }); }
    catch (e: any) { setNote(String(e?.message || e)); }
    finally { setQaBusy(false); }
  };
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const doExport = async () => {
    const v = videoRef.current;
    if (v && !v.paused) { v.pause(); setPlaying(false); }
    setExporting(true); setExportNote(''); setExportProgress('Starting…');
    try {
      const res = await exportDesign(project, graphics, project.head, (n) => setExportProgress(n));
      await applyPatch({ final_video_url: res.url });
      setExportNote(res.note || `Exported as ${res.format.toUpperCase()}.`);
    } catch (e: any) { setExportNote(String(e?.message || e)); }
    finally { setExporting(false); setExportProgress(''); }
  };

  const aiControls: { label: string; directive: string }[] = [
    { label: 'Regenerate Design', directive: 'Produce a fresh, stronger visual design for the whole video.' },
    { label: 'More Dynamic', directive: 'Make the design more dynamic: bolder motion, more energetic treatments, snappier pacing — without becoming noisy.' },
    { label: 'More Minimal', directive: 'Make the design more minimal: fewer graphics, quieter palette, more whitespace, subtler motion.' },
    { label: 'More Product-Focused', directive: 'Make the design more product-focused: prioritize real screenshots (image_card), feature callouts and concrete product moments over abstract graphics.' },
    { label: 'More Cinematic', directive: 'Make the design more cinematic: filmic palette, dramatic type, confident slow moves.' },
    { label: 'More Professional', directive: 'Make the design more professional and restrained: corporate-clean layout, precise labels, conservative motion.' },
  ];

  const inputStyle: React.CSSProperties = { width: '100%', background: T.canvas, border: `1px solid ${T.line}`, borderRadius: 8, color: T.bone, fontSize: 12, padding: '7px 9px', fontFamily: T.sans };
  const btn = (primary = false): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, background: primary ? T.coral : 'transparent', color: primary ? '#1A0E08' : T.muted, border: primary ? 'none' : `1px solid ${T.line}`, borderRadius: 9, padding: primary ? '9px 16px' : '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
  const label = (text: string) => <div style={{ color: T.muted, fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>{text}</div>;

  const qaIssuesOpen = (project.qa?.issues || []).filter((i) => !i.fixed);

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(14px, 2.5vw, 26px)', fontFamily: T.sans }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" onClick={onBack} style={btn()} data-testid="button-design-editor-back"><ArrowLeft size={13} /> Design with AI</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: T.bone, fontSize: 15, fontWeight: 800, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{project.title || `Design ${project.id}`}</div>
          <div style={{ color: T.muted, fontSize: 11 }}>{graphics.filter((g) => g.enabled).length} graphics · {Math.round(duration)}s · original video untouched</div>
        </div>
        <button type="button" disabled={qaBusy || exporting} onClick={() => void runQa()} style={btn()} title="Run the agentic quality check again">
          {qaBusy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Quality Check
        </button>
        <button type="button" disabled={exporting || running} onClick={() => void doExport()} style={btn(true)} data-testid="button-design-export">
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {exporting ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {busy || note || exportProgress ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.muted, fontSize: 12, background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
          {(busy || exporting) ? <Loader2 size={12} color={T.gold} className="animate-spin" /> : <Sparkles size={12} color={T.done} />}
          <span style={{ flex: 1 }}>{exportProgress || busy || note}</span>
          {note && !busy && !exportProgress ? <button type="button" onClick={() => setNote('')} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', display: 'inline-flex' }}><X size={12} /></button> : null}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' }}>
        {/* left: preview + timeline */}
        <div style={{ minWidth: 0 }}>
          <div style={{ position: 'relative', background: '#000', borderRadius: 14, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: `${W} / ${H}` }}>
              <video
                ref={videoRef}
                src={project.video_url || undefined}
                crossOrigin="anonymous"
                playsInline
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                data-testid="video-design-preview"
              />
              {graphics.filter((g) => g.enabled && g.use_omni && g.clip_url).map((g) => {
                const R = slotRegion(g.position, project.head);
                const full = R.w >= 0.89 && R.h >= 0.84;
                return (
                  <video
                    key={`${g.id}-broll-${g.rev}`}
                    ref={(el) => { if (el) brollRefs.current.set(g.id, el); else brollRefs.current.delete(g.id); }}
                    src={g.clip_url!}
                    muted
                    playsInline
                    preload="auto"
                    style={{ position: 'absolute', left: `${R.x * 100}%`, top: `${R.y * 100}%`, width: `${R.w * 100}%`, height: `${R.h * 100}%`, objectFit: 'cover', borderRadius: full ? 0 : 14, boxShadow: full ? 'none' : '0 12px 34px rgba(0,0,0,0.5)', opacity: clamp(Number(g.opacity) || 1, 0.2, 1), display: 'none', pointerEvents: 'none' }}
                  />
                );
              })}
              <div ref={overlayHostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.raised, borderTop: `1px solid ${T.line}` }}>
              <button type="button" onClick={togglePlay} style={{ ...btn(true), padding: '8px 12px' }} data-testid="button-design-play">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <span style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono, minWidth: 86 }}>{fmtTime(t)} / {fmtTime(duration)}</span>
              <input type="range" min={0} max={duration} step={0.05} value={t} onChange={(e) => seek(Number(e.target.value))} style={{ flex: 1, accentColor: T.coral }} aria-label="Seek" />
            </div>
          </div>

          {/* timeline */}
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
            {label('Timeline — drag to move, edges to resize, click to inspect')}
            <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr', rowGap: 6, alignItems: 'center' }}>
              <span style={{ color: T.dim, fontSize: 9.5, fontFamily: T.mono }}>VIDEO</span>
              <div style={{ position: 'relative', height: 22, borderRadius: 6, background: 'rgba(94,168,255,0.2)', border: '1px solid rgba(94,168,255,0.35)', cursor: 'pointer' }}
                onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * duration); }}>
                <span style={{ position: 'absolute', left: 8, top: 3, color: '#9CC4F5', fontSize: 9.5, fontFamily: T.mono }}>ORIGINAL VIDEO (never modified)</span>
              </div>

              <span style={{ color: T.dim, fontSize: 9.5, fontFamily: T.mono }}>GRAPHICS</span>
              <div ref={laneRef} onPointerMove={onLaneMove} onPointerUp={onLaneUp} onPointerLeave={onLaneUp}
                style={{ position: 'relative', height: 46, borderRadius: 6, background: T.canvas, border: `1px solid ${T.line}`, overflow: 'hidden', touchAction: 'none' }}>
                {graphics.map((g) => {
                  const tt = timesOf(g);
                  const left = (tt.start / duration) * 100;
                  const width = Math.max(0.8, ((tt.end - tt.start) / duration) * 100);
                  const color = LANE_COLORS[g.treatment] || T.gold;
                  const isSel = g.id === selectedId;
                  return (
                    <div key={g.id}
                      onPointerDown={(e) => onBlockDown(e, g, 'move')}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(g.id); seek(tt.start + 0.15); }}
                      title={`${TREATMENT_LABEL[g.treatment] || g.treatment} · ${g.visual_concept || g.narration_ref}`}
                      style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: g.position === 'lower_third' ? 24 : 4, height: 18, borderRadius: 5, background: g.enabled ? `${color}44` : 'rgba(141,139,148,0.15)', border: `1.5px solid ${isSel ? T.coral : g.enabled ? color : T.line}`, cursor: 'grab', overflow: 'hidden' }}
                      data-testid={`block-graphic-${g.id}`}>
                      <div onPointerDown={(e) => onBlockDown(e, g, 'left')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
                      <span style={{ display: 'block', padding: '2px 7px', color: g.enabled ? T.bone : T.dim, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{TREATMENT_LABEL[g.treatment] || g.treatment}</span>
                      <div onPointerDown={(e) => onBlockDown(e, g, 'right')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
                    </div>
                  );
                })}
                <div style={{ position: 'absolute', left: `${(t / duration) * 100}%`, top: 0, bottom: 0, width: 1.5, background: T.coral, pointerEvents: 'none' }} />
              </div>

              <span style={{ color: T.dim, fontSize: 9.5, fontFamily: T.mono }}>CAPTIONS</span>
              <div style={{ position: 'relative', height: 16, borderRadius: 5, background: T.canvas, border: `1px solid ${T.line}`, overflow: 'hidden', cursor: 'pointer' }}
                onClick={() => setShowTranscript((s) => !s)} title="Open the transcript">
                {(project.transcript?.segments || []).map((s) => (
                  <div key={s.id} style={{ position: 'absolute', left: `${(s.start / duration) * 100}%`, width: `${Math.max(0.4, ((s.end - s.start) / duration) * 100)}%`, top: 3, bottom: 3, borderRadius: 3, background: 'rgba(232,163,60,0.4)' }} />
                ))}
              </div>

              <span style={{ color: T.dim, fontSize: 9.5, fontFamily: T.mono }}>AUDIO</span>
              <div style={{ height: 12, borderRadius: 5, background: 'repeating-linear-gradient(90deg, rgba(127,212,180,0.35) 0 3px, rgba(127,212,180,0.12) 3px 6px)', border: '1px solid rgba(127,212,180,0.25)' }} title="Original audio — carried through untouched" />
            </div>
          </div>

          {/* AI design controls */}
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
            {label('AI design')}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {aiControls.map((c) => (
                <button key={c.label} type="button" disabled={running || exporting} onClick={() => onRunDirective(c.directive)} style={btn()}>
                  <Wand2 size={11} /> {c.label}
                </button>
              ))}
              <button type="button" disabled={running || exporting} style={btn()} onClick={() => {
                const answer = window.prompt('Describe the brand style to design toward (colors, mood, references):', '');
                if (answer && answer.trim()) onRunDirective(`Change the brand style: ${answer.trim()}`);
              }}><Sparkles size={11} /> Change Brand Style</button>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              <div>
                {label('Layout — talking head')}
                <select value={project.layout_pref || 'auto'} style={{ ...inputStyle, width: 190 }} disabled={running}
                  onChange={(e) => { const v = e.target.value as LayoutPref; void applyPatch({ layout_pref: v }); onRunDirective(`Re-place the graphics for this layout: ${v === 'auto' ? 'auto-detected talking head' : v.replace(/_/g, ' ')}. Keep concepts and timing; change positions (and treatments only where a position change demands it).`); }}>
                  <option value="auto">Auto (detected)</option>
                  <option value="head_right">Talking Head Right</option>
                  <option value="head_left">Talking Head Left</option>
                  <option value="head_top">Talking Head Top</option>
                  <option value="dynamic">Dynamic</option>
                  <option value="full_screen">Full Screen graphics allowed</option>
                </select>
              </div>
              <div>
                {label('Density')}
                <select value={project.density || 'balanced'} style={{ ...inputStyle, width: 150 }} disabled={running}
                  onChange={(e) => { const v = e.target.value as DesignProject['density']; void applyPatch({ density: v }); onRunDirective(`Redesign at ${v} graphic density.`); }}>
                  <option value="minimal">Minimal</option>
                  <option value="balanced">Balanced</option>
                  <option value="rich">Rich</option>
                </select>
              </div>
            </div>
          </div>

          {/* transcript */}
          {showTranscript ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {label('Transcript — click a line to edit')}
                <span style={{ flex: 1 }} />
                <label style={{ ...btn(), cursor: 'pointer' }}>Import SRT/VTT<input type="file" accept=".srt,.vtt,text/plain" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSrt(f); e.target.value = ''; }} /></label>
                <button type="button" style={btn()} onClick={() => downloadText(`${(project.title || 'transcript').replace(/[^\w-]+/g, '_')}.srt`, toSrt(project.transcript?.segments || []))}><Download size={11} /> Export SRT</button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(project.transcript?.segments || []).map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <button type="button" onClick={() => seek(s.start)} style={{ background: 'none', border: 'none', color: T.gold, fontFamily: T.mono, fontSize: 10, cursor: 'pointer', paddingTop: 3, minWidth: 44, textAlign: 'right' }}>{fmtTime(s.start)}</button>
                    {editingSeg === s.id ? (
                      <div style={{ flex: 1 }}>
                        <textarea value={segDraft} onChange={(e) => setSegDraft(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} autoFocus />
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button type="button" style={btn(true)} onClick={() => commitSegment(s.id)}><Check size={11} /> Save</button>
                          <button type="button" style={btn()} onClick={() => setEditingSeg(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setEditingSeg(s.id); setSegDraft(s.text); }} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: T.muted, fontSize: 12, lineHeight: 1.5, cursor: 'text', padding: '2px 0' }}>{s.speaker ? <b style={{ color: T.bone }}>{s.speaker}: </b> : null}{s.text}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* export result */}
          {project.final_video_url || exportNote ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
              {label('Exported video')}
              {project.final_video_url ? (
                <>
                  <video key={project.final_video_url} src={project.final_video_url} controls playsInline style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 380 }} data-testid="video-design-final" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
                    <a href={project.final_video_url} download target="_blank" rel="noreferrer" style={{ ...btn(true), textDecoration: 'none' }} data-testid="link-design-download"><Download size={12} /> Download</a>
                    {exportNote ? <span style={{ color: T.muted, fontSize: 11.5 }}>{exportNote}</span> : null}
                  </div>
                </>
              ) : <div style={{ color: T.fault, fontSize: 12 }}>{exportNote}</div>}
            </div>
          ) : null}
        </div>

        {/* right: inspector + QA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 13 }}>
            {label('Clip inspector')}
            {!selected ? (
              <div style={{ color: T.dim, fontSize: 12, lineHeight: 1.6 }}>Click a graphic on the timeline to move, resize, restyle, regenerate or delete it — each graphic is independent.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: LANE_COLORS[selected.treatment] || T.gold, flexShrink: 0 }} />
                  <span style={{ color: T.bone, fontSize: 13, fontWeight: 800, flex: 1 }}>{TREATMENT_LABEL[selected.treatment] || selected.treatment}</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T.muted, fontSize: 11, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.enabled} onChange={(e) => patchGraphic(selected.id, { enabled: e.target.checked }, false)} /> shown
                  </label>
                </div>
                {selected.narration_ref ? <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5, fontStyle: 'italic' }}>“{selected.narration_ref}”</div> : null}
                {selected.visual_concept ? <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.5 }}>{selected.visual_concept}</div> : null}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>{label('Start (s)')}<input type="number" step={0.1} min={0} max={duration} value={selected.start} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { start: clamp(Number(e.target.value) || 0, 0, selected.end - 1) })} /></div>
                  <div>{label('End (s)')}<input type="number" step={0.1} min={0} max={duration} value={selected.end} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { end: clamp(Number(e.target.value) || 0, selected.start + 1, duration) })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>{label('Treatment')}<select value={selected.treatment} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { treatment: e.target.value as OverlayTreatment })}>{TREATMENTS.map((x) => <option key={x} value={x}>{TREATMENT_LABEL[x]}</option>)}</select></div>
                  <div>{label('Position')}<select value={selected.position} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { position: e.target.value as OverlayPosition })}>{POSITIONS.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>{label('Animate in')}<select value={selected.anim_in} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { anim_in: e.target.value as AnimIn })}>{ANIMS_IN.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></div>
                  <div>{label('Animate out')}<select value={selected.anim_out} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { anim_out: e.target.value as AnimOut })}>{ANIMS_OUT.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></div>
                </div>
                <div>{label(`Scale — ${Math.round(selected.scale * 100)}%`)}<input type="range" min={0.5} max={1.4} step={0.05} value={selected.scale} style={{ width: '100%', accentColor: T.coral }} onChange={(e) => patchGraphic(selected.id, { scale: Number(e.target.value) })} /></div>
                <div>{label(`Opacity — ${Math.round(selected.opacity * 100)}%`)}<input type="range" min={0.2} max={1} step={0.05} value={selected.opacity} style={{ width: '100%', accentColor: T.coral }} onChange={(e) => patchGraphic(selected.id, { opacity: Number(e.target.value) })} /></div>
                {'title' in (selected.spec || {}) || ['kinetic_type', 'lower_third', 'callout', 'quote_card', 'list_reveal', 'bar_chart', 'decay_chart', 'arrow_flow', 'diagram', 'progress', 'compare', 'icon_badge', 'image_card', 'stat'].includes(selected.treatment) ? (
                  <div>{label('Title text')}<input value={selected.spec.title || ''} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { spec: { ...selected.spec, title: e.target.value } })} /></div>
                ) : null}
                <div>{label('Subtitle text')}<input value={selected.spec.subtitle || ''} style={inputStyle} onChange={(e) => patchGraphic(selected.id, { spec: { ...selected.spec, subtitle: e.target.value } })} /></div>
                {selected.use_omni ? (
                  <div style={{ border: `1px solid ${T.line}`, borderRadius: 9, padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {label(selected.clip_url ? 'AI footage — generated' : 'AI footage — not generated yet')}
                    <textarea value={selected.omni_prompt || ''} rows={3} placeholder="Detailed footage prompt (subject, action, setting, camera, lighting — no on-screen text)" style={{ ...inputStyle, resize: 'vertical' }} onChange={(e) => patchGraphic(selected.id, { omni_prompt: e.target.value }, false)} />
                    {selected.clip_error ? <div style={{ color: T.fault, fontSize: 10.5, lineHeight: 1.4 }}>{selected.clip_error}</div> : null}
                    <button type="button" disabled={!!busy} style={btn(!selected.clip_url)} onClick={() => void regenFootage(selected)} data-testid="button-generate-footage">
                      <RefreshCw size={11} /> {selected.clip_url ? 'Redo footage' : 'Generate footage'}
                    </button>
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  <button type="button" disabled={!!busy} style={btn(true)} onClick={() => void regenOne(selected, false)} data-testid="button-regen-graphic"><RefreshCw size={11} /> Regenerate</button>
                  <button type="button" disabled={!!busy} style={btn()} onClick={() => void regenOne(selected, true)}><Wand2 size={11} /> With note</button>
                  <button type="button" style={btn()} onClick={() => duplicateGraphic(selected)}><Copy size={11} /> Duplicate</button>
                  <button type="button" style={{ ...btn(), color: T.fault, borderColor: 'rgba(226,114,111,0.4)' }} onClick={() => removeGraphic(selected.id)}><Trash2 size={11} /> Delete</button>
                </div>
              </div>
            )}
          </div>

          {/* quality report */}
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 13 }}>
            {label('Agentic quality check')}
            {!project.qa ? <div style={{ color: T.dim, fontSize: 11.5 }}>Not run yet.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: project.qa.pass ? T.done : T.gold, fontSize: 12, fontWeight: 700 }}>
                  {project.qa.pass ? <Check size={13} /> : <AlertTriangle size={13} />} {project.qa.pass ? 'Passed' : `${qaIssuesOpen.length} open issue(s)`}
                </div>
                {project.qa.summary ? <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5 }}>{project.qa.summary}</div> : null}
                {(project.qa.issues || []).map((i, idx) => (
                  <div key={`${i.graphic_id}-${idx}`} style={{ color: i.fixed ? T.dim : T.muted, fontSize: 11, lineHeight: 1.45, borderLeft: `2px solid ${i.fixed ? T.done : T.gold}`, paddingLeft: 8 }}>
                    {i.fixed ? 'Fixed — ' : ''}{i.issue}
                    {!i.fixed ? <button type="button" style={{ ...btn(), padding: '3px 8px', fontSize: 10, marginLeft: 6 }} onClick={() => { const g = graphics.find((x) => x.id === i.graphic_id); if (g) { setSelectedId(g.id); seek(g.start + 0.1); } }}>show</button> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {project.plan?.creative_direction ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 13 }}>
              {label('Creative direction')}
              <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.55 }}>{project.plan.creative_direction}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                {[palette.accent, palette.accent2, palette.bg, palette.ink].map((c, i) => <span key={`${c}${i}`} title={c} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: `1px solid ${T.lineStrong}` }} />)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
