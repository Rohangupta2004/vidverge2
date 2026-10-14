import { interpolate, useCurrentFrame } from 'remotion';

export default function HighlighterSweep({ width = 320, fps = 30, startFrame = 0, durationFrames = 9 }: { width?: number; fps?: number; startFrame?: number; durationFrames?: number }) {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [startFrame, startFrame + durationFrames], [0, width], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <rect x={0} y="0.72em" width={w} height="0.38em" fill="#FFE566" opacity={0.6} rx={4} />;
}
