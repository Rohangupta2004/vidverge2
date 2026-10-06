/**
 * Short Video Enhancer — the WYSIWYG preview canvas.
 *
 * The centre of the editor is a real Remotion <Player /> running the real
 * composition inside an <iframe srcDoc>. The iframe pins its own React +
 * Remotion from esm.sh, sucrase transpiles lib/composition.ts's TSX, and the
 * Player mounts it at compositionWidth 1080 x compositionHeight 1920 — the
 * exact native geometry of the export.
 *
 * The document is built ONCE per editing session (the composition text never
 * changes; only its props do), and every edit is pushed in as new inputProps
 * over postMessage. That keeps scrubbing live and, more importantly, means the
 * creator is not watching a re-implementation of the renderer — they are
 * watching the renderer.
 *
 * Message protocol:
 *   parent -> frame   sve:props { props, durationInFrames }
 *                     sve:seek  { frame } | sve:play | sve:pause | sve:toggle
 *   frame  -> parent  sve:ready | sve:frame { frame } | sve:playing { playing }
 *                     sve:error { message }
 */

import { CANVAS_H, CANVAS_W, FPS } from './model';
import { SVE_COMPOSITION_TSX } from './composition';

const REMOTION_VERSION = '4.0.220';
const REACT_VERSION = '18.2.0';

export const SVE_MSG = {
  props: 'sve:props',
  seek: 'sve:seek',
  play: 'sve:play',
  pause: 'sve:pause',
  toggle: 'sve:toggle',
  ready: 'sve:ready',
  frame: 'sve:frame',
  playing: 'sve:playing',
  error: 'sve:error',
} as const;

/**
 * Build the preview document. Mount it with `<iframe srcDoc={...} />` and no
 * sandbox attribute: the document needs its own origin privileges to import the
 * transpiled composition from a blob URL and to postMessage back to the editor,
 * and the page's own CSP still governs what it may load.
 */
