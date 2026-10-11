export const TEXT_FACT_SOURCE = String.raw`
const TextFactOverlay = ({ overlay, fps }: { overlay: any; fps: number }) => {
  const frame = useCurrentFrame();
  const progress = spring({ frame, fps, config: { damping: 18, stiffness: 130 } });
  return (
    <div style={{ ...positionStyle(overlay.position), zIndex: 2, opacity: progress, transform: 'translateY(' + ((1 - progress) * 44) + 'px)' }}>
      <div style={{ maxWidth: 760, padding: '28px 34px', borderRadius: 24, color: '#fff', fontFamily: 'Inter, Arial, sans-serif', fontSize: 54, lineHeight: 1.05, fontWeight: 800, letterSpacing: -1.5, background: 'linear-gradient(135deg, rgba(12,12,16,.94), rgba(28,25,18,.9))', border: '1px solid rgba(245,181,62,.45)', boxShadow: '0 20px 70px rgba(0,0,0,.48)' }}>
        <span style={{ color: '#f5b53e' }}>◆ </span>{overlay.textContent}
      </div>
    </div>
  );
};
`;
