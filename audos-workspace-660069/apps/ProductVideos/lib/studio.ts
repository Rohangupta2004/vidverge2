// Product Videos — the studio viewer.
//
// Two halves:
//   1. JOB WATCH — watchAdJob() polls the pv_projects row every 3 seconds for
//      the server pipeline's status/stage, nudges a run whose chain went
//      quiet, and hands the finished MP4 URL to the player the moment
//      video_url lands. The browser never drives the render — it only reads.
//   2. PLAYER — a self-contained HTML document rendered inside an
//      <iframe srcDoc> panel INSIDE the app (never a new tab): play/pause,
//      frame-accurate scrubbing, live frame/time readout, volume (voiceover +
//      ducked music bed audible), and fullscreen. Playback does NOT loop —
//      looping is an explicit opt-in on the transport.
// srcDoc is same-origin so no CORS proxy is required for the embed itself.

import { APP_HEADER_LOGO_URL } from './prompts';
import {
  adPhaseKey,
  adStageLabel,
  isAdJobDone,
  isAdJobFailed,
  isAdJobLive,
  isAdJobPreview,
  nudgeAdJob,
  readAdProject,
  type AdPhase,
  type AdProjectRow,
} from './renderJob';

// ---------------------------------------------------------------------------
// Job watch — the studio's poll over pv_projects.
// ---------------------------------------------------------------------------

export interface AdJobView {
  project: AdProjectRow;
  phase: AdPhase;
  stageLabel: string;
  live: boolean;
  done: boolean;
  failed: boolean;
  /** Waiting in the preview studio for the founder's approve / change note. */
  preview: boolean;
  videoUrl: string | null;
}

function toView(project: AdProjectRow): AdJobView {
  const done = isAdJobDone(project.status) && !!project.video_url;
  return {
    project,
    phase: adPhaseKey(project),
    stageLabel: adStageLabel(project),
    live: isAdJobLive(project.status),
    done,
    failed: isAdJobFailed(project.status),
    preview: isAdJobPreview(project.status),
    videoUrl: done ? String(project.video_url) : null,
  };
}

/** One poll of the job row. */
export async function pollAdJob(projectId: number): Promise<AdJobView | null> {
  const row = await readAdProject(projectId);
  return row ? toView(row) : null;
}

/**
 * Watch a job until it finishes or fails: polls pv_projects every 3 seconds,
 * nudges the server chain back to life when the row sits still for ~45s, and
 * reports every read through onUpdate. Returns a stop function. Closing the
 * tab loses nothing — the pipeline is server-side; reopening resumes the watch.
 */
