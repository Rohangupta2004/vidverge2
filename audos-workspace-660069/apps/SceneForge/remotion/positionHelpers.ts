export const POSITION_HELPERS_SOURCE = String.raw`
const positionStyle = (position: string): React.CSSProperties => {
  const base: React.CSSProperties = { position: 'absolute', display: 'flex', padding: 48 };
  switch (position) {
    case 'top-left': return { ...base, inset: 0, alignItems: 'flex-start', justifyContent: 'flex-start' };
    case 'top-right': return { ...base, inset: 0, alignItems: 'flex-start', justifyContent: 'flex-end' };
    case 'bottom-right': return { ...base, inset: 0, alignItems: 'flex-end', justifyContent: 'flex-end' };
    case 'center': return { ...base, inset: 0, alignItems: 'center', justifyContent: 'center' };
    case 'sidebar-left': return { ...base, left: 0, top: 0, bottom: 0, width: '48%', alignItems: 'center', justifyContent: 'center' };
    case 'sidebar-right': return { ...base, right: 0, top: 0, bottom: 0, width: '48%', alignItems: 'center', justifyContent: 'center' };
    default: return { ...base, inset: 0, alignItems: 'flex-end', justifyContent: 'flex-start' };
  }
};
`;
