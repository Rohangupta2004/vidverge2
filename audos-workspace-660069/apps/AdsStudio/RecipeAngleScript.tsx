/**
 * ADS STUDIO - RECIPES - the optional ANGLE -> SCRIPT pre-step.
 *
 * The eight-step workflow decides an ad's angle at Step 3 and writes its clip
 * script at Step 4. A recipe could only ever be given a one-line creative
 * direction, so the same ad brief had to be re-thought by hand every time.
 *
 * This panel brings those two steps in front of the recipes as an OPTIONAL
 * pre-step. Nothing in the eight-step workflow changed: this is a copy that
 * runs standalone (lib: recipesApi.autoWriteAngles + recipesApi.writeAngleScript)
 * and hands its result to the recipe as a prefill. Skipping it leaves the
 * recipes behaving exactly as they did.
 *
 *   Analyse angles  ->  pick one  ->  write the script  ->  Use in the recipe
 *                     (or just press Skip and generate)
 */
import { useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, PenLine, Sparkles, Target, Wand2, X,
} from 'lucide-react';
import { T } from './api';
import { Btn, Spin, Tag, card, inputStyle, labelStyle } from './ui';
import {
  ANGLE_TONES, CLIP_WORD_LIMIT,
  autoWriteAngles, clipOverLimit, clipWords, writeAngleScript,
} from './recipesApi';
import type { AngleTone, ScriptClip, WrittenAngle } from './recipesApi';

export interface RecipeBrief {
  /** One line of creative direction a recipe reads. */
  concept: string;
  /** The spoken hook, used as the recipe's prompt when it takes one. */
  prompt: string;
  /** One shot description per clip, for the multi-shot recipe. */
  shots: string[];
}

export interface RecipeAngleScriptProps {
  productName: string;
  productDescription: string;
  /** Fires when the customer presses "Use in the recipe". */
  onApply: (brief: RecipeBrief) => void;
  /** Fires when the applied brief is cleared. */
  onClear: () => void;
  applied: boolean;
}

export const ANGLE_SCRIPT_CSS = `
@keyframes ras-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.ras-rise { animation: ras-rise .34s cubic-bezier(.22,.9,.3,1) both; }
.ras-pick { transition: transform .2s cubic-bezier(.22,.9,.3,1), border-color .2s ease, background-color .2s ease, box-shadow .2s ease; }
.ras-pick:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(0,0,0,.35); }
.ras-pick:active { transform: scale(.985); }
@media (prefers-reduced-motion: reduce) {
  .ras-rise { animation: none !important; }
  .ras-pick { transition: none !important; }
}
`;

/**
 * VISUAL STYLE. Each clip's visual is written from THAT clip's own script
 * line, and the chosen style is appended to it — so the look is consistent
 * across the ad while the subject of every shot stays locked to its own line.
 * Nothing here is reused between clips.
 */
export const VISUAL_STYLES = ['Cinematic', 'Bold', 'Minimal', 'Brand'] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

const STYLE_DIRECTION: Record<VisualStyle, string> = {
  Cinematic: 'Shot cinematically: shallow depth of field, soft motivated key light, warm filmic grade, slow deliberate camera move.',
  Bold: 'Shot boldly: high contrast, saturated colour, punchy hard light, fast confident camera move, graphic framing.',
  Minimal: 'Shot minimally: clean uncluttered frame, even soft light, neutral palette, one subject, still or barely moving camera.',
  Brand: 'Shot as polished brand film: premium studio lighting, controlled reflections, product hero framing, smooth stabilised move.',
};

/** The three states of the pre-step, shown as an animated progress rail. */
const STEPS = [
  { id: 'angle', label: 'Angle' },
  { id: 'script', label: 'Script' },
  { id: 'generate', label: 'Generate' },
] as const;

