/**
 * Library — films from the rebuilt pipeline, plus read-only access to legacy
 * projects from the retired s2v-run pipeline (their finished MP4s stay
 * watchable; nothing new is ever written to the old tables).
 */
import { Clapperboard, Play, Plus, Sparkles } from 'lucide-react';
import { Film, T } from './api';

export interface LegacyFilm { id: number; title: string; final_url: string | null; created_at: string }

const ACTIVE = ['planning', 'producing', 'assembling'];

function StatusWord({ f }: { f: Film }) {
  const map: Record<string, { word: string; color: string; bg: string }> = {
    draft: { word: 'Draft', color: T.muted, bg: 'rgba(119,117,127,0.12)' },
    planning: { word: 'Planning', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    plan_ready: { word: 'Plan ready', color: T.bone, bg: 'rgba(237,235,232,0.1)' },
    producing: { word: 'Producing', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    assembling: { word: 'Assembling', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    ready: { word: 'Ready', color: T.done, bg: 'rgba(127,212,180,0.12)' },
    error: { word: 'Needs attention', color: T.fault, bg: 'rgba(226,114,111,0.12)' },
  };
  const s = map[String(f.status || 'draft')] || map.draft;
  return <span style={{ color: s.color, background: s.bg, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '2px 9px' }}>{s.word}</span>;
}

export default function Library(props: {
  films: Film[];
  legacy: LegacyFilm[];
  loading: boolean;
  onNew: () => void;
  onOpen: (f: Film) => void;
  onOpenLegacy: (l: LegacyFilm) => void;
  onQuickCreate: (text: string) => void;
}) {
  const { loading, onNew, onOpen, onOpenLegacy, onQuickCreate } = props;
  const films = Array.isArray(props.films) ? props.films : [];
  const legacy = Array.isArray(props.legacy) ? props.legacy : [];
  const ordered = [...films.filter((f) => ACTIVE.includes(String(f.status))), ...films.filter((f) => !ACTIVE.includes(String(f.status)))];
  const empty = !loading && !ordered.length && !legacy.length;

  if (empty) {
    const starters = ['A 30-second ad for my coffee brand', 'How our app saves teams 5 hours a week', 'A launch teaser for a new product'];
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 620, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(232,163,60,0.1)', border: '1px solid rgba(232,163,60,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Sparkles size={26} color={T.live} />
          </div>
          <div style={{ color: T.bone, fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Make your first film</div>
          <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.6, marginBottom: 24 }}>Paste a script. The director plans every scene — cinematic shots on Veo, exact graphics in your browser, real product mockups — and FFmpeg cuts the film.</div>
          <textarea
            autoFocus
            rows={3}
            placeholder="Paste your script (or a rough draft of it)…"
            onKeyDown={(e) => {
              const v = (e.target as HTMLTextAreaElement).value.trim();
              if (e.key === 'Enter' && !e.shiftKey && v) { e.preventDefault(); onQuickCreate(v); }
            }}
            style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, color: T.bone, fontSize: 14.5, lineHeight: 1.5, padding: '16px 18px', outline: 'none', fontFamily: T.sans, resize: 'vertical', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}
          />
          <div style={{ color: T.dim, fontSize: 11.5, marginTop: 10 }}>Press Enter to begin · Shift+Enter for a new line</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
            {starters.map((s) => (
              <button key={s} className="s2v-ghost" onClick={() => onQuickCreate(s)} style={{ background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 999, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>{s}</button>
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
          <div style={{ color: T.bone, fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Your films</div>
          {ordered.length ? <div style={{ color: T.dim, fontSize: 12, marginTop: 3 }}>{ordered.length} {ordered.length === 1 ? 'film' : 'films'}{legacy.length ? ` · ${legacy.length} legacy` : ''}</div> : null}
        </div>
        <button className="s2v-lift" onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bone, color: T.canvas, border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
          <Plus size={15} /> New film
        </button>
      </div>

      {loading && !ordered.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '14px 10px' }}>
              <div style={{ width: 104, height: 58, background: T.raised, borderRadius: 6, opacity: 0.6 }} />
              <div style={{ flex: 1 }}>
                <div style={{ width: '45%', height: 13, background: T.raised, borderRadius: 4, opacity: 0.6, marginBottom: 8 }} />
                <div style={{ width: '25%', height: 10, background: T.raised, borderRadius: 4, opacity: 0.4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        {ordered.map((f) => {
          const running = ACTIVE.includes(String(f.status));
          const sceneCount = Array.isArray(f.plan?.scenes) ? f.plan!.scenes.length : 0;
          return (
            <button key={f.id} className="s2v-row" onClick={() => onOpen(f)} style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`, padding: '14px 10px', cursor: 'pointer' }}>
              <div style={{ width: 104, height: 58, background: T.raised, borderRadius: 6, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.04)' }}>
                {f.final_thumb_url ? <img src={f.final_thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title || 'Untitled film'}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '2px 7px' }}>{f.aspect_ratio || '16:9'}</span>
                  <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>{sceneCount ? `${sceneCount} scenes` : '—'}</span>
                  {f.duration_s ? <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>{Math.round(Number(f.duration_s))}s</span> : null}
                  <StatusWord f={f} />
                </div>
                {running ? (
                  <div style={{ marginTop: 8, height: 3, background: T.raised, borderRadius: 2, overflow: 'hidden', maxWidth: 360 }}>
                    <div style={{ height: '100%', width: '40%', background: T.live, borderRadius: 2, animation: 's2v-rail 1.6s ease-in-out infinite alternate' }} />
                  </div>
                ) : null}
                {running && f.stage_note ? <div style={{ color: T.live, fontSize: 12, marginTop: 5 }}>{f.stage_note}</div> : null}
              </div>
              {f.final_video_url ? <Play size={16} color={T.muted} /> : <Clapperboard size={16} color={T.dim} />}
            </button>
          );
        })}

        {legacy.length ? (
          <div style={{ color: T.dim, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', margin: '22px 0 4px 10px' }}>Legacy projects</div>
        ) : null}
        {legacy.map((l) => (
          <button key={`legacy-${l.id}`} className="s2v-row" onClick={() => onOpenLegacy(l)} style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${T.raised}`, padding: '14px 10px', cursor: 'pointer' }}>
            <div style={{ width: 104, height: 58, background: T.raised, borderRadius: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.title || 'Legacy video'}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '2px 7px' }}>Legacy</span>
                <span style={{ color: l.final_url ? T.done : T.muted, fontSize: 12.5 }}>{l.final_url ? 'Ready' : 'No stored video'}</span>
              </div>
            </div>
            {l.final_url ? <Play size={16} color={T.muted} /> : <Clapperboard size={16} color={T.dim} />}
          </button>
        ))}
      </div>
      <style>{`@keyframes s2v-rail { from { transform: translateX(-30%); } to { transform: translateX(240%); } }`}</style>
    </div>
  );
}
