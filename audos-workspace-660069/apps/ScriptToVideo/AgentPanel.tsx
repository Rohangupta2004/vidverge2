/**
 * Screen 8 — Agentic Verge, docked. One input, one attach-free bar, present on
 * every screen from Create onward. Placeholder cycles through things actually
 * worth asking. Copy is directive, never chatty.
 */
import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, Sparkles } from 'lucide-react';
import { api, T } from './api';

const PLACEHOLDERS = [
  'add punchier music',
  'make scene 2 darker and regenerate',
  'cut the last scene',
  'assemble the video',
  'regenerate the last two scenes',
];

export default function AgentPanel(props: { projectId?: number; onActed: () => void }) {
  const { projectId, onActed } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [phIdx, setPhIdx] = useState(0);
  const timer = useRef<any>(null);

  useEffect(() => {
    timer.current = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(timer.current);
  }, []);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setReply('');
    try {
      const res = await api.command(t, projectId);
      setReply(res.reply || 'Done.');
      setText('');
      onActed();
    } catch (e: any) {
      setReply(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 16px 14px', background: 'linear-gradient(transparent, rgba(19,19,22,0.97) 30%)' }}>
      {reply ? (
        <div style={{ maxWidth: 680, margin: '0 auto 8px', color: T.bone, fontSize: 12.5, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '8px 14px' }}>
          <Sparkles size={12} color={T.live} style={{ display: 'inline', marginRight: 7, verticalAlign: '-2px' }} />
          {reply}
        </div>
      ) : null}
      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '4px 6px 4px 14px' }}>
        <Sparkles size={14} color={T.live} style={{ flexShrink: 0 }} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={PLACEHOLDERS[phIdx]}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.bone, fontSize: 13.5, padding: '9px 0' }}
        />
        <button onClick={send} disabled={busy || !text.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: text.trim() ? T.bone : 'transparent', color: text.trim() ? T.canvas : T.dim, border: 'none', borderRadius: 7, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default' }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
        </button>
      </div>
    </div>
  );
}
