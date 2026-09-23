/**
 * Director panel — docked on the board and final screens. Pick a scene, say
 * what should change ("warmer light, closer framing", "make this scene
 * independent of the previous one"), and Opus 5 rewrites that ONE scene's
 * prompt from the full three-layer context; you then trigger the regeneration
 * yourself while every other clip stays untouched.
 */
import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, Sparkles } from 'lucide-react';
import { FilmScene, T } from './api';

const PLACEHOLDERS = [
  'warmer light, tighter framing',
  'slower camera push, more documentary',
  'make this scene independent of the previous one',
  'keep the character closer to the lens',
  'more dramatic weather, harder shadows',
];

export default function AgentPanel(props: {
  scenes: FilmScene[];
  busy: boolean;
  onDirect: (scene: FilmScene, instruction: string) => Promise<string>;
}) {
  const { busy, onDirect } = props;
  const scenes = [...(Array.isArray(props.scenes) ? props.scenes : [])].sort((a, b) => a.idx - b.idx);
  const [sceneId, setSceneId] = useState<number | ''>('');
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [reply, setReply] = useState('');
  const [phIdx, setPhIdx] = useState(0);
  const timer = useRef<any>(null);

  useEffect(() => {
    timer.current = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(timer.current);
  }, []);

  useEffect(() => {
    if (sceneId === '' && scenes.length) setSceneId(scenes[0].id);
  }, [scenes.length]);

  async function send() {
    const t = text.trim();
    const scene = scenes.find((s) => s.id === sceneId);
    if (!t || !scene || working || busy) return;
    setWorking(true);
    setReply('');
    try {
      const note = await onDirect(scene, t);
      setReply(note || 'Scene updated — regenerating it now.');
      setText('');
    } catch (e: any) {
      setReply(String(e?.message || e));
    } finally {
      setWorking(false);
    }
  }

  if (!scenes.length) return null;

  return (
    // In normal document flow (NOT an absolute overlay) — the chat can never
    // cover scene results or the Final Assembly bar below it.
    <div style={{ flexShrink: 0, padding: '8px 16px 10px', background: T.canvas, borderTop: `1px solid ${T.raised}` }}>
      {reply ? (
        <div style={{ maxWidth: 720, margin: '0 auto 8px', color: T.bone, fontSize: 12.5, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '8px 14px' }}>
          <Sparkles size={12} color={T.live} style={{ display: 'inline', marginRight: 7, verticalAlign: '-2px' }} />
          {reply}
        </div>
      ) : null}
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '4px 6px 4px 10px' }}>
        <Sparkles size={14} color={T.live} style={{ flexShrink: 0 }} />
        <select
          value={sceneId}
          onChange={(e) => setSceneId(Number(e.target.value))}
          style={{ background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 7, fontSize: 12, padding: '7px 8px', outline: 'none', flexShrink: 0 }}
        >
          {scenes.map((s) => <option key={s.id} value={s.id}>Scene {s.idx + 1}</option>)}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={PLACEHOLDERS[phIdx]}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.bone, fontSize: 13.5, padding: '9px 0' }}
        />
        <button onClick={send} disabled={working || busy || !text.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: text.trim() ? T.bone : 'transparent', color: text.trim() ? T.canvas : T.dim, border: 'none', borderRadius: 7, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default' }}>
          {working ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
        </button>
      </div>
    </div>
  );
}
