import { AbsoluteFill, OffthreadVideo } from 'remotion';

export default function AvatarSegment({ videoSrc, startFrom = 0 }: { videoSrc: string; startFrom?: number }) {
  return <AbsoluteFill><OffthreadVideo src={videoSrc} startFrom={startFrom} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
}
