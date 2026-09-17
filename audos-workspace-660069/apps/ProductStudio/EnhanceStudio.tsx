/**
 * Enhance Studio — the Video Enhancer's editing capabilities merged into
 * Product Video (Track B). Opens over a READY (rendered) product video: the
 * generated MP4 becomes the editable source. Nothing here touches the
 * trackb orchestrator → Remotion generation pipeline; it consumes its output.
 *
 * Capabilities (merged from apps/VideoEnhancer):
 *  - ONE-CLICK ENHANCE: automatic silence/cut detection (Web Audio RMS
 *    analysis from enhancerExtras) applied immediately as a non-destructive
 *    EDL — no manual cut drawing, with a progress indicator and a live
 *    preview that skips the cuts in real time.
 *  - CAPTIONS: word-timed transcription (enhancerCore.transcribeVideo →
 *    buildCaptionSegments) behind an "Add Captions" toggle; captions preview
 *    live over the player, burn into the export, and download as an SRT.
 *  - TRIM + COLOUR + AUDIO: start/end trim, one-tap look presets and
 *    brightness / contrast / saturation sliders (enhancerExtras.buildFilter),
 *    original-volume control and playback speed.
 *  - EXPORT: the same server-side Remotion render as the Video Enhancer
 *    (enhancerRender.submitRenderV2 — EDL cuts, captions, colour grade all
 *    composited into a downloadable MP4). Typography is Inter everywhere —
 *    clean modern sans-serif, no handwriting/script fonts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Captions, Check, Download, FileText, Loader2, Palette, RotateCcw,
  Scissors, Sparkles, Volume2, Wand2, X,
} from 'lucide-react';
import {
  fetchVideoAsFile, transcribeVideo, buildCaptionSegments, formatTime, checkRender,
  type CaptionSegment,
} from '../VideoEnhancer/enhancerCore';
import {
  decodeAudioMono, detectSilences, buildCuts, buildKeeps, keptDuration, buildFilter,
  defaultProject, LOOK_PRESETS, formatDuration, outputDims,
  type ProjectState, type SilenceRegion,
} from '../VideoEnhancer/enhancerExtras';
import { submitRenderV2 } from '../VideoEnhancer/enhancerRender';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

/** Clean modern typography everywhere in this editor — never handwriting. */
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const SILENCE_THRESHOLD_DB = -38;
const SILENCE_MIN_DUR_S = 0.5;
const SILENCE_PAD_MS = 120;

type EnhancePhase = 'idle' | 'fetching' | 'decoding' | 'detecting' | 'done' | 'error';

const ENHANCE_STEPS: { id: EnhancePhase; label: string; pct: number }[] = [
  { id: 'fetching', label: 'Fetching your rendered video…', pct: 20 },
  { id: 'decoding', label: 'Decoding the audio track…', pct: 55 },
  { id: 'detecting', label: 'Detecting cuts & applying them…', pct: 85 },
];

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function srtTimestamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return pad(h) + ':' + pad(m) + ':' + pad(s) + ',' + pad(rest, 3);
}

function buildSrt(segments: CaptionSegment[]): string {
  return segments
    .filter((s) => s.enabled && s.text.trim())
    .map((s, i) => (i + 1) + '\n' + srtTimestamp(s.start) + ' --> ' + srtTimestamp(s.end) + '\n' + s.text.trim())
    .join('\n\n') + '\n';
}

const sliderRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 };
const sliderLabel: React.CSSProperties = { flex: 'none', width: 92, fontSize: 12, fontWeight: 600, color: S.sub };
const sliderValue: React.CSSProperties = { flex: 'none', width: 44, textAlign: 'right', fontSize: 11.5, color: S.muted, fontVariantNumeric: 'tabular-nums' };

function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={sliderRow}>
      <span style={sliderLabel}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} style={{ flex: 1, accentColor: 'var(--space-brand-primary-600)' }} />
      <span style={sliderValue}>{format ? format(value) : String(value)}</span>
    </div>
  );
}

