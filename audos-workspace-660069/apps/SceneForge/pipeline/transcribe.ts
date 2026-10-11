import type { TranscriptResult, TranscriptWord } from '../types';

const token = () => {
  const value = (window as any).__workspaceDb?.token;
  if (!value) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return value as string;
};

export async function transcribeHeygenVideo(videoUrl: string): Promise<TranscriptResult> {
  const endpoint = '/proxy/deepgram/v1/listen?model=nova-2&diarize=false&punctuate=true&utterances=true&detect_language=true&smart_format=true';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token(),
    },
    body: JSON.stringify({ url: videoUrl }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Deepgram transcription failed (${response.status})`);

  const alternative = data?.results?.channels?.[0]?.alternatives?.[0] ?? data;
  const words: TranscriptWord[] = (alternative?.words ?? data?.words ?? []).map((item: any) => ({
    word: String(item.word ?? item.punctuated_word ?? ''),
    start: Number(item.start ?? 0),
    end: Number(item.end ?? item.start ?? 0),
    confidence: Number(item.confidence ?? 0),
  })).filter((item: TranscriptWord) => item.word);

  const fullText = String(alternative?.transcript ?? data?.transcript ?? words.map((item) => item.word).join(' ')).trim();
  const duration = Number(data?.metadata?.duration ?? data?.duration ?? words[words.length - 1]?.end ?? 0);
  const language = String(data?.metadata?.detected_language ?? data?.results?.channels?.[0]?.detected_language ?? data?.language ?? 'auto');

  if (!fullText || !words.length) throw new Error('Deepgram returned no timestamped speech. Check that the video contains audible dialogue.');
  return { words, language, fullText, duration };
}
