/**
 * Video Enhancer — the unified "✨ Captions & Graphics" tab.
 *
 * One panel, two sub-tabs, replacing the old separate Script Graphics flow:
 * - Captions: LLM-generated caption STYLES (small canvas render functions
 *   written by gpt-5.6-terra, compiled with new Function and smoke-tested) —
 *   pick a swatch and the captions draw live on the preview canvas.
 * - Motion Graphics: the Motion Graphics Agent — transcribes the video
 *   (Whisper proxy, workspace fallback), sends the timestamped transcript plus
 *   the REAL frame geometry to gpt-5.6-terra, and shows the returned overlay
 *   timeline for review (delete cards, then Render Overlays) before it is
 *   drawn on the preview canvas and captured by the MediaRecorder export.
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  AlertCircle, Check, ChevronDown, Clapperboard, Download, Loader2, Sparkles, Trash2, Type, Video, Wand2,
} from 'lucide-react';
import {
  CaptionSegment, MAX_UPLOAD_BYTES, TranscriptWord, fetchVideoAsFile, formatTime, uploadVideo,
} from './enhancerCore';
import { updateEnhancerJob } from './jobStore';
import { MotionOverlay, generateOverlayPlan, getWordTranscript } from './motionAgent';
import { recordOverlayVideo } from './overlayCanvas';
import { CaptionStyleOption, builtinCaptionStyles, generateCaptionStyles } from './captionStyleGen';
import { card } from './uiControls';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  highlight_box: 'Highlight box',
  arrow: 'Arrow',
  circle: 'Circle',
  underline: 'Underline',
  callout_label: 'Callout',
  icon: 'Icon',
  stat_card: 'Stat card',
  progress_bar: 'Progress bar',
  particle_burst: 'Particle burst',
};

const primaryBtn = (enabled: boolean) => ({
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  fontSize: 13.5, fontWeight: 700, padding: '11px 14px', borderRadius: 10, border: 'none',
  cursor: enabled ? 'pointer' : 'not-allowed',
  background: enabled ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)',
  color: enabled ? '#fff' : 'var(--space-text-muted)',
} as const);

/** Mini canvas preview of one caption style rendering "Hello World". */
function StyleSwatch({ opt, active, onPick }: { opt: CaptionStyleOption; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const grad = ctx.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#111827');
    grad.addColorStop(1, '#1E2A44');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    try {
      ctx.scale(c.width / 960, c.height / 540);
      opt.fn(ctx, 'Hello World', 480, 290, 960, 540);
    } catch { /* a broken style renders an empty swatch, nothing more */ }
    ctx.restore();
  }, [opt]);
  return (
    <button
      onClick={onPick}
      className="ve-btn"
      title={opt.name + (opt.source === 'ai' ? ' (AI-generated)' : '')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: 5, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        border: '2px solid ' + (active ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'),
        background: active ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : 'var(--space-surface-card)',
      }}
    >
      <canvas ref={ref} width={176} height={99} style={{ width: '100%', display: 'block', borderRadius: 7 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--space-text-brand)' : 'var(--space-text-secondary)', padding: '0 2px' }}>
        {opt.name}{opt.source === 'ai' ? ' · AI' : ''}
      </span>
    </button>
  );
}

