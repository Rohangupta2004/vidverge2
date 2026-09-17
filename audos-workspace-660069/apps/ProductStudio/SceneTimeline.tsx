/**
 * Scene timeline — the horizontal strip of 3D scene cards at the bottom of the
 * editor. Click selects a scene (controls + preview follow), drag-to-reorder
 * persists through the trackb-project reorder_scenes op (the scenes array IS
 * the play order), and the scissors quick-cut is preserved from the previous
 * editor. The active scene keeps a persistent 3D lift and an accent ring.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, GripVertical, Loader2, Lock, Scissors } from 'lucide-react';
import { STATE_EXPLAIN, type TrackBScene } from '../../lib/trackB/api';
import { Tilt } from './fx';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  border: 'var(--space-border-default)',
  card: 'var(--space-surface-card)',
  panelStrong: 'var(--space-surface-panel-strong)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

function stateDot(scene: TrackBScene): { color: string; icon?: React.ReactNode; title: string } {
  switch (scene.state) {
    case 'EDITABLE': return { color: S.success, title: 'Editable scene' };
    case 'REGENERATING': return { color: '#fbbf24', icon: <Loader2 size={9} className="rc-spin" />, title: STATE_EXPLAIN.REGENERATING };
    case 'ERROR': return { color: S.danger, icon: <AlertTriangle size={9} />, title: STATE_EXPLAIN.ERROR };
    default: return { color: '#94a3b8', icon: <Lock size={9} />, title: STATE_EXPLAIN[scene.state as keyof typeof STATE_EXPLAIN] ?? scene.state };
  }
}

export default function SceneTimeline({
  scenes,
  selectedSceneId,
  onSelect,
  onReorder,
  onCut,
  brandTokens,
  busy = false,
}: {
  scenes: TrackBScene[];
  selectedSceneId: string | null;
  onSelect: (id: string) => void;
  onReorder: (sceneIds: string[]) => void;
  onCut: (scene: TrackBScene) => void;
  brandTokens: Record<string, string>;
  busy?: boolean;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const scrollBy = (dir: -1 | 1) => {
    stripRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = scenes.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragId(null);
    setOverId(null);
    onReorder(ids);
  };

  if (scenes.length === 0) {
    return (
      <p style={{ margin: 0, padding: '10px 2px', fontSize: 12.5, color: S.muted }}>
        Scenes appear here once the planner has run — hit Generate above.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }} data-testid="scene-timeline">
      <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll scenes left" style={{ alignSelf: 'center', padding: 6, borderRadius: 9, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer' }} data-testid="timeline-scroll-left">
        <ChevronLeft size={14} />
      </button>
      <div ref={stripRef} className="ps-scroll-x" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '12px 4px 14px', flex: 1, minWidth: 0 }}>
        {scenes.map((s, i) => {
          const selected = s.id === selectedSceneId;
          const dot = stateDot(s);
          const img = s.image_url ?? s.generated_image_url ?? (s.asset_refs ?? []).find((u) => /^https:\/\//.test(u)) ?? null;
          return (
            <div key={s.id} style={{ flexShrink: 0, opacity: dragId === s.id ? 0.45 : 1, transition: 'opacity 120ms ease' }}>
              <Tilt
                maxTilt={8}
                lifted={selected}
                role="button"
                tabIndex={0}
                ariaLabel={`Select scene ${i + 1}`}
                testId={`scene-card-${s.id}`}
                onClick={() => onSelect(s.id)}
                draggable={!busy}
                onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', s.id); } catch { /* older engines */ } }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overId !== s.id) setOverId(s.id); }}
                onDrop={(e) => { e.preventDefault(); drop(s.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                style={{
                  width: 168, textAlign: 'left', padding: 9, borderRadius: 13, cursor: busy ? 'default' : 'grab',
                  border: selected ? '2px solid var(--space-brand-primary-500)' : overId === s.id && dragId ? '2px dashed var(--space-brand-primary-500)' : `1px solid ${S.border}`,
                  background: selected ? S.panelStrong : S.card,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: S.muted }}>
                    <GripVertical size={10} aria-hidden="true" /> #{i + 1}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span title={dot.title} aria-label={s.state} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: dot.color }}>
                      {dot.icon}
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: dot.color, display: 'inline-block' }} />
                    </span>
                    {scenes.length > 1 && (s.state === 'EDITABLE' || s.state === 'ERROR') ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Cut scene ${i + 1} from the film`}
                        title="Cut this scene from the film (a restorable snapshot is kept)"
                        onClick={(e) => { e.stopPropagation(); onCut(s); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onCut(s); } }}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 6, color: S.muted, border: `1px solid ${S.border}`, cursor: 'pointer' }}
                        data-testid={`button-cut-${s.id}`}
                      >
                        <Scissors size={10} />
                      </span>
                    ) : null}
                  </span>
                </div>
                {img ? (
                  <img src={img} alt="" style={{ display: 'block', width: '100%', height: 58, objectFit: 'cover', borderRadius: 8, marginTop: 6, border: `1px solid ${S.border}`, pointerEvents: 'none' }} data-testid={`scene-image-${s.id}`} />
                ) : (
                  <span aria-hidden="true" style={{ display: 'block', width: '100%', height: 58, borderRadius: 8, marginTop: 6, background: `linear-gradient(135deg, ${brandTokens.primary ?? 'var(--space-brand-primary-600)'}, ${brandTokens.accent ?? 'var(--space-brand-primary-400)'})` }} data-testid={`scene-tile-${s.id}`} />
                )}
                <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: 700, color: S.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.headline || (s.state === 'BAKED' ? 'Baked footage' : 'Untitled scene')}
                </span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: S.muted }}>{s.duration_s}s</span>
              </Tilt>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll scenes right" style={{ alignSelf: 'center', padding: 6, borderRadius: 9, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer' }} data-testid="timeline-scroll-right">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
