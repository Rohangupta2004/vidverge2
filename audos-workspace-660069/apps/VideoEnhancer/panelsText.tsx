/**
 * Video Enhancer — Text tab: multiple independent text layers (fonts, colors,
 * outline, shadow, animation, drag-to-position) plus the single home of the
 * word-timed caption pipeline (transcription status, segment editor, keyword
 * pops). The caption TREATMENT — concept motion graphics vs classic text —
 * lives in the MotionCaptionsSection rendered right below this panel.
 */
import { Type, Layers, Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown as ChevronDownIcon, Check, X, AlignLeft, AlignCenter, AlignRight, Loader2, RefreshCw } from 'lucide-react';
import type { ProjectState, EditorApi, TextLayerState } from './enhancerExtras';
import { FONT_OPTIONS, WEIGHT_OPTIONS, ANIM_OPTIONS, newTextLayer, fontCssFor } from './enhancerExtras';
import { Section, Slider, Toggle, ColorField, SelectField, NumField } from './uiControls';
import { CaptionSegment, GraphicCue, retimeSegmentText, formatTime } from './enhancerCore';

export interface CaptionControls {
  captions: CaptionSegment[];
  setCaptions: (up: (prev: CaptionSegment[]) => CaptionSegment[]) => void;
  captionsOn: boolean; setCaptionsOn: (v: boolean) => void;
  graphics: GraphicCue[];
  setGraphics: (up: (prev: GraphicCue[]) => GraphicCue[]) => void;
  graphicsOn: boolean; setGraphicsOn: (v: boolean) => void;
  planning: boolean; planNote: string;
  transcribing: boolean; transNote: string; transErr: string; transcript: string; wordCount: number;
  hasFile: boolean;
  onRegenerate: () => void;
}

