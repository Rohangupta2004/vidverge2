/**
 * Screens 6 + 7 — Review (the continuity-driven shot timeline with source
 * mapping, prompts, last frames, end states, join QA and chain regeneration)
 * and Finish (player + voiceover/caption/end-card layers + export).
 * Spoken films automatically receive their exact recorded voiceover and matching
 * captions; music and optional end-card controls remain user choices.
 */
import { useMemo, useState } from 'react';
import { Check, Download, Layers, Loader2, Music, RefreshCw, Scissors, Type } from 'lucide-react';
import { generateMusic, Project, SceneRow, T, verdictBadge } from './api';

/** Scene lists and the layers/metrics JSON blobs are read defensively: this is
 *  the surface a customer opens to watch a finished video, and a half-loaded
 *  project must render an empty state rather than take the screen down. */
function sceneList(scenes: SceneRow[] | undefined | null): SceneRow[] {
  return Array.isArray(scenes) ? scenes.filter(Boolean) : [];
}
function blob(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

// ---------------------------------------------------------------------------
// Screen 6 — Review
// ---------------------------------------------------------------------------

export function ReviewScreen(props: {
  project: Project;
  scenes: SceneRow[];
  busy: boolean;
  onRegen: (idxs: number[], note?: string) => Promise<void>;
  onCut: (idxs: number[]) => Promise<void>;
  onAssemble: () => Promise<void>;
}) {
  const { project: p, busy, onRegen, onCut, onAssemble } = props;
  const scenes = sceneList(props.scenes);
  const [selected, setSelected] = useState<number[]>([]);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const ordered = useMemo(() => [...scenes].sort((a, b) => a.idx - b.idx), [scenes]);
  const assembling = p.status === 'assembling';
  const anyInFlight = scenes.some((s) => ['rendering', 'judging', 'prepping'].includes(s.status));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 190px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ color: T.bone, fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>Review · {p.title}</div>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.55, marginTop: 5 }}>
          Every shot in order. Each ending becomes the next shot’s start; regenerating one shot rebuilds everything after it.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
          {ordered.map((s) => {
            const b = verdictBadge(s);
            const sel = selected.includes(s.idx);
            const spec = s.spec || {};
            return (
              <div key={s.idx} style={{ display: 'flex', gap: 16, background: T.raised, borderRadius: 14, padding: 16, border: sel ? `1px solid ${T.live}` : '1px solid rgba(255,255,255,0.05)', boxShadow: sel ? '0 0 0 1px rgba(232,163,60,0.3)' : 'none', transition: 'border-color 0.18s ease, box-shadow 0.18s ease' }}>
                <div style={{ width: 130, flexShrink: 0 }}>
                  {s.clip_url && playing === s.idx ? (
                    <video src={s.clip_url} controls autoPlay style={{ width: '100%', borderRadius: 8, background: '#000' }} />
                  ) : (
                    <button onClick={() => s.clip_url && setPlaying(s.idx)} style={{ position: 'relative', width: '100%', aspectRatio: p.aspect_ratio === '16:9' ? '16/9' : p.aspect_ratio === '1:1' ? '1/1' : '9/16', maxHeight: 190, background: '#0C0C0F', border: 'none', borderRadius: 8, overflow: 'hidden', cursor: s.clip_url ? 'pointer' : 'default' }}>
                      {s.last_frame_url || s.first_frame_url || s.open_image_url ? (
                        <img src={(s.last_frame_url || s.first_frame_url || s.open_image_url)!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
                      ) : (
                        <span style={{ color: T.dim, fontSize: 11 }}>{s.status === 'rendering' ? 'filming…' : s.status}</span>
                      )}
                      {s.clip_url ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 26, textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}>▶</span> : null}
                    </button>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 12 }}>Shot {s.idx}</span>
                    <span style={{ color: T.muted, fontSize: 11 }}>source {s.source_scene_id || String(spec.source_scene_id || spec.source_scene || s.idx)}</span>
                    {s.shot_kind === 'bridge' || spec.shot_kind === 'bridge' ? <span style={{ color: T.live, fontSize: 11, border: `1px solid ${T.live}`, borderRadius: 5, padding: '1px 6px' }}>bridge</span> : null}
                    <span style={{ color: b.color, fontSize: 11.5, fontWeight: 600, border: `1px solid ${b.color}`, borderRadius: 999, padding: '2px 9px' }}>{b.word}</span>
                    {s.alternate_render ? <span style={{ color: T.muted, fontSize: 11, border: `1px solid ${T.dim}`, borderRadius: 5, padding: '1px 6px' }}>alternate render</span> : null}
                    <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: T.muted, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={sel} onChange={() => setSelected(sel ? selected.filter((x) => x !== s.idx) : [...selected, s.idx])} /> select
                    </label>
                  </div>
                  <div style={{ color: T.bone, fontSize: 12.5, lineHeight: 1.5, marginTop: 6 }}>{String(spec.action || '').slice(0, 220)}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 7, color: T.muted, fontSize: 11.5 }}>
                    <span>{Math.min(8, Number(s.duration_s) || 8)}s</span>
                    <span>· {s.model || p.video_model || 'model pending'}</span>
                    <span style={{ color: s.last_frame_url ? T.done : T.fault }}>· {s.last_frame_url ? 'last frame stored' : 'last frame missing'}</span>
                    <span style={{ color: s.end_state ? T.done : T.fault }}>· {s.end_state ? 'end state stored' : 'end state missing'}</span>
                    {s.continuity_check ? <span style={{ color: s.continuity_check.pass === false ? T.fault : T.done }}>· join {s.continuity_check.pass === false ? 'flagged' : 'checked'}</span> : null}
                  </div>
                  {s.render_prompt ? (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ color: T.muted, fontSize: 11.5, cursor: 'pointer' }}>Generation prompt</summary>
                      <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, marginTop: 5, whiteSpace: 'pre-wrap' }}>{s.render_prompt}</div>
                    </details>
                  ) : null}
                  {s.end_state ? (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ color: T.muted, fontSize: 11.5, cursor: 'pointer' }}>Ending state JSON</summary>
                      <pre style={{ color: T.muted, fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '5px 0 0' }}>{JSON.stringify(s.end_state, null, 2)}</pre>
                    </details>
                  ) : null}
                  <div style={{ color: b.color === T.done ? T.muted : b.color, fontSize: 12, marginTop: 6 }}>{b.reason}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    <button disabled={busy || anyInFlight} onClick={() => onRegen([s.idx])} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      <RefreshCw size={12} /> Regenerate from here
                    </button>
                    <button disabled={busy} onClick={() => { setNoteFor(noteFor === s.idx ? null : s.idx); setNote(''); }} style={{ background: 'transparent', color: T.muted, border: `1px solid ${T.raised}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      …with a note
                    </button>
                    <button disabled={busy} onClick={() => onCut([s.idx])} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: T.muted, border: `1px solid ${T.raised}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      <Scissors size={12} /> Cut
                    </button>
                  </div>
                  {noteFor === s.idx ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "make her turn left instead"' style={{ flex: 1, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 7, color: T.bone, fontSize: 12.5, padding: '8px 12px', outline: 'none' }} />
                      <button disabled={busy || !note.trim()} onClick={async () => { await onRegen([s.idx], note.trim()); setNoteFor(null); }} style={{ background: T.bone, color: T.canvas, border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Go</button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed primary action */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 24px', background: 'linear-gradient(transparent, rgba(19,19,22,0.96) 40%)' }}>
        {selected.length > 1 ? (
          <button disabled={busy || anyInFlight} onClick={() => onRegen(selected)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.raised, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9, padding: '10px 20px', fontSize: 13, cursor: 'pointer' }}>
            <RefreshCw size={13} /> Rebuild chain from earliest selected shot
          </button>
        ) : null}
        <button className="s2v-lift" disabled={busy || assembling || anyInFlight} onClick={onAssemble} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.live, color: '#1A1205', border: 'none', borderRadius: 11, padding: '14px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: assembling || anyInFlight ? 0.6 : 1, boxShadow: '0 4px 18px rgba(232,163,60,0.3)' }}>
          {assembling ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
          {assembling ? 'Checking the joins…' : anyInFlight ? 'Shots still filming…' : 'Assemble video'}
        </button>
        {assembling ? <div style={{ color: T.muted, fontSize: 12 }}>Stitching the clips and checking every join reads continuously — not just concatenated.</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 7 — Finish
// ---------------------------------------------------------------------------

export function FinishScreen(props: {
  project: Project;
  scenes: SceneRow[];
  busy: boolean;
  onApplyLayers: (layers: Record<string, unknown>) => Promise<void>;
  onBackToReview: () => void;
}) {
  const { project: p, busy, onApplyLayers, onBackToReview } = props;
  const scenes = sceneList(props.scenes);
  const layers = blob(p.layers);
  const metrics = blob(p.metrics);
  const wide = p.aspect_ratio === '16:9';
  const [captions, setCaptions] = useState<string>(layers.captions || 'off');
  const [graphics, setGraphics] = useState<string>(layers.graphics || 'off');
  const [music, setMusic] = useState<string>(layers.music || 'off');
  const [musicPrompt, setMusicPrompt] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState(false);
  const applying = p.status === 'post' || layers.state === 'rendering' || layers.state === 'pending';
  const videoUrl = p.final_url || p.assembled_url;
  const playable = scenes.filter((s) => s.status !== 'cut' && s.clip_url);
  const totalSec = playable.reduce((a, s) => a + Math.min(8, s.duration_s || 8), 0);

  async function apply() {
    setErr('');
    setWorking(true);
    try {
      let musicUrl: string | undefined;
      if (music === 'score') {
        musicUrl = await generateMusic(musicPrompt.trim() || `motivational cinematic instrumental bed for a ${p.mode === 'short' ? 'social video' : 'film'}, builds gently, no vocals`, Math.max(10000, totalSec * 1000));
      }
      await onApplyLayers({ captions, graphics, music, music_url: musicUrl });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setWorking(false);
    }
  }

  const dirty = captions !== (layers.captions || 'off') || graphics !== (layers.graphics || 'off') || music !== (layers.music || 'off');

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 150px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: T.bone, fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>{p.title}</div>
          <button className="s2v-ghost" onClick={onBackToReview} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: '5px 9px', borderRadius: 7 }}>Back to scenes</button>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', background: '#0C0C0F', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 20px 50px rgba(0,0,0,0.4)' }}>
          {videoUrl ? (
            <video key={videoUrl} src={videoUrl} controls style={{ maxWidth: '100%', maxHeight: 460, background: '#000' }} />
          ) : (
            <div style={{ color: T.dim, fontSize: 13, padding: 60 }}>Assemble the video first — your finished film plays here.</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
          <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>{totalSec}s · {p.aspect_ratio} · {playable.length} shots</span>
          {metrics.join_note ? <span style={{ color: T.live, fontSize: 12 }}>One join was flagged: {metrics.join_note}</span> : null}
        </div>

        <div style={{ marginTop: 26 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>Finishing layers</div>
          <div style={{ color: T.muted, fontSize: 12.5, marginBottom: 14 }}>
            Spoken words are recorded once from your script and mixed automatically; captions use those same words. Music and end-card graphics remain optional.{!wide ? ' Vertical finishing uses the same recorded voice track; graphics and scoring remain limited by the current portrait renderer.' : ''}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <LayerRow icon={<Type size={14} />} label="Captions" enabled={wide}>
              {['off', 'clean'].map((v) => (
                <Choice key={v} on={captions === v} label={v === 'off' ? 'Off' : 'Clean'} onClick={() => setCaptions(v)} disabled={!wide} />
              ))}
              <span style={{ color: T.dim, fontSize: 11.5 }}>built from your script’s own lines, so they’re accurate</span>
            </LayerRow>
            <LayerRow icon={<Layers size={14} />} label="Graphics" enabled={wide}>
              {['off', 'endcard'].map((v) => (
                <Choice key={v} on={graphics === v} label={v === 'off' ? 'Off' : 'End card'} onClick={() => setGraphics(v)} disabled={!wide} />
              ))}
              {p.ad_mode ? <span style={{ color: T.dim, fontSize: 11.5 }}>optional for ads too — off unless you turn it on</span> : null}
            </LayerRow>
            <LayerRow icon={<Music size={14} />} label="Music" enabled>
              <Choice on={music === 'off'} label="Off" onClick={() => setMusic('off')} />
              <Choice on={music === 'keep'} label="Keep the film’s own sound" onClick={() => setMusic('keep')} />
              <Choice on={music === 'score'} label="Score it" onClick={() => setMusic('score')} disabled={!wide} />
            </LayerRow>
            {music === 'score' ? (
              <input value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)} placeholder="describe the score — e.g. warm piano that builds, 100 BPM" style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 12.5, padding: '9px 12px', outline: 'none' }} />
            ) : null}
            {music === 'score' ? (
              <div style={{ color: T.dim, fontSize: 11.5 }}>
                The recorded script voice stays primary. Source clips are reduced to room tone, and any new score ducks beneath the voice automatically.
              </div>
            ) : null}
          </div>

          {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}
          {layers.state === 'failed' && layers.error ? <div style={{ color: T.live, fontSize: 12.5, marginTop: 14 }}>Last finishing pass failed ({layers.error}) — the original cut was kept.</div> : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 22, alignItems: 'center', flexWrap: 'wrap' }}>
            {dirty ? (
              <button className="s2v-lift" disabled={busy || working || applying} onClick={apply} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bone, color: T.canvas, border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
                {working || applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {working ? 'Preparing…' : applying ? 'Rendering layers…' : 'Apply layers'}
              </button>
            ) : null}
            {videoUrl ? (
              <a className="s2v-lift" href={videoUrl} download target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.live, color: '#1A1205', borderRadius: 10, padding: '12px 26px', fontSize: 14, fontWeight: 700, textDecoration: 'none', boxShadow: '0 2px 12px rgba(232,163,60,0.25)', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}>
                <Download size={15} /> Download MP4
              </a>
            ) : null}
            {applying ? <span style={{ color: T.live, fontSize: 12.5 }}>Each layer re-renders only itself — your film stays untouched underneath.</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerRow(props: { icon: any; label: string; enabled?: boolean; children: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: props.enabled === false ? 0.45 : 1 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.bone, fontSize: 13, fontWeight: 600, width: 110 }}>
        {props.icon} {props.label}
      </span>
      {props.children}
    </div>
  );
}

function Choice(props: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        background: props.on ? 'rgba(232,163,60,0.14)' : 'transparent', color: props.on ? T.live : props.disabled ? T.dim : T.muted,
        border: `1px solid ${props.on ? T.live : T.dim}`, borderRadius: 999, padding: '5px 13px', fontSize: 12, cursor: props.disabled ? 'default' : 'pointer',
      }}
    >
      {props.label}
    </button>
  );
}
