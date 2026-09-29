/**
 * Product Studio — Track B (HyperFrames Product Video).
 *
 * App shell/router, consolidated to the core user journey. The customer sees
 * THREE tabs; every workflow tool lives in the internal Studio tools drawer
 * instead of the top-level nav:
 *   - Brand Reel     the URL-first front door and the default tab: paste a
 *                    product URL, confirm the scraped Brand Object, pick one
 *                    of six storyboarded script variants, check a generated
 *                    mockup per scene, then render a Remotion MP4 in the
 *                    CLIENT's colours, font and logo (apps/ProductStudio/brandreel)
 *   - Ad Director    the AI Product Advertisement Director — URL in, a
 *                    voice-timed, storyboarded, quality-checked ad out
 *   - Videos         one gallery tab: My Videos (projects — opening one
 *                    slides the full-screen agentic editor in) and Saved
 *                    Videos (every finished video from both flows) behind a
 *                    small toggle inside the tab, not two top-level tabs
 *
 * STUDIO TOOLS (internal drawer, never top-level tabs): Design with AI,
 * Remotion Studio, Script Mode and Script to Video. Remotion Studio stays
 * MOUNTED across switches so an in-flight render keeps polling. The creation
 * wizard, the editor, the Enhance Studio and the Sound Studio still open
 * full-screen over the gallery.
 *
 * Runway product recipes moved to Ads Studio's Recipes section — this app no
 * longer carries a Runway tab.
 *
 * All project state flows through the trackb-project safe mutation API — see
 * lib/trackB/api.ts.
 */
import { useEffect, useState } from 'react';
import { AudioLines, Bot, ChevronDown, Clapperboard, Film, Globe, Mic, Sparkles, Wand2, Wrench, X } from 'lucide-react';
import FilmStudio from './film/FilmStudio';
import BrandReelStudio from './brandreel/BrandReelStudio';
import DesignStudio from './design/DesignStudio';
import MyVideos from './MyVideos';
import SavedVideos from './SavedVideos';
import Editor from './Editor';
import EnhanceStudio from './EnhanceStudio';
import StyledWizard from './StyledWizard';
import SoundStudio, { type SoundTarget } from './SoundStudio';
import ScriptMode from './ScriptMode';
import ScriptToVideo from './ScriptToVideo';
import RemotionStudio from './RemotionStudio';
import { FxStyles } from './fx';
import type { VideoStyleId } from './videoStyles';
import ProductSuiteHeader from '../../components/ProductSuiteHeader';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';

/** A ready (rendered) video handed to the Enhance Studio as its editable source. */
export interface EnhanceTarget {
  projectId: number;
  title: string;
  videoUrl: string;
  accent?: string | null;
}

type View = 'brandreel' | 'film' | 'videos';
type StudioTool = 'design' | 'remotion' | 'script' | 'scriptToVideo';

const TABS: { id: View; label: string; icon: typeof Film; testId: string }[] = [
  // Brand Reel — the URL-first front door. Paste a product URL, confirm the
  // scraped Brand Object, pick one of six storyboarded script variants, check
  // a generated mockup per scene, then render a branded Remotion MP4. Every
  // frame uses the CLIENT's scraped colours, font and logo — never VidVerge's.
  { id: 'brandreel', label: 'Brand Reel', icon: Globe, testId: 'tab-brand-reel' },
  // Ad Director — the AI Product Advertisement Director (website URL → Opus 5
  // research → ad strategy → voiceover script FIRST → per-scene TTS timing →
  // visual storyboard → real-UI mockups / Omni Flash B-roll / GSAP diagrams →
  // quality control → FFmpeg final ad + variations).
  { id: 'film', label: 'Ad Director', icon: Clapperboard, testId: 'tab-ai-film' },
  // Videos — the merged gallery tab: My Videos (projects) and Saved Videos
  // (finished videos) as an in-tab toggle rather than two nav tabs.
  { id: 'videos', label: 'Videos', icon: Film, testId: 'tab-videos' },
];

