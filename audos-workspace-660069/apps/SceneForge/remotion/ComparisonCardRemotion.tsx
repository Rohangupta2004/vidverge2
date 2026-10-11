export const COMPARISON_CARD_SOURCE = String.raw`
const ComparisonCardRemotion = ({ overlay, fps }: { overlay: any; fps: number }) => {
  const frame = useCurrentFrame();
  const items = overlay.items || [];
  const twoColumn = items.length > 5 || items.some((item: any) => String(item.label).length > 30);
  return (
    <div style={{ ...positionStyle(overlay.position), zIndex: 2 }}>
      <div style={{ width: twoColumn ? 980 : 700, borderRadius: 28, padding: 34, color: '#fff', fontFamily: 'Inter, Arial, sans-serif', background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '1px solid rgba(245,181,62,.35)', boxShadow: '0 24px 80px rgba(0,0,0,.55)' }}>
        {overlay.textContent && <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 24, color: '#f5b53e' }}>{overlay.textContent}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: twoColumn ? '1fr 1fr' : '1fr', gap: 14 }}>
          {items.map((item: any, index: number) => {
            const enter = spring({ frame: frame - index * 4, fps, config: { damping: 17, stiffness: 145 } });
            const isNegative = String(item.value).includes('✗') || String(item.value).toLowerCase() === 'x';
            return (
              <div key={item.id || index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '18px 20px', borderRadius: 16, opacity: enter, transform: 'translateX(' + ((1 - enter) * 55) + 'px)', background: item.highlight ? 'rgba(245,181,62,.12)' : 'rgba(255,255,255,.055)', boxShadow: item.highlight ? '0 0 24px rgba(245,181,62,.16)' : 'none' }}>
                <span style={{ fontSize: 24, fontWeight: 650 }}>{item.label}</span>
                <span style={{ fontSize: 28, fontWeight: 900, color: isNegative ? '#fb7185' : '#f5b53e' }}>{item.value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
`;
