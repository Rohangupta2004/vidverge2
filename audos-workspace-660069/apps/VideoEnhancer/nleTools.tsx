/**
 * Video Enhancer NLE — middle band: AI Tools (left) and Properties (right).
 *
 * AI TOOLS: one-click AI Edit (transcribe → silence-cut → word-timed captions
 * → AI-planned motion graphics), Gemini Describe, Generate B-roll (server
 * hook), Auto-transcribe, manual transcript fallback, Style Transfer, and the
 * kinetic Motion Graphics presets (Hook Title / Keyword Pop / Lower Third /
 * Big Stat / CTA — added at the playhead, edited in Properties).
 *
 * PROPERTIES: selected clip (trim in/out, split at playhead, delete, speed,
 * opacity, text overlay), selected graphic (text, sub, value, duration,
 * position), Effects (brightness / contrast / saturation / blur / vignette),
 * music (five ElevenLabs beds + generate-your-own from a prompt) and grade.
 */
import { useState } from 'react';
import { Clapperboard, Loader2, Music, Palette, Scissors, Sparkles, Trash2, Type, Wand2, Zap } from 'lucide-react';
import {
  COLOR_GRADES, ColorGradeId, GRAPHIC_PRESETS, GeminiAnalysis, GraphicKind, LB,
  MUSIC_BEDS, MotionGraphic, MusicBedId, NleClip, NleEffects, SPEED_OPTIONS,
  STYLE_TRANSFERS,
} from './nleCore';
import EnginePicker from '../../components/EngineSelector';

const panel = { background: LB.bgCard, border: LB.border, borderRadius: 12, padding: '14px 16px' } as const;
const h = { color: LB.textPrimary, fontSize: 13, fontWeight: 600, fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', gap: 8 } as const;
const sub = { color: LB.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' as const, margin: '14px 0 6px' };
const inputStyle = { width: '100%', background: LB.bgDeep, color: LB.textPrimary, border: LB.border, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' as const };

function Pill(props: { active: boolean; disabled?: boolean; onClick: () => void; children: any; title?: string }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className="nle-btn"
      style={{
        background: props.active ? LB.accent : 'rgba(180,120,0,0.06)',
        color: props.active ? '#241503' : LB.textSecondary,
        border: props.active ? '1px solid transparent' : '1px solid rgba(180,120,0,0.14)',
        borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 650, cursor: 'pointer',
      }}
    >
      {props.children}
    </button>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', color: LB.textMuted, fontSize: 10.5, marginBottom: 2 }}>
        <span>{props.label}</span><span style={{ color: LB.textSecondary }}>{props.value}{props.suffix || ''}</span>
      </span>
      <input type="range" min={props.min} max={props.max} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} style={{ width: '100%', accentColor: LB.accent }} />
    </label>
  );
}

/** Progressive disclosure — heavy control groups fold away until needed. */
function Collapse(props: { title: string; icon?: any; defaultOpen?: boolean; children: any }) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <div>
      <button
        className="nle-btn"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '13px 0 5px', color: LB.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'left' }}
      >
        <span style={{ display: 'inline-block', transition: 'transform .15s ease', transform: open ? 'rotate(90deg)' : 'none', color: LB.accent }}>›</span>
        {props.icon || null}{props.title}
        <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>{open ? 'hide' : 'show'}</span>
      </button>
      {open ? props.children : null}
    </div>
  );
}

