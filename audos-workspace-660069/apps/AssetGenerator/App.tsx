/**
 * Asset Generator — standalone mini-app for manual scene-asset generation.
 * Ships pre-loaded with the Netflix vs Blockbuster 6-scene storyboard; each
 * scene carries a DETAILED art-directed image brief (subject, composition,
 * lighting, mood — not just the voiceover line).
 *
 * HYPERFRAMES + OMNI FLASH GENERATION (fixed 17 Sep 2026): all generation
 * goes through the asset-image-gen server function, which calls Gemini Omni
 * Flash's image model (gemini-3.1-flash-image) via the schema-validated
 * /api/veo/generate/image proxy — wallet-billed, durable GCS URLs, no
 * founder-owned API keys. No BYOK, no secrets proxy, no direct provider
 * calls from the browser, and no GPT Image / DALL-E fallback.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, ImageIcon, Loader2, Play, RefreshCw, Sparkles, X } from 'lucide-react';

const T = {
  canvas: '#121214',
  raised: '#1B1B1F',
  raisedHover: '#212127',
  line: '#2A2A30',
  lineStrong: '#3A3A42',
  bone: '#F4F2EE',
  muted: '#8D8B94',
  dim: '#55535C',
  coral: '#FF6B4A',
  coralHover: '#FF7E61',
  done: '#7FD4B4',
  fault: '#E2726F',
  gold: '#E8A33C',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;

const CSS = `
  .ag-root * { box-sizing: border-box; }
  .ag-root button { transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
  .ag-root button:focus-visible, .ag-root a:focus-visible, .ag-root [role="button"]:focus-visible { outline: 2px solid ${T.coral}; outline-offset: 2px; border-radius: 10px; }
  .ag-primary-btn:hover:not(:disabled) { background: ${T.coralHover} !important; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255,107,74,0.35); }
  .ag-primary-btn:active:not(:disabled) { transform: translateY(0); box-shadow: 0 2px 8px rgba(255,107,74,0.25); }
  .ag-ghost-btn:hover:not(:disabled) { border-color: ${T.lineStrong} !important; color: ${T.bone} !important; background: ${T.raised} !important; }
  .ag-card { transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease; }
  .ag-card:hover { background: ${T.raisedHover} !important; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
  .ag-card:focus-visible { outline: 2px solid ${T.coral}; outline-offset: 2px; }
  .ag-download:hover { background: ${T.coralHover} !important; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255,107,74,0.35); }
  .ag-preview-img { animation: ag-fade-in 0.35s ease; }
  @keyframes ag-fade-in { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
  .ag-progress-fill { transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1); }
  .ag-scroll::-webkit-scrollbar { width: 8px; }
  .ag-scroll::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 999px; }
  .ag-scroll::-webkit-scrollbar-thumb:hover { background: ${T.lineStrong}; }
  .ag-scroll::-webkit-scrollbar-track { background: transparent; }
`;

type SceneStatus = 'WAITING' | 'GENERATING' | 'DONE' | 'ERROR';

interface Scene {
  id: string;
  title: string;
  voiceLine: string;
  prompt: string;
}

// The Netflix vs Blockbuster 6-scene storyboard — each prompt is a complete,
// art-directed image brief, far richer than the voiceover line itself.
const SCENES: Scene[] = [
  {
    id: 'scene_1',
    title: 'The Red Envelope',
    voiceLine: 'In 1998, a small startup began mailing DVDs in red envelopes.',
    prompt: 'Cinematic vertical documentary still: a pair of hands in a dim 1990s garage slides a silver DVD into a bright red paper mailer envelope, towering stacks of identical red envelopes on a cluttered wooden desk, a single warm bulb overhead, dust motes in the light beam, cardboard boxes and tangled ethernet cables in the background, scrappy-startup energy, 35mm film grain, warm nostalgic color grade, shallow depth of field, no text or lettering anywhere',
  },
  {
    id: 'scene_2',
    title: 'The Empire',
    voiceLine: 'Blockbuster ruled Friday nights — nine thousand stores strong.',
    prompt: 'Cinematic vertical documentary still: a bustling 1990s video rental store on a Friday night, families browsing tall shelves packed with VHS and DVD cases, blue and yellow store lighting washing over the aisles, kids tugging parents toward the new-release wall, popcorn buckets by the register, warm fluorescent glow, Kodak film photography look, light grain, no text or lettering anywhere',
  },
  {
    id: 'scene_3',
    title: 'The Laugh',
    voiceLine: 'They laughed Netflix out of the boardroom — fifty million dollars, declined.',
    prompt: 'Cinematic vertical documentary still: an early-2000s corporate boardroom, a confident middle-aged executive in a grey suit leaning far back in a leather chair laughing dismissively, colleagues smirking around a long mahogany table, a glowing blank projector screen behind them, cool desaturated corporate color grade, venetian-blind shadows across the wall, documentary photojournalism style, no text or lettering anywhere',
  },
  {
    id: 'scene_4',
    title: 'The Stream',
    voiceLine: 'Then the internet got fast — and the discs stopped mattering.',
    prompt: 'Cinematic vertical documentary still: a dark cozy living room at night lit only by the glow of a flat-screen TV, a couple on a couch mid-binge, streaming interface glow reflected on their faces, a forgotten stack of DVD cases gathering dust on a side table in the foreground, deep blues and warm screen light contrast, moody cinematic lighting, film grain, no text or lettering anywhere',
  },
  {
    id: 'scene_5',
    title: 'The Fall',
    voiceLine: 'One by one, nine thousand stores went dark.',
    prompt: 'Cinematic vertical documentary still: an abandoned video rental store interior, empty toppled shelves, a CLOSED-feeling atmosphere with shutters half down, faded rectangles on the carpet where display racks stood, a single flickering fluorescent tube, cold blue-grey color grade with dust in the air, melancholic documentary mood, wide shot, no text or lettering anywhere',
  },
  {
    id: 'scene_6',
    title: 'The Museum',
    voiceLine: 'Twenty years later, the last Blockbuster store became a museum.',
    prompt: 'Cinematic vertical documentary still: the exterior of one lone retro video rental store at dusk, its blue and yellow storefront glowing warmly against a purple evening sky, two tourists photographing it with their phones like a monument, vintage cars parked nearby, nostalgic reverence, golden-hour rim light, 35mm film photography, gentle grain, no text or lettering anywhere',
  },
];

const STORE_KEY = 'asset_generator_netflix_v1';

// The platform-only generation endpoint — a server function, like every other
// pipeline in this space (browser code never calls provider proxies directly).
const GEN_HOOK = '/api/hooks/execute/workspace-660069/asset-image-gen';

export default function App() {
  const [status, setStatus] = useState<Record<string, SceneStatus>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>(SCENES[0].id);
  const [runningAll, setRunningAll] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelAll = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
      if (saved && saved.urls) {
        setUrls(saved.urls);
        const st: Record<string, SceneStatus> = {};
        Object.keys(saved.urls).forEach((k) => { st[k] = 'DONE'; });
        setStatus(st);
      }
    } catch { /* fresh start */ }
  }, []);

  function persist(nextUrls: Record<string, string>) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ urls: nextUrls })); } catch { /* best-effort */ }
  }

  async function generateImage(prompt: string): Promise<string> {
    const ws = (window as any).__workspaceDb;
    const sid = String((window as any).__spaceSessionId || '');
    const res = await fetch(GEN_HOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ws?.token ? { 'X-Workspace-DB-Token': ws.token } : {}),
        ...(sid ? { 'X-Session-Id': sid } : {}),
      },
      body: JSON.stringify({ op: 'generate', prompt, aspect: '9:16', session_id: sid }),
    });
    const raw = await res.json().catch(() => null);
    const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
    const url = data?.imageUrl;
    if (!res.ok || !url) throw new Error(String(data?.error || `Image generation failed (HTTP ${res.status}).`));
    return String(url);
  }

  async function generateOne(scene: Scene): Promise<boolean> {
    setStatus((s) => ({ ...s, [scene.id]: 'GENERATING' }));
    setErrors((e) => ({ ...e, [scene.id]: '' }));
    try {
      const url = await generateImage(scene.prompt);
      setUrls((u) => { const next = { ...u, [scene.id]: url }; persist(next); return next; });
      setStatus((s) => ({ ...s, [scene.id]: 'DONE' }));
      return true;
    } catch (err: any) {
      setStatus((s) => ({ ...s, [scene.id]: 'ERROR' }));
      setErrors((e) => ({ ...e, [scene.id]: String(err?.message || err) }));
      return false;
    }
  }

  async function generateAll() {
    setRunningAll(true);
    cancelAll.current = false;
    setProgress(0);
    // Sequential by design — one scene at a time, progress as we go.
    for (let i = 0; i < SCENES.length; i++) {
      if (cancelAll.current) break;
      setSelected(SCENES[i].id);
      await generateOne(SCENES[i]);
      setProgress(i + 1);
    }
    setRunningAll(false);
  }

  const sel = useMemo(() => SCENES.find((s) => s.id === selected) || SCENES[0], [selected]);
  const selUrl = urls[sel.id];
  const doneCount = SCENES.filter((s) => status[s.id] === 'DONE').length;

  const badgeStyle: Record<SceneStatus, { color: string; bg: string }> = {
    WAITING: { color: T.muted, bg: 'rgba(141,139,148,0.12)' },
    GENERATING: { color: T.gold, bg: 'rgba(232,163,60,0.14)' },
    DONE: { color: T.done, bg: 'rgba(127,212,180,0.14)' },
    ERROR: { color: T.fault, bg: 'rgba(226,114,111,0.14)' },
  };

  return (
    <div className="ag-root" style={{ width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: T.canvas, fontFamily: T.sans, overflow: 'hidden' }}>
      <style>{CSS}</style>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: `1px solid ${T.line}`, flexShrink: 0, background: 'linear-gradient(180deg, rgba(255,107,74,0.04), transparent)' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,107,74,0.12)', border: '1px solid rgba(255,107,74,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ImageIcon size={16} color={T.coral} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ color: T.bone, fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.2 }}>Asset Generator</div>
          <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Netflix vs Blockbuster · 6-scene storyboard · 9:16 stills</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {runningAll ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 150, height: 6, borderRadius: 999, background: T.raised, overflow: 'hidden', border: `1px solid ${T.line}` }}>
                  <div className="ag-progress-fill" style={{ width: `${Math.round((progress / SCENES.length) * 100)}%`, height: '100%', background: `linear-gradient(90deg, ${T.coral}, ${T.coralHover})`, borderRadius: 999 }} />
                </div>
                <span style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono, minWidth: 30 }}>{progress}/{SCENES.length}</span>
              </div>
              <button className="ag-ghost-btn" onClick={() => { cancelAll.current = true; }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 9, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <X size={12} /> Stop
              </button>
            </>
          ) : (
            <button className="ag-primary-btn" onClick={() => void generateAll()} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(255,107,74,0.25)' }}>
              <Sparkles size={13} /> Generate All
            </button>
          )}
        </div>
      </div>

      {/* two columns */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* left: scene cards */}
        <div className="ag-scroll" style={{ width: 380, flexShrink: 0, overflowY: 'auto', borderRight: `1px solid ${T.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
            <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Storyboard</span>
            <span style={{ color: doneCount === SCENES.length ? T.done : T.muted, fontSize: 11, fontFamily: T.mono }}>{doneCount}/{SCENES.length} ready</span>
          </div>
          {SCENES.map((sc, i) => {
            const st = status[sc.id] || 'WAITING';
            const on = selected === sc.id;
            const badge = badgeStyle[st];
            return (
              <div
                key={sc.id}
                className="ag-card"
                role="button"
                tabIndex={0}
                onClick={() => setSelected(sc.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(sc.id); } }}
                style={{ display: 'flex', gap: 12, background: T.raised, border: `1px solid ${on ? T.coral : st === 'ERROR' ? T.fault : T.line}`, borderRadius: 14, padding: 13, cursor: 'pointer', boxShadow: on ? '0 0 0 1px rgba(255,107,74,0.35), 0 8px 24px rgba(0,0,0,0.3)' : 'none' }}
              >
                <div style={{ width: 62, height: 100, borderRadius: 9, background: '#000', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.line}` }}>
                  {urls[sc.id] ? <img src={urls[sc.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : st === 'GENERATING' ? <Loader2 size={16} color={T.gold} className="animate-spin" />
                    : <span style={{ color: T.dim, fontSize: 17, fontFamily: T.mono }}>{i + 1}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: T.bone, fontSize: 13, fontWeight: 600, letterSpacing: -0.1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{i + 1}. {sc.title}</span>
                    <span style={{ marginLeft: 'auto', flexShrink: 0, color: badge.color, background: badge.bg, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, borderRadius: 999, padding: '3px 8px' }}>{st}</span>
                  </div>
                  <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>🗣 {sc.voiceLine}</div>
                  {errors[sc.id] ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: T.fault, fontSize: 10.5, lineHeight: 1.45, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.2)', borderRadius: 7, padding: '5px 8px' }}>
                      <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{errors[sc.id]} — hit Retry to try again.</span>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 'auto' }}>
                    <button
                      className={st === 'DONE' ? 'ag-ghost-btn' : 'ag-primary-btn'}
                      disabled={st === 'GENERATING' || runningAll}
                      onClick={(e) => { e.stopPropagation(); setSelected(sc.id); void generateOne(sc); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: st === 'DONE' ? 'transparent' : T.coral, border: st === 'DONE' ? `1px solid ${T.line}` : '1px solid transparent', color: st === 'DONE' ? T.muted : '#1A0E08', borderRadius: 8, padding: '7px 13px', fontSize: 11.5, fontWeight: 600, cursor: st === 'GENERATING' || runningAll ? 'default' : 'pointer', opacity: st === 'GENERATING' || runningAll ? 0.55 : 1 }}
                    >
                      {st === 'GENERATING' ? <Loader2 size={11} className="animate-spin" /> : st === 'DONE' ? <RefreshCw size={11} /> : <Play size={11} />}
                      {st === 'GENERATING' ? 'Generating…' : st === 'DONE' ? 'Regenerate' : st === 'ERROR' ? 'Retry' : 'Generate'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* right: large preview */}
        <div className="ag-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18, minWidth: 0, overflowY: 'auto' }}>
          {selUrl ? (
            <>
              <img key={selUrl} className="ag-preview-img" src={selUrl} alt={sel.title} style={{ maxHeight: 'calc(100% - 140px)', maxWidth: '100%', borderRadius: 16, border: `1px solid ${T.lineStrong}`, objectFit: 'contain', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ color: T.bone, fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2 }}>{sel.title}</div>
                <a className="ag-download" href={selUrl} download={`${sel.id}.png`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.coral, color: '#1A0E08', borderRadius: 10, padding: '10px 20px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', boxShadow: '0 2px 10px rgba(255,107,74,0.25)', transition: 'background-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease' }}>
                  <Download size={13} /> Download
                </a>
              </div>
              <div style={{ maxWidth: 600, background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>Art direction</div>
                <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.6 }}>{sel.prompt}</div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: 'rgba(255,107,74,0.08)', border: '1px solid rgba(255,107,74,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                {status[sel.id] === 'GENERATING' ? <Loader2 size={26} color={T.gold} className="animate-spin" /> : <ImageIcon size={26} color={T.coral} />}
              </div>
              <div style={{ color: T.bone, fontSize: 16, fontWeight: 700, letterSpacing: -0.2, marginBottom: 8 }}>{sel.title}</div>
              <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>🗣 {sel.voiceLine}</div>
              <div style={{ color: T.dim, fontSize: 11.5, lineHeight: 1.6 }}>{status[sel.id] === 'GENERATING' ? 'The image engine is painting this scene — it lands here the moment it finishes.' : 'Hit Generate on the card to the left — the finished 9:16 still appears here, ready to download.'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
