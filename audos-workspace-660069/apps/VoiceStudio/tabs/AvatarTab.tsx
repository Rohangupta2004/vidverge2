// Two explicit avatar pipelines: exact ElevenLabs audio through legacy HeyGen
// v2, or a HeyGen catalog voice through the supported v3 renderer.
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Flag, Monitor, RefreshCw, Search, Smartphone, UserCircle } from 'lucide-react';
import { DEFAULT_VOICE_SETTINGS, TTS_MODELS, textToSpeech, type VoiceSettings } from '../lib/elevenlabs';
import {
  DIMENSIONS,
  HeyGenError,
  createAvatarVideo,
  heygenNotConfiguredMessage,
  listAvatars,
  listHeyGenVoices,
  videoStatus,
  type AvatarCard,
  type AvatarOverrides,
  type AvatarVoiceMode,
  type HeyGenVoiceCard,
  type Orientation,
} from '../lib/heygen';
import { downloadRemote, readLocal, sleep, uploadToWorkspace, writeLocal } from '../lib/runtime';
import { VoicePicker } from '../components/VoicePicker';
import { VoiceSettingsPanel } from '../components/VoiceSettingsPanel';
import {
  EmptyState,
  Field,
  GlassCard,
  Notice,
  PrimaryButton,
  ProgressRail,
  Segmented,
  Select,
  Skeleton,
  T,
  TabHeader,
  TextArea,
  VideoPlayer,
  useToast,
  type RailStep,
} from '../components/Ui';
import { useVoiceCatalog } from '../hooks/useVoiceCatalog';

const AVATAR_OVERRIDE_KEY = 'voicestudio_indian_avatar_overrides_v1';
const POLL_MS = 4000;
/** A render that never settles must stop polling rather than spin until the tab closes. */
const POLL_CEILING_MS = 20 * 60 * 1000;
const MAX_SCRIPT = 2500;

const SCRIPTS = [
  'Namaste! Main Vidverge se bol raha hoon — aur aaj main aapko dikhaunga ki ek idea se publish-ready video kaise banti hai.',
  'Hi, I am your product guide. In the next thirty seconds I will show you exactly how this works.',
  'Agar aap har hafte reels banate hain, to ye wala tool aapke liye hi hai. Chaliye shuru karein.',
];

