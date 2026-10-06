import { useEffect, useState } from 'react';
import { Copy, Trash2, UserPlus, Users } from 'lucide-react';
import { CLONE_LIMITS, cloneNotes, cloneVoice, deleteClonedVoice, type Voice } from '../lib/elevenlabs';
import { formatBytes } from '../lib/runtime';
import {
  Badge,
  Dropzone,
  EmptyState,
  Field,
  FileRow,
  GhostButton,
  GlassCard,
  Notice,
  PrimaryButton,
  Skeleton,
  T,
  TabHeader,
  TextArea,
  TextInput,
  useToast,
} from '../components/Ui';
import { useVoiceCatalog } from '../hooks/useVoiceCatalog';

const ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/aac,audio/flac,audio/ogg,audio/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm';

export default function VoiceCloneTab() {
  const toast = useToast();
  const catalog = useVoiceCatalog();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastClone, setLastClone] = useState<Voice | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => setNotes(cloneNotes()), []);

  const cloned = catalog.voices.filter((voice) => voice.category === 'cloned');
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const addFiles = (incoming: File[]) => {
    const next = [...files];
    const rejected: string[] = [];
    incoming.forEach((file) => {
      if (next.length >= CLONE_LIMITS.files) {
        rejected.push(`${file.name} (over ${CLONE_LIMITS.files} samples)`);
        return;
      }
      if (file.size > CLONE_LIMITS.perFileBytes) {
        rejected.push(`${file.name} (over 10 MB)`);
        return;
      }
      if (next.some((entry) => entry.name === file.name && entry.size === file.size)) return;
      next.push(file);
    });
    const batch = next.reduce((sum, file) => sum + file.size, 0);
    if (batch > CLONE_LIMITS.totalBytes) {
      toast('error', 'Those samples add up to more than 25 MB. Remove one and try again.');
      return;
    }
    if (rejected.length) toast('error', `Skipped: ${rejected.join(', ')}`);
    setFiles(next);
  };

  const clone = async () => {
    if (!name.trim()) {
      toast('info', 'Give the voice a name.');
      return;
    }
    if (!files.length) {
      toast('info', 'Add at least one audio sample.');
      return;
    }
    setBusy(true);
    try {
      const voice = await cloneVoice(name, description, files);
      catalog.add(voice);
      setLastClone(voice);
      setNotes(cloneNotes());
      setName('');
      setDescription('');
      setFiles([]);
      toast('success', `“${voice.name}” is cloned and now in every voice dropdown.`);
    } catch (e: any) {
      toast('error', String(e?.message || 'The voice could not be cloned.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (voice: Voice) => {
    setDeleting(voice.id);
    try {
      await deleteClonedVoice(voice.id);
      catalog.remove(voice.id);
      if (lastClone?.id === voice.id) setLastClone(null);
      setNotes(cloneNotes());
      toast('success', `“${voice.name}” deleted.`);
    } catch (e: any) {
      toast('error', String(e?.message || 'That voice could not be deleted.'));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <TabHeader
        icon={UserPlus}
        title="Voice Clone"
        description="Turn 1–3 minutes of clean speech into a voice you can use in every other tab."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <GlassCard>
            <div className="space-y-4">
              <Field label="Voice name" hint={`${name.length} / 80`}>
                <TextInput value={name} onChange={(next) => setName(next.slice(0, 80))} maxLength={80} disabled={busy} placeholder="e.g. Founder Hinglish read" />
              </Field>
              <Field label="Description" hint="Saved on this device">
                <TextArea
                  value={description}
                  onChange={setDescription}
                  rows={3}
                  disabled={busy}
                  placeholder="What this voice is for — e.g. warm Mumbai-accented Hinglish for product reels."
                />
              </Field>
            </div>
          </GlassCard>

          <GlassCard>
            <Dropzone
              accept={ACCEPT}
              multiple
              disabled={busy || files.length >= CLONE_LIMITS.files}
              onFiles={addFiles}
              title={files.length ? `Add another sample (${files.length}/${CLONE_LIMITS.files})` : 'Drop audio samples here'}
              hint="MP3, WAV, M4A, AAC, FLAC, OGG or WEBM · up to 5 files, 10 MB each, 25 MB total"
            />
            {files.length ? (
              <div className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <FileRow
                    key={`${file.name}-${file.size}-${index}`}
                    name={file.name}
                    detail={formatBytes(file.size)}
                    onRemove={busy ? undefined : () => setFiles(files.filter((_, i) => i !== index))}
                  />
                ))}
                <p className="text-[11px]" style={{ color: T.textMuted }}>
                  {formatBytes(totalBytes)} of 25 MB used
                </p>
              </div>
            ) : null}
          </GlassCard>

          <Notice tone="info" title="How cloning runs">
            Cloning needs the real sample bytes uploaded, so it runs on the Audos-managed ElevenLabs account and is billed to your
            workspace wallet ($1.00 per voice, refunded automatically if creation fails). The cloned voice is private to this
            workspace. One to three minutes of clean, single-speaker speech gives the best result.
          </Notice>

          <PrimaryButton full icon={UserPlus} busy={busy} disabled={!name.trim() || !files.length} onClick={clone}>
            {busy ? 'Cloning voice…' : 'Clone voice'}
          </PrimaryButton>
        </div>

        <div className="space-y-4">
          {lastClone ? (
            <GlassCard tone="accent" className="vs-rise">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="success">Cloned</Badge>
                <span className="text-sm font-semibold" style={{ color: T.text }}>
                  {lastClone.name}
                </span>
              </div>
              <p className="mb-2 text-[13px]" style={{ color: T.textSecondary }}>
                It is already in the voice dropdown on Text to Speech, Speech to Speech and Avatar Lip-Sync.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-[11px]" style={{ background: T.inset, color: T.accentBright }}>
                  {lastClone.id}
                </code>
                <GhostButton
                  icon={Copy}
                  onClick={() => {
                    navigator.clipboard?.writeText(lastClone.id);
                    toast('success', 'Voice ID copied.');
                  }}
                >
                  Copy ID
                </GhostButton>
              </div>
            </GlassCard>
          ) : null}

          <GlassCard>
            <h3 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
              <span>Your cloned voices</span>
              <span>{cloned.length}</span>
            </h3>
            {catalog.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : !cloned.length ? (
              <EmptyState
                icon={Users}
                title="No cloned voices yet"
                body="Clone one on the left and it shows up here with a delete button, and in every voice dropdown in the app."
              />
            ) : (
              <div className="space-y-2">
                {cloned.map((voice) => (
                  <div key={voice.id} className="rounded-xl px-3 py-2.5" style={{ background: T.inset, border: `1px solid ${T.border}` }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium" style={{ color: T.text }}>
                            {voice.name}
                          </span>
                          {voice.indian ? <span className="text-xs">🇮🇳</span> : null}
                        </div>
                        {notes[voice.id] ? (
                          <p className="mt-0.5 text-[11px] leading-snug" style={{ color: T.textMuted }}>
                            {notes[voice.id]}
                          </p>
                        ) : null}
                        <code className="mt-1 block truncate text-[10px]" style={{ color: T.textMuted }}>
                          {voice.id}
                        </code>
                      </div>
                      <GhostButton tone="danger" icon={Trash2} disabled={deleting === voice.id} onClick={() => remove(voice)}>
                        {deleting === voice.id ? 'Deleting…' : 'Delete'}
                      </GhostButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
