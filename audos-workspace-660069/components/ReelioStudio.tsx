/**
 * ReelioStudio — the shell-mounted overlay host for the three power features.
 *
 * Mounted once by Desktop.tsx (like PricingScreen) so any surface — the dock
 * apps, the in-chat toolbar, the Script Studio itself — can raise a full-screen
 * studio panel from any shell state by dispatching a window event:
 *   vidverge:open-characters | vidverge:open-mockups | vidverge:open-script-studio
 *
 * The panels reuse the same manager components rendered by the dock apps, so
 * there is a single source of truth for each feature's UI.
 */
import { useEffect, useState } from 'react';
import { Users, Smartphone, Film, X } from 'lucide-react';
import { CharacterManager } from './CharacterStudio';
import { MockupManager } from './MockupStudio';
import { ScriptStudio } from './ScriptStudio';
import { ScriptScene, STUDIO_EVENTS } from '../lib/reelioStudio';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

type Panel = 'characters' | 'mockups' | 'script' | null;

const META: Record<Exclude<Panel, null>, { title: string; subtitle: string; icon: any; accent: string }> = {
  characters: {
    title: 'My Characters',
    subtitle: 'Upload a reference image and keep the same character in every shot.',
    icon: Users,
    accent: '#2563eb',
  },
  mockups: {
    title: 'App Mockups',
    subtitle: 'Generate a realistic app screen to embed into your video.',
    icon: Smartphone,
    accent: '#0d9488',
  },
  script: {
    title: 'Script Studio',
    subtitle: 'Review and edit your script scene by scene, then generate.',
    icon: Film,
    accent: '#2563eb',
  },
};

export default function ReelioStudio() {
  const [panel, setPanel] = useState<Panel>(null);
  const [scriptSeed, setScriptSeed] = useState<ScriptScene[] | undefined>(undefined);

  useEffect(() => {
    const openChars = () => setPanel('characters');
    const openMocks = () => setPanel('mockups');
    const openScript = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setScriptSeed(Array.isArray(detail.scenes) ? detail.scenes : undefined);
      setPanel('script');
    };
    window.addEventListener(STUDIO_EVENTS.openCharacters, openChars);
    window.addEventListener(STUDIO_EVENTS.openMockups, openMocks);
    window.addEventListener(STUDIO_EVENTS.openScriptStudio, openScript);
    return () => {
      window.removeEventListener(STUDIO_EVENTS.openCharacters, openChars);
      window.removeEventListener(STUDIO_EVENTS.openMockups, openMocks);
      window.removeEventListener(STUDIO_EVENTS.openScriptStudio, openScript);
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  if (!panel) return null;
  const meta = META[panel];
  const Icon = meta.icon;
  const close = () => setPanel(null);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(4,4,6,0.72)',
        backdropFilter: 'blur(6px)',
        fontFamily: FONT,
        animation: 'rsFade .18s ease both',
      }}
    >
      <style>{`@keyframes rsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rsRise { from { opacity: 0; transform: translateY(14px) scale(.98);} to { opacity:1; transform:none;} }`}</style>
      <div
        style={{
          width: '100%',
          maxWidth: panel === 'script' ? 720 : 860,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'linear-gradient(180deg, #0d0d12 0%, #08080b 100%)',
          boxShadow: '0 40px 120px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          animation: 'rsRise .28s cubic-bezier(.16,1,.3,1) both',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '18px 22px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: `radial-gradient(600px 120px at 0% 0%, ${meta.accent}22, transparent 70%)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 12,
                background: `${meta.accent}22`,
                border: `1px solid ${meta.accent}55`,
              }}
            >
              <Icon size={20} color="#fff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>{meta.title}</h2>
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {meta.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, overflowY: 'auto' }}>
          {panel === 'characters' && <CharacterManager compact />}
          {panel === 'mockups' && <MockupManager compact />}
          {panel === 'script' && (
            <ScriptStudio initialScenes={scriptSeed} onClose={close} />
          )}
        </div>
      </div>
    </div>
  );
}
