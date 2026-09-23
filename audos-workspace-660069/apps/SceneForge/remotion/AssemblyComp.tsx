import type { Asset, Project, Scene } from '../lib/supabase';
import type { CompositionSpec, OverlayConfig, VisualKind } from '../lib/effects';
import { effectiveComposition, normalizeEffect, visualKindOf } from '../lib/effects';
import { normalizeMotionSpec } from '../lib/motionSpec';
import { chooseTransition, normalizeSceneDirection, type TransitionSpec } from '../lib/visualTimeline';
import { defaultMotionTreatment, effectivePresenterState, normalizeMotionTreatment, normalizeOverlays, type MotionTreatment, type PipPosition, type SceneOverlayElement } from '../lib/directorPlan';

export interface TimelineSegment {
  type: 'avatar' | 'scene';
  startFrame: number;
  frames: number;
  startSec: number;
  sceneId?: string;
  assetUrls?: string[];
  sceneRenderUrl?: string;
  sceneRenderKind?: 'video' | 'image';
  /** 'heygen' for avatar segments; 'ai_video' | 'text_graphics' for scenes (legacy coded scenes read as text_graphics). */
  visualKind?: 'heygen' | VisualKind;
  /** Text/asset/effect overlay composed only inside the ONE final render. */
  overlay?: OverlayConfig | null;
  /** Optional native B-roll audio underneath the uninterrupted HeyGen master. */
  audioMuted?: boolean;
  audioVolume?: number;
  /** How the visual sits against the presenter: 'overlay' | 'central' keep the
   * avatar visible (the visual composites as a positioned element); absent or
   * 'fullscreen' is the classic full-frame takeover. */
  composition?: Pick<CompositionSpec, 'mode' | 'position' | 'scale'> | null;
  /** CINEMATIC TRANSITIONS — how this scene enters and leaves the frame.
   * Chosen content-aware in buildTimeline (director's choice first, then the
   * kind-aware chooser); rendered frame-accurately in the composition. */
  transitionIn?: { type: string; frames: number; direction?: string } | null;
  transitionOut?: { type: string; frames: number; direction?: string } | null;
  /** EXPLICIT presenter state for this scene window (Director layer): 'full'
   * keeps the presenter visible as the base under an overlay/central visual,
   * 'hidden' is a fullscreen cutaway (narration continues), 'pip' shows the
   * presenter in a positioned card over the visual. Every scene segment
   * declares one — no scene relies on accidental stacking. */
  presenter?: { video: 'full' | 'hidden' | 'pip'; pip?: { position: PipPosition; scale: number } };
  /** True only when the Director explicitly mutes narration for this window. */
  presenterMuted?: boolean;
  /** First-class EDITABLE overlay elements (text, arrows, circles, highlights,
   * labels, stats, citations, lower thirds) composed above the scene visual;
   * captions render above these. Editing them re-renders only the composition. */
  overlayElements?: SceneOverlayElement[];
  /** Deterministic Ken Burns motion for still visuals (Director-specified,
   * with a default so images never sit as dead slides). */
  motion?: MotionTreatment | null;
}

// Decide from the URL itself, not from "this scene has code": a scene whose
// motion render failed keeps its still, and playing a PNG through <Video>
// renders nothing at all.
const looksLikeVideo = (url?: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

/** A time in seconds that is safe to do arithmetic with: never NaN, never negative. */
const sec = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };

