/**
 * Demo timeline inspector — DEVELOPER/DEBUG MODE ONLY (never shown to
 * customers). Enabled from the Editor when the page URL carries ?debug=1 or
 * localStorage 'trackb_debug' === '1'.
 *
 * Scrub any point of the planned film and read the exact state the render
 * will produce there: current scene, time within it, active camera state,
 * cursor position/press, active interaction, active highlight, transition
 * kinds and upcoming SFX cues. It computes everything with the SAME canonical
 * timeline module (lib/trackB/productDemo.ts) whose ported copy drives the
 * trackb-render composition — one source of truth, so what this panel shows
 * IS the render's timing. No timing is re-implemented here.
 */
import { useMemo, useState } from 'react';
import { Bug } from 'lucide-react';
import type { TrackBScene } from '../../lib/trackB/api';
import {
  buildDemoPlan, cameraAt, cursorAt, activeEvent, activeHighlight, sceneWindows,
  type DemoSceneSpec,
} from '../../lib/trackB/productDemo';

const S = {
  text: 'var(--space-text-primary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  panel: 'var(--space-surface-panel)',
  card: 'var(--space-surface-card)',
};

const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: S.text };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ ...mono, color: S.muted, minWidth: 92, flexShrink: 0 }}>{label}</span>
      <span style={mono}>{value}</span>
    </div>
  );
}

export default function DemoDebugPanel({ scenes, style }: {
  scenes: TrackBScene[];
  style?: string | null;
}) {
  const [timeS, setTimeS] = useState(0);

  const plan = useMemo(() => buildDemoPlan(
    scenes.map((s, i) => ({
      id: s.id || 'scene-' + (i + 1),
      motion: s.motion,
      intent: s.intent,
      headline: s.headline,
      demoSurface: !!(s.image_url || s.generated_image_url) && s.image_source !== 'ai_generated',
    })),
    String(style || 'social_ad'),
  ), [scenes, style]);

  const windows = useMemo(() => sceneWindows(scenes.map((s) => Number(s.duration_s) || 5)), [scenes]);
  const totalS = windows.length ? windows[windows.length - 1].endS : 0;

  if (!scenes.length) return null;

  const clampedT = Math.min(timeS, Math.max(0, totalS - 0.01));
  const win = windows.find((w) => clampedT >= w.startS && clampedT < w.endS) ?? windows[windows.length - 1];
  const scene = scenes[win.index];
  const spec: DemoSceneSpec | null = plan[win.index];
  const t = Math.max(0, Math.min(1, (clampedT - win.startS) / win.durationS));
  const cam = spec ? cameraAt(spec, t) : null;
  const cur = spec ? cursorAt(spec, t) : null;
  const evt = spec ? activeEvent(spec, t) : null;
  const hl = spec ? activeHighlight(spec, t) : null;
  const nextSfx = spec ? spec.sfx.find((c) => c.at >= t) : null;

  return (
    <div style={{ borderRadius: 14, border: `1px dashed ${S.border}`, background: S.panel, padding: '12px 14px' }} data-testid="demo-debug-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Bug size={13} color="var(--space-text-brand)" />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: S.brand, letterSpacing: '0.06em' }}>DEMO TIMELINE INSPECTOR</span>
        <span style={{ fontSize: 10.5, color: S.muted }}>dev only · same math as the render (lib/trackB/productDemo)</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, totalS)}
          step={1 / 30}
          value={clampedT}
          onChange={(e) => setTimeS(Number(e.currentTarget.value))}
          style={{ flex: 1 }}
          aria-label="Scrub the film timeline"
          data-testid="debug-scrubber"
        />
        <span style={{ ...mono, color: S.brand, minWidth: 110, textAlign: 'right' }}>{clampedT.toFixed(2)}s / {totalS.toFixed(2)}s</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 18px', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card }}>
        <Row label="scene" value={`${win.index + 1}/${scenes.length} · ${scene.id}${spec ? ` · ${spec.shot}` : ' · (legacy treatment — no demo spec)'}`} />
        <Row label="scene time" value={`${(t * win.durationS).toFixed(2)}s of ${win.durationS.toFixed(2)}s (t=${t.toFixed(3)})`} />
        {cam ? <Row label="camera" value={`scale ${cam.scale.toFixed(3)} · x ${cam.x.toFixed(3)} · y ${cam.y.toFixed(3)} · rot ${cam.rotate.toFixed(2)}°`} /> : null}
        {spec ? <Row label="cursor" value={cur && cur.visible ? `${cur.x.toFixed(3)}, ${cur.y.toFixed(3)}${cur.press ? ' · PRESS' : ''}` : 'off screen'} /> : null}
        {spec ? <Row label="interaction" value={evt ? `${evt.action.toUpperCase()} @ ${evt.target.label}` : 'none'} /> : null}
        {spec ? <Row label="highlight" value={hl ? `${hl.style} @ ${hl.target.label}` : 'none'} /> : null}
        {spec ? <Row label="transitions" value={`in: ${spec.transitionIn} · out: ${spec.transitionOut}`} /> : null}
        {spec ? <Row label="next sfx" value={nextSfx ? `${nextSfx.kind} @ t=${nextSfx.at.toFixed(2)} (${(win.startS + nextSfx.at * win.durationS).toFixed(2)}s)` : 'none left in scene'} /> : null}
        {spec && spec.scrollDrift ? <Row label="scroll drift" value={`${Math.round(spec.scrollDrift * 100)}% of surface height`} /> : null}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 10.5, color: S.muted, lineHeight: 1.5 }}>
        All cue times are fractions of each scene's duration — retime a scene and every camera key, cursor waypoint, click, highlight, caption window and SFX cue above retimes with it.
      </p>
    </div>
  );
}
