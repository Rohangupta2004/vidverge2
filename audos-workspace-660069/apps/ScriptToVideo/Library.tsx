/**
 * Screen 1 — Library. A dense list, not a card grid: contact-strip thumbnails,
 * title, mode badge, scene count, status. Running projects pin to the top with
 * a live progress rail. Legacy projects from the retired module stay live and
 * accessible alongside new ones (founder decision — never read-only).
 */
import { useMemo } from 'react';
import { Clapperboard, Play, Plus, Sparkles } from 'lucide-react';
import { LegacyProject, Project, T } from './api';

const ACTIVE: string[] = ['briefing', 'blueprint', 'casting', 'rendering', 'assembling', 'post'];

/** Legacy rows come from the retired module, so a missing list is normal. */
function clipCount(l: LegacyProject): number {
  return Array.isArray(l?.clips) ? l.clips.length : 0;
}

function StatusWord({ p }: { p: Project }) {
  const map: Record<string, { word: string; color: string; bg: string }> = {
    briefing: { word: 'Brief', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    blueprint: { word: 'Blueprint', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    casting: { word: 'Casting', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    rendering: { word: 'Filming', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    review: { word: 'Review', color: T.bone, bg: 'rgba(237,235,232,0.1)' },
    assembling: { word: 'Assembling', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    post: { word: 'Finishing', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    ready: { word: 'Ready', color: T.done, bg: 'rgba(127,212,180,0.12)' },
    failed: { word: 'Failed', color: T.fault, bg: 'rgba(226,114,111,0.12)' },
    stalled: { word: 'Stalled', color: T.fault, bg: 'rgba(226,114,111,0.12)' },
  };
  const s = map[p.status] || { word: p.status, color: T.muted, bg: 'rgba(119,117,127,0.12)' };
  return <span style={{ color: s.color, background: s.bg, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '2px 9px' }}>{s.word}</span>;
}

function Strip({ urls }: { urls: string[] }) {
  const three = [urls[0], urls[1], urls[2]];
  return (
    <div style={{ display: 'flex', gap: 2, width: 132, flexShrink: 0 }}>
      {three.map((u, i) => (
        <div key={i} style={{ width: 42, height: 58, background: T.raised, borderRadius: 4, overflow: 'hidden', border: `1px solid rgba(255,255,255,0.04)` }}>
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
    const starters = ['A 30-second ad for my coffee brand', 'How photosynthesis works, for kids', 'A launch teaser for a new app'];
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 620, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(232,163,60,0.1)', border: '1px solid rgba(232,163,60,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Sparkles size={26} color={T.live} />
          </div>
          <div style={{ color: T.bone, fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Make your first video</div>
          <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.6, marginBottom: 24 }}>Type a word, a line, or paste a whole script — the pipeline writes, films and assembles the rest.</div>
          <input
            autoFocus
            placeholder="A word, a line, or your whole script…"
            onKeyDown={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (e.key === 'Enter' && v) onQuickCreate(v);
            }}
            style={{
              width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12,
              color: T.bone, fontSize: 15, padding: '18px 20px', outline: 'none', fontFamily: T.sans,
              boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
            }}
          />
          <div style={{ color: T.dim, fontSize: 11.5, marginTop: 10 }}>Press Enter to begin</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
            {starters.map((s) => (
              <button key={s} className="s2v-ghost" onClick={() => onQuickCreate(s)} style={{ background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 999, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 120px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ color: T.bone, fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Your videos</div>
          {ordered.length ? <div style={{ color: T.dim, fontSize: 12, marginTop: 3 }}>{ordered.length} {ordered.length === 1 ? 'project' : 'projects'}{legacy.length ? ` · ${legacy.length} legacy` : ''}</div> : null}
        </div>
        <button
          className="s2v-lift"
          onClick={onNew}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, background: T.bone, color: T.canvas,
            border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          }}
        >
          <Plus size={15} /> New video
        </button>
      </div>

      {loading && !ordered.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '14px 10px' }}>
              <div style={{ width: 132, height: 58, background: T.raised, borderRadius: 6, opacity: 0.6 }} />
              <div style={{ flex: 1 }}>
                <div style={{ width: '45%', height: 13, background: T.raised, borderRadius: 4, opacity: 0.6, marginBottom: 8 }} />
                <div style={{ width: '25%', height: 10, background: T.raised, borderRadius: 4, opacity: 0.4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        {ordered.map((p) => {
          const running = ACTIVE.includes(p.status);
          return (
            <button
              key={p.id}
              className="s2v-row"
              onClick={() => onOpen(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`,
                padding: '14px 10px', cursor: 'pointer',
              }}
            >
              <Strip urls={Array.isArray(p.thumbs) ? p.thumbs : []} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.title || 'Untitled video'}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '2px 7px' }}>
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
              className="s2v-row"
              onClick={() => onOpenLegacy(l)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`,
                padding: '14px 10px', cursor: 'pointer',
              }}
            >
              <Strip urls={[]} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.title}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '2px 7px' }}>Legacy</span>
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
