// STEP 2 — who narrates, and in whose voice.
//
// Three voice routes, same as the rest of SceneForge: a HeyGen voice, or the
// customer's OWN recording which HeyGen lip-syncs the presenter to. On the
// custom-voice route nothing is synthesised — the voice on the finished film
// is the one in the uploaded file.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Mic, Search, Trash2, Upload, Volume2 } from 'lucide-react';
import { fetchAvatarLooks, fetchVoices, HeyGenError } from '../../lib/heygenStudio';
import { INDIA_VOICE_SEEDS, sortAvatars, sortVoices, withIndiaSeedVoices, type AvatarView, type VoiceView } from '../../lib/heygenCatalog';
import { uploadCustomVoice } from '../../lib/directorNarration';
import type { DirectorSession } from '../../lib/directorSession';

export interface NarratorPickerProps {
  session: DirectorSession;
  onPatch: (patch: Partial<DirectorSession>) => void;
}

const card = 'rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]';

export default function NarratorPicker({ session, onPatch }: NarratorPickerProps) {
  const [avatars, setAvatars] = useState<AvatarView[]>([]);
  const [voices, setVoices] = useState<VoiceView[]>([]);
  const [loadingAvatars, setLoadingAvatars] = useState(true);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [avatarQuery, setAvatarQuery] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [pastedId, setPastedId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState('');

  useEffect(() => {
    let live = true;
    fetchAvatarLooks((page) => { if (live) setAvatars(sortAvatars(page)); })
      .then((result) => { if (live) setAvatars(sortAvatars(result.items)); })
      .catch((e) => { if (live) setCatalogError(e instanceof HeyGenError ? e.message : String(e?.message || e)); })
      .finally(() => { if (live) setLoadingAvatars(false); });
    fetchVoices()
      .then((result) => { if (live) setVoices(sortVoices(withIndiaSeedVoices(result.voices))); })
      .catch(() => { if (live) setVoices(sortVoices(withIndiaSeedVoices(INDIA_VOICE_SEEDS))); })
      .finally(() => { if (live) setLoadingVoices(false); });
    return () => { live = false; };
  }, []);

  const visibleAvatars = useMemo(() => {
    const query = avatarQuery.trim().toLowerCase();
    const pool = query ? avatars.filter((view) => `${view.name} ${view.gender} ${view.styleLabel}`.toLowerCase().includes(query)) : avatars;
    return pool.slice(0, 60);
  }, [avatars, avatarQuery]);

  const visibleVoices = useMemo(() => {
    const query = voiceQuery.trim().toLowerCase();
    const pool = query ? voices.filter((view) => `${view.name} ${view.language} ${view.gender}`.toLowerCase().includes(query)) : voices;
    return pool.slice(0, 80);
  }, [voices, voiceQuery]);

  const playPreview = (voice: VoiceView) => {
    const sample = String(voice.raw?.preview_audio || voice.raw?.sample || voice.raw?.preview_url || '');
    if (!sample) return;
    previewRef.current?.pause();
    const audio = new Audio(sample);
    previewRef.current = audio;
    setPreviewingVoice(voice.id);
    audio.onended = () => setPreviewingVoice('');
    audio.onerror = () => setPreviewingVoice('');
    void audio.play().catch(() => setPreviewingVoice(''));
  };

  const onVoiceFile = async (file: File | null) => {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const stored = await uploadCustomVoice(file);
      onPatch({ customVoice: stored, useCustomVoice: true });
    } catch (e: any) {
      setUploadError(String(e?.message || e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={`${card} p-5`}>
        <header className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">1 · Presenter</h3>
            <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Your live HeyGen avatar library.</p>
          </div>
          {session.avatarId ? <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--space-semantic-success-500)_16%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--space-text-primary)]"><Check className="h-3 w-3" />{session.avatarName || session.avatarId.slice(0, 10)}</span> : null}
        </header>

        <label className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2">
          <Search className="h-4 w-4 text-[var(--space-text-muted)]" />
          <input value={avatarQuery} onChange={(event) => setAvatarQuery(event.target.value)} placeholder="Search presenters" className="w-full bg-transparent text-sm outline-none" />
        </label>

        {catalogError ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{catalogError}
          </p>
        ) : null}

        <div className="mt-3 grid max-h-[320px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
          {loadingAvatars && !avatars.length ? (
            <div className="col-span-full flex items-center gap-2 py-8 text-sm text-[var(--space-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Loading presenters…</div>
          ) : null}
          {visibleAvatars.map((view) => (
            <button
              key={view.id}
              onClick={() => { onPatch({ avatarId: view.id, avatarName: view.name }); setPastedId(''); }}
              className={`overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5 ${session.avatarId === view.id ? 'border-[var(--space-brand-primary-500)] ring-2 ring-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)]' : 'border-[var(--space-border-default)]'}`}
            >
              <div className="aspect-[3/4] bg-[var(--space-surface-base)]">
                {view.image ? <img src={view.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
              </div>
              <div className="truncate px-2 py-1.5 text-[11px] font-medium">{view.indian ? '\u{1F1EE}\u{1F1F3} ' : ''}{view.name}</div>
            </button>
          ))}
        </div>

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-[var(--space-text-muted)]">Use a HeyGen avatar ID instead</summary>
          <div className="mt-2 flex gap-2">
            <input
              value={pastedId}
              onChange={(event) => setPastedId(event.target.value)}
              placeholder="avatar_id"
              className="w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2 text-sm outline-none"
            />
            <button
              onClick={() => pastedId.trim() && onPatch({ avatarId: pastedId.trim(), avatarName: 'Pasted ID' })}
              className="shrink-0 rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-sm font-semibold text-white"
            >
              Use
            </button>
          </div>
          <p className="mt-2 text-[var(--space-text-muted)]">Personal and instant avatars are not always in the look catalog. There is no preview for a pasted ID — HeyGen checks it when the narration render starts.</p>
        </details>
      </section>

      <section className={`${card} p-5`}>
        <header>
          <h3 className="text-base font-semibold">2 · Voice</h3>
          <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">A HeyGen voice, or lip-sync the presenter to your own recording.</p>
        </header>

        <div className="mt-4 flex rounded-xl border border-[var(--space-border-default)] p-1">
          {[{ id: false, label: 'HeyGen voice' }, { id: true, label: 'Your narration' }].map((option) => (
            <button
              key={String(option.id)}
              onClick={() => onPatch({ useCustomVoice: option.id })}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${session.useCustomVoice === option.id ? 'bg-[var(--space-brand-primary-600)] text-white' : 'text-[var(--space-text-muted)]'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {session.useCustomVoice ? (
          <div className="mt-4">
            {session.customVoice ? (
              <div className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Mic className="h-4 w-4 shrink-0 text-[var(--space-text-brand)]" />
                    <span className="truncate">{session.customVoice.name}</span>
                  </span>
                  <button onClick={() => onPatch({ customVoice: null })} className="shrink-0 rounded-lg p-1.5 text-[var(--space-text-muted)] hover:text-[var(--space-text-primary)]" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <audio src={session.customVoice.url} controls className="mt-3 w-full" />
                <p className="mt-2 text-[11px] text-[var(--space-text-muted)]">{(session.customVoice.sizeBytes / 1024 / 1024).toFixed(1)} MB · the presenter will be lip-synced to exactly this audio.</p>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--space-border-default)] px-4 py-8 text-center text-sm transition-colors hover:border-[var(--space-brand-primary-500)]">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-[var(--space-text-brand)]" />}
                <span className="font-semibold">{uploading ? 'Uploading…' : 'Upload WAV, MP3 or M4A'}</span>
                <span className="text-xs text-[var(--space-text-muted)]">Up to 50 MB. The script box becomes optional — your recording carries the words.</span>
                <input type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a" className="hidden" onChange={(event) => onVoiceFile(event.target.files?.[0] || null)} />
              </label>
            )}
            {uploadError ? <p className="mt-2 text-xs text-[var(--space-semantic-danger-500)]">{uploadError}</p> : null}
          </div>
        ) : (
          <>
            <label className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--space-text-muted)]" />
              <input value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)} placeholder="Search voices" className="w-full bg-transparent text-sm outline-none" />
            </label>
            <div className="mt-3 max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
              {loadingVoices && !voices.length ? (
                <div className="flex items-center gap-2 py-6 text-sm text-[var(--space-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Loading voices…</div>
              ) : null}
              {visibleVoices.map((view) => (
                <div
                  key={view.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${session.voiceId === view.id ? 'border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)]' : 'border-[var(--space-border-default)]'}`}
                >
                  <button onClick={() => onPatch({ voiceId: view.id, voiceName: view.name })} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">{view.indian ? '\u{1F1EE}\u{1F1F3} ' : ''}{view.name}</div>
                    <div className="truncate text-[11px] text-[var(--space-text-muted)]">{view.language}{view.gender ? ` · ${view.gender}` : ''}</div>
                  </button>
                  <button onClick={() => playPreview(view)} className="shrink-0 rounded-lg p-1.5 text-[var(--space-text-muted)] hover:text-[var(--space-text-primary)]" title="Preview">
                    {previewingVoice === view.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--space-text-muted)]">
            <span>Speaking speed</span>
            <span>{session.speed.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={0.8}
            max={1.5}
            step={0.05}
            value={session.speed}
            disabled={session.useCustomVoice}
            onChange={(event) => onPatch({ speed: Number(event.target.value) })}
            className="mt-2 w-full accent-[var(--space-brand-primary-600)] disabled:opacity-40"
          />
          {session.useCustomVoice ? <p className="mt-1 text-[11px] text-[var(--space-text-muted)]">Speed does not apply to a lip-synced recording — the audio plays at its own pace.</p> : null}
        </div>
      </section>
    </div>
  );
}