const STUDIO_TOOLS: { id: StudioTool; label: string; icon: typeof Film; blurb: string; testId: string }[] = [
  // Design with AI — upload a talking video; Opus 5 transcribes it, designs
  // timestamped GSAP/SVG overlay graphics around the talking head, quality-
  // checks itself, and hands over an editable timeline.
  { id: 'design', label: 'Design with AI', icon: Wand2, blurb: 'Design motion graphics onto a video you already have', testId: 'studio-tool-design-with-ai' },
  // Remotion Studio — structured brief → Gemini Vision on uploads → ElevenLabs
  // VO → server-side Remotion render (UI Mode 16:9 / Story Mode 9:16).
  { id: 'remotion', label: 'Remotion Studio', icon: Sparkles, blurb: 'SaaS launch film from a brief — kinetic-type motion design, rendered server-side', testId: 'studio-tool-remotion-studio' },
  { id: 'script', label: 'Script Mode', icon: Mic, blurb: 'Write a timed narration script and voice it', testId: 'studio-tool-script-mode' },
  { id: 'scriptToVideo', label: 'Script to Video', icon: AudioLines, blurb: 'Turn a script or voice track into a screenshot-timed video', testId: 'studio-tool-script-to-video' },
];

export default function App() {
  const [openId, setOpenId] = useState<number | null>(null);
  // Brand Reel is the front door — a URL input is the first thing a customer
  // sees. Ad Director and the galleries stay one tab away.
  const [view, setView] = useState<View>('brandreel');
  // The internal Studio tools drawer: which workflow tool is open (replaces
  // the tab panel while active) and whether the picker menu is showing.
  const [tool, setTool] = useState<StudioTool | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Videos tab sub-view: project gallery or the unified finished-video gallery.
  const [gallery, setGallery] = useState<'mine' | 'saved'>('mine');
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

  const activeTool = STUDIO_TOOLS.find((t) => t.id === tool) || null;

  // Vidverge Agent — the floating orb assistant. This app is a tab router, so
  // the agent navigates tabs/tools for the customer and guides them to the
  // Brand Reel URL box where a video starts.
  const agentContext = {
    appId: 'product-video',
    appName: 'Product Video',
    currentInputs: { activeTab: view, activeTool: tool ?? 'none', gallery },
    onFillField: (field: string, value: string) => {
      if (field === 'tab' && (value === 'brandreel' || value === 'film' || value === 'videos')) { setView(value); setTool(null); }
      else if (field === 'tool' && (value === 'design' || value === 'remotion' || value === 'script' || value === 'scriptToVideo')) setTool(value);
      else if (field === 'gallery' && (value === 'mine' || value === 'saved')) { setView('videos'); setTool(null); setGallery(value); }
    },
    onTriggerAction: (action: string, params?: Record<string, unknown>) => {
      const p = params || {};
      if (action === 'openTab') {
        const tab = String(p.tab || '');
        if (tab === 'brandreel' || tab === 'film' || tab === 'videos') { setView(tab); setTool(null); }
      } else if (action === 'openTool') {
        const t = String(p.tool || '');
        if (t === 'design' || t === 'remotion' || t === 'script' || t === 'scriptToVideo') setTool(t);
      } else if (action === 'generate') { setView('brandreel'); setTool(null); }
    },
    promptHint: [
      'Fields you can fill: tab (brandreel = Brand Reel URL-first video flow, film = Ad Director, videos = galleries), tool (design | remotion | script | scriptToVideo), gallery (mine | saved).',
      'Actions you can trigger: openTab with {"tab":"brandreel"|"film"|"videos"}, openTool with {"tool":"design"|"remotion"|"script"|"scriptToVideo"}, generate (opens the Brand Reel tab to start a new product video).',
      'The product URL box lives on the Brand Reel tab — the user pastes their product URL there and the app reads their brand and writes six ad scripts.',
    ].join('\n'),
  };

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
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px) clamp(16px, 3vw, 30px) 0', boxSizing: 'border-box' }}>
            <ProductSuiteHeader
              name="Product Video"
              voice="Your SaaS launch video starts here: paste your URL and I read your brand, write six launch scripts, storyboard the one you pick, and render it in your own colours."
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <div role="tablist" aria-label="Product Studio sections" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', flexWrap: 'wrap' }}>
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = view === t.id && !tool;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setView(t.id); setTool(null); }}
                    className="ps-btn"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', background: active ? 'var(--space-brand-primary-600)' : 'transparent', color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                    data-testid={t.testId}
                  >
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Studio tools — the internal drawer holding the workflow tools
                that used to be top-level tabs. */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setToolsOpen((o) => !o)}
                className="ps-btn"
                title="Workflow tools: Design with AI, Remotion Studio, Script Mode and Script to Video"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 12, border: `1px solid ${tool ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'}`, background: 'var(--space-surface-panel)', color: tool ? 'var(--space-text-brand)' : 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                data-testid="button-studio-tools"
              >
                <Wrench size={14} /> {activeTool ? activeTool.label : 'Studio tools'} <ChevronDown size={13} />
              </button>
              {toolsOpen ? (
                <>
                  <div onClick={() => setToolsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, minWidth: 300, background: 'var(--space-surface-panel-strong)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 6, boxShadow: '0 18px 44px rgba(0,0,0,0.45)' }}>
                    <div style={{ padding: '7px 12px 5px', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--space-text-muted)' }}>Workflow tools</div>
                    {STUDIO_TOOLS.map((t) => {
                      const Icon = t.icon;
                      const active = tool === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setTool(t.id); setToolsOpen(false); }}
                          className="ps-btn"
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 9, border: 'none', background: active ? 'var(--space-brand-primary-600)' : 'transparent', color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)', cursor: 'pointer' }}
                          data-testid={t.testId}
                        >
                          <Icon size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{t.label}</span>
                            <span style={{ display: 'block', fontSize: 11.5, opacity: 0.75, lineHeight: 1.4 }}>{t.blurb}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
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
            </div>
            {tool && activeTool ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '9px 14px', borderRadius: 11, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--space-text-brand)' }}>Studio tool</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--space-text-primary)' }}>{activeTool.label}</span>
                <span style={{ fontSize: 12, color: 'var(--space-text-muted)' }}>{activeTool.blurb}</span>
                <button
                  type="button"
                  onClick={() => setTool(null)}
                  className="ps-btn"
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 9, border: '1px solid var(--space-border-default)', background: 'transparent', color: 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                  data-testid="button-close-studio-tool"
                >
                  <X size={13} /> Close
                </button>
              </div>
            ) : null}
            {view === 'videos' && !tool ? (
              <div role="tablist" aria-label="Video galleries" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 11, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', marginTop: 14 }}>
                {([
                  { id: 'mine' as const, label: 'My Videos', testId: 'gallery-my-videos' },
                  { id: 'saved' as const, label: 'Saved Videos', testId: 'gallery-saved-videos' },
                ]).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="tab"
                    aria-selected={gallery === g.id}
                    onClick={() => setGallery(g.id)}
                    className="ps-btn"
                    style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: gallery === g.id ? 'var(--space-brand-primary-600)' : 'transparent', color: gallery === g.id ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}
                    data-testid={g.testId}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {tool === 'design' ? (
            <DesignStudio />
          ) : tool === 'script' ? (
            <ScriptMode />
          ) : tool === 'scriptToVideo' ? (
            <ScriptToVideo />
          ) : tool === 'remotion' ? null : view === 'brandreel' ? (
            <BrandReelStudio />
          ) : view === 'film' ? (
            <FilmStudio />
          ) : view === 'videos' ? (
            gallery === 'mine' ? (
              <MyVideos
                onOpen={setOpenId}
                onStartWizard={setWizardStyle}
                onEnhance={setEnhance}
                onAddSound={setSound}
              />
            ) : (
              <SavedVideos onAddSound={(t) => setSound(t)} />
            )
          ) : null}
          {/* Remotion Studio stays MOUNTED across tab/tool switches so an
              in-flight render keeps polling and the form/result survive — it
              is only hidden while another surface is active. */}
          <div style={{ display: tool === 'remotion' ? 'block' : 'none' }}>
            <RemotionStudio />
          </div>
        </div>
      )}
      <AgentChatProvider appContext={agentContext}>
        <AgentChatButton />
        <AgentChatPanel />
      </AgentChatProvider>
    </div>
  );
}
