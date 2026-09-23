/**
 * AD DIRECTOR STUDIO — the AI Product Advertisement Director surface inside
 * Product Video.
 *
 * Paste a website URL (optionally add real screenshots, a goal and a voice)
 * → one Generate click → live agentic progress (Understanding Product → Ad
 * Strategy → Voiceover Script → Recording Voice → Visual Storyboard →
 * Generating Scenes → Quality Check → Composing Final Ad) → a downloadable
 * MP4 plus ad variations. Claude Opus 5 is the director; every scene card
 * shows its narration, visual-type badge, preview, voice-derived duration and
 * status, and supports regenerate / swap visual type / edit narration.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Clapperboard, Copy, Download, FileText,
  Film as FilmIcon, Globe, ImagePlus, Layers, Loader2, Megaphone, Mic, Music,
  Pencil, Play, RefreshCw, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import {
  AdVariation, Aspect, Film, FilmScene, STAGES, T, VIDEO_STYLES, VISUAL_TYPES,
  VideoStyle, VisualType, autoGenerateOn, autoMixOn, db, sceneFailed,
  sceneInFlight, sceneStatusLabel, stageIndex, uploadImageFile,
  visualTypeLabel, wsToken,
} from './api';
import {
  RunHooks, auditReadyScenes, buildVariation, clearScenePromptOverride,
  composeReadyFilm, createFilm, finishProduction, mainScenes, planVariations,
  regenerateScene, replanForStyle, resumeFilm, runFilm, swapSceneVisualType,
  updateSceneNarration, updateScenePrompt,
} from './orchestrator';
import { listAllVoices, TTS_VOICES } from './voiceover';
import type { VoiceOption } from '../audioSuite';

const CSS = `
  .pf-root * { box-sizing: border-box; }
  .pf-root button { transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; }
  .pf-root button:focus-visible, .pf-root a:focus-visible { outline: 2px solid ${T.coral}; outline-offset: 2px; border-radius: 10px; }
  .pf-primary:hover:not(:disabled) { background: #FF7E61 !important; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255,107,74,0.35); }
  .pf-ghost:hover:not(:disabled) { border-color: ${T.lineStrong} !important; color: ${T.bone} !important; }
  .pf-card { transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease; }
  .pf-card:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
  .pf-scroll::-webkit-scrollbar { width: 8px; }
  .pf-scroll::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 999px; }
  .pf-scroll::-webkit-scrollbar-track { background: transparent; }
  @keyframes pf-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .pf-enter { animation: pf-fade-in 0.3s ease; }
  .pf-note { animation: pf-fade-in 0.25s ease; }
  .pf-input { width: 100%; background: ${T.canvas}; border: 1px solid ${T.line}; border-radius: 10px; color: ${T.bone}; font-size: 13px; padding: 11px 13px; font-family: ${T.sans}; }
  .pf-input:focus { outline: none; border-color: ${T.coral}; }
  .pf-select { background: ${T.canvas}; border: 1px solid ${T.line}; border-radius: 8px; color: ${T.bone}; font-size: 11.5px; padding: 6px 8px; font-family: ${T.sans}; position: relative; z-index: 1; pointer-events: auto; cursor: pointer; }
  /* Mobile: a font-size below 16px makes iOS Safari zoom the page when the
     select gains focus, which reads as the dropdown "not opening". */
  @media (max-width: 640px), (pointer: coarse) { .pf-select { font-size: 16px; padding: 8px 10px; min-height: 40px; } }
`;

interface Note { at: number; text: string }

const statusChip: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'QUEUED', color: T.muted, bg: 'rgba(141,139,148,0.12)' },
  understanding: { label: 'RESEARCHING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  strategizing: { label: 'STRATEGY', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  scripting: { label: 'SCRIPTING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  voicing: { label: 'RECORDING VOICE', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  storyboarding: { label: 'STORYBOARDING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  producing: { label: 'GENERATING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  quality: { label: 'QUALITY CHECK', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  composing: { label: 'COMPOSING', color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  ready: { label: 'READY', color: T.done, bg: 'rgba(127,212,180,0.14)' },
  error: { label: 'NEEDS ATTENTION', color: T.fault, bg: 'rgba(226,114,111,0.14)' },
};

// One entry per scene state — the pill always shows the ACTUAL pipeline state:
// PLANNING → GENERATING → VALIDATING → QA CHECKING → READY, with RETRYING
// between failed attempts and FAILED (legacy 'error') after the last one.
const sceneChip: Record<string, { color: string; bg: string }> = {
  pending: { color: T.muted, bg: 'rgba(141,139,148,0.12)' },
  generating: { color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  validating: { color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  qa_checking: { color: T.gold, bg: 'rgba(232,163,60,0.14)' },
  retrying: { color: T.coral, bg: 'rgba(255,107,74,0.14)' },
  ready: { color: T.done, bg: 'rgba(127,212,180,0.14)' },
  failed: { color: T.fault, bg: 'rgba(226,114,111,0.14)' },
  error: { color: T.fault, bg: 'rgba(226,114,111,0.14)' },
};

const typeBadgeColor: Record<string, string> = {
  PRODUCT_UI: '#5EA8FF', UI_ANIMATION: '#5EA8FF', PRODUCT_MOCKUP: '#5EA8FF',
  AI_VIDEO: '#B48CFF', B_ROLL: '#B48CFF', IMAGE: '#E8A33C',
  TEXT: '#7FD4B4',
  MOTION_GRAPHIC: '#63D2C1', EDUCATIONAL_DIAGRAM: '#63D2C1', COMPARISON: '#63D2C1',
  PROCESS: '#63D2C1', TIMELINE: '#63D2C1', BEFORE_AFTER: '#63D2C1', SPLIT_SCREEN: '#63D2C1',
};

function fmtS(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}s` : '—';
}

