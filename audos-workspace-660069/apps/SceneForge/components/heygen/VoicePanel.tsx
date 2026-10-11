// Voice: clone the customer's own, or pick one HeyGen can already render.
//
// Whichever is chosen is written to the session lock, so the voice stays the
// same across every scene exactly as the avatar does. A clone outranks a stock
// voice: if the customer went to the trouble of recording themselves, nothing
// in the app should quietly swap it for a default.
import { useEffect, useMemo, useState } from 'react';
import { Check, Mic, Play, Search } from 'lucide-react';
import { describeError } from '../../lib/heygenApi';
import { MIN_CLONE_SECONDS, audioDuration, cloneVoice, isSupportedAudio, listV3Voices } from '../../lib/heygenVoice';
import { setVoice, useHeyGenSession } from '../../lib/heygenSession';
import { Button, CapabilityNote, Field, LockBadge, Notice, Panel, Progress, Segmented, fieldClassFor } from './ui';

type Mode = 'library' | 'clone';

interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender: string;
  previewUrl: string;
}

export default function VoicePanel({ step }: { step: number }) {
  const session = useHeyGenSession();
  const [mode, setMode] = useState<Mode>('library');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);

  const [cloneName, setCloneName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneElapsed, setCloneElapsed] = useState(0);
  const [cloneError, setCloneError] = useState('');
  const [playing, setPlaying] = useState('');

  useEffect(() => {
    let cancelled = false;
    listV3Voices()
      .then((result) => { if (!cancelled) setVoices(result); })
      .catch((e) => { if (!cancelled) setListError(describeError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return voices;
    return voices.filter((voice) => `${voice.name} ${voice.language} ${voice.gender}`.toLowerCase().includes(needle));
  }, [voices, query]);

  useEffect(() => setLimit(12), [query]);

  function audition(voice: VoiceOption) {
    if (!voice.previewUrl) return;
    setPlaying(voice.id);
    const audio = new Audio(voice.previewUrl);
    audio.onended = () => setPlaying('');
    audio.onerror = () => setPlaying('');
    void audio.play().catch(() => setPlaying(''));
  }

  async function runClone(file: File) {
    setCloneError('');
    setCloneElapsed(0);
    if (!isSupportedAudio(file)) {
      setCloneError('Use a WAV, MP3 or M4A recording of your voice.');
      return;
    }
    // Checked before the upload so a short recording costs nothing but a
    // message, rather than an upload and a rejected clone.
    const seconds = await audioDuration(file);
    if (seconds && seconds < MIN_CLONE_SECONDS) {
      setCloneError(`HeyGen needs at least ${MIN_CLONE_SECONDS} seconds of clear speech — this recording is ${Math.round(seconds)}s.`);
      return;
    }
    setCloning(true);
    try {
      const { voice } = await cloneVoice(file, cloneName, setCloneElapsed);
      setVoice(voice.voiceId, voice.name, true);
    } catch (e) {
      setCloneError(describeError(e));
    } finally {
      setCloning(false);
    }
  }

  return <Panel
    step={step}
    done={Boolean(session.voiceId)}
    title="Set the voice"
    hint="Clone your own voice, or pick one from HeyGen's library. Either way it stays the same in every scene."
    action={session.voiceId
      ? <LockBadge text={session.voiceCloned ? `Voice cloned \u2713 ${session.voiceName}` : `Voice: ${session.voiceName}`} onChange={() => setVoice('', '', false)} />
      : undefined}
  >
    <div className="space-y-4">
      <Segmented
        value={mode}
        options={[{ value: 'library', label: 'HeyGen library', icon: Search }, { value: 'clone', label: 'Clone my voice', icon: Mic }]}
        onChange={(value) => setMode(value)}
      />

      {mode === 'library' ? <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} inputMode="search" autoComplete="off"
            placeholder="Search HeyGen voices by name, language or gender" className="st-field st-field--icon" />
        </div>

        {loading ? <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="st-shimmer h-16 rounded-xl bg-[var(--space-surface-muted)]" />)}
        </div>
          : listError && !voices.length ? <Notice tone="error" title="The voice library did not load">{listError}</Notice>
            : !filtered.length ? <Notice tone="info" title="No voices match that search">Clear the search to see the whole library.</Notice>
              : <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {filtered.slice(0, limit).map((voice) => {
                    const selected = session.voiceId === voice.id;
                    return <div key={voice.id} className={`flex items-center gap-3 rounded-xl border p-3 ${selected
                      ? 'border-[#C8920A] bg-[color-mix(in_srgb,#C8920A_12%,transparent)]'
                      : 'border-[var(--space-border-default)] bg-[var(--space-surface-panel)]'}`}>
                      <button type="button" onClick={() => setVoice(voice.id, voice.name, false)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-2 truncate text-sm font-medium text-[var(--space-text-primary)]">
                          {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[#C8920A]" /> : null}
                          <span className="truncate">{voice.name}</span>
                        </div>
                        <div className="truncate text-xs text-[var(--space-text-muted)]">
                          {[voice.language, voice.gender].filter(Boolean).join(' \u00b7 ') || 'Voice'}
                        </div>
                      </button>
                      {voice.previewUrl ? <button
                        type="button"
                        onClick={() => audition(voice)}
                        aria-label={`Hear ${voice.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--space-border-default)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
                      >
                        <Play className={`h-3.5 w-3.5 ${playing === voice.id ? 'animate-pulse text-[#C8920A]' : ''}`} />
                      </button> : null}
                    </div>;
                  })}
                </div>
                {filtered.length > limit
                  ? <Button tone="ghost" onClick={() => setLimit((current) => current + 24)}>Show more voices</Button>
                  : null}
              </>}
      </div> : <div className="space-y-3">
        <CapabilityNote capability="voice-clone" label="Voice cloning">
          You can still pick any voice from HeyGen&rsquo;s library — only building a clone of your own voice is unavailable.
        </CapabilityNote>

        <Field label="Name this voice" hint="So you can tell it apart from HeyGen's stock voices later.">
          <input value={cloneName} onChange={(event) => setCloneName(event.target.value)}
            placeholder="e.g. My studio voice" className="st-field" />
        </Field>

        {/* The clone's failure messages are about the FILE, so they sit on the
            file field itself rather than only in the notice below. */}
        <Field
          label="Your recording"
          hint={`A WAV, MP3 or M4A of at least ${MIN_CLONE_SECONDS} seconds of clear speech — no music or background noise. Read anything you like.`}
          error={cloneError}
        >
          <input
            type="file"
            accept="audio/*,video/mp4"
            disabled={cloning}
            aria-invalid={cloneError ? true : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void runClone(file);
            }}
            className={`${fieldClassFor('st-field', Boolean(cloneError))} file:mr-3 file:rounded-lg file:border-0 file:bg-[color-mix(in_srgb,#C8920A_22%,transparent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1A1000]`}
          />
        </Field>

        {cloning ? <Progress elapsedSec={cloneElapsed} expectedSec={90} label="Cloning your voice" /> : null}
        {session.voiceCloned ? <Notice tone="ok" title="Voice cloned">
          Every scene you generate from now on speaks in your own voice.
        </Notice> : null}
      </div>}
    </div>
  </Panel>;
}
