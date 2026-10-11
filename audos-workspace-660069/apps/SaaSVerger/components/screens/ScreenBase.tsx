import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ProductIdentity } from '../../types';

export type ScreenProps = { identity: ProductIdentity; feature?: string };

type Variant = 'workspace' | 'automation' | 'analytics';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

function Cursor({ variant }: { variant: Variant }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clickAt = variant === 'workspace' ? 58 : variant === 'automation' ? 66 : 72;
  const arrive = spring({ frame, fps, delay: 8, config: { damping: 18, stiffness: 75 } });
  const xEnd = variant === 'analytics' ? 1420 : variant === 'automation' ? 1240 : 1330;
  const yEnd = variant === 'analytics' ? 370 : variant === 'automation' ? 690 : 285;
  const x = interpolate(arrive, [0, 1], [350, xEnd], clamp);
  const y = interpolate(arrive, [0, 1], [720, yEnd], clamp);
  const ripple = interpolate(frame, [clickAt, clickAt + 16], [0, 1], clamp);
  const down = frame >= clickAt && frame < clickAt + 5 ? 0.88 : 1;
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 20, transform: `scale(${down})` }}>
      {frame >= clickAt && frame <= clickAt + 16 ? <div style={{ position: 'absolute', width: 74, height: 74, left: -31, top: -31, borderRadius: 999, border: '4px solid rgba(255,255,255,.8)', opacity: 1 - ripple, transform: `scale(${0.2 + ripple * 1.2})` }} /> : null}
      <svg width="42" height="42" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 5px 8px rgba(0,0,0,.45))' }}><path d="M4 2l15 10-7 2 4 7-3 1-4-7-5 5z" fill="#fff" stroke="#111827" strokeWidth="1.2" /></svg>
    </div>
  );
}

function TypedField({ text, start = 24 }: { text: string; start?: number }) {
  const frame = useCurrentFrame();
  const count = Math.max(0, Math.floor((frame - start) / 1.7));
  const shown = text.slice(0, count);
  return <span>{shown}<span style={{ opacity: frame % 18 < 10 ? 1 : 0, color: '#f59e0b' }}>|</span></span>;
}

export function ScreenBase({ identity, feature, variant }: ScreenProps & { variant: Variant }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, stiffness: 95 } });
  const clicked = frame > (variant === 'workspace' ? 58 : variant === 'automation' ? 66 : 72);
  const success = spring({ frame, fps, delay: 76, config: { damping: 14, stiffness: 120 } });
  const accent = identity.primaryColor;
  const labels = identity.features.length ? identity.features : ['Smart workspace', 'Automated workflow', 'Live insights'];
  const activeFeature = feature || labels[variant === 'workspace' ? 0 : variant === 'automation' ? 1 : 2] || labels[0];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: 1600, height: 840, borderRadius: 30, overflow: 'hidden', background: '#f8fafc', border: '1px solid rgba(255,255,255,.3)', boxShadow: '0 60px 150px rgba(0,0,0,.5)', transform: `translateY(${(1 - enter) * 70}px) scale(${0.92 + enter * 0.08})`, opacity: enter }}>
        <div style={{ height: 72, display: 'flex', alignItems: 'center', padding: '0 28px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: `linear-gradient(135deg, ${accent}, ${identity.secondaryColor})` }} />
          <strong style={{ marginLeft: 12, fontSize: 22, color: '#111827' }}>{identity.name}</strong>
          <div style={{ marginLeft: 48, width: 420, borderRadius: 12, padding: '12px 16px', background: '#f1f5f9', color: '#64748b', fontSize: 16 }}>Search your workspace…</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}><div style={{ width: 38, height: 38, borderRadius: 12, background: '#f1f5f9' }} /><div style={{ width: 38, height: 38, borderRadius: 19, background: accent }} /></div>
        </div>
        <div style={{ display: 'flex', height: 768 }}>
          <aside style={{ width: 260, padding: 24, background: '#0f172a', color: '#cbd5e1' }}>
            {['Overview', labels[0], labels[1], labels[2], 'Team', 'Settings'].map((label, i) => <div key={label + i} style={{ padding: '14px 16px', marginBottom: 8, borderRadius: 12, background: i === (variant === 'workspace' ? 1 : variant === 'automation' ? 2 : 3) ? `${accent}33` : 'transparent', color: i === (variant === 'workspace' ? 1 : variant === 'automation' ? 2 : 3) ? '#fff' : '#94a3b8', fontSize: 16 }}>{label}</div>)}
          </aside>
          <main style={{ flex: 1, padding: 38, color: '#111827', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}><div><div style={{ color: '#64748b', fontSize: 15 }}>PRODUCT WORKSPACE</div><h2 style={{ margin: '6px 0 0', fontSize: 34 }}>{activeFeature}</h2></div><button style={{ marginLeft: 'auto', border: 0, borderRadius: 13, padding: '14px 24px', background: accent, color: '#fff', fontWeight: 750, fontSize: 16, transform: clicked ? 'scale(.97)' : 'scale(1)' }}>{clicked ? 'Running…' : variant === 'analytics' ? 'Export report' : 'Run workflow'}</button></div>
            {variant === 'workspace' ? <WorkspacePanel accent={accent} clicked={clicked} success={success} targetUser={identity.targetUser} /> : variant === 'automation' ? <AutomationPanel accent={accent} clicked={clicked} success={success} feature={activeFeature} /> : <AnalyticsPanel accent={accent} clicked={clicked} success={success} />}
          </main>
        </div>
        <Cursor variant={variant} />
      </div>
    </AbsoluteFill>
  );
}

