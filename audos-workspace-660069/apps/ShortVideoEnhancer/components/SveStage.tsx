/**
 * Short Video Enhancer — the live preview stage.
 *
 * This draws the SAME picture the Remotion composition will render: the same
 * cue list, the same per-word pop curve, the same highlight/fade states, the
 * same B-roll geometry. Sizes are expressed in design pixels (a 1080-wide
 * stage) and divided by the measured preview width, so what a creator nudges
 * here is exactly what lands in the export.
 *
 * There is deliberately NO plate behind the caption line. Legibility comes
 * from the shadow / outline treatment on each word, and — only if the creator
 * asks for it — a small rounded pill PER WORD at 40% dark.
 *
 * Caption TIERS are drawn here from the same `CAPTION_TIERS` table the
 * Remotion composition mirrors, so a beat line is the same size and cuts on
 * the same frame in both. Four of the five tiers are completely still: only
 * a kinetic line moves, and only its one emphasised word.
 */

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type RefObject } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  DESIGN_W, FILTER_GRADES,
  type BrollClip, type CaptionCue, type CaptionDesign, type EditDoc, type GraphicCard,
} from '../lib/sveTypes';
import { cueAt } from '../lib/sveCaptions';
import { PILL_GAP_RATIO, fitTierSize, tierStyle } from '../lib/sveCaptionTiers';

/** Back-ease overshoot, identical to the composition's popEase. */
function popEase(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.max(0, Math.min(1, t)) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeOut(v: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3);
}

function envelope(t: number, start: number, end: number, ramp = 0.3): number {
  if (t < start || t > end) return 0;
  return Math.min(easeOut((t - start) / ramp), easeOut((end - t) / ramp), 1);
}

export function gradeCss(doc: EditDoc): string {
  const parts: string[] = [];
  const highlights = Math.max(-50, Math.min(50, Number(doc.grade.highlights) || 0));
  const shadows = Math.max(-50, Math.min(50, Number(doc.grade.shadows) || 0));
  const temperature = Math.max(-50, Math.min(50, Number(doc.grade.temperature) || 0));
  const tint = Math.max(-50, Math.min(50, Number(doc.grade.tint) || 0));
  if (doc.grade.brightness) parts.push('brightness(' + (1 + doc.grade.brightness / 200).toFixed(3) + ')');
  if (doc.grade.contrast) parts.push('contrast(' + (1 + doc.grade.contrast / 150).toFixed(3) + ')');
  if (doc.grade.saturation) parts.push('saturate(' + (1 + doc.grade.saturation / 150).toFixed(3) + ')');
  if (highlights) {
    parts.push('brightness(' + (1 + highlights / 500).toFixed(3) + ')');
    parts.push('contrast(' + (1 + highlights / 250).toFixed(3) + ')');
  }
  if (shadows) {
    parts.push('brightness(' + (1 + shadows / 250).toFixed(3) + ')');
    parts.push('contrast(' + (1 - shadows / 500).toFixed(3) + ')');
  }
  const chromaMix = Math.min(0.35, (Math.abs(temperature) + Math.abs(tint)) * 0.0035);
  const hue = temperature * -0.24 + tint * 0.36;
  if (chromaMix > 0.0001) parts.push('sepia(' + chromaMix.toFixed(3) + ')');
  if (Math.abs(hue) > 0.001) parts.push('hue-rotate(' + hue.toFixed(2) + 'deg)');
  const preset = FILTER_GRADES[doc.grade.filter];
  if (preset && preset.css !== 'none') parts.push(preset.css);
  return parts.length ? parts.join(' ') : 'none';
}

