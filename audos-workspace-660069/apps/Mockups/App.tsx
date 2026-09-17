/**
 * App Mockups — VidVerge dock app.
 *
 * Generate realistic phone/desktop UI screenshots of a product screen and reuse
 * them across videos as the screen the character holds. The UI lives in
 * components/MockupStudio.tsx so the same gallery backs the in-chat studio panel.
 */
import { Smartphone, Film } from 'lucide-react';
import { MockupManager } from '../../components/MockupStudio';
import { openScriptStudio } from '../../lib/reelioStudio';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export default function App() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#080808', color: '#fff', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto', padding: '32px 24px 56px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 13,
                background: 'rgba(13,148,136,0.16)',
                border: '1px solid rgba(45,212,191,0.4)',
              }}
            >
              <Smartphone size={22} color="#5eead4" />
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>App Mockups</h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: '#9ca3af' }}>
                Generate a screen once — drop it into a video as the app your character is using.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openScriptStudio()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 16px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              background: 'linear-gradient(90deg, #0d9488 0%, #4f46e5 100%)',
              boxShadow: '0 6px 20px rgba(13,148,136,0.35)',
            }}
          >
            <Film size={15} /> New video
          </button>
        </div>

        <MockupManager />
      </div>
    </div>
  );
}
