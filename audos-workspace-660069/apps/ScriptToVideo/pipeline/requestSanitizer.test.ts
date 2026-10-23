import { SEEDANCE_2_5, sanitizeVideoRequestBody } from './videoModelService';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runRequestSanitizerTests(): void {
  const sanitized = sanitizeVideoRequestBody(SEEDANCE_2_5, {
    model: 'openrouter/bytedance/seedance-2.5',
    prompt: 'A cinematic product reveal in amber light.',
    aspectRatio: '2:1',
    duration: 33.7,
    resolution: '4k',
    generateAudio: true,
    safetyFilterLevel: 'block_only_high',
    negativePrompt: 'text',
    imageData: 'https://storage.googleapis.com/public/first.png',
    referenceImages: [
      { imageData: 'https://storage.googleapis.com/public/a.jpg', referenceType: 'style' },
      { imageData: '/api/private-files/workspaces/ws/private-uploads/b.png' },
      { imageData: 'https://storage.googleapis.com/public/c.webp' },
      { imageData: 'https://storage.googleapis.com/public/d.png' },
    ],
  });

  assert(sanitized.duration === 30, 'duration must clamp to Seedance 2.5 range');
  assert(sanitized.aspectRatio === '16:9', 'unsupported aspect must fall back safely');
  assert(sanitized.resolution === '720p', 'unsupported resolution must fall back safely');
  assert(!('safetyFilterLevel' in sanitized), 'unsupported safety filter must be removed');
  assert(!('negativePrompt' in sanitized), 'unsupported negative prompt must be removed');
  assert(Boolean(sanitized.imageData), 'the continuity frame must win over optional asset references');
  assert(!('referenceImages' in sanitized), 'frames and asset references must never be combined');

  const references = sanitizeVideoRequestBody(SEEDANCE_2_5, {
    model: SEEDANCE_2_5.apiModel,
    prompt: 'Keep the same product throughout the shot.',
    duration: 8,
    aspectRatio: '16:9',
    referenceImages: [
      { imageData: 'https://storage.googleapis.com/public/a.jpg', referenceType: 'style' },
      { imageData: '/api/private-files/workspaces/ws/private-uploads/b.png' },
      { imageData: 'https://storage.googleapis.com/public/c.webp' },
      { imageData: 'https://storage.googleapis.com/public/d.png' },
    ],
  });
  assert(Array.isArray(references.referenceImages) && references.referenceImages.length === 3, 'references must be public and capped at three');
  assert((references.referenceImages as any[]).every((item) => item.referenceType === 'asset'), 'Seedance references must be asset references');

  const frames = sanitizeVideoRequestBody(SEEDANCE_2_5, {
    model: SEEDANCE_2_5.apiModel,
    prompt: 'Interpolate from dawn to dusk.',
    duration: 4,
    aspectRatio: '9:16',
    imageData: 'data:image/png;base64,' + 'A'.repeat(300),
    lastFrameImage: { imageData: 'data:image/webp;base64,' + 'B'.repeat(300) },
  });
  assert(Boolean(frames.imageData && frames.lastFrameImage), 'first and last frame must be kept together');
  assert(!('referenceImages' in frames), 'frame interpolation must not carry asset references');
}