export default function AvatarTab() {
  const toast = useToast();
  const catalog = useVoiceCatalog();

  const [script, setScript] = useState('');
  const [voiceMode, setVoiceMode] = useState<AvatarVoiceMode>('elevenlabs');
  const [voiceId, setVoiceId] = useState('');
  const [heygenVoiceId, setHeygenVoiceId] = useState('');
  const [heygenVoices, setHeygenVoices] = useState<HeyGenVoiceCard[]>([]);
  const [heygenVoicesLoading, setHeygenVoicesLoading] = useState(false);
  const [heygenVoiceError, setHeygenVoiceError] = useState<string | null>(null);
  const [heygenSpeed, setHeygenSpeed] = useState(1);
  const [modelId, setModelId] = useState(TTS_MODELS[0].id);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [background, setBackground] = useState('#0F1222');

  const [avatars, setAvatars] = useState<AvatarCard[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(true);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState('');
  const [query, setQuery] = useState('');
  const [indianOnly, setIndianOnly] = useState(false);

  const [steps, setSteps] = useState<RailStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [video, setVideo] = useState<{ url: string; poster?: string } | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const loadAvatarGrid = async () => {
    setAvatarsLoading(true);
    setAvatarError(null);
    try {
      const apiVersion = voiceMode === 'heygen' ? 'v3' : 'v2';
      const list = await listAvatars(readLocal<AvatarOverrides>(AVATAR_OVERRIDE_KEY, {}), apiVersion);
      setAvatars(list);
      if (!list.length) setAvatarError(`Your HeyGen account returned no ${apiVersion} avatars.`);
    } catch (e: any) {
      setAvatarError(e instanceof HeyGenError && e.missingCredential ? heygenNotConfiguredMessage() : String(e?.message || 'The avatar list could not be loaded.'));
    } finally {
      setAvatarsLoading(false);
    }
  };

  const loadHeyGenVoiceCatalog = async () => {
    setHeygenVoicesLoading(true);
    setHeygenVoiceError(null);
    try {
      const list = await listHeyGenVoices();
      setHeygenVoices(list);
      if (!list.length) setHeygenVoiceError('Your HeyGen account returned no v3 voices.');
    } catch (e: any) {
      setHeygenVoiceError(e instanceof HeyGenError && e.missingCredential ? heygenNotConfiguredMessage() : String(e?.message || 'The HeyGen voice list could not be loaded.'));
    } finally {
      setHeygenVoicesLoading(false);
    }
  };

  useEffect(() => {
    setAvatarId('');
    void loadAvatarGrid();
    if (voiceMode === 'heygen' && !heygenVoices.length) void loadHeyGenVoiceCatalog();
  }, [voiceMode]);

  const activeVoiceId = voiceMode === 'heygen' ? heygenVoiceId || heygenVoices[0]?.id || '' : voiceId || catalog.voices[0]?.id || '';
  const activeHeyGenVoice = heygenVoices.find((voice) => voice.id === activeVoiceId) || null;
  const activeAvatar = avatars.find((avatar) => avatar.id === avatarId) || null;
  const indianAvatarCount = avatars.filter((avatar) => avatar.indian).length;

  const visibleAvatars = avatars.filter((avatar) => {
    if (indianOnly && !avatar.indian) return false;
    const needle = query.trim().toLowerCase();
    return !needle || avatar.name.toLowerCase().includes(needle);
  });

  const flagAvatar = (avatar: AvatarCard) => {
    const next = !avatar.indian;
    const overrides = readLocal<AvatarOverrides>(AVATAR_OVERRIDE_KEY, {});
    overrides[avatar.id] = next;
    writeLocal(AVATAR_OVERRIDE_KEY, overrides);
    setAvatars((prev) =>
      [...prev.map((entry) => (entry.id === avatar.id ? { ...entry, indian: next } : entry))].sort(
        (a, b) => Number(b.indian) - Number(a.indian) || a.name.localeCompare(b.name),
      ),
    );
  };

  const setStep = (index: number, patch: Partial<RailStep>) =>
    setSteps((prev) => (prev ? prev.map((step, i) => (i === index ? { ...step, ...patch } : step)) : prev));

  const run = async () => {
    if (!script.trim() || !activeVoiceId || !activeAvatar) {
      toast('info', 'Write a script, pick a voice and pick an avatar first.');
      return;
    }

    cancelled.current = false;
    setRunning(true);
    setVideo(null);
    setSteps(
      voiceMode === 'heygen'
        ? [
            { label: 'Using the selected HeyGen voice', state: 'active' },
            { label: 'Resolving the avatar v3 engine', state: 'pending' },
            { label: `Rendering ${activeAvatar.name}`, state: 'pending' },
            { label: 'Done', state: 'pending' },
          ]
        : [
            { label: 'Generating the ElevenLabs voice', state: 'active' },
            { label: 'Handing the audio to HeyGen v2', state: 'pending' },
            { label: `Rendering ${activeAvatar.name}`, state: 'pending' },
            { label: 'Done', state: 'pending' },
          ],
    );

    try {
      let created;
      if (voiceMode === 'heygen') {
        setStep(0, { state: 'done', detail: activeHeyGenVoice?.name || 'HeyGen v3 voice' });
        setStep(1, { state: 'active' });
        created = await createAvatarVideo({
          avatar: activeAvatar,
          mode: 'heygen',
          script: script.trim(),
          voiceId: activeVoiceId,
          speed: heygenSpeed,
          orientation,
          backgroundColor: background,
        });
        setStep(1, { state: 'done', detail: 'Compatible engine selected' });
      } else {
        const audio = await textToSpeech({
          text: script.trim(),
          voiceId: activeVoiceId,
          modelId,
          outputFormat: 'mp3_44100_128',
          settings,
        });
        setStep(0, { state: 'done', detail: audio.engine === 'byok' ? 'Your ElevenLabs key' : 'Audos-managed ElevenLabs' });
        setStep(1, { state: 'active' });

        // HeyGen fetches the track itself, so it needs a public address. The
        // managed endpoint already returns one; BYOK hands back raw bytes,
        // which go to workspace storage first.
        let audioUrl = audio.url;
        if (audio.blob) {
          const uploaded = await uploadToWorkspace(audio.blob, `voice-studio-vo-${Date.now()}.mp3`, 'voice-studio-avatar');
          audioUrl = uploaded.url;
        }
        created = await createAvatarVideo({ avatar: activeAvatar, mode: 'elevenlabs', audioUrl, orientation, backgroundColor: background });
        setStep(1, { state: 'done' });
      }
      setStep(2, { state: 'active', detail: `${DIMENSIONS[orientation].label} · ${created.apiVersion}` });
      const { videoId, apiVersion } = created;

      let attempts = 0;
      const startedAt = Date.now();
      while (!cancelled.current) {
        if (Date.now() - startedAt > POLL_CEILING_MS) {
          setStep(2, { state: 'failed', detail: 'Still rendering after 20 minutes.' });
          throw new Error(
            `HeyGen is still rendering video ${videoId} after 20 minutes, so this tab stopped waiting. The render may still finish in your HeyGen account.`,
          );
        }
        await sleep(POLL_MS);
        if (cancelled.current) return;
        attempts += 1;
        const status = await videoStatus(videoId, apiVersion);
        setStep(2, { state: 'active', detail: `${DIMENSIONS[orientation].label} · ${apiVersion} ${status.status} (${attempts * (POLL_MS / 1000)}s)` });
        if (status.status === 'failed') {
          setStep(2, { state: 'failed', detail: status.error || 'HeyGen reported the render failed.' });
          throw new Error(status.error || 'HeyGen could not render that avatar.');
        }
        if (status.status === 'completed' && status.videoUrl) {
          setStep(2, { state: 'done' });
          setStep(3, { state: 'done', detail: status.durationSec ? `${status.durationSec.toFixed(1)}s` : undefined });
          setVideo({ url: status.videoUrl, poster: status.thumbnailUrl });
          toast('success', 'Avatar video rendered.');
          return;
        }
      }
    } catch (e: any) {
      setSteps((prev) => (prev ? prev.map((step) => (step.state === 'active' ? { ...step, state: 'failed' } : step)) : prev));
      const message = e instanceof HeyGenError && e.missingCredential ? heygenNotConfiguredMessage() : String(e?.message || 'The avatar video could not be made.');
      toast('error', message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <TabHeader
        icon={Clapperboard}
        title="Avatar Lip-Sync"
        description="Choose exact ElevenLabs audio on legacy v2, or a HeyGen voice on the supported v3 renderer."
      />

      <div className="mb-4">
        <Notice tone="warning" title="HeyGen v1/v2 retirement: after October 31, 2026">
          ElevenLabs audio remains the default because it preserves the exact voice you auditioned, but HeyGen has not documented caller-supplied audio in v3. Use HeyGen voice (v3) for the supported long-term path.
        </Notice>
      </div>

      {avatarError ? (
        <div className="mb-4">
          <Notice tone="warning" title="HeyGen avatars unavailable">
            {avatarError}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <Field label="Voice source" hint={voiceMode === 'elevenlabs' ? 'Default · HeyGen v2' : 'Supported · HeyGen v3'}>
              <Segmented
                value={voiceMode}
                onChange={setVoiceMode}
                disabled={running}
                options={[
                  { id: 'elevenlabs', label: 'ElevenLabs audio · v2' },
                  { id: 'heygen', label: 'HeyGen voice · v3' },
                ]}
              />
            </Field>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
              {voiceMode === 'elevenlabs'
                ? 'Uses the exact ElevenLabs performance you auditioned, then sends its public audio URL to HeyGen v2.'
                : 'Uses HeyGen’s own v3 voice catalog with script + voice_id. No ElevenLabs audio is generated in this mode.'}
            </p>
          </GlassCard>

          <GlassCard>
            <Field label="Script" hint={`${script.length} / ${MAX_SCRIPT}`}>
              <TextArea
                value={script}
                onChange={(next) => setScript(next.slice(0, MAX_SCRIPT))}
                rows={6}
                disabled={running}
                placeholder="What should the presenter say? Hindi, Hinglish and English all work."
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCRIPTS.map((example, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setScript(example)}
                  className="rounded-full px-2.5 py-1 text-[11px]"
                  style={{ background: T.accentSofter, border: `1px solid ${T.border}`, color: T.textSecondary }}
                >
                  {example.slice(0, 38)}…
                </button>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
                Presenter
                {activeAvatar ? <span style={{ color: T.accentBright }}> · {activeAvatar.name}</span> : null}
              </h3>
              <div className="flex items-center gap-2">
                {indianAvatarCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIndianOnly((prev) => !prev)}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      background: indianOnly ? T.accent : T.accentSoft,
                      color: indianOnly ? '#FFFFFF' : T.accentBright,
                      border: `1px solid ${T.accentLine}`,
                    }}
                  >
                    🇮🇳 Indian only ({indianAvatarCount})
                  </button>
                ) : null}
                <button type="button" onClick={() => void loadAvatarGrid()} aria-label="Reload avatars">
                  <RefreshCw className="h-3.5 w-3.5" style={{ color: T.textMuted }} />
                </button>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: T.inset, border: `1px solid ${T.border}` }}>
              <Search className="h-3.5 w-3.5 shrink-0" style={{ color: T.textMuted }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search avatars…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ color: T.text }}
              />
            </div>

            {avatarsLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                  <Skeleton key={index} className="aspect-[3/4] w-full" />
                ))}
              </div>
            ) : !visibleAvatars.length ? (
              <EmptyState
                icon={UserCircle}
                title="No avatar matches"
                body={avatarError ? 'Connect a HeyGen key to load your presenter library.' : 'Clear the search or turn the Indian-only filter off.'}
              />
            ) : (
              <div className="vs-scroll grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {visibleAvatars.map((avatar) => {
                  const selected = avatar.id === avatarId;
                  return (
                    <div key={avatar.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setAvatarId(avatar.id)}
                        className="block w-full overflow-hidden rounded-xl text-left"
                        style={{
                          border: `2px solid ${selected ? T.accent : 'transparent'}`,
                          background: T.inset,
                          boxShadow: selected ? '0 6px 18px rgba(124,58,237,0.35)' : 'none',
                        }}
                      >
                        <span className="block aspect-[3/4] w-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.1)' }}>
                          {avatar.previewImage ? (
                            <img src={avatar.previewImage} alt={avatar.name} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="grid h-full w-full place-items-center">
                              <UserCircle className="h-6 w-6" style={{ color: T.textMuted }} />
                            </span>
                          )}
                        </span>
                        <span className="block px-2 py-1.5">
                          <span className="flex items-center gap-1">
                            {avatar.indian ? <span className="text-[10px]">🇮🇳</span> : null}
                            <span className="truncate text-[11px]" style={{ color: selected ? T.accentBright : T.textSecondary }}>
                              {avatar.name}
                            </span>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => flagAvatar(avatar)}
                        aria-label={avatar.indian ? 'Remove from Indian avatars' : 'Add to Indian avatars'}
                        title={avatar.indian ? 'Remove the Indian badge' : 'Flag this as an Indian avatar'}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full"
                        style={{ background: 'rgba(8,10,18,0.72)' }}
                      >
                        <Flag className="h-3 w-3" style={{ color: avatar.indian ? T.accentBright : T.textMuted }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {steps ? (
            <GlassCard>
              <ProgressRail steps={steps} />
            </GlassCard>
          ) : null}

          {video ? (
            <VideoPlayer
              src={video.url}
              poster={video.poster}
              portrait={orientation === 'portrait'}
              onDownload={() => downloadRemote(video.url, `voice-studio-avatar-${orientation}.mp4`)}
            />
          ) : null}

          {!steps && !video ? (
            <EmptyState
              icon={Clapperboard}
              title="One script, one presenter, one MP4"
              body={
                voiceMode === 'elevenlabs'
                  ? 'The voice is generated on ElevenLabs first, then HeyGen v2 lip-syncs your chosen presenter to that exact audio.'
                  : 'HeyGen v3 reads your script with the selected HeyGen voice and renders the presenter through a compatible avatar engine.'
              }
              suggestions={['Hinglish product intro', 'English 30-second demo', 'Reel hook']}
              onPick={(suggestion) => {
                const map: Record<string, string> = {
                  'Hinglish product intro': SCRIPTS[0],
                  'English 30-second demo': SCRIPTS[1],
                  'Reel hook': SCRIPTS[2],
                };
                setScript(map[suggestion] || SCRIPTS[0]);
              }}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <GlassCard>
            {voiceMode === 'elevenlabs' ? (
              <VoicePicker
                voices={catalog.voices}
                loading={catalog.loading}
                error={catalog.error}
                value={activeVoiceId}
                onChange={setVoiceId}
                onReload={catalog.reload}
                onVoicesChange={catalog.replace}
              />
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
                    HeyGen v3 voice
                  </h3>
                  <button type="button" onClick={() => void loadHeyGenVoiceCatalog()} aria-label="Reload HeyGen voices" disabled={heygenVoicesLoading || running}>
                    <RefreshCw className={`h-3.5 w-3.5 ${heygenVoicesLoading ? 'animate-spin' : ''}`} style={{ color: T.textMuted }} />
                  </button>
                </div>
                {heygenVoiceError ? (
                  <Notice tone="warning" title="HeyGen voices unavailable">
                    {heygenVoiceError}
                  </Notice>
                ) : (
                  <Field label="Voice" hint={activeHeyGenVoice?.language || activeHeyGenVoice?.gender || 'HeyGen catalog'}>
                    <Select
                      value={activeVoiceId}
                      onChange={setHeygenVoiceId}
                      disabled={heygenVoicesLoading || running || !heygenVoices.length}
                      options={heygenVoices.map((voice) => ({
                        id: voice.id,
                        label: `${voice.name}${voice.language ? ` · ${voice.language}` : ''}`,
                      }))}
                    />
                  </Field>
                )}
              </div>
            )}
          </GlassCard>

          <GlassCard>
            <div className="space-y-4">
              <Field label="Aspect ratio" hint={`${DIMENSIONS[orientation].label}${voiceMode === 'heygen' ? ' · 1080p' : ''}`}>
                <Segmented
                  value={orientation}
                  onChange={setOrientation}
                  disabled={running}
                  options={[
                    { id: 'landscape', label: voiceMode === 'heygen' ? '16:9 · 1080p' : '16:9 · 1280×720' },
                    { id: 'portrait', label: '9:16 · 1080×1920' },
                  ]}
                />
              </Field>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: T.textMuted }}>
                {orientation === 'portrait' ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                {orientation === 'portrait' ? 'Reels, Shorts and TikTok' : 'YouTube, websites and decks'}
              </div>
              <Field label="Background" hint="Behind the presenter">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={background}
                    disabled={running}
                    onChange={(event) => setBackground(event.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-lg"
                    style={{ background: T.inset, border: `1px solid ${T.border}` }}
                  />
                  <code className="text-xs" style={{ color: T.textSecondary }}>
                    {background}
                  </code>
                </div>
              </Field>
              {voiceMode === 'elevenlabs' ? (
                <Field label="Voice model" hint={TTS_MODELS.find((model) => model.id === modelId)?.hint}>
                  <Select value={modelId} onChange={setModelId} options={TTS_MODELS.map((m) => ({ id: m.id, label: m.label }))} disabled={running} />
                </Field>
              ) : (
                <Field label="HeyGen voice speed" hint={`${heygenSpeed.toFixed(1)}×`}>
                  <input
                    type="range"
                    min={0.5}
                    max={1.5}
                    step={0.1}
                    value={heygenSpeed}
                    disabled={running}
                    onChange={(event) => setHeygenSpeed(Number(event.target.value))}
                    className="vs-range"
                  />
                </Field>
              )}
            </div>
          </GlassCard>

          {voiceMode === 'elevenlabs' ? (
            <GlassCard>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
                Delivery
              </h3>
              <VoiceSettingsPanel value={settings} onChange={setSettings} disabled={running} />
            </GlassCard>
          ) : null}

          <PrimaryButton
            full
            icon={Clapperboard}
            busy={running}
            disabled={!script.trim() || !activeVoiceId || !activeAvatar}
            onClick={run}
          >
            {running ? 'Rendering…' : voiceMode === 'heygen' ? 'Generate with HeyGen v3' : 'Generate with ElevenLabs audio'}
          </PrimaryButton>
          {running ? (
            <p className="text-center text-[11px]" style={{ color: T.textMuted }}>
              HeyGen is polled every 4 seconds. Leave this tab open until the render finishes.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
