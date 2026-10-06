import { useState } from 'react';
import { Mic, Sparkles, Wand2 } from 'lucide-react';
import {
  DEFAULT_VOICE_SETTINGS,
  OUTPUT_FORMATS,
  TTS_MODELS,
  textToSpeech,
  type GeneratedAudio,
  type VoiceSettings,
} from '../lib/elevenlabs';
import { download, revokeBlobUrl } from '../lib/runtime';
import { VoicePicker } from '../components/VoicePicker';
import { VoiceSettingsPanel } from '../components/VoiceSettingsPanel';
import {
  AudioPlayer,
  Badge,
  EmptyState,
  Field,
  GeneratingSkeleton,
  GlassCard,
  Notice,
  PrimaryButton,
  Select,
  T,
  TabHeader,
  TextArea,
  useToast,
} from '../components/Ui';
import { useVoiceCatalog } from '../hooks/useVoiceCatalog';

const EXAMPLES = [
  'Namaste, welcome to Vidverge — India ka sabse tezz AI video studio.',
  'Aaj hum baat karenge ek aisi trick ki, jo aapka pehla reel viral kar degi.',
  'Our festive sale starts today — flat 40% off across every plan, only till Diwali.',
  'Mumbai se Bengaluru tak, 2,000 creators har hafte Vidverge pe videos bana rahe hain.',
];

const MAX_CHARS = 5000;

export default function TextToSpeechTab() {
  const toast = useToast();
  const catalog = useVoiceCatalog();
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState(TTS_MODELS[0].id);
  const [format, setFormat] = useState(OUTPUT_FORMATS[0].id);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeneratedAudio | null>(null);

  // The first voice in the sorted catalog is an Indian one whenever the account
  // has any, so defaulting to it matches what this workspace actually makes.
  const activeVoiceId = voiceId || catalog.voices[0]?.id || '';
  const activeVoice = catalog.voices.find((voice) => voice.id === activeVoiceId);
  const formatMeta = OUTPUT_FORMATS.find((entry) => entry.id === format) || OUTPUT_FORMATS[0];

  const generate = async () => {
    if (!text.trim()) {
      toast('info', 'Write a script first.');
      return;
    }
    if (!activeVoiceId) {
      toast('info', 'Pick a voice first.');
      return;
    }
    setBusy(true);
    revokeBlobUrl(result?.url);
    setResult(null);
    try {
      const audio = await textToSpeech({ text: text.trim(), voiceId: activeVoiceId, modelId, outputFormat: format, settings });
      setResult(audio);
      toast('success', 'Voiceover ready.');
    } catch (e: any) {
      toast('error', String(e?.message || 'The voiceover could not be generated.'));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!result) return;
    const name = `voice-studio-${activeVoice?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'voiceover'}.${result.extension}`;
    download(result.url, name);
  };

  return (
    <div>
      <TabHeader
        icon={Mic}
        title="Text to Speech"
        description="Turn a script into studio speech — English, Hindi or Hinglish — in any voice on your account."
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <Field label="Script" hint={`${text.length} / ${MAX_CHARS}`}>
              <TextArea
                value={text}
                onChange={(next) => setText(next.slice(0, MAX_CHARS))}
                rows={10}
                disabled={busy}
                placeholder="Paste your script here. Hindi, Hinglish and English all work — the multilingual model reads Devanagari and romanised Hindi."
              />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px]" style={{ color: T.textMuted }}>
                Try:
              </span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setText(example)}
                  className="max-w-full truncate rounded-full px-2.5 py-1 text-[11px]"
                  style={{ background: T.accentSofter, border: `1px solid ${T.border}`, color: T.textSecondary }}
                >
                  {example.length > 46 ? `${example.slice(0, 46)}…` : example}
                </button>
              ))}
            </div>
          </GlassCard>

          {busy ? <GeneratingSkeleton label="Generating speech…" /> : null}

          {result ? (
            <>
              <AudioPlayer
                src={result.url}
                title={`${activeVoice?.name || 'Voiceover'} · ${formatMeta.label}`}
                onDownload={save}
                meta={
                  <>
                    <Badge tone={result.engine === 'byok' ? 'accent' : 'muted'}>
                      {result.engine === 'byok' ? 'Your ElevenLabs key' : 'Audos-managed'}
                    </Badge>
                    <span>{TTS_MODELS.find((model) => model.id === modelId)?.label}</span>
                  </>
                }
              />
              {result.note ? <Notice tone="info">{result.note}</Notice> : null}
            </>
          ) : null}

          {!busy && !result ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing generated yet"
              body="Pick a voice, paste a script and press Generate. Indian voices are badged 🇮🇳 and sorted to the top of the list."
              suggestions={['Hinglish ad read', 'Festive sale announcement', 'App onboarding walkthrough']}
              onPick={(suggestion) => {
                const seed: Record<string, string> = {
                  'Hinglish ad read': EXAMPLES[1],
                  'Festive sale announcement': EXAMPLES[2],
                  'App onboarding walkthrough': EXAMPLES[0],
                };
                setText(seed[suggestion] || EXAMPLES[0]);
              }}
            />
          ) : null}
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
              <Field label="Model" hint={TTS_MODELS.find((model) => model.id === modelId)?.hint}>
                <Select value={modelId} onChange={setModelId} options={TTS_MODELS.map((m) => ({ id: m.id, label: m.label }))} disabled={busy} />
              </Field>
              <Field label="Output format" hint={formatMeta.hint}>
                <Select value={format} onChange={setFormat} options={OUTPUT_FORMATS.map((f) => ({ id: f.id, label: f.label }))} disabled={busy} />
              </Field>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
              Delivery
            </h3>
            <VoiceSettingsPanel value={settings} onChange={setSettings} disabled={busy} />
          </GlassCard>

          <PrimaryButton full icon={Wand2} busy={busy} disabled={!text.trim() || !activeVoiceId} onClick={generate}>
            {busy ? 'Generating…' : 'Generate voiceover'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