export function buildTimeline(project: Project, scenes: Scene[], assets: Asset[], fps = 30): TimelineSegment[] {
  // A skipped scene is out of the film by decision, never by accident — the
  // avatar simply keeps playing through its window.
  const sceneRows = (Array.isArray(scenes) ? scenes : []).filter(Boolean).filter((scene) => scene.status !== 'skipped');
  const assetRows = (Array.isArray(assets) ? assets : []).filter(Boolean);
  // Assembly must never silently drop finished work: scenes the customer
  // approved come first, but when none carry the flag (an older project, or a
  // flag lost to an edit) every scene that actually has a picture, an overlay
  // or code still joins the film instead of shipping an avatar-only cut.
  const flagged = sceneRows.filter((scene) => scene.approved);
  const usable = flagged.length ? flagged : sceneRows.filter((scene) => scene.render_url || scene.remotion_code || scene.overlay_config);
  const approved = usable.sort((a, b) => sec(a.script_start_sec) - sec(b.script_start_sec));
  // A project that never recorded a duration still has to produce a timeline,
  // so the scenes themselves are the fallback length.
  const declared = sec(project?.avatar_duration_sec) || sec(project?.estimated_duration_sec) || sec(project?.target_length_sec);
  const lastSceneEnd = approved.reduce((longest, scene) => Math.max(longest, sec(scene.script_end_sec)), 0);
  const duration = declared > 0 ? declared : lastSceneEnd;
  const segments: TimelineSegment[] = [];
  // Per-scene transition context (motion kind, director timeline, preferred
  // lateral direction) collected during the walk, consumed by the transition
  // post-pass below.
  const transitionMeta = new Map<string, { motionKind: string | null; direction: ReturnType<typeof normalizeSceneDirection>; dir?: 'left' | 'right' | 'up' | 'down' }>();
  let cursor = 0;
  approved.forEach((scene) => {
    const start = sec(scene.script_start_sec);
    // An empty or inverted range would ask Remotion for a zero-length
    // sequence, which fails the whole render; one frame is the floor.
    const end = Math.max(start + 1 / fps, sec(scene.script_end_sec));
    const gapFrames = Math.round((start - cursor) * fps);
    if (gapFrames > 0) segments.push({ type: 'avatar', visualKind: 'heygen', startSec: cursor, startFrame: Math.round(cursor * fps), frames: gapFrames });
    const overlay = scene.overlay_config && typeof scene.overlay_config === 'object' ? { ...scene.overlay_config, ...(scene.overlay_config.effect ? { effect: normalizeEffect(scene.overlay_config.effect) } : {}) } : null;
    // The scene's visual. A text/graphics scene prefers the asset the
    // customer explicitly picked in the overlay; an AI-video or legacy scene
    // prefers its own render (the generated clip). A pure text scene
    // legitimately has neither.
    const kind = visualKindOf(scene.visual_kind);
    // An over-avatar overlay never replaces the picture: the presenter stays
    // on screen and the label composes on top, so a captured clip parked on
    // render_url is deliberately ignored — only a picked still may ride along
    // as a small corner chip beside the callout.
    const overAvatar = Boolean(overlay?.overAvatar) && (kind === 'text_overlay' || kind === 'text_graphics');
    const pickedAsset = overlay?.showAsset !== false ? overlay?.assetUrl : '';
    const renderUrl = overAvatar ? (pickedAsset || '') : ((kind === 'text_graphics' && !scene.remotion_code ? (pickedAsset || scene.render_url) : (scene.render_url || pickedAsset)) || '');
    const hasCodedRender = looksLikeVideo(renderUrl);
    // A motion-graphic / text-overlay capture already carries its text INSIDE
    // the clip (the GSAP engine baked it); drawing the overlay again here
    // would double every headline.
    const textBaked = (kind === 'motion_graphic' || kind === 'text_overlay') && hasCodedRender;
    // COMPOSITION: how this visual sits against the presenter. Explicit plan
    // decision first, then the kind-aware default (motion graphics stop being
    // full-frame cards). Over-avatar callouts already keep the presenter
    // visible through their own path, and 'fullscreen' is the legacy takeover,
    // so only overlay/central travel on the segment.
    const motionKind = kind === 'motion_graphic' || kind === 'text_overlay' ? normalizeMotionSpec(scene.spec || {}, scene.description).kind : null;
    const composition = overAvatar ? null : effectiveComposition(kind, overlay, motionKind);
    transitionMeta.set(scene.id, { motionKind, direction: normalizeSceneDirection(scene.director_timeline), dir: overlay?.effect?.direction });
    // DIRECTOR LAYER: explicit presenter state (derived from the composition
    // when the plan predates the field — never left implicit), first-class
    // editable overlay elements, and Ken Burns motion for still visuals.
    const presenter = effectivePresenterState(scene);
    const overlayElements = normalizeOverlays((scene as any).overlays, scene.id);
    const stillMotion = !hasCodedRender && renderUrl
      ? (normalizeMotionTreatment((scene as any).motion_treatment) || (kind === 'image' ? defaultMotionTreatment(scene.scene_index) : null))
      : normalizeMotionTreatment((scene as any).motion_treatment);
    segments.push({
      type: 'scene',
      visualKind: visualKindOf(scene.visual_kind),
      sceneId: scene.id,
      startSec: start,
      startFrame: Math.round(start * fps),
      frames: Math.max(1, Math.round((end - start) * fps)),
      assetUrls: assetRows.filter((asset) => asset.scene_id === scene.id).map((asset) => asset.public_url).filter(Boolean) as string[],
      ...(renderUrl ? { sceneRenderUrl: renderUrl, sceneRenderKind: hasCodedRender ? 'video' as const : 'image' as const } : {}),
      ...(composition && composition.mode !== 'fullscreen' ? { composition: { mode: composition.mode, position: composition.position, scale: composition.scale } } : {}),
      ...(overlay && !textBaked ? { overlay } : {}),
      presenter: { video: presenter.video, ...(presenter.pip ? { pip: presenter.pip } : {}) },
      ...(presenter.audio === 'mute' ? { presenterMuted: true } : {}),
      ...(overlayElements.length ? { overlayElements } : {}),
      ...(stillMotion ? { motion: stillMotion } : {}),
      audioMuted: scene.audio_muted !== false,
      audioVolume: Math.max(0, Math.min(1, Number(scene.audio_volume || 0))),
    });
    cursor = Math.max(cursor, end);
  });
  const tailFrames = Math.round((duration - cursor) * fps);
  if (tailFrames > 0) segments.push({ type: 'avatar', visualKind: 'heygen', startSec: cursor, startFrame: Math.round(cursor * fps), frames: tailFrames });

  // CINEMATIC TRANSITION PASS. Every scene segment gets an explicit entry and
  // exit move: the scene's own Motion Director choice first, otherwise the
  // content-aware chooser reading what sits on each side of the cut (footage,
  // graphics, stills, a big number…). Generic crossfade is never assigned as
  // a default — only the chooser's last resort.
  const sceneSegments = segments.filter((segment) => segment.type === 'scene');
  sceneSegments.forEach((segment, index) => {
    const meta = segment.sceneId ? transitionMeta.get(segment.sceneId) : undefined;
    const prev = index > 0 ? sceneSegments[index - 1] : null;
    const next = index < sceneSegments.length - 1 ? sceneSegments[index + 1] : null;
    // Only a back-to-back neighbor participates in the cut; otherwise the
    // presenter (heygen) is on the other side of it.
    const contiguousPrev = prev && prev.startFrame + prev.frames >= segment.startFrame - 2 ? prev : null;
    const contiguousNext = next && segment.startFrame + segment.frames >= next.startFrame - 2 ? next : null;
    const prevMeta = contiguousPrev?.sceneId ? transitionMeta.get(contiguousPrev.sceneId) : undefined;
    const nextMeta = contiguousNext?.sceneId ? transitionMeta.get(contiguousNext.sceneId) : undefined;
    const tin: TransitionSpec = meta?.direction?.transitionIn || chooseTransition({ fromKind: contiguousPrev?.visualKind || 'heygen', toKind: segment.visualKind || 'scene', fromMotionKind: prevMeta?.motionKind, toMotionKind: meta?.motionKind, direction: meta?.dir });
    const tout: TransitionSpec = meta?.direction?.transitionOut || chooseTransition({ fromKind: segment.visualKind || 'scene', toKind: contiguousNext?.visualKind || 'heygen', fromMotionKind: meta?.motionKind, toMotionKind: nextMeta?.motionKind, direction: meta?.dir });
    segment.transitionIn = { type: tin.type, frames: Math.max(6, Math.round(tin.duration * fps)), ...(tin.direction ? { direction: tin.direction } : {}) };
    segment.transitionOut = { type: tout.type, frames: Math.max(6, Math.round(tout.duration * fps)), ...(tout.direction ? { direction: tout.direction } : {}) };
  });
  return segments;
}

/**
 * The render length the timeline actually needs, clamped to what the platform
 * renderer accepts (1 to 18000 frames). The declared project duration is a
 * floor, never a ceiling: a scene that runs past it must not be cut off, and a
 * project with no duration at all still renders instead of being rejected.
 */
export function timelineDurationInFrames(timeline: TimelineSegment[], fallbackSec = 0, fps = 30): number {
  const rows = (Array.isArray(timeline) ? timeline : []).filter(Boolean);
  const end = rows.reduce((longest, segment) => {
    const from = Math.max(0, Math.round(Number(segment.startFrame) || 0));
    const frames = Math.max(1, Math.round(Number(segment.frames) || 0));
    return Math.max(longest, from + frames);
  }, 0);
  const declared = Math.round(sec(fallbackSec) * fps);
  return Math.max(1, Math.min(18000, Math.max(end, declared)));
}

