// One voice catalog for the whole app. Loaded once and cached at module scope,
// so switching between Text to Speech, Speech to Speech and Avatar Lip-Sync
// does not re-fetch it, and a voice cloned in tab 2 appears in the other three
// as soon as it is added.
import { useCallback, useEffect, useState } from 'react';
import { loadVoices, sortVoices, type Engine, type Voice } from '../lib/elevenlabs';

interface CatalogState {
  voices: Voice[];
  engine: Engine | null;
  loading: boolean;
  error: string | null;
}

let cache: { voices: Voice[]; engine: Engine } | null = null;
let inFlight: Promise<{ voices: Voice[]; engine: Engine }> | null = null;
const subscribers = new Set<(state: CatalogState) => void>();
let shared: CatalogState = { voices: [], engine: null, loading: false, error: null };

function publish(next: Partial<CatalogState>) {
  shared = { ...shared, ...next };
  subscribers.forEach((listener) => listener(shared));
}

async function fetchCatalog(force: boolean) {
  if (!force && cache) {
    publish({ ...cache, loading: false, error: null });
    return;
  }
  if (inFlight && !force) return;
  publish({ loading: true, error: null });
  inFlight = loadVoices();
  try {
    const result = await inFlight;
    cache = result;
    publish({ voices: result.voices, engine: result.engine, loading: false, error: null });
  } catch (e: any) {
    publish({ loading: false, error: String(e?.message || 'The voice catalog could not be loaded.') });
  } finally {
    inFlight = null;
  }
}

export function useVoiceCatalog() {
  const [state, setState] = useState<CatalogState>(shared);

  useEffect(() => {
    subscribers.add(setState);
    setState(shared);
    if (!cache && !inFlight) void fetchCatalog(false);
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const reload = useCallback(() => {
    void fetchCatalog(true);
  }, []);

  /** Used by the voice picker's Indian flag and by Voice Clone after a clone lands. */
  const replace = useCallback((voices: Voice[]) => {
    const sorted = sortVoices(voices);
    if (cache) cache = { ...cache, voices: sorted };
    publish({ voices: sorted });
  }, []);

  const add = useCallback((voice: Voice) => {
    const next = sortVoices([voice, ...shared.voices.filter((entry) => entry.id !== voice.id)]);
    if (cache) cache = { ...cache, voices: next };
    publish({ voices: next });
  }, []);

  const remove = useCallback((voiceId: string) => {
    const next = shared.voices.filter((entry) => entry.id !== voiceId);
    if (cache) cache = { ...cache, voices: next };
    publish({ voices: next });
  }, []);

  return { ...state, reload, replace, add, remove };
}
