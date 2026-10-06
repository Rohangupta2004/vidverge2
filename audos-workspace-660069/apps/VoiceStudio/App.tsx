// Voice Studio — full-stack AI voice and avatar creation.
//
// Seven standalone feature modules behind one tab strip. Each tab owns its own
// state; the only things shared are the voice catalog (hooks/useVoiceCatalog)
// and the verdict on the founder's ElevenLabs key (hooks/useKeyVerdict), so a
// voice cloned in tab 2 is selectable in tabs 1, 3 and 7 immediately.
//
// WHERE EACH FEATURE RUNS is explained in lib/elevenlabs.ts. The short version:
// anything that needs to upload real file BYTES in a multipart body runs on the
// Audos-managed ElevenLabs endpoints, because the workspace secrets proxy's
// multipart mode carries text fields only. Everything else runs on the
// founder's own key through that proxy.
import { useState, type ComponentType } from 'react';
import { Clapperboard, Globe, KeyRound, Mic, Music, Repeat, UserPlus, Volume2 } from 'lucide-react';
import { StudioStyles, T, ToastProvider } from './components/Ui';
import { useKeyVerdict } from './hooks/useKeyVerdict';
import TextToSpeechTab from './tabs/TextToSpeechTab';
import VoiceCloneTab from './tabs/VoiceCloneTab';
import SpeechToSpeechTab from './tabs/SpeechToSpeechTab';
import DubbingTab from './tabs/DubbingTab';
import SoundEffectsTab from './tabs/SoundEffectsTab';
import MusicTab from './tabs/MusicTab';
import AvatarTab from './tabs/AvatarTab';

interface TabDefinition {
  id: string;
  label: string;
  short: string;
  icon: ComponentType<any>;
  Component: ComponentType;
}

const TABS: TabDefinition[] = [
  { id: 'tts', label: 'Text to Speech', short: 'Speech', icon: Mic, Component: TextToSpeechTab },
  { id: 'clone', label: 'Voice Clone', short: 'Clone', icon: UserPlus, Component: VoiceCloneTab },
  { id: 's2s', label: 'Speech to Speech', short: 'Re-voice', icon: Repeat, Component: SpeechToSpeechTab },
  { id: 'dub', label: 'Dubbing', short: 'Dub', icon: Globe, Component: DubbingTab },
  { id: 'sfx', label: 'Sound Effects', short: 'SFX', icon: Volume2, Component: SoundEffectsTab },
  { id: 'music', label: 'AI Music', short: 'Music', icon: Music, Component: MusicTab },
  { id: 'avatar', label: 'Avatar Lip-Sync', short: 'Avatar', icon: Clapperboard, Component: AvatarTab },
];

function KeyStatus() {
  const { verdict, unusable, message } = useKeyVerdict();
  const tone = unusable ? T.warning : verdict === 'usable' ? T.success : T.textMuted;
  const label =
    verdict === 'usable'
      ? 'Your ElevenLabs key is live'
      : verdict === 'missing'
        ? 'No ElevenLabs key stored'
        : verdict === 'host-not-allowed'
          ? 'ElevenLabs key not allow-listed'
          : verdict === 'rejected'
            ? 'ElevenLabs rejected your key'
            : 'Checking your ElevenLabs key…';

  return (
    <div
      className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] leading-snug"
      style={{ background: 'rgba(8,10,18,0.5)', border: `1px solid ${T.border}`, color: T.textMuted }}
    >
      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: tone }} />
      <span className="min-w-0">
        <span className="block font-semibold" style={{ color: tone }}>
          {label}
        </span>
        <span className="mt-0.5 block">
          {unusable && message
            ? message
            : 'Speech, sound effects and dubbing use your own key. Cloning, the voice changer and music run on the Audos-managed ElevenLabs account.'}
        </span>
      </span>
    </div>
  );
}

export default function VoiceStudio() {
  const [active, setActive] = useState(TABS[0].id);
  const current = TABS.find((tab) => tab.id === active) || TABS[0];
  const ActiveTab = current.Component;

  return (
    <ToastProvider>
      <StudioStyles />
      <div className="min-h-full" style={{ background: T.page, color: T.text }}>
        <div className="mx-auto flex max-w-[94rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:gap-6 lg:py-7">
          {/* Rail: a left sidebar on desktop, a horizontally scrolling strip on mobile. */}
          <aside className="shrink-0 lg:w-60">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                style={{ background: `linear-gradient(135deg, ${T.accent}, ${T.accentDeep})`, boxShadow: '0 8px 22px rgba(124,58,237,0.38)' }}
              >
                <Mic className="h-5 w-5" style={{ color: '#FFFFFF' }} />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-semibold leading-tight" style={{ color: T.text }}>
                  Voice Studio
                </h1>
                <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
                  Full-stack AI voice &amp; avatar creation
                </p>
              </div>
            </div>

            <nav
              className="vs-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
              aria-label="Voice Studio features"
            >
              {TABS.map((tab) => {
                const selected = tab.id === active;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActive(tab.id)}
                    aria-current={selected ? 'page' : undefined}
                    className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors lg:w-full"
                    style={{
                      background: selected ? T.accentSoft : 'transparent',
                      border: `1px solid ${selected ? T.accentLine : 'transparent'}`,
                      color: selected ? T.text : T.textMuted,
                    }}
                  >
                    <tab.icon className="h-4 w-4 shrink-0" style={{ color: selected ? T.accentBright : T.textMuted }} />
                    <span className="hidden lg:inline">{tab.label}</span>
                    <span className="lg:hidden">{tab.short}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4 hidden lg:block">
              <KeyStatus />
            </div>
          </aside>

          {/* The tab is keyed so switching away really unmounts it — a half-filled
              form or a stale blob URL never bleeds into the next feature. */}
          <main className="min-w-0 flex-1">
            <div key={current.id} className="vs-rise">
              <ActiveTab />
            </div>
            <div className="mt-6 lg:hidden">
              <KeyStatus />
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
