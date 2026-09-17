import { useCallback, useEffect, useRef, useState } from 'react';

const MUSIC_SELECTION_KEY = 'reelio_ambient_music_track_v2';
const MUSIC_URL_KEY_PREFIX = 'reelio_ambient_music_url_v2';
const DEFAULT_WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const MUSIC_VOLUME = 0.12;

export type AmbientMusicTrackId =
  | 'off'
  | 'cinematic'
  | 'energetic'
  | 'tech'
  | 'uplifting'
  | 'lofi';

export interface AmbientMusicTrack {
  id: AmbientMusicTrackId;
  label: string;
  prompt?: string;
}

export const AMBIENT_MUSIC_TRACKS: AmbientMusicTrack[] = [
  { id: 'off', label: 'No Music' },
  {
    id: 'cinematic',
    label: 'Cinematic',
    prompt: 'Cinematic ambient underscore, warm evolving pads, sparse felt piano, subtle strings, no vocals, calm and unobtrusive for a creative conversation',
  },
  {
    id: 'energetic',
    label: 'Energetic',
    prompt: 'Upbeat energetic instrumental background music, crisp light percussion, bright synth pulse, forward momentum, no vocals, unobtrusive under conversation',
  },
  {
    id: 'tech',
    label: 'Tech',
    prompt: 'Modern technology ambient instrumental, clean digital textures, soft modular synth arpeggios, precise minimal beat, no vocals, focused and futuristic',
  },
  {
    id: 'uplifting',
    label: 'Uplifting',
    prompt: 'Uplifting instrumental background music, warm piano, gentle guitar harmonics, hopeful light rhythm, no vocals, positive and spacious under conversation',
  },
  {
    id: 'lofi',
    label: 'Lo-fi',
    prompt: 'Relaxed lo-fi instrumental, mellow electric piano, soft dusty drums, warm tape texture, no vocals, calm focus music for a creative chat',
  },
];

function isTrackId(value: string | null): value is AmbientMusicTrackId {
  return AMBIENT_MUSIC_TRACKS.some((track) => track.id === value);
}

function readSelection(): AmbientMusicTrackId {
  if (typeof window === 'undefined') return 'off';
  try {
    const value = window.localStorage.getItem(MUSIC_SELECTION_KEY);
    return isTrackId(value) ? value : 'off';
  } catch {
    return 'off';
  }
}

function saveSelection(value: AmbientMusicTrackId): void {
  try {
    window.localStorage.setItem(MUSIC_SELECTION_KEY, value);
  } catch {
    // The player still works for this visit when storage is unavailable.
  }
}

function cachedTrackUrl(trackId: AmbientMusicTrackId): string {
  try {
    return window.localStorage.getItem(`${MUSIC_URL_KEY_PREFIX}.${trackId}`) || '';
  } catch {
    return '';
  }
}

function cacheTrackUrl(trackId: AmbientMusicTrackId, url: string): void {
  try {
    window.localStorage.setItem(`${MUSIC_URL_KEY_PREFIX}.${trackId}`, url);
  } catch {
    // The generated URL remains available on the current audio element.
  }
}

function workspaceId(fallback: string): string {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_ID;
  const runtime = window as any;
  const candidate = String(
    runtime.__WORKSPACE_ID__ || runtime.__workspaceDb?.workspaceId || fallback || '',
  );
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate)
    ? candidate
    : DEFAULT_WORKSPACE_ID;
}

function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export interface ReelioAudioController {
  selectedTrackId: AmbientMusicTrackId;
  isMusicPlaying: boolean;
  isMusicLoading: boolean;
  musicError: string;
  audioRef: { current: HTMLAudioElement | null };
  selectTrack: (trackId: AmbientMusicTrackId) => void;
  toggleMusic: () => void;
}

