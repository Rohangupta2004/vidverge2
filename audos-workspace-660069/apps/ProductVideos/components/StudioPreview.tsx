// Product Videos — the embedded Remotion Studio panel.
// Renders the studio document (lib/studio.ts) inside an iframe INSIDE the app:
// play/pause, frame scrubbing, audio, and fullscreen all live in this panel —
// never a new browser tab.

import { useMemo } from 'react';
import { buildStudioSrcDoc } from '../lib/studio';

interface StudioPreviewProps {
  videoUrl: string;
  title: string;
  durationInFrames: number;
  vertical: boolean;
}

export default function StudioPreview({ videoUrl, title, durationInFrames, vertical }: StudioPreviewProps) {
  const srcDoc = useMemo(
    () =>
      buildStudioSrcDoc({
        videoUrl,
        title,
        fps: 30,
        durationInFrames,
        vertical,
      }),
    [videoUrl, title, durationInFrames, vertical],
  );

  return (
    <iframe
      title="Remotion Studio preview"
      srcDoc={srcDoc}
      allow="fullscreen; autoplay"
      allowFullScreen
      style={{
        width: '100%',
        height: '100%',
        minHeight: 480,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        background: '#0B0F17',
        display: 'block',
      }}
    />
  );
}
