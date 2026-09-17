/**
 * My Characters — VidVerge dock app.
 *
 * A gallery + composer for the visitor's saved characters. Upload a reference
 * image, name it, and Reel derives a reusable description so the character
 * stays visually consistent across a video's scenes. The heavy lifting lives in
 * components/CharacterStudio.tsx so the same UI backs the in-chat studio panel.
 */
import { Users, Film } from 'lucide-react';
import { CharacterManager } from '../../components/CharacterStudio';
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
                background: 'rgba(124,58,237,0.16)',
                border: '1px solid rgba(124,58,237,0.4)',
              }}
            >
              <Users size={22} color="#c4b5fd" />
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>My Characters</h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: '#9ca3af' }}>
                Save a character once — Reel keeps them looking identical in every video.
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
              background: 'linear-gradient(90deg, #7c3aed 0%, #4f46e5 100%)',
              boxShadow: '0 6px 20px rgba(124,58,237,0.35)',
            }}
          >
            <Film size={15} /> New video
          </button>
        </div>

        <CharacterManager />
      </div>
    </div>
  );
}
