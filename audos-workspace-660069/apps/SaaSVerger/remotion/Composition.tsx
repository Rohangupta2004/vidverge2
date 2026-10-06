import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import Screen1 from '../components/screens/Screen1';
import Screen2 from '../components/screens/Screen2';
import Screen3 from '../components/screens/Screen3';
import type { ProductIdentity, Script, ScriptAct } from '../types';

export type SaaSVergerCompositionProps = {
  identity: ProductIdentity;
  script: Script;
  audioUrl: string;
};

function phrase(text: string) {
  return text.split(' ').slice(0, 7).join(' ').replace(/[.,;:!?]+$/, '');
}

function ProductBeat({ act, identity }: { act: ScriptAct; identity: ProductIdentity }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, stiffness: 95 } });
  const exit = interpolate(frame, [Math.max(0, durationInFrames - 12), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const screen = act.screenKey === 'screen2' ? <Screen2 identity={identity} feature={identity.features[1]} /> : act.screenKey === 'screen3' ? <Screen3 identity={identity} feature={identity.features[2]} /> : <Screen1 identity={identity} feature={identity.features[0]} />;
  return <AbsoluteFill style={{ opacity: enter * exit, transform: `scale(${0.96 + enter * 0.04})` }}>{screen}<div style={{ position: 'absolute', left: 120, bottom: 72, maxWidth: 1180, color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 850, fontSize: 64, lineHeight: 1.05, letterSpacing: '-.035em', textShadow: '0 5px 30px rgba(0,0,0,.55)', transform: `translateY(${(1 - enter) * 44}px)` }}>{phrase(act.text)}</div></AbsoluteFill>;
}

function CTA({ identity }: { identity: ProductIdentity }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#fff' }}><div style={{ width: 1560, padding: '96px 110px', borderRadius: 46, textAlign: 'center', background: `linear-gradient(120deg, ${identity.primaryColor}, ${identity.secondaryColor})`, boxShadow: `0 50px 140px ${identity.primaryColor}55`, transform: `scale(${0.88 + pop * 0.12})`, opacity: pop }}><div style={{ fontSize: 96, fontWeight: 900, letterSpacing: '-.045em' }}>{identity.name}</div><div style={{ marginTop: 24, fontSize: 38, opacity: .88 }}>{identity.tagline}</div><div style={{ display: 'inline-flex', marginTop: 48, padding: '20px 42px', borderRadius: 999, background: '#fff', color: identity.bgColor, fontSize: 26, fontWeight: 850 }}>{identity.ctaText}</div></div></AbsoluteFill>;
}

export default function Composition({ identity, script, audioUrl }: SaaSVergerCompositionProps) {
  let from = 0;
  const beats = script.acts.map((act) => {
    const duration = Math.max(1, Math.round(act.durationSeconds * 30));
    const beat = { act, from, duration };
    from += duration;
    return beat;
  });
  return <AbsoluteFill style={{ background: `linear-gradient(135deg, ${identity.bgColor}, #1a1030)` }}><AbsoluteFill style={{ background: `radial-gradient(circle at 20% 5%, ${identity.primaryColor}44, transparent 42%)` }} />{beats.map((beat, index) => <Sequence key={index} from={beat.from} durationInFrames={beat.duration}>{beat.act.screenKey === 'cta' ? <CTA identity={identity} /> : <ProductBeat act={beat.act} identity={identity} />}</Sequence>)}{audioUrl ? <Audio src={audioUrl} /> : null}</AbsoluteFill>;
}

export const calculateDemoVideoDuration = ({ script }: SaaSVergerCompositionProps) => Math.max(1, Math.round(script.totalSeconds * 30));
