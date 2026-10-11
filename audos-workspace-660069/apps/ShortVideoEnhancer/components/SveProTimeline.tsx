/**
 * Short Video Enhancer — the five-track timeline.
 *
 * A short is one clip with layers on top of it, so the tracks are VIDEO,
 * AUDIO, CAPTIONS, CARDS and B-ROLL rather than a sequence of shots. Captions
 * are a first-class track here (they are the format's main device, not an
 * optional extra) and the beat grid is drawn across every lane once the tempo
 * has been measured, because on a short almost every edit decision is "does
 * this land on the beat".
 *
 * Nothing in here holds its own copy of the edit: every block is a window onto
 * the EditDoc, and every drag writes straight back into it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AudioLines, Captions, ChevronDown, ChevronUp, Copy, Diamond, Film, Minus,
  Plus, Sparkles, Trash2, Type as TypeIcon,
} from 'lucide-react';
import type { BrollClip, CaptionCue, EditDoc, GraphicCard } from '../lib/sveTypes';
import { TIER_COLORS, TIER_LABELS } from '../lib/sveCaptionTiers';
import { PRO, timecode } from '../lib/sveProUi';

const BASE_PX_PER_SEC = 60;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

type Block = { kind: 'card'; id: string } | { kind: 'broll'; id: string };
type Menu = { x: number; y: number; block: Block } | null;

export interface SveTimelineProps {
  doc: EditDoc;
  cues: CaptionCue[];
  currentTime: number;
  zoom: number;
  collapsed: boolean;
  selectedCardId: string | null;
  selectedBrollId: string | null;
  onZoom: (z: number) => void;
  onCollapse: (v: boolean) => void;
  /**
   * Height drag from the grip on the top edge. `persist` is true once on
   * release so the host can save it; a height of 0 asks for the natural
   * (auto) height again.
   */
  onResize?: (height: number, persist: boolean) => void;
  onSeek: (t: number) => void;
  onSelectCard: (id: string | null) => void;
  onSelectBroll: (id: string | null) => void;
  onMoveCard: (id: string, start: number, end: number) => void;
  onMoveBroll: (id: string, start: number, end: number) => void;
  onDeleteCard: (id: string) => void;
  onDeleteBroll: (id: string) => void;
  onDuplicateCard: (id: string) => void;
  onSnapToBeat: (block: Block) => void;
  onToggleKeyframe: () => void;
}

const CARD_FILL: Record<GraphicCard['kind'], string> = {
  hook: 'linear-gradient(180deg,#B45309,#92400E)',
  cta: 'linear-gradient(180deg,#C2410C,#9A3412)',
  lower: 'linear-gradient(180deg,#A16207,#854D0E)',
};