export function watchAdJob(projectId: number, onUpdate: (view: AdJobView) => void): () => void {
  let stopped = false;
  let stalledPolls = 0;
  const poll = async () => {
    try {
      const view = await pollAdJob(projectId);
      if (stopped || !view) return;
      onUpdate(view);
      if (view.done || view.failed || view.preview) {
        stopped = true;
        window.clearInterval(timer);
        return;
      }
      const idleMs = Date.now() - new Date(view.project.updated_at || Date.now()).getTime();
      stalledPolls = idleMs > 45000 ? stalledPolls + 1 : 0;
      if (stalledPolls >= 5) {
        stalledPolls = 0;
        nudgeAdJob(projectId).catch(() => undefined);
      }
    } catch {
      // a dropped poll is simply repainted by the next one
    }
  };
  void poll();
  const timer = window.setInterval(() => { void poll(); }, 3000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------
// THE PREVIEW STUDIO — a real in-browser Remotion Player over the coding
// agent's composition, BEFORE anything renders on the server. The iframe
// carries its own import map (react + remotion + @remotion/player from
// esm.sh, all sharing one React), transpiles the agent's TSX with sucrase,
// mounts it in <Player> with scrubbing/controls, and the founder either
// approves the server render or sends the agent a change note.
// ---------------------------------------------------------------------------
const REMOTION_VERSION = '4.0.220';
const REACT_VERSION = '18.2.0';

export function buildRemotionPlayerSrcDoc(options: {
  compositionTsx: string;
  durationInFrames: number;
  fps: number;
  title: string;
}): string {
  // </script> inside the payload would end the tag early; \u003c-escape it.
  const cfg = JSON.stringify({
    code: options.compositionTsx,
    durationInFrames: options.durationInFrames,
    fps: options.fps,
    title: options.title,
  }).replace(/</g, '\\u003c');

  const importMap = JSON.stringify({
    imports: {
      react: `https://esm.sh/react@${REACT_VERSION}`,
      'react/jsx-runtime': `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
      'react-dom': `https://esm.sh/react-dom@${REACT_VERSION}?deps=react@${REACT_VERSION}`,
      'react-dom/client': `https://esm.sh/react-dom@${REACT_VERSION}/client?deps=react@${REACT_VERSION}`,
      remotion: `https://esm.sh/remotion@${REMOTION_VERSION}?external=react,react-dom`,
      '@remotion/player': `https://esm.sh/@remotion/player@${REMOTION_VERSION}?external=react,react-dom,remotion`,
    },
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #05070C; overflow: hidden; }
  body { font-family: 'Inter', system-ui, sans-serif; color: #F0F0F0; display: flex; flex-direction: column; }
  .bar { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: #0F1420; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; font-weight: 600; }
  .badge { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; color: #F5B936; background: rgba(245,185,54,0.12); border: 1px solid rgba(245,185,54,0.3); }
  #stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 10px; }
  #stage > div { width: 100%; height: 100%; }
  #msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 40px; font-size: 13px; line-height: 1.6; color: rgba(240,240,240,0.75); background: #05070C; }
</style>
<script type="importmap">${importMap}</script>
</head>
<body>
  <div class="bar"><span id="title"></span><span class="badge">LIVE PREVIEW \u00b7 nothing rendered yet</span></div>
  <div id="stage"></div>
  <div id="msg">Loading the preview studio\u2026<br/>(fetching the Remotion player and compiling the agent's composition)</div>
<script type="module">
  const cfg = ${cfg};
  document.getElementById('title').textContent = cfg.title + ' \u00b7 ' + cfg.durationInFrames + ' frames @ ' + cfg.fps + 'fps';
  const msg = document.getElementById('msg');
  const fail = (why) => { msg.innerHTML = '<div>The in-browser preview could not start:<br/><b>' + String(why).replace(/</g, '&lt;').slice(0, 400) + '</b><br/><br/>You can still ask the agent for changes or approve the server render from the panel beside this preview.</div>'; };
  window.addEventListener('error', (e) => fail(e.message || 'script error'));
  try {
    const [React, { createRoot }, { Player }, { transform }] = await Promise.all([
      import('react').then((m) => m.default || m),
      import('react-dom/client'),
      import('@remotion/player'),
      import('https://esm.sh/sucrase@3.35.0'),
    ]);
    const js = transform(cfg.code, { transforms: ['typescript', 'jsx'], jsxRuntime: 'classic', production: true }).code;
    const blobUrl = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    const mod = await import(blobUrl);
    const Comp = mod.default;
    if (!Comp) throw new Error('the composition has no default export');
    msg.style.display = 'none';
    createRoot(document.getElementById('stage')).render(
      React.createElement(Player, {
        component: Comp,
        durationInFrames: cfg.durationInFrames,
        fps: cfg.fps,
        compositionWidth: 1920,
        compositionHeight: 1080,
        controls: true,
        loop: false,
        clickToPlay: true,
        acknowledgeRemotionLicense: true,
        style: { width: '100%', height: '100%' },
      }),
    );
  } catch (err) {
    fail((err && err.message) || err);
  }
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Player — the embedded transport over the finished MP4.
// ---------------------------------------------------------------------------

export interface StudioDocOptions {
  videoUrl: string;
  title: string;
  fps: number;
  durationInFrames: number;
  vertical: boolean;
}

// ---------------------------------------------------------------------------
// App-chrome branding for the studio panel (NOT video content). All brand
// values live HERE as named constants — nothing brand-specific hides inside
// the template logic below. The logo is the same app-header mark the rest of
// the app uses (single source: lib/prompts.APP_HEADER_LOGO_URL, which mirrors
// workspace-branding.json), and the accent is the VidVerge gold from
// config.json's desktop.themeTokens.
// ---------------------------------------------------------------------------
const STUDIO_LOGO_URL = APP_HEADER_LOGO_URL;
const STUDIO_ACCENT = '#F5B936';
const studioAccentSoft = (alpha: number) => `rgba(245,185,54,${alpha})`;
const STUDIO_LOGO_GLOW = 'rgba(212,175,55,0.6)';

export function buildStudioSrcDoc(options: StudioDocOptions): string {
  const config = JSON.stringify({
    videoUrl: options.videoUrl,
    title: options.title,
    fps: options.fps,
    durationInFrames: options.durationInFrames,
    vertical: options.vertical,
  });

  // NOTE: the inline script below intentionally avoids template literals so
  // this outer template stays trivially escapable.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #0B0F17; overflow: hidden; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #F0F0F0; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: #0F1420; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .bar .name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar .name img { width: 18px; height: 18px; object-fit: contain; filter: drop-shadow(0 0 8px ${STUDIO_LOGO_GLOW}); }
  .badge { flex-shrink: 0; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; color: ${STUDIO_ACCENT}; background: ${studioAccentSoft(0.12)}; border: 1px solid ${studioAccentSoft(0.3)}; }
  .stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(900px 480px at 50% 0%, rgba(99,102,241,0.10), transparent 65%), #05070C; }
  video { max-width: 100%; max-height: 100%; background: #000; box-shadow: 0 24px 70px rgba(0,0,0,0.6); }
  video.vertical { height: 100%; aspect-ratio: 9 / 16; object-fit: cover; }
  .deck { background: #0F1420; border-top: 1px solid rgba(255,255,255,0.08); padding: 8px 12px 10px; }
  .ruler { position: relative; height: 26px; border-radius: 6px; background: #161F30; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; cursor: pointer; }
  .ticks { position: absolute; inset: 0; display: flex; }
  .ticks i { flex: 1; border-left: 1px solid rgba(255,255,255,0.07); }
  .fill { position: absolute; inset: 0 auto 0 0; width: 0%; background: linear-gradient(90deg, ${studioAccentSoft(0.30)}, ${studioAccentSoft(0.55)}); pointer-events: none; }
  .head { position: absolute; top: 0; bottom: 0; width: 2px; background: ${STUDIO_ACCENT}; box-shadow: 0 0 10px ${studioAccentSoft(0.8)}; pointer-events: none; }
  .controls { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #161F30; color: #F0F0F0; cursor: pointer; font-size: 13px; }
  button:hover { border-color: ${studioAccentSoft(0.5)}; }
  button.on { color: ${STUDIO_ACCENT}; border-color: ${studioAccentSoft(0.5)}; }
  .readout { font-variant-numeric: tabular-nums; font-size: 11px; color: rgba(240,240,240,0.65); white-space: nowrap; }
  .readout b { color: ${STUDIO_ACCENT}; font-weight: 700; }
  .spacer { flex: 1; }
  input[type=range] { width: 88px; accent-color: ${STUDIO_ACCENT}; }
</style>
</head>
<body>
  <div class="bar">
    <span class="name"><img src="${STUDIO_LOGO_URL}" alt="" /><span id="title"></span></span>
    <span class="badge" id="geometry"></span>
  </div>
  <div class="stage" id="stage">
    <video id="video" playsinline preload="auto"></video>
  </div>
  <div class="deck">
    <div class="ruler" id="ruler">
      <div class="ticks" id="ticks"></div>
      <div class="fill" id="fill"></div>
      <div class="head" id="head"></div>
    </div>
    <div class="controls">
      <button id="play" title="Play / pause (space)">\u25B6</button>
      <button id="back" title="Back 1s">\u23EA</button>
      <button id="fwd" title="Forward 1s">\u23E9</button>
      <span class="readout">frame <b id="frame">0</b> / <span id="frames"></span> &nbsp;\u00B7&nbsp; <span id="time">0:00.0</span></span>
      <span class="spacer"></span>
      <button id="loop" title="Loop">\u21BB</button>
      <input type="range" id="volume" min="0" max="1" step="0.05" value="1" title="Volume" />
      <button id="full" title="Fullscreen">\u26F6</button>
    </div>
  </div>
<script>
(function () {
  var config = ${config};
  var video = document.getElementById('video');
  var play = document.getElementById('play');
  var loop = document.getElementById('loop');
  var full = document.getElementById('full');
  var back = document.getElementById('back');
  var fwd = document.getElementById('fwd');
  var volume = document.getElementById('volume');
  var ruler = document.getElementById('ruler');
  var fill = document.getElementById('fill');
  var head = document.getElementById('head');
  var frameEl = document.getElementById('frame');
  var timeEl = document.getElementById('time');

  document.getElementById('title').textContent = config.title;
  document.getElementById('frames').textContent = String(config.durationInFrames);
  document.getElementById('geometry').textContent = (config.vertical ? '9:16 \u00B7 1080\u00D71920' : '16:9 \u00B7 1920\u00D71080') + ' \u00B7 ' + config.fps + 'fps';

  var ticks = document.getElementById('ticks');
  var seconds = Math.max(1, Math.round(config.durationInFrames / config.fps));
  for (var i = 0; i < seconds; i++) { ticks.appendChild(document.createElement('i')); }

  video.src = config.videoUrl;
  video.loop = false;
  if (config.vertical) video.className = 'vertical';

  function format(t) {
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  var raf = null;
  function sync() {
    var duration = video.duration || (config.durationInFrames / config.fps);
    var progress = duration ? Math.min(1, video.currentTime / duration) : 0;
    fill.style.width = (progress * 100) + '%';
    head.style.left = 'calc(' + (progress * 100) + '% - 1px)';
    frameEl.textContent = String(Math.min(config.durationInFrames, Math.round(video.currentTime * config.fps)));
    timeEl.textContent = format(video.currentTime || 0);
    raf = requestAnimationFrame(sync);
  }
  raf = requestAnimationFrame(sync);

  function toggle() {
    if (video.paused) { video.play(); } else { video.pause(); }
  }
  video.addEventListener('play', function () { play.textContent = '\u23F8'; });
  video.addEventListener('pause', function () { play.textContent = '\u25B6'; });
  play.addEventListener('click', toggle);
  back.addEventListener('click', function () { video.currentTime = Math.max(0, video.currentTime - 1); });
  fwd.addEventListener('click', function () { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 1); });
  loop.addEventListener('click', function () {
    video.loop = !video.loop;
    loop.className = video.loop ? 'on' : '';
  });
  volume.addEventListener('input', function () { video.volume = Number(volume.value); });
  full.addEventListener('click', function () {
    var stage = document.getElementById('stage');
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (stage.requestFullscreen) { stage.requestFullscreen(); }
    else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); }
  });

  function scrub(event) {
    var rect = ruler.getBoundingClientRect();
    var x = (event.touches ? event.touches[0].clientX : event.clientX) - rect.left;
    var progress = Math.max(0, Math.min(1, x / rect.width));
    var duration = video.duration || (config.durationInFrames / config.fps);
    video.currentTime = progress * duration;
  }
  var dragging = false;
  ruler.addEventListener('mousedown', function (e) { dragging = true; scrub(e); });
  window.addEventListener('mousemove', function (e) { if (dragging) scrub(e); });
  window.addEventListener('mouseup', function () { dragging = false; });
  ruler.addEventListener('touchstart', function (e) { scrub(e); }, { passive: true });
  ruler.addEventListener('touchmove', function (e) { scrub(e); }, { passive: true });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.code === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 1 / config.fps); }
    if (e.code === 'ArrowRight') { video.currentTime = video.currentTime + 1 / config.fps; }
  });

  // Autoplay with audio is blocked until a gesture in most browsers; start
  // muted-paused and let the customer press play so the voiceover and music
  // bed are audible from the first frame they hear.
})();
</script>
</body>
</html>`;
}
