/**
 * Library — films from the rebuilt pipeline, plus read-only access to legacy
 * projects from the retired s2v-run pipeline (their finished MP4s stay
 * watchable; nothing new is ever written to the old tables).
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Archive, ArchiveRestore, Clapperboard, MoreVertical, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Film, T } from './api';
import VergeLoader from '../../components/VergeLoader';

export interface LegacyFilm { id: number; title: string; final_url: string | null; created_at: string }

const ACTIVE = ['planning', 'producing', 'assembling'];

/**
 * DEDUPLICATION (bug D3).
 *
 * A film could appear twice in this list. An interrupted create, a recovery
 * sweep that re-seeded a row, or a create whose insert reply was misread all
 * leave a second row with the same title and the same shape, and the Library
 * showed both — so the customer could not tell which one was their film.
 *
 * One row per film now. Rows are folded on their identity (the title and the
 * aspect they were made at, which is what a duplicate shares), and the row
 * kept is the one that actually got furthest: a finished film beats a running
 * one, a running one beats a draft, and a tie goes to the newest. Nothing is
 * deleted — the other rows are still there, just not shown twice.
 */
function filmIdentity(f: Film): string {
  const title = String(f.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // A film with no title yet is only ever itself: folding untitled drafts
  // together would hide real work.
  if (!title) return `id:${f.id}`;
  return `${title}|${String(f.aspect_ratio || '16:9')}`;
}

/** How far a row got, so the best one survives the fold. */
function filmRank(f: Film): number {
  if (f.final_video_url) return 3;
  if (ACTIVE.includes(String(f.status))) return 2;
  if (Array.isArray(f.plan?.scenes) && f.plan!.scenes.length) return 1;
  return 0;
}

function dedupeFilms(films: Film[]): Film[] {
  const best = new Map<string, Film>();
  for (const f of films) {
    const key = filmIdentity(f);
    const held = best.get(key);
    if (!held) { best.set(key, f); continue; }
    const better = filmRank(f) > filmRank(held)
      || (filmRank(f) === filmRank(held) && Date.parse(String(f.created_at || '')) > Date.parse(String(held.created_at || '')));
    if (better) best.set(key, f);
  }
  // The incoming order is already newest-first; keep it.
  const kept = new Set(Array.from(best.values()).map((f) => f.id));
  return films.filter((f) => kept.has(f.id));
}

const menuItemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 7, color: T.bone,
  fontSize: 13, fontWeight: 500, padding: '9px 11px', cursor: 'pointer',
};