function WorkspacePanel({ accent, clicked, success, targetUser }: { accent: string; clicked: boolean; success: number; targetUser: string }) {
  return <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}><section style={{ border: '1px solid #e2e8f0', borderRadius: 20, background: '#fff', padding: 28, minHeight: 470 }}><div style={{ fontWeight: 700, fontSize: 18 }}>New project</div><div style={{ marginTop: 24, border: '1px solid #cbd5e1', borderRadius: 13, padding: 16, color: '#334155', minHeight: 24 }}><TypedField text={`Launch campaign for ${targetUser}`} /></div><div style={{ marginTop: 18, height: 148, borderRadius: 16, border: `2px dashed ${accent}66`, background: `${accent}0d`, display: 'grid', placeItems: 'center', color: '#64748b' }}>{clicked ? 'Assets connected' : 'Drop product assets here'}</div><div style={{ marginTop: 24, height: 10, borderRadius: 9, background: '#e2e8f0', overflow: 'hidden' }}><div style={{ height: '100%', width: `${success * 100}%`, background: accent }} /></div></section><section style={{ borderRadius: 20, background: '#0f172a', padding: 26, color: '#fff' }}><div style={{ color: '#94a3b8', fontSize: 14 }}>LIVE PREVIEW</div><div style={{ marginTop: 24, height: 250, borderRadius: 16, background: `linear-gradient(145deg, ${accent}55, #1e293b)`, display: 'grid', placeItems: 'center', transform: `scale(${.94 + success * .06})` }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: 42, fontWeight: 800 }}>{clicked ? 'Ready' : 'Draft'}</div><div style={{ color: '#cbd5e1', marginTop: 8 }}>Built for your team</div></div></div></section></div>;
}

function AutomationPanel({ accent, clicked, success, feature }: { accent: string; clicked: boolean; success: number; feature: string }) {
  return <div style={{ marginTop: 28, border: '1px solid #e2e8f0', borderRadius: 20, background: '#fff', padding: 28, minHeight: 480 }}><div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>{['New request', feature, 'Notify team', 'Complete'].map((label, i) => <React.Fragment key={label}><div style={{ width: 220, borderRadius: 16, padding: 20, background: i <= Math.floor(success * 3) ? `${accent}18` : '#f8fafc', border: `1px solid ${i <= Math.floor(success * 3) ? accent : '#e2e8f0'}` }}><div style={{ width: 32, height: 32, borderRadius: 10, background: i <= Math.floor(success * 3) ? accent : '#cbd5e1', color: '#fff', display: 'grid', placeItems: 'center' }}>{i + 1}</div><strong style={{ display: 'block', marginTop: 14 }}>{label}</strong></div>{i < 3 ? <div style={{ height: 3, flex: 1, background: i < success * 3 ? accent : '#e2e8f0' }} /> : null}</React.Fragment>)}</div><div style={{ marginTop: 34, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}><div style={{ padding: 22, borderRadius: 15, background: '#f8fafc' }}><div style={{ color: '#64748b' }}>Trigger</div><div style={{ marginTop: 10, fontWeight: 700 }}>When a customer submits</div></div><div style={{ padding: 22, borderRadius: 15, background: clicked ? '#ecfdf5' : '#f8fafc', border: clicked ? '1px solid #34d399' : '1px solid transparent' }}><div style={{ color: '#64748b' }}>Status</div><div style={{ marginTop: 10, fontWeight: 700 }}>{clicked ? 'Automation live' : 'Ready to activate'}</div></div></div></div>;
}

function AnalyticsPanel({ accent, clicked, success }: { accent: string; clicked: boolean; success: number }) {
  const bars = [52, 76, 63, 92, 82, 100, 88];
  return <div style={{ marginTop: 28 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>{[['Active users','12,480'],['Conversion','18.7%'],['Time saved','342h']].map(([k,v],i) => <div key={k} style={{ padding: 22, borderRadius: 18, background: '#fff', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b' }}>{k}</div><div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: i === 1 ? accent : '#111827' }}>{v}</div></div>)}</div><div style={{ marginTop: 20, height: 320, borderRadius: 20, background: '#fff', border: '1px solid #e2e8f0', padding: 28, display: 'flex', alignItems: 'end', gap: 26 }}>{bars.map((h,i) => <div key={i} style={{ flex: 1, height: `${Math.max(8, h * (clicked ? success : .55))}%`, borderRadius: '10px 10px 3px 3px', background: `linear-gradient(180deg, ${accent}, ${accent}77)`, transition: 'height .2s' }} />)}</div></div>;
}
