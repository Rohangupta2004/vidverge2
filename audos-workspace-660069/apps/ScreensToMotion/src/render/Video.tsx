/**
 * Video root — emitted verbatim into the rendered composition.
 *
 * Owns the ground (palette washes with sub-pixel drift), the ONE global
 * finishing pass (grain 2–4% + vignette, identical strength over BOTH the UI
 * and footage layers, applied after every composite — never two passes),
 * scene sequencing, the music bed with −12dB ducking under clip audio, and
 * the >= 20-frame final hold at rest.
 *
 * Cutting rules (Phase 2 §5/§6):
 * - footage is NEVER cross-dissolved into UI — any boundary that touches a
 *   clip scene is a hard cut; screen↔screen keeps the preset crossfade,
 *   except when a beat grid is active (cuts must sit ON the beat, so every
 *   boundary is a hard cut and continuity comes from motion carry instead).
 * - out.carry: the outgoing scene's camera velocity continues into the
 *   incoming scene — a decaying entrance offset in the carried direction.
 * - dipIn: a 4-frame dip masks any >12% luminance mismatch at a boundary.
 */
export const VIDEO_TSX = `
const Ground = ({ theme, ground, width, height }) => {
  const frame = useCurrentFrame();
  const drift = { x: Math.sin(frame / 90) * 0.9, y: Math.cos(frame / 110) * 0.9 };
  const washB = withAlpha(theme.accent, 0.14);
  const washA = withAlpha(theme.isDark ? mixHex(theme.paper, '#ffffff', 0.22) : theme.paper, 0.14);
  const base = theme.isDark ? mixHex(theme.paper, '#000000', 0.55) : mixHex(theme.paper, '#000000', 0.06);
  return (
    <AbsoluteFill style={{ background: base }}>
      <div style={{
        position: 'absolute', inset: -40,
        transform: 'translate(' + drift.x + 'px,' + drift.y + 'px)',
        background: ground.style === 'flat' ? 'none'
          : 'radial-gradient(52% 44% at 24% 22%, ' + washB + ', transparent 70%), radial-gradient(46% 52% at 78% 76%, ' + washA + ', transparent 72%)',
      }} />
    </AbsoluteFill>
  );
};

// ONE global finishing pass over every layer — grain 2–4% and the vignette at
// identical strength on both the UI and footage sides, applied AFTER every
// composite (including blank-plate corner pins). Never a second pass.
const FinishLayer = ({ theme, ground }) => {
  const grain = Math.min(0.04, Math.max(0.02, ground.grain || 0.03));
  const vig = Math.min(0.1, Math.max(0, ground.vignette || 0.04));
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: GRAIN_URI, backgroundSize: '240px 240px', opacity: grain, mixBlendMode: theme.isDark ? 'screen' : 'multiply' }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: theme.isDark
          ? 'radial-gradient(72% 72% at 50% 46%, rgba(255,255,255,' + (vig * 0.9) + '), transparent 62%)'
          : 'radial-gradient(120% 120% at 50% 50%, transparent 62%, rgba(0,0,0,' + vig + '))',
      }} />
    </AbsoluteFill>
  );
};

// The render service resolves the composition by mounting it once WITHOUT
// props, so every prop access needs a safe fallback or registration fails
// with COMPOSITION_INVALID.
const EMPTY_PLAN = {
  meta: { title: '', fps: 30, width: 1920, height: 1080 },
  motion: 'snappy',
  theme: { source: 'derived', accent: '#3B82F6', isDark: false },
  ground: { style: 'mesh', from: 'palette', grain: 0.03, vignette: 0.04 },
  scenes: [],
};

const carryTransformFor = (carry, local) => {
  if (!carry || local < 0 || local >= 12) return 'none';
  const t = smoothstep(clamp01(local / 12));
  const d = 60 * (1 - t);
  if (carry === 'left') return 'translateX(' + d + 'px)';
  if (carry === 'right') return 'translateX(' + (-d) + 'px)';
  if (carry === 'up') return 'translateY(' + d + 'px)';
  if (carry === 'down') return 'translateY(' + (-d) + 'px)';
  if (carry === 'in') return 'scale(' + (1 + 0.045 * (1 - t)) + ')';
  if (carry === 'out') return 'scale(' + (1 - 0.04 * (1 - t)) + ')';
  return 'none';
};

export default function ScreensToMotion(props) {
  const safeProps = props || {};
  const plan = safeProps.plan || EMPTY_PLAN;
  const images = safeProps.images || [];
  const analyses = safeProps.analyses || [];
  const clips = safeProps.clips || [];
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const preset = MOTION_PRESETS[plan.motion] || MOTION_PRESETS.snappy;
  const theme = deriveThemeData(plan, analyses || []);
  const imagesById = {};
  (images || []).forEach((img) => { imagesById[img.screenId] = img; });
  const analysesById = {};
  (analyses || []).forEach((a) => { analysesById[a.screenId] = a; });
  const clipsById = {};
  (clips || []).forEach((c) => { clipsById[c.clipId] = c; });
  const isClip = (s) => !!s && s.kind === 'clip';
  const uiGrade = plan.uiGrade;
  const gradeFilter = uiGrade
    ? 'contrast(' + uiGrade.contrast + ') brightness(' + uiGrade.brightness + ') saturate(' + uiGrade.saturate + ')'
    : '';

  let cursorFrame = 0;
  const placed = (plan.scenes || []).map((scene, index) => {
    const prev = index > 0 ? plan.scenes[index - 1] : null;
    const hardCut = !!plan.sync || isClip(scene) || (prev && isClip(prev));
    const overlap = index > 0 && !hardCut ? preset.crossfade : 0;
    // The overlap belongs to the boundary between prev and this scene: start
    // overlap/2 early so the dissolve straddles the cut. Hard cuts (overlap 0)
    // butt-join exactly, which keeps every cut on the beat grid.
    const from = Math.max(0, cursorFrame - Math.round(overlap / 2));
    cursorFrame = from + scene.duration;
    return { scene: scene, from: from, index: index, overlap: overlap, carryIn: prev && prev.out && prev.out.carry ? prev.out.carry : null };
  });

  // Music bed: −12dB (gain 0.251) under clip scenes whose audio is 'duck',
  // with a 6-frame fade at both ends. Cut on the beat like the picture.
  const duckWindows = placed.filter((p) => isClip(p.scene) && p.scene.audio === 'duck').map((p) => [p.from, p.from + p.scene.duration]);
  const musicVolume = (f) => {
    let gain = 1;
    for (let i = 0; i < duckWindows.length; i++) {
      const w = duckWindows[i];
      if (f >= w[0] - 6 && f <= w[1] + 6) {
        const inT = clamp01((f - (w[0] - 6)) / 6);
        const outT = clamp01((w[1] + 6 - f) / 6);
        gain = Math.min(gain, 1 - Math.min(inT, outT) * (1 - 0.251));
      }
    }
    return gain;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#05070D' }}>
      <Ground theme={theme} ground={plan.ground || {}} width={width} height={height} />
      {plan.music && plan.music.url ? <Audio src={plan.music.url} volume={musicVolume} /> : null}
      {placed.map(({ scene, from, index, overlap, carryIn }) => {
        const local = frame - from;
        const fadeIn = overlap > 0 ? smoothstep(clamp01(local / Math.max(1, overlap))) : 1;
        const carryTransform = carryTransformFor(carryIn, local);
        const dipFrames = scene.dipIn || 0;
        const dip = dipFrames > 0 ? Math.max(0, 1 - local / dipFrames) : 0;
        let content = null;
        if (isClip(scene)) {
          const clip = clipsById[scene.src];
          if (!clip) return null;
          const plateImage = scene.plate ? imagesById[scene.plate.screenId] : null;
          content = (
            <ClipScene scene={scene} clip={clip} plateImage={plateImage} theme={theme} preset={preset} width={width} height={height} fps={fps} />
          );
        } else {
          const image = imagesById[scene.screenId];
          if (!image) return null;
          const analysis = analysesById[scene.screenId] || { regions: [], palette: null };
          const nextScene = plan.scenes[index + 1];
          const nextImage = nextScene && !isClip(nextScene) ? imagesById[nextScene.screenId] : null;
          content = (
            <Scene
              scene={scene}
              image={image}
              analysis={analysis}
              nextImage={nextImage}
              imagesById={imagesById}
              theme={theme}
              preset={preset}
              width={width}
              height={height}
              grade={gradeFilter}
            />
          );
        }
        return (
          <Sequence key={scene.id || index} from={from} durationInFrames={scene.duration} layout={'none'}>
            <AbsoluteFill style={{ opacity: fadeIn, transform: carryTransform }}>
              {content}
              {dip > 0 ? <AbsoluteFill style={{ background: '#000', opacity: 0.85 * smoothstep(dip), pointerEvents: 'none' }} /> : null}
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <FinishLayer theme={theme} ground={plan.ground || {}} />
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = (props) => {
  const scenes = (props && props.plan && props.plan.scenes) || [];
  let total = 0;
  scenes.forEach((s) => { total += s.duration || 0; });
  return Math.max(60, total);
};
`;