export function buildPreviewSrcDoc(initialProps: unknown, durationInFrames: number, showControls = true): string {
  const cfg = JSON.stringify({
    code: SVE_COMPOSITION_TSX,
    props: initialProps || {},
    durationInFrames: Math.max(1, Math.round(durationInFrames || FPS)),
    fps: FPS,
    width: CANVAS_W,
    height: CANVAS_H,
    controls: !!showControls,
  }).replace(/</g, '\\u003c');

  const importMap = JSON.stringify({
    imports: {
      react: 'https://esm.sh/react@' + REACT_VERSION,
      'react/jsx-runtime': 'https://esm.sh/react@' + REACT_VERSION + '/jsx-runtime',
      'react-dom': 'https://esm.sh/react-dom@' + REACT_VERSION + '?deps=react@' + REACT_VERSION,
      'react-dom/client': 'https://esm.sh/react-dom@' + REACT_VERSION + '/client?deps=react@' + REACT_VERSION,
      remotion: 'https://esm.sh/remotion@' + REMOTION_VERSION + '?external=react,react-dom',
      // @remotion/player also imports the 'remotion/no-react' SUBPATH, and an
      // import map resolves specifiers exactly rather than by prefix — leaving
      // this entry out stops the player module loading at all.
      'remotion/no-react': 'https://esm.sh/remotion@' + REMOTION_VERSION + '/no-react?external=react,react-dom',
      '@remotion/player': 'https://esm.sh/@remotion/player@' + REMOTION_VERSION + '?external=react,react-dom,remotion',
    },
  });

  return '<!DOCTYPE html>\n' +
    '<html><head><meta charset="utf-8" />\n' +
    '<style>\n' +
    '  * { box-sizing: border-box; margin: 0; padding: 0; }\n' +
    '  html, body { width: 100%; height: 100%; background: #05070C; overflow: hidden; }\n' +
    '  body { font-family: Inter, system-ui, sans-serif; color: #EEF1F7; }\n' +
    '  #stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }\n' +
    '  #stage > div { width: 100%; height: 100%; }\n' +
    '  #msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 28px; font-size: 12.5px; line-height: 1.6; color: rgba(238,241,247,0.72); background: #05070C; }\n' +
    '  #msg b { color: #FBBF24; font-weight: 600; }\n' +
    '</style>\n' +
    '<script type="importmap">' + importMap + '</script>\n' +
    '</head><body>\n' +
    '<div id="stage"></div>\n' +
    '<div id="msg">Starting the 1080\u00d71920 preview engine\u2026</div>\n' +
    '<script type="module">\n' +
    'const CFG = ' + cfg + ';\n' +
    'const msg = document.getElementById("msg");\n' +
    'const tell = (type, extra) => { try { parent.postMessage(Object.assign({ type: type }, extra || {}), "*"); } catch (e) {} };\n' +
    'const fail = (why) => { const s = String(why || "unknown error"); msg.style.display = "flex"; msg.innerHTML = "<div>The preview engine could not start:<br/><b>" + s.replace(/[<]/g, "&lt;").slice(0, 400) + "</b></div>"; tell("sve:error", { message: s }); };\n' +
    'window.addEventListener("error", (e) => fail(e.message || "script error"));\n' +
    'try {\n' +
    '  const [React, { createRoot }, { Player }, { transform }] = await Promise.all([\n' +
    '    import("react").then((m) => m.default || m),\n' +
    '    import("react-dom/client"),\n' +
    '    import("@remotion/player"),\n' +
    '    import("https://esm.sh/sucrase@3.35.0"),\n' +
    '  ]);\n' +
    '  const js = transform(CFG.code, { transforms: ["typescript", "jsx"], jsxRuntime: "classic", production: true }).code;\n' +
    '  const mod = await import(URL.createObjectURL(new Blob([js], { type: "text/javascript" })));\n' +
    '  const Comp = mod.default;\n' +
    '  if (!Comp) throw new Error("the composition has no default export");\n' +
    '  const { useEffect, useRef, useState } = React;\n' +
    '  function Host() {\n' +
    '    const [state, setState] = useState({ props: CFG.props, duration: CFG.durationInFrames });\n' +
    '    const ref = useRef(null);\n' +
    '    useEffect(() => {\n' +
    '      const onMessage = (event) => {\n' +
    '        const d = event.data || {};\n' +
    '        const pl = ref.current;\n' +
    '        if (d.type === "sve:props") { setState({ props: d.props || {}, duration: Math.max(1, Math.round(d.durationInFrames || 1)) }); return; }\n' +
    '        if (!pl) return;\n' +
    '        try {\n' +
    '          if (d.type === "sve:seek") pl.seekTo(Math.max(0, Math.round(d.frame || 0)));\n' +
    '          else if (d.type === "sve:play") pl.play();\n' +
    '          else if (d.type === "sve:pause") pl.pause();\n' +
    '          else if (d.type === "sve:toggle") pl.toggle();\n' +
    '        } catch (e) {}\n' +
    '      };\n' +
    '      window.addEventListener("message", onMessage);\n' +
    '      tell("sve:ready");\n' +
    '      return () => window.removeEventListener("message", onMessage);\n' +
    '    }, []);\n' +
    '    useEffect(() => {\n' +
    '      const pl = ref.current;\n' +
    '      if (!pl || !pl.addEventListener) return;\n' +
    '      const onFrame = (e) => tell("sve:frame", { frame: (e && e.detail && e.detail.frame) || 0 });\n' +
    '      const onPlay = () => tell("sve:playing", { playing: true });\n' +
    '      const onPause = () => tell("sve:playing", { playing: false });\n' +
    '      pl.addEventListener("frameupdate", onFrame);\n' +
    '      pl.addEventListener("play", onPlay);\n' +
    '      pl.addEventListener("pause", onPause);\n' +
    '      return () => { try { pl.removeEventListener("frameupdate", onFrame); pl.removeEventListener("play", onPlay); pl.removeEventListener("pause", onPause); } catch (e) {} };\n' +
    '    });\n' +
    '    return React.createElement(Player, {\n' +
    '      ref: ref,\n' +
    '      component: Comp,\n' +
    '      inputProps: state.props,\n' +
    '      durationInFrames: state.duration,\n' +
    '      fps: CFG.fps,\n' +
    '      compositionWidth: CFG.width,\n' +
    '      compositionHeight: CFG.height,\n' +
    '      controls: CFG.controls,\n' +
    '      loop: false,\n' +
    '      clickToPlay: true,\n' +
    '      acknowledgeRemotionLicense: true,\n' +
    '      style: { width: "100%", height: "100%" },\n' +
    '    });\n' +
    '  }\n' +
    '  msg.style.display = "none";\n' +
    '  createRoot(document.getElementById("stage")).render(React.createElement(Host));\n' +
    '} catch (err) { fail((err && err.message) || err); }\n' +
    '</script>\n' +
    '</body></html>';
}
