import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Check, Download, Grip, Image as ImageIcon, Music, Play, Type, X } from 'lucide-react';
import { db, Film, T, uploadBlob } from './api';
import { WORKSPACE_ID } from '../../lib/workspace';
import VergeLoader from '../../components/VergeLoader';

interface LayerState {
  text: string;
  color: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  opacity: number;
  startSec: number;
  endSec: number;
  animation: 'none' | 'fade' | 'rise' | 'scale';
  zIndex: number;
  textAboveAsset: boolean;
  assetUrl: string;
  assetType: 'image' | 'video' | '';
  audioUrl: string;
  audioVolume: number;
}

const DEFAULT_LAYER: LayerState = {
  text: 'Add your CTA', color: '#FFFFFF', fontSize: 58, x: 50, y: 78, width: 42,
  opacity: 1, startSec: 0, endSec: 5, animation: 'fade', zIndex: 2, textAboveAsset: true,
  assetUrl: '', assetType: '', audioUrl: '', audioVolume: .35,
};

const inputStyle = { width: '100%', minHeight: 44, background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9, padding: '9px 10px', fontSize: 12 } as const;

function compositionSource(): string {
  return `import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
export default function Composition({ sourceUrl, overlayUrl, overlayType, audioUrl, audioVolume, text, color, fontSize, x, y, width, opacity, startFrame, endFrame, animation, zIndex, textAboveAsset, trimStart }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const local = frame - startFrame;
  const enter = animation === 'none' ? 1 : interpolate(local, [0, Math.max(1, fps * .35)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = animation === 'none' ? 1 : interpolate(endFrame - frame, [0, Math.max(1, fps * .3)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const alpha = Math.min(enter, exit) * opacity;
  const transform = animation === 'rise' ? 'translate(-50%, calc(-50% + ' + (1-enter) * 38 + 'px))' : animation === 'scale' ? 'translate(-50%, -50%) scale(' + (.84 + enter * .16) + ')' : 'translate(-50%, -50%)';
  const layer = { position: 'absolute', left: x + '%', top: y + '%', width: width + '%', opacity: alpha, transform, zIndex };
  return <AbsoluteFill style={{ background: '#000' }}>
    <Video src={sourceUrl} startFrom={Math.max(0, Math.round(trimStart * fps))} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    {audioUrl ? <Audio src={audioUrl} volume={audioVolume} /> : null}
    <Sequence from={startFrame} durationInFrames={Math.max(1, endFrame-startFrame)}>
      {overlayUrl ? overlayType === 'video' ? <Video src={overlayUrl} muted style={{ ...layer, height: 'auto', objectFit: 'contain' }} /> : <Img src={overlayUrl} style={{ ...layer, height: 'auto', objectFit: 'contain' }} /> : null}
      {text ? <div style={{ ...layer, zIndex: textAboveAsset ? zIndex + 1 : zIndex - 1, width: 'auto', maxWidth: width + '%', color, fontSize, fontFamily: 'Manrope, Arial, sans-serif', fontWeight: 800, lineHeight: 1.05, textAlign: 'center', whiteSpace: 'pre-wrap', textShadow: '0 3px 18px rgba(0,0,0,.72)' }}>{text}</div> : null}
    </Sequence>
  </AbsoluteFill>;
}
export const calculateDemoVideoDuration = () => 90;`;
}

