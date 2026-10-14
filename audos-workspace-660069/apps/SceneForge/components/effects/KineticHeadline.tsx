import { interpolate, useCurrentFrame } from 'remotion';

export default function KineticHeadline({ text, highlight, fps = 30, enterFrames = 14 }: { text: string; highlight?: string; fps?: number; enterFrames?: number }) {
  const frame = useCurrentFrame();
  const wipe = interpolate(frame, [0, enterFrames], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hlW = highlight ? interpolate(frame, [enterFrames, enterFrames + 9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const parts = highlight && text.includes(highlight) ? text.split(highlight) : [text];
  return (
    <div style={{ fontFamily: "'Archivo Black', 'Arial Black', system-ui, sans-serif", fontSize: 56, fontWeight: 900, color: '#1A1208', lineHeight: 1.05, clipPath: `inset(0 0 ${wipe}% 0)` }}>
      {parts[0]}
      {highlight ? <span style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 0, bottom: 2, width: `${hlW * 100}%`, height: '0.35em', background: 'rgba(255,229,102,0.65)', zIndex: 0 }} /><span style={{ position: 'relative', zIndex: 1 }}>{highlight}</span></span> : null}
      {parts[1] || ''}
    </div>
  );
}
