/**
 * Product Studio — Track B (HyperFrames Product Video).
 *
 * App shell/router. Four surfaces:
 *   - My Videos      the project gallery; opening a project slides the
 *                    full-screen agentic editor in from the right
 *   - Saved Videos   the unified gallery of every FINISHED video from both
 *                    flows (styled wizard runs and Product Launch films),
 *                    persisted in the workspace database
 *   - Script Mode / Script to Video   the narration-first entry points
 *   - the creation wizard, the editor, the Enhance Studio and the Sound
 *     Studio, each opened full-screen over the gallery
 *
 * All project state flows through the trackb-project safe mutation API — see
 * lib/trackB/api.ts.
 */
import { useEffect, useState } from 'react';
import { AudioLines, Bot, Film, Mic, Sparkles } from 'lucide-react';
import MyVideos from './MyVideos';
import SavedVideos from './SavedVideos';
import Editor from './Editor';
import EnhanceStudio from './EnhanceStudio';
import StyledWizard from './StyledWizard';
import SoundStudio, { type SoundTarget } from './SoundStudio';
import ScriptMode from './ScriptMode';
import ScriptToVideo from './ScriptToVideo';
import { FxStyles } from './fx';
import type { VideoStyleId } from './videoStyles';

/** A ready (rendered) video handed to the Enhance Studio as its editable source. */
export interface EnhanceTarget {
  projectId: number;
  title: string;
  videoUrl: string;
  accent?: string | null;
}

type View = 'videos' | 'saved' | 'script' | 'scriptToVideo';

const TABS: { id: View; label: string; icon: typeof Film; testId: string }[] = [
  { id: 'videos', label: 'My Videos', icon: Film, testId: 'tab-my-videos' },
  { id: 'saved', label: 'Saved Videos', icon: Sparkles, testId: 'tab-saved-videos' },
  { id: 'script', label: 'Script Mode', icon: Mic, testId: 'tab-script-mode' },
  { id: 'scriptToVideo', label: 'Script to Video', icon: AudioLines, testId: 'tab-script-to-video' },
];

export default function App() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<View>('videos');
  // Enhance Studio — the merged Video Enhancer editor, opened on a READY video.
  const [enhance, setEnhance] = useState<EnhanceTarget | null>(null);
  // Sound Studio — ElevenLabs music, optional sound effects and optional
  // captions laid over a video that already exists.
  const [sound, setSound] = useState<SoundTarget | null>(null);
  // The creation wizard, holding the style picked in the Create dialog's
  // "Choose Style" step. null = the wizard is closed.
  const [wizardStyle, setWizardStyle] = useState<VideoStyleId | null>(null);

  // Deep link: app://product-video?project=ID. Pipeline orchestration is owned
  // entirely by server-side schedules; opening this app never runs a sweep.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const p = params.get('project') ?? params.get('trackb_project');
      if (p && /^\d+$/.test(p)) setOpenId(Number(p));
    } catch { /* no-op */ }
  }, []);

  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <FxStyles />
      {sound ? (
        <div key={`sound-${sound.source}-${sound.sourceId}`} className="ps-enter-editor" style={{ height: '100%', overflowY: 'auto' }}>
          <SoundStudio target={sound} onBack={() => setSound(null)} />
        </div>
      ) : enhance ? (
        <div key={`enhance-${enhance.projectId}`} className="ps-enter-editor" style={{ height: '100%', overflowY: 'auto' }}>
          <EnhanceStudio
            videoUrl={enhance.videoUrl}
            title={enhance.title}
            accent={enhance.accent}
            onBack={() => setEnhance(null)}
          />
        </div>
      ) : openId != null ? (
        <div key={`editor-${openId}`} className="ps-enter-editor" style={{ height: '100%' }}>
          <Editor projectId={openId} onBack={() => setOpenId(null)} onEnhance={setEnhance} />
        </div>
      ) : wizardStyle ? (
        <div key={`wizard-${wizardStyle}`} className="ps-enter-editor" style={{ height: '100%', overflowY: 'auto' }}>
          <StyledWizard initialStyle={wizardStyle} onExit={() => setWizardStyle(null)} />
        </div>
      ) : (
        <div key="gallery" className="ps-enter-gallery">
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px) clamp(16px, 3vw, 30px) 0', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div role="tablist" aria-label="Product Studio sections" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', flexWrap: 'wrap' }}>
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = view === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setView(t.id)}
                    className="ps-btn"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', background: active ? 'var(--space-brand-primary-600)' : 'transparent', color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                    data-testid={t.testId}
                  >
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'script-to-video' } }))}
              className="ps-btn"
              title="Open the Script-to-Video agent — describe the video you want and it scripts, casts and renders the whole thing"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 12, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', color: 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              data-testid="button-open-stv-agent"
            >
              <Bot size={14} /> AI Video Agent
            </button>
          </div>
          {view === 'videos' ? (
            <MyVideos
              onOpen={setOpenId}
              onStartWizard={setWizardStyle}
              onEnhance={setEnhance}
              onAddSound={setSound}
            />
          ) : view === 'saved' ? (
            <SavedVideos onAddSound={(t) => setSound(t)} />
          ) : view === 'script' ? (
            <ScriptMode />
          ) : (
            <ScriptToVideo />
          )}
        </div>
      )}
    </div>
  );
}