function SectionCard({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${S.border}`, background: S.panel, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>{title}</span>
        {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
      </div>
      {children}
    </div>
  );
}

export default function EnhanceStudio({ videoUrl, title, accent, onBack }: {
  /** The READY generated MP4 (trackb preview_video_url) — the editable source. */
  videoUrl: string;
  title: string;
  /** Brand primary hex for caption emphasis / accents (falls back to platform blue). */
  accent?: string | null;
  onBack: () => void;
}) {
  const accentHex = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#3B82F6';

  // ---- Source ----
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<File | null>(null);
  useEffect(() => { fileRef.current = file; }, [file]);
  const [duration, setDuration] = useState(0);
  const [srcDims, setSrcDims] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });

  // ---- Auto cuts (one-click Enhance) ----
  const [phase, setPhase] = useState<EnhancePhase>('idle');
  const [phaseNote, setPhaseNote] = useState('');
  const [phaseErr, setPhaseErr] = useState('');
  const [regions, setRegions] = useState<(SilenceRegion & { included: boolean })[]>([]);

  // ---- Trim ----
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0); // 0 = untouched (end of video)

  // ---- Colour / audio / speed (enhancerExtras editing model) ----
  const [proj, setProj] = useState<ProjectState>(() => defaultProject());
  const [lookId, setLookId] = useState('original');

  // ---- Captions ----
  const [captionsOn, setCaptionsOn] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [captionNote, setCaptionNote] = useState('');
  const [captionErr, setCaptionErr] = useState('');
  const [segments, setSegments] = useState<CaptionSegment[]>([]);

  // ---- Export ----
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [enhancedUrl, setEnhancedUrl] = useState('');
  const [viewOriginal, setViewOriginal] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playheadT, setPlayheadT] = useState(0);

  const showingOutput = !!enhancedUrl && !viewOriginal;

  // The applied edit decision list: trim + every included auto cut, merged.
  const cuts = useMemo(() => {
    if (!duration) return [] as SilenceRegion[];
    const all: SilenceRegion[] = regions.filter((r) => r.included).map((r) => ({ start: r.start, end: r.end }));
    if (trimStart > 0.04) all.push({ start: -1, end: trimStart + SILENCE_PAD_MS / 1000 });
    const effEnd = trimEnd > 0.04 && trimEnd < duration - 0.04 ? trimEnd : 0;
    if (effEnd) all.push({ start: effEnd - SILENCE_PAD_MS / 1000, end: duration + 1 });
    return buildCuts(all, SILENCE_PAD_MS, duration);
  }, [regions, trimStart, trimEnd, duration]);

  const keeps = useMemo(() => buildKeeps(duration || 1, cuts), [duration, cuts]);
  const keptSecs = useMemo(() => keptDuration(keeps), [keeps]);
  const includedCount = regions.filter((r) => r.included).length;

  const filter = useMemo(() => buildFilter(proj.grade, proj.style, proj.blur), [proj]);
  const speed = proj.motion.speed;

  const ensureFile = useCallback(async (note: (n: string) => void): Promise<File> => {
    if (fileRef.current) return fileRef.current;
    note('Fetching your rendered video…');
    const f = await fetchVideoAsFile(videoUrl);
    if (aliveRef.current) setFile(f);
    fileRef.current = f;
    return f;
  }, [videoUrl]);

  // ---- ONE-CLICK ENHANCE: detect silences and apply the cuts immediately ----
  const runEnhance = useCallback(async () => {
    if (phase === 'fetching' || phase === 'decoding' || phase === 'detecting' || exporting) return;
    setPhaseErr('');
    try {
      setPhase('fetching');
      setPhaseNote('Fetching your rendered video…');
      const f = await ensureFile((n) => { if (aliveRef.current) setPhaseNote(n); });
      if (!aliveRef.current) return;
      setPhase('decoding');
      setPhaseNote('Decoding the audio track…');
      const audio = await decodeAudioMono(f);
      if (!aliveRef.current) return;
      setDuration((d) => d || audio.duration);
      setPhase('detecting');
      setPhaseNote('Detecting dead air and applying the cuts…');
      const found = detectSilences(audio.samples, audio.sampleRate, SILENCE_THRESHOLD_DB, SILENCE_MIN_DUR_S);
      if (!aliveRef.current) return;
      // Applied immediately — every detected cut starts included. No separate
      // "apply" step: the preview below already plays with the cuts skipped.
      setRegions(found.map((r) => ({ ...r, included: true })));
      setPhase('done');
      setPhaseNote(found.length
        ? found.length + ' cut' + (found.length === 1 ? '' : 's') + ' detected and applied — the preview now skips them.'
        : 'No dead air found — your video is already tight. Trim, colour and captions below still apply.');
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase('error');
      setPhaseErr(msg(e));
    }
  }, [phase, exporting, ensureFile]);

  // ---- Captions: transcribe once when the toggle first turns on ----
  const runTranscription = useCallback(async () => {
    setCaptionErr('');
    setTranscribing(true);
    try {
      const f = await ensureFile((n) => { if (aliveRef.current) setCaptionNote(n); });
      if (!aliveRef.current) return;
      setCaptionNote('Transcribing the audio with word timestamps…');
      const t = await transcribeVideo(f, (n) => { if (aliveRef.current) setCaptionNote(n); });
      if (!aliveRef.current) return;
      if (!t.words.length) {
        setCaptionErr(t.transcript
          ? 'The transcription service returned no word timings, so captions cannot be timed to the speech. (This video may have no spoken audio.)'
          : 'No speech was detected in this video — captions need a voice track.');
        setCaptionsOn(false);
        return;
      }
      setSegments(buildCaptionSegments(t.words));
      setDuration((d) => d || t.duration);
    } catch (e) {
      if (!aliveRef.current) return;
      setCaptionErr(msg(e));
      setCaptionsOn(false);
    } finally {
      if (aliveRef.current) { setTranscribing(false); setCaptionNote(''); }
    }
  }, [ensureFile]);

  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      const next = !on;
      if (next && !segments.length && !transcribing) void runTranscription();
      return next;
    });
  }, [segments.length, transcribing, runTranscription]);

  const downloadSrt = useCallback(() => {
    const srt = buildSrt(segments);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'captions').replace(/[^\w-]+/g, '-').toLowerCase() + '.srt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, [segments, title]);

  // ---- Preview: skip applied cuts in real time (source view only) ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v || showingOutput) return;
    const onTime = () => {
      const t = v.currentTime;
      setPlayheadT(t);
      if (v.paused || v.seeking) return;
      const hit = cuts.find((c) => t >= c.start - 0.02 && t < c.end);
      if (hit) {
        if (hit.end >= (duration || v.duration || 0) - 0.06) v.pause();
        else v.currentTime = hit.end + 0.01;
      }
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [cuts, duration, showingOutput]);

  const activeCaption = useMemo(() => {
    if (!captionsOn || showingOutput) return null;
    return segments.find((s) => s.enabled && playheadT >= s.start && playheadT < s.end) ?? null;
  }, [captionsOn, showingOutput, segments, playheadT]);

  // ---- Export: server-side Remotion render (EDL + captions + grade) ----
  const runExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportErr('');
    setExportNote('Submitting the enhanced render…');
    try {
      const dims = outputDims('source', '1080p', srcDims.w, srcDims.h);
      const renderCaptions = captionsOn
        ? segments.filter((s) => s.enabled && s.words.length).map((s) => ({ start: s.start, end: s.end, words: s.words }))
        : [];
      const props: Record<string, unknown> = {
        srcUrl: videoUrl,
        accent: accentHex,
        captionPreset: 'clean',
        captionMode: 'text',
        captions: renderCaptions,
        motionCues: [],
        graphics: [],
        broll: [],
        layers: [],
        stickers: [],
        filter,
        letterbox: false,
        vignette: proj.style.vignette,
        grain: proj.style.grain,
        grainAmount: proj.style.grainAmount,
        duotone: proj.style.duotone,
        punchIn: proj.style.punchIn,
        blurRadial: 0,
        blurBackground: 0,
        speed,
        transIn: 'none',
        transOut: 'none',
        cutStyle: 'cut',
        edl: keeps,
        watermark: null,
        music: null,
        originalVolume: Math.max(0, Math.min(1, proj.audio.originalVolume / 100)),
        srcDuration: duration || undefined,
      };
      const durationInFrames = Math.max(30, Math.round((keptSecs / Math.max(0.01, speed)) * 30));
      const opId = await submitRenderV2(props, durationInFrames, dims.width, dims.height);
      setExportNote('Rendering server-side — this usually takes about a minute…');
      const startedAt = Date.now();
      while (aliveRef.current) {
        await new Promise((r) => { window.setTimeout(r, 4000); });
        const st = await checkRender(opId).catch(() => null);
        if (!aliveRef.current) return;
        if (st?.status === 'complete' && st.videoUrl) {
          setEnhancedUrl(st.videoUrl);
          setViewOriginal(false);
          setExportNote('Enhanced video ready — it is playing in the player now.');
          break;
        }
        if (st?.status === 'failed') throw new Error(st.error || 'The render failed.');
        const mins = Math.round((Date.now() - startedAt) / 60000);
        if (Date.now() - startedAt > 10 * 60 * 1000) throw new Error('The render is taking longer than 10 minutes — try again.');
        setExportNote('Rendering server-side' + (mins >= 1 ? ' (' + mins + 'm elapsed)' : '') + '…');
      }
    } catch (e) {
      if (aliveRef.current) { setExportErr(msg(e)); setExportNote(''); }
    } finally {
      if (aliveRef.current) setExporting(false);
    }
  }, [exporting, srcDims, captionsOn, segments, videoUrl, accentHex, filter, proj, speed, keeps, keptSecs, duration]);

  const busy = phase === 'fetching' || phase === 'decoding' || phase === 'detecting';
  const stepIdx = ENHANCE_STEPS.findIndex((s) => s.id === phase);
  const progressPct = busy ? ENHANCE_STEPS[Math.max(0, stepIdx)].pct : phase === 'done' ? 100 : 0;
  const playerSrc = showingOutput ? enhancedUrl : videoUrl;
  const timelineDur = duration || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%', boxSizing: 'border-box', padding: 'clamp(12px, 2.5vw, 22px)', color: S.text, fontFamily: FONT }} data-testid="enhance-studio">
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} data-testid="button-enhance-back">
          <ArrowLeft size={13} /> Back
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Enhance · {title || 'Product video'}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: S.muted }}>Auto cuts · captions · trim · colour · export — on your generated video</span>
        </div>
        {enhancedUrl ? (
          <a href={enhancedUrl} download target="_blank" rel="noreferrer" className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: S.success, color: '#04241B', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }} data-testid="button-download-enhanced">
            <Download size={13} /> Download enhanced MP4
          </a>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ---- Left: player + timeline ---- */}
        <div style={{ flex: '1 1 460px', minWidth: 'min(100%, 320px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${S.borderStrong}`, background: '#000' }}>
            <video
              key={playerSrc}
              ref={videoRef}
              src={playerSrc}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                if (showingOutput) return;
                const v = e.currentTarget;
                setDuration((d) => d || v.duration || 0);
                if (v.videoWidth && v.videoHeight) setSrcDims({ w: v.videoWidth, h: v.videoHeight });
              }}
              style={{ display: 'block', width: '100%', maxHeight: 'min(480px, 52vh)', objectFit: 'contain', background: '#000', filter: showingOutput ? 'none' : filter }}
              data-testid="enhance-player"
            />
            {/* Live caption overlay (source preview only — export burns them in) */}
            {activeCaption ? (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ maxWidth: '84%', textAlign: 'center', fontFamily: FONT, fontSize: 'clamp(13px, 2.2vw, 20px)', fontWeight: 700, lineHeight: 1.3, color: '#F8FAFC', background: 'rgba(10,15,30,0.74)', borderRadius: 12, padding: '7px 16px' }} data-testid="caption-overlay">
                  {activeCaption.words.map((w, i) => {
                    const active = playheadT >= w.s && playheadT <= w.e + 0.05;
                    return <span key={i} style={{ color: active ? accentHex : undefined, marginRight: '0.28em' }}>{w.t}</span>;
                  })}
                </span>
              </div>
            ) : null}
            {enhancedUrl ? (
              <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, pointerEvents: 'none' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, padding: '4px 9px', borderRadius: 7, background: showingOutput ? 'color-mix(in srgb, var(--space-semantic-success-500) 28%, rgba(0,0,0,0.55))' : 'rgba(0,0,0,0.55)', border: `1px solid ${showingOutput ? S.success : 'rgba(255,255,255,0.25)'}`, color: showingOutput ? S.success : '#fff' }}>
                  {showingOutput ? 'ENHANCED OUTPUT' : 'ORIGINAL + LIVE PREVIEW'}
                </span>
                <button type="button" onClick={() => setViewOriginal((v) => !v)} className="ps-btn" style={{ pointerEvents: 'auto', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer' }} data-testid="button-view-toggle">
                  {showingOutput ? 'View original' : 'View output'}
                </button>
              </div>
            ) : null}
          </div>

          {/* Cut timeline: red = cut (skipped), blue = kept */}
          {!showingOutput && timelineDur > 0 && cuts.length > 0 ? (
            <div>
              <div style={{ position: 'relative', height: 24, background: S.panelStrong, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }} data-testid="cut-timeline">
                <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--space-brand-primary-500) 26%, transparent)' }} />
                {cuts.map((c, i) => (
                  <span key={i} title={'Cut ' + formatTime(c.start) + ' → ' + formatTime(c.end)} style={{ position: 'absolute', top: 0, bottom: 0, left: (c.start / timelineDur) * 100 + '%', width: Math.max(0.6, ((c.end - c.start) / timelineDur) * 100) + '%', background: 'color-mix(in srgb, var(--space-semantic-danger-500) 70%, transparent)' }} />
                ))}
                <span style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: '#fff', opacity: 0.9, left: (timelineDur ? (playheadT / timelineDur) * 100 : 0) + '%' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: S.muted, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                <span>0:00</span>
                <span style={{ fontWeight: 700, color: S.sub }}>{formatDuration(duration)} → {formatDuration(keptSecs)}{duration > 0 && keptSecs < duration - 0.05 ? ' (−' + Math.round(((duration - keptSecs) / duration) * 100) + '%)' : ''}</span>
                <span>{formatTime(timelineDur)}</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* ---- Right: enhance controls ---- */}
        <div style={{ flex: '1 1 320px', minWidth: 'min(100%, 300px)', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ONE-CLICK ENHANCE */}
          <div style={{ borderRadius: 14, border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 45%, transparent)', background: S.panel, padding: 14 }}>
            <button
              type="button"
              onClick={() => void runEnhance()}
              disabled={busy || exporting}
              className="ps-btn"
              style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 16px', borderRadius: 12, border: 'none', background: busy ? S.panelStrong : 'var(--space-brand-primary-600)', color: busy ? S.muted : 'var(--space-text-on-primary)', cursor: busy || exporting ? 'not-allowed' : 'pointer', fontSize: 14.5, fontWeight: 800, boxShadow: busy ? 'none' : '0 10px 26px -12px color-mix(in srgb, var(--space-brand-primary-600) 85%, transparent)' }}
              data-testid="button-enhance"
            >
              {busy ? <Loader2 size={16} className="rc-spin" /> : <Wand2 size={16} />}
              {busy ? 'Enhancing…' : phase === 'done' ? 'Re-run auto cuts' : 'Enhance video'}
            </button>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
              One click: detects dead air in the audio and applies the cuts immediately — no manual cut points. The preview plays with cuts skipped.
            </p>
            {(busy || phase === 'done') && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 6, borderRadius: 999, background: S.panelStrong, overflow: 'hidden', border: `1px solid ${S.border}` }}>
                  <div style={{ height: '100%', width: progressPct + '%', borderRadius: 999, background: 'linear-gradient(90deg, var(--space-brand-primary-500), var(--space-brand-highlight-600))', transition: 'width .4s ease' }} />
                </div>
                <p role="status" style={{ margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: phase === 'done' ? S.success : S.brand }} data-testid="enhance-progress-note">
                  {busy ? <Loader2 size={12} className="rc-spin" /> : <Check size={12} />} {phaseNote}
                </p>
              </div>
            )}
            {phaseErr ? <p style={{ margin: '8px 0 0', display: 'flex', gap: 6, fontSize: 12, color: S.danger }}><X size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {phaseErr}</p> : null}
            {phase === 'done' && regions.length > 0 ? (
              <div style={{ marginTop: 10, maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="cut-list">
                {regions.map((r, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: S.card, opacity: r.included ? 1 : 0.5, cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={r.included} onChange={() => setRegions((cur) => cur.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))} />
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(r.start)} → {formatTime(r.end)}</span>
                    <span style={{ marginLeft: 'auto', color: r.included ? S.danger : S.muted, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.included ? 'cut' : 'keep'} {(r.end - r.start).toFixed(2)}s</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          {/* CAPTIONS */}
          <SectionCard
            icon={<Captions size={14} style={{ color: S.brand }} />}
            title="Add Captions"
            right={(
              <button
                type="button"
                role="switch"
                aria-checked={captionsOn}
                onClick={toggleCaptions}
                disabled={transcribing}
                className="ps-btn"
                style={{ position: 'relative', width: 40, height: 22, borderRadius: 999, border: 'none', cursor: transcribing ? 'wait' : 'pointer', background: captionsOn ? 'var(--space-brand-primary-600)' : S.panelStrong, transition: 'background .15s ease' }}
                data-testid="toggle-captions"
              >
                <span style={{ position: 'absolute', top: 3, left: captionsOn ? 21 : 3, width: 16, height: 16, borderRadius: 999, background: '#fff', transition: 'left .15s ease' }} />
              </button>
            )}
          >
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
              Transcribes the video's speech with word timestamps and overlays captions timed to it. Burned into the export, or download the SRT file.
            </p>
            {transcribing ? (
              <p role="status" style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: S.brand }} data-testid="caption-progress">
                <Loader2 size={12} className="rc-spin" /> {captionNote || 'Transcribing…'}
              </p>
            ) : null}
            {captionErr ? <p style={{ margin: '8px 0 0', display: 'flex', gap: 6, fontSize: 12, color: S.danger }}><X size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {captionErr}</p> : null}
            {captionsOn && segments.length > 0 && !transcribing ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: S.success }}>
                  <Check size={12} /> {segments.length} caption segments timed to the speech.
                </p>
                <button type="button" onClick={downloadSrt} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '7px 12px', borderRadius: 9, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-download-srt">
                  <FileText size={12} /> Download .srt
                </button>
              </div>
            ) : null}
          </SectionCard>

          {/* TRIM */}
          <SectionCard icon={<Scissors size={14} style={{ color: S.brand }} />} title="Trim">
            <Slider label="Start" value={trimStart} min={0} max={Math.max(0, Math.floor((duration || 0) * 10) / 10)} step={0.1} format={(v) => formatTime(v)} onChange={(v) => setTrimStart(Math.min(v, (trimEnd || duration || v + 1) - 0.5))} />
            <Slider label="End" value={trimEnd || duration || 0} min={0} max={Math.max(0.1, Math.ceil((duration || 0) * 10) / 10)} step={0.1} format={(v) => formatTime(v)} onChange={(v) => setTrimEnd(Math.max(v, trimStart + 0.5))} />
            {!duration ? <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted }}>Play the video once (or run Enhance) to load its duration.</p> : null}
          </SectionCard>

          {/* COLOUR */}
          <SectionCard icon={<Palette size={14} style={{ color: S.brand }} />} title="Colour & look">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {LOOK_PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.hint} onClick={() => { setLookId(p.id); setProj((cur) => p.apply(cur)); }} className="ps-btn" style={{ padding: '6px 11px', borderRadius: 999, border: `1px solid ${lookId === p.id ? 'var(--space-brand-primary-600)' : S.border}`, background: lookId === p.id ? 'color-mix(in srgb, var(--space-brand-primary-600) 16%, transparent)' : S.card, color: lookId === p.id ? S.brand : S.sub, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }} data-testid={`look-${p.id}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <Slider label="Brightness" value={proj.grade.brightness} min={40} max={180} format={(v) => v + '%'} onChange={(v) => setProj((c) => ({ ...c, grade: { ...c.grade, brightness: v } }))} />
            <Slider label="Contrast" value={proj.grade.contrast} min={40} max={180} format={(v) => v + '%'} onChange={(v) => setProj((c) => ({ ...c, grade: { ...c.grade, contrast: v } }))} />
            <Slider label="Saturation" value={proj.grade.saturation} min={0} max={200} format={(v) => v + '%'} onChange={(v) => setProj((c) => ({ ...c, grade: { ...c.grade, saturation: v } }))} />
            <Slider label="Warmth" value={proj.grade.temperature} min={-100} max={100} format={(v) => String(v)} onChange={(v) => setProj((c) => ({ ...c, grade: { ...c.grade, temperature: v } }))} />
            <button type="button" onClick={() => { setLookId('original'); setProj((c) => ({ ...defaultProject(), motion: c.motion, audio: c.audio })); }} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, padding: '6px 11px', borderRadius: 9, border: `1px solid ${S.border}`, background: 'transparent', color: S.muted, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }} data-testid="button-reset-look">
              <RotateCcw size={11} /> Reset colour
            </button>
          </SectionCard>

          {/* AUDIO + SPEED */}
          <SectionCard icon={<Volume2 size={14} style={{ color: S.brand }} />} title="Audio & speed">
            <Slider label="Volume" value={proj.audio.originalVolume} min={0} max={100} format={(v) => v + '%'} onChange={(v) => setProj((c) => ({ ...c, audio: { ...c.audio, originalVolume: v } }))} />
            <div style={{ ...sliderRow }}>
              <span style={sliderLabel}>Speed</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0.75, 1, 1.25, 1.5].map((sp) => (
                  <button key={sp} type="button" onClick={() => { setProj((c) => ({ ...c, motion: { ...c.motion, speed: sp } })); const v = videoRef.current; if (v) v.playbackRate = sp; }} className="ps-btn" style={{ padding: '5px 11px', borderRadius: 999, border: `1px solid ${speed === sp ? 'var(--space-brand-primary-600)' : S.border}`, background: speed === sp ? 'color-mix(in srgb, var(--space-brand-primary-600) 16%, transparent)' : S.card, color: speed === sp ? S.brand : S.sub, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }} data-testid={`speed-${sp}`}>
                    {sp}×
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* EXPORT */}
          <div style={{ borderRadius: 14, border: '1px solid color-mix(in srgb, var(--space-semantic-success-500) 40%, transparent)', background: S.panel, padding: 14 }}>
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={exporting || busy}
              className="ps-btn"
              style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 11, border: 'none', background: exporting ? S.panelStrong : S.success, color: exporting ? S.muted : '#04241B', cursor: exporting || busy ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 800 }}
              data-testid="button-export-enhanced"
            >
              {exporting ? <Loader2 size={15} className="rc-spin" /> : <Download size={15} />}
              {exporting ? 'Rendering…' : 'Download MP4'}
            </button>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
              Renders server-side with the cuts, trim, colour grade{captionsOn ? ', burned-in captions' : ''} and audio settings applied — then download the MP4.
            </p>
            {exporting || (exportNote && enhancedUrl) ? (
              <p role="status" style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: enhancedUrl && !exporting ? S.success : S.brand }} data-testid="export-note">
                {exporting ? <Loader2 size={12} className="rc-spin" /> : <Check size={12} />} {exportNote}
              </p>
            ) : null}
            {exportErr ? <p style={{ margin: '8px 0 0', display: 'flex', gap: 6, fontSize: 12, color: S.danger }}><X size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {exportErr}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
