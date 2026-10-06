import { useState } from 'react';
import { Repeat, Waves } from 'lucide-react';
import { DEFAULT_VOICE_SETTINGS, S2S_LIMITS, S2S_MODELS, speechToSpeech, type VoiceSettings } from '../lib/elevenlabs';
import { downloadRemote, formatBytes } from '../lib/runtime';
import { VoicePicker } from '../components/VoicePicker';
import { VoiceSettingsPanel } from '../components/VoiceSettingsPanel';
import {
  AudioPlayer,
  Dropzone,
  EmptyState,
  Field,
  FileRow,
  GeneratingSkeleton,
  GlassCard,
  Notice,
  PrimaryButton,
  Select,
  T,
  TabHeader,
  Toggle,
  useToast,
} from '../components/Ui';
import { useVoiceCatalog } from '../hooks/useVoiceCatalog';

const ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/aac,audio/flac,audio/ogg,audio/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm';

export default function SpeechToSpeechTab() {
  const toast = useToast();
  const catalog = useVoiceCatalog();
  const [file, setFile] = useState<File | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState(S2S_MODELS[0].id);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [denoise, setDenoise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; durationMs: number } | null>(null);

  const activeVoiceId = voiceId || catalog.voices[0]?.id || '';
  const activeVoice = catalog.voices.find((voice) => voice.id === activeVoiceId);

  const take = (files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (next.size > S2S_LIMITS.bytes) {
      toast('error', 'That recording is over 25 MB. Split it and try again.');
      return;
    }
    setFile(next);
    setResult(null);
  };

  const convert = async () => {
    if (!file || !activeVoiceId) return;
    setBusy(true);
    setResult(null);
    try {
      const converted = await speechToSpeech({
        file,
        voiceId: activeVoiceId,
        modelId,
        settings,
        removeBackgroundNoise: denoise,
      });
      setResult(converted);
      toast('success', 'Converted. The words and timing are unchanged — only the voice moved.');
    } catch (e: any) {
      toast('error', String(e?.message || 'The voice could not be converted.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TabHeader
        icon={Repeat}
        title="Speech to Speech"
        description="Keep the words, timing and emotion of a recording and swap the voice for any on your account."
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <Dropzone
              accept={ACCEPT}
              disabled={busy}
              onFiles={take}
              title={file ? 'Replace the source recording' : 'Drop your source recording here'}
              hint="MP3, WAV, M4A, AAC, FLAC, OGG or WEBM · up to 25 MB and 5 minutes"
            />
            {file ? (
              <div className="mt-3">
                <FileRow name={file.name} detail={formatBytes(file.size)} onRemove={busy ? undefined : () => setFile(null)} />
              </div>
            ) : null}
          </GlassCard>

          {busy ? <GeneratingSkeleton label="Re-voicing your recording…" /> : null}

          {result ? (
            <AudioPlayer
              src={result.url}
              title={`Re-voiced as ${activeVoice?.name || 'your target voice'}`}
              onDownload={() => downloadRemote(result.url, `voice-studio-revoiced-${activeVoice?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'take'}.mp3`)}
              meta={result.durationMs ? <span>{(result.durationMs / 1000).toFixed(1)}s of input billed</span> : null}
            />
          ) : null}

          {!busy && !result ? (
            <EmptyState
              icon={Waves}
              title="Record it once, play it in any voice"
              body="Drop a take in and pick a target voice. The delivery you performed is preserved — pacing, emphasis and emotion all carry over, only the timbre changes. Useful for turning one Hinglish read into several different presenters."
            />
          ) : null}

          <Notice tone="info" title="How the voice changer runs">
            The conversion uploads real audio bytes, so it runs on the Audos-managed ElevenLabs account and is billed to your
            workspace wallet ($0.30 per minute of input, measured by decoding the upload, refunded if the conversion fails).
          </Notice>
        </div>

        <div className="space-y-4">
          <GlassCard>
            <VoicePicker
              voices={catalog.voices}
              loading={catalog.loading}
              error={catalog.error}
              value={activeVoiceId}
              onChange={setVoiceId}
              onReload={catalog.reload}
              onVoicesChange={catalog.replace}
            />
          </GlassCard>

          <GlassCard>
            <div className="space-y-4">
              <Field label="Model" hint={S2S_MODELS.find((model) => model.id === modelId)?.hint}>
                <Select value={modelId} onChange={setModelId} options={S2S_MODELS.map((m) => ({ id: m.id, label: m.label }))} disabled={busy} />
              </Field>
              <Toggle
                label="Remove background noise"
                checked={denoise}
                onChange={setDenoise}
                disabled={busy}
                hint="Strips room noise from the input before the voice is replaced."
              />
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
              Delivery
            </h3>
            <VoiceSettingsPanel value={settings} onChange={setSettings} disabled={busy} />
          </GlassCard>

          <PrimaryButton full icon={Repeat} busy={busy} disabled={!file || !activeVoiceId} onClick={convert}>
            {busy ? 'Converting…' : 'Convert voice'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
