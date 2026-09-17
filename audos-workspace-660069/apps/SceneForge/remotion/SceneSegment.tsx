import { AbsoluteFill, Audio, Img, Video } from 'remotion';

export default function SceneSegment({ motionBgSrc, assetUrls, avatarAudioSrc, startFrom = 0 }: { motionBgSrc?: string; assetUrls: string[]; avatarAudioSrc: string; startFrom?: number }) {
  return <AbsoluteFill style={{ background: '#0A0F1E', overflow: 'hidden' }}>
    {motionBgSrc ? <Video src={motionBgSrc} muted loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
    {assetUrls.map((src, index) => <Img key={src} src={src} style={{ position: 'absolute', inset: `${8 + index * 4}%`, width: `${84 - index * 8}%`, height: `${84 - index * 8}%`, objectFit: 'contain', filter: 'drop-shadow(0 18px 26px rgba(0,0,0,.32))' }} />)}
    <Audio src={avatarAudioSrc} startFrom={startFrom} />
  </AbsoluteFill>;
}
