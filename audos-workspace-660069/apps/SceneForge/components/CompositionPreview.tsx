// COMPOSITION PREVIEW — the browser preview of the FINAL film, driven by the
// SAME buildTimeline segments and the SAME props the production Remotion
// render receives (remotion/AssemblyComp.createAssemblySource). The avatar
// master's own clock drives every layer, so what plays here is the current
// draft: DirectorPlan, scene state, generated images and clips, presenter
// states, editable overlays, captions and the music bed with its ducking.
//
// THIS IS ONLY A PREVIEW. The final MP4 is produced exclusively by the
// platform Remotion service from the identical timeline JSON — the browser
// never records itself (no MediaRecorder final renderer).

import { Pause, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listAssets, type Asset, type Project, type Scene } from '../lib/supabase';
import { buildTimeline, timelineDurationInFrames, type TimelineSegment } from '../remotion/AssemblyComp';
import { FPS, captionAt, captionChunks, compositionCardStyle, effectStyleAt, kenBurnsStyleAt, musicVolumeAt, overlayStateAt, pipCardStyle, speechWindows, transitionStyleAt } from '../remotion/compositionRuntime';
import { planOf, type SceneOverlayElement } from '../lib/directorPlan';
import { KIND_COLORS, KIND_LABELS } from '../lib/effects';