/**
 * The composition source handed to /api/render/remotion — the ONE Remotion
 * render in the pipeline. Remotion's job here is final composition only:
 * deterministic text overlays, preset effects, captions-style scrims,
 * crossfades and the join. Supporting scenes are never rendered
 * independently — an AI-video scene arrives as a finished clip URL and a
 * text/graphics scene is composed right here from its overlay definition.
 *
 * The platform resolves `calculateDemoVideoDuration` without props before it
 * renders the first frame. The callback therefore treats a missing timeline
 * as normal and returns the same safe duration baked into the submit request.
 * With props, it derives the furthest segment end and clamps it to the
 * renderer's 1–18000 frame contract.
 *
 * JOIN CONTRACT: the avatar master plays CONTINUOUSLY as the base layer for
 * the whole film — picture and audio are never chopped into per-segment
 * slices — and each supporting scene renders on top of it inside its own
 * Sequence with a CONTENT-AWARE CINEMATIC TRANSITION in and out (zoom match
 * cut, spatial collapse, push-through, narrative slide, layer reveal,
 * directional wipe — crossfade only as the chooser's last resort). Scenes
 * therefore always connect smoothly (avatar → scene → avatar), with no
 * seams, no dropped segments and no audio joins, however long the film runs.
 */
export function createAssemblySource(fallbackDurationInFrames = 900) {
  const fallback = Math.max(1, Math.min(18000, Math.round(Number(fallbackDurationInFrames) || 900)));
  return `import React from 'react'; import {AbsoluteFill,Img,OffthreadVideo,Sequence,Video,interpolate,useCurrentFrame} from 'remotion';
var FALLBACK_FRAMES = ${fallback};
var segmentsOf = function (p) { var t = p && p.timeline; return Array.isArray(t) ? t.filter(Boolean) : []; };
var startAt = function (s) { var n = Math.round(Number(s && s.startFrame) || 0); return n > 0 ? n : 0; };
var frameCount = function (s) { var n = Math.round(Number(s && s.frames) || 0); return n > 0 ? n : 1; };
export function calculateDemoVideoDuration(params) {
  var timeline = segmentsOf(params);
  if (!params || !Array.isArray(params.timeline) || !timeline.length) return FALLBACK_FRAMES;
  var end = timeline.reduce(function (longest, segment) { return Math.max(longest, startAt(segment) + frameCount(segment)); }, 0);
  return Math.max(1, Math.min(18000, end || FALLBACK_FRAMES));
}
var COVER = {width:'100%',height:'100%',objectFit:'cover'};
var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
var ease = function (t, kind) {
  t = clamp01(t);
  if (kind === 'ease-in') return t * t;
  if (kind === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (kind === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
};
var dirVec = function (direction) {
  if (direction === 'right') return {x: 1, y: 0};
  if (direction === 'up') return {x: 0, y: -1};
  if (direction === 'down') return {x: 0, y: 1};
  return {x: -1, y: 0};
};
// PRESET EFFECTS. One deterministic interpretation per preset id, driven by
// eased progress through the scene window — this is what replaced bespoke
// per-scene Remotion compositions.
var effectStyle = function (effect, frame, frames) {
  var e = effect || {};
  var k = Number(e.intensity); if (!(k > 0)) k = 1; if (k > 2) k = 2;
  var p = ease(frames > 1 ? frame / frames : 1, e.easing || 'ease-in-out');
  var d = dirVec(e.direction);
  var preset = String(e.preset || 'none');
  var style = {transform: '', opacity: 1, filter: ''};
  if (preset === 'zoom_in') style.transform = 'scale(' + (1 + 0.14 * k * p) + ')';
  else if (preset === 'zoom_out') style.transform = 'scale(' + (1 + 0.14 * k * (1 - p)) + ')';
  else if (preset === 'pan_left' || preset === 'pan_right') style.transform = 'scale(' + (1 + 0.08 * k) + ') translate(' + (d.x * 3.5 * k * (p - 0.5) * 2) + '%,0)';
  else if (preset === 'parallax') style.transform = 'scale(' + (1 + 0.06 * k) + ') translate(' + (d.x * 2.5 * k * (p - 0.5) * 2) + '%,' + (d.y * 2.5 * k * (p - 0.5) * 2 - 1 * k * p) + '%)';
  else if (preset === 'ken_burns') style.transform = 'scale(' + (1 + 0.05 * k + 0.1 * k * p) + ') translate(' + (d.x * 2.5 * k * p) + '%,' + (d.y * 2.5 * k * p) + '%)';
  else if (preset === 'fade') style.opacity = interpolate(p, [0, 0.22, 0.78, 1], [0, 1, 1, 0]);
  else if (preset === 'blur_reveal') style.filter = 'blur(' + (12 * k * (1 - clamp01(p / 0.4))) + 'px)';
  else if (preset === 'scale_up') { var su = p < 0.35 ? ease(p / 0.35, 'ease-out') : 1; style.transform = 'scale(' + (0.9 + (0.1 + 0.02 * Math.sin(Math.min(1, su) * Math.PI)) * su * k) + ')'; }
  else if (preset === 'scale_down') { var sd = p < 0.35 ? ease(p / 0.35, 'ease-out') : 1; style.transform = 'scale(' + (1 + 0.12 * k * (1 - sd)) + ')'; }
  else if (preset === 'float') style.transform = 'translateY(' + (Math.sin(frame / 22) * 8 * k) + 'px) scale(' + (1 + 0.03 * k) + ')';
  else if (preset === 'push_in') { var pi = p < 0.28 ? ease(p / 0.28, 'ease-out') : 1; style.transform = 'translate(' + (d.x * 30 * (1 - pi)) + '%,' + (d.y * 30 * (1 - pi)) + '%)'; }
  else if (preset === 'push_out') { var po = p > 0.72 ? ease((p - 0.72) / 0.28, 'ease-in') : 0; style.transform = 'translate(' + (d.x * 30 * po) + '%,' + (d.y * 30 * po) + '%)'; }
  return style;
};
var SIZE_PX = {sm: 38, md: 54, lg: 74};
var posStyle = function (position) {
  if (position === 'top') return {justifyContent: 'flex-start', paddingTop: '7%'};
  if (position === 'center') return {justifyContent: 'center'};
  if (position === 'bottom') return {justifyContent: 'flex-end', paddingBottom: '5%'};
  if (position === 'top_left') return {justifyContent: 'flex-start', alignItems: 'flex-start', paddingTop: '6%', paddingLeft: '5%'};
  if (position === 'top_right') return {justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: '6%', paddingRight: '5%'};
  if (position === 'bottom_left') return {justifyContent: 'flex-end', alignItems: 'flex-start', paddingBottom: '8%', paddingLeft: '5%'};
  if (position === 'bottom_right') return {justifyContent: 'flex-end', alignItems: 'flex-end', paddingBottom: '8%', paddingRight: '5%'};
  if (position === 'side_left') return {justifyContent: 'center', alignItems: 'flex-start', paddingLeft: '6%'};
  if (position === 'side_right') return {justifyContent: 'center', alignItems: 'flex-end', paddingRight: '6%'};
  return {justifyContent: 'flex-end', paddingBottom: '13%'};
};
// SAFE ZONES: an over-avatar label must never sit on the presenter's face. A
// centered talking head keeps its face in the center/upper-center band, so
// center and plain top are clamped to safe positions (lower third / corners).
var safeAvatarPos = function (pos) {
  if (!pos || pos === 'center') return 'lower_third';
  if (pos === 'top') return 'top_right';
  return pos;
};
// Where the caption sits when the scene's media is framed as an element.
var mediaTextZone = function (layout) {
  if (layout === 'inset_left' || layout === 'circle') return 'side_right';
  if (layout === 'inset_right') return 'side_left';
  if (layout === 'card') return 'bottom';
  return '';
};
// COMPOSITION FRAMES (overlay / central): the presenter keeps playing as the
// base layer and the scene's visual sits in a positioned rounded card over
// it — a small face-safe insert for overlay mode, a dominant centered panel
// for central mode — instead of a full-frame takeover.
var compositionFrameStyle = function (comp) {
  var mode = String(comp && comp.mode || '');
  var scale = Number(comp && comp.scale);
  var base = {position:'absolute', aspectRatio:'16 / 9', borderRadius:24, overflow:'hidden', boxShadow:'0 24px 70px rgba(0,0,0,0.55)', border:'2px solid rgba(148,163,184,0.35)'};
  if (mode === 'central') {
    var cw = scale > 0 ? Math.min(0.8, Math.max(0.5, scale)) : 0.62;
    base.width = (cw * 100) + '%';
    base.left = (((1 - cw) / 2) * 100) + '%';
    base.top = '16%';
    return base;
  }
  var w = scale > 0 ? Math.min(0.5, Math.max(0.22, scale)) : 0.34;
  base.width = (w * 100) + '%';
  var pos = String(comp && comp.position || 'lower_third');
  if (pos === 'left' || pos === 'top_left' || pos === 'bottom_left') base.left = '4%'; else base.right = '4%';
  if (pos === 'top_left' || pos === 'top_right') base.top = '7%';
  else if (pos === 'left' || pos === 'right') { base.top = '50%'; base.transform = 'translateY(-50%)'; }
  else base.bottom = '9%';
  return base;
};
// COMPOSITED MEDIA FRAMES: crops/masks/scales the scene's clip or still into
// a positioned element instead of a full-bleed takeover.
var mediaFrameStyle = function (layout) {
  var base = {position:'absolute', overflow:'hidden', boxShadow:'0 30px 80px rgba(0,0,0,0.55)', border:'2px solid rgba(148,163,184,0.35)'};
  if (layout === 'inset_left') return Object.assign(base, {left:'5%', top:'12%', width:'50%', height:'76%', borderRadius:28});
  if (layout === 'inset_right') return Object.assign(base, {right:'5%', top:'12%', width:'50%', height:'76%', borderRadius:28});
  if (layout === 'circle') return Object.assign(base, {left:'8%', top:'50%', height:'68%', aspectRatio:'1 / 1', transform:'translateY(-50%)', borderRadius:'50%'});
  if (layout === 'card') return Object.assign(base, {left:'15%', top:'10%', width:'70%', height:'70%', borderRadius:32});
  return null;
};
// TEXT OVERLAYS — deterministic text belongs to the final composition, never
// to a per-scene render.
function TextOverlay(props) {
  var frame = useCurrentFrame();
  var o = props.overlay || {};
  var frames = props.frames || 1;
  if (!o.text && !o.subtext) return null;
  var anim = String(o.animation || 'text_reveal');
  var callout = props.callout === true;
  var pos = props.positionOverride || (callout ? safeAvatarPos(o.position) : (o.position || 'lower_third'));
  var corner = pos === 'top_left' || pos === 'top_right' || pos === 'bottom_left' || pos === 'bottom_right';
  var side = pos === 'side_left' || pos === 'side_right';
  var headSize = SIZE_PX[String(o.size || (callout ? 'sm' : 'md'))] || 54;
  if (callout && headSize > 42) headSize = 42;
  if ((corner || side) && headSize > 60) headSize = 60;
  var alpha = Number(o.opacity); if (!(alpha > 0) || alpha > 1) alpha = 1;
  var inO = 1, inY = 0, popS = 1, subO = 1, subY = 0;
  if (anim === 'text_reveal') {
    inO = interpolate(frame, [0, 12], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    inY = interpolate(frame, [0, 12], [26, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    subO = interpolate(frame, [7, 20], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    subY = interpolate(frame, [7, 20], [22, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  } else if (anim === 'text_pop') {
    var pp = ease(Math.min(1, frame / 11), 'ease-out');
    popS = 0.6 + 0.4 * pp + 0.06 * Math.sin(pp * Math.PI);
    inO = pp; subO = interpolate(frame, [8, 18], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  } else if (anim === 'fade') {
    inO = interpolate(frame, [0, 14, frames - 10, frames], [0, 1, 1, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    subO = inO;
  }
  var scale = Number(o.scale); if (!(scale > 0)) scale = 1;
  var lowered = !callout && !corner && !side && (pos === 'lower_third' || pos === 'bottom');
  var align = (pos === 'top_left' || pos === 'bottom_left' || pos === 'side_left') ? 'left' : (pos === 'top_right' || pos === 'bottom_right' || pos === 'side_right') ? 'right' : 'center';
  var blockStyle = {position:'relative', maxWidth: (corner || side) ? '38%' : '82%', textAlign: align, transform:'scale(' + (scale * popS) + ') translateY(' + inY + 'px)', opacity: alpha * inO, fontFamily: o.font || "'Inter', system-ui, sans-serif"};
  // Over-avatar callouts carry their own pill background so they stay legible
  // on any footage without darkening the presenter with a full-width scrim.
  if (callout) { blockStyle.background = 'rgba(8,12,24,0.78)'; blockStyle.border = '1.5px solid rgba(255,255,255,0.16)'; blockStyle.borderRadius = 20; blockStyle.padding = '16px 26px'; blockStyle.boxShadow = '0 10px 40px rgba(0,0,0,0.45)'; }
  return <AbsoluteFill style={Object.assign({alignItems:'center', pointerEvents:'none'}, posStyle(pos))}>
    {lowered ? <div style={{position:'absolute', left:0, right:0, bottom:0, height:'42%', background:'linear-gradient(to top, rgba(5,8,18,0.72), rgba(5,8,18,0))'}}/> : null}
    <div style={blockStyle}>
      {o.text ? <div style={{fontSize: headSize, fontWeight: 800, lineHeight: 1.15, color:'#fff', letterSpacing:'-0.01em', textShadow:'0 4px 26px rgba(0,0,0,0.75)'}}>{o.text}</div> : null}
      {o.subtext ? <div style={{marginTop: 14, fontSize: Math.round(headSize * 0.44), fontWeight: 500, lineHeight: 1.35, color:'rgba(255,255,255,0.92)', textShadow:'0 3px 18px rgba(0,0,0,0.7)', opacity: subO, transform:'translateY(' + subY + 'px)'}}>{o.subtext}</div> : null}
    </div>
  </AbsoluteFill>;
}
function LightSweep(props) {
  var frame = useCurrentFrame();
  var e = props.effect || {};
  if (String(e.preset) !== 'light_sweep') return null;
  var k = Number(e.intensity); if (!(k > 0)) k = 1;
  var p = ease(props.frames > 1 ? frame / props.frames : 1, e.easing || 'ease-in-out');
  var from = (e.direction === 'left') ? 130 : -130;
  var x = from + (-from * 2) * p;
  return <AbsoluteFill style={{overflow:'hidden', pointerEvents:'none'}}>
    <div style={{position:'absolute', top:'-20%', bottom:'-20%', left:'35%', width:'30%', transform:'translateX(' + x + '%) rotate(14deg)', background:'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,' + (0.22 * k) + ') 50%, rgba(255,255,255,0) 100%)'}}/>
  </AbsoluteFill>;
}
// CINEMATIC TRANSITIONS — frame-accurate entry/exit per scene segment. Each
// transition reads the segment's declared move (chosen content-aware in
// buildTimeline or by the Motion Director) and shapes transform + clip-path +
// opacity together — a bare opacity crossfade exists only as the fallback.
var transitionStyle = function (s, frame, frames) {
  var tin = s.transitionIn || null;
  var tout = s.transitionOut || null;
  var cap = Math.max(4, Math.floor(frames / 3));
  var inF = Math.min(cap, tin && tin.frames > 0 ? tin.frames : 12);
  var outF = Math.min(cap, tout && tout.frames > 0 ? tout.frames : 12);
  var style = {opacity: 1, transform: '', clipPath: ''};
  var apply = function (type, p, entering, dir) {
    var q = ease(p, 'ease-in-out');
    var e = 1 - q;
    var v = dirVec(dir || 'right');
    if (type === 'zoom_match_cut') { style.transform += ' scale(' + (entering ? 1 + 0.16 * e : 1 + 0.12 * e) + ')'; style.opacity *= q; }
    else if (type === 'spatial_collapse') { style.transform += ' scale(' + (0.62 + 0.38 * q) + ')'; style.opacity *= q; }
    else if (type === 'push_through') { style.transform += ' scale(' + (entering ? 1.7 - 0.7 * q : 1 + 1.4 * e) + ')'; style.opacity *= q; }
    else if (type === 'slide_context') { var off = 14 * e * (entering ? 1 : -1); style.transform += ' translate(' + (v.x * off) + '%,' + (v.y * off) + '%)'; style.opacity *= q; }
    else if (type === 'layer_reveal') { var ins = 100 * e; style.clipPath = entering ? 'inset(0% 0% ' + ins + '% 0%)' : 'inset(' + ins + '% 0% 0% 0%)'; style.opacity *= Math.min(1, q * 1.6); }
    else if (type === 'wipe_directional') {
      var ins2 = 100 * e;
      if (v.x > 0) style.clipPath = entering ? 'inset(0% ' + ins2 + '% 0% 0%)' : 'inset(0% 0% 0% ' + ins2 + '%)';
      else if (v.x < 0) style.clipPath = entering ? 'inset(0% 0% 0% ' + ins2 + '%)' : 'inset(0% ' + ins2 + '% 0% 0%)';
      else if (v.y > 0) style.clipPath = entering ? 'inset(' + ins2 + '% 0% 0% 0%)' : 'inset(0% 0% ' + ins2 + '% 0%)';
      else style.clipPath = entering ? 'inset(0% 0% ' + ins2 + '% 0%)' : 'inset(' + ins2 + '% 0% 0% 0%)';
      style.opacity *= Math.min(1, q * 2);
    }
    else { style.opacity *= q; }
  };
  if (inF >= 1 && frame < inF) apply(tin ? tin.type : 'crossfade', clamp01(frame / inF), true, tin && tin.direction);
  else if (outF >= 1 && frames - frame < outF) apply(tout ? tout.type : 'crossfade', clamp01((frames - frame) / outF), false, tout && tout.direction);
  return style;
};
// KEN BURNS — the Director's deterministic image motion (initial/final scale,
// pan, optional rotation, easing). Applied to still visuals so images never
// sit as dead slides; when present it overrides the generic preset effect for
// the still. KEEP IN SYNC with remotion/compositionRuntime.kenBurnsStyleAt.
var kenBurnsStyle = function (motion, frame, frames) {
  if (!motion) return null;
  var p = ease(frames > 1 ? frame / frames : 1, motion.easing || 'ease-in-out');
  var from = Number(motion.scale_from); if (!(from > 0)) from = 1.04;
  var to = Number(motion.scale_to); if (!(to > 0)) to = 1.14;
  var scale = from + (to - from) * p;
  var x = (Number(motion.pan_x_pct) || 0) * p;
  var y = (Number(motion.pan_y_pct) || 0) * p;
  var rot = (Number(motion.rotate_deg) || 0) * p;
  return {transform: 'scale(' + scale + ') translate(' + x + '%,' + y + '%)' + (rot ? ' rotate(' + rot + 'deg)' : ''), opacity: 1, filter: ''};
};
// EDITABLE OVERLAY ELEMENTS — first-class timeline elements (text, labels,
// lower thirds, stats, citations, arrows, circles, highlights) composed ABOVE
// the scene visual from the scene's stored overlays data. An overlay-only
// edit re-renders ONLY this composition — never the underlying AI or HeyGen
// assets. Captions render above these at the root. KEEP IN SYNC with
// remotion/compositionRuntime.overlayStateAt.
var OV_ANIM_F = 9;
var overlayState = function (o, frame, frames) {
  var startF = Math.round((Number(o.start_offset_sec) || 0) * 30);
  var durF = Math.max(6, Math.min(frames - startF, Math.round((Number(o.duration_sec) || 3) * 30)));
  var local = frame - startF;
  if (local < 0 || local >= durF) return null;
  var inP = clamp01(local / OV_ANIM_F);
  var outP = clamp01((durF - local) / OV_ANIM_F);
  var opacity = 1; var transform = ''; var draw = 1;
  var ai = String(o.anim_in || 'rise');
  if (ai === 'fade') opacity *= ease(inP, 'ease-out');
  else if (ai === 'rise') { opacity *= ease(inP, 'ease-out'); transform += ' translateY(' + ((1 - ease(inP, 'ease-out')) * 18) + 'px)'; }
  else if (ai === 'pop') { var q = ease(inP, 'ease-out'); opacity *= q; transform += ' scale(' + (0.72 + 0.28 * q + 0.05 * Math.sin(q * Math.PI)) + ')'; }
  else if (ai === 'draw') { draw = ease(clamp01(local / (OV_ANIM_F * 2)), 'ease-in-out'); opacity *= Math.min(1, inP * 2); }
  var ao = String(o.anim_out || 'fade');
  if (ao === 'fade') opacity *= ease(outP, 'ease-out');
  else if (ao === 'rise') { opacity *= ease(outP, 'ease-out'); transform += ' translateY(' + (-(1 - ease(outP, 'ease-out')) * 12) + 'px)'; }
  else if (ao === 'pop') { var q2 = ease(outP, 'ease-out'); opacity *= q2; transform += ' scale(' + (0.85 + 0.15 * q2) + ')'; }
  return {opacity: opacity, transform: transform, draw: draw};
};
function OverlayElements(props) {
  var frame = useCurrentFrame();
  var list = Array.isArray(props.overlays) ? props.overlays : [];
  var frames = props.frames || 1;
  if (!list.length) return null;
  return <AbsoluteFill style={{pointerEvents:'none'}}>
    {list.map(function (o, i) {
      if (!o) return null;
      var st = overlayState(o, frame, frames);
      if (!st) return null;
      var accent = String(o.accent || '#3B82F6');
      var scale = Number(o.scale); if (!(scale > 0)) scale = 1;
      var x = Number(o.x_pct); if (!Number.isFinite(x)) x = 50;
      var y = Number(o.y_pct); if (!Number.isFinite(y)) y = 84;
      var z = 40 + (Number(o.z_index) || 10);
      var type = String(o.type || 'text');
      if (type === 'arrow' || type === 'circle') {
        var tx = Number(o.target_x_pct); if (!Number.isFinite(tx)) tx = x;
        var ty = Number(o.target_y_pct); if (!Number.isFinite(ty)) ty = Math.max(6, y - 26);
        var x1 = x * 19.2; var y1 = y * 10.8; var x2 = tx * 19.2; var y2 = ty * 10.8;
        var dx = x2 - x1; var dy = y2 - y1; var len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var hx = x2 - (dx / len) * 34; var hy = y2 - (dy / len) * 34;
        var px = -(dy / len) * 20; var py = (dx / len) * 20;
        return <AbsoluteFill key={o.id || i} style={{zIndex: z, opacity: st.opacity, pointerEvents:'none'}}>
          <svg viewBox="0 0 1920 1080" style={{position:'absolute', inset:0, width:'100%', height:'100%'}}>
            {type === 'circle'
              ? <ellipse cx={x * 19.2} cy={y * 10.8} rx={130 * scale} ry={90 * scale} fill="none" stroke={accent} strokeWidth={7} strokeDasharray={700} strokeDashoffset={700 * (1 - st.draw)} transform={'rotate(-8 ' + (x * 19.2) + ' ' + (y * 10.8) + ')'}/>
              : <g>
                  <line x1={x1} y1={y1} x2={x1 + dx * st.draw} y2={y1 + dy * st.draw} stroke={accent} strokeWidth={8} strokeLinecap="round"/>
                  {st.draw > 0.96 ? <polygon points={x2 + ',' + y2 + ' ' + (hx + px) + ',' + (hy + py) + ' ' + (hx - px) + ',' + (hy - py)} fill={accent}/> : null}
                </g>}
          </svg>
          {o.text ? <div style={{position:'absolute', left: x + '%', top: y + '%', transform:'translate(-50%, 20%)', fontFamily:"'Inter', system-ui, sans-serif", fontSize: 26 * scale, fontWeight: 700, color:'#fff', background:'rgba(8,12,24,0.78)', borderRadius: 12, padding:'6px 14px', border:'1.5px solid rgba(255,255,255,0.16)'}}>{o.text}</div> : null}
        </AbsoluteFill>;
      }
      if (type === 'highlight') {
        return <div key={o.id || i} style={{position:'absolute', left: x + '%', top: y + '%', width: (26 * scale) + '%', height: (11 * scale) + '%', transform: 'translate(-50%,-50%)' + st.transform, zIndex: z, opacity: st.opacity * 0.42, background: accent, borderRadius: 18, pointerEvents:'none'}}/>;
      }
      var isLower = type === 'lower_third';
      var isStat = type === 'stat';
      var isCite = type === 'citation';
      var isLabel = type === 'label';
      var block = {position:'absolute', left: (isLower ? 4 : x) + '%', top: isLower ? undefined : y + '%', bottom: isLower ? '7%' : undefined, transform: (isLower ? '' : 'translate(-50%,-50%)') + st.transform, zIndex: z, opacity: st.opacity, maxWidth:'62%', pointerEvents:'none', fontFamily:"'Inter', system-ui, sans-serif", textAlign: isLower ? 'left' : 'center'};
      if (isLower || isLabel || isCite) { block.background = 'rgba(8,12,24,0.80)'; block.border = '1.5px solid rgba(255,255,255,0.16)'; block.borderRadius = 16; block.padding = isLower ? '14px 26px' : '10px 20px'; block.boxShadow = '0 10px 40px rgba(0,0,0,0.45)'; }
      if (isLower) { block.borderLeft = '6px solid ' + accent; }
      return <div key={o.id || i} style={block}>
        {isStat && o.text ? <div style={{fontSize: 96 * scale, fontWeight: 900, lineHeight: 1, color: accent, textShadow:'0 6px 30px rgba(0,0,0,0.7)'}}>{o.text}</div>
          : o.text ? <div style={{fontSize: (isCite ? 24 : isLabel ? 30 : isLower ? 40 : 52) * scale, fontWeight: isCite ? 500 : 800, lineHeight: 1.2, color:'#fff', fontStyle: isCite ? 'italic' : 'normal', textShadow:'0 4px 22px rgba(0,0,0,0.75)'}}>{o.text}</div> : null}
        {o.subtext ? <div style={{marginTop: 8, fontSize: (isStat ? 30 : 24) * scale, fontWeight: 500, color:'rgba(255,255,255,0.9)'}}>{o.subtext}</div> : null}
        {o.source ? <div style={{marginTop: 8, fontSize: 20 * scale, fontWeight: 500, color:'rgba(255,255,255,0.72)'}}>{'\u2014 ' + o.source}</div> : null}
      </div>;
    })}
  </AbsoluteFill>;
}
// PRESENTER PIP — the explicit picture-in-picture presenter card over a
// fullscreen visual. startFrom keeps the PIP picture time-aligned with the
// continuous base master; it is muted (the base layer already carries the
// narration, so audio is never duplicated).
function PresenterPip(props) {
  var s = props.segment || {};
  var pip = s.presenter && s.presenter.pip ? s.presenter.pip : null;
  if (!props.avatarVideoUrl || !s.presenter || s.presenter.video !== 'pip') return null;
  var scale = pip && pip.scale > 0 ? Math.min(0.34, Math.max(0.16, Number(pip.scale))) : 0.24;
  var pos = String((pip && pip.position) || 'bottom_right');
  var style = {position:'absolute', width: (scale * 100) + '%', aspectRatio:'16 / 9', borderRadius: 18, overflow:'hidden', boxShadow:'0 18px 50px rgba(0,0,0,0.6)', border:'2px solid rgba(255,255,255,0.28)', zIndex: 30};
  if (pos === 'top_left' || pos === 'top_right') style.top = '6%'; else style.bottom = '7%';
  if (pos === 'top_left' || pos === 'bottom_left') style.left = '4%'; else style.right = '4%';
  return <div style={style}><OffthreadVideo src={props.avatarVideoUrl} muted startFrom={startAt(s)} style={COVER}/></div>;
}
// CAPTIONS — deterministic word-timed lower-third pills built from the avatar
// master's word timestamps (props.captions = [{text,start,end}]). Rendered
// LAST at the root so captions are the TOPMOST layer above every scene
// visual, overlay element and PIP card. KEEP IN SYNC with
// remotion/compositionRuntime.captionAt.
function Captions(props) {
  var frame = useCurrentFrame();
  var chunks = Array.isArray(props.captions) ? props.captions : [];
  if (!chunks.length) return null;
  var t = frame / 30;
  var active = null;
  for (var i = 0; i < chunks.length; i += 1) { var c = chunks[i]; if (c && t >= Number(c.start) - 0.05 && t <= Number(c.end) + 0.25) { active = c; break; } }
  if (!active || !active.text) return null;
  var inO = Math.min(1, Math.max(0, (t - (Number(active.start) - 0.05)) / 0.14));
  return <AbsoluteFill style={{justifyContent:'flex-end', alignItems:'center', paddingBottom:'3.6%', pointerEvents:'none', zIndex: 90}}>
    <div style={{maxWidth:'74%', background:'rgba(6,10,20,0.72)', border:'1.5px solid rgba(255,255,255,0.14)', borderRadius:14, padding:'10px 22px', opacity: inO, fontFamily:"'Inter', system-ui, sans-serif", fontSize: 34, fontWeight: 700, lineHeight: 1.25, color:'#fff', textAlign:'center', textShadow:'0 2px 12px rgba(0,0,0,0.8)'}}>{String(active.text)}</div>
  </AbsoluteFill>;
}
function SceneOverlay(props) {
  var frame = useCurrentFrame();
  var s = props.segment || {};
  var frames = frameCount(s);
  var ts = transitionStyle(s, frame, frames);
  var opacity = ts.opacity;
  var overlay = s.overlay || {};
  var fx = overlay.effect || null;
  var fxStyle = effectStyle(fx, frame, frames);
  // Director-specified Ken Burns wins over the generic preset for stills.
  var kb = s.motion ? kenBurnsStyle(s.motion, frame, frames) : null;
  var stills = (Array.isArray(s.assetUrls) ? s.assetUrls : []).filter(Boolean);
  var isVideo = s.sceneRenderKind === 'video' && s.sceneRenderUrl;
  var showAsset = overlay.showAsset !== false;
  var imageUrl = !isVideo && showAsset ? s.sceneRenderUrl : null;
  var visualWrap = {position:'absolute', inset:0, transform: fxStyle.transform || undefined, opacity: fxStyle.opacity, filter: fxStyle.filter || undefined};
  // PARALLAX = two layers at different speeds: the backdrop counter-drifts
  // gently against the subject so the preset is visibly distinct from a pan.
  var bgStyle = {position:'absolute', inset:'-4%'};
  if (fx && String(fx.preset) === 'parallax') {
    var bk = Number(fx.intensity); if (!(bk > 0)) bk = 1; if (bk > 2) bk = 2;
    var bp = ease(frames > 1 ? frame / frames : 1, fx.easing || 'ease-in-out');
    var bd = dirVec(fx.direction);
    bgStyle.transform = 'translate(' + (-bd.x * 1.6 * bk * (bp - 0.5) * 2) + '%,' + (-bd.y * 1.6 * bk * (bp - 0.5) * 2) + '%) scale(1.06)';
  }
  // OVER-AVATAR MODE: nothing is painted behind the label — the presenter
  // stays fully visible and the callout rides in a safe zone. An optional
  // picked still (icon / product chip) sits in a small corner card on the
  // opposite side, never over the face.
  if (overlay.overAvatar === true && !isVideo) {
    var textPos = String(safeAvatarPos(overlay.position));
    var chipUrl = showAsset ? (imageUrl || (stills.length ? stills[0] : null)) : null;
    var chipOnRight = textPos.indexOf('right') < 0;
    return <AbsoluteFill style={{opacity: opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined, background:'transparent', overflow:'hidden'}}>
      {chipUrl ? <div style={{position:'absolute', bottom:'6%', left: chipOnRight ? undefined : '4%', right: chipOnRight ? '4%' : undefined, width:'16%', aspectRatio:'1 / 1', borderRadius:24, overflow:'hidden', border:'2px solid rgba(255,255,255,0.25)', boxShadow:'0 14px 40px rgba(0,0,0,0.45)'}}><Img src={chipUrl} style={COVER}/></div> : null}
      <OverlayElements overlays={s.overlayElements} frames={frames}/>
      <TextOverlay overlay={overlay} frames={frames} callout={true}/>
    </AbsoluteFill>;
  }
  // COMPOSITION MODES: an overlay/central visual keeps the presenter on
  // screen — the background stays fully transparent (the avatar master is the
  // base layer underneath) and the clip/still rides a positioned card. Any
  // caption travels as a face-safe callout pill instead of a full-width band.
  var comp = s.composition || null;
  var compMode = comp && (String(comp.mode) === 'overlay' || String(comp.mode) === 'central') ? String(comp.mode) : '';
  if (compMode && (isVideo || imageUrl)) {
    // FRAME-ACCURATE CARD CHOREOGRAPHY: the composited card lands with a
    // spring — scale overshoot + settle + short vertical travel — timed by
    // frame so preview and final render agree exactly.
    var cardScale = interpolate(frame, [0, 10, 16], [0.92, 1.015, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    var cardRise = interpolate(frame, [0, 14], [4, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
    var cardStyle = compositionFrameStyle(comp);
    cardStyle.transform = (cardStyle.transform ? cardStyle.transform + ' ' : '') + 'scale(' + cardScale + ') translateY(' + cardRise + '%)';
    return <AbsoluteFill style={{opacity: opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined, background:'transparent', overflow:'hidden'}}>
      <div style={cardStyle}>
        <div style={{position:'absolute', inset:0, transform: (kb && !isVideo ? kb.transform : fxStyle.transform) || undefined, opacity: fxStyle.opacity, filter: fxStyle.filter || undefined}}>
          {isVideo ? <Video src={s.sceneRenderUrl} muted={s.audioMuted !== false} volume={Math.max(0, Math.min(1, Number(s.audioVolume) || 0))} loop style={COVER}/> : <Img src={imageUrl} style={COVER}/>}
        </div>
      </div>
      <OverlayElements overlays={s.overlayElements} frames={frames}/>
      {(overlay.text || overlay.subtext) ? <TextOverlay overlay={overlay} frames={frames} callout={true}/> : null}
    </AbsoluteFill>;
  }
  // COMPOSITED MEDIA: a non-'full' layout crops/masks/scales the scene's clip
  // or still into a framed element over the motion backdrop, with the caption
  // beside it — an AI clip becomes an element inside the scene rather than a
  // full-screen takeover.
  var layout = String(overlay.mediaLayout || 'full');
  var frameStyle = mediaFrameStyle(layout);
  var framed = Boolean(frameStyle) && Boolean(isVideo || imageUrl);
  var textOverride = framed && (!overlay.position || overlay.position === 'lower_third' || overlay.position === 'center') ? mediaTextZone(layout) : null;
  return <AbsoluteFill style={{opacity: opacity, transform: ts.transform || undefined, clipPath: ts.clipPath || undefined, background:'#0A0F1E', overflow:'hidden'}}>
    {framed
      ? [
          <div key="bg" style={bgStyle}>{props.motionBgUrl ? <Video src={props.motionBgUrl} muted loop style={COVER}/> : <AbsoluteFill style={{background:'radial-gradient(1100px 560px at 22% -10%, rgba(59,130,246,0.22), transparent 60%), #0A0F1E'}}/>}</div>,
          <div key="media" style={frameStyle}><div style={{position:'absolute', inset:0, transform: fxStyle.transform || undefined, opacity: fxStyle.opacity, filter: fxStyle.filter || undefined}}>{isVideo ? <Video src={s.sceneRenderUrl} muted={s.audioMuted !== false} volume={Math.max(0, Math.min(1, Number(s.audioVolume) || 0))} loop style={COVER}/> : <Img src={imageUrl} style={COVER}/>}</div></div>
        ]
      : props.motionBgUrl && !isVideo ? <div style={bgStyle}><Video src={props.motionBgUrl} muted loop style={COVER}/></div> : null}
    {framed ? null : isVideo
      ? <div style={visualWrap}><Video src={s.sceneRenderUrl} muted={s.audioMuted !== false} volume={Math.max(0, Math.min(1, Number(s.audioVolume) || 0))} loop style={COVER}/></div>
      : imageUrl
        ? <div style={kb ? {position:'absolute', inset:0, transform: kb.transform || undefined, opacity: fxStyle.opacity} : visualWrap}><Img src={imageUrl} style={COVER}/></div>
        : showAsset && stills.length
          ? <div style={visualWrap}>{stills.map(function (url, j) { return <Img key={url} src={url} style={{position:'absolute',inset:(8+j*3)+'%',width:(84-j*6)+'%',height:(84-j*6)+'%',objectFit:'contain',filter:'drop-shadow(0 22px 30px rgba(0,0,0,.35))'}}/>; })}</div>
          : <AbsoluteFill style={{background:'radial-gradient(1100px 560px at 50% -10%, rgba(59,130,246,0.25), transparent 60%), #0A0F1E'}}/>}
    <LightSweep effect={fx} frames={frames}/>
    <PresenterPip segment={s} avatarVideoUrl={props.avatarVideoUrl}/>
    <OverlayElements overlays={s.overlayElements} frames={frames}/>
    <TextOverlay overlay={overlay} frames={frames} positionOverride={textOverride || undefined}/>
  </AbsoluteFill>;
}
export default function Assembly(props) {
  var p = props || {};
  var avatarVideoUrl = p.avatarVideoUrl;
  var motionBgUrl = p.motionBgUrl;
  var segments = segmentsOf(p);
  var sceneSegments = segments.filter(function (s) { return s && s.type === 'scene'; });
  // Presenter audio is the continuous spine of the film. A scene may
  // explicitly mute it for its window (rare, Director-deliberate); everything
  // else leaves narration untouched — hiding the presenter's PICTURE never
  // touches its AUDIO, so a fullscreen cutaway keeps narrating underneath.
  var muteWindows = [];
  sceneSegments.forEach(function (s) { if (s.presenterMuted === true) muteWindows.push([startAt(s), startAt(s) + frameCount(s)]); });
  var presenterVolume = function (f) {
    for (var i = 0; i < muteWindows.length; i += 1) { if (f >= muteWindows[i][0] && f < muteWindows[i][1]) return 0; }
    return 1;
  };
  return <AbsoluteFill style={{background:'#0A0F1E'}}>
    {avatarVideoUrl ? (muteWindows.length ? <OffthreadVideo src={avatarVideoUrl} volume={presenterVolume} style={COVER}/> : <OffthreadVideo src={avatarVideoUrl} style={COVER}/>) : null}
    {sceneSegments.map(function (s, i) {
      return <Sequence key={i} from={startAt(s)} durationInFrames={frameCount(s)}>
        <SceneOverlay segment={s} motionBgUrl={motionBgUrl} avatarVideoUrl={avatarVideoUrl}/>
      </Sequence>;
    })}
    <Captions captions={p.captions}/>
  </AbsoluteFill>;
}
`;
}