function StatusWord({ f }: { f: Film }) {
  const map: Record<string, { word: string; color: string; bg: string }> = {
    draft: { word: 'Draft', color: T.muted, bg: 'rgba(180,120,0,0.10)' },
    planning: { word: 'Planning', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    plan_ready: { word: 'Plan ready', color: T.bone, bg: 'rgba(180,120,0,0.10)' },
    producing: { word: 'Producing', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    assembling: { word: 'Assembling', color: T.live, bg: 'rgba(232,163,60,0.12)' },
    ready: { word: 'Ready', color: T.done, bg: 'rgba(22,101,52,0.12)' },
    error: { word: 'Needs attention', color: T.fault, bg: 'rgba(153,27,27,0.12)' },
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
  onArchive: (f: Film, archived: boolean) => void;
  onDelete: (f: Film) => void;
}) {
  const { loading, onNew, onOpen, onOpenLegacy, onQuickCreate, onArchive, onDelete } = props;
  const [showArchived, setShowArchived] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const films = Array.isArray(props.films) ? props.films : [];
  const legacy = Array.isArray(props.legacy) ? props.legacy : [];
  const activeFilms = dedupeFilms(films.filter((f) => !f.is_archived));
  const archivedFilms = dedupeFilms(films.filter((f) => f.is_archived));
  const source = showArchived ? archivedFilms : activeFilms;
  const ordered = [...source.filter((f) => ACTIVE.includes(String(f.status))), ...source.filter((f) => !ACTIVE.includes(String(f.status)))];
  const empty = !loading && !films.length && !legacy.length;
  const confirmFilm = confirmId != null ? films.find((f) => f.id === confirmId) || null : null;

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
            style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, color: T.bone, fontSize: 14.5, lineHeight: 1.5, padding: '16px 18px', outline: 'none', fontFamily: T.sans, resize: 'vertical', boxShadow: '0 12px 40px rgba(120,80,0,0.12)' }}
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: T.bone, fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Your films</div>
          {ordered.length ? <div style={{ color: T.dim, fontSize: 12, marginTop: 3 }}>{ordered.length} {ordered.length === 1 ? 'film' : 'films'}{!showArchived && legacy.length ? ` · ${legacy.length} legacy` : ''}</div> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {(archivedFilms.length > 0 || showArchived) ? (
            <div style={{ display: 'inline-flex', background: T.raised, borderRadius: 10, padding: 3, gap: 2 }}>
              {([['active', 'Active', activeFilms.length], ['archived', 'Archived', archivedFilms.length]] as const).map(([key, label, count]) => {
                const on = (key === 'archived') === showArchived;
                return (
                  <button key={key} onClick={() => { setShowArchived(key === 'archived'); setMenuId(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: on ? T.bone : 'transparent', color: on ? T.canvas : T.muted, border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    {label}<span style={{ opacity: 0.7, fontFamily: T.mono, fontSize: 11 }}>{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <button className="s2v-lift" onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bone, color: T.canvas, border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(120,80,0,0.12)' }}>
            <Plus size={15} /> New film
          </button>
        </div>
      </div>

      {loading && !ordered.length ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <VergeLoader size={120} caption="Loading your films" />
        </div>
      ) : null}

      <div>
        {!loading && !ordered.length ? (
          <div style={{ color: T.dim, fontSize: 13, padding: '22px 10px', lineHeight: 1.6 }}>
            {showArchived ? 'No archived films yet. Open a film’s ⋯ menu and choose Archive to tuck it away here.' : 'No active films.'}
          </div>
        ) : null}
        {ordered.map((f) => {
          const running = ACTIVE.includes(String(f.status));
          const sceneCount = Array.isArray(f.plan?.scenes) ? f.plan!.scenes.length : 0;
          const archived = Boolean(f.is_archived);
          return (
            <div key={f.id} className="s2v-row" style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', borderBottom: `1px solid ${T.raised}`, padding: '14px 10px', position: 'relative' }}>
              <button onClick={() => onOpen(f)} style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                {/* A finished film shows a real frame. The stored thumbnail is
                    preferred; without one the master's own first second is the
                    poster, which is why a finished row is never a blank tile. */}
                <div style={{ width: 104, height: 58, background: T.raised, borderRadius: 6, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(180,120,0,0.14)' }}>
                  {f.final_thumb_url ? (
                    <img src={f.final_thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : f.final_video_url ? (
                    <video
                      src={`${String(f.final_video_url)}#t=0.5`}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: T.bone, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title || 'Untitled film'}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                    <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '2px 7px' }}>{f.aspect_ratio || '16:9'}</span>
                    <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>{sceneCount ? `${sceneCount} scenes` : 'Scenes pending'}</span>
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
              </button>
              {f.final_video_url ? <Play size={16} color={T.muted} /> : <Clapperboard size={16} color={T.dim} />}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  aria-label="Film options"
                  className="s2v-ghost"
                  onClick={() => setMenuId(menuId === f.id ? null : f.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'transparent', border: `1px solid ${T.dim}`, borderRadius: 8, color: T.muted, cursor: 'pointer' }}
                >
                  <MoreVertical size={15} />
                </button>
                {menuId === f.id ? (
                  <>
                    <div onClick={() => setMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41, minWidth: 178, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(120,80,0,0.14)', padding: 5 }}>
                      <button className="s2v-menu-item" onClick={() => { setMenuId(null); onArchive(f, !archived); }} style={menuItemStyle}>
                        {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        {archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <button className="s2v-menu-item" onClick={() => { setMenuId(null); setConfirmId(f.id); }} style={{ ...menuItemStyle, color: T.fault }}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}

        {!showArchived && legacy.length ? (
          <div style={{ color: T.dim, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', margin: '22px 0 4px 10px' }}>Legacy projects</div>
        ) : null}
        {(showArchived ? [] : legacy).map((l) => (
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
      {confirmFilm ? (
        <div onClick={() => setConfirmId(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 16, padding: '24px 24px 20px', boxShadow: '0 30px 70px rgba(120,80,0,0.14)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(153,27,27,0.12)', border: '1px solid rgba(153,27,27,0.24)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Trash2 size={18} color={T.fault} />
              </div>
              <div style={{ color: T.bone, fontSize: 16, fontWeight: 700, letterSpacing: -0.2 }}>Delete this film?</div>
            </div>
            <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              “{confirmFilm.title || 'Untitled film'}” and its generated clips will be permanently removed. This can’t be undone — to hide it instead, use Archive.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="s2v-ghost" onClick={() => setConfirmId(null)} style={{ background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button className="s2v-lift" onClick={() => { const f = confirmFilm; setConfirmId(null); onDelete(f); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.fault, color: '#FFFFFF', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <style>{`@keyframes s2v-rail { from { transform: translateX(-30%); } to { transform: translateX(240%); } } .s2v-menu-item:hover { background: ${T.raised} !important; }`}</style>
    </div>
  );
}
