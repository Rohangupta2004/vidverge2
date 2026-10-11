export const SEEDANCE_LAYER_SOURCE = String.raw`
const SeedanceClipLayer = ({ overlay, fps }: { overlay: any; fps: number }) => {
  if (!overlay.videoUrl) return null;
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, Math.max(1, Math.round(fps * 0.18))], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ ...positionStyle(overlay.position), zIndex: 1, opacity }}>
      <Video src={overlay.videoUrl} muted style={{ width: overlay.position.includes('sidebar') ? '100%' : 720, maxHeight: 760, objectFit: 'cover', borderRadius: 24, boxShadow: '0 18px 70px rgba(0,0,0,0.55)' }} />
    </div>
  );
};
`;