function fmt(t: number): string {
  const total = Math.max(0, Math.floor(t));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** One editable overlay element, mirrored from the render composition. */
function OverlayElementView({ overlay, sceneFrame, sceneFrames }: { overlay: SceneOverlayElement; sceneFrame: number; sceneFrames: number }) {
  const st = overlayStateAt(overlay, sceneFrame, sceneFrames);
  if (!st.visible) return null;
  const accent = overlay.accent || '#3B82F6';
  const scale = overlay.scale > 0 ? overlay.scale : 1;
  const x = overlay.x_pct; const y = overlay.y_pct;
  const z = 40 + (overlay.z_index || 10);
  if (overlay.type === 'arrow' || overlay.type === 'circle') {
    const tx = Number.isFinite(Number(overlay.target_x_pct)) ? Number(overlay.target_x_pct) : x;
    const ty = Number.isFinite(Number(overlay.target_y_pct)) ? Number(overlay.target_y_pct) : Math.max(6, y - 26);
    const x1 = x * 19.2; const y1 = y * 10.8; const x2 = tx * 19.2; const y2 = ty * 10.8;
    const dx = x2 - x1; const dy = y2 - y1; const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const hx = x2 - (dx / len) * 34; const hy = y2 - (dy / len) * 34;
    const px = -(dy / len) * 20; const py = (dx / len) * 20;
    return <div style={{ position: 'absolute', inset: 0, zIndex: z, opacity: st.opacity, pointerEvents: 'none' }}>
      <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {overlay.type === 'circle'
          ? <ellipse cx={x * 19.2} cy={y * 10.8} rx={130 * scale} ry={90 * scale} fill="none" stroke={accent} strokeWidth={7} strokeDasharray={700} strokeDashoffset={700 * (1 - st.draw)} transform={`rotate(-8 ${x * 19.2} ${y * 10.8})`} />
          : <g>
            <line x1={x1} y1={y1} x2={x1 + dx * st.draw} y2={y1 + dy * st.draw} stroke={accent} strokeWidth={8} strokeLinecap="round" />
            {st.draw > 0.96 ? <polygon points={`${x2},${y2} ${hx + px},${hy + py} ${hx - px},${hy - py}`} fill={accent} /> : null}
          </g>}
      </svg>
      {overlay.text ? <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, 20%)', fontFamily: "'Inter', system-ui, sans-serif", fontSize: `${1.35 * scale}em`, fontWeight: 700, color: '#fff', background: 'rgba(8,12,24,0.78)', borderRadius: 8, padding: '0.3em 0.7em', border: '1.5px solid rgba(255,255,255,0.16)' }}>{overlay.text}</div> : null}
    </div>;
  }
  if (overlay.type === 'highlight') {
    return <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${26 * scale}%`, height: `${11 * scale}%`, transform: `translate(-50%,-50%) ${st.transform}`, zIndex: z, opacity: st.opacity * 0.42, background: accent, borderRadius: 10, pointerEvents: 'none' }} />;
  }
  const isLower = overlay.type === 'lower_third';
  const isStat = overlay.type === 'stat';
  const isCite = overlay.type === 'citation';
  const isLabel = overlay.type === 'label';
  const boxed = isLower || isLabel || isCite;
  return <div style={{
    position: 'absolute', left: `${isLower ? 4 : x}%`, top: isLower ? undefined : `${y}%`, bottom: isLower ? '7%' : undefined,
    transform: `${isLower ? '' : 'translate(-50%,-50%)'} ${st.transform}`, zIndex: z, opacity: st.opacity, maxWidth: '62%', pointerEvents: 'none',
    fontFamily: "'Inter', system-ui, sans-serif", textAlign: isLower ? 'left' : 'center',
    ...(boxed ? { background: 'rgba(8,12,24,0.80)', border: '1.5px solid rgba(255,255,255,0.16)', borderRadius: 10, padding: isLower ? '0.6em 1.1em' : '0.45em 0.85em', boxShadow: '0 10px 40px rgba(0,0,0,0.45)' } : {}),
    ...(isLower ? { borderLeft: `4px solid ${accent}` } : {}),
  }}>
    {isStat && overlay.text ? <div style={{ fontSize: `${4.6 * scale}em`, fontWeight: 900, lineHeight: 1, color: accent, textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>{overlay.text}</div>
      : overlay.text ? <div style={{ fontSize: `${(isCite ? 1.15 : isLabel ? 1.45 : isLower ? 1.9 : 2.5) * scale}em`, fontWeight: isCite ? 500 : 800, lineHeight: 1.2, color: '#fff', fontStyle: isCite ? 'italic' : 'normal', textShadow: '0 4px 22px rgba(0,0,0,0.75)' }}>{overlay.text}</div> : null}
    {overlay.subtext ? <div style={{ marginTop: '0.35em', fontSize: `${1.15 * scale}em`, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{overlay.subtext}</div> : null}
    {overlay.source ? <div style={{ marginTop: '0.35em', fontSize: `${0.95 * scale}em`, fontWeight: 500, color: 'rgba(255,255,255,0.72)' }}>{'\u2014 '}{overlay.source}</div> : null}
  </div>;
}

/** One active scene segment layered over the base master. */
function SegmentView({ segment, tSec, avatarVideoUrl }: { segment: TimelineSegment; tSec: number; avatarVideoUrl?: string }) {
  const frames = Math.max(1, segment.frames);
  const frame = Math.max(0, Math.min(frames - 1, Math.round((tSec - segment.startSec) * FPS)));
  const ts = transitionStyleAt(segment, frame, frames);
  const fx = effectStyleAt(segment.overlay?.effect || null, frame, frames);
  const kb = segment.motion ? kenBurnsStyleAt(segment.motion as any, frame, frames) : null;
  const isVideo = segment.sceneRenderKind === 'video' && segment.sceneRenderUrl;
  const imageUrl = !isVideo ? segment.sceneRenderUrl : undefined;
  const overlayConf = segment.overlay || {};
  const comp = segment.composition && (segment.composition.mode === 'overlay' || segment.composition.mode === 'central') ? segment.composition : null;
  const overAvatar = (overlayConf as any).overAvatar === true && !isVideo;
  const pipVideo = useRef<HTMLVideoElement | null>(null);
  const sceneVideo = useRef<HTMLVideoElement | null>(null);
  // Loose sync for the PIP presenter copy: snap when it drifts past 0.4s.
  useEffect(() => {
    const node = pipVideo.current;
    if (!node) return;
    if (Math.abs(node.currentTime - tSec) > 0.4) node.currentTime = tSec;
    void node.play().catch(() => undefined);
  }, [Math.round(tSec * 2), Boolean(pipVideo.current)]);
  useEffect(() => { const node = sceneVideo.current; if (node) void node.play().catch(() => undefined); }, [Boolean(sceneVideo.current)]);

  const media = isVideo
    ? <video ref={sceneVideo} src={segment.sceneRenderUrl} muted loop playsInline autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : imageUrl ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null;
  const overlays = (segment.overlayElements || []) as SceneOverlayElement[];
  const overlayNodes = overlays.map((overlay) => <OverlayElementView key={overlay.id} overlay={overlay} sceneFrame={frame} sceneFrames={frames} />);
  const calloutText = (overlayConf as any).text || (overlayConf as any).subtext
    ? <div style={{ position: 'absolute', left: '50%', bottom: '9%', transform: 'translateX(-50%)', maxWidth: '70%', background: 'rgba(8,12,24,0.78)', border: '1.5px solid rgba(255,255,255,0.16)', borderRadius: 12, padding: '0.5em 1em', textAlign: 'center', fontFamily: "'Inter', system-ui, sans-serif", zIndex: 24 }}>
      {(overlayConf as any).text ? <div style={{ fontSize: '1.6em', fontWeight: 800, color: '#fff' }}>{(overlayConf as any).text}</div> : null}
      {(overlayConf as any).subtext ? <div style={{ marginTop: '0.25em', fontSize: '0.95em', color: 'rgba(255,255,255,0.9)' }}>{(overlayConf as any).subtext}</div> : null}
    </div>
    : null;

  if (overAvatar) {
    return <div style={{ position: 'absolute', inset: 0, opacity: ts.opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined }}>
      {overlayNodes}
      {calloutText}
    </div>;
  }
  if (comp && media) {
    const card = compositionCardStyle(comp) as Record<string, any>;
    return <div style={{ position: 'absolute', inset: 0, opacity: ts.opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined }}>
      <div style={{ ...card }}>
        <div style={{ position: 'absolute', inset: 0, transform: (kb && !isVideo ? kb.transform : fx.transform) || undefined, opacity: fx.opacity, filter: fx.filter || undefined }}>{media}</div>
      </div>
      {overlayNodes}
      {calloutText}
    </div>;
  }
  return <div style={{ position: 'absolute', inset: 0, opacity: ts.opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined, background: media ? '#0A0F1E' : 'transparent', overflow: 'hidden' }}>
    {media ? <div style={{ position: 'absolute', inset: 0, transform: (kb && !isVideo ? kb.transform : fx.transform) || undefined, opacity: fx.opacity, filter: fx.filter || undefined }}>{media}</div> : null}
    {segment.presenter?.video === 'pip' && avatarVideoUrl ? <div style={pipCardStyle(segment.presenter.pip) as any}>
      <video ref={pipVideo} src={avatarVideoUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div> : null}
    {overlayNodes}
    {calloutText}
  </div>;
}

/**
 * The full preview player: 16:9 stage, play/pause, seek, timeline strip with
 * per-scene markers (click to jump), captions and the ducked music bed.
 */
export default function CompositionPreview({ project, scenes }: { project: Project; scenes: Scene[] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tSec, setTSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const baseVideo = useRef<HTMLVideoElement | null>(null);
  const musicAudio = useRef<HTMLAudioElement | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listAssets(project.id).then((rows) => { if (!cancelled) setAssets(rows); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [project.id, reloadKey]);

  const timeline = useMemo(() => buildTimeline(project, scenes, assets), [project, scenes, assets, reloadKey]);
  const durationSec = useMemo(() => timelineDurationInFrames(timeline, Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 0) / FPS, [timeline, project]);
  const plan = planOf(project);
  const chunks = useMemo(() => (plan?.captions ? captionChunks(project.word_timestamps) : []), [project.word_timestamps, plan?.captions]);
  const windows = useMemo(() => speechWindows(project.word_timestamps), [project.word_timestamps]);
  const sceneSegments = useMemo(() => timeline.filter((segment) => segment.type === 'scene'), [timeline]);

  // The base master's clock drives everything — one rAF loop repaints layers
  // and rides the music volume between bed and duck exactly like the mix.
  useEffect(() => {
    const tick = () => {
      const node = baseVideo.current;
      if (node) {
        setTSec(node.currentTime);
        const music = musicAudio.current;
        if (music && !music.paused) {
          music.volume = musicVolumeAt(windows, node.currentTime, 0.12, Number(plan?.music?.volume) || 0.3);
          if (Math.abs(music.currentTime - (node.currentTime % Math.max(1, music.duration || 1))) > 1.2 && Number.isFinite(music.duration)) {
            music.currentTime = node.currentTime % Math.max(0.1, music.duration);
          }
        }
      }
      raf.current = window.requestAnimationFrame(tick);
    };
    raf.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf.current);
  }, [windows, plan?.music?.volume]);

  const toggle = () => {
    const node = baseVideo.current;
    if (!node) return;
    if (node.paused) { void node.play().catch(() => undefined); musicAudio.current && void musicAudio.current.play().catch(() => undefined); setPlaying(true); }
    else { node.pause(); musicAudio.current?.pause(); setPlaying(false); }
  };
  const seek = (value: number) => {
    const node = baseVideo.current;
    if (!node) return;
    node.currentTime = Math.max(0, Math.min(durationSec - 0.05, value));
    setTSec(node.currentTime);
  };

  const active = sceneSegments.filter((segment) => tSec >= segment.startSec && tSec < segment.startSec + segment.frames / FPS);
  const caption = chunks.length ? captionAt(chunks, tSec) : null;

  if (!project.heygen_video_url) {
    return <div className="rounded-2xl border border-dashed border-[var(--space-border-default)] p-6 text-sm text-[var(--space-text-muted)]">The preview needs the avatar master — render the HeyGen presenter first.</div>;
  }

  return <div>
    <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16 / 9', containerType: 'inline-size', fontSize: 'clamp(6px, 1.6cqw, 22px)' }}>
      {/* No crossOrigin here on purpose: the preview never reads pixels, and
          an anonymous CORS request would refuse to play a non-CORS master. */}
      <video ref={baseVideo} key={project.heygen_video_url} src={project.heygen_video_url} playsInline onEnded={() => { setPlaying(false); musicAudio.current?.pause(); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {active.map((segment) => <SegmentView key={segment.sceneId || segment.startFrame} segment={segment} tSec={tSec} avatarVideoUrl={project.heygen_video_url} />)}
      {caption ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: '3.6%', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 90 }}>
        <div style={{ maxWidth: '74%', background: 'rgba(6,10,20,0.72)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '0.4em 1em', fontFamily: "'Inter', system-ui, sans-serif", fontSize: '1.6em', fontWeight: 700, color: '#fff', textAlign: 'center' }}>{caption.text}</div>
      </div> : null}
    </div>
    {project.music_url ? <audio ref={musicAudio} src={project.music_url} loop preload="auto" /> : null}
    <div className="mt-3 flex items-center gap-3">
      <button aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={toggle} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--space-brand-primary-600)] text-white">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
      <span className="font-mono text-xs text-[var(--space-text-secondary)]">{fmt(tSec)} / {fmt(durationSec)}</span>
      <input type="range" min={0} max={Math.max(1, durationSec)} step={0.05} value={Math.min(tSec, durationSec)} onChange={(event) => seek(Number(event.target.value))} className="h-1.5 flex-1 accent-[var(--space-brand-primary-500)]" aria-label="Seek the preview" />
      <button aria-label="Reload preview data" onClick={() => setReloadKey((k) => k + 1)} className="rounded-lg border border-[var(--space-border-default)] p-2 text-[var(--space-text-muted)] hover:text-[var(--space-text-primary)]"><RefreshCw className="h-3.5 w-3.5" /></button>
    </div>
    {/* Scene navigation strip — click a chip to jump to that scene. */}
    <div className="mt-3">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--space-surface-muted)]">
        {sceneSegments.map((segment) => {
          const left = durationSec ? (segment.startSec / durationSec) * 100 : 0;
          const width = durationSec ? ((segment.frames / FPS) / durationSec) * 100 : 0;
          return <button key={`bar-${segment.sceneId || segment.startFrame}`} title={KIND_LABELS[segment.visualKind || 'text_graphics']} onClick={() => seek(segment.startSec + 0.02)} className="absolute top-0 h-full" style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, background: KIND_COLORS[segment.visualKind || 'text_graphics'] }} />;
        })}
        <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white" style={{ left: `${durationSec ? Math.min(100, (tSec / durationSec) * 100) : 0}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sceneSegments.map((segment, index) => <button key={`chip-${segment.sceneId || index}`} onClick={() => seek(segment.startSec + 0.02)} className="rounded-full border border-[var(--space-border-default)] px-2.5 py-1 text-[11px] font-medium text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)] hover:text-[var(--space-text-primary)]" style={{ borderLeftWidth: 3, borderLeftColor: KIND_COLORS[segment.visualKind || 'text_graphics'] }}>{index + 1} · {fmt(segment.startSec)}</button>)}
      </div>
    </div>
    <p className="mt-2 text-xs text-[var(--space-text-muted)]">Draft preview — the production render uses this exact timeline and these exact assets through the platform renderer; the browser never records the final file.</p>
  </div>;
}
