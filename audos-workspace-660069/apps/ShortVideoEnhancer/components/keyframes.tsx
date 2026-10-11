/**
 * Short Video Enhancer — the KEYFRAME EDITOR.
 *
 * Every motion-graphic channel can be driven either by its simple from/to ramp
 * or by a keyframe curve. This panel is where a curve is built: add a keyframe
 * at any timestamp, set its value and the easing it leaves on, and watch the
 * little graph redraw.
 *
 * The graph is not an illustration. It samples the SAME interpolation the motion
 * engine runs (lib/model.ts's sampleKeyframes / keyEase, mirrored in
 * lib/motionSource.ts), so the curve you see is the motion you get, and
 * scrubbing the playhead moves the marker along the real path.
 *
 * Keyframes copy and paste between layers. A pasted track is re-timed into the
 * target layer's own window rather than pasted at absolute seconds, because an
 * absolute paste onto a shorter layer would land entirely outside its life.
 */

import { useMemo } from 'react';
import { ClipboardPaste, Copy, Plus, Trash2 } from 'lucide-react';
import {
  KEY_CHANNELS, KEY_EASINGS,
  clamp, formatTime, keyChannelSpec, newKeyframe, round3,
  sampleKeyframeColor, sampleKeyframes, sortKeyframes, uid,
  type GraphicLayer, type KeyChannel, type KeyEasingId, type Keyframe, type Ramp,
} from '../lib/model';
import { Empty, MONO, P, Pill } from './controls';

/** One copied channel, waiting to be pasted onto another layer. */
export interface KeyframeClipboard {
  channel: KeyChannel;
  keys: Keyframe[];
  /** The source layer's life, so the paste can be re-timed proportionally. */
  span: number;
  sourceLabel: string;
}

/**
 * The value a channel already has at `at`, used to seed its first keyframe so
 * adding one never makes the layer jump. This reads the ramp linearly; once a
 * curve exists the curve is authoritative and this is no longer consulted.
 */
export function channelBaseValue(g: GraphicLayer, channel: KeyChannel, at: number): number {
  const span = Math.max(0.1, g.end - g.start);
  const life = clamp((at - g.start) / span, 0, 1);
  const ramp = (r: Ramp) => r.from + (r.to - r.from) * life;
  if (channel === 'x') return Math.round(g.x + ramp(g.dx));
  if (channel === 'y') return Math.round(g.y + ramp(g.dy));
  if (channel === 'scaleX' || channel === 'scaleY') return round3(ramp(g.scale));
  if (channel === 'rotation') return Math.round(ramp(g.rotation));
  if (channel === 'opacity') return round3(ramp(g.opacity));
  if (channel === 'blur') return round3(ramp(g.blur));
  return 0;
}

const GRAPH_H = 54;
const SAMPLES = 56;

function ChannelGraph({ g, channel, keys, playhead }: {
  g: GraphicLayer; channel: KeyChannel; keys: Keyframe[]; playhead: number;
}) {
  const spec = keyChannelSpec(channel);
  const span = Math.max(0.1, g.end - g.start);

  const path = useMemo(() => {
    if (spec.color) return '';
    const values: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      values.push(sampleKeyframes(keys, g.start + (span * i) / SAMPLES, 0));
    }
    let lo = values[0];
    let hi = values[0];
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = Math.max(0.0001, (hi - lo) * 0.15 || Math.abs(hi) * 0.15 || 1);
    const min = lo - pad;
    const range = Math.max(0.0001, hi + pad - min);
    return values
      .map((v, i) => {
        const x = (i / SAMPLES) * 100;
        const y = GRAPH_H - ((v - min) / range) * GRAPH_H;
        return (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2);
      })
      .join(' ');
  }, [keys, g.start, span, spec.color]);

  const headAt = clamp((playhead - g.start) / span, 0, 1) * 100;

  if (spec.color) {
    // A colour curve has no numeric axis — the honest graph is the gradient the
    // interpolation actually produces, sampled across the layer's life.
    const stops: string[] = [];
    for (let i = 0; i <= 12; i++) {
      stops.push(sampleKeyframeColor(keys, g.start + (span * i) / 12, g.color) + ' ' + Math.round((i / 12) * 100) + '%');
    }
    return (
      <div style={{ position: 'relative', height: 26, borderRadius: 7, border: '1px solid ' + P.border, background: 'linear-gradient(90deg,' + stops.join(',') + ')' }}>
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: headAt + '%', width: 2, background: '#FFFFFF', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: GRAPH_H, borderRadius: 7, border: '1px solid ' + P.border, background: P.panelSoft, overflow: 'hidden' }}>
      <svg viewBox={'0 0 100 ' + GRAPH_H} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <path d={path} stroke={P.accent} strokeWidth={1.4} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      {sortKeyframes(keys).map((k) => {
        const x = clamp((k.t - g.start) / span, 0, 1) * 100;
        return (
          <div key={k.id} title={formatTime(k.t) + ' → ' + k.v}
            style={{
              position: 'absolute', left: x + '%', top: '50%', width: 7, height: 7,
              marginLeft: -3.5, marginTop: -3.5, borderRadius: 2,
              background: P.accent, border: '1px solid ' + P.bg,
            }} />
        );
      })}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: headAt + '%', width: 1, background: 'rgba(120,80,0,0.45)' }} />
    </div>
  );
}

