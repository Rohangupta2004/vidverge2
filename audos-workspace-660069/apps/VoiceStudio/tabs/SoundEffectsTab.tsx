import { useState } from 'react';
import { Volume2, Waves } from 'lucide-react';
import { GeneratedAudio, SFX_DURATION, soundEffect } from '../lib/elevenlabs';
import { download, revokeBlobUrl } from '../lib/runtime';
import { useKeyVerdict } from '../hooks/useKeyVerdict';
import {
  AudioPlayer,
  EmptyState,
  Field,
  GeneratingSkeleton,
  GlassCard,
  Notice,
  PrimaryButton,
  Slider,
  T,
  TabHeader,
  TextArea,
  Toggle,
  useToast,
} from '../components/Ui';

const PROMPTS = [
  'Busy Mumbai street at rush hour — autorickshaw horns, vendors shouting, distant traffic',
  'Thunder crack over a monsoon downpour on a tin roof',
  'Stadium crowd erupting after a last-ball six',
  'Temple bells and morning aarti in a quiet courtyard',
  'Dhol beat intro — four sharp hits, then silence',
  'Chai glass clinking, kettle hissing, low kitchen hum',
];

export default function SoundEffectsTab() {
  const toast = useToast();
  const { unusable, message: keyMessage } = useKeyVerdict();
  const [prompt, setPrompt] = useState('');
  const [autoDuration, setAutoDuration] = useState(true);
  const [duration, setDuration] = useState(4);
  const [influence, setInfluence] = useState(0.3);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeneratedAudio | null>(null);

  const generate = async () => {
    if (!prompt.trim()) {
      toast('info', 'Describe the sound you want.');
      return;
    }
    setBusy(true);
    revokeBlobUrl(result?.url);
    setResult(null);
    try {
      const audio = await soundEffect({
        text: prompt.trim(),
        durationSeconds: autoDuration ? null : duration,
        promptInfluence: influence,
      });
      setResult(audio);
      toast('success', 'Sound effect ready.');
    } catch (e: any) {
      toast('error', String(e?.message || 'The sound effect could not be generated.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TabHeader
        icon={Volume2}
        title="Sound Effects"
        description="Describe a sound in words and get a usable clip — ambience, impacts, stings, foley."
      />

      {unusable && keyMessage ? (
        <div className="mb-4">
          <Notice tone="warning" title="Sound effects need your own ElevenLabs key">
            {keyMessage} Text to Speech and AI Music keep working without it — only sound generation has no managed stand-in.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <Field label="Describe the sound" hint={`${prompt.length} / 450`}>
              <TextArea
                value={prompt}
                onChange={(next) => setPrompt(next.slice(0, 450))}
                rows={4}
                disabled={busy}
                placeholder="Be specific about the place, the materials and the movement — “busy Mumbai street at rush hour, autorickshaw horns, vendors shouting” beats “city noise”."
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              {PROMPTS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="rounded-full px-2.5 py-1 text-[11px]"
                  style={{ background: T.accentSofter, border: `1px solid ${T.border}`, color: T.textSecondary }}
                >
                  {example.split('—')[0].trim()}
                </button>
              ))}
            </div>
          </GlassCard>

          {busy ? <GeneratingSkeleton label="Generating the sound…" /> : null}

          {result ? (
            <AudioPlayer
              src={result.url}
              title={prompt.length > 54 ? `${prompt.slice(0, 54)}…` : prompt}
              onDownload={() => download(result.url, `voice-studio-sfx-${Date.now()}.mp3`)}
              meta={<span>{autoDuration ? 'Length chosen by the model' : `${duration.toFixed(1)}s`}</span>}
            />
          ) : null}

          {!busy && !result ? (
            <EmptyState
              icon={Waves}
              title="No sound generated yet"
              body="Describe what you want to hear and press Generate. Short, concrete prompts with named materials and actions beat adjectives — the model is listening for things that make noise."
              suggestions={['Mumbai street ambience', 'Monsoon thunder', 'Stadium roar', 'Dhol intro hit']}
              onPick={(suggestion) => {
                const map: Record<string, string> = {
                  'Mumbai street ambience': PROMPTS[0],
                  'Monsoon thunder': PROMPTS[1],
                  'Stadium roar': PROMPTS[2],
                  'Dhol intro hit': PROMPTS[4],
                };
                setPrompt(map[suggestion] || PROMPTS[0]);
              }}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <GlassCard>
            <div className="space-y-4">
              <Toggle
                label="Let the model pick the length"
                checked={autoDuration}
                onChange={setAutoDuration}
                disabled={busy}
                hint="Usually the best result — it reads the length out of your prompt."
              />
              <Slider
                label="Duration"
                value={duration}
                min={SFX_DURATION.min}
                max={SFX_DURATION.max}
                step={0.5}
                format={(value) => `${value.toFixed(1)}s`}
                disabled={busy || autoDuration}
                onChange={setDuration}
                hint={autoDuration ? 'Turn the toggle off to set an exact length.' : '0.5s to 22s.'}
              />
              <Slider
                label="Prompt influence"
                value={influence}
                min={0}
                max={1}
                step={0.05}
                format={(value) => `${Math.round(value * 100)}%`}
                disabled={busy}
                onChange={setInfluence}
                hint="Higher follows your wording closely. Lower gives the model more creative room."
              />
            </div>
          </GlassCard>

          <PrimaryButton full icon={Volume2} busy={busy} disabled={unusable || !prompt.trim()} onClick={generate}>
            {busy ? 'Generating…' : 'Generate sound'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