function ToolButton(props: { emoji: string; label: string; hint: string; busy?: boolean; disabled?: boolean; accent?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.busy || props.disabled}
      className="nle-btn"
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: props.accent ? 'rgba(200,146,10,0.12)' : 'rgba(180,120,0,0.06)', border: props.accent ? '1px solid rgba(200,146,10,0.4)' : '1px solid rgba(180,120,0,0.14)', borderRadius: 10, padding: '10px 12px', cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? 0.5 : 1 }}
    >
      <span style={{ fontSize: 16 }}>{props.emoji}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: props.accent ? LB.accent : LB.textPrimary, fontSize: 12.5, fontWeight: 600 }}>{props.label}</span>
        <span style={{ display: 'block', color: LB.textMuted, fontSize: 10.5 }}>{props.hint}</span>
      </span>
      {props.busy ? <Loader2 size={14} color={LB.accent} className="animate-spin" style={{ marginLeft: 'auto', flexShrink: 0 }} /> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AI TOOLS (left column)
// ---------------------------------------------------------------------------

export function AiToolsPanel(props: {
  hasFootage: boolean;
  analysis: GeminiAnalysis | null;
  analyzing: boolean;
  aiEditBusy: boolean;
  transcribing: boolean;
  brollBusy: boolean;
  brollPrompt: string;
  onBrollPrompt: (v: string) => void;
  brollModel: string;
  brollModelMode: 'auto' | 'manual';
  brollAutoName: string;
  brollAutoReason: string;
  onBrollAuto: () => void;
  onBrollModel: (id: string) => void;
  styleId: string | null;
  onAiEdit: () => void;
  onTranscribe: () => void;
  onDescribe: () => void;
  onBroll: () => void;
  onCaptions: (transcript: string) => void;
  onStyle: (id: string) => void;
  onAddGraphic: (kind: GraphicKind) => void;
  appliedSuggestions: string[];
  onApplySuggestion: (text: string) => void;
}) {
  const [transcript, setTranscript] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const a = props.analysis;
  const anyBusy = props.aiEditBusy || props.transcribing;
  return (
    <div style={panel}>
      <div style={h}><Sparkles size={14} color={LB.accent} /> AI Tools</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <ToolButton emoji="⚡" accent label="AI Edit — one click" hint="Transcribe · cut silences · word-timed captions · planned motion graphics" busy={props.aiEditBusy} disabled={!props.hasFootage || anyBusy} onClick={props.onAiEdit} />

        <ToolButton emoji="✨" label="Gemini Describe" hint="Analyze a video frame — subject, colors, mood, suggestions" busy={props.analyzing} disabled={!props.hasFootage} onClick={props.onDescribe} />

        <div>
          <ToolButton emoji="🎬" label="Generate B-roll" hint="Prompt → director-selected clip, added to the Video track" busy={props.brollBusy} disabled={!props.brollPrompt.trim() || props.brollBusy} onClick={props.onBroll} />
          <input
            value={props.brollPrompt}
            onChange={(e) => props.onBrollPrompt(e.target.value)}
            placeholder="Describe the b-roll shot…"
            className="nle-input"
            style={{ ...inputStyle, marginTop: 6 }}
          />
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
            <Pill active={props.brollModelMode === 'auto'} onClick={props.onBrollAuto}>Auto — Director picks</Pill>
            <EnginePicker
              value={props.brollModel}
              onChange={props.onBrollModel}
              groupAIds={[
                'gemini-omni-flash-preview',
                'veo-3.1-generate-preview',
                'veo-3.1-fast-generate-preview',
                'sora-2',
                'sora-2-pro',
                'openrouter/bytedance/seedance-2.0-fast',
              ]}
              includeRunway
              includeKling={false}
              disabled={props.brollBusy}
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
          </div>
          {props.brollModelMode === 'auto' ? (
            <div style={{ marginTop: 8, background: LB.bgDeep, border: LB.border, borderRadius: 9, padding: '9px 11px' }}>
              <div style={{ color: LB.textPrimary, fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>Director's pick: {props.brollAutoName}</div>
              <div style={{ color: LB.textMuted, fontSize: 10.5, lineHeight: 1.5 }}>{props.brollAutoReason}</div>
            </div>
          ) : (
            <div style={{ color: LB.textMuted, fontSize: 10.5, marginTop: 6 }}>Manual override — this concrete model is sent with the B-roll request.</div>
          )}
        </div>

        <div>
          <ToolButton emoji="📝" label="Auto-transcribe captions" hint="AI transcription of the footage's own audio — word-accurate timings" busy={props.transcribing} disabled={!props.hasFootage || anyBusy} onClick={props.onTranscribe} />
          <button className="nle-btn" onClick={() => setShowPaste((v) => !v)} style={{ background: 'none', border: 'none', color: LB.textMuted, fontSize: 10.5, cursor: 'pointer', padding: '4px 2px', textDecoration: 'underline' }}>
            {showPaste ? 'Hide manual transcript' : 'Or paste a transcript manually'}
          </button>
          {showPaste ? (
            <div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the transcript here…"
                rows={3}
                className="nle-input"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <button className="nle-btn" disabled={!transcript.trim() || !props.hasFootage} onClick={() => props.onCaptions(transcript)} style={{ marginTop: 6, background: 'rgba(180,120,0,0.06)', border: '1px solid rgba(180,120,0,0.14)', color: LB.textSecondary, borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                Estimate captions from pasted text
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Zap size={14} color={LB.accent} />
            <span style={{ color: LB.textPrimary, fontSize: 12.5, fontWeight: 600 }}>Quick Motion Graphics</span>
            <span style={{ color: LB.textMuted, fontSize: 10 }}>added at the playhead</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GRAPHIC_PRESETS.map((g) => (
              <Pill key={g.kind} active={false} disabled={!props.hasFootage} onClick={() => props.onAddGraphic(g.kind)} title={g.hint}>✦ {g.label}</Pill>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 15 }}>🎨</span>
            <span style={{ color: LB.textPrimary, fontSize: 12.5, fontWeight: 600 }}>Style Transfer</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STYLE_TRANSFERS.map((s) => (
              <Pill key={s.id} active={props.styleId === s.id} onClick={() => props.onStyle(s.id)}>{s.label}</Pill>
            ))}
          </div>
        </div>
      </div>

      {/* Gemini analysis result */}
      {a ? (
        <div style={{ marginTop: 12, background: LB.bgDeep, border: LB.border, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: LB.textPrimary, fontSize: 12, fontWeight: 600 }}>{a.subject || 'Frame analyzed'}</span>
            {a.mood ? <span style={{ background: 'rgba(200,146,10,0.14)', border: '1px solid rgba(200,146,10,0.4)', color: LB.accent, borderRadius: 999, padding: '2px 10px', fontSize: 10.5, fontWeight: 700 }}>{a.mood}</span> : null}
          </div>
          {a.dominantColors.length ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              {a.dominantColors.map((cHex, i) => (
                <span key={i} title={cHex} style={{ width: 20, height: 20, borderRadius: 6, background: cHex, border: '1px solid rgba(180,120,0,0.28)' }} />
              ))}
              <span style={{ color: LB.textMuted, fontSize: 10.5, marginLeft: 4 }}>{a.lightingStyle}{a.backgroundType ? ` · ${a.backgroundType}` : ''}</span>
            </div>
          ) : null}
          {a.suggestedEnhancements.length ? (
            <>
              <div style={{ color: LB.textMuted, fontSize: 10, marginTop: 8 }}>Click a suggestion to APPLY it — not just read it:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {a.suggestedEnhancements.map((s, i) => {
                  const done = props.appliedSuggestions.includes(s);
                  return (
                    <button
                      key={i}
                      className="nle-btn"
                      onClick={() => props.onApplySuggestion(s)}
                      title={done ? 'Applied — click again to re-apply' : 'One click applies this fix to the edit'}
                      style={{ background: done ? 'rgba(22,101,52,0.12)' : 'rgba(200,146,10,0.10)', border: done ? '1px solid rgba(22,101,52,0.4)' : '1px solid rgba(200,146,10,0.35)', color: done ? '#166534' : '#B4720A', borderRadius: 999, padding: '4px 11px', fontSize: 10.5, cursor: 'pointer', textAlign: 'left' }}
                    >
                      {done ? '✓ ' : '⚡ '}{s}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROPERTIES (right column)
// ---------------------------------------------------------------------------

export function PropertiesPanel(props: {
  clip: NleClip | null;
  graphic: MotionGraphic | null;
  effects: NleEffects;
  musicBedId: MusicBedId | 'custom';
  customMusicLabel: string;
  musicGenBusy: boolean;
  gradeId: ColorGradeId;
  canSplit: boolean;
  onSplit: () => void;
  onDeleteClip: (id: string) => void;
  onTrim: (id: string, nextIn: number, nextOut: number) => void;
  onSpeed: (id: string, speed: number) => void;
  onOpacity: (id: string, opacity: number) => void;
  onText: (id: string, patch: { text?: string; textSize?: number; textColor?: string }) => void;
  onGraphicChange: (id: string, patch: Partial<MotionGraphic>) => void;
  onGraphicDelete: (id: string) => void;
  onEffects: (patch: Partial<NleEffects>) => void;
  onMusic: (id: MusicBedId) => void;
  onGenerateMusic: (prompt: string) => void;
  onGrade: (id: ColorGradeId) => void;
}) {
  const c = props.clip;
  const g = props.graphic;
  const [musicPrompt, setMusicPrompt] = useState('');
  return (
    <div style={panel}>
      <div style={h}><Wand2 size={14} color={LB.accent} /> Properties {g ? <span style={{ color: LB.textMuted, fontSize: 11, fontWeight: 500 }}>— ✦ {g.kind}</span> : c ? <span style={{ color: LB.textMuted, fontSize: 11, fontWeight: 500 }}>— {c.label}</span> : <span style={{ color: LB.textMuted, fontSize: 11, fontWeight: 500 }}>— select a clip or graphic</span>}</div>

      {/* —— selected GRAPHIC —— */}
      {g ? (
        <>
          <div style={sub}>Graphic text</div>
          <input className="nle-input" style={inputStyle} value={g.text} onChange={(e) => props.onGraphicChange(g.id, { text: e.target.value })} />
          {g.kind === 'lowerthird' || g.kind === 'cta' || g.kind === 'stat' ? (
            <>
              <div style={sub}>{g.kind === 'stat' ? 'Label' : 'Sub line'}</div>
              <input className="nle-input" style={inputStyle} value={g.sub} onChange={(e) => props.onGraphicChange(g.id, { sub: e.target.value })} />
            </>
          ) : null}
          {g.kind === 'stat' ? (
            <>
              <div style={sub}>Count-up value</div>
              <input type="number" className="nle-input" style={inputStyle} value={g.value} onChange={(e) => props.onGraphicChange(g.id, { value: Math.max(0, Number(e.target.value) || 0) })} />
            </>
          ) : null}
          <div style={sub}>Duration — {g.duration.toFixed(1)}s</div>
          <input type="range" min={8} max={100} value={Math.round(g.duration * 10)} onChange={(e) => props.onGraphicChange(g.id, { duration: Number(e.target.value) / 10 })} style={{ width: '100%', accentColor: LB.accent }} />
          <div style={sub}>Position</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['top', 'center', 'lower'] as const).map((p) => (
              <Pill key={p} active={g.position === p} onClick={() => props.onGraphicChange(g.id, { position: p })}>{p}</Pill>
            ))}
          </div>
          <button className="nle-btn" onClick={() => props.onGraphicDelete(g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: 'rgba(153,27,27,0.09)', border: '1px solid rgba(153,27,27,0.35)', color: '#991B1B', borderRadius: 8, padding: '7px 13px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
            <Trash2 size={12} /> Remove graphic
          </button>
        </>
      ) : c ? (
        <>
          {/* —— selected CLIP —— */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="nle-btn" disabled={!props.canSplit} onClick={props.onSplit} title="Cut the selected clip in two at the playhead" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(200,146,10,0.12)', border: '1px solid rgba(200,146,10,0.4)', color: LB.accent, borderRadius: 8, padding: '7px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              <Scissors size={12} /> Split at playhead
            </button>
            <button className="nle-btn" onClick={() => props.onDeleteClip(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(153,27,27,0.09)', border: '1px solid rgba(153,27,27,0.35)', color: '#991B1B', borderRadius: 8, padding: '7px 13px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
              <Trash2 size={12} /> Delete clip
            </button>
          </div>

          <div style={sub}>Trim (seconds)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, color: LB.textMuted, fontSize: 10.5 }}>
              In
              <input
                type="number" min={0} max={Math.max(0, c.out - 0.2)} step={0.1} value={Number(c.in.toFixed(1))}
                onChange={(e) => props.onTrim(c.id, Math.max(0, Math.min(c.out - 0.2, Number(e.target.value) || 0)), c.out)}
                className="nle-input" style={{ ...inputStyle, marginTop: 4 }}
              />
            </label>
            <label style={{ flex: 1, color: LB.textMuted, fontSize: 10.5 }}>
              Out
              <input
                type="number" min={c.in + 0.2} max={c.sourceDuration || 3600} step={0.1} value={Number(c.out.toFixed(1))}
                onChange={(e) => props.onTrim(c.id, c.in, Math.max(c.in + 0.2, Math.min(c.sourceDuration || 3600, Number(e.target.value) || c.out)))}
                className="nle-input" style={{ ...inputStyle, marginTop: 4 }}
              />
            </label>
          </div>

          <div style={sub}>Speed</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SPEED_OPTIONS.map((s) => (
              <Pill key={s} active={c.speed === s} onClick={() => props.onSpeed(c.id, s)}>{s}×</Pill>
            ))}
          </div>

          <div style={sub}>Opacity — {Math.round(c.opacity * 100)}%</div>
          <input
            type="range" min={0} max={100} value={Math.round(c.opacity * 100)}
            onChange={(e) => props.onOpacity(c.id, Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
            style={{ width: '100%', accentColor: LB.accent }}
          />

          <div style={sub}><Type size={10} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />Text overlay</div>
          <input
            value={c.text}
            onChange={(e) => props.onText(c.id, { text: e.target.value })}
            placeholder="Text shown during this clip…"
            className="nle-input" style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
            <label style={{ flex: 1, color: LB.textMuted, fontSize: 10.5 }}>
              Size
              <input type="number" min={16} max={160} value={c.textSize} onChange={(e) => props.onText(c.id, { textSize: Math.max(16, Math.min(160, Number(e.target.value) || 56)) })} className="nle-input" style={{ ...inputStyle, marginTop: 4 }} />
            </label>
            <label style={{ color: LB.textMuted, fontSize: 10.5 }}>
              Color
              <input type="color" value={c.textColor} onChange={(e) => props.onText(c.id, { textColor: e.target.value })} style={{ display: 'block', marginTop: 4, width: 44, height: 32, background: 'transparent', border: LB.border, borderRadius: 6, padding: 2, cursor: 'pointer' }} />
            </label>
          </div>
        </>
      ) : (
        <div style={{ color: LB.textMuted, fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
          Click a clip or a ✦ graphic in the timeline to edit it. Effects, music and grade below apply to the whole video.
        </div>
      )}

      {/* —— EFFECTS (whole video) —— */}
      <Collapse title="Effects" defaultOpen icon={<Palette size={10} style={{ marginRight: 4 }} />}>
        <Slider label="Brightness" value={props.effects.brightness} min={50} max={160} suffix="%" onChange={(v) => props.onEffects({ brightness: v })} />
        <Slider label="Contrast" value={props.effects.contrast} min={50} max={160} suffix="%" onChange={(v) => props.onEffects({ contrast: v })} />
        <Slider label="Saturation" value={props.effects.saturation} min={0} max={200} suffix="%" onChange={(v) => props.onEffects({ saturation: v })} />
        <Slider label="Blur" value={props.effects.blur} min={0} max={12} suffix="px" onChange={(v) => props.onEffects({ blur: v })} />
        <Slider label="Vignette" value={props.effects.vignette} min={0} max={100} suffix="%" onChange={(v) => props.onEffects({ vignette: v })} />
        <button className="nle-btn" onClick={() => props.onEffects({ brightness: 100, contrast: 100, saturation: 100, blur: 0, vignette: 0 })} style={{ background: 'none', border: 'none', color: LB.textMuted, fontSize: 10.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Reset effects</button>
      </Collapse>

      {/* —— MUSIC —— */}
      <Collapse title="Music bed" icon={<Music size={10} style={{ marginRight: 4 }} />}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MUSIC_BEDS.map((m) => (
          <Pill key={m.id} active={props.musicBedId === m.id} onClick={() => props.onMusic(m.id)}>{m.label}</Pill>
        ))}
        <Pill active={props.musicBedId === 'none'} onClick={() => props.onMusic('none')}>None</Pill>
        {props.customMusicLabel ? <Pill active={props.musicBedId === 'custom'} onClick={() => props.onMusic('custom' as MusicBedId)} title={props.customMusicLabel}>♪ {props.customMusicLabel.slice(0, 22)}</Pill> : null}
      </div>
      <div style={{ marginTop: 8 }}>
        <input
          value={musicPrompt}
          onChange={(e) => setMusicPrompt(e.target.value)}
          placeholder="Or describe a track — ElevenLabs composes it…"
          className="nle-input" style={inputStyle}
        />
        <button
          className="nle-btn"
          disabled={musicPrompt.trim().length < 10 || props.musicGenBusy}
          onClick={() => props.onGenerateMusic(musicPrompt.trim())}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, background: 'rgba(22,101,52,0.12)', border: '1px solid rgba(22,101,52,0.4)', color: '#166534', borderRadius: 8, padding: '7px 13px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}
        >
          {props.musicGenBusy ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />} Generate with ElevenLabs
        </button>
      </div>
      </Collapse>

      {/* —— GRADE —— */}
      <Collapse title="Color grade">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {COLOR_GRADES.map((gr) => (
          <Pill key={gr.id} active={props.gradeId === gr.id} onClick={() => props.onGrade(gr.id)}>{gr.label}</Pill>
        ))}
      </div>
      </Collapse>
    </div>
  );
}
