/**
 * Screen 1 — Library. A dense list, not a card grid: contact-strip thumbnails,
 * title, mode badge, scene count, status. Running projects pin to the top with
 * a live progress rail. Legacy projects from the retired module stay live and
 * accessible alongside new ones (founder decision — never read-only).
 */
import { useMemo } from 'react';
import { Clapperboard, Play, Plus } from 'lucide-react';
import { LegacyProject, Project, T } from './api';

const ACTIVE: string[] = ['briefing', 'blueprint', 'casting', 'rendering', 'assembling', 'post'];

/** Legacy rows come from the retired module, so a missing list is normal. */
function clipCount(l: LegacyProject): number {
  return Array.isArray(l?.clips) ? l.clips.length : 0;
}

function StatusWord({ p }: { p: Project }) {
  const map: Record<string, { word: string; color: string }> = {
    briefing: { word: 'Brief', color: T.live },
    blueprint: { word: 'Blueprint', color: T.live },
    casting: { word: 'Casting', color: T.live },
    rendering: { word: 'Filming', color: T.live },
    review: { word: 'Review', color: T.bone },
    assembling: { word: 'Assembling', color: T.live },
    post: { word: 'Finishing', color: T.live },
    ready: { word: 'Ready', color: T.done },
    failed: { word: 'Failed', color: T.fault },
    stalled: { word: 'Stalled', color: T.fault },
  };
  const s = map[p.status] || { word: p.status, color: T.muted };
  return <span style={{ color: s.color, fontSize: 12.5 }}>{s.word}</span>;
}

function Strip({ urls }: { urls: string[] }) {
  const three = [urls[0], urls[1], urls[2]];
  return (
    <div style={{ display: 'flex', gap: 2, width: 132, flexShrink: 0 }}>
      {three.map((u, i) => (
        <div key={i} style={{ width: 42, height: 58, background: T.raised, borderRadius: 3, overflow: 'hidden' }}>
          {u ? <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
      ))}
    </div>
  );
}

export default function Library(props: {
  projects: Project[];
  legacy: LegacyProject[];
  loading: boolean;
  onNew: () => void;
  onOpen: (p: Project) => void;
  onOpenLegacy: (l: LegacyProject) => void;
  onQuickCreate: (text: string) => void;
}) {
  const { loading, onNew, onOpen, onOpenLegacy, onQuickCreate } = props;
  const projects = Array.isArray(props.projects) ? props.projects : [];
  const legacy = Array.isArray(props.legacy) ? props.legacy : [];
  const ordered = useMemo(() => {
    const running = projects.filter((p) => ACTIVE.includes(p.status));
    const rest = projects.filter((p) => !ACTIVE.includes(p.status));
    return [...running, ...rest];
  }, [projects]);

  const empty = !loading && ordered.length === 0 && legacy.length === 0;

  if (empty) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          <input
            autoFocus
            placeholder="A word, a line, or your whole script."
            onKeyDown={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (e.key === 'Enter' && v) onQuickCreate(v);
            }}
            style={{
              width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10,
              color: T.bone, fontSize: 15, padding: '18px 20px', outline: 'none', fontFamily: T.sans,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 120px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ color: T.bone, fontSize: 15, fontWeight: 600 }}>Your videos</div>
        <button
          onClick={onNew}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, background: T.bone, color: T.canvas,
            border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={15} /> New video
        </button>
      </div>

      {loading && !ordered.length ? (
        <div style={{ color: T.muted, fontSize: 13, padding: '32px 0' }}>Loading your library…</div>
      ) : null}

      <div>
        {ordered.map((p) => {
          const running = ACTIVE.includes(p.status);
          return (
            <button
              key={p.id}
              onClick={() => onOpen(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`,
                padding: '14px 4px', cursor: 'pointer',
              }}
            >
              <Strip urls={Array.isArray(p.thumbs) ? p.thumbs : []} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.title || 'Untitled video'}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 5 }}>
                  <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 4, padding: '1px 6px' }}>
                    {p.aspect_ratio} {p.mode}
                  </span>
                  <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>
                    {p.scene_count ? `${p.scene_count} scenes` : '—'}
                  </span>
                  <StatusWord p={p} />
                </div>
                {running ? (
                  <div style={{ marginTop: 8, height: 3, background: T.raised, borderRadius: 2, overflow: 'hidden', maxWidth: 360 }}>
                    <div style={{ height: '100%', width: '40%', background: T.live, borderRadius: 2, animation: 's2v-rail 1.6s ease-in-out infinite alternate' }} />
                  </div>
                ) : null}
                {running && p.stage_note ? (
                  <div style={{ color: T.live, fontSize: 12, marginTop: 5 }}>{p.stage_note}</div>
                ) : null}
              </div>
              {p.final_url ? <Play size={16} color={T.muted} /> : <Clapperboard size={16} color={T.dim} />}
            </button>
          );
        })}

        {legacy.map((l) => {
          const clips = clipCount(l);
          return (
            <button
              key={l.id}
              onClick={() => onOpenLegacy(l)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`,
                padding: '14px 4px', cursor: 'pointer',
              }}
            >
              <Strip urls={[]} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.title}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 5 }}>
                  <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 4, padding: '1px 6px' }}>Legacy</span>
                  <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>{l.scene_count ? `${l.scene_count} scenes` : '—'}</span>
                  <span style={{ color: l.final_url || clips ? T.done : T.muted, fontSize: 12.5 }}>
                    {l.final_url ? 'Ready' : clips ? `${clips} clips` : 'No stored video'}
                  </span>
                </div>
              </div>
              {l.final_url || clips ? <Play size={16} color={T.muted} /> : <Clapperboard size={16} color={T.dim} />}
            </button>
          );
        })}
      </div>
      <style>{`@keyframes s2v-rail { from { transform: translateX(-30%); } to { transform: translateX(240%); } }`}</style>
    </div>
  );
}
