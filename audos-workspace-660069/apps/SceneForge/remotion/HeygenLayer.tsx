export const HEYGEN_LAYER_SOURCE = String.raw`
const HeygenLayer = ({ url, aspectRatio }: { url: string; aspectRatio: string }) => (
  <AbsoluteFill style={{ zIndex: 0, backgroundColor: '#050505' }}>
    {aspectRatio === '9:16' && <Video src={url} muted style={{ position: 'absolute', inset: -28, width: 'calc(100% + 56px)', height: 'calc(100% + 56px)', objectFit: 'cover', filter: 'blur(28px)', opacity: .38 }} />}
    <Video src={url} style={{ width: '100%', height: '100%', objectFit: aspectRatio === '9:16' ? 'contain' : 'cover', position: 'relative' }} />
  </AbsoluteFill>
);
`;
