/**
 * Screen 5 — The run (hero screen). Six fixed stage rows, a live frame,
 * a pulsing dot, a counting clock, an advancing bar, a filling shot strip and
 * a self-rewriting status line. Nothing on this screen is ever still (§9.1).
 * Elapsed counts up, scenes-remaining counts down — never a ceiling, never a
 * countdown to a cutoff that does not exist.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Play } from 'lucide-react';
import { CharacterRow, Project, SceneRow, AgentEvent, T, fmtClock } from './api';

function isFrameDiagnostic(message: unknown): boolean {
  return /platform ffmpeg|video\/frames|browser fallback|browser frame|tail[- ]frame|frame extraction|frame extractor|hard stop.*frame/i.test(String(message || ''));
}

function customerEventMessage(message: string): string {
  if (/scene reference/i.test(message)) return 'Shot checked using scene reference. Tap to review.';
  if (isFrameDiagnostic(message)) return "We couldn't check this shot yet. Retrying…";
  return message;
}

function sceneColor(s: SceneRow): string {
  if (['passed', 'auto_fixed'].includes(s.status)) return T.done;
  if (['unchecked', 'rendering', 'judging', 'prepping'].includes(s.status)) return T.live;
  if (['needs_attention', 'failed'].includes(s.status)) return T.fault;
  if (s.status === 'cut') return 'transparent';
  return T.dim;
}

export default function RenderRoom(props: {
  project: Project;
  scenes: SceneRow[];
  characters: CharacterRow[];
  events: AgentEvent[];
  onRecast: (charKey: string, appearance: string) => Promise<void>;
  onResume: () => void;
  onReview: () => void;
}) {
  const { project: p, onRecast, onResume, onReview } = props;
  // The live run screen reads server state that can arrive partially: treat
  // every list as possibly missing so a slow status call shows the empty run
  // room instead of taking the app down.
  const scenes = Array.isArray(props.scenes) ? props.scenes.filter(Boolean) : [];
  const characters = Array.isArray(props.characters) ? props.characters.filter(Boolean) : [];
  const events = Array.isArray(props.events) ? props.events.filter(Boolean) : [];
  const [nowMs, setNowMs] = useState(Date.now());
  const [recastKey, setRecastKey] = useState<string | null>(null);
  const [recastText, setRecastText] = useState('');
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = p.render_started_at ? nowMs - new Date(p.render_started_at).getTime() : 0;
  const doneScenes = scenes.filter((s) => ['passed', 'auto_fixed', 'unchecked', 'needs_attention', 'failed', 'cut'].includes(s.status));
  const activeScene = scenes.find((s) => ['rendering', 'judging', 'prepping'].includes(s.status));
  const liveFrame = useMemo(() => {
    const withFrames = [...scenes].filter((s) => s.last_frame_url || s.open_image_url || s.first_frame_url).sort((a, b) => b.idx - a.idx);
    const c = characters.find((ch) => ch.ref_image_url);
    return withFrames[0]?.last_frame_url || withFrames[0]?.open_image_url || withFrames[0]?.first_frame_url || c?.ref_image_url || null;
  }, [scenes, characters]);

  const castDone = characters.length === 0 || characters.every((c) => c.status === 'ready');
  const castBlocked = characters.filter((c) => c.status === 'blocked');
  const filmingDone = scenes.length > 0 && doneScenes.length === scenes.length;
  const layers = p.layers && typeof p.layers === 'object' && !Array.isArray(p.layers) ? p.layers : {};
  const stalled = p.status === 'stalled';
  const rawStatus = stalled ? p.error || 'No progress for a while.' : p.stage_note || '…';
  const statusMessage = isFrameDiagnostic(rawStatus) ? "We couldn't check this shot yet. Retrying…" : rawStatus;
  const recentEvents = events.slice(-12).map((event) => ({ ...event, customerMessage: customerEventMessage(event.message) }));
  const displayEvents = recentEvents.filter((event, index) => index === 0 || event.customerMessage !== recentEvents[index - 1].customerMessage).slice(-6);
  const technicalEvents = events.filter((event) => isFrameDiagnostic(event.message));

  const stageRows = [
    {
      key: 'script', label: 'Shot plan locked', state: 'done',
      note: `${p.scene_count || scenes.length} dynamic shots from your ${p.input_shape === 'url' ? 'link' : p.input_shape || 'brief'} · max 8s each`,
    },
    {
      key: 'cast', label: 'Cast locked',
      state: castDone ? 'done' : p.status === 'casting' ? 'live' : 'dim',
      note: characters.length ? `${characters.filter((c) => c.status === 'ready').length} of ${characters.length} characters saved to your library` : 'no recurring characters needed',
    },
    {
      key: 'film', label: 'Chaining shots',
      state: filmingDone ? 'done' : ['rendering'].includes(p.status) ? 'live' : 'dim',
      note: filmingDone ? `${scenes.length} shots · every ending analyzed` : activeScene ? `shot ${activeScene.idx} of ${scenes.length} · extracting and analyzing its ending` : `${doneScenes.length} of ${scenes.length || '…'} done`,
    },
    {
      key: 'text', label: 'Text and graphics',
      state: layers.graphics && layers.graphics !== 'off' ? (layers.state === 'applied' ? 'done' : 'live') : 'optional',
      note: layers.graphics && layers.graphics !== 'off' ? 'end card on' : 'optional · off',
    },
    {
      key: 'music', label: 'Music and effects',
      state: layers.music && layers.music !== 'off' ? (layers.state === 'applied' ? 'done' : 'live') : 'optional',
      note: layers.music === 'keep' ? 'keeping the film’s own sound' : layers.music === 'score' ? 'scored' : 'optional · off',
    },
    {
      key: 'assemble', label: 'Make it together',
      state: p.status === 'ready' ? 'done' : p.status === 'assembling' || p.status === 'post' ? 'live' : 'dim',
      note: p.status === 'ready' ? 'joins checked' : 'joins checked before you see it',
    },
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 150px' }}>
      {/* Full-bleed media */}
      <div style={{ position: 'relative', width: '100%', height: 300, background: '#0C0C0F', overflow: 'hidden' }}>
        {liveFrame ? (
          <img src={liveFrame} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.92 }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.dim, fontSize: 13 }}>
            The first frames will appear here.
          </div>
        )}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '14px 18px', background: 'linear-gradient(rgba(12,12,15,0.75), transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: stalled ? T.fault : T.live, animation: stalled ? 'none' : 's2v-pulse 1.4s ease-in-out infinite' }} />
            <span style={{ color: T.bone, fontSize: 12.5, fontFamily: T.mono }}>
              {activeScene ? `shot ${activeScene.idx} of ${scenes.length}` : `${doneScenes.length} of ${scenes.length} shots`}
            </span>
          </div>
          <span style={{ color: T.bone, fontSize: 12.5, fontFamily: T.mono }}>{fmtClock(elapsed)}</span>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ height: '100%', width: `${scenes.length ? Math.round((doneScenes.length / scenes.length) * 100) : 4}%`, background: T.live, transition: 'width 0.8s ease' }} />
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '22px 24px 0' }}>
        <div style={{ color: T.bone, fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>
          {p.status === 'ready' ? 'Your video is ready' : stalled ? 'The run stalled' : 'Making your video'}
        </div>
        <div style={{ color: stalled ? T.fault : T.live, fontSize: 13.5, marginTop: 5, minHeight: 20 }}>
          {statusMessage}
        </div>
        {scenes.length > 12 ? (
          <div style={{ color: T.muted, fontSize: 12.5, marginTop: 4 }}>
            This plan needs {scenes.length} shots to preserve the story and joins. We’ll keep going even if you close this tab.
          </div>
        ) : null}

        {/* Shot strip */}
        {scenes.length ? (
          <div style={{ display: 'flex', gap: 3, marginTop: 16, flexWrap: 'wrap' }}>
            {scenes.map((s) => (
              <div key={s.idx} title={`Shot ${s.idx} · source ${s.source_scene_id || '?'} · ${s.status}${s.last_frame_url ? ' · last frame stored' : ''}${s.end_state ? ' · ending analyzed' : ''}`} style={{ width: Math.max(10, Math.min(26, Math.floor(500 / scenes.length))), height: 7, borderRadius: 2, background: sceneColor(s), border: s.status === 'cut' ? `1px dashed ${T.dim}` : 'none', transition: 'background 0.5s' }} />
            ))}
          </div>
        ) : null}

        {/* Stage list */}
        <div style={{ marginTop: 26 }}>
          {stageRows.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '11px 0' }}>
              <div style={{ width: 20, display: 'flex', justifyContent: 'center', paddingTop: 1 }}>
                {r.state === 'done' ? <Check size={15} color={T.done} /> :
                 r.state === 'live' ? <Loader2 size={15} color={T.live} className="animate-spin" /> :
                 <span style={{ width: 9, height: 9, borderRadius: 99, border: `1.5px solid ${T.dim}`, marginTop: 3 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ color: r.state === 'dim' || r.state === 'optional' ? T.dim : T.bone, fontSize: 14, fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: r.state === 'live' ? T.live : T.muted, fontSize: 12.5, marginLeft: 12 }}>{r.note}</span>
                {r.key === 'film' && r.state === 'live' ? (
                  <div style={{ marginTop: 7, height: 3, background: T.raised, borderRadius: 2, overflow: 'hidden', maxWidth: 300 }}>
                    <div style={{ height: '100%', width: '45%', background: T.live, animation: 's2v-rail 1.8s ease-in-out infinite alternate' }} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* Blocked characters — the one failure that waits for the user */}
        {castBlocked.map((c) => (
          <div key={c.id} style={{ background: 'rgba(226,114,111,0.09)', border: '1px solid rgba(226,114,111,0.4)', borderRadius: 12, padding: 16, marginTop: 14 }}>
            <div style={{ color: T.fault, fontSize: 13.5, fontWeight: 600 }}>{c.name} is blocked by the likeness guard</div>
            <div style={{ color: T.muted, fontSize: 12.5, marginTop: 4 }}>{c.blocked_reason}</div>
            {recastKey === c.char_key ? (
              <div style={{ marginTop: 10 }}>
                <textarea value={recastText} onChange={(e) => setRecastText(e.target.value)} rows={2} placeholder={`Describe ${c.name} differently…`} style={{ width: '100%', background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13, padding: 10, outline: 'none' }} />
                <button onClick={async () => { await onRecast(c.char_key, recastText); setRecastKey(null); setRecastText(''); }} style={{ marginTop: 8, background: T.bone, color: T.canvas, border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Recast and continue</button>
              </div>
            ) : (
              <button onClick={() => { setRecastKey(c.char_key); setRecastText(c.appearance || ''); }} style={{ marginTop: 10, background: T.raised, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, cursor: 'pointer' }}>Re-describe {c.name}</button>
            )}
          </div>
        ))}

        {/* Failure / repair feed — visible but calm */}
        <div style={{ marginTop: 22 }}>
          {displayEvents.map((e) => (
            <div key={e.id} style={{ color: e.level === 'error' ? T.fault : e.level === 'warn' ? T.live : T.muted, fontSize: 12, lineHeight: 1.7, fontFamily: T.mono }}>
              {e.customerMessage}
            </div>
          ))}
        </div>

        {technicalEvents.length || (p.error && isFrameDiagnostic(p.error)) ? (
          <details style={{ marginTop: 14, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '9px 11px' }}>
            <summary style={{ color: T.muted, fontSize: 12, cursor: 'pointer' }}>Details</summary>
            <div style={{ marginTop: 8, color: T.dim, fontSize: 11, lineHeight: 1.6, fontFamily: T.mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {p.error && isFrameDiagnostic(p.error) ? <div>{p.error}</div> : null}
              {technicalEvents.slice(-12).map((event) => <div key={event.id}>{event.message}</div>)}
            </div>
          </details>
        ) : null}

        {stalled ? (
          <button className="s2v-lift" onClick={onResume} style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 20, background: T.live, color: '#1A1205', border: 'none', borderRadius: 11, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 12px rgba(232,163,60,0.25)' }}>
            <Play size={15} /> Resume from the first missing scene
          </button>
        ) : null}

        {p.status === 'review' || (filmingDone && p.status === 'rendering') ? (
          <button className="s2v-lift" onClick={onReview} style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 20, background: T.bone, color: T.canvas, border: 'none', borderRadius: 11, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
            Review the scenes
          </button>
        ) : null}

        <div style={{ color: T.dim, fontSize: 12, marginTop: 26 }}>
          Leaving is safe. Rendering continues on our side — we’ll notify you when it’s done.
        </div>
      </div>
      <style>{`
        @keyframes s2v-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.8); } }
        @keyframes s2v-rail { from { transform: translateX(-30%); } to { transform: translateX(240%); } }
        @media (prefers-reduced-motion: reduce) { [style*='s2v-pulse'], [style*='s2v-rail'] { animation: none !important; } }
      `}</style>
    </div>
  );
}