export default function FilmStudio() {
  const [films, setFilms] = useState<Film[]>([]);
  const [film, setFilm] = useState<Film | null>(null);
  const [scenes, setScenes] = useState<FilmScene[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Create form
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  // "How do you want your product video to feel?" — required before Generate.
  const [style, setStyle] = useState<VideoStyle | ''>('');
  // Auto Generate / Auto Mix — ON by default; the user may turn either off.
  const [autoGen, setAutoGen] = useState(true);
  const [autoMixFlag, setAutoMixFlag] = useState(true);
  const [shots, setShots] = useState<string[]>([]);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');

  // Compose options + per-scene editors
  const [captionsOn, setCaptionsOn] = useState(true);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<number | null>(null);
  const [promptText, setPromptText] = useState('');
  const [previewScene, setPreviewScene] = useState<number | null>(null);
  const [flashScene, setFlashScene] = useState<number | null>(null);
  const [qaOpen, setQaOpen] = useState<number | null>(null);

  const runLock = useRef(false);
  const filmRef = useRef<Film | null>(null);
  filmRef.current = film;

  const refresh = async () => {
    try { setFilms(await db.listFilms()); setLoadError(''); }
    catch (e: any) { setLoadError(String(e?.message || e)); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { void listAllVoices().then((v) => setVoices(v.elevenlabs)).catch(() => undefined); }, []);

  const say = (text: string) => setNotes((n) => [...n.slice(-160), { at: Date.now(), text }]);

  const hooks: RunHooks = useMemo(() => ({
    onFilm: (patch) => setFilm((f) => (f ? { ...f, ...patch } : f)),
    onScene: (sceneId, patch) => setScenes((all) => all.map((s) => (s.id === sceneId ? { ...s, ...patch } : s))),
    onScenesReplaced: (all) => setScenes(all),
    onNote: say,
  }), []);

  async function drive(work: (f: Film) => Promise<void>, f: Film) {
    if (runLock.current) return;
    runLock.current = true;
    setRunning(true);
    try {
      await work(f);
    } catch (e: any) {
      say(`Stopped: ${String(e?.message || e)}`);
    } finally {
      runLock.current = false;
      setRunning(false);
      try {
        const freshFilm = await db.getFilm(f.id);
        if (freshFilm && filmRef.current?.id === f.id) setFilm(freshFilm);
        if (filmRef.current?.id === f.id) setScenes(await db.listScenes(f.id));
      } catch { /* view refresh is cosmetic */ }
      void refresh();
    }
  }

  async function openFilm(id: number) {
    const f = await db.getFilm(id);
    if (!f) return;
    const sc = await db.listScenes(id);
    setFilm(f); setScenes(sc); setNotes([]); setEditingScene(null); setEditingPrompt(null); setPreviewScene(null);
    const active = f.status && !['ready', 'error'].includes(f.status);
    const hasUnfinished = mainScenes(sc).some((s) => s.status === 'pending' || sceneInFlight(s.status));
    void drive(async (ff) => {
      // READY must mean a real video: every ready scene's rendered file is
      // audited — a corrupt/missing one demotes to RETRYING and regenerates.
      const demoted = await auditReadyScenes(ff, sc, hooks);
      if (demoted > 0) say(`${demoted} scene(s) had an invalid video — set to RETRYING, regenerating…`);
      if (active || hasUnfinished || demoted > 0) {
        say('Resuming this ad where it left off…');
        await resumeFilm(ff, sc, hooks);
      }
    }, f);
  }

  async function onPickFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true); setFormError('');
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 8)) uploaded.push(await uploadImageFile(file));
      setShots((s) => [...s, ...uploaded].slice(0, 8));
    } catch (e: any) { setFormError(String(e?.message || e)); }
    finally { setUploading(false); }
  }

  async function generate() {
    const cleanUrl = url.trim();
    if (!cleanUrl && !shots.length && !goal.trim()) { setFormError('Give the director something to work with — a product URL, a screenshot, or at least a goal.'); return; }
    if (!style) { setFormError('One more thing — pick how your product video should feel: Story-Driven or Product-Focused.'); return; }
    if (!wsToken()) { setFormError('Your workspace session is still loading — try again in a moment.'); return; }
    setFormError('');
    try {
      const f = await createFilm({ url: cleanUrl || null, screenshots: shots, goal: goal.trim() || null, aspect, voice: voice || null, videoStyle: style as VideoStyle, autoGenerate: autoGen, autoMix: autoMixFlag });
      setFilm(f); setScenes([]); setNotes([]);
      say('The director has the brief. Starting…');
      void drive((ff) => runFilm(ff, hooks), f);
      setUrl(''); setGoal(''); setShots([]);
    } catch (e: any) { setFormError(String(e?.message || e)); }
  }

  async function retakeScene(scene: FilmScene, withNote: boolean) {
    if (!film) return;
    let note: string | undefined;
    if (withNote) {
      const answer = window.prompt('Director note for the retake (what should change?):', '');
      if (answer === null) return;
      note = answer.trim() || undefined;
    }
    void drive(async (f) => { await regenerateScene(f, scene, scenes, hooks, note); }, film);
  }

  /** Change the scene's VISUAL TYPE for real: Opus rewrites the spec for the
   * new type and ONLY this scene regenerates — narration and voice timing
   * stay untouched. Never a label-only change. */
  async function swapType(scene: FilmScene, newType: VisualType) {
    if (!film || running || !newType || newType === scene.visual_type) return;
    if (!window.confirm(`Redesign scene ${scene.idx + 1} as ${visualTypeLabel(newType)}?\n\nOpus rewrites the visual for the new type and regenerates ONLY this scene — the narration and voice timing stay unchanged.`)) return;
    void drive(async (f) => { await swapSceneVisualType(f, scene, scenes, hooks, newType); }, film);
  }

  /** Timeline scene selection — scrolls the matching storyboard card into
   * view and flashes it so the click visibly lands on the right scene. */
  function focusScene(sceneId: number) {
    setFlashScene(sceneId);
    try { document.getElementById(`pf-scene-card-${sceneId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* cosmetic */ }
    window.setTimeout(() => setFlashScene((cur) => (cur === sceneId ? null : cur)), 1800);
  }

  /** Style override AFTER planning — never blindly regenerates: the
   * storyboard is re-planned and finished clips are reused where the visual
   * treatment is unchanged. */
  async function changeStyle() {
    if (!film || running) return;
    const next: VideoStyle = film.video_style === 'story_driven' ? 'product_focused' : 'story_driven';
    const label = next === 'story_driven' ? 'Story-Driven' : 'Product-Focused';
    if (!window.confirm(`Creative direction changed to ${label}. Re-plan the visual storyboard?\n\nExisting product assets, valid AI clips, graphics and the recorded voice are reused wherever the treatment is unchanged — only redesigned scenes regenerate.`)) return;
    void drive(async (f) => { await replanForStyle(f, hooks, next); }, film);
  }

  function startNarrationEdit(scene: FilmScene) {
    setEditingScene(scene.id);
    setEditText(scene.narration || '');
  }

  async function saveNarrationEdit(scene: FilmScene) {
    if (!film) return;
    const text = editText.trim();
    setEditingScene(null);
    if (!text || text === scene.narration) return;
    void drive(async (f) => { await updateSceneNarration(f, scene, scenes, hooks, text); }, film);
  }

  function startPromptEdit(scene: FilmScene) {
    setEditingPrompt(scene.id);
    // The editor opens on the EFFECTIVE prompt: the user's override when one
    // exists, else the generated production prompt / storyboard brief.
    setPromptText(scene.user_prompt_override || scene.visual_prompt || String((scene.spec as any)?.visual_concept || (scene.spec as any)?.asset_prompt || ''));
  }

  /** Save the edited prompt AND use it: the scene regenerates from it. */
  async function savePromptEdit(scene: FilmScene) {
    if (!film) return;
    const text = promptText.trim();
    setEditingPrompt(null);
    if (!text || text === (scene.visual_prompt || '')) return;
    void drive(async (f) => { await updateScenePrompt(f, scene, scenes, hooks, text); }, film);
  }

  async function composeNow() {
    if (!film) return;
    void drive(async (f) => { await composeReadyFilm(f, await db.listScenes(f.id), hooks, { captions: captionsOn }); }, film);
  }

  /** Explicit production start — the entry point when Auto Generate is OFF. */
  async function generateScenesNow() {
    if (!film || running) return;
    void drive(async (f) => { await finishProduction(f, mainScenes(await db.listScenes(f.id)), hooks); }, film);
  }

  /** Flip Auto Generate / Auto Mix on the open film (persisted immediately). */
  async function toggleAutoFlag(field: 'auto_generate' | 'auto_mix') {
    if (!film) return;
    const next = field === 'auto_generate' ? !autoGenerateOn(film) : !autoMixOn(film);
    setFilm({ ...film, [field]: next } as Film);
    try { await db.updateFilm(film.id, { [field]: next } as Partial<Film>); } catch { /* reflected on next open */ }
  }

  /** Remove a manual prompt override — the scene regenerates from Opus. */
  async function resetOverride(scene: FilmScene) {
    if (!film || running) return;
    if (!window.confirm(`Scene ${scene.idx + 1}: remove your manual prompt and regenerate from the director's prompt?`)) return;
    void drive(async (f) => { await clearScenePromptOverride(f, scene, scenes, hooks); }, film);
  }

  async function makeVariations() {
    if (!film) return;
    void drive(async (f) => { await planVariations(f, await db.listScenes(f.id), hooks); }, film);
  }

  async function buildOneVariation(v: AdVariation) {
    if (!film) return;
    void drive(async (f) => { await buildVariation(f, await db.listScenes(f.id), hooks, v.id); }, film);
  }

  async function removeFilm(f: Film) {
    if (!window.confirm(`Delete “${f.title || 'this ad'}”? Finished videos already downloaded are unaffected.`)) return;
    try { await db.deleteFilm(f.id); } catch { /* row may be gone */ }
    if (film?.id === f.id) { setFilm(null); setScenes([]); }
    void refresh();
  }

  // ------------------------------------------------------------------ gallery
  if (!film) {
    return (
      <div className="pf-root pf-enter" style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', fontFamily: T.sans }}>
        <style>{CSS}</style>
        {/* hero create card */}
        <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 18, padding: 'clamp(18px, 3vw, 28px)', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,107,74,0.12)', border: '1px solid rgba(255,107,74,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Megaphone size={17} color={T.coral} />
            </div>
            <div>
              <div style={{ color: T.bone, fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>AI Ad Director</div>
              <div style={{ color: T.muted, fontSize: 12.5 }}>Paste your website. The director researches the product, picks the hook, writes and records the voiceover FIRST, then builds every visual to the voice — real UI mockups, Omni Flash B-roll, animated diagrams — into one professional ad.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 16 }}>
            <div>
              <label style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}><Globe size={11} /> Product URL</label>
              <input className="pf-input" placeholder="https://yourproduct.com" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-film-url" />
              <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
                <div>
                  <label style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'block', marginBottom: 7 }}>Aspect</label>
                  <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, border: `1px solid ${T.line}` }}>
                    {(['16:9', '9:16'] as Aspect[]).map((a) => (
                      <button key={a} type="button" onClick={() => setAspect(a)} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: aspect === a ? T.coral : 'transparent', color: aspect === a ? '#1A0E08' : T.muted }}>{a}</button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}><Mic size={11} /> Voice</label>
                  <select className="pf-input" value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: '9px 10px' }} data-testid="select-ad-voice">
                    <option value="">Workspace default (ElevenLabs)</option>
                    {voices.length ? (
                      <optgroup label="ElevenLabs voices">
                        {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </optgroup>
                    ) : null}
                    <optgroup label="Built-in voices">
                      {TTS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </optgroup>
                  </select>
                </div>
              </div>
            </div>
            <div>
              <label style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}><ImagePlus size={11} /> Screenshots (ground-truth UI)</label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1px dashed ${T.lineStrong}`, borderRadius: 10, padding: '14px 12px', color: T.muted, fontSize: 12.5, cursor: 'pointer' }}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {uploading ? 'Uploading…' : 'Add product screenshots (up to 8)'}
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ''; }} data-testid="input-film-screenshots" />
              </label>
              <div style={{ color: T.dim, fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>No uploads? The director also captures a real screenshot of your website — product-UI scenes never use AI-invented interfaces.</div>
              {shots.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {shots.map((s, i) => (
                    <div key={s} style={{ position: 'relative' }}>
                      <img src={s} alt={`screenshot ${i + 1}`} style={{ width: 74, height: 50, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.line}` }} />
                      <button type="button" onClick={() => setShots((all) => all.filter((x) => x !== s))} title="Remove" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: 'none', background: T.fault, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}><Wand2 size={11} /> Goal (optional)</label>
              <textarea className="pf-input" rows={4} placeholder="e.g. A 40-second ad for developers — problem hook, confident tone, end on the free-trial CTA" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ resize: 'vertical' }} data-testid="input-film-goal" />
            </div>
          </div>
          {/* THE ONE QUESTION — creative visual strategy, asked with the inputs */}
          <div style={{ marginTop: 18 }}>
            <label style={{ color: T.bone, fontSize: 13, fontWeight: 800, display: 'block', marginBottom: 3 }}>How do you want your product video to feel?</label>
            <div style={{ color: T.dim, fontSize: 11, marginBottom: 10 }}>Creative priorities, not fixed percentages — the director still decides scene by scene. You can switch later and only the changed scenes regenerate.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {VIDEO_STYLES.map((s) => {
                const active = style === s.id;
                const Icon = s.id === 'story_driven' ? Clapperboard : Layers;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    aria-pressed={active}
                    style={{ textAlign: 'left', background: active ? 'rgba(255,107,74,0.08)' : T.canvas, border: `1.5px solid ${active ? T.coral : T.line}`, borderRadius: 13, padding: '13px 15px', cursor: 'pointer' }}
                    data-testid={`button-style-${s.id}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={14} color={active ? T.coral : T.muted} />
                      <span style={{ color: T.bone, fontSize: 13, fontWeight: 800 }}>{s.label}</span>
                      {active ? <Check size={13} color={T.coral} style={{ marginLeft: 'auto' }} /> : null}
                    </div>
                    <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, marginTop: 6 }}>
                      {s.id === 'story_driven' ? 'More AI-generated video, minimal motion graphics' : 'More product/UI + motion graphics, AI video supports the story'}
                    </div>
                    <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>{s.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Auto Generate / Auto Mix — ON by default, user-configurable */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
            <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 8, color: T.bone, fontSize: 12, fontWeight: 700, cursor: 'pointer', maxWidth: 340 }}>
              <input type="checkbox" checked={autoGen} onChange={(e) => setAutoGen(e.target.checked)} style={{ marginTop: 2 }} data-testid="toggle-auto-generate" />
              <span>Auto Generate<span style={{ display: 'block', color: T.dim, fontSize: 10.5, fontWeight: 500, lineHeight: 1.45 }}>One click runs everything — scenes, QA, retries and the final composition. Off = pause after the storyboard for review.</span></span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 8, color: T.bone, fontSize: 12, fontWeight: 700, cursor: 'pointer', maxWidth: 340 }}>
              <input type="checkbox" checked={autoMixFlag} onChange={(e) => setAutoMixFlag(e.target.checked)} style={{ marginTop: 2 }} data-testid="toggle-auto-mix" />
              <span>Auto Mix<span style={{ display: 'block', color: T.dim, fontSize: 10.5, fontWeight: 500, lineHeight: 1.45 }}>Music and subtle SFX are generated and ducked under the voice automatically. Off = narration only.</span></span>
            </label>
          </div>
          {formError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.fault, fontSize: 12, marginTop: 12 }}><AlertTriangle size={13} /> {formError}</div>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button type="button" className="pf-primary" disabled={uploading} onClick={() => void generate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 11, padding: '12px 26px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 10px rgba(255,107,74,0.25)' }} data-testid="button-generate-film">
              <Sparkles size={15} /> Direct My Ad
            </button>
          </div>
        </div>

        {/* ads gallery */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>My Ads</span>
          <button type="button" className="pf-ghost" onClick={() => void refresh()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 9, padding: '7px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}><RefreshCw size={11} /> Refresh</button>
        </div>
        {loadError ? <div style={{ color: T.fault, fontSize: 12.5 }}>{loadError}</div> : null}
        {films.length === 0 && !loadError ? (
          <div style={{ color: T.dim, fontSize: 13, padding: '26px 0', textAlign: 'center' }}>No ads yet — your first one starts above.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
            {films.map((f) => {
              const chip = statusChip[String(f.status || 'draft')] || statusChip.draft;
              return (
                <div key={f.id} className="pf-card" role="button" tabIndex={0} onClick={() => void openFilm(f.id)} onKeyDown={(e) => { if (e.key === 'Enter') void openFilm(f.id); }} style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer' }} data-testid={`card-film-${f.id}`}>
                  <div style={{ height: 128, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {f.final_thumb_url ? <img src={f.final_thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FilmIcon size={26} color={T.dim} />}
                  </div>
                  <div style={{ padding: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: T.bone, fontSize: 13, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>{f.title || f.brief?.product_name || f.source_url || `Ad ${f.id}`}</span>
                      <span style={{ flexShrink: 0, color: chip.color, background: chip.bg, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, borderRadius: 999, padding: '3px 8px' }}>{chip.label}</span>
                    </div>
                    <div style={{ color: T.muted, fontSize: 11, marginTop: 5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.stage_note || f.goal || ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------- run
  const chip = statusChip[String(film.status || 'draft')] || statusChip.draft;
  const stageIdx = stageIndex(film.status);
  const storyboard = mainScenes(scenes);
  const readyScenes = storyboard.filter((s) => s.status === 'ready').length;
  const canCompose = !running && storyboard.length > 0 && storyboard.every((s) => s.status === 'ready');
  const flagged = storyboard.filter((s) => s.inspection && s.inspection.pass === false);
  const totalS = storyboard.reduce((a, s) => a + (Number(s.duration_s) || 0), 0);
  const variations = film.variations || [];
  const pendingScenes = storyboard.filter((s) => s.status === 'pending' || s.status === 'retrying').length;
  const needsManualGenerate = !running && !autoGenerateOn(film) && pendingScenes > 0 && !storyboard.some((s) => sceneInFlight(s.status) && s.status !== 'retrying');

  return (
    <div className="pf-root pf-enter" style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', fontFamily: T.sans }}>
      <style>{CSS}</style>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className="pf-ghost" onClick={() => { setFilm(null); setScenes([]); void refresh(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} data-testid="button-film-back"><ArrowLeft size={13} /> My Ads</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: T.bone, fontSize: 16, fontWeight: 800, letterSpacing: -0.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{film.title || film.brief?.product_name || 'Untitled ad'}</div>
          <div style={{ color: T.muted, fontSize: 11.5 }}>{film.aspect_ratio || '16:9'} · {storyboard.length ? `${readyScenes}/${storyboard.length} scenes ready · ≈${Math.round(totalS)}s` : 'preparing'}{running ? ' · working…' : ''}</div>
        </div>
        {film.video_style ? (
          <button
            type="button"
            className="pf-ghost"
            disabled={running}
            onClick={() => void changeStyle()}
            title="Switch the creative style — the storyboard is re-planned and finished clips are reused where the treatment is unchanged"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 999, padding: '5px 11px', fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }}
            data-testid="button-change-style"
          >
            {film.video_style === 'story_driven' ? 'STORY-DRIVEN' : 'PRODUCT-FOCUSED'} · SWITCH
          </button>
        ) : null}
        <button type="button" className="pf-ghost" disabled={running} onClick={() => void toggleAutoFlag('auto_generate')} title="Auto Generate: ON = one Generate click runs scenes, QA, retries and composition end to end. OFF = production waits for the Generate scenes button." style={{ background: 'transparent', border: `1px solid ${autoGenerateOn(film) ? 'rgba(127,212,180,0.45)' : T.line}`, color: autoGenerateOn(film) ? T.done : T.muted, borderRadius: 999, padding: '5px 11px', fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid="toggle-film-auto-generate">AUTO GEN {autoGenerateOn(film) ? 'ON' : 'OFF'}</button>
        <button type="button" className="pf-ghost" disabled={running} onClick={() => void toggleAutoFlag('auto_mix')} title="Auto Mix: ON = the music bed and subtle SFX are generated automatically and ducked under narration at composition. OFF = narration only." style={{ background: 'transparent', border: `1px solid ${autoMixOn(film) ? 'rgba(127,212,180,0.45)' : T.line}`, color: autoMixOn(film) ? T.done : T.muted, borderRadius: 999, padding: '5px 11px', fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid="toggle-film-auto-mix">AUTO MIX {autoMixOn(film) ? 'ON' : 'OFF'}</button>
        <span style={{ color: chip.color, background: chip.bg, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fontFamily: T.mono, borderRadius: 999, padding: '5px 11px' }}>{chip.label}</span>
        <button type="button" className="pf-ghost" onClick={() => void removeFilm(film)} title="Delete ad" style={{ background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 10, padding: 9, cursor: 'pointer', display: 'inline-flex' }}><Trash2 size={13} /></button>
      </div>

      {/* agentic stage rail */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STAGES.map((s, i) => {
          const state = film.status === 'ready' || i < stageIdx ? 'done' : i === stageIdx ? 'live' : 'todo';
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 999, border: `1px solid ${state === 'live' ? T.gold : state === 'done' ? 'rgba(127,212,180,0.4)' : T.line}`, background: state === 'live' ? 'rgba(232,163,60,0.1)' : state === 'done' ? 'rgba(127,212,180,0.08)' : 'transparent' }}>
              {state === 'done' ? <Check size={11} color={T.done} /> : state === 'live' ? <Loader2 size={11} color={T.gold} className={running ? 'animate-spin' : ''} /> : <span style={{ width: 11 }} />}
              <span style={{ color: state === 'todo' ? T.dim : T.bone, fontSize: 10.5, fontWeight: 700 }}>{s.label}</span>
            </div>
          );
        })}
      </div>

      {film.error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.2)', borderRadius: 10, padding: '10px 13px', marginBottom: 14 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{film.error}</span>
        </div>
      ) : null}

      {needsManualGenerate ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: '11px 14px', marginBottom: 14 }}>
          <span style={{ color: T.muted, fontSize: 12 }}>Auto-generate is off — {pendingScenes} scene(s) are storyboarded and waiting.</span>
          <button type="button" className="pf-primary" onClick={() => void generateScenesNow()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }} data-testid="button-generate-scenes">
            <Sparkles size={13} /> Generate scenes
          </button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(260px, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* left column: final ad + timeline + storyboard */}
        <div style={{ minWidth: 0 }}>
          {film.final_video_url ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
              <video key={film.final_video_url} src={film.final_video_url} controls playsInline style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 480 }} data-testid="video-final-film" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
                <a className="pf-primary" href={film.final_video_url} download={`${(film.title || 'product-ad').replace(/[^\w-]+/g, '_')}.mp4`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.coral, color: '#1A0E08', borderRadius: 10, padding: '10px 20px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }} data-testid="link-download-film"><Download size={13} /> Download MP4</a>
                {film.duration_s ? <span style={{ color: T.muted, fontSize: 11.5, fontFamily: T.mono }}>{Math.round(Number(film.duration_s))}s</span> : null}
                <span style={{ color: T.muted, fontSize: 11.5 }}>{film.stage_note || ''}</span>
              </div>
            </div>
          ) : film.stage_note ? (
            <div style={{ color: T.muted, fontSize: 12.5, background: T.raised, border: `1px solid ${T.line}`, borderRadius: 12, padding: '11px 14px', marginBottom: 16 }}>{film.stage_note}</div>
          ) : null}

          {/* FINAL VIDEO QA — verdict from inspecting the ACTUAL composed MP4 */}
          {film.final_qa ? (
            <div style={{ background: T.raised, border: `1px solid ${film.final_qa.pass ? 'rgba(127,212,180,0.4)' : 'rgba(232,163,60,0.5)'}`, borderRadius: 13, padding: 13, marginBottom: 16 }} data-testid="panel-final-qa">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {film.final_qa.pass ? <Check size={13} color={T.done} /> : <AlertTriangle size={13} color={T.gold} />}
                <span style={{ color: film.final_qa.pass ? T.done : T.gold, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, fontFamily: T.mono }}>FINAL VIDEO QA {film.final_qa.pass ? 'PASSED' : 'FAILED'}</span>
                <span style={{ color: T.dim, fontSize: 10.5 }}>frames + OCR + vision on the rendered MP4 — the actual file is the source of truth</span>
              </div>
              {!film.final_qa.pass && film.final_qa.failures?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
                  {film.final_qa.failures.slice(0, 6).map((f, i) => (
                    <div key={`${f.requirement}-${i}`} style={{ borderLeft: `2px solid ${T.gold}`, paddingLeft: 9 }}>
                      <div style={{ color: T.bone, fontSize: 11.5, fontWeight: 700 }}>{f.sceneIdx != null ? `Scene ${f.sceneIdx + 1} · ` : ''}{f.requirement.toUpperCase()} · {f.severity}</div>
                      <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5 }}>Expected: {f.expected}</div>
                      <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5 }}>Detected: {f.detected}</div>
                      <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.5 }}>Cause: {f.cause}</div>
                      <div style={{ color: T.done, fontSize: 10.5, lineHeight: 1.5 }}>Fix: {f.fix}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {film.final_qa.notes?.length ? <div style={{ color: T.dim, fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>{film.final_qa.notes.join(' · ')}</div> : null}
            </div>
          ) : null}

          {/* timeline preview — widths proportional to voice-derived durations */}
          {storyboard.length > 0 ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <Layers size={12} color={T.muted} />
                <span style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Timeline · voice-timed · ≈{Math.round(totalS)}s</span>
              </div>
              <div style={{ display: 'flex', gap: 3, height: 44, borderRadius: 8, overflow: 'hidden' }}>
                {storyboard.map((sc) => {
                  const w = Math.max(4, ((Number(sc.duration_s) || 4) / Math.max(1, totalS)) * 100);
                  const color = typeBadgeColor[String(sc.visual_type || '')] || T.muted;
                  return (
                    <div
                      key={sc.id}
                      role="button"
                      tabIndex={0}
                      title={`${sc.idx + 1}. ${visualTypeLabel(sc.visual_type)} · ${fmtS(sc.duration_s)} — “${sc.narration || ''}” (click to open this scene)`}
                      onClick={() => focusScene(sc.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') focusScene(sc.id); }}
                      style={{ width: `${w}%`, background: `${color}22`, borderTop: `3px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, cursor: 'pointer' }}
                      data-testid={`timeline-scene-${sc.idx}`}
                    >
                      <span style={{ color, fontSize: 9, fontFamily: T.mono, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap' }}>{sc.idx + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {canCompose ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.bone, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  <input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.target.checked)} data-testid="toggle-captions" />
                  Burned-in captions (from the voiceover transcript)
                </label>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.muted, fontSize: 11.5 }}><Music size={12} /> Music: {film.strategy?.music_style || 'auto'} · ducks under narration</span>
              </div>
              <button type="button" className="pf-primary" onClick={() => void composeNow()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 13, fontWeight: 800, cursor: 'pointer', marginTop: 12 }} data-testid="button-compose-film">
                <Play size={14} /> {film.final_video_url ? 'Re-compose final ad' : 'Compose final ad'}
              </button>
            </div>
          ) : null}

          {flagged.length > 0 && !running ? (
            <div style={{ color: T.gold, fontSize: 12, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 10, padding: '9px 13px', marginBottom: 14 }}>
              Quality control flagged {flagged.length} scene(s) — they shipped anyway. Retake them below if you agree.
            </div>
          ) : null}

          {/* storyboard — scene cards */}
          {storyboard.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Storyboard</span>
              {storyboard.map((sc) => {
                const scChip = sceneChip[sc.status] || sceneChip.pending;
                const weak = sc.inspection && sc.inspection.pass === false;
                const badge = typeBadgeColor[String(sc.visual_type || '')] || T.muted;
                const editing = editingScene === sc.id;
                return (
                  <div key={sc.id} id={`pf-scene-card-${sc.id}`} className="pf-card" style={{ display: 'flex', gap: 12, background: T.raised, border: `1px solid ${flashScene === sc.id ? T.coral : weak ? 'rgba(232,163,60,0.45)' : sceneFailed(sc.status) ? T.fault : T.line}`, boxShadow: flashScene === sc.id ? `0 0 0 2px ${T.coral}55` : undefined, borderRadius: 13, padding: 12 }} data-testid={`card-scene-${sc.idx}`}>
                    <div style={{ width: 108, height: 64, borderRadius: 8, background: '#000', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.line}` }}>
                      {sc.first_frame_url || sc.keyframe_url || sc.layer_urls?.asset ? (
                        <img src={sc.first_frame_url || sc.keyframe_url || sc.layer_urls?.asset || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : sceneInFlight(sc.status) ? <Loader2 size={15} color={T.gold} className="animate-spin" />
                        : <span style={{ color: T.dim, fontSize: 15, fontFamily: T.mono }}>{sc.idx + 1}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: T.bone, fontSize: 12.5, fontWeight: 700 }}>{sc.idx + 1}. {sc.beat_title || 'Scene'}</span>
                        <span style={{ color: badge, fontSize: 9.5, fontWeight: 800, fontFamily: T.mono, border: `1px solid ${badge}55`, background: `${badge}18`, borderRadius: 999, padding: '2px 8px' }}>{visualTypeLabel(sc.visual_type)}</span>
                        {sc.user_prompt_override ? (
                          <span title="This scene generates from your exact edited prompt — the director never replaces it. Use Reset prompt to return to the AI prompt." style={{ color: T.gold, fontSize: 9, fontWeight: 800, fontFamily: T.mono, border: `1px solid ${T.gold}55`, background: 'rgba(232,163,60,0.12)', borderRadius: 999, padding: '2px 8px' }} data-testid={`badge-prompt-override-${sc.idx}`}>YOUR PROMPT</span>
                        ) : null}
                        <span style={{ color: T.dim, fontSize: 10, fontFamily: T.mono }} title="Voice-derived duration (narration audio)">{fmtS(sc.duration_s)}{sc.narration_s ? ` · voice ${fmtS(sc.narration_s)}` : ''}</span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, color: scChip.color, background: scChip.bg, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, fontFamily: T.mono, borderRadius: 999, padding: '3px 8px' }} data-testid={`status-scene-${sc.idx}`}>{sceneStatusLabel(sc.status)}</span>
                      </div>
                      {editing ? (
                        <div style={{ marginTop: 6 }}>
                          <textarea className="pf-input" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} style={{ fontSize: 12 }} data-testid={`input-narration-${sc.idx}`} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button type="button" className="pf-primary" onClick={() => void saveNarrationEdit(sc)} style={{ background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save · re-voice · re-render</button>
                            <button type="button" className="pf-ghost" onClick={() => setEditingScene(null)} style={{ background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: T.bone, fontSize: 12, lineHeight: 1.5, marginTop: 4, fontStyle: 'italic' }}>“{sc.narration || '—'}”</div>
                      )}
                      {sc.on_screen_text ? <div style={{ color: T.muted, fontSize: 10.5, marginTop: 3 }}>On screen: {sc.on_screen_text}</div> : null}
                      {/* QA — one-line summary; full diagnostics collapse behind a toggle so cards stay compact */}
                      {weak ? <div style={{ color: T.gold, fontSize: 10.5, marginTop: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>⚠ {sc.inspection?.issues}</div> : null}
                      {sc.error ? <div style={{ color: T.fault, fontSize: 10.5, marginTop: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{sc.error}</div> : null}
                      {(sc.qa_report?.failures?.length || weak || sc.error) ? (
                        <button type="button" onClick={() => setQaOpen(qaOpen === sc.id ? null : sc.id)} style={{ background: 'transparent', border: 'none', color: T.dim, fontSize: 10, fontWeight: 700, fontFamily: T.mono, cursor: 'pointer', padding: 0, marginTop: 4, textDecoration: 'underline' }} data-testid={`button-qa-details-${sc.idx}`}>
                          {qaOpen === sc.id ? 'Hide QA details' : `Show QA details${sc.qa_report?.failures?.length ? ` (${sc.qa_report.failures.length})` : ''}`}
                        </button>
                      ) : null}
                      {qaOpen === sc.id ? (
                        <div style={{ marginTop: 6, background: T.canvas, border: `1px solid ${T.line}`, borderRadius: 9, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 7 }} data-testid={`panel-qa-details-${sc.idx}`}>
                          <div style={{ color: T.dim, fontSize: 9.5, fontFamily: T.mono }}>
                            attempts {Number(sc.attempts) || 0}/3 · method {sc.qa_report?.method || sc.inspection?.method || '—'}{sc.qa_report?.checkedAt ? ` · checked ${new Date(sc.qa_report.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                          </div>
                          {sc.inspection && sc.inspection.pass === false && sc.inspection.issues ? (
                            <div style={{ color: T.gold, fontSize: 10.5, lineHeight: 1.5 }}>Inspector: {sc.inspection.issues}</div>
                          ) : null}
                          {(sc.qa_report?.failures || []).slice(0, 6).map((f, fi) => (
                            <div key={`${f.requirement}-${fi}`} style={{ borderLeft: `2px solid ${T.gold}`, paddingLeft: 8 }}>
                              <div style={{ color: T.bone, fontSize: 10.5, fontWeight: 700 }}>{f.requirement.toUpperCase()} · {f.severity}</div>
                              <div style={{ color: T.muted, fontSize: 10.5, lineHeight: 1.5 }}>Expected: {f.expected}</div>
                              <div style={{ color: T.muted, fontSize: 10.5, lineHeight: 1.5 }}>Detected: {f.detected}</div>
                              <div style={{ color: T.done, fontSize: 10, lineHeight: 1.5 }}>Fix: {f.fix}</div>
                            </div>
                          ))}
                          {sc.qa_report?.detected_text ? <div style={{ color: T.dim, fontSize: 9.5, lineHeight: 1.5 }}>OCR read: “{String(sc.qa_report.detected_text).slice(0, 160)}”</div> : null}
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {sceneFailed(sc.status) ? (
                          <button type="button" className="pf-primary" disabled={running} onClick={() => void retakeScene(sc, false)} title="Retry this failed scene — it regenerates with a corrected prompt" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 8, padding: '6px 13px', fontSize: 11, fontWeight: 800, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-retry-${sc.idx}`}><RefreshCw size={10} /> Retry</button>
                        ) : null}
                        {sc.clip_url ? (
                          <button type="button" className="pf-ghost" onClick={() => setPreviewScene(previewScene === sc.id ? null : sc.id)} title="Play this scene's rendered clip right here" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${previewScene === sc.id ? T.coral : T.line}`, color: previewScene === sc.id ? T.coral : T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }} data-testid={`button-preview-clip-${sc.idx}`}><Play size={10} /> Clip</button>
                        ) : null}
                        <button type="button" className="pf-ghost" disabled={running} onClick={() => void retakeScene(sc, false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-retake-${sc.idx}`}><RefreshCw size={10} /> Retake</button>
                        <button type="button" className="pf-ghost" disabled={running} onClick={() => void retakeScene(sc, true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-retake-note-${sc.idx}`}><Wand2 size={10} /> With note</button>
                        <button type="button" className="pf-ghost" disabled={running || editing} onClick={() => startNarrationEdit(sc)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-edit-narration-${sc.idx}`}><Pencil size={10} /> Narration</button>
                        <button type="button" className="pf-ghost" disabled={running || editingPrompt === sc.id} onClick={() => startPromptEdit(sc)} title="Edit the exact prompt this scene generates from — your text is used verbatim and never replaced by the director" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-edit-prompt-${sc.idx}`}><FileText size={10} /> Edit prompt</button>
                        {sc.user_prompt_override ? (
                          <button type="button" className="pf-ghost" disabled={running} onClick={() => void resetOverride(sc)} title="Remove your manual prompt and regenerate this scene from the director's prompt" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${T.gold}55`, color: T.gold, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-reset-prompt-${sc.idx}`}><X size={10} /> Reset prompt</button>
                        ) : null}
                        <select
                          className="pf-select"
                          value={String(sc.visual_type || '')}
                          disabled={running}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); void swapType(sc, e.target.value as VisualType); }}
                          title="Change this scene's visual type — Opus redesigns the scene for the new type and ONLY this scene regenerates"
                          data-testid={`select-visual-type-${sc.idx}`}
                        >
                          {!sc.visual_type ? <option value="">Visual type…</option> : null}
                          {sc.visual_type && !VISUAL_TYPES.includes(sc.visual_type as VisualType) ? (
                            <option value={String(sc.visual_type)}>{visualTypeLabel(sc.visual_type)}</option>
                          ) : null}
                          {VISUAL_TYPES.map((t) => <option key={t} value={t}>{visualTypeLabel(t)}</option>)}
                        </select>
                      </div>
                      {previewScene === sc.id && sc.clip_url ? (
                        <video key={sc.clip_url} src={sc.clip_url} controls autoPlay playsInline style={{ width: '100%', maxHeight: 300, borderRadius: 10, background: '#000', marginTop: 8 }} data-testid={`video-scene-preview-${sc.idx}`} />
                      ) : null}
                      {editingPrompt === sc.id ? (
                        <div style={{ marginTop: 8 }}>
                          <textarea className="pf-input" rows={3} value={promptText} onChange={(e) => setPromptText(e.target.value)} placeholder="Describe exactly what this scene should show — subject, environment, action, camera, lighting…" style={{ fontSize: 12 }} data-testid={`input-prompt-${sc.idx}`} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button type="button" className="pf-primary" onClick={() => void savePromptEdit(sc)} style={{ background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }} data-testid={`button-save-prompt-${sc.idx}`}>Save prompt · regenerate scene</button>
                            <button type="button" className="pf-ghost" onClick={() => setEditingPrompt(null)} style={{ background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* variations */}
          {film.status === 'ready' || variations.length ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Ad variations</span>
                <button type="button" className="pf-ghost" disabled={running || film.status !== 'ready'} onClick={() => void makeVariations()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${T.line}`, color: T.muted, borderRadius: 9, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: running || film.status !== 'ready' ? 0.5 : 1 }} data-testid="button-plan-variations"><Copy size={11} /> {variations.length ? 'Re-plan variations' : 'Plan variations'}</button>
              </div>
              {variations.length === 0 ? (
                <div style={{ color: T.dim, fontSize: 12 }}>Different hook · faster cut · more cinematic · more educational · short social cut — all reusing the scenes you already generated.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {variations.map((v) => (
                    <div key={v.id} className="pf-card" style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: T.bone, fontSize: 12.5, fontWeight: 700 }}>{v.name}</span>
                        <span style={{ color: T.muted, fontSize: 9.5, fontFamily: T.mono, border: `1px solid ${T.line}`, borderRadius: 999, padding: '2px 8px' }}>{v.kind.replace('_', ' ')}</span>
                        <span style={{ color: T.dim, fontSize: 10.5 }}>{v.scene_keys.length} scenes reused{v.duration_s ? ` · ${Math.round(Number(v.duration_s))}s` : ''}</span>
                        <span style={{ marginLeft: 'auto', color: v.status === 'ready' ? T.done : v.status === 'error' ? T.fault : v.status === 'building' ? T.gold : T.muted, fontSize: 9, fontWeight: 700, fontFamily: T.mono }}>{v.status.toUpperCase()}</span>
                      </div>
                      {v.note ? <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>{v.note}</div> : null}
                      {v.error ? <div style={{ color: T.fault, fontSize: 10.5, marginTop: 4 }}>{v.error}</div> : null}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {v.status !== 'ready' ? (
                          <button type="button" className="pf-primary" disabled={running || v.status === 'building'} onClick={() => void buildOneVariation(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.coral, color: '#1A0E08', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: running ? 0.5 : 1 }} data-testid={`button-build-variation-${v.id}`}>
                            {v.status === 'building' ? <Loader2 size={11} className="animate-spin" /> : <Clapperboard size={11} />} Build
                          </button>
                        ) : null}
                        {v.video_url ? (
                          <>
                            <a className="pf-ghost" href={v.video_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}><Play size={10} /> Watch</a>
                            <a className="pf-ghost" href={v.video_url} download={`${(v.name || 'variation').replace(/[^\w-]+/g, '_')}.mp4`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${T.line}`, color: T.muted, borderRadius: 8, padding: '6px 11px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}><Download size={10} /> Download</a>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* right column: brief + strategy + script + director feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {film.brief ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
              <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Product brief</div>
              <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 800 }}>{film.brief.product_name}</div>
              {film.brief.tagline ? <div style={{ color: T.muted, fontSize: 11.5, marginTop: 3 }}>{film.brief.tagline}</div> : null}
              {film.brief.problem ? <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.55, marginTop: 8 }}><span style={{ color: T.dim, fontWeight: 700 }}>Problem:</span> {film.brief.problem}</div> : null}
              {film.brief.positioning ? <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.55, marginTop: 6 }}>{film.brief.positioning}</div> : null}
              {film.brief.pricing ? <div style={{ color: T.dim, fontSize: 11, marginTop: 6 }}>Pricing: {film.brief.pricing}</div> : null}
              {film.brief.brand?.colors ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {Object.values(film.brief.brand.colors).filter((c): c is string => !!c && /^#/.test(String(c))).slice(0, 5).map((c, i) => (
                    <span key={`${c}${i}`} title={c} style={{ width: 20, height: 20, borderRadius: 6, background: c, border: `1px solid ${T.lineStrong}` }} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {film.strategy ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
              <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Ad strategy</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ color: T.coral, fontSize: 10, fontWeight: 800, fontFamily: T.mono, border: `1px solid ${T.coral}55`, background: 'rgba(255,107,74,0.1)', borderRadius: 999, padding: '3px 9px' }}>{film.strategy.hook_type.toUpperCase()} HOOK</span>
                <span style={{ color: T.muted, fontSize: 10, fontFamily: T.mono, border: `1px solid ${T.line}`, borderRadius: 999, padding: '3px 9px' }}>{film.strategy.music_style}</span>
              </div>
              {film.strategy.hook_line ? <div style={{ color: T.bone, fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>“{film.strategy.hook_line}”</div> : null}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {film.strategy.structure.map((b, i) => (
                  <span key={`${b}${i}`} style={{ color: T.muted, fontSize: 9, fontWeight: 700, fontFamily: T.mono, background: 'rgba(141,139,148,0.1)', borderRadius: 5, padding: '3px 7px' }}>{b}{i < film.strategy!.structure.length - 1 ? ' →' : ''}</span>
                ))}
              </div>
              <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5 }}>Tone: {film.strategy.tone}</div>
              <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>CTA: {film.strategy.cta}</div>
              {film.strategy.rationale ? <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.5, marginTop: 6 }}>{film.strategy.rationale}</div> : null}
            </div>
          ) : null}
          {film.ad_script?.scenes?.length && storyboard.length === 0 ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
              <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Voiceover script (written first)</div>
              <div className="pf-scroll" style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {film.ad_script.scenes.map((s: any, i: number) => (
                  <div key={`${s.beat}${i}`} style={{ borderLeft: `2px solid ${s.narration_url ? T.done : T.line}`, paddingLeft: 9 }}>
                    <div style={{ color: T.dim, fontSize: 9, fontWeight: 700, fontFamily: T.mono }}>{s.beat}{s.narration_s ? ` · ${Number(s.narration_s).toFixed(1)}s` : ''}</div>
                    <div style={{ color: T.bone, fontSize: 11.5, fontStyle: 'italic', lineHeight: 1.5 }}>“{s.narration}”</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {film.plan?.creative_direction ? (
            <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
              <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Creative direction</div>
              <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.6 }}>{film.plan.creative_direction}</div>
              {film.strategy?.music_brief ? <div style={{ color: T.dim, fontSize: 11, marginTop: 8 }}>♪ {film.strategy.music_brief}</div> : null}
            </div>
          ) : null}
          <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
            <div style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Director feed</div>
            <div className="pf-scroll" style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.length === 0 ? <div style={{ color: T.dim, fontSize: 11.5 }}>Live production notes appear here.</div>
                : [...notes].reverse().map((n) => (
                  <div key={`${n.at}-${n.text.slice(0, 18)}`} className="pf-note" style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5 }}>
                    <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 10 }}>{new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {n.text}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
