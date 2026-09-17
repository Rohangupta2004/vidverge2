/**
 * Asset Generator — standalone mini-app for manual scene-asset generation.
 * Ships pre-loaded with the Netflix vs Blockbuster 6-scene storyboard; each
 * scene carries a DETAILED art-directed image brief (subject, composition,
 * lighting, mood — not just the voiceover line).
 *
 * PLATFORM-ONLY GENERATION (Sep 15 2026): the founder owns no external API
 * keys, so all generation goes through the asset-image-gen server function,
 * which calls the platform-managed image proxy (gpt-image family, wallet-
 * billed, durable GCS URLs). No BYOK, no secrets proxy, no direct provider
 * calls from the browser — browser-shaped calls to /api/veo/generate/image
 * violate the veo_generations app_id foreign key, which is exactly the bug
 * this rewrite fixes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageIcon, Loader2, Play, RefreshCw, Sparkles, X } from 'lucide-react';

const T = {
  canvas: '#121214',
  raised: '#1B1B1F',
  line: '#2A2A30',
  bone: '#F4F2EE',
  muted: '#8D8B94',
  dim: '#55535C',
  coral: '#FF6B4A',
  done: '#7FD4B4',
  fault: '#E2726F',
  gold: '#E8A33C',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;

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

  const badgeColor: Record<SceneStatus, string> = { WAITING: T.dim, GENERATING: T.gold, DONE: T.done, ERROR: T.fault };

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', background: T.canvas, fontFamily: T.sans, overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${T.line}`, flexShrink: 0 }}>
        <div style={{ color: T.bone, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ImageIcon size={16} color={T.coral} /> Asset Generator
        </div>
        <div style={{ color: T.dim, fontSize: 11.5 }}>Netflix vs Blockbuster — 6-scene storyboard · platform image engine · 9:16</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {runningAll ? (
            <>
              <div style={{ width: 140, height: 6, borderRadius: 999, background: T.raised, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((progress / SCENES.length) * 100)}%`, height: '100%', background: T.coral, transition: 'width 0.4s' }} />
              </div>
              <span style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono }}>{progress}/{SCENES.length}</span>
              <button onClick={() => { cancelAll.current = true; }} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>
                <X size={12} /> Stop
              </button>
            </>
          ) : (
            <button onClick={() => void generateAll()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              <Sparkles size={13} /> Generate All
            </button>
          )}
        </div>
      </div>

      {/* two columns */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* left: scene cards */}
        <div style={{ width: 380, flexShrink: 0, overflowY: 'auto', borderRight: `1px solid ${T.line}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono }}>{doneCount}/{SCENES.length} assets ready</div>
          {SCENES.map((sc, i) => {
            const st = status[sc.id] || 'WAITING';
            const on = selected === sc.id;
            return (
              <div key={sc.id} onClick={() => setSelected(sc.id)} style={{ display: 'flex', gap: 12, background: T.raised, border: `1px solid ${on ? T.coral : st === 'ERROR' ? T.fault : T.line}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
                <div style={{ width: 62, height: 100, borderRadius: 8, background: '#000', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {urls[sc.id] ? <img src={urls[sc.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : st === 'GENERATING' ? <Loader2 size={16} color={T.gold} className="animate-spin" />
                    : <span style={{ color: T.dim, fontSize: 18 }}>{i + 1}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: T.bone, fontSize: 13, fontWeight: 700 }}>{i + 1}. {sc.title}</span>
                    <span style={{ marginLeft: 'auto', color: badgeColor[st], fontSize: 10, fontWeight: 800, letterSpacing: 0.5, fontFamily: T.mono }}>{st}</span>
                  </div>
                  <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>🗣 {sc.voiceLine}</div>
                  {errors[sc.id] ? <div style={{ color: T.fault, fontSize: 10.5, lineHeight: 1.4 }}>{errors[sc.id]}</div> : null}
                  <div style={{ marginTop: 'auto' }}>
                    <button
                      disabled={st === 'GENERATING' || runningAll}
                      onClick={(e) => { e.stopPropagation(); setSelected(sc.id); void generateOne(sc); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: st === 'DONE' ? 'transparent' : T.coral, border: st === 'DONE' ? `1px solid ${T.line}` : 'none', color: st === 'DONE' ? T.muted : '#1A0E08', borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: st === 'GENERATING' || runningAll ? 'default' : 'pointer', opacity: st === 'GENERATING' || runningAll ? 0.6 : 1 }}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, minWidth: 0, overflowY: 'auto' }}>
          {selUrl ? (
            <>
              <img src={selUrl} alt={sel.title} style={{ maxHeight: 'calc(100% - 120px)', maxWidth: '100%', borderRadius: 14, border: `1px solid ${T.line}`, objectFit: 'contain' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 700 }}>{sel.title}</div>
                <a href={selUrl} download={`${sel.id}.png`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.coral, color: '#1A0E08', borderRadius: 9, padding: '10px 18px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                  <Download size={13} /> Download
                </a>
              </div>
              <div style={{ color: T.dim, fontSize: 11, maxWidth: 560, lineHeight: 1.5, textAlign: 'center' }}>{sel.prompt}</div>
            </>
          ) : (
            <div style={{ textAlign: 'center', maxWidth: 440 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              <div style={{ color: T.bone, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{sel.title}</div>
              <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>🗣 {sel.voiceLine}</div>
              <div style={{ color: T.dim, fontSize: 11.5, lineHeight: 1.55 }}>{status[sel.id] === 'GENERATING' ? 'The image engine is painting this scene…' : 'Hit Generate on the card — the finished 9:16 still lands here.'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