function CaptionTrack({ cue, design, t, size, scale }: {
  cue: CaptionCue; design: CaptionDesign; t: number; size: number; scale: number;
}) {
  const tier = tierStyle(cue.tier);

  // Every tier draws the WHOLE line from the moment the cue opens. `size` is
  // fitted for ordinary dialogue; a big tier takes its multiple of it, capped
  // so this particular line still clears the safe margins.
  const line = cue.words.map((w) => (design.uppercase ? w.text.toUpperCase() : w.text)).join(' ');
  const px = fitTierSize(size, tier, line.length) * scale;
  const pill = design.preset === 'boxed' || design.pill;
  const outline = Math.max(1, px * 0.055);

  // The block's own entrance and exit. The entrance carries both the fade and
  // the scale, and `tailS` of 0 is the beat tier cutting on the frame rather
  // than fading, which is what gives it its impact.
  const age = Math.max(0, t - cue.start);
  const enter = tier.enterS > 0 ? easeOut(age / tier.enterS) : 1;
  const out = tier.tailS > 0
    ? easeOut((cue.end + tier.tailS - t) / tier.tailS)
    : (t <= cue.end ? 1 : 0);
  // Cinematic and beat lines pull toward the middle of the frame; everything
  // else sits exactly where the creator put the caption block.
  const posY = design.posY + (0.5 - design.posY) * tier.centre;
  // A pill already pads each word, so the between-word gap tightens to match
  // the spacing the pill stylesheet has always used.
  const gapEm = (pill ? tier.gap * PILL_GAP_RATIO : tier.gap).toFixed(3);

  return (
    <div
      className={'sve-caption-track tier-' + (cue.tier || 'clean')}
      style={{
        top: posY * 100 + '%',
        fontSize: px,
        opacity: Math.max(0, Math.min(1, Math.min(enter, out))),
        transform: 'translateY(-50%) translateY(' + (tier.enterRise * (1 - enter)).toFixed(3) + 'em) scale('
          + (tier.enterScale + (1 - tier.enterScale) * enter).toFixed(4) + ')',
      }}
    >
      {cue.words.map((word, i) => {
        // The UI tier walks its tokens in one at a time, timeline-style.
        const appear = tier.stagger > 0 ? easeOut((age - i * tier.stagger) / 0.18) : 1;
        if (appear <= 0) return null;
        // THE ONLY PER-WORD MOTION IN THE SYSTEM: a kinetic line's key word
        // grows as it is spoken. Every other word on every other tier is
        // completely still, which is what keeps the edit from reading as a
        // wall of moving type.
        const popping = tier.pop > 0 && !!word.emphasis;
        const p = popping && tier.popS > 0
          ? Math.max(0, Math.min(1, (t - word.start) / tier.popS))
          : 0;
        const wordScale = popping ? 1 + tier.pop * popEase(p) : 1;
        const text = design.uppercase ? word.text.toUpperCase() : word.text;
        // White is the base; the Vidverge accent is reserved for the words the
        // tier marked as the emphasis moment.
        const highlight = word.emphasis ? design.accent : design.color;

        const style: CSSProperties = {
          fontSize: px,
          fontWeight: tier.weight,
          letterSpacing: tier.tracking.toFixed(4) + 'em',
          margin: '0 ' + gapEm + 'em',
          fontVariantNumeric: tier.tabular ? 'tabular-nums' : undefined,
          transform: 'translateX(' + (-tier.slide * (1 - appear)).toFixed(3) + 'em) scale('
            + wordScale.toFixed(3) + ')',
          opacity: appear,
        };

        if (design.preset === 'gradient') {
          style.backgroundImage = word.emphasis
            ? 'linear-gradient(180deg,' + design.accent + ' 0%,' + design.accent + ' 100%)'
            : 'linear-gradient(180deg,' + design.color + ' 8%,' + design.accent + ' 100%)';
          style.WebkitBackgroundClip = 'text';
          style.backgroundClip = 'text';
          style.color = 'transparent';
          style.filter = 'drop-shadow(0 ' + (px * 0.05).toFixed(1) + 'px ' + (px * 0.08).toFixed(1) + 'px rgba(0,0,0,.6))';
        } else if (design.preset === 'outline') {
          const d = (outline * 0.7071).toFixed(1);
          style.color = highlight;
          style.textShadow = [
            outline + 'px 0 0 #07070C', -outline + 'px 0 0 #07070C',
            '0 ' + outline + 'px 0 #07070C', '0 ' + -outline + 'px 0 #07070C',
            d + 'px ' + d + 'px 0 #07070C', '-' + d + 'px ' + d + 'px 0 #07070C',
            d + 'px -' + d + 'px 0 #07070C', '-' + d + 'px -' + d + 'px 0 #07070C',
          ].join(',');
        } else {
          style.color = highlight;
          style.textShadow = '0 ' + (px * 0.055).toFixed(1) + 'px ' + (px * 0.1).toFixed(1) + 'px rgba(0,0,0,.72)';
        }

        return (
          <span
            key={cue.id + '-' + i}
            className={'sve-cap-word' + (pill ? ' pill' : '')}
            style={style}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

function CardView({ card, t, scale }: { card: GraphicCard; t: number; scale: number }) {
  const a = envelope(t, card.start, card.end, 0.32);
  if (a <= 0.01) return null;

  if (card.kind === 'lower') {
    return (
      <div className="sve-pv-lower" style={{ opacity: a, transform: 'translateX(' + (-(1 - a) * 18).toFixed(1) + 'px)' }}>
        <i style={{ background: card.color, boxShadow: '0 0 12px ' + card.color }} />
        <div>
          <strong style={{ fontSize: Math.max(9, 56 * scale) }}>{card.title}</strong>
          {card.subtitle ? <small style={{ color: card.color, fontSize: Math.max(7, 34 * scale) }}>{card.subtitle}</small> : null}
        </div>
      </div>
    );
  }

  const isCta = card.kind === 'cta';
  return (
    <div className="sve-pv-card" style={{ top: (isCta ? 38 : 20) + '%', opacity: a, transform: 'translateY(' + ((1 - a) * 12).toFixed(1) + 'px)' }}>
      <div
        className="body"
        style={{
          background: isCta ? 'linear-gradient(135deg,' + card.color + ',' + card.color + 'B8)' : 'rgba(8,8,14,.5)',
          border: isCta ? 'none' : '1px solid ' + card.color + '8C',
        }}
      >
        <strong style={{ fontSize: Math.max(10, (isCta ? 84 : 76) * scale) }}>{card.title}</strong>
        {card.subtitle ? (
          <small style={{ color: isCta ? 'rgba(255,255,255,.92)' : card.color, fontSize: Math.max(7, 40 * scale) }}>{card.subtitle}</small>
        ) : null}
      </div>
    </div>
  );
}

function BrollView({ clip, t }: { clip: BrollClip; t: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const visible = t >= clip.start && t <= clip.end;

  // The preview keeps the overlay's own playhead in step with the main one,
  // so a corner PiP shows the same moment it will show in the export.
  useEffect(() => {
    const node = ref.current;
    if (!node || !visible) return;
    const want = Math.max(0, t - clip.start);
    if (Number.isFinite(node.duration) && Math.abs(node.currentTime - want) > 0.26) {
      try { node.currentTime = Math.min(want, Math.max(0, (node.duration || want) - 0.05)); } catch { /* seeking a stream */ }
    }
  }, [t, visible, clip.start]);

  if (!visible) return null;
  const a = envelope(t, clip.start, clip.end, 0.3);
  const opacity = clip.layout === 'blend' ? a * clip.opacity : a;
  return (
    <div className={'sve-pv-broll ' + clip.layout} style={{ opacity }}>
      {/* No crossOrigin: these pixels are never read back, and asking for CORS
          would stop an overlay whose storage does not send those headers from
          playing at all. */}
      <video ref={ref} src={clip.url} muted playsInline preload="auto" />
    </div>
  );
}

export interface StageProps {
  doc: EditDoc;
  cues: CaptionCue[];
  captionSize: number;
  currentTime: number;
  previewUrl: string;
  loading: boolean;
  loadingLabel: string;
  showSafeArea: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onPlay: () => void;
  onPause: () => void;
}

export function SveStage(props: StageProps) {
  const { doc, cues, captionSize, currentTime, previewUrl, loading } = props;
  const shellRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(360);
  const [dragging, setDragging] = useState(false);

  // Design pixels -> preview pixels. Measured, not assumed, so the caption
  // size a creator picks reads the same here as in the 1080-wide render.
  useEffect(() => {
    const node = shellRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width) setStageWidth(width);
    });
    observer.observe(node);
    setStageWidth(node.getBoundingClientRect().width || 360);
    return () => observer.disconnect();
  }, []);

  const scale = stageWidth / DESIGN_W;
  const cue = doc.captionsEnabled ? cueAt(cues, currentTime) : null;

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) props.onDropFile(file);
  };

  return (
    <div
      ref={shellRef}
      className={'sve-phone ' + (dragging ? 'dragging' : '')}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {previewUrl ? (
        <video
          ref={props.videoRef}
          src={previewUrl}
          playsInline
          preload="auto"
          style={{ filter: gradeCss(doc) }}
          onLoadedMetadata={props.onLoadedMetadata}
          onTimeUpdate={props.onTimeUpdate}
          onPlay={props.onPlay}
          onPause={props.onPause}
        />
      ) : loading ? null : (
        <button className="sve-empty" onClick={props.onPickFile}>
          <span className="sve-upload-orb"><Upload size={25} /></span>
          <strong>Drop your short video here</strong>
          <small>or</small>
          <span className="sve-browse">Browse Files</span>
          <em>MP4 · MOV · WEBM · AVI</em>
        </button>
      )}

      {loading && (
        <div className="sve-stage-skeleton sve-skeleton">
          <Loader2 size={22} className="spin" />
          {props.loadingLabel || 'Loading your clip…'}
        </div>
      )}

      {previewUrl && !loading && (
        <>
          {doc.broll.map((clip) => <BrollView key={clip.id} clip={clip} t={currentTime} />)}
          {doc.cards.map((card) => <CardView key={card.id} card={card} t={currentTime} scale={scale} />)}
          {cue && <CaptionTrack cue={cue} design={doc.caption} t={currentTime} size={captionSize} scale={scale} />}
          {doc.captionsEnabled && !cue && cues.length === 0 && (
            <div className="sve-cap-empty">No captions yet — run Generate Captions</div>
          )}
          <div className={'sve-safe-area ' + (props.showSafeArea ? '' : 'hidden')} />
        </>
      )}
    </div>
  );
}

