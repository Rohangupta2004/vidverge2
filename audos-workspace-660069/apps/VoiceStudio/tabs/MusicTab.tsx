import { useState } from 'react';
import { Music, Radio } from 'lucide-react';
import { MUSIC_PROVIDERS, generateMusic } from '../lib/elevenlabs';
import { downloadRemote } from '../lib/runtime';
import {
  AudioPlayer,
  EmptyState,
  Field,
  GeneratingSkeleton,
  GlassCard,
  Notice,
  PrimaryButton,
  Segmented,
  Slider,
  T,
  TabHeader,
  TextArea,
  Toggle,
  useToast,
} from '../components/Ui';

const PROMPTS = [
  'Upbeat Bollywood fusion — dholak and tabla under a bright string hook, 118 BPM, festive and confident',
  'Cinematic suspense — low sustained strings, a slow ticking pulse, one swelling brass hit near the end',
  'Lo-fi hip-hop — dusty piano loop, soft vinyl crackle, laid-back drums, 82 BPM',
  'Modern Indian startup promo — clean synth arpeggio over a sitar motif, driving claps, optimistic',
  'Devotional ambient — harmonium drone, distant temple bells, no percussion, very slow',
  'High-energy reel bed — punchy electronic drums, rising riser into a drop at 8 seconds',
];

const MIN_PROMPT = 10;
const MAX_PROMPT = 4100;

export default function MusicTab() {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [provider, setProvider] = useState(MUSIC_PROVIDERS[0].id);
  const [instrumental, setInstrumental] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; durationMs: number; provider: string; lengthClamped: boolean } | null>(null);

  const providerMeta = MUSIC_PROVIDERS.find((entry) => entry.id === provider) || MUSIC_PROVIDERS[0];

  const generate = async () => {
    if (prompt.trim().length < MIN_PROMPT) {
      toast('info', `Describe the track in at least ${MIN_PROMPT} characters.`);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const track = await generateMusic({
        prompt: prompt.trim(),
        lengthMs: Math.round(seconds * 1000),
        provider,
        instrumental,
      });
      setResult(track);
      toast('success', 'Track ready.');
    } catch (e: any) {
      toast('error', String(e?.message || 'The track could not be generated.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TabHeader
        icon={Music}
        title="AI Music"
        description="Write a brief and get an original instrumental bed — no library, no licensing, no repeats."
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <Field label="Describe the track" hint={`${prompt.length} / ${MAX_PROMPT}`}>
              <TextArea
                value={prompt}
                onChange={(next) => setPrompt(next.slice(0, MAX_PROMPT))}
                rows={5}
                disabled={busy}
                placeholder="Name the instruments, the mood and roughly the tempo. “Upbeat Bollywood fusion — dholak and tabla under a bright string hook, 118 BPM” gets you much further than “happy music”."
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

          {busy ? <GeneratingSkeleton label="Composing your track — this takes 10–30 seconds…" /> : null}

          {result ? (
            <>
              <AudioPlayer
                src={result.url}
                title={prompt.length > 54 ? `${prompt.slice(0, 54)}…` : prompt}
                onDownload={() => downloadRemote(result.url, `voice-studio-music-${Date.now()}.mp3`)}
                meta={
                  <>
                    <span>{(result.durationMs / 1000).toFixed(1)}s</span>
                    <span>{MUSIC_PROVIDERS.find((entry) => entry.id === result.provider)?.label || result.provider}</span>
                  </>
                }
              />
              {result.lengthClamped ? (
                <Notice tone="info">
                  Gemini renders fixed clip lengths, so this track came back at {(result.durationMs / 1000).toFixed(1)}s rather than
                  the {seconds}s requested. Switch the provider to ElevenLabs if you need an exact length.
                </Notice>
              ) : null}
            </>
          ) : null}

          {!busy && !result ? (
            <EmptyState
              icon={Radio}
              title="No track yet"
              body="Describe the bed you need and press Generate. Everything here is composed fresh, so two reels never share the same music."
              suggestions={['Bollywood fusion', 'Cinematic suspense', 'Lo-fi hip-hop', 'Reel drop bed']}
              onPick={(suggestion) => {
                const map: Record<string, string> = {
                  'Bollywood fusion': PROMPTS[0],
                  'Cinematic suspense': PROMPTS[1],
                  'Lo-fi hip-hop': PROMPTS[2],
                  'Reel drop bed': PROMPTS[5],
                };
                setPrompt(map[suggestion] || PROMPTS[0]);
              }}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <GlassCard>
            <div className="space-y-4">
              <Field label="Engine" hint={providerMeta.hint}>
                <Segmented
                  value={provider}
                  onChange={setProvider}
                  disabled={busy}
                  options={MUSIC_PROVIDERS.map((entry) => ({ id: entry.id, label: entry.label }))}
                />
              </Field>
              <Slider
                label="Length"
                value={seconds}
                min={3}
                max={300}
                step={1}
                format={(value) => `${Math.floor(value / 60)}:${String(Math.round(value) % 60).padStart(2, '0')}`}
                disabled={busy}
                onChange={setSeconds}
                hint={provider === 'gemini' ? 'Gemini decides the real length — a request of 30s or less renders a fixed ~30s clip.' : 'Rendered to exactly this length.'}
              />
              <Toggle
                label="Instrumental only"
                checked={instrumental}
                onChange={setInstrumental}
                disabled={busy}
                hint="Keep this on for anything that sits under narration."
              />
            </div>
          </GlassCard>

          <Notice tone="info" title="How music runs">
            Music uses the Audos-managed music endpoints, which can render on either ElevenLabs or Google's Lyria from the same
            brief, and is billed to your workspace wallet. Both return a permanent URL you can reuse in any other Vidverge studio.
          </Notice>

          <PrimaryButton full icon={Music} busy={busy} disabled={prompt.trim().length < MIN_PROMPT} onClick={generate}>
            {busy ? 'Composing…' : 'Generate track'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