export function useReelioAudio(spaceId: string): ReelioAudioController {
  const [selectedTrackId, setSelectedTrackId] = useState<AmbientMusicTrackId>(readSelection);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isMusicLoading, setIsMusicLoading] = useState(false);
  const [musicError, setMusicError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedTrackRef = useRef<AmbientMusicTrackId>(selectedTrackId);
  const playingIntentRef = useRef(false);
  const requestRef = useRef(0);

  const playTrack = useCallback(async (trackId: AmbientMusicTrackId): Promise<boolean> => {
    const track = AMBIENT_MUSIC_TRACKS.find((item) => item.id === trackId);
    if (!track || track.id === 'off' || !track.prompt) return false;

    const requestId = ++requestRef.current;
    setMusicError('');
    setIsMusicLoading(true);

    try {
      let url = cachedTrackUrl(track.id);
      if (!url) {
        const token = workspaceToken();
        if (!token) throw new Error('Music is still getting ready. Try again in a moment.');
        const response = await fetch(
          `/api/workspaces/${workspaceId(spaceId)}/audio/music/custom`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Workspace-DB-Token': token,
            },
            body: JSON.stringify({
              prompt: track.prompt,
              lengthMs: 45000,
              instrumental: true,
            }),
          },
        );
        const data = await response.json().catch(() => null);
        url = typeof data?.audioUrl === 'string' ? data.audioUrl : '';
        if (!response.ok || !url) throw new Error('This music track could not be prepared.');
        cacheTrackUrl(track.id, url);
      }

      if (requestId !== requestRef.current || selectedTrackRef.current !== track.id) return false;
      const audio = audioRef.current;
      if (!audio) return false;
      if (audio.src !== url) {
        audio.src = url;
        audio.load();
      }
      audio.volume = MUSIC_VOLUME;
      audio.loop = true;
      await audio.play();
      if (requestId !== requestRef.current) return false;
      playingIntentRef.current = true;
      setIsMusicPlaying(true);
      return true;
    } catch (error) {
      if (requestId === requestRef.current) {
        playingIntentRef.current = false;
        setIsMusicPlaying(false);
        setMusicError(error instanceof Error ? error.message : 'This music track could not be played.');
      }
      return false;
    } finally {
      if (requestId === requestRef.current) setIsMusicLoading(false);
    }
  }, [spaceId]);

  const selectTrack = useCallback((trackId: AmbientMusicTrackId) => {
    const continuePlaying = playingIntentRef.current;
    requestRef.current += 1;
    selectedTrackRef.current = trackId;
    setSelectedTrackId(trackId);
    saveSelection(trackId);
    setMusicError('');

    const audio = audioRef.current;
    if (audio) audio.pause();
    setIsMusicPlaying(false);
    setIsMusicLoading(false);

    if (trackId === 'off') {
      playingIntentRef.current = false;
      return;
    }
    if (continuePlaying) void playTrack(trackId);
  }, [playTrack]);

  const toggleMusic = useCallback(() => {
    if (isMusicLoading) return;
    if (isMusicPlaying) {
      playingIntentRef.current = false;
      audioRef.current?.pause();
      setIsMusicPlaying(false);
      return;
    }

    const trackId = selectedTrackRef.current === 'off'
      ? 'cinematic'
      : selectedTrackRef.current;
    if (selectedTrackRef.current === 'off') {
      selectedTrackRef.current = trackId;
      setSelectedTrackId(trackId);
      saveSelection(trackId);
    }
    playingIntentRef.current = true;
    void playTrack(trackId);
  }, [isMusicLoading, isMusicPlaying, playTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handlePlay = () => setIsMusicPlaying(true);
    const handlePause = () => setIsMusicPlaying(false);
    const handleError = () => {
      playingIntentRef.current = false;
      setIsMusicPlaying(false);
      setIsMusicLoading(false);
      setMusicError('This music track could not be played.');
    };
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    return () => {
      requestRef.current += 1;
      playingIntentRef.current = false;
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  return {
    selectedTrackId,
    isMusicPlaying,
    isMusicLoading,
    musicError,
    audioRef,
    selectTrack,
    toggleMusic,
  };
}

export default useReelioAudio;
