/**
 * Video Enhancer — Caption treatment section (Text tab).
 *
 * Captions are no longer burned in as plain subtitle text by default: each
 * caption moment gets a concept MOTION GRAPHIC (animated SVG rendered by the
 * export composition — see captionGraphics.MOTION_GRAPHICS_LIB). This section
 * switches between the two treatments, shows the AI concept mapping for every
 * segment (archetype + label, editable per cue) and re-runs the gpt-5.6-terra
 * mapping on demand. Classic text captions remain available as the 'text'
 * mode with the original style presets.
 */
import { AlertCircle, Loader2, RefreshCw, Sparkles, Type, X, Check } from 'lucide-react';
import { CAPTION_PRESETS, CaptionPresetId, CaptionSegment, formatTime } from './enhancerCore';
import {
  CaptionRenderMode, MOTION_ARCHETYPES, MotionArchetypeId, MotionCue, archetypeEmoji,
} from './captionGraphics';
import { Chip, Section } from './uiControls';

export default function MotionCaptionsSection({ captions, cues, setCues, mode, setMode, captionPreset, setCaptionPreset, mapping, mapNote, onRemap }: {
  /** Word-timed caption segments produced by the transcription step. */
  captions: CaptionSegment[];
  /** Current motion cues (one per enabled caption segment). */
  cues: MotionCue[];
  setCues: (up: (prev: MotionCue[]) => MotionCue[]) => void;
  /** Export treatment: concept motion graphics (default) or classic text. */
  mode: CaptionRenderMode;
  setMode: (m: CaptionRenderMode) => void;
  captionPreset: CaptionPresetId;
  setCaptionPreset: (v: CaptionPresetId) => void;
  /** True while the AI concept-mapping call is running. */
  mapping: boolean;
  /** Status line for the last mapping run ('' when nothing to say). */
  mapNote: string;
  /** Re-runs the AI mapping over the current caption segments. */
  onRemap: () => void;
}) {
  const hasCaptions = captions.some((c) => c.enabled && c.text.trim());

  return (
    <Section title="Caption treatment" icon={<Sparkles size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen>
      <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', lineHeight: 1.5, marginTop: 4 }}>
        Motion graphics animate the CONCEPT of each caption — “fast delivery” becomes a moving package, “growth” a rising chart — instead of burning subtitle text onto the video.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <Chip active={mode === 'motion'} title="Animated concept graphics at each caption moment (default)" onClick={() => setMode('motion')}>✨ Motion graphics</Chip>
        <Chip active={mode === 'text'} title="Classic word-timed subtitle text" onClick={() => setMode('text')}>Aa Text captions</Chip>
      </div>

      {mode === 'text' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {CAPTION_PRESETS.map((cp) => (
              <Chip key={cp.id} active={captionPreset === cp.id} title={cp.hint} onClick={() => setCaptionPreset(cp.id)}>{cp.label}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>
            Word-timed subtitles in this style are burned onto the export. Edit the caption text below.
          </div>
        </>
      )}

      {mode === 'motion' && (
        <>
          {!hasCaptions ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--space-text-muted)', marginTop: 10, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: '8px 11px' }}>
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              Motion graphics are generated from the caption timestamps — transcribe your video first (button above).
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={onRemap}
                  disabled={mapping}
                  className="ve-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '8px 13px', borderRadius: 10, border: 'none',
                    cursor: mapping ? 'not-allowed' : 'pointer',
                    background: mapping ? 'var(--space-surface-panel-strong)' : 'var(--space-brand-primary-600)',
                    color: mapping ? 'var(--space-text-muted)' : '#fff',
                  }}
                >
                  {mapping ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {mapping ? 'Mapping concepts…' : (cues.length ? 'Re-map with AI' : 'Map concepts with AI')}
                </button>
                {cues.length > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--space-text-muted)' }}>
                    {cues.filter((c) => c.enabled).length}/{cues.length} moments on
                  </span>
                )}
              </div>
              {mapNote && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 6 }}>{mapNote}</div>}

              {cues.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 250, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cues.map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--space-surface-card)', borderRadius: 8, padding: '6px 8px', opacity: c.enabled ? 1 : 0.45, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setCues((prev) => prev.map((x) => x.id === c.id ? { ...x, enabled: !x.enabled } : x))}
                        title={c.enabled ? 'Skip this moment' : 'Include this moment'}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: c.enabled ? 'var(--space-semantic-success-600)' : 'var(--space-text-muted)', padding: 2, flexShrink: 0 }}
                      >
                        {c.enabled ? <Check size={14} /> : <X size={14} />}
                      </button>
                      <span style={{ fontSize: 11, color: 'var(--space-text-muted)', flexShrink: 0, width: 34, fontVariantNumeric: 'tabular-nums' }}>{formatTime(c.start)}</span>
                      <span style={{ fontSize: 16, flexShrink: 0 }} aria-hidden>{archetypeEmoji(c.archetype)}</span>
                      <select
                        value={c.archetype}
                        onChange={(e) => setCues((prev) => prev.map((x) => x.id === c.id ? { ...x, archetype: e.target.value as MotionArchetypeId } : x))}
                        title="Motion graphic for this moment"
                        className="ve-input"
                        style={{ fontSize: 12, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 6px', color: 'var(--space-text-primary)', cursor: 'pointer', maxWidth: 150 }}
                      >
                        {MOTION_ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                      <input
                        value={c.label}
                        onChange={(e) => setCues((prev) => prev.map((x) => x.id === c.id ? { ...x, label: e.target.value.slice(0, 18) } : x))}
                        placeholder="Concept label"
                        title="1–3 words shown under the graphic"
                        className="ve-input"
                        style={{ flex: 1, minWidth: 80, fontSize: 12.5, background: 'transparent', border: 'none', outline: 'none', color: 'var(--space-text-primary)' }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8, display: 'flex', gap: 5, alignItems: 'center' }}>
                <Type size={12} style={{ flexShrink: 0 }} />
                Graphics animate in and out in sync with each caption’s start and end in the export.
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}
