import type { Asset, Project, Scene } from '../lib/supabase';

export interface TimelineSegment { type: 'avatar' | 'scene'; startFrame: number; frames: number; startSec: number; sceneId?: string; assetUrls?: string[]; sceneRenderUrl?: string; sceneRenderKind?: 'video' | 'image' }

// Decide from the URL itself, not from "this scene has code": a scene whose
// motion render failed keeps its still, and playing a PNG through <Video>
// renders nothing at all.
const looksLikeVideo = (url?: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

/** A time in seconds that is safe to do arithmetic with: never NaN, never negative. */
const sec = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };

export function buildTimeline(project: Project, scenes: Scene[], assets: Asset[], fps = 30): TimelineSegment[] {
  const sceneRows = (Array.isArray(scenes) ? scenes : []).filter(Boolean);
  const assetRows = (Array.isArray(assets) ? assets : []).filter(Boolean);
  const approved = sceneRows.filter((scene) => scene.approved).sort((a, b) => sec(a.script_start_sec) - sec(b.script_start_sec));
  // A project that never recorded a duration still has to produce a timeline,
  // so the scenes themselves are the fallback length.
  const declared = sec(project?.avatar_duration_sec) || sec(project?.estimated_duration_sec) || sec(project?.target_length_sec);
  const lastSceneEnd = approved.reduce((longest, scene) => Math.max(longest, sec(scene.script_end_sec)), 0);
  const duration = declared > 0 ? declared : lastSceneEnd;
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  approved.forEach((scene) => {
    const start = sec(scene.script_start_sec);
    // An empty or inverted range would ask Remotion for a zero-length
    // sequence, which fails the whole render; one frame is the floor.
    const end = Math.max(start + 1 / fps, sec(scene.script_end_sec));
    const gapFrames = Math.round((start - cursor) * fps);
    if (gapFrames > 0) segments.push({ type: 'avatar', startSec: cursor, startFrame: Math.round(cursor * fps), frames: gapFrames });
    const hasCodedRender = looksLikeVideo(scene.render_url);
    segments.push({
      type: 'scene',
      sceneId: scene.id,
      startSec: start,
      startFrame: Math.round(start * fps),
      frames: Math.max(1, Math.round((end - start) * fps)),
      assetUrls: assetRows.filter((asset) => asset.scene_id === scene.id).map((asset) => asset.public_url).filter(Boolean) as string[],
      ...(scene.render_url ? { sceneRenderUrl: scene.render_url, sceneRenderKind: hasCodedRender ? 'video' as const : 'image' as const } : {}),
    });
    cursor = Math.max(cursor, end);
  });
  const tailFrames = Math.round((duration - cursor) * fps);
  if (tailFrames > 0) segments.push({ type: 'avatar', startSec: cursor, startFrame: Math.round(cursor * fps), frames: tailFrames });
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
 * The composition source handed to /api/render/remotion.
 *
 * The platform resolves `calculateDemoVideoDuration` without props before it
 * renders the first frame. The callback therefore treats a missing timeline
 * as normal and returns the same safe duration baked into the submit request.
 * With props, it derives the furthest segment end and clamps it to the
 * renderer's 1–18000 frame contract.
 */
export function createAssemblySource(fallbackDurationInFrames = 900) {
  const fallback = Math.max(1, Math.min(18000, Math.round(Number(fallbackDurationInFrames) || 900)));
  return `import React from 'react'; import {AbsoluteFill,Audio,Img,OffthreadVideo,Sequence,Video} from 'remotion';
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
export default function Assembly(props) {
  var p = props || {};
  var avatarVideoUrl = p.avatarVideoUrl;
  var motionBgUrl = p.motionBgUrl;
  var segments = segmentsOf(p);
  var list = segments.length ? segments : [{type:'avatar',startFrame:0,frames:FALLBACK_FRAMES}];
  return <AbsoluteFill style={{background:'#0A0F1E'}}>{list.map(function (s, i) {
    var from = startAt(s);
    var frames = frameCount(s);
    var stills = (Array.isArray(s.assetUrls) ? s.assetUrls : []).filter(Boolean);
    return <Sequence key={i} from={from} durationInFrames={frames}>{s.type === 'avatar'
      ? (avatarVideoUrl ? <OffthreadVideo src={avatarVideoUrl} startFrom={from} style={{width:'100%',height:'100%',objectFit:'cover'}}/> : null)
      : <AbsoluteFill>
        {motionBgUrl ? <Video src={motionBgUrl} muted loop style={{width:'100%',height:'100%',objectFit:'cover'}}/> : null}
        {s.sceneRenderUrl
          ? (s.sceneRenderKind === 'video'
            ? <Video src={s.sceneRenderUrl} muted style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            : <Img src={s.sceneRenderUrl} style={{width:'100%',height:'100%',objectFit:'cover'}}/>)
          : stills.map(function (url, j) { return <Img key={url} src={url} style={{position:'absolute',inset:(8+j*3)+'%',width:(84-j*6)+'%',height:(84-j*6)+'%',objectFit:'contain',filter:'drop-shadow(0 22px 30px rgba(0,0,0,.35))'}}/>; })}
        {avatarVideoUrl ? <Audio src={avatarVideoUrl} startFrom={from}/> : null}
      </AbsoluteFill>}</Sequence>;
  })}</AbsoluteFill>;
}
`;
}
