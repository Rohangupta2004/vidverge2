import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export default function GeneratedScene({ assets = [] }: { assets: { public_url?: string }[] }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>{assets.filter((a) => a.public_url).map((asset, index) => {
    const enter = spring({ frame: frame - index * 6, fps, config: { damping: 16, stiffness: 110 } });
    const drift = interpolate(frame, [0, fps * 6], [-12 + index * 8, 12 - index * 5], { extrapolateRight: 'clamp' });
    return <Img key={asset.public_url} src={asset.public_url!} style={{ position: 'absolute', width: `${76 - index * 8}%`, height: `${76 - index * 8}%`, objectFit: 'contain', opacity: enter, transform: `translateX(${drift}px) scale(${0.92 + enter * 0.08})` }} />;
  })}</AbsoluteFill>;
}