export default function QuickEditor(props: { film: Film; onClose: () => void; onSaved: (film: Film) => void }) {
  const { film } = props;
  const sourceUrl = String(film.final_video_url || '');
  const sourceDuration = Math.max(1, Number(film.duration_s) || 1);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(sourceDuration);
  const [layer, setLayer] = useState<LayerState>({ ...DEFAULT_LAYER, endSec: Math.min(5, sourceDuration) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [operationId, setOperationId] = useState('');
  const assetInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(.1, trimEnd - trimStart);
  const canRender = duration <= 600;
  const aspect = film.aspect_ratio === '9:16' ? '9 / 16' : film.aspect_ratio === '1:1' ? '1 / 1' : '16 / 9';
  const previewWidth = film.aspect_ratio === '9:16' ? 310 : 720;

  const propsPayload = useMemo(() => ({
    sourceUrl, overlayUrl: layer.assetUrl, overlayType: layer.assetType,
    audioUrl: layer.audioUrl, audioVolume: layer.audioVolume, text: layer.text,
    color: layer.color, fontSize: layer.fontSize, x: layer.x, y: layer.y,
    width: layer.width, opacity: layer.opacity,
    startFrame: Math.max(0, Math.round((layer.startSec - trimStart) * 30)),
    endFrame: Math.max(1, Math.round((layer.endSec - trimStart) * 30)),
    animation: layer.animation, zIndex: layer.zIndex, textAboveAsset: layer.textAboveAsset, trimStart,
  }), [sourceUrl, layer, trimStart]);

  async function upload(file: File, kind: 'asset' | 'audio') {
    setBusy(true); setError('');
    try {
      const url = await uploadBlob(file, file.name);
      if (kind === 'audio') setLayer((value) => ({ ...value, audioUrl: url }));
      else setLayer((value) => ({ ...value, assetUrl: url, assetType: file.type.startsWith('video/') ? 'video' : 'image' }));
    } catch (caught: any) { setError(String(caught?.message || caught)); }
    finally { setBusy(false); }
  }

  function beginDrag(event: ReactPointerEvent) {
    const node = previewRef.current;
    if (!node) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      setLayer((value) => ({ ...value, x: Math.max(0, Math.min(100, ((next.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((next.clientY - rect.top) / rect.height) * 100)) }));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  }

  async function persistExport(status: 'pending' | 'rendering' | 'complete' | 'failed', patch: Record<string, unknown> = {}) {
    if (!film.plan) return;
    const version = Number(film.plan.editor_composition_version || 0) + (status === 'pending' ? 1 : 0);
    const id = operationId || String(patch.operation_id || `quick_${Date.now().toString(36)}`);
    const previous = (film.plan.export_records || []).filter((record) => record.id !== id);
    const record = { id, status, operation_id: id, created_at: new Date().toISOString(), ...(status === 'complete' ? { completed_at: new Date().toISOString() } : {}), settings: { ...propsPayload, trimEnd }, ...patch } as any;
    const plan = { ...film.plan, editor_composition_version: version, editor_composition: { version, ...propsPayload, trimEnd, sourceUrl }, export_records: [...previous, record] };
    await db.updateFilm(film.id, { plan });
    Object.assign(film, { plan }); props.onSaved({ ...film });
  }

  async function render() {
    if (!sourceUrl || !canRender || busy) return;
    setBusy(true); setError(''); setResultUrl('');
    try {
      const response = await fetch('/api/render/remotion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, compositionTsx: compositionSource(), props: propsPayload, durationInFrames: Math.max(1, Math.min(18000, Math.round(duration * 30))), fps: 30, width: 1920, height: 1080 }),
      });
      const started = await response.json().catch(() => null);
      if (!response.ok || !started?.operationId) throw new Error(String(started?.error || `Quick Edit export failed to start (HTTP ${response.status}).`));
      setOperationId(String(started.operationId));
      await persistExport('pending', { operation_id: String(started.operationId) });
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const statusResponse = await fetch(`/api/render/remotion/${encodeURIComponent(started.operationId)}`);
        const status = await statusResponse.json().catch(() => null);
        if (status?.status === 'complete' && /^https:\/\//.test(String(status.videoUrl || ''))) {
          setResultUrl(String(status.videoUrl)); await persistExport('complete', { operation_id: String(started.operationId), url: String(status.videoUrl) }); return;
        }
        if (status?.status === 'failed') throw new Error(String(status.error || 'Quick Edit export failed.'));
      }
      throw new Error('Quick Edit export is still running. Its operation is saved; reopen this project to reconcile it.');
    } catch (caught: any) {
      setError(String(caught?.message || caught));
      await persistExport('failed', { operation_id: operationId, error: String(caught?.message || caught) }).catch(() => null);
    } finally { setBusy(false); }
  }

  return <div role="dialog" aria-modal="true" aria-label="Quick Edit" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(5,6,8,.88)', display: 'grid', placeItems: 'center', padding: 16 }}>
    <style>{`@media (max-width: 760px) { .s2v-quick-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    <div style={{ width: 'min(1180px, 100%)', maxHeight: '94vh', overflow: 'auto', background: T.card, border: `1px solid ${T.dim}`, borderRadius: 16, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ color: T.bone, fontSize: 17, fontWeight: 800 }}>Quick Edit <span style={{ color: T.done, fontSize: 11 }}>FREE · DETERMINISTIC</span></div><div style={{ color: T.muted, fontSize: 11 }}>No Seedance, Kling or Omni call</div><button onClick={props.onClose} aria-label="Close Quick Edit" style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, background: 'transparent', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9 }}><X size={16} /></button></div>
      <div className="s2v-quick-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(280px, .75fr)', gap: 14, marginTop: 12 }}>
        <div>
          <div ref={previewRef} style={{ position: 'relative', margin: '0 auto', width: '100%', maxWidth: previewWidth, aspectRatio: aspect, background: '#000', overflow: 'hidden', borderRadius: 12 }}>
            <video src={sourceUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            {layer.assetUrl ? layer.assetType === 'video' ? <video src={layer.assetUrl} muted autoPlay loop onPointerDown={beginDrag} style={{ position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, opacity: layer.opacity, transform: 'translate(-50%,-50%)', zIndex: layer.zIndex, cursor: 'grab' }} /> : <img src={layer.assetUrl} alt="Overlay" onPointerDown={beginDrag} style={{ position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, opacity: layer.opacity, transform: 'translate(-50%,-50%)', zIndex: layer.zIndex, cursor: 'grab' }} /> : null}
            {layer.text ? <div onPointerDown={beginDrag} style={{ position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`, maxWidth: `${layer.width}%`, opacity: layer.opacity, transform: 'translate(-50%,-50%)', color: layer.color, fontSize: `${Math.max(12, layer.fontSize / 3)}px`, fontWeight: 800, textAlign: 'center', lineHeight: 1.05, textShadow: '0 2px 10px #000', zIndex: layer.textAboveAsset ? layer.zIndex + 1 : layer.zIndex - 1, cursor: 'grab', userSelect: 'none' }}><Grip size={12} />{layer.text}</div> : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, marginTop: 10 }}><label style={{ color: T.muted, fontSize: 10.5 }}>Trim start<input type="number" min={0} max={trimEnd - .1} step={.1} value={trimStart} onChange={(e) => setTrimStart(Math.max(0, Math.min(trimEnd - .1, Number(e.target.value) || 0)))} style={inputStyle} /></label><label style={{ color: T.muted, fontSize: 10.5 }}>Trim end<input type="number" min={trimStart + .1} max={sourceDuration} step={.1} value={trimEnd} onChange={(e) => setTrimEnd(Math.max(trimStart + .1, Math.min(sourceDuration, Number(e.target.value) || sourceDuration)))} style={inputStyle} /></label></div>
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          <label style={{ color: T.muted, fontSize: 10.5 }}><Type size={12} /> Text / CTA / end card<textarea value={layer.text} onChange={(e) => setLayer({ ...layer, text: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label style={{ color: T.muted, fontSize: 10.5 }}>Colour<input type="color" value={layer.color} onChange={(e) => setLayer({ ...layer, color: e.target.value })} style={inputStyle} /></label><label style={{ color: T.muted, fontSize: 10.5 }}>Font size<input type="number" min={18} max={140} value={layer.fontSize} onChange={(e) => setLayer({ ...layer, fontSize: Number(e.target.value) || 58 })} style={inputStyle} /></label></div>
          <label style={{ color: T.muted, fontSize: 10.5 }}>Layer width / resize <input type="range" min={8} max={95} value={layer.width} onChange={(e) => setLayer({ ...layer, width: Number(e.target.value) })} style={{ width: '100%' }} /></label>
          <label style={{ color: T.muted, fontSize: 10.5 }}>Opacity <input type="range" min={.05} max={1} step={.05} value={layer.opacity} onChange={(e) => setLayer({ ...layer, opacity: Number(e.target.value) })} style={{ width: '100%' }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label style={{ color: T.muted, fontSize: 10.5 }}>Start<input type="number" min={trimStart} max={layer.endSec} step={.1} value={layer.startSec} onChange={(e) => setLayer({ ...layer, startSec: Number(e.target.value) || 0 })} style={inputStyle} /></label><label style={{ color: T.muted, fontSize: 10.5 }}>End<input type="number" min={layer.startSec} max={trimEnd} step={.1} value={layer.endSec} onChange={(e) => setLayer({ ...layer, endSec: Number(e.target.value) || trimEnd })} style={inputStyle} /></label></div>
          <label style={{ color: T.muted, fontSize: 10.5 }}>Animation<select value={layer.animation} onChange={(e) => setLayer({ ...layer, animation: e.target.value as LayerState['animation'] })} style={inputStyle}><option value="none">None</option><option value="fade">Fade</option><option value="rise">Rise</option><option value="scale">Scale</option></select></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, color: T.muted, fontSize: 11.5 }}><input type="checkbox" checked={layer.textAboveAsset} onChange={(e) => setLayer({ ...layer, textAboveAsset: e.target.checked })} /> Text layer above uploaded asset</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button onClick={() => assetInput.current?.click()} style={{ minHeight: 44, background: T.raised, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9, padding: '8px 11px' }}><ImageIcon size={13} /> Logo / image / video</button><button onClick={() => audioInput.current?.click()} style={{ minHeight: 44, background: T.raised, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9, padding: '8px 11px' }}><Music size={13} /> Optional audio</button></div>
          <input ref={assetInput} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, 'asset'); e.target.value = ''; }} /><input ref={audioInput} type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, 'audio'); e.target.value = ''; }} />
          {layer.audioUrl ? <label style={{ color: T.muted, fontSize: 10.5 }}>Added-audio volume <input type="range" min={0} max={1} step={.05} value={layer.audioVolume} onChange={(e) => setLayer({ ...layer, audioVolume: Number(e.target.value) })} style={{ width: '100%' }} /></label> : null}
          {!canRender ? <div style={{ color: T.fault, fontSize: 11, lineHeight: 1.45 }}>The connected Remotion renderer accepts at most 10 minutes per export. Trim this Quick Edit version to 10:00 or less; the original 30-minute master remains unchanged.</div> : null}
          {error ? <div style={{ color: T.fault, fontSize: 11 }}>{error}</div> : null}
          <button disabled={!canRender || busy} onClick={() => void render()} style={{ minHeight: 46, background: canRender && !busy ? T.live : T.raised, color: canRender && !busy ? '#17120A' : T.dim, border: 'none', borderRadius: 10, fontWeight: 800 }}>{busy ? <VergeLoader size={30} label="Rendering Quick Edit" /> : <><Play size={14} /> Export new version</>}</button>
          {resultUrl ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: T.done, fontSize: 11.5 }}><Check size={13} /> Export verified by the renderer <a href={resultUrl} download target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: T.bone }}><Download size={13} /> MP4</a></div> : null}
        </div>
      </div>
      <div style={{ color: T.dim, fontSize: 10, lineHeight: 1.45, marginTop: 10 }}>Native video audio stays on by default. Quick Edit is deterministic and non-destructive; AI Edit is the separate billable Gemini Omni operation on scene cards. Remotion commercial licensing for this SaaS workflow remains an owner review item.</div>
    </div>
  </div>;
}