export default function TextPanel({ p, api, duration, caps, selectedId, onSelect }: {
  p: ProjectState; api: EditorApi; duration: number; caps: CaptionControls;
  selectedId: string; onSelect: (id: string) => void;
}) {
  const sel = p.layers.find((l) => l.id === selectedId) || p.layers[0] || null;

  const up = (patch: Partial<TextLayerState>, record = false) => {
    if (!sel) return;
    const fn = (s: ProjectState): ProjectState => ({ ...s, layers: s.layers.map((l) => l.id === sel.id ? { ...l, ...patch } : l) });
    if (record) api.commit(fn); else api.silent(fn);
  };

  const addLayer = () => {
    const layer = newTextLayer(duration || 10);
    api.commit((s) => ({ ...s, layers: [...s.layers, layer] }));
    onSelect(layer.id);
    api.toast('Text layer added — drag it on the preview to position it');
  };

  const move = (id: string, dir: -1 | 1) => {
    api.commit((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= s.layers.length) return s;
      const layers = [...s.layers];
      const [item] = layers.splice(idx, 1);
      layers.splice(to, 0, item);
      return { ...s, layers };
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <Section title={'Text layers (' + p.layers.length + ')'} icon={<Layers size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen
        right={<button onClick={addLayer} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}><Plus size={13} /> Add</button>}
      >
        {p.layers.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', marginTop: 6 }}>
            No text layers yet. Add one, then drag it anywhere on the video preview. Emoji work too 🎉
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {p.layers.map((l, i) => (
            <div key={l.id} onClick={() => onSelect(l.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
              background: sel && sel.id === l.id ? 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)' : 'var(--space-surface-card)',
              border: '1px solid ' + (sel && sel.id === l.id ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'),
            }}>
              <button onClick={(e) => { e.stopPropagation(); api.commit((s) => ({ ...s, layers: s.layers.map((x) => x.id === l.id ? { ...x, visible: !x.visible } : x) })); }}
                title={l.visible ? 'Hide layer' : 'Show layer'}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: l.visible ? 'var(--space-text-brand)' : 'var(--space-text-muted)', padding: 2, flexShrink: 0 }}>
                {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--space-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontCssFor(l.font), opacity: l.visible ? 1 : 0.5 }}>
                {l.text.split('\n')[0] || '(empty)'}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--space-text-muted)', flexShrink: 0 }}>{formatTime(l.start)}–{formatTime(l.end)}</span>
              <button onClick={(e) => { e.stopPropagation(); move(l.id, -1); }} disabled={i === 0} title="Move up" style={{ background: 'transparent', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--space-text-muted)', padding: 1, opacity: i === 0 ? 0.3 : 1 }}><ChevronUp size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); move(l.id, 1); }} disabled={i === p.layers.length - 1} title="Move down" style={{ background: 'transparent', border: 'none', cursor: i === p.layers.length - 1 ? 'default' : 'pointer', color: 'var(--space-text-muted)', padding: 1, opacity: i === p.layers.length - 1 ? 0.3 : 1 }}><ChevronDownIcon size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); api.commit((s) => ({ ...s, layers: s.layers.filter((x) => x.id !== l.id) })); }} title="Remove layer" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        {sel && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--space-border-default)' }}>
            <textarea
              value={sel.text}
              rows={3}
              placeholder={'Multi-line text — emoji welcome ✨'}
              onFocus={api.checkpoint}
              onChange={(e) => up({ text: e.target.value })}
              className="ve-input"
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13, lineHeight: 1.45, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '8px 10px', color: 'var(--space-text-primary)', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <SelectField label="Font family" value={sel.font} options={FONT_OPTIONS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => up({ font: v }, true)} />
              <SelectField label="Weight" value={sel.weight} options={WEIGHT_OPTIONS} onChange={(v) => up({ weight: Number(v) }, true)} />
            </div>

            <Slider label="Font size" value={sel.size} min={8} max={120} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ size: v })} />
            <Slider label="Letter spacing" value={sel.letterSpacing} min={-2} max={24} step={0.5} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ letterSpacing: v })} />
            <Slider label="Line height" value={sel.lineHeight} min={0.8} max={2.5} step={0.05} onBegin={api.checkpoint} onChange={(v) => up({ lineHeight: v })} format={(v) => v.toFixed(2)} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
              <ColorField label="Text" value={sel.color} onBegin={api.checkpoint} onChange={(v) => up({ color: v })} />
              <ColorField label="Highlight" value={sel.bg} onBegin={api.checkpoint} onChange={(v) => up({ bg: v })} />
              <div style={{ display: 'flex', gap: 4 }}>
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button key={a} onClick={() => up({ align: a }, true)} title={'Align ' + a} className="ve-btn" style={{
                    padding: 5, borderRadius: 6, cursor: 'pointer',
                    border: '1px solid ' + (sel.align === a ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'),
                    background: sel.align === a ? 'color-mix(in srgb, var(--space-brand-primary-500) 16%, transparent)' : 'var(--space-surface-card)',
                    color: sel.align === a ? 'var(--space-text-brand)' : 'var(--space-text-muted)',
                  }}>
                    {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
                  </button>
                ))}
              </div>
            </div>
            <Slider label="Highlight opacity" value={sel.bgOpacity} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => up({ bgOpacity: v })} />

            <div style={{ marginTop: 10 }}>
              <SelectField label="Animation" value={sel.anim} options={ANIM_OPTIONS} onChange={(v) => up({ anim: v as TextLayerState['anim'] }, true)} />
            </div>

            <Slider label="Position X" value={sel.x} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => up({ x: v })} />
            <Slider label="Position Y" value={sel.y} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => up({ y: v })} />
            <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 4 }}>Tip: drag the text directly on the video preview.</div>

            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <NumField label="From (s)" value={sel.start} min={0} step={0.1} onChange={(v) => up({ start: Math.max(0, v) }, true)} />
              <NumField label="To (s)" value={sel.end} min={0} step={0.1} onChange={(v) => up({ end: Math.max(0.2, v) }, true)} />
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--space-border-default)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <ColorField label="Outline" value={sel.outlineColor} onBegin={api.checkpoint} onChange={(v) => up({ outlineColor: v })} />
              </div>
              <Slider label="Outline width" value={sel.outlineWidth} min={0} max={8} step={0.5} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ outlineWidth: v })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                <ColorField label="Shadow" value={sel.shadowColor} onBegin={api.checkpoint} onChange={(v) => up({ shadowColor: v })} />
              </div>
              <Slider label="Shadow blur" value={sel.shadowBlur} min={0} max={40} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ shadowBlur: v })} />
              <Slider label="Shadow X" value={sel.shadowX} min={-30} max={30} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ shadowX: v })} />
              <Slider label="Shadow Y" value={sel.shadowY} min={-30} max={30} unit="px" onBegin={api.checkpoint} onChange={(v) => up({ shadowY: v })} />
            </div>
          </div>
        )}
      </Section>

      <Section title="Auto captions (word-timed)" icon={<Type size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen
        right={<Toggle on={caps.captionsOn} onChange={caps.setCaptionsOn} label="" />}
      >
        {caps.transcribing && <div style={{ fontSize: 13, color: 'var(--space-text-brand)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={13} className="animate-spin" /> {caps.transNote || 'Transcribing with word-level timestamps…'}</div>}
        {caps.transErr && <div style={{ fontSize: 13, color: 'var(--space-semantic-danger)', marginTop: 6 }}>{caps.transErr}</div>}
        {caps.planning && <div style={{ fontSize: 13, color: 'var(--space-text-brand)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={13} className="animate-spin" /> The AI is picking emphasis words, keyword pops and B-roll moments…</div>}
        {caps.planNote && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 6 }}>{caps.planNote}</div>}
        {caps.captions.length === 0 && !caps.planning && !caps.transcribing && (
          <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', marginTop: 6 }}>
            {caps.hasFile
              ? 'Captions appear here automatically once your video is transcribed.'
              : 'Upload a video first — the audio is sent through the AI transcription service and word-timed captions appear here automatically.'}
          </div>
        )}

        {caps.wordCount > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--space-semantic-success-600)', marginTop: 6, display: 'flex', gap: 5, alignItems: 'center' }}>
            <Check size={13} /> {caps.wordCount} words transcribed — captions are live on the preview. Pick their treatment in “Caption treatment” below.
          </div>
        )}
        {caps.transcript && (
          <div style={{ marginTop: 8, maxHeight: 96, overflowY: 'auto', fontSize: 12.5, lineHeight: 1.5, color: 'var(--space-text-secondary)', background: 'var(--space-surface-card)', borderRadius: 8, padding: '8px 10px' }}>
            {caps.transcript}
          </div>
        )}

        {caps.captions.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {caps.captions.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--space-surface-card)', borderRadius: 8, padding: '6px 8px', opacity: c.enabled ? 1 : 0.45 }}>
                <button onClick={() => caps.setCaptions((prev) => prev.map((s) => s.id === c.id ? { ...s, enabled: !s.enabled } : s))} title={c.enabled ? 'Exclude this caption' : 'Include this caption'} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: c.enabled ? 'var(--space-semantic-success-600)' : 'var(--space-text-muted)', padding: 2, flexShrink: 0 }}>
                  {c.enabled ? <Check size={14} /> : <X size={14} />}
                </button>
                <span style={{ fontSize: 11, color: 'var(--space-text-muted)', flexShrink: 0, width: 34 }}>{formatTime(c.start)}</span>
                <input
                  value={c.text}
                  onChange={(e) => caps.setCaptions((prev) => prev.map((s) => s.id === c.id ? retimeSegmentText(s, e.target.value) : s))}
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--space-text-primary)' }}
                />
              </div>
            ))}
          </div>
        )}

        {caps.hasFile && !caps.transcribing && (
          <button onClick={caps.onRegenerate} className="ve-btn" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>
            <RefreshCw size={13} /> {caps.wordCount > 0 ? 'Re-transcribe & rebuild captions' : 'Generate auto captions'}
          </button>
        )}
      </Section>

      {caps.graphics.length > 0 && (
        <Section title="Keyword pops" icon={<Type size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen
          right={<Toggle on={caps.graphicsOn} onChange={caps.setGraphicsOn} label="" />}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {caps.graphics.map((g) => (
              <button key={g.id} onClick={() => caps.setGraphics((prev) => prev.map((x) => x.id === g.id ? { ...x, enabled: !x.enabled } : x))} title={g.kind + ' at ' + formatTime(g.at)} className="ve-btn" style={{
                fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid ' + (g.enabled ? 'var(--space-brand-highlight-500)' : 'var(--space-border-default)'),
                background: g.enabled ? 'color-mix(in srgb, var(--space-brand-highlight-500) 16%, transparent)' : 'var(--space-surface-panel)',
                color: g.enabled ? 'var(--space-text-accent)' : 'var(--space-text-muted)',
                textDecoration: g.enabled ? 'none' : 'line-through',
              }}>{formatTime(g.at)} · {g.text}</button>
            ))}
          </div>
        </Section>
      )}

    </div>
  );
}