function StepRail({ stage }: { stage: 0 | 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {STEPS.map((step, index) => {
        const done = index < stage;
        const current = index === stage;
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 700,
              color: done || current ? '#fff' : T.muted,
              background: done ? T.good : current ? T.accent : T.panel,
              border: `1px solid ${done ? T.good : current ? 'transparent' : T.line}`,
              transition: 'background-color .28s ease, color .28s ease, border-color .28s ease',
            }}>
              {done ? <Check size={12} /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />}
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span style={{ width: 24, height: 2, borderRadius: 2, background: done ? T.good : T.line, transition: 'background-color .28s ease' }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function RecipeAngleScript(props: RecipeAngleScriptProps) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState<AngleTone>('Professional');
  const [style, setStyle] = useState<VisualStyle>('Cinematic');
  const [angles, setAngles] = useState<WrittenAngle[]>([]);
  const [chosen, setChosen] = useState<WrittenAngle | null>(null);
  const [clips, setClips] = useState<ScriptClip[]>([]);
  const [anglesBusy, setAnglesBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [error, setError] = useState('');

  const product = [props.productName, props.productDescription].map((part) => String(part || '').trim()).filter(Boolean).join(' - ');
  const ready = product.length > 3;
  const stage: 0 | 1 | 2 = clips.length ? 2 : chosen ? 1 : 0;

  const analyseAngles = async () => {
    if (!ready || anglesBusy) return;
    setAnglesBusy(true);
    setError('');
    try {
      const written = await autoWriteAngles({ product, audience, tone });
      setAngles(written);
      setChosen(null);
      setClips([]);
    } catch (cause: any) {
      setError(String(cause?.message || cause || 'The angles could not be written.'));
    } finally {
      setAnglesBusy(false);
    }
  };

  const writeScript = async (angle: WrittenAngle) => {
    if (scriptBusy) return;
    setScriptBusy(true);
    setError('');
    try {
      setClips(await writeAngleScript({ product, audience, angle }));
    } catch (cause: any) {
      setError(String(cause?.message || cause || 'The script could not be written.'));
    } finally {
      setScriptBusy(false);
    }
  };

  const patchClip = (id: string, line: string) => setClips((current) => current.map((clip) => (clip.id === id ? { ...clip, line } : clip)));

  /** Fold the chosen angle and the written script into the ONE creative brief
   * the recipe reads. The recipe's own prompt builder still sanitises and caps
   * it, so nothing here can push a request past the proxy's limits. */
  const apply = () => {
    if (!chosen) return;
    props.onApply({
      concept: [
        `Ad angle: ${chosen.angle_name}.`,
        chosen.body,
        clips.length ? `Spoken script: ${clips.map((clip) => clip.line).filter(Boolean).join(' ')}` : '',
        `Close on: ${chosen.cta}`,
        `Visual style: ${style}. ${STYLE_DIRECTION[style]}`,
      ].filter(Boolean).join(' '),
      prompt: chosen.hook,
      // One shot per clip, built from THAT clip's own visual line — never a
      // shared or recycled description — with the chosen style appended.
      shots: clips
        .map((clip) => [clip.visual || clip.line, STYLE_DIRECTION[style]].filter(Boolean).join(' '))
        .filter((shot) => shot.trim())
        .slice(0, 6),
    });
  };

  const reset = () => {
    setAngles([]);
    setChosen(null);
    setClips([]);
    setError('');
    props.onClear();
  };

  return (
    <div style={{ ...card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
      <style>{ANGLE_SCRIPT_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 'none', background: 'transparent', color: T.ink, cursor: 'pointer', textAlign: 'left', fontFamily: T.sans }}
      >
        <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 11, background: T.panel, flexShrink: 0 }}>
          <Target size={16} color={T.accent} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700 }}>Angle &amp; script</span>
          <span style={{ display: 'block', marginTop: 3, color: T.muted, fontSize: 12.5 }}>
            {props.applied
              ? `Using “${chosen?.angle_name || 'your angle'}”${clips.length ? ` and a ${clips.length}-clip script` : ''}`
              : 'Optional — analyse ad angles and write the script before the recipe films it. Skip it and generate straight away.'}
          </span>
        </span>
        {props.applied ? <Tag tone="ok">In the brief</Tag> : <Tag>Optional</Tag>}
        <ChevronDown size={17} color={T.muted} style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .3s cubic-bezier(.22,.9,.3,1)' }} />
      </button>

      {open ? (
        <div className="ras-rise" style={{ padding: '0 16px 16px' }}>
          <StepRail stage={stage} />

          {!ready ? (
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, background: T.panel, borderRadius: 12, padding: '14px 16px' }}>
              Tell the recipe below what the product is first — its name and a line about it. The angle writer reads the same brief.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <div>
                  <span style={labelStyle}>Audience</span>
                  <input
                    value={audience}
                    onChange={(event) => setAudience(event.target.value)}
                    placeholder="Who this ad is aimed at"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <span style={labelStyle}>Tone</span>
                  <select value={tone} onChange={(event) => setTone(event.target.value as AngleTone)} style={inputStyle}>
                    {ANGLE_TONES.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <span style={labelStyle}>Visual style</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {VISUAL_STYLES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="ras-pick"
                      onClick={() => setStyle(option)}
                      style={{
                        borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        fontFamily: T.sans,
                        background: style === option ? T.accent : T.panel,
                        color: style === option ? '#fff' : T.soft,
                        border: `1px solid ${style === option ? 'transparent' : T.line}`,
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 7, color: T.muted, fontSize: 12, lineHeight: 1.55 }}>{STYLE_DIRECTION[style]}</div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <Btn kind="primary" disabled={anglesBusy} onClick={() => void analyseAngles()}>
                  {anglesBusy ? <Spin /> : <Sparkles size={14} />}
                  {angles.length ? 'Write new angles' : 'Analyse ad angles'}
                </Btn>
                {angles.length ? <Btn onClick={reset}><X size={13} /> Clear</Btn> : null}
              </div>

              {error ? (
                <div className="ras-rise" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, borderRadius: 12, padding: '12px 14px', background: 'rgba(244,63,94,.1)', border: `1px solid ${T.bad}` }}>
                  <AlertTriangle size={15} color={T.bad} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ minWidth: 0, flex: 1, color: T.soft, fontSize: 13, lineHeight: 1.55 }}>{error}</span>
                  <Btn small kind="primary" onClick={() => void (chosen ? writeScript(chosen) : analyseAngles())}>Retry</Btn>
                </div>
              ) : null}

              {anglesBusy && !angles.length ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  {[0, 1, 2].map((index) => (
                    <div key={index} style={{ height: 74, borderRadius: 12, background: T.panel, opacity: 0.55 }} />
                  ))}
                </div>
              ) : null}

              {angles.length ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                  {angles.map((angle, index) => {
                    const picked = chosen?.id === angle.id;
                    return (
                      <button
                        key={angle.id}
                        type="button"
                        className="ras-pick ras-rise"
                        onClick={() => { setChosen(angle); setClips([]); }}
                        style={{
                          textAlign: 'left', borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                          background: picked ? 'rgba(99,102,241,.1)' : T.panel,
                          border: `1px solid ${picked ? T.accent : T.line}`,
                          color: T.ink, fontFamily: T.sans, animationDelay: `${index * 45}ms`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{angle.angle_name}</span>
                          {picked ? <Tag tone="ok">Chosen</Tag> : null}
                        </div>
                        <div style={{ marginTop: 6, color: T.soft, fontSize: 13, lineHeight: 1.55 }}>“{angle.hook}”</div>
                        <div style={{ marginTop: 5, color: T.muted, fontSize: 12.5, lineHeight: 1.55 }}>{angle.body}</div>
                        <div style={{ marginTop: 5, color: T.muted, fontSize: 12 }}>CTA: {angle.cta}</div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {chosen ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <Btn kind="primary" disabled={scriptBusy} onClick={() => void writeScript(chosen)}>
                    {scriptBusy ? <Spin /> : <PenLine size={14} />}
                    {clips.length ? 'Rewrite the script' : 'Write the script'}
                  </Btn>
                  <Btn disabled={scriptBusy} onClick={apply}><Wand2 size={14} /> Use in the recipe</Btn>
                </div>
              ) : null}

              {clips.length ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                  {clips.map((clip, index) => {
                    const over = clipOverLimit(clip);
                    const limit = CLIP_WORD_LIMIT[clip.durationS] || 22;
                    return (
                      <div key={clip.id} className="ras-rise" style={{ background: T.panel, border: `1px solid ${over ? T.bad : T.line}`, borderRadius: 12, padding: '11px 13px', animationDelay: `${index * 45}ms` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Tag tone="info">{clip.beat}</Tag>
                          <Tag>{clip.durationS}s</Tag>
                          <span style={{ marginLeft: 'auto', color: over ? T.bad : T.muted, fontSize: 11.5, fontWeight: 700 }}>
                            {clipWords(clip.line)}/{limit} words
                          </span>
                        </div>
                        <textarea
                          value={clip.line}
                          onChange={(event) => patchClip(clip.id, event.target.value)}
                          rows={2}
                          aria-label={`Spoken line for ${clip.beat}`}
                          style={{ ...inputStyle, marginTop: 9, resize: 'vertical', lineHeight: 1.55 }}
                        />
                        {clip.visual ? <div style={{ marginTop: 7, color: T.muted, fontSize: 12, lineHeight: 1.55 }}>Visual: {clip.visual}</div> : null}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn kind="primary" onClick={apply}><Wand2 size={14} /> Use this angle and script</Btn>
                    {props.applied ? <Btn onClick={reset}><X size={13} /> Remove from the brief</Btn> : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
