/**
 * Scene renderer — emitted verbatim into the rendered composition.
 *
 * One scene = one screenshot on a device stage over the ground, driven by
 * exactly one bed op plus 0–2 accents plus up to 2 plate-matched UI ops and
 * an optional margin overlay. Every scene ends at rest: the ops themselves
 * freeze for their final 8 frames, and nothing here re-animates them.
 *
 * The emitted code references (from the assembled composition scope):
 * BED_OPS, ACCENT_OPS, UI_OPS, ICON_PATHS, smoothstep, clamp01, withAlpha,
 * regionBox, Overlay.
 */
export const SCENE_TSX = `
// Crop of the source screenshot at a normalised bbox, rendered pixel-true.
const RegionCrop = ({ image, bbox, rectW, rectH, radius }) => {
  const sx = rectW / (bbox[2] * image.width);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: radius || 0 }}>
      <Img
        src={image.url}
        style={{
          position: 'absolute',
          width: image.width * sx,
          height: image.height * sx,
          left: -bbox[0] * image.width * sx,
          top: -bbox[1] * image.height * sx,
          maxWidth: 'none',
        }}
      />
    </div>
  );
};

const UiLayer = ({ spec, region, stage, image, theme, preset, frame }) => {
  const local = frame - spec.at;
  if (local < 0 || local > spec.duration) return null;
  const fn = UI_OPS[spec.op];
  if (!fn || !region) return null;
  const d = fn(local, spec.duration, spec.params || {}, { preset: preset, region: region });
  const b = region.bbox;
  const rect = {
    left: b[0] * stage.w, top: b[1] * stage.h,
    width: b[2] * stage.w, height: b[3] * stage.h,
  };
  const plate = region.plateColor || theme.paper;
  const plateStyle = {
    position: 'absolute', inset: 0, background: plate,
    opacity: clamp01(d.plateOpacity == null ? 1 : d.plateOpacity),
    borderRadius: 6,
  };
  const text = String((spec.params && spec.params.text) || region.text || '');
  const inner = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: clamp01(d.contentOpacity == null ? 1 : d.contentOpacity), color: theme.ink, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' };
  let content = null;
  if (spec.op === 'countUp') {
    const target = parseFloat(String(text).replace(/[^0-9.]/g, '')) || 0;
    const suffix = String(text).replace(/^[^a-zA-Z%]+/, '');
    const value = target * d.progress;
    const shown = target >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    content = <div style={Object.assign({}, inner, { fontWeight: 830, fontSize: rect.height * 0.62 })}>{shown}{suffix}</div>;
  } else if (spec.op === 'chartDraw') {
    content = d.variant === 'line'
      ? <svg style={Object.assign({}, inner)} viewBox={'0 0 100 40'} preserveAspectRatio={'none'}>
          <path d={'M2 34 L 20 22 L 38 27 L 56 14 L 74 18 L 98 6'} stroke={theme.accent} strokeWidth={2.4} fill={'none'} strokeLinecap={'round'} pathLength={100} strokeDasharray={100} strokeDashoffset={100 * (1 - d.lineT)} />
        </svg>
      : <div style={Object.assign({}, inner, { alignItems: 'flex-end', gap: '4%', padding: '10% 12%' })}>
          {d.barT.map((t, i) => <div key={i} style={{ flex: 1, height: (18 + (i * 53) % 68) * t + '%', background: withAlpha(theme.accent, 0.55 + 0.45 * (i === d.barT.length - 1 ? 1 : 0)), borderRadius: 3, transformOrigin: 'bottom' }} />)}
        </div>;
  } else if (spec.op === 'listStagger') {
    const rows = [];
    for (let i = 0; i < d.rows; i++) {
      const rb = [b[0], b[1] + (b[3] / d.rows) * i, b[2], b[3] / d.rows];
      const t = d.rowT[i];
      rows.push(
        <div key={i} style={{ position: 'absolute', left: 0, top: (100 / d.rows) * i + '%', width: '100%', height: (100 / d.rows) + '%', opacity: t, transform: 'translateY(' + ((1 - t) * d.rise) + 'px)' }}>
          <RegionCrop image={image} bbox={rb} rectW={rect.width} rectH={rect.height / d.rows} radius={0} />
        </div>
      );
    }
    content = <div style={{ position: 'absolute', inset: 0 }}>{rows}</div>;
  } else if (spec.op === 'skeleton') {
    const blocks = [];
    for (let i = 0; i < d.blocks; i++) {
      blocks.push(<div key={i} style={{ height: (52 / d.blocks) + '%', width: (88 - i * 14) + '%', borderRadius: 6, background: withAlpha(theme.ink, 0.1 + 0.06 * d.shimmer) }} />);
    }
    content = <div style={Object.assign({}, inner, { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-evenly', padding: '8% 10%' })}>{blocks}</div>;
  } else if (spec.op === 'typeIn') {
    content = <div style={Object.assign({}, inner, { justifyContent: 'flex-start', padding: '0 6%', fontWeight: 700, fontSize: rect.height * 0.42, whiteSpace: 'nowrap', overflow: 'hidden' })}>
      {text.slice(0, d.visibleChars)}
      <span style={{ width: 3, height: '58%', marginLeft: 3, background: theme.accent, opacity: d.caret }} />
    </div>;
  } else if (spec.op === 'progressFill') {
    content = d.variant === 'ring'
      ? <svg style={Object.assign({}, inner)} viewBox={'0 0 40 40'}>
          <circle cx={20} cy={20} r={16} stroke={withAlpha(theme.ink, 0.15)} strokeWidth={4} fill={'none'} />
          <circle cx={20} cy={20} r={16} stroke={theme.accent} strokeWidth={4} fill={'none'} strokeLinecap={'round'} pathLength={100} strokeDasharray={100} strokeDashoffset={100 * (1 - d.fillT)} transform={'rotate(-90 20 20)'} />
        </svg>
      : <div style={Object.assign({}, inner, { padding: '0 8%' })}>
          <div style={{ width: '100%', height: '26%', borderRadius: 99, background: withAlpha(theme.ink, 0.12), overflow: 'hidden' }}>
            <div style={{ width: (d.fillT * 100) + '%', height: '100%', borderRadius: 99, background: theme.accent }} />
          </div>
        </div>;
  } else if (spec.op === 'toggleFlip') {
    const trackW = Math.min(rect.width * 0.4, rect.height * 1.6);
    content = <div style={Object.assign({}, inner, { justifyContent: 'flex-end', padding: '0 5%', background: withAlpha(theme.accent, 0.1 * d.tintT), borderRadius: 6 })}>
      <div style={{ width: trackW, height: trackW * 0.52, borderRadius: 99, background: d.tintT > 0.5 ? theme.accent : withAlpha(theme.ink, 0.24), position: 'relative' }}>
        <div style={{ position: 'absolute', top: '9%', left: (6 + d.knobT * 46) + '%', width: '42%', height: '82%', borderRadius: 99, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      </div>
    </div>;
  } else if (spec.op === 'statusFlip') {
    const from = String((spec.params && spec.params.fromText) || 'Pending');
    const to = String((spec.params && spec.params.toText) || text || 'Confirmed');
    const flipped = d.flipT > 0.5;
    content = <div style={Object.assign({}, inner)}>
      <span style={{ padding: '4% 10%', borderRadius: 99, fontWeight: 750, fontSize: rect.height * 0.34, transform: 'scale(' + d.popScale + ')', color: flipped ? '#fff' : theme.ink, background: flipped ? theme.accent : withAlpha(theme.ink, 0.14) }}>{flipped ? to : from}</span>
    </div>;
  } else if (spec.op === 'notify') {
    return (
      <div style={{ position: 'absolute', left: '50%', [d.side === 'top' ? 'top' : 'bottom']: 24 + d.slideT * 0, transform: 'translateX(-50%) translateY(' + ((d.side === 'top' ? -1 : 1) * (1 - d.slideT) * 60) + 'px)', opacity: d.opacity, padding: '14px 22px', borderRadius: 14, background: withAlpha('#0B1220', 0.86), color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 20, fontWeight: 650, boxShadow: '0 14px 40px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: theme.accent }} />
        {text || 'Saved'}
      </div>
    );
  } else if (spec.op === 'badgePop') {
    content = <div style={Object.assign({}, inner, { justifyContent: 'flex-end', alignItems: 'flex-start' })}>
      <span style={{ minWidth: rect.height * 0.5, height: rect.height * 0.5, borderRadius: 99, background: theme.accent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: rect.height * 0.26, fontWeight: 800, transform: 'scale(' + d.scale + ')', opacity: d.opacity }}>{String((spec.params && spec.params.count) || 3)}</span>
    </div>;
  } else if (spec.op === 'tabSlide') {
    const pills = [];
    for (let i = 0; i < d.tabs; i++) pills.push(<div key={i} style={{ flex: 1 }} />);
    content = <div style={Object.assign({}, inner, { padding: '6% 4%' })}>
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
        <div style={{ position: 'absolute', left: (d.pillT / d.tabs) * 100 + '%', width: (100 / d.tabs) + '%', top: 0, bottom: 0, borderRadius: 8, background: withAlpha(theme.accent, 0.22), border: '1px solid ' + withAlpha(theme.accent, 0.5) }} />
        {pills}
      </div>
    </div>;
  } else if (spec.op === 'ripple') {
    const size = Math.max(rect.width, rect.height) * 1.5 * d.radiusT;
    content = <div style={Object.assign({}, inner)}>
      <span style={{ width: size, height: size, borderRadius: 999, border: '2px solid ' + theme.accent, opacity: d.opacity, position: 'absolute' }} />
    </div>;
  }
  return (
    <div style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div style={plateStyle} />
      {content}
    </div>
  );
};

const CursorLayer = ({ data, stage, theme }) => {
  if (!data || !data.visible) return null;
  const x = data.x * stage.w, y = data.y * stage.h;
  const rippleSize = 90 * data.rippleT;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: stage.w, height: stage.h, pointerEvents: 'none' }}>
      {data.rippleOpacity > 0 ? <span style={{ position: 'absolute', left: x - rippleSize / 2, top: y - rippleSize / 2, width: rippleSize, height: rippleSize, borderRadius: 999, border: '2.5px solid ' + theme.accent, opacity: data.rippleOpacity }} /> : null}
      <svg width={34} height={34} viewBox={'0 0 24 24'} style={{ position: 'absolute', left: x, top: y, transform: 'scale(' + data.scale + ')', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))' }}>
        <path d={'M5 3l14 8-6.5 1.5L9 19 5 3z'} fill={'#fff'} stroke={'#111'} strokeWidth={1.2} strokeLinejoin={'round'} />
      </svg>
    </div>
  );
};

const Scene = ({ scene, image, analysis, nextImage, imagesById, theme, preset, width, height, grade }) => {
  const frame = useCurrentFrame();
  const d = scene.duration;
  // Device stage: the screenshot sits on the ground with margin; gradient
  // never covers interface pixels because the stage is opaque above it.
  const margin = Math.round(Math.min(width, height) * 0.075);
  const stageBox = { w: width - margin * 2, h: height - margin * 2 };
  const fit = Math.min(stageBox.w / image.width, stageBox.h / image.height);
  const stage = { w: Math.round(image.width * fit), h: Math.round(image.height * fit) };
  const ctx = { width: stage.w, height: stage.h, imgW: image.height && image.width * fit, imgH: image.height * fit, fitScale: fit, preset: preset };

  const bedFn = BED_OPS[scene.bed && scene.bed.op] || BED_OPS.push;
  const bed = bedFn(frame, d, (scene.bed && scene.bed.params) || {}, ctx);

  // Motion blur on fast UI moves ONLY (Phase 2 joiner): estimate the bed's
  // velocity against the previous frame; slow drifts stay crisp.
  const bedPrev = bedFn(Math.max(0, frame - 1), d, (scene.bed && scene.bed.params) || {}, ctx);
  const bedVelocity = Math.abs(bed.x - bedPrev.x) + Math.abs(bed.y - bedPrev.y) + Math.abs(bed.scale - bedPrev.scale) * stage.w;
  const motionBlur = bedVelocity > 14 ? Math.min(2.2, (bedVelocity - 14) * 0.08) : 0;

  // Accents (0–2). Resolve region targets from the analysis.
  const accents = (scene.accents || []).map((a) => {
    const rid = a.params && (a.params.regionId || a.params.toRegionId);
    const region = rid ? regionBox(analysis, rid) : null;
    const from = a.from || 0;
    const to = a.to || d;
    const local = Math.min(Math.max(frame - from, 0), to - from);
    const fn = ACCENT_OPS[a.op];
    const active = frame >= from && fn;
    return {
      spec: a,
      region: region,
      data: active ? fn(local, to - from, a.params || {}, Object.assign({}, ctx, { target: region ? region.bbox : null })) : null,
    };
  });
  const find = (name) => accents.find((a) => a.spec.op === name && a.data);
  const focusA = find('focus');
  const liftA = find('lift');
  const parallaxA = find('parallax');
  const cursorA = find('cursor');
  const highlightA = find('highlight');
  const calloutA = find('callout');
  const wipeA = find('maskWipe');
  const compareA = find('compare');

  // Viewport (focus) maps a normalised crop to scale+translate of the stage.
  let vpScale = 1, vpX = 0, vpY = 0;
  if (focusA && focusA.data.viewport) {
    const vp = focusA.data.viewport;
    vpScale = 1 / Math.max(vp[2], vp[3]);
    vpX = -((vp[0] + vp[2] / 2) - 0.5) * stage.w * vpScale;
    vpY = -((vp[1] + vp[3] / 2) - 0.5) * stage.h * vpScale;
  }

  const stageTransform =
    'translate(' + (bed.x + vpX) + 'px,' + (bed.y + vpY) + 'px) ' +
    'scale(' + (bed.scale * vpScale) + ') ' +
    'rotateY(' + bed.rotateY + 'deg)';

  const shadowA = liftA ? 0.18 : 0.32;
  const uiSpecs = (scene.ui || []).map((u) => ({ spec: u, region: regionBox(analysis, u.regionId) }));

  const screenshot = (
    <Img src={image.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  );

  return (
    <AbsoluteFill style={{ perspective: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          position: 'relative',
          width: stage.w, height: stage.h,
          transform: stageTransform,
          transformOrigin: (bed.originX * 100) + '% ' + (bed.originY * 100) + '%',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: '0 6px 18px rgba(2,6,23,' + shadowA * 0.8 + '), 0 42px 110px -32px rgba(2,6,23,' + shadowA + ')',
          background: theme.paper,
          // grade: the video-wide footage-matched UI grade (black point first,
          // then saturation) — screenshots move toward the footage.
          filter: [
            liftA ? 'blur(' + liftA.data.bgBlur + 'px)' : '',
            grade || '',
            motionBlur > 0 ? 'blur(' + motionBlur.toFixed(2) + 'px)' : '',
          ].filter(Boolean).join(' ') || 'none',
        }}
      >
        {compareA && compareA.data && imagesById[compareA.spec.params.screenA] && imagesById[compareA.spec.params.screenB] ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div style={{ width: (compareA.data.split * 100) + '%', overflow: 'hidden', position: 'relative' }}>
              <Img src={imagesById[compareA.spec.params.screenA].url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + compareA.data.scaleA + ')' }} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <Img src={imagesById[compareA.spec.params.screenB].url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + compareA.data.scaleB + ')' }} />
            </div>
            <div style={{ position: 'absolute', left: (compareA.data.split * 100) + '%', top: 0, bottom: 0, width: 2, background: '#fff', opacity: compareA.data.dividerT }} />
          </div>
        ) : screenshot}

        {wipeA && wipeA.data && nextImage ? (
          <div style={{
            position: 'absolute', inset: 0,
            clipPath: 'polygon(0 0, ' + (wipeA.data.progress * 130 - 15) + '% 0, ' + (wipeA.data.progress * 130 - 15 - 12) + '% 100%, 0 100%)',
          }}>
            <Img src={nextImage.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : null}

        {highlightA && highlightA.data && highlightA.region ? (
          <div style={{ position: 'absolute', inset: 0 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,23,' + highlightA.data.dim + ')', clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%,0 ' + (highlightA.region.bbox[1] * 100) + '%,' + (highlightA.region.bbox[0] * 100) + '% ' + (highlightA.region.bbox[1] * 100) + '%,' + (highlightA.region.bbox[0] * 100) + '% ' + ((highlightA.region.bbox[1] + highlightA.region.bbox[3]) * 100) + '%,' + ((highlightA.region.bbox[0] + highlightA.region.bbox[2]) * 100) + '% ' + ((highlightA.region.bbox[1] + highlightA.region.bbox[3]) * 100) + '%,' + ((highlightA.region.bbox[0] + highlightA.region.bbox[2]) * 100) + '% ' + (highlightA.region.bbox[1] * 100) + '%,0 ' + (highlightA.region.bbox[1] * 100) + '%)' }} />
            <svg style={{ position: 'absolute', left: (highlightA.region.bbox[0] * 100 - 1) + '%', top: (highlightA.region.bbox[1] * 100 - 1.5) + '%', width: (highlightA.region.bbox[2] * 100 + 2) + '%', height: (highlightA.region.bbox[3] * 100 + 3) + '%', overflow: 'visible' }} viewBox={'0 0 100 100'} preserveAspectRatio={'none'}>
              <rect x={1} y={1} width={98} height={98} rx={4} fill={'none'} stroke={theme.accent} strokeWidth={2.2} vectorEffect={'non-scaling-stroke'} pathLength={100} strokeDasharray={100} strokeDashoffset={100 * (1 - highlightA.data.drawT)} opacity={highlightA.data.ringOpacity} />
            </svg>
          </div>
        ) : null}

        {parallaxA && parallaxA.data ? (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {(parallaxA.spec.params.layers || []).slice(0, 3).map((rid, i) => {
              const region = regionBox(analysis, rid);
              if (!region) return null;
              const rate = parallaxA.data.rates[Math.min(i, parallaxA.data.rates.length - 1)];
              const b = region.bbox;
              return (
                <div key={rid} style={{ position: 'absolute', left: (b[0] * 100) + '%', top: (b[1] * 100) + '%', width: (b[2] * 100) + '%', height: (b[3] * 100) + '%', transform: 'translateY(' + (parallaxA.data.drift * parallaxA.data.travelPx * rate) + 'px) scale(' + (i === 2 ? parallaxA.data.frontScale : 1) + ')', boxShadow: i === 2 ? '0 22px 60px -18px rgba(2,6,23,0.5)' : 'none', borderRadius: 10 }}>
                  <RegionCrop image={image} bbox={b} rectW={b[2] * stage.w} rectH={b[3] * stage.h} radius={10} />
                </div>
              );
            })}
          </div>
        ) : null}

        {uiSpecs.map((u, i) => (
          <UiLayer key={i} spec={u.spec} region={u.region} stage={stage} image={image} theme={theme} preset={preset} frame={frame} />
        ))}

        {cursorA && cursorA.data ? <CursorLayer data={cursorA.data} stage={stage} theme={theme} /> : null}

        {bed.sweep > 0 ? <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,' + bed.sweep + ') 50%, transparent 70%)', pointerEvents: 'none' }} /> : null}
      </div>

      {liftA && liftA.data && liftA.region ? (
        <div style={{
          position: 'absolute',
          left: margin + liftA.region.bbox[0] * stage.w + (width - margin * 2 - stage.w) / 2,
          top: margin + liftA.region.bbox[1] * stage.h + (height - margin * 2 - stage.h) / 2,
          width: liftA.region.bbox[2] * stage.w,
          height: liftA.region.bbox[3] * stage.h,
          transform: 'scale(' + liftA.data.liftScale + ')',
          opacity: liftA.data.liftOpacity,
          borderRadius: 14,
          boxShadow: '0 3px 10px rgba(2,6,23,' + (liftA.data.contactShadow) + '), 0 46px 120px -20px rgba(2,6,23,' + liftA.data.softShadow + ')',
        }}>
          <RegionCrop image={image} bbox={liftA.region.bbox} rectW={liftA.region.bbox[2] * stage.w} rectH={liftA.region.bbox[3] * stage.h} radius={14} />
        </div>
      ) : null}

      {calloutA && calloutA.data && calloutA.region ? (() => {
        const b = calloutA.region.bbox;
        const right = (calloutA.data.side || 'right') === 'right';
        const anchorX = margin + (right ? (b[0] + b[2]) : b[0]) * stage.w + (width - margin * 2 - stage.w) / 2;
        const anchorY = margin + (b[1] + b[3] / 2) * stage.h + (height - margin * 2 - stage.h) / 2;
        const lineLen = 90 * calloutA.data.lineT;
        return (
          <div style={{ position: 'absolute', left: anchorX, top: anchorY, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: right ? 0 : -lineLen, top: 0, width: lineLen, height: 1.6, background: withAlpha(theme.ink, 0.6) }} />
            <div style={{ position: 'absolute', left: right ? lineLen + 12 : -lineLen - 12, top: -16, transform: right ? 'none' : 'translateX(-100%)', display: 'flex', alignItems: 'center', gap: 10, opacity: calloutA.data.textT, whiteSpace: 'nowrap' }}>
              {calloutA.spec.params.icon ? <DrawIcon name={calloutA.spec.params.icon} t={calloutA.data.iconT} color={theme.accent} box={26} /> : null}
              <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 24, fontWeight: 720, color: '#fff', textShadow: '0 3px 18px rgba(0,0,0,0.5)', transform: 'translateY(' + calloutA.data.textRise + 'px)' }}>{String(calloutA.spec.params.text || '')}</span>
            </div>
          </div>
        );
      })() : null}

      <Overlay spec={scene.overlay} theme={theme} preset={preset} frame={frame} sceneDuration={d} width={width} height={height} />
    </AbsoluteFill>
  );
};
`;
