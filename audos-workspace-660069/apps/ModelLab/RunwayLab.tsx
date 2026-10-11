/**
 * MODEL LAB — Runway provider section.
 *
 * The most complete Runway surface in the workspace: every base model and
 * every Recipe the live proxy reports, each with what it is for, what it needs
 * and what it costs — and all nine of them runnable right here through the
 * shared quote → confirm → generate → download panel.
 *
 * Availability is checked LIVE against GET /api/generate/runway/capabilities,
 * so anything the platform has not enabled is shown greyed out with the reason
 * instead of failing on submit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RunwayStudio from '../../components/RunwayStudio';
import {
  RUNWAY_MODES, catalogRecipeInfo, catalogVideoModelInfo, modeSupported,
  ratioLabel, runwayCapabilities,
} from '../../lib/runway';
import type { RunwayCapabilities, RunwayModeId } from '../../lib/runway';

const C = {
  surface: '#FFFAEB',
  card: '#FFFFFF',
  border: 'rgba(180,120,0,0.14)',
  accent: '#C8920A',
  text: '#1A1000',
  text2: '#7A6030',
  success: '#166534',
  error: '#991B1B',
};
const FONT = 'system-ui, sans-serif';

const RUNWAY_THEME = {
  bg: 'transparent',
  panel: '#FFFAEB',
  card: C.card,
  line: C.border,
  lineStrong: 'rgba(180,120,0,0.36)',
  ink: C.text,
  soft: '#3D2800',
  muted: C.text2,
  accent: C.accent,
  onAccent: '#ffffff',
  good: C.success,
  bad: C.error,
  font: FONT,
};

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
      color, background: `${color}22`, border: `1px solid ${color}55`, borderRadius: 999,
      padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

export default function RunwayLab() {
  const [caps, setCaps] = useState<RunwayCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RunwayModeId>('product_ad');
  const alive = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    const next = await runwayCapabilities({ refresh });
    if (!alive.current) return;
    setCaps(next);
    setLoading(false);
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const allModes = useMemo(() => RUNWAY_MODES.map((m) => m.id), []);

  const choose = (id: RunwayModeId) => {
    setMode(id);
    try { panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* older browsers just jump */ }
  };

  return (
    <div style={{ fontFamily: FONT, color: C.text }}>
      {/* Provider header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>▶ Runway</h2>
        {loading ? <Pill text="Checking…" color={C.text2} />
          : caps?.available ? <Pill text="Live" color={C.success} />
          : <Pill text="Unavailable" color={C.error} />}
        <button
          className="ml-btn"
          onClick={() => void load(true)}
          disabled={loading}
          style={{
            marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, color: C.text2, fontSize: 12, fontFamily: FONT, cursor: 'pointer',
          }}
        >
          Re-check availability
        </button>
      </div>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: C.text2, lineHeight: 1.6, maxWidth: 820 }}>
        Two base video models and seven Recipes, all behind the platform's authenticated Runway proxy — it owns the key,
        the pinned workflow versions, wallet billing and durable media storage. Every mode below runs from this page:
        Runway prices the exact request first, and nothing is charged until you confirm.
      </p>
      {caps && !caps.available ? (
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.error, lineHeight: 1.6 }}>{caps.reason}</p>
      ) : <div style={{ height: 14 }} />}

      {/* Base models */}
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: C.text2, marginBottom: 8 }}>
        Base models · POST /api/generate/runway/video
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 22 }}>
        {['gen4.5', 'gen4_turbo'].map((id) => {
          const info = catalogVideoModelInfo(id);
          const live = caps?.models.filter((m) => m.id === id)[0] || null;
          const offline = !!caps && caps.models.length > 0 && !live;
          const ratios = (live?.ratios.length ? live.ratios : (info?.i2vRatios || []));
          return (
            <div key={id} className="ml-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, opacity: offline ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>{live?.label || info?.name || id}</span>
                <Pill text={info?.tier || 'Runway'} color={C.accent} />
                {offline ? <Pill text="Not enabled" color={C.error} /> : null}
              </div>
              <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>{info?.blurb || ''}</div>
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 9, lineHeight: 1.7 }}>
                <div><b style={{ color: '#3D2800' }}>Modes:</b> {info?.textToVideo ? 'text-to-video and image-to-video' : 'image-to-video only'}</div>
                <div><b style={{ color: '#3D2800' }}>Duration:</b> {live?.durations.length ? `${live.durations.join(', ')}s` : info?.durations}</div>
                <div><b style={{ color: '#3D2800' }}>Ratios:</b> {ratios.length ? ratios.map(ratioLabel).join(' · ') : '—'}</div>
                <div><b style={{ color: '#3D2800' }}>Cost:</b> {live?.price || info?.priceNote || '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
                {info?.textToVideo ? (
                  <button className="ml-btn" onClick={() => choose('text_to_video')} style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                    Run text → video
                  </button>
                ) : null}
                <button className="ml-btn" onClick={() => choose('image_to_video')} style={{ background: 'transparent', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  Run image → video
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recipes */}
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: C.text2, marginBottom: 8 }}>
        Recipes · POST /api/generate/runway/recipes/:recipeId
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginBottom: 24 }}>
        {RUNWAY_MODES.filter((m) => !!m.recipeId).map((m) => {
          const info = catalogRecipeInfo(String(m.recipeId));
          const live = caps?.recipes.filter((r) => r.id === m.recipeId)[0] || null;
          const offline = !!caps && (!caps.available || (caps.recipes.length > 0 && !live));
          return (
            <div key={m.id} className="ml-card" style={{ background: C.card, border: `1px solid ${mode === m.id ? C.accent : C.border}`, borderRadius: 12, padding: 14, opacity: offline ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>{info?.name || m.label}</span>
                <Pill text={m.kind === 'image' ? 'Images' : 'Video'} color={m.kind === 'image' ? '#B4720A' : C.accent} />
                {live?.version ? <Pill text={`v${live.version}`} color={C.text2} /> : null}
                {offline ? <Pill text="Not enabled" color={C.error} /> : null}
              </div>
              <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>{live?.description || info?.purpose || m.blurb}</div>
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 9, lineHeight: 1.7 }}>
                <div><b style={{ color: '#3D2800' }}>Inputs:</b> {live?.fields.length ? live.fields.join(', ') : info?.inputsNote || m.inputs}</div>
                <div><b style={{ color: '#3D2800' }}>Outputs:</b> {live?.outputs || (m.kind === 'image' ? 4 : 1)}</div>
                <div><b style={{ color: '#3D2800' }}>Cost:</b> {live?.price || info?.priceNote || '—'}</div>
              </div>
              <button
                className="ml-btn"
                onClick={() => choose(m.id)}
                style={{ marginTop: 11, background: mode === m.id ? C.accent : 'transparent', color: mode === m.id ? '#fff' : C.text, border: `1px solid ${mode === m.id ? 'transparent' : C.border}`, borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
              >
                {mode === m.id ? 'Open below ↓' : `Run ${info?.name || m.label}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* The runner — all nine modes */}
      <div ref={panelRef} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
        <RunwayStudio
          title="Run a Runway mode"
          subtitle="All nine modes. Pick one, check the price Runway quotes for your exact inputs, then generate — the result plays here with a download link."
          modes={allModes}
          mode={mode}
          onModeChange={setMode}
          theme={RUNWAY_THEME}
        />
      </div>

      {caps && caps.languages.length ? (
        <div style={{ marginTop: 22, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: C.text2, marginBottom: 8 }}>
            Ad Localization · {caps.languages.length} target languages
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {caps.languages.map((l) => (
              <span key={l.code} style={{ fontSize: 11.5, color: C.text2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 10px' }}>
                {l.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {caps ? (
        <div style={{ marginTop: 14, fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
          {RUNWAY_MODES.filter((m) => !modeSupported(caps, m.id)).length
            ? `${RUNWAY_MODES.filter((m) => !modeSupported(caps, m.id)).length} of 9 modes are not offered by the live catalogue right now and cannot be submitted.`
            : 'All 9 modes are live on this workspace.'}
        </div>
      ) : null}
    </div>
  );
}
