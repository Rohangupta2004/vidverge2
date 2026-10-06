// playerFrame — the 60fps preview.
//
// The film is mounted in a same-origin <iframe srcDoc> that pins its own
// react + remotion + @remotion/player from esm.sh, transpiles the composition
// source with sucrase and hands it to the real Remotion <Player /> with the
// live script as inputProps. Nothing about the film is baked into this
// document: it receives the same source string and the same props object the
// MP4 render is submitted with, which is what makes the preview binding.

const REMOTION_VERSION = '4.0.220';
const REACT_VERSION = '18.2.0';

export interface PlayerFrameOptions {
  compositionTsx: string;
  props: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  accent: string;
}

export function buildPlayerFrame(options: PlayerFrameOptions): string {
  // A literal '<' inside the payload could end the script tag early.
  const cfg = JSON.stringify({
    code: options.compositionTsx,
    props: options.props,
    durationInFrames: Math.max(1, Math.round(options.durationInFrames)),
    fps: Math.max(1, Math.round(options.fps)),
  }).replace(/</g, '\\u003c');

  const accent = options.accent || '#F59E0B';

  const importMap = JSON.stringify({
    imports: {
      react: `https://esm.sh/react@${REACT_VERSION}`,
      'react/jsx-runtime': `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
      'react-dom': `https://esm.sh/react-dom@${REACT_VERSION}?deps=react@${REACT_VERSION}`,
      'react-dom/client': `https://esm.sh/react-dom@${REACT_VERSION}/client?deps=react@${REACT_VERSION}`,
      remotion: `https://esm.sh/remotion@${REMOTION_VERSION}?external=react,react-dom`,
      // @remotion/player built with external=remotion imports the SUBPATH
      // 'remotion/no-react' as well as bare 'remotion'. An import map resolves
      // specifiers exactly, never by prefix, so without this entry the player
      // module never loads at all.
      'remotion/no-react': `https://esm.sh/remotion@${REMOTION_VERSION}/no-react?external=react,react-dom`,
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
  body { font-family: Inter, system-ui, sans-serif; color: #F0F2F6; display: flex; flex-direction: column; }
  #stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  #stage > div { width: 100%; height: 100%; }
  #msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 40px; font-size: 13px; line-height: 1.6; color: rgba(240,242,246,0.75); background: #05070C; }
  #msg b { color: ${accent}; }
</style>
<script type="importmap">${importMap}</script>
</head>
<body>
  <div id="stage"></div>
  <div id="msg">Mounting your film…</div>
<script type="module">
  const cfg = ${cfg};
  const msg = document.getElementById('msg');
  const fail = (why) => { msg.innerHTML = '<div>The preview could not start:<br/><b>' + String(why).replace(/</g, '&lt;').slice(0, 400) + '</b></div>'; };
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
        inputProps: cfg.props,
        durationInFrames: cfg.durationInFrames,
        fps: cfg.fps,
        compositionWidth: 1920,
        compositionHeight: 1080,
        controls: true,
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