function ChannelRow({ g, channel, playhead, onChange, onSeek, clipboard, onCopy }: {
  g: GraphicLayer; channel: KeyChannel; playhead: number;
  onChange: (patch: Partial<GraphicLayer>) => void;
  onSeek: (s: number) => void;
  clipboard: KeyframeClipboard | null;
  onCopy: (c: KeyframeClipboard) => void;
}) {
  const spec = keyChannelSpec(channel);
  const keys = g.keys[channel] || [];
  const span = Math.max(0.1, g.end - g.start);
  const at = clamp(playhead, g.start, g.end);

  const write = (nextKeys: Keyframe[]) => {
    const tracks = { ...g.keys };
    if (nextKeys.length) tracks[channel] = sortKeyframes(nextKeys);
    else delete tracks[channel];
    onChange({ keys: tracks });
  };

  const addHere = () => {
    if (keys.some((k) => Math.abs(k.t - at) < 0.02)) return;
    const value = spec.color
      ? 0
      : clamp(keys.length ? sampleKeyframes(keys, at, 0) : channelBaseValue(g, channel, at), spec.min, spec.max);
    const colour = spec.color ? sampleKeyframeColor(keys, at, g.color) : g.color;
    write([...keys, newKeyframe(at, value, colour)]);
  };

  const pasteHere = () => {
    if (!clipboard || !clipboard.keys.length) return;
    const sorted = sortKeyframes(clipboard.keys);
    const sourceSpan = Math.max(0.1, clipboard.span);
    const tracks = { ...g.keys };
    tracks[clipboard.channel] = sortKeyframes(sorted.map((k, i) => ({
      ...k,
      id: uid('kf') + '-' + i,
      t: round3(g.start + ((k.t - sorted[0].t) / sourceSpan) * span),
    })));
    onChange({ keys: tracks });
  };

  const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 } as const;

  return (
    <div style={{ background: P.card, border: '1px solid ' + P.border, borderRadius: 10, padding: 9, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        <span style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: keys.length ? P.text : P.muted }}>{spec.label}</span>
        {keys.length
          ? <Pill color={P.accent}>{keys.length} key{keys.length === 1 ? '' : 's'}</Pill>
          : <span style={{ fontSize: 10, color: P.muted, fontFamily: MONO }}>ramp</span>}
        <button title="Add a keyframe at the playhead" onClick={addHere} style={{ ...iconBtn, color: P.sub }}><Plus size={13} /></button>
        {keys.length ? (
          <button title="Copy this channel’s keyframes" style={{ ...iconBtn, color: P.sub }}
            onClick={() => onCopy({ channel, keys, span, sourceLabel: g.type + ' · ' + spec.label })}><Copy size={12} /></button>
        ) : null}
        {clipboard && clipboard.channel === channel ? (
          <button title={'Paste ' + clipboard.keys.length + ' keyframe(s) from ' + clipboard.sourceLabel}
            onClick={pasteHere} style={{ ...iconBtn, color: P.accent }}><ClipboardPaste size={12} /></button>
        ) : null}
        {keys.length ? (
          <button title="Clear this channel — it goes back to its ramp" onClick={() => write([])}
            style={{ ...iconBtn, color: P.muted }}><Trash2 size={12} /></button>
        ) : null}
      </div>

      {keys.length ? (
        <>
          <ChannelGraph g={g} channel={channel} keys={keys} playhead={playhead} />
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortKeyframes(keys).map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button title="Jump the playhead here" onClick={() => onSeek(k.t)}
                  style={{ background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.sub, fontSize: 10, fontFamily: MONO, padding: '3px 5px', cursor: 'pointer', width: 54 }}>
                  {k.t.toFixed(2)}s
                </button>
                {spec.color ? (
                  <input type="color" value={k.c} onChange={(e) => write(keys.map((x) => (x.id === k.id ? { ...x, c: e.target.value } : x)))}
                    style={{ width: 34, height: 24, border: '1px solid ' + P.border, borderRadius: 6, background: P.card, padding: 1, cursor: 'pointer' }} />
                ) : (
                  <input type="number" value={k.v} min={spec.min} max={spec.max} step={spec.step}
                    onChange={(e) => write(keys.map((x) => (x.id === k.id ? { ...x, v: clamp(Number(e.target.value), spec.min, spec.max) } : x)))}
                    style={{ flex: 1, minWidth: 0, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.text, fontSize: 11, fontFamily: MONO, padding: '3px 5px' }} />
                )}
                <select value={k.easing} title="Easing out of this keyframe"
                  onChange={(e) => write(keys.map((x) => (x.id === k.id ? { ...x, easing: e.target.value as KeyEasingId } : x)))}
                  style={{ background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.text, fontSize: 10.5, padding: '3px 4px', maxWidth: 92 }}>
                  {KEY_EASINGS.map((eas) => <option key={eas.id} value={eas.id}>{eas.label}</option>)}
                </select>
                <button title="Delete this keyframe" onClick={() => write(keys.filter((x) => x.id !== k.id))}
                  style={{ ...iconBtn, color: P.muted }}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function KeyframePanel({ g, playhead, onChange, onSeek, clipboard, onCopy }: {
  g: GraphicLayer; playhead: number;
  onChange: (patch: Partial<GraphicLayer>) => void;
  onSeek: (s: number) => void;
  clipboard: KeyframeClipboard | null;
  onCopy: (c: KeyframeClipboard) => void;
}) {
  const keyed = KEY_CHANNELS.filter((c) => (g.keys[c.id] || []).length).length;
  const outside = playhead < g.start - 0.001 || playhead > g.end + 0.001;
  return (
    <div>
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 9 }}>
        A channel with keyframes ignores its ramp and follows the curve exactly — including the reveal fades, if you keyframe
        opacity. Clear a channel to hand it back to the ramp.{' '}
        {keyed ? keyed + ' of ' + KEY_CHANNELS.length + ' channels are keyframed.' : 'Nothing is keyframed yet.'}
      </div>
      {outside ? (
        <Empty>
          The playhead is outside this layer ({formatTime(g.start)} → {formatTime(g.end)}), so a new keyframe lands on the
          nearest end. Scrub inside the layer to place one exactly.
        </Empty>
      ) : null}
      {KEY_CHANNELS.map((c) => (
        <ChannelRow key={c.id} g={g} channel={c.id} playhead={playhead}
          onChange={onChange} onSeek={onSeek} clipboard={clipboard} onCopy={onCopy} />
      ))}
      {clipboard ? (
        <div style={{ fontSize: 10.5, color: P.muted, lineHeight: 1.5 }}>
          Clipboard: {clipboard.keys.length} keyframe(s) from {clipboard.sourceLabel}. Paste shows up on the matching channel and
          is re-timed into this layer’s own window.
        </div>
      ) : null}
    </div>
  );
}
