export const STATIC_IMAGE_SOURCE = String.raw`
const StaticImageOverlay = ({ overlay, fps }: { overlay: any; fps: number }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, Math.max(1, Math.round(fps * .25))], [0, 1], { extrapolateRight: 'clamp' });
  const scale = interpolate(frame, [0, Math.max(1, Math.round(fps * .35))], [.96, 1], { extrapolateRight: 'clamp' });
  if (!overlay.imageUrl) return null;
  return (
    <div style={{ ...positionStyle(overlay.position), zIndex: 2, opacity, transform: 'scale(' + scale + ')' }}>
      <Img src={overlay.imageUrl} style={{ width: overlay.position.includes('sidebar') ? '100%' : 720, maxHeight: 760, objectFit: 'cover', borderRadius: 24, boxShadow: '0 18px 70px rgba(0,0,0,.52)' }} />
    </div>
  );
};
`;