export default function SveProTimeline(props: SveTimelineProps) {
  const { doc, cues, currentTime, zoom, collapsed } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);

  const duration = Math.max(1, doc.durationS);
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const width = Math.max(320, duration * pxPerSec);

  const tickStep = useMemo(() => {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    return steps.find((s) => s * pxPerSec >= 56) || 120;
  }, [pxPerSec]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += tickStep) out.push(Number(t.toFixed(3)));
    return out;
  }, [duration, tickStep]);

  /** Beat lines, capped so a long clip at high zoom cannot draw thousands. */
  const beats = useMemo(() => {
    if (!doc.bpm) return [];
    const period = 60 / doc.bpm;
    const count = Math.floor(duration / period);
    if (count > 400) return [];
    const out: number[] = [];
    for (let i = 0; i <= count; i += 1) out.push(i * period);
    return out;
  }, [doc.bpm, duration]);

  const timeAt = useCallback((clientX: number): number => {
    const node = laneRef.current;
    if (!node) return 0;
    const box = node.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left) / pxPerSec));
  }, [duration, pxPerSec]);

  const scrub = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    props.onSeek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => props.onSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [props, timeAt]);

  // ---- height drag (the grip along the top edge) ---------------------------
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const onResize = props.onResize;
    const root = rootRef.current;
    if (e.button !== 0 || !onResize || !root) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    const startY = e.clientY;
    const startH = root.getBoundingClientRect().height;
    const clamp = (h: number) => Math.round(Math.max(80, Math.min(window.innerHeight * 0.5, h)));
    let latest = clamp(startH);
    const move = (ev: PointerEvent) => {
      // Dragging up (smaller clientY) makes the timeline taller.
      latest = clamp(startH + (startY - ev.clientY));
      onResize(latest, false);
    };
    const up = () => {
      setResizing(false);
      onResize(latest, true);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [props]);

  /** Shared drag for a card or a B-roll window: move the body, trim the edges. */
  const startDrag = useCallback((
    e: React.PointerEvent,
    block: Block,
    start: number,
    end: number,
    mode: 'move' | 'in' | 'out',
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const originX = e.clientX;
    const apply = block.kind === 'card' ? props.onMoveCard : props.onMoveBroll;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - originX) / pxPerSec;
      if (mode === 'move') {
        const span = end - start;
        const nextStart = Math.max(0, Math.min(duration - span, start + delta));
        apply(block.id, Number(nextStart.toFixed(2)), Number((nextStart + span).toFixed(2)));
      } else if (mode === 'in') {
        apply(block.id, Number(Math.max(0, Math.min(end - 0.3, start + delta)).toFixed(2)), end);
      } else {
        apply(block.id, start, Number(Math.min(duration, Math.max(start + 0.3, end + delta)).toFixed(2)));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [duration, props, pxPerSec]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = zoom * (e.deltaY > 0 ? 0.88 : 1.14);
      props.onZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(next.toFixed(3)))));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [props, zoom]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const x = currentTime * pxPerSec;
    if (x < node.scrollLeft + 40) node.scrollLeft = Math.max(0, x - 80);
    else if (x > node.scrollLeft + node.clientWidth - 60) node.scrollLeft = x - node.clientWidth + 120;
  }, [currentTime, pxPerSec]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const span = (start: number, end: number): CSSProperties => ({
    left: `${start * pxPerSec}px`,
    width: `${Math.max(4, (end - start) * pxPerSec)}px`,
  });

  const head = (
    <div className="vp-tlbar">
      <button
        type="button"
        className="vp-btn xs ghost"
        onClick={() => props.onCollapse(!collapsed)}
        title={collapsed ? 'Show the timeline' : 'Hide the timeline'}
      >
        {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Timeline
      </button>
      <span className="vp-mono" style={{ fontSize: 11.5, color: '#1A1000', fontWeight: 700 }}>{timecode(currentTime)}</span>
      <span className="vp-mono" style={{ fontSize: 10.5, color: PRO.text3 }}>/ {timecode(duration)}</span>
      {doc.bpm ? (
        <span className="vp-badge run" title="Measured tempo">{Math.round(doc.bpm)} BPM</span>
      ) : null}
      <span className="vp-spread" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          className="vp-ico sm"
          title="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => props.onZoom(Math.max(ZOOM_MIN, Number((zoom / 1.5).toFixed(3))))}
        >
          <Minus size={12} />
        </button>
        <span className="vp-mono" style={{ fontSize: 10.5, color: PRO.text2, minWidth: 38, textAlign: 'center' }}>
          {zoom.toFixed(2)}x
        </span>
        <button
          type="button"
          className="vp-ico sm"
          title="Zoom in (or Ctrl + scroll over the timeline)"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => props.onZoom(Math.min(ZOOM_MAX, Number((zoom * 1.5).toFixed(3))))}
        >
          <Plus size={12} />
        </button>
        <span className="vp-divider" />
        <button type="button" className="vp-btn xs" onClick={props.onToggleKeyframe} title="Add or remove a camera keyframe here (K)">
          <Diamond size={11} /> Key
        </button>
      </span>
    </div>
  );

  if (collapsed) return <div className="vp-tl" ref={rootRef}>{head}</div>;

  const menuBlock = menu?.block || null;

  const grip = props.onResize ? (
    <div
      className="vp-tl-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the timeline"
      title="Drag to resize the timeline · double-click to reset"
      data-dragging={resizing ? 'true' : 'false'}
      onPointerDown={startResize}
      onDoubleClick={() => props.onResize?.(0, true)}
    />
  ) : null;

  return (
    <div className="vp-tl" ref={rootRef}>
      {grip}
      {head}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
          <div className="vp-trkhead" style={{ height: 22, justifyContent: 'center' }}>
            <b style={{ fontSize: 8.5 }}>Tracks</b>
          </div>
          {[
            { label: 'Video', Icon: Film, color: PRO.track.video },
            { label: 'Audio', Icon: AudioLines, color: PRO.track.audio },
            { label: 'Captions', Icon: Captions, color: PRO.track.caption },
            { label: 'Cards', Icon: TypeIcon, color: PRO.track.text },
            { label: 'B-roll', Icon: Sparkles, color: PRO.track.fx },
          ].map((t) => (
            <div key={t.label} className="vp-trkhead" style={{ height: 34 }}>
              <b><t.Icon size={10} color={t.color} /> {t.label}</b>
            </div>
          ))}
        </div>

        <div className="vp-tlwrap" ref={scrollRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div className="vp-tlgrid" ref={laneRef} style={{ width }}>
            <div className="vp-ruler" onPointerDown={scrub}>
              {ticks.map((t) => (
                <span key={t} style={{ left: `${t * pxPerSec}px` }}>{timecode(t).slice(0, 5)}</span>
              ))}
            </div>

            {/* VIDEO */}
            <div className="vp-trk" style={{ height: 34 }} onPointerDown={scrub}>
              <div
                className="vp-clip"
                style={{ ...span(0, duration), background: 'linear-gradient(180deg,#2F63B8,#1E4080)', cursor: 'default' }}
                title={doc.sourceName || 'Source clip'}
              >
                <span className="vp-cliplab">{doc.sourceName || 'Source clip'}</span>
              </div>
              {doc.keyframes.map((k, i) => (
                <span
                  key={`k-${i}`}
                  className="vp-key"
                  title={`Keyframe at ${timecode(k.t)} · scale ${k.scale.toFixed(2)}x · opacity ${Math.round(k.opacity * 100)}%`}
                  style={{ left: `${k.t * pxPerSec}px` }}
                />
              ))}
            </div>

            {/* AUDIO */}
            <div className="vp-trk" style={{ height: 34 }} onPointerDown={scrub}>
              <div
                className="vp-clip"
                style={{
                  ...span(0, duration),
                  background: doc.audio.original > 0
                    ? 'linear-gradient(180deg,#0F6F52,#0A4B38)'
                    : 'repeating-linear-gradient(45deg,rgba(180,120,0,0.10),rgba(180,120,0,0.10) 5px,rgba(180,120,0,0.18) 5px,rgba(180,120,0,0.18) 10px)',
                  cursor: 'default',
                }}
                title={`Original audio at ${doc.audio.original}%`}
              >
                <span className="vp-cliplab">Original {doc.audio.original}%</span>
              </div>
              {doc.music.url ? (
                <div
                  className="vp-clip"
                  style={{ ...span(0, duration), top: 'auto', bottom: 2, height: 10, background: 'linear-gradient(90deg,#C8920A,#E8B737)', cursor: 'default' }}
                  title={`Music bed at ${doc.audio.music}%`}
                >
                  {doc.music.peaks.length ? (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        padding: '0 1px',
                        overflow: 'hidden',
                      }}
                    >
                      {doc.music.peaks.slice(0, 220).map((peak, i) => (
                        <i
                          key={`pk-${i}`}
                          style={{
                            flex: '1 1 0',
                            height: `${Math.max(8, Math.min(100, peak * 100))}%`,
                            background: 'rgba(255,255,255,0.5)',
                            borderRadius: 1,
                          }}
                        />
                      ))}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {doc.silences.map((s, i) => (
                <span
                  key={`sil-${i}`}
                  title={`Silence · ${(s.end - s.start).toFixed(1)}s`}
                  style={{
                    position: 'absolute',
                    top: 4,
                    bottom: 14,
                    ...span(s.start, s.end),
                    background: 'rgba(26,16,0,0.35)',
                    border: '1px dashed rgba(255,255,255,0.3)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              ))}
            </div>

            {/* CAPTIONS — always a primary track on a short. Each block is
                tinted with its own caption tier, so the 70/20/10 mix is
                readable straight off the timeline. */}
            <div className="vp-trk" style={{ height: 34 }} onPointerDown={scrub}>
              {cues.length ? cues.map((cue) => {
                const tint = TIER_COLORS[cue.tier || 'clean'];
                return (
                <div
                  key={cue.id}
                  className="vp-clip"
                  style={{
                    ...span(cue.start, cue.end),
                    background: doc.captionsEnabled
                      ? 'linear-gradient(180deg,' + tint + ',color-mix(in srgb,' + tint + ' 52%,#0B0B0B))'
                      : 'repeating-linear-gradient(45deg,rgba(180,120,0,0.10),rgba(180,120,0,0.10) 5px,rgba(180,120,0,0.18) 5px,rgba(180,120,0,0.18) 10px)',
                  }}
                  title={TIER_LABELS[cue.tier || 'clean'] + ' \u00b7 ' + cue.words.map((w) => w.text).join(' ')}
                  onClick={() => props.onSeek(cue.start + 0.01)}
                >
                  <span className="vp-cliplab">{cue.words.map((w) => w.text).join(' ')}</span>
                </div>
                );
              }) : (
                <span
                  // Sticky, not absolute: the lane scroller follows the playhead, and an
                  // absolute label scrolls away with it and shows up cut off on the left.
                  style={{ position: 'sticky', left: 8, display: 'inline-block', marginLeft: 8, lineHeight: '34px', fontSize: 10.5, color: '#7A6030', whiteSpace: 'nowrap', pointerEvents: 'none' }}
                >
                  No captions yet — generate them in the Text tab
                </span>
              )}
            </div>

            {/* CARDS */}
            <div className="vp-trk" style={{ height: 34 }} onPointerDown={scrub}>
              {doc.cards.map((card) => (
                <div
                  key={card.id}
                  className={`vp-clip${props.selectedCardId === card.id ? ' on' : ''}`}
                  style={{ ...span(card.start, card.end), background: CARD_FILL[card.kind], cursor: 'grab' }}
                  title={`${card.kind.toUpperCase()} · ${card.title}`}
                  onPointerDown={(e) => {
                    props.onSelectCard(card.id);
                    startDrag(e, { kind: 'card', id: card.id }, card.start, card.end, 'move');
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, block: { kind: 'card', id: card.id } });
                  }}
                >
                  <span
                    className="vp-handle"
                    onPointerDown={(e) => startDrag(e, { kind: 'card', id: card.id }, card.start, card.end, 'in')}
                  />
                  <span className="vp-cliplab">{card.title}</span>
                  <span
                    className="vp-handle r"
                    onPointerDown={(e) => startDrag(e, { kind: 'card', id: card.id }, card.start, card.end, 'out')}
                  />
                </div>
              ))}
            </div>

            {/* B-ROLL */}
            <div className="vp-trk" style={{ height: 34 }} onPointerDown={scrub}>
              {doc.broll.map((clip: BrollClip) => (
                <div
                  key={clip.id}
                  className={`vp-clip${props.selectedBrollId === clip.id ? ' on' : ''}`}
                  style={{ ...span(clip.start, clip.end), background: 'linear-gradient(180deg,#0E7490,#155E75)', cursor: 'grab' }}
                  title={`${clip.name} · ${clip.layout}`}
                  onPointerDown={(e) => {
                    props.onSelectBroll(clip.id);
                    startDrag(e, { kind: 'broll', id: clip.id }, clip.start, clip.end, 'move');
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, block: { kind: 'broll', id: clip.id } });
                  }}
                >
                  <span
                    className="vp-handle"
                    onPointerDown={(e) => startDrag(e, { kind: 'broll', id: clip.id }, clip.start, clip.end, 'in')}
                  />
                  <span className="vp-cliplab">{clip.name}</span>
                  <span
                    className="vp-handle r"
                    onPointerDown={(e) => startDrag(e, { kind: 'broll', id: clip.id }, clip.start, clip.end, 'out')}
                  />
                </div>
              ))}
            </div>

            {beats.map((b, i) => (
              <span key={`beat-${i}`} className="vp-beat" style={{ left: `${b * pxPerSec}px`, top: 22 }} />
            ))}
            <div className="vp-playhead" style={{ left: `${currentTime * pxPerSec}px` }} />
          </div>
        </div>
      </div>

      {menu && menuBlock ? (
        <div
          className="vp-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 180) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { props.onSnapToBeat(menuBlock); setMenu(null); }}>
            <AudioLines size={13} /> Snap to the nearest beat
          </button>
          {menuBlock.kind === 'card' ? (
            <button type="button" onClick={() => { props.onDuplicateCard(menuBlock.id); setMenu(null); }}>
              <Copy size={13} /> Duplicate <kbd>D</kbd>
            </button>
          ) : null}
          <hr />
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (menuBlock.kind === 'card') props.onDeleteCard(menuBlock.id);
              else props.onDeleteBroll(menuBlock.id);
              setMenu(null);
            }}
          >
            <Trash2 size={13} /> Delete <kbd>Del</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
