/**
 * Video Enhancer — Enhance tab: audio clean-up, music layer, watermark/logo,
 * aspect-ratio crop, thumbnail extractor, emoji stickers, before/after
 * comparison and the AI B-roll system. (Captions live in the Text tab.)
 */
import { useRef, useState } from 'react';
import {
  Volume2, Music, ImagePlus, Crop, Camera, Smile, Columns2,
  Clapperboard, Plus, Trash2, Check, RefreshCw, Wand2, Loader2, X,
} from 'lucide-react';
import type { ProjectState, EditorApi, CornerId } from './enhancerExtras';
import { CROP_OPTIONS, EMOJI_SET, newSticker } from './enhancerExtras';
import { Section, Slider, Toggle, Chip, NumField } from './uiControls';
import { BrollSlot, formatTime } from './enhancerCore';

export default function EnhancePanel({ p, api, duration, hasFile, onPickMusic, onPickWatermark, onThumbnail, compareOn, setCompareOn, getPlayhead, brollCtl }: {
  p: ProjectState; api: EditorApi; duration: number;
  /** True once a video is loaded (enables the thumbnail extractor). */
  hasFile: boolean;
  onPickMusic: (f: File) => void;
  onPickWatermark: (f: File) => void;
  onThumbnail: () => void;
  compareOn: boolean; setCompareOn: (v: boolean) => void;
  getPlayhead: () => number;
  brollCtl: {
    broll: BrollSlot[];
    updateSlot: (id: string, patch: Partial<BrollSlot>) => void;
    generateSlot: (id: string) => void;
    addSlot: () => void;
    removeSlot: (id: string) => void;
    ready: boolean;
  };
}) {
  const musicInput = useRef<HTMLInputElement | null>(null);
  const wmInput = useRef<HTMLInputElement | null>(null);
  const [customEmoji, setCustomEmoji] = useState('');

  const addSticker = (emoji: string) => {
    if (!emoji.trim()) return;
    const st = newSticker(emoji.trim(), getPlayhead(), duration || 10);
    api.commit((s) => ({ ...s, stickers: [...s.stickers, st] }));
    api.toast('Sticker added — drag it on the preview to position it');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <Section title="Audio" icon={<Volume2 size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          <Toggle on={p.audio.noiseReduction} onChange={(v) => api.commit((s) => ({ ...s, audio: { ...s.audio, noiseReduction: v } }))} label="Noise reduction (high-pass)" />
          <Toggle on={p.audio.normalize} onChange={(v) => api.commit((s) => ({ ...s, audio: { ...s.audio, normalize: v } }))} label="Normalize loudness" />
        </div>
        <Slider label="Original audio volume" value={p.audio.originalVolume} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, audio: { ...s.audio, originalVolume: v } }))} />
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 6 }}>Noise reduction and normalization apply to the live preview; the export keeps the original track at your chosen volume.</div>
      </Section>

      <Section title="Music layer" icon={<Music size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <input ref={musicInput} type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickMusic(f); e.target.value = ''; }} />
        {!p.audio.musicLocalUrl && !p.audio.musicUrl ? (
          <button onClick={() => musicInput.current?.click()} className="ve-btn" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px dashed var(--space-border-strong)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
            <Music size={14} /> Import a background music file (MP3/WAV)
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--space-text-secondary)' }}>
              <Music size={13} style={{ flexShrink: 0, color: 'var(--space-text-brand)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.audio.musicName || 'Background music'}</span>
              <button onClick={() => api.commit((s) => ({ ...s, audio: { ...s.audio, musicLocalUrl: '', musicUrl: '', musicName: '' } }))} title="Remove music" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><X size={14} /></button>
            </div>
            <Slider label="Music volume" value={p.audio.musicVolume} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, audio: { ...s.audio, musicVolume: v } }))} />
            {!p.audio.musicUrl && <div style={{ fontSize: 11.5, color: 'var(--space-semantic-warning, #d97706)', marginTop: 4 }}>Still uploading — the export will include the music once the upload finishes.</div>}
          </>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>Loops under your original audio at the volume you set, both in preview and in the export.</div>
      </Section>

      <Section title="Watermark / logo" icon={<ImagePlus size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <input ref={wmInput} type="file" accept="image/png,image/webp,image/jpeg" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickWatermark(f); e.target.value = ''; }} />
        {!p.watermark ? (
          <button onClick={() => wmInput.current?.click()} className="ve-btn" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px dashed var(--space-border-strong)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
            <ImagePlus size={14} /> Upload a logo (PNG with transparency works best)
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <img src={p.watermark.localUrl || p.watermark.url} alt="Watermark" style={{ height: 34, maxWidth: 90, objectFit: 'contain', background: 'var(--space-surface-card)', borderRadius: 6, padding: 3, border: '1px solid var(--space-border-default)' }} />
              <div style={{ display: 'flex', gap: 5, flex: 1 }}>
                {(['tl', 'tr', 'bl', 'br'] as CornerId[]).map((c) => (
                  <Chip key={c} active={p.watermark?.corner === c} onClick={() => api.commit((s) => s.watermark ? ({ ...s, watermark: { ...s.watermark, corner: c } }) : s)}>{c.toUpperCase()}</Chip>
                ))}
              </div>
              <button onClick={() => api.commit((s) => ({ ...s, watermark: null }))} title="Remove watermark" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><Trash2 size={14} /></button>
            </div>
            <Slider label="Size" value={p.watermark.size} min={3} max={40} unit="% width" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => s.watermark ? ({ ...s, watermark: { ...s.watermark, size: v } }) : s)} />
            <Slider label="Opacity" value={p.watermark.opacity} min={5} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => s.watermark ? ({ ...s, watermark: { ...s.watermark, opacity: v } }) : s)} />
            {!p.watermark.url && <div style={{ fontSize: 11.5, color: 'var(--space-semantic-warning, #d97706)', marginTop: 4 }}>Still uploading — the export will include the logo once the upload finishes.</div>}
          </>
        )}
      </Section>

      <Section title="Aspect ratio crop" icon={<Crop size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {CROP_OPTIONS.map((c) => (
            <Chip key={c.id} active={p.crop === c.id} onClick={() => api.commit((s) => ({ ...s, crop: c.id }))}>{c.label}</Chip>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>The preview shows a live crop mask; the export reframes to a centered crop at this ratio.</div>
      </Section>

      <Section title="Thumbnail extractor" icon={<Camera size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <button onClick={onThumbnail} disabled={!hasFile} className="ve-btn" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: hasFile ? '#fff' : 'var(--space-text-muted)', background: hasFile ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)', border: 'none', borderRadius: 10, padding: '9px 14px', cursor: hasFile ? 'pointer' : 'not-allowed' }}>
          <Camera size={14} /> Export current frame as PNG
        </button>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 6 }}>Scrub the player to any frame, then grab it — the PNG includes your colour grade.</div>
      </Section>

      <Section title={'Stickers & emoji (' + p.stickers.length + ')'} icon={<Smile size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          {EMOJI_SET.map((e) => (
            <button key={e} onClick={() => addSticker(e)} title="Add at playhead" className="ve-btn" style={{ fontSize: 19, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '4px 7px', cursor: 'pointer' }}>{e}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input value={customEmoji} onChange={(e) => setCustomEmoji(e.target.value)} placeholder="Or type any emoji…" className="ve-input" style={{ flex: 1, minWidth: 0, fontSize: 13, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 9px', color: 'var(--space-text-primary)' }} />
          <button onClick={() => { addSticker(customEmoji); setCustomEmoji(''); }} className="ve-btn" style={{ fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}><Plus size={13} /></button>
        </div>
        {p.stickers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {p.stickers.map((st) => (
              <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--space-surface-card)', borderRadius: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{st.emoji}</span>
                <NumField label="From" value={st.start} min={0} step={0.1} width={56} onChange={(v) => api.commit((s) => ({ ...s, stickers: s.stickers.map((x) => x.id === st.id ? { ...x, start: Math.max(0, v) } : x) }))} />
                <NumField label="To" value={st.end} min={0} step={0.1} width={56} onChange={(v) => api.commit((s) => ({ ...s, stickers: s.stickers.map((x) => x.id === st.id ? { ...x, end: Math.max(0.2, v) } : x) }))} />
                <div style={{ flex: 1, minWidth: 90 }}>
                  <input type="range" min={24} max={280} value={st.size} title="Size"
                    onPointerDown={api.checkpoint}
                    onChange={(e) => api.silent((s) => ({ ...s, stickers: s.stickers.map((x) => x.id === st.id ? { ...x, size: Number(e.target.value) } : x) }))}
                    style={{ width: '100%', accentColor: 'var(--space-brand-primary-500)', cursor: 'pointer' }} />
                </div>
                <button onClick={() => api.commit((s) => ({ ...s, stickers: s.stickers.filter((x) => x.id !== st.id) }))} title="Remove sticker" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Before / after comparison" icon={<Columns2 size={14} style={{ color: 'var(--space-text-brand)' }} />}
        right={<Toggle on={compareOn} onChange={setCompareOn} label="" />}
      >
        <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 6 }}>Shows the untouched original side-by-side with your enhanced version, playing in sync.</div>
      </Section>

      <Section title="AI B-roll" icon={<Clapperboard size={14} style={{ color: 'var(--space-text-brand)' }} />}
        right={brollCtl.ready ? (
          <button onClick={brollCtl.addSlot} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
            <Plus size={13} /> Add at playhead
          </button>
        ) : undefined}
      >
        {brollCtl.broll.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', marginTop: 6 }}>After transcription, suggested cutaway moments land here. Each one generates a short AI clip that plays over your footage at that exact time — skip it entirely if you don't need it.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: brollCtl.broll.length ? 8 : 0 }}>
          {brollCtl.broll.map((b) => (
            <div key={b.id} style={{ background: 'var(--space-surface-card)', borderRadius: 10, padding: 10, opacity: b.enabled || b.status === 'done' ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--space-text-secondary)' }}>at</span>
                <input type="number" min={0} step={0.5} value={b.at}
                  onChange={(e) => brollCtl.updateSlot(b.id, { at: Math.max(0, Number(e.target.value) || 0) })}
                  className="ve-input" style={{ width: 62, fontSize: 12, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 6px', color: 'var(--space-text-primary)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--space-text-secondary)' }}>s, for</span>
                <select value={b.duration} onChange={(e) => brollCtl.updateSlot(b.id, { duration: Number(e.target.value) })}
                  className="ve-input" style={{ fontSize: 12, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 6px', color: 'var(--space-text-primary)', cursor: 'pointer' }}>
                  {[3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Toggle on={b.enabled} onChange={(v) => brollCtl.updateSlot(b.id, { enabled: v })} label="" />
                  <button onClick={() => brollCtl.removeSlot(b.id)} title="Remove this moment" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><Trash2 size={14} /></button>
                </div>
              </div>
              <textarea
                value={b.prompt}
                placeholder="Describe the cutaway shot — subject, setting, camera move, lighting…"
                onChange={(e) => brollCtl.updateSlot(b.id, { prompt: e.target.value })}
                rows={2}
                className="ve-input"
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5, lineHeight: 1.45, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '7px 9px', color: 'var(--space-text-primary)', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {b.status === 'done' && b.videoUrl ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--space-semantic-success-600)', display: 'flex', gap: 5, alignItems: 'center' }}><Check size={13} /> Clip ready — previews in the player at {formatTime(b.at)}</span>
                    <button onClick={() => brollCtl.generateSlot(b.id)} className="ve-btn" style={{ fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center', padding: '4px 6px', borderRadius: 8 }}><RefreshCw size={12} /> Regenerate</button>
                  </>
                ) : b.status === 'generating' ? (
                  <span style={{ fontSize: 12, color: 'var(--space-text-brand)', display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={13} className="animate-spin" /> Generating your clip — usually 1–3 minutes…</span>
                ) : (
                  <button onClick={() => brollCtl.generateSlot(b.id)} disabled={!b.prompt.trim()} className="ve-btn" style={{
                    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: b.prompt.trim() ? 'pointer' : 'not-allowed',
                    background: b.prompt.trim() ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)',
                    color: b.prompt.trim() ? '#fff' : 'var(--space-text-muted)', border: 'none', display: 'flex', gap: 6, alignItems: 'center',
                  }}><Wand2 size={13} /> Generate clip</button>
                )}
                {b.status === 'failed' && b.error && <span style={{ fontSize: 12, color: 'var(--space-semantic-danger)' }}>{b.error}</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}