export default function CaptionsGraphicsPanel({
  meta, file, uploadedUrl, words, transcript, captions, captionsOn,
  overlays, setOverlays, overlaysVisible, setOverlaysVisible,
  captionStyle, setCaptionStyle,
  jobRowId, onToast, onWords,
}: {
  meta: { duration: number; width: number; height: number } | null;
  file: File | null;
  uploadedUrl: string;
  words: TranscriptWord[];
  transcript: string;
  captions: CaptionSegment[];
  captionsOn: boolean;
  overlays: MotionOverlay[];
  setOverlays: Dispatch<SetStateAction<MotionOverlay[]>>;
  overlaysVisible: boolean;
  setOverlaysVisible: (v: boolean) => void;
  captionStyle: CaptionStyleOption | null;
  setCaptionStyle: (s: CaptionStyleOption | null) => void;
  jobRowId: number | null;
  onToast: (m: string) => void;
  onWords: (w: TranscriptWord[], transcript: string) => void;
}) {
  const [tab, setTab] = useState<'captions' | 'graphics'>('captions');
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // ---- Captions sub-tab -----------------------------------------------------
  const [styles, setStyles] = useState<CaptionStyleOption[]>(() => builtinCaptionStyles());
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleErr, setStyleErr] = useState('');
  const [styleNote, setStyleNote] = useState('');

  const generateStyles = async () => {
    if (styleBusy) return;
    setStyleBusy(true); setStyleErr(''); setStyleNote('');
    try {
      const out = await generateCaptionStyles();
      if (!aliveRef.current) return;
      setStyles(out);
      const aiCount = out.filter((s) => s.source === 'ai').length;
      setStyleNote(aiCount
        ? 'AI wrote ' + aiCount + ' fresh caption style' + (aiCount === 1 ? '' : 's') + ' — pick one below.'
        : 'The AI styles could not be compiled — the built-in set below still works.');
      // Keep the selection pointing at the freshly generated function.
      if (captionStyle) {
        const updated = out.find((s) => s.id === captionStyle.id);
        if (updated) setCaptionStyle(updated);
      }
      onToast('Caption styles ready');
    } catch (e) {
      if (aliveRef.current) setStyleErr(msg(e));
    }
    if (aliveRef.current) setStyleBusy(false);
  };

  // ---- Shared: make sure a word-timed transcript exists ----------------------
  const ensureWords = async (setNote: (n: string) => void): Promise<{ words: TranscriptWord[]; transcript: string }> => {
    if (words.length) return { words, transcript };
    let f = file;
    if (!f) {
      if (!uploadedUrl) throw new Error('Upload a video first.');
      setNote('Fetching your stored video…');
      f = await fetchVideoAsFile(uploadedUrl);
    }
    const t = await getWordTranscript(f, (n) => { if (aliveRef.current) setNote(n); });
    if (t.words.length || t.transcript) onWords(t.words, t.transcript);
    return t;
  };

  // ---- Motion Graphics sub-tab ------------------------------------------------
  const [phase, setPhase] = useState<'idle' | 'transcribing' | 'analyzing'>('idle');
  const [planErr, setPlanErr] = useState('');
  const [planNote, setPlanNote] = useState('');
  const [listOpen, setListOpen] = useState(true);

  const generatePlan = async () => {
    if (phase !== 'idle') return;
    setPlanErr(''); setPlanNote('');
    if (!meta || (!file && !uploadedUrl)) { setPlanErr('Upload a video first — the agent analyzes its audio and frame size.'); return; }
    try {
      setPhase('transcribing');
      const t = await ensureWords((n) => { if (aliveRef.current) setPlanNote(n); });
      if (!aliveRef.current) return;
      if (!t.words.length && !t.transcript.trim()) {
        setPlanNote('No speech detected — the agent will plan from the video length alone.');
      }
      setPhase('analyzing');
      setPlanNote('The motion-graphics director is planning overlays for your ' + meta.width + '×' + meta.height + ' video…');
      const plan = await generateOverlayPlan({
        words: t.words,
        transcript: t.transcript,
        durationSec: meta.duration,
        width: meta.width,
        height: meta.height,
      });
      if (!aliveRef.current) return;
      if (!plan.length) throw new Error('The AI returned no usable overlays — try again.');
      setOverlays(plan);
      setOverlaysVisible(false);
      setListOpen(true);
      setPlanNote('Planned ' + plan.length + ' overlay' + (plan.length === 1 ? '' : 's') + '. Review the timeline below, remove any you don\u2019t want, then press Render Overlays.');
      onToast('Motion graphics plan ready — review it below');
    } catch (e) {
      if (aliveRef.current) { setPlanErr(msg(e)); setPlanNote(''); }
    }
    if (aliveRef.current) setPhase('idle');
  };

  // ---- Export with overlays (MediaRecorder) ------------------------------------
  const [recBusy, setRecBusy] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
  const [recErr, setRecErr] = useState('');
  const [recNote, setRecNote] = useState('');
  const [recUrl, setRecUrl] = useState('');

  const exportWithOverlays = async () => {
    if (recBusy) return;
    if (!file && !uploadedUrl) { setRecErr('Upload a video first.'); return; }
    if (!overlays.length && !captionStyle) { setRecErr('Generate motion graphics or pick a caption style first — there is nothing to bake in yet.'); return; }
    setRecBusy(true); setRecErr(''); setRecUrl(''); setRecProgress(0);
    setRecNote('Recording in real time at the video\u2019s native resolution — this takes about as long as the video itself…');
    try {
      const out = await recordOverlayVideo({
        file,
        srcUrl: uploadedUrl,
        overlays,
        captionFn: captionsOn && captionStyle ? captionStyle.fn : null,
        captions: captions.filter((c) => c.enabled && c.text.trim()).map((c) => ({ start: c.start, end: c.end, text: c.text })),
        onProgress: (p) => { if (aliveRef.current) setRecProgress(Math.round(p * 100)); },
        isAlive: () => aliveRef.current,
      });
      if (!aliveRef.current) return;
      setRecUrl(out.url); setRecProgress(100); setRecNote('');
      onToast('Overlay export ready');
      // Persist to the account job (video_enhancer_jobs) when a durable copy fits the upload limit.
      if (jobRowId && out.blob.size <= MAX_UPLOAD_BYTES) {
        try {
          const up = await uploadVideo(new File([out.blob], 'video-with-overlays.webm', { type: out.blob.type || 'video/webm' }));
          await updateEnhancerJob(jobRowId, { status: 'done', result_url: up.url });
        } catch { /* the local download above still works */ }
      }
    } catch (e) {
      if (aliveRef.current) { setRecErr(msg(e)); setRecNote(''); }
    }
    if (aliveRef.current) setRecBusy(false);
  };

  const busy = phase !== 'idle';
  const hasVideo = !!file || !!uploadedUrl;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Intro + sub-tabs */}
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Sparkles size={16} style={{ color: 'var(--space-text-brand)' }} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>Captions & Graphics</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', lineHeight: 1.5 }}>
          AI-designed caption styles and an automatic motion-graphics director, drawn live on the preview and baked into the in-browser export — at your video&apos;s real aspect ratio.
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: 4, marginTop: 10 }}>
          {([['captions', 'Captions', Type], ['graphics', 'Motion Graphics', Clapperboard]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className="ve-btn" style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 12.5, fontWeight: 700, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: tab === id ? 'var(--space-brand-primary-600)' : 'transparent',
              color: tab === id ? '#fff' : 'var(--space-text-secondary)',
            }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- Captions sub-tab ---------------- */}
      {tab === 'captions' && (
        <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Caption styles</div>
          <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            Each swatch is a live canvas render function. Generate lets the AI write brand-new styles as code — no hardcoded presets.
          </div>
          <button onClick={() => { void generateStyles(); }} disabled={styleBusy} className="ve-btn" style={{ ...primaryBtn(!styleBusy), marginTop: 10 }}>
            {styleBusy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {styleBusy ? 'AI is writing caption styles…' : 'Generate AI caption styles'}
          </button>
          {styleErr && <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><AlertCircle size={13} /> {styleErr}</div>}
          {styleNote && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 8 }}>{styleNote}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginTop: 12 }}>
            {styles.map((opt) => (
              <StyleSwatch key={opt.id} opt={opt} active={captionStyle?.id === opt.id} onPick={() => { setCaptionStyle(opt); onToast(opt.name + ' captions on — press play to watch them'); }} />
            ))}
          </div>
          {captionStyle && (
            <button onClick={() => setCaptionStyle(null)} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', marginTop: 10 }}>
              Turn canvas captions off
            </button>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            {captions.length
              ? captions.length + ' word-timed caption segments are ready — the selected style draws them on the preview and in the overlay export.'
              : 'Captions use the word-timed transcript. Upload a video (it transcribes automatically) or run Generate on the Motion Graphics sub-tab to transcribe now.'}
          </div>
        </div>
      )}

      {/* ---------------- Motion Graphics sub-tab ---------------- */}
      {tab === 'graphics' && (
        <>
          <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Motion Graphics Agent</div>
            <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 3, lineHeight: 1.5 }}>
              Transcribes your video, reads the real frame size{meta ? ' (' + meta.width + '×' + meta.height + ')' : ''}, and plans professional animated overlays — text, highlights, arrows, stat cards and more — matched to what is said, when it is said.
            </div>
            <button onClick={() => { void generatePlan(); }} disabled={busy || !hasVideo} className="ve-btn" style={{ ...primaryBtn(!busy && hasVideo), marginTop: 10 }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {phase === 'transcribing' ? 'Transcribing audio…' : phase === 'analyzing' ? 'Directing your overlays…' : overlays.length ? 'Regenerate motion graphics' : 'Generate motion graphics'}
            </button>
            {!hasVideo && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 8 }}>Upload a video first — the agent analyzes its audio and dimensions.</div>}
            {planNote && <div style={{ fontSize: 12.5, color: busy ? 'var(--space-text-brand)' : 'var(--space-text-muted)', marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>{busy && <Loader2 size={13} className="animate-spin" />} {planNote}</div>}
            {planErr && <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><AlertCircle size={13} /> {planErr}</div>}
          </div>

          {/* Timeline review */}
          {overlays.length > 0 && (
            <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
              <button onClick={() => setListOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--space-text-primary)', textAlign: 'left' }}>
                <ChevronDown size={15} style={{ color: 'var(--space-text-muted)', transition: 'transform 0.18s', transform: listOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Overlay timeline ({overlays.length})</span>
                <span style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginLeft: 'auto' }}>delete any you don&apos;t want</span>
              </button>
              {listOpen && (
                <div style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {overlays.map((o) => (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '7px 9px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--space-brand-primary-500)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)', color: 'var(--space-text-primary)' }}>
                        {TYPE_LABEL[o.type] || o.type}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--space-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.content || '—'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--space-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(o.startTime)} → {formatTime(o.endTime)}
                      </span>
                      <button onClick={() => setOverlays((prev) => prev.filter((x) => x.id !== o.id))} title="Remove this overlay" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2, flexShrink: 0 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => { setOverlaysVisible(!overlaysVisible); onToast(overlaysVisible ? 'Overlays hidden' : 'Overlays are live on the preview — press play to watch them'); }}
                className="ve-btn"
                style={{ ...primaryBtn(true), marginTop: 10, background: overlaysVisible ? 'var(--space-surface-panel-strong)' : 'var(--space-brand-primary-600)', color: overlaysVisible ? 'var(--space-text-secondary)' : '#fff' }}
              >
                {overlaysVisible ? <Check size={15} /> : <Clapperboard size={15} />}
                {overlaysVisible ? 'Overlays live on preview — click to hide' : 'Render Overlays'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ---------------- Export with overlays (both sub-tabs) ---------------- */}
      {(overlays.length > 0 || captionStyle) && (
        <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={14} style={{ color: 'var(--space-text-brand)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Export with overlays</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            Captures the video + overlays + captions in real time at native resolution (WebM). The server-side Export tab remains available for the classic MP4 pipeline.
          </div>
          <button onClick={() => { void exportWithOverlays(); }} disabled={recBusy} className="ve-btn" style={{ ...primaryBtn(!recBusy), marginTop: 10 }}>
            {recBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {recBusy ? 'Recording… ' + recProgress + '%' : 'Export video with overlays'}
          </button>
          {recBusy && (
            <div style={{ height: 6, borderRadius: 999, background: 'var(--space-surface-panel-strong)', overflow: 'hidden', marginTop: 8 }}>
              <div style={{ height: '100%', width: Math.max(4, recProgress) + '%', borderRadius: 999, transition: 'width .3s ease', background: 'var(--space-brand-primary-600)' }} />
            </div>
          )}
          {recNote && <div style={{ fontSize: 12, color: 'var(--space-text-brand)', marginTop: 8 }}>{recNote}</div>}
          {recErr && <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><AlertCircle size={13} /> {recErr}</div>}
          {recUrl && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={14} style={{ color: 'var(--space-semantic-success-600)' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Overlay export ready</span>
                <a href={recUrl} download="video-with-overlays.webm" className="ve-btn" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--space-brand-primary-600)', borderRadius: 10, padding: '7px 12px', textDecoration: 'none' }}>
                  <Download size={13} /> Download WebM
                </a>
              </div>
              <video src={recUrl} controls playsInline style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 360, marginTop: 8 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
