/**
 * ADS STUDIO — agentic short-form ad engine.
 *
 * A linear 8-step workflow (Product → Research → Angles → Script → Scene Plan
 * → Generate → Review → Variations) where Claude Opus 5 makes the creative
 * decisions, Veo films the avatar clips, GSAP/SVG renders the overlay layer,
 * and FFmpeg.wasm assembles the final MP4 in the browser. No Remotion.
 *
 * Standalone: shares no module with Product Video, SceneForge, Video Enhancer
 * or Script-to-Video. Session persists to localStorage — refresh and continue.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronRight, Circle, Download, Film, Pencil,
  Play, Plus, RefreshCw, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import {
  AdsSession, ClipDuration, GeneratedClip, ScenePlan, ScriptClip,
  STEPS, T, UploadedAsset, WORD_LIMITS, clearSession, emptySession,
  generateImageAsset, loadSession, saveSession, uploadUserFile, wordCount,
} from './api';
import { Btn, Spin, Tag, card, inputStyle, labelStyle } from './ui';
import {
  assembleVeoPrompt, buildScenePlan, castPresenter, continuityNoteFromFrame,
  fetchSiteResearch, generateAngles, generateVariationMatrix, pickBestAngle,
  presenterFallbackDescription, presenterPortraitBrief,
  regenerateScenePlanForClip, researchProduct, writeScript,
} from './opus';
import { generateClipAgentic, assembleWithOverlays, ResolvedClip } from './pipeline';
import RecipesPanel from './RecipesPanel';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';
import { engineDisplayName, usePersistentEngine } from '../../components/EngineSelector';
import VideoIntegrationPicker from '../../components/VideoIntegrationPicker';
import { loadVideoSelection, saveVideoSelection, type VideoIntegrationId } from '../../lib/videoIntegrations';
import { omniFallbackMessage } from '../../lib/omniFallback';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import AppShell from '../../components/ui/AppShell';
import VergeMark from '../../components/ui/VergeMark';

// ---------------------------------------------------------------------------
// Small UI atoms — card, inputStyle, labelStyle, Btn, Tag and Spin live in
// ./ui so the Recipes tab renders in the same language as the eight steps.
// ---------------------------------------------------------------------------

function customerError(value: unknown): string {
  const raw = String(value || 'This step could not be completed.');
  const named = raw
    .replace(/gemini-omni-flash-preview/g, engineDisplayName('gemini-omni-flash-preview'))
    .replace(/veo-3\.1-fast-generate-preview/g, engineDisplayName('veo-3.1-fast-generate-preview'))
    .replace(/veo-3\.1-generate-preview/g, engineDisplayName('veo-3.1-generate-preview'))
    .replace(/openrouter\/[^\s,;]+/g, (id) => engineDisplayName(id));
  if (/no_credentials|\b401\b/i.test(named)) return 'Your workspace session is not ready yet. Try again in a moment.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The production service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'A production service is temporarily unavailable. Your completed work is safe; retry this step shortly.';
  return named;
}

function FilePick(props: { label: string; multiple?: boolean; accept: string; onFiles: (files: File[]) => void; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      {props.label ? <span style={labelStyle}>{props.label}</span> : null}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: T.muted, border: `1px dashed ${T.lineStrong}` }}
      >
        <Upload size={15} /> {props.hint || (props.multiple ? 'Upload files' : 'Upload file')}
      </button>
      <input
        ref={ref} type="file" accept={props.accept} multiple={props.multiple} style={{ display: 'none' }}
        onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) props.onFiles(files); e.target.value = ''; }}
      />
    </div>
  );
}

function AssetChips(props: { items: UploadedAsset[]; onRemove: (i: number) => void }) {
  if (!props.items.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {props.items.map((a, i) => (
        <span key={a.url} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: '4px 8px', fontSize: 12, color: T.soft }}>
          {/\.(png|jpe?g|webp|gif)/i.test(a.url) ? <img src={a.url} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 4 }} /> : <Play size={13} />}
          {a.name.slice(0, 26)}
          <X size={12} style={{ cursor: 'pointer', color: T.muted }} onClick={() => props.onRemove(i)} />
        </span>
      ))}
    </div>
  );
}

function PromptEditor(props: { initial: string; onRun: (prompt: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <div style={{ marginTop: 8 }}>
      <textarea style={{ ...inputStyle, minHeight: 140, fontSize: 12, fontFamily: T.mono }} value={value} onChange={(e) => setValue(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <Btn small kind="primary" onClick={() => props.onRun(value)}><Play size={12} /> Regenerate with this prompt</Btn>
        <Btn small onClick={props.onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responsive shell CSS — injected beside the inline styles. Below 768px the
// fixed 216px step rail collapses into a horizontally scrollable top bar and
// the main panel padding tightens, so the eight steps and the Recipes surface
// fit a phone without horizontal overflow. Desktop and tablet keep the exact
// inline-styled layout (the overrides only exist inside the media query).
// ---------------------------------------------------------------------------

const ADS_RESPONSIVE_CSS = `
@keyframes adsspin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
@keyframes ads-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes ads-pulse { 0%, 100% { opacity: .4; } 50% { opacity: .78; } }
.ads-rise { animation: ads-rise .34s cubic-bezier(.22,.9,.3,1) both; }
.ads-skeleton { animation: ads-pulse 1.5s ease-in-out infinite; }
.ads-studio-app button, .ads-studio-app a { transition: transform .16s cubic-bezier(.22,.9,.3,1), background-color .16s ease, border-color .16s ease, box-shadow .2s ease, color .16s ease, opacity .16s ease; }
.ads-studio-app button:active:not(:disabled), .ads-studio-app a:active { transform: scale(.97); }
.ads-studio-app button:hover:not(:disabled) { filter: brightness(1.08); }
.ads-studio-app input:not([type='checkbox']):not([type='radio']), .ads-studio-app textarea, .ads-studio-app select { box-shadow: 0 0 0 1px ${T.lineStrong}; transition: box-shadow .18s ease, border-color .18s ease, background-color .18s ease; }
.ads-studio-app input:not([type='checkbox']):not([type='radio']):focus, .ads-studio-app textarea:focus, .ads-studio-app select:focus { outline: none; border-color: ${T.accent} !important; box-shadow: 0 0 0 1px ${T.accent}, 0 0 0 4px color-mix(in srgb, ${T.accent} 18%, transparent); }
.ads-card { transition: transform .22s cubic-bezier(.22,.9,.3,1), box-shadow .22s ease, border-color .22s ease; }
.ads-card:hover { transform: translateY(-2px); box-shadow: 0 16px 34px rgba(120,80,0,.12); }
@supports (interpolate-size: allow-keywords) { .ads-studio-app { interpolate-size: allow-keywords; } .ads-studio-app details::details-content { block-size: 0; opacity: 0; overflow: clip; transition: block-size .32s cubic-bezier(.22,.9,.3,1), opacity .22s ease; } .ads-studio-app details[open]::details-content { block-size: auto; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ads-studio-app *, .ads-studio-app *::before, .ads-studio-app *::after { animation: none !important; transition-duration: 0.01ms !important; } }
@media (max-width: 767px) {
  .ads-studio-app { flex-direction: column !important; }
  .ads-rail {
    width: 100% !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 10px 12px !important;
    border-right: none !important;
    border-bottom: 1px solid var(--space-border-default, rgba(148,163,184,0.16)) !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch;
  }
  .ads-rail > * { flex-shrink: 0 !important; }
  .ads-rail button { white-space: nowrap !important; }
  .ads-rail-brand { margin-bottom: 0 !important; padding-left: 0 !important; }
  .ads-rail-extra { margin-top: 0 !important; padding-top: 0 !important; border-top: none !important; }
  .ads-rail-extra button { width: auto !important; }
  .ads-rail-footer { margin-top: 0 !important; padding-top: 0 !important; }
  .ads-main { padding: 16px 14px 48px !important; min-height: 0 !important; }
}
@media (max-width: 639px) {
  .ads-rail button { font-size: 11px !important; padding: 8px !important; }
  .ads-step-actions { width: 100%; flex-direction: column !important; align-items: stretch !important; }
  .ads-step-actions .ads-btn { justify-content: center; }
  .ads-review-card { flex-direction: column !important; }
  .ads-review-thumb { width: 100% !important; max-width: 240px; }
  .ads-review-copy { min-width: 0 !important; width: 100%; }
  .ads-engine-toast { left: 12px !important; right: 12px !important; bottom: 76px !important; max-width: none !important; }
}
`;

type ClipPhaseStatus = 'pending' | 'running' | 'done' | 'failed';
type ClipPhase = { id: 'render' | 'frames' | 'inspect' | 'retake' | 'continuity'; label: string; status: ClipPhaseStatus; startedAt?: number; elapsedMs?: number };

const CLIP_PHASES: Pick<ClipPhase, 'id' | 'label'>[] = [
  { id: 'render', label: 'Film the clip' },
  { id: 'frames', label: 'Extract review frames' },
  { id: 'inspect', label: 'Director inspection' },
  { id: 'retake', label: 'Retake if needed' },
  { id: 'continuity', label: 'Continuity handoff' },
];

function freshClipPhases(): ClipPhase[] {
  return CLIP_PHASES.map((phase) => ({ ...phase, status: 'pending' }));
}

function formatClipElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

export default function AdsStudioApp() {
  const [s, setS] = useState<AdsSession>(() => loadSession());
  const [stageNote, setStageNote] = useState('');
  const [ffLogs, setFfLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<number | null>(null);
  const [clipPhases, setClipPhases] = useState<Record<number, ClipPhase[]>>({});
  const [phaseNow, setPhaseNow] = useState(Date.now());
  // Recipes — the fourth top-level surface, living ALONGSIDE the eight-step
  // Veo workflow: Saved Videos (the workspace clip library) and the Runway
  // recipe templates, which cast their own presenter and write their own ad
  // angle from the product. Opening it parks the workflow exactly where it
  // stands; nothing in the session is touched until the customer presses
  // "Use in Ad" on a saved clip.
  const [runwayOpen, setRunwayOpen] = useState(false);
  // Engine every clip in this run renders on. Omni Flash stays the default
  // (it is the only model that keeps the same presenter across cuts via the
  // avatar reference); the Runway roster is the cinematic alternative. The
  // choice persists for the whole browser session, so it stays selected
  // across steps, regenerations and reopened sessions.
  const initialVideo = loadVideoSelection();
  const [clipEngine, setClipEngine] = usePersistentEngine('ads-studio:clip-engine', initialVideo.model);
  const [clipIntegration, setClipIntegration] = useState<VideoIntegrationId>(() => initialVideo.integration);

  function onClipVideoSelection(integration: VideoIntegrationId, model: string) {
    setClipIntegration(integration);
    setClipEngine(model);
    saveVideoSelection(integration, model);
  }
  // Said out loud whenever a clip rendered on a different engine than the one
  // picked — the picker offers the whole roster, so this is how the customer
  // learns which of it the platform actually accepted today.
  const [toast, setToast] = useState('');
  const busy = useRef(false);
  const live = useRef(s);
  useEffect(() => { live.current = s; saveSession(s); }, [s]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('ads-studio');
    if (!handoff || handoff.projectId != null) return;
    if (handoff.videoIntegration && handoff.videoModel) {
      onClipVideoSelection(handoff.videoIntegration as VideoIntegrationId, handoff.videoModel);
    } else if (handoff.videoModel) {
      setClipEngine(handoff.videoModel);
    } else if (handoff.videoIntegration) {
      setClipIntegration(handoff.videoIntegration as VideoIntegrationId);
    }
    const prompt = String(handoff.prompt || '').trim();
    const url = prompt.match(/https?:\/\/[^\s]+/i)?.[0] || '';
    const attachment = handoff.attachment;
    setS((current) => {
      const next: AdsSession = {
        ...current,
        productUrl: url || current.productUrl,
        productDescription: prompt || current.productDescription,
        currentStep: 1,
      };
      if (!attachment) return next;
      const asset = { name: attachment.name, url: attachment.url };
      if (attachment.type.startsWith('video/')) next.productVideos = [...next.productVideos.filter((item) => item.url !== asset.url), asset];
      else if (attachment.type.startsWith('image/')) next.productImages = [...next.productImages.filter((item) => item.url !== asset.url), asset];
      else next.productDescription = `${next.productDescription}\nReference asset (${attachment.name}): ${attachment.url}`.trim();
      return next;
    });
  }, []);

  const patch = (p: Partial<AdsSession>) => setS((prev) => ({ ...prev, ...p }));
  const say = (n: string) => setStageNote(n);
  const anyPhaseRunning = Object.values(clipPhases).some((steps) => steps.some((step) => step.status === 'running'));
  useEffect(() => {
    if (!anyPhaseRunning) return;
    const timer = window.setInterval(() => setPhaseNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyPhaseRunning]);

  function startClipPhases(clipNumber: number) {
    const now = Date.now();
    setPhaseNow(now);
    setClipPhases((all) => ({ ...all, [clipNumber]: freshClipPhases().map((step) => step.id === 'render' ? { ...step, status: 'running', startedAt: now } : step) }));
  }

  function enterClipPhase(clipNumber: number, id: ClipPhase['id']) {
    const now = Date.now();
    setPhaseNow(now);
    setClipPhases((all) => {
      const current = all[clipNumber] || freshClipPhases();
      const retakeRunning = current.some((step) => step.id === 'retake' && step.status === 'running');
      if (retakeRunning && (id === 'frames' || id === 'inspect')) return all;
      const targetIndex = current.findIndex((step) => step.id === id);
      return { ...all, [clipNumber]: current.map((step, index) => {
        if (step.id === id) return step.status === 'running' ? step : { ...step, status: 'running', startedAt: now, elapsedMs: undefined };
        if (step.status === 'running') return { ...step, status: 'done', elapsedMs: step.startedAt ? Math.max(0, now - step.startedAt) : undefined };
        if (index < targetIndex && step.status === 'pending') return { ...step, status: 'done' };
        return step;
      }) };
    });
  }

  function noteClipPhase(clipNumber: number, message: string) {
    say(message);
    if (/reading the end state|continuity/i.test(message)) enterClipPhase(clipNumber, 'continuity');
    else if (/rejected|retak|trying once more/i.test(message)) enterClipPhase(clipNumber, 'retake');
    else if (/inspecting the take|director is inspecting/i.test(message)) enterClipPhase(clipNumber, 'inspect');
    else if (/extracting frames/i.test(message)) enterClipPhase(clipNumber, 'frames');
    else if (/filming|generating/i.test(message)) enterClipPhase(clipNumber, 'render');
  }

  function finishClipPhases(clipNumber: number, succeeded: boolean) {
    const now = Date.now();
    setPhaseNow(now);
    setClipPhases((all) => ({ ...all, [clipNumber]: (all[clipNumber] || freshClipPhases()).map((step) => {
      if (step.status === 'running') return { ...step, status: succeeded ? 'done' : 'failed', elapsedMs: step.startedAt ? Math.max(0, now - step.startedAt) : undefined };
      if (succeeded && step.status === 'pending') return { ...step, status: 'done' };
      return step;
    }) }));
  }

  function fail(context: string, e: any) {
    say(`${context}: ${customerError(e?.message || e)}`);
  }

  // ------------------------------------------------------------- uploads ----
  async function addFiles(kind: 'avatar' | 'screenshots' | 'productImages' | 'productVideos' | 'logo', files: File[]) {
    for (const f of files) {
      say(`Uploading ${f.name}…`);
      try {
        const asset = await uploadUserFile(f);
        setS((prev) => {
          if (kind === 'avatar') return { ...prev, avatar: asset };
          if (kind === 'logo') return { ...prev, logo: asset };
          return { ...prev, [kind]: [...prev[kind], asset] } as AdsSession;
        });
      } catch (e: any) { fail(`Could not upload ${f.name}`, e); return; }
    }
    say('');
  }

  // ------------------------------------------------ recipes → the workflow ----
  // The Recipes tab is read-only against the session. This handler is the only
  // door back into the eight steps.

  function adoptVideo(video: { name: string; url: string }) {
    setS((prev) => ({
      ...prev,
      productVideos: prev.productVideos.some((v) => v.url === video.url)
        ? prev.productVideos
        : [...prev.productVideos, { name: video.name, url: video.url }],
      currentStep: 1,
    }));
    setRunwayOpen(false);
    say('Clip attached as product footage — it is in Step 1 under Advanced assets.');
  }

  // ------------------------------------------------------------ research ----
  async function runResearch() {
    if (busy.current) return;
    const cur = live.current;
    if (!cur.productUrl.trim() && !cur.productDescription.trim()) { say('Add a product URL (or at least a description) first.'); return; }
    busy.current = true;
    patch({ isProcessing: true, researchStatus: 'loading', researchError: null, currentStep: 2 });
    try {
      const site = cur.productUrl.trim()
        ? await fetchSiteResearch(cur.productUrl.trim(), say)
        : { main: null, subpages: [], failure: 'No URL provided — using the description only.' };
      say('Your director is analysing the product…');
      const research = await researchProduct({ url: cur.productUrl.trim(), description: cur.productDescription, offerCta: cur.offerCta, site });
      patch({ research, researchStatus: 'done', isProcessing: false });
      say(site.failure ? `Research done. Note: ${site.failure} You can correct anything below.` : 'Research done — review it below.');
    } catch (e: any) {
      patch({ researchStatus: 'error', researchError: String(e?.message || e), isProcessing: false });
      fail('Research failed', e);
    } finally { busy.current = false; }
  }

  // -------------------------------------------------------------- angles ----
  async function runAngles() {
    if (busy.current || !live.current.research) return;
    busy.current = true;
    patch({ isProcessing: true, currentStep: 3 });
    say('Your director is generating ad angles…');
    try {
      const angles = await generateAngles(live.current.research!, live.current.offerCta);
      patch({ angles, selectedAngleIds: [], activeAngleId: null, opusPick: null, isProcessing: false });
      say(`${angles.length} angles ready — pick one or more.`);
    } catch (e: any) { patch({ isProcessing: false }); fail('Angle generation failed', e); }
    finally { busy.current = false; }
  }

  async function runOpusPick() {
    if (busy.current || !live.current.angles.length) return;
    busy.current = true;
    patch({ isProcessing: true });
    say('Your director is picking the strongest angle…');
    try {
      const pick = await pickBestAngle(live.current.research!, live.current.angles);
      setS((prev) => ({
        ...prev, opusPick: pick, isProcessing: false,
        selectedAngleIds: prev.selectedAngleIds.includes(pick.angleId) ? prev.selectedAngleIds : [...prev.selectedAngleIds, pick.angleId],
        activeAngleId: pick.angleId,
      }));
      say('Your director made its pick — see the highlighted card.');
    } catch (e: any) { patch({ isProcessing: false }); fail('The pick failed', e); }
    finally { busy.current = false; }
  }

  // -------------------------------------------------------------- script ----
  async function runScript(angleId: string) {
    if (busy.current) return;
    const angle = live.current.angles.find((a) => a.id === angleId);
    if (!angle || !live.current.research) return;
    busy.current = true;
    patch({ isProcessing: true, activeAngleId: angleId, currentStep: 4 });
    say(`Your director is writing the script for “${angle.angle_name}”…`);
    try {
      const script = await writeScript(live.current.research!, angle, live.current.offerCta);
      patch({ script, scenePlan: [], clips: [], finalVideoUrl: null, assemblyStatus: 'idle', matrix: null, variations: [], isProcessing: false });
      say('Script ready — edit any line, then continue.');
    } catch (e: any) { patch({ isProcessing: false }); fail('Script writing failed', e); }
    finally { busy.current = false; }
  }

  function setScriptLine(i: number, line: string) {
    setS((prev) => ({
      ...prev,
      script: prev.script.map((c, idx) => idx === i ? { ...c, spoken_line: line, word_count: wordCount(line) } : c),
    }));
  }

  function setScriptDuration(i: number, d: ClipDuration) {
    setS((prev) => ({ ...prev, script: prev.script.map((c, idx) => idx === i ? { ...c, duration_seconds: d } : c) }));
  }

  // Vidverge Agent — the floating orb assistant. It fills the product brief
  // and walks the 8-step ad workflow (research → angles → script → …) for the
  // customer.
  const agentContext = {
    appId: 'ads-studio',
    appName: 'Ads Studio',
    currentInputs: {
      step: String(s.currentStep),
      productUrl: s.productUrl,
      productDescription: String(s.productDescription || '').slice(0, 500),
      offerCta: String(s.offerCta || '').slice(0, 200),
      researchDone: s.research ? 'yes' : 'no',
      anglesReady: String(s.angles.length),
    },
    onFillField: (field: string, value: string) => {
      if (field === 'productUrl') patch({ productUrl: value });
      else if (field === 'productDescription' || field === 'productName' || field === 'tagline') patch({ productDescription: value });
      else if (field === 'offerCta') patch({ offerCta: value });
    },
    onTriggerAction: (action: string) => {
      if (action === 'generate' || action === 'research') void runResearch();
      else if (action === 'angles') void runAngles();
      else if (action === 'opusPick') void runOpusPick();
    },
    promptHint: [
      'The user creates short-form video ads through an 8-step workflow (Product → Research → Angles → Script → Scene Plan → Generate → Review → Variations).',
      'Fields you can fill: productUrl (the product website), productDescription (product name, tagline and what it does), offerCta (the offer / call to action).',
      'Actions you can trigger: generate (runs product research from the URL/description — the workflow continues from there), angles (generate ad angles, needs research done), opusPick (have the AI pick the strongest angle).',
      'Start by filling productUrl (or productDescription when there is no URL), then trigger generate. Later steps (script, scene plan, clips) run from the on-screen buttons — guide the user through them.',
    ].join('\n'),
  };

  const scriptViolations = s.script.filter((c) => c.word_count > WORD_LIMITS[c.duration_seconds]).length;

  // ----------------------------------------------------------- scene plan ----
  async function runScenePlan() {
    if (busy.current) return;
    const cur = live.current;
    const angle = cur.angles.find((a) => a.id === cur.activeAngleId);
    if (!angle || !cur.research || !cur.script.length) return;
    busy.current = true;
    patch({ isProcessing: true, currentStep: 5 });
    say('Your director is building the scene plan…');
    try {
      const assets = [...cur.screenshots, ...cur.productImages, ...(cur.logo ? [cur.logo] : [])];
      const { voiceDescription, accent, plans } = await buildScenePlan({
        research: cur.research!, angle, script: cur.script, assets, hasAvatar: !!cur.avatar,
      });

      // Asset generation — anything Opus flagged as genuinely missing.
      const needs = plans.flatMap((p) => p.generated_assets_needed || []);
      const generated = [...cur.generatedAssets];
      for (const need of needs.slice(0, 4)) {
        if (generated.some((g) => g.description === need.description)) continue; // reuse across clips
        try {
          say(`Generating asset: ${need.description.slice(0, 70)}…`);
          const url = await generateImageAsset(need.description, cur.aspect === '16:9' ? '16:9' : cur.aspect === '1:1' ? '1:1' : '9:16');
          generated.push({ ...need, url });
        } catch (e: any) { say(`Asset skipped (${String(e?.message || e).slice(0, 80)}).`); }
      }
      patch({ scenePlan: plans, voiceDescription: `${voiceDescription} · ${accent}`, generatedAssets: generated, isProcessing: false });
      say('Scene plan ready — review the storyboard.');
    } catch (e: any) { patch({ isProcessing: false }); fail('Scene planning failed', e); }
    finally { busy.current = false; }
  }

  async function regenPlanForClip(clipNumber: number) {
    if (busy.current) return;
    const cur = live.current;
    const angle = cur.angles.find((a) => a.id === cur.activeAngleId);
    if (!angle || !cur.research) return;
    busy.current = true;
    patch({ isProcessing: true });
    say(`Re-planning clip ${clipNumber}…`);
    try {
      const parts = cur.voiceDescription.split(' · ');
      const plan = await regenerateScenePlanForClip({
        research: cur.research!, angle, script: cur.script, clipNumber,
        voiceDescription: parts[0] || cur.voiceDescription, accent: parts[1] || 'neutral American',
        assets: [...cur.screenshots, ...cur.productImages],
      });
      setS((prev) => ({ ...prev, scenePlan: prev.scenePlan.map((p) => p.clip_number === clipNumber ? plan : p), isProcessing: false }));
      say(`Clip ${clipNumber} re-planned.`);
    } catch (e: any) { patch({ isProcessing: false }); fail('Re-planning failed', e); }
    finally { busy.current = false; }
  }

  function editPlanField(clipNumber: number, field: keyof ScenePlan, value: any) {
    setS((prev) => ({
      ...prev,
      scenePlan: prev.scenePlan.map((p) => {
        if (p.clip_number !== clipNumber) return p;
        const next = { ...p, [field]: value } as ScenePlan;
        if (field !== 'veo_prompt') {
          const sc = prev.script.find((c) => c.clip_number === clipNumber);
          next.veo_prompt = assembleVeoPrompt(next, sc?.duration_seconds || 6, null);
        }
        return next;
      }),
    }));
  }

  // ----------------------------------------------------------- generation ----

  /** THE LOCKED PRESENTER — cast once per session and reused by every clip,
   * the mechanism Script-to-Video uses: one reference image, generated a
   * single time, sent with every generation so the actor cannot drift from
   * clip to clip. An uploaded avatar IS the lock; without one the presenter is
   * cast and their portrait generated once, then remembered on the session so
   * resumes, retakes and variations all reuse the same face. A portrait that
   * cannot be generated degrades to the locked text description — it never
   * stops the run. */
  async function ensureCast(cur: AdsSession): Promise<{ url: string | null; description: string }> {
    if (cur.avatar?.url) return { url: cur.avatar.url, description: cur.castDescription };
    if (cur.castUrl) return { url: cur.castUrl, description: cur.castDescription };
    let description = cur.castDescription;
    if (!description) {
      const parts = cur.voiceDescription.split(' · ');
      if (cur.research) {
        say('Casting the presenter who fronts every clip…');
        try {
          description = await castPresenter({
            research: cur.research,
            voiceDescription: parts[0] || cur.voiceDescription,
            accent: parts[1] || 'neutral American',
            plans: cur.scenePlan,
          });
        } catch { description = ''; }
      }
      if (!description) description = presenterFallbackDescription(cur.scenePlan, cur.voiceDescription);
    }
    say('Locking the presenter’s reference image…');
    try {
      const url = await generateImageAsset(
        presenterPortraitBrief(description, cur.scenePlan[0]?.visual_style || ''),
        '9:16',
      );
      patch({ castUrl: url, castDescription: description });
      return { url, description };
    } catch (e: any) {
      say(`The presenter reference image could not be generated (${String(e?.message || e).slice(0, 80)}) — the locked description carries the consistency instead.`);
      patch({ castDescription: description });
      return { url: null, description };
    }
  }

  function setClipState(clipNumber: number, p: Partial<GeneratedClip>) {
    setS((prev) => ({ ...prev, clips: prev.clips.map((c) => c.clipNumber === clipNumber ? { ...c, ...p } : c) }));
  }

  async function runGeneration() {
    if (busy.current) return;
    const cur = live.current;
    if (!cur.scenePlan.length) return;
    busy.current = true;
    patch({ isProcessing: true, currentStep: 6 });
    // Seed the grid — clips already accepted are kept so a resume never re-bills.
    let clips: GeneratedClip[] = cur.script.map((sc) => {
      const existing = cur.clips.find((c) => c.clipNumber === sc.clip_number);
      if (existing && existing.videoUrl && (existing.status === 'accepted' || existing.status === 'regenerated')) return existing;
      return { clipNumber: sc.clip_number, videoUrl: null, status: 'pending' as const, issues: [], attempts: 0, lastFrameUrl: null, promptUsed: '', note: '' };
    });
    patch({ clips });

    // One presenter for the whole run, resolved before the first submit. A
    // resume with nothing left to render never casts (and never pays for a
    // portrait it will not use).
    const cast = clips.some((c) => !c.videoUrl)
      ? await ensureCast(cur)
      : { url: cur.avatar?.url || cur.castUrl, description: cur.castDescription };

    let continuity: string | null = null;
    let prevFrame: string | null = null;
    for (const sc of cur.script) {
      const plan = cur.scenePlan.find((p) => p.clip_number === sc.clip_number);
      if (!plan) continue;
      const existing = clips.find((c) => c.clipNumber === sc.clip_number)!;
      if (existing.videoUrl && (existing.status === 'accepted' || existing.status === 'regenerated')) {
        prevFrame = existing.lastFrameUrl;
        continuity = existing.lastFrameUrl ? await continuityNoteFromFrame(existing.lastFrameUrl) : null;
        continue;
      }
      setClipState(sc.clip_number, { status: 'generating' });
      startClipPhases(sc.clip_number);
      say(`Generating clip ${sc.clip_number} of ${cur.script.length}…`);
      const res = await generateClipAgentic({
        plan: { ...plan, spoken_line: sc.spoken_line }, script: sc, aspect: cur.aspect,
        characterRefUrl: cast.url, characterDescription: cast.description, model: clipEngine, integration: clipIntegration,
        continuityNote: continuity, previousFrameUrl: prevFrame, onNote: (message) => noteClipPhase(sc.clip_number, message),
      });
      finishClipPhases(sc.clip_number, Boolean(res.videoUrl));
      if (res.fallbackFrom) setToast(omniFallbackMessage(res.fallbackFrom));
      clips = clips.map((c) => c.clipNumber === sc.clip_number ? {
        ...c, videoUrl: res.videoUrl, status: res.status, issues: res.issues,
        attempts: res.attempts, lastFrameUrl: res.lastFrameUrl, promptUsed: res.promptUsed, modelUsed: res.modelUsed, note: res.note,
      } : c);
      setClipState(sc.clip_number, clips.find((c) => c.clipNumber === sc.clip_number)!);
      if (res.videoUrl) { prevFrame = res.lastFrameUrl; continuity = res.continuityNote || null; }
    }
    const failed = clips.filter((c) => !c.videoUrl).length;
    patch({ isProcessing: false, clips });
    say(failed ? `${failed} clip(s) failed — regenerate them from their cards, then review.` : 'All clips generated — head to Review.');
    busy.current = false;
  }

  async function regenerateOneClip(clipNumber: number, promptOverride?: string) {
    if (busy.current) return;
    const cur = live.current;
    const sc = cur.script.find((c) => c.clip_number === clipNumber);
    const plan = cur.scenePlan.find((p) => p.clip_number === clipNumber);
    if (!sc || !plan) return;
    busy.current = true;
    patch({ isProcessing: true });
    setClipState(clipNumber, { status: 'generating', issues: [], note: '' });
    startClipPhases(clipNumber);
    try {
      const prev = cur.clips.filter((c) => c.clipNumber < clipNumber && c.lastFrameUrl).sort((a, b) => b.clipNumber - a.clipNumber)[0];
      const continuity = prev?.lastFrameUrl ? await continuityNoteFromFrame(prev.lastFrameUrl) : null;
      const cast = await ensureCast(cur);
      const res = await generateClipAgentic({
        plan: { ...plan, spoken_line: sc.spoken_line }, script: sc, aspect: cur.aspect,
        characterRefUrl: cast.url, characterDescription: cast.description,
        model: clipEngine, integration: clipIntegration, continuityNote: continuity,
        previousFrameUrl: prev?.lastFrameUrl || null, promptOverride: promptOverride || null, onNote: (message) => noteClipPhase(clipNumber, message),
      });
      finishClipPhases(clipNumber, Boolean(res.videoUrl));
      if (res.fallbackFrom) setToast(omniFallbackMessage(res.fallbackFrom));
      setClipState(clipNumber, { videoUrl: res.videoUrl, status: res.status, issues: res.issues, attempts: res.attempts, lastFrameUrl: res.lastFrameUrl, promptUsed: res.promptUsed, modelUsed: res.modelUsed, note: res.note });
      if (res.videoUrl && live.current.finalVideoUrl) patch({ finalVideoUrl: null, assemblyStatus: 'idle' });
      say(res.videoUrl ? `Clip ${clipNumber} regenerated.` : `Clip ${clipNumber} failed again — see its card.`);
    } catch (e: any) {
      finishClipPhases(clipNumber, false);
      setClipState(clipNumber, { status: 'failed', note: String(e?.message || e) });
      fail(`Clip ${clipNumber} regeneration failed`, e);
    } finally { busy.current = false; patch({ isProcessing: false }); }
  }

  // ------------------------------------------------------------- assembly ----
  function resolvedClips(lineOverrides?: Record<string, string>, clipOverrides?: Record<string, string>): ResolvedClip[] {
    const cur = live.current;
    return cur.script.map((sc) => {
      const plan = cur.scenePlan.find((p) => p.clip_number === sc.clip_number)!;
      const gen = cur.clips.find((c) => c.clipNumber === sc.clip_number);
      const line = (lineOverrides && lineOverrides[String(sc.clip_number)] !== undefined) ? lineOverrides[String(sc.clip_number)] : sc.spoken_line;
      const url = (clipOverrides && clipOverrides[String(sc.clip_number)]) || gen?.videoUrl || '';
      return {
        plan: { ...plan, spoken_line: line },
        script: { ...sc, spoken_line: line, word_count: wordCount(line) },
        videoUrl: url,
        durationS: sc.duration_seconds,
      };
    }).filter((rc) => rc.videoUrl);
  }

  async function runAssembly() {
    if (busy.current) return;
    const cur = live.current;
    const ready = resolvedClips();
    if (!ready.length) { say('No finished clips to assemble yet.'); return; }
    busy.current = true;
    patch({ isProcessing: true, assemblyStatus: 'assembling', assemblyError: null });
    setFfLogs([]);
    try {
      const result = await assembleWithOverlays({
        clips: ready, session: cur,
        reviewQuote: (cur.research?.customer_language || [])[0] || '',
        fileTag: 'main',
        onProgress: (note) => say(note),
        onLog: (line) => setFfLogs((prev) => prev.length > 400 ? [...prev.slice(-380), line] : [...prev, line]),
      });
      setBlobUrl(result.blobUrl);
      patch({ finalVideoUrl: result.url, assemblyStatus: 'done', isProcessing: false, currentStep: 7 });
      say(`Final ad assembled (${(result.bytes / (1024 * 1024)).toFixed(1)} MB).`);
    } catch (e: any) {
      patch({ assemblyStatus: 'error', assemblyError: String(e?.message || e), isProcessing: false });
      fail('Assembly failed', e);
    } finally { busy.current = false; }
  }

  // ------------------------------------------------------------ variations ----
  async function runMatrix() {
    if (busy.current) return;
    const cur = live.current;
    const angle = cur.angles.find((a) => a.id === cur.activeAngleId);
    if (!angle || !cur.research || !cur.script.length) return;
    busy.current = true;
    patch({ isProcessing: true, currentStep: 8 });
    say('Your director is writing alternative hooks, bodies and calls to action…');
    try {
      const matrix = await generateVariationMatrix({ research: cur.research!, angle, script: cur.script });
      patch({ matrix, isProcessing: false });
      say('Variation matrix ready — pick the combinations to build.');
    } catch (e: any) { patch({ isProcessing: false }); fail('The variation matrix failed', e); }
    finally { busy.current = false; }
  }

  async function buildVariation(hookIdx: number, bodyIdx: number, ctaIdx: number) {
    if (busy.current) return;
    const cur = live.current;
    const m = cur.matrix;
    if (!m || !cur.script.length) return;
    const id = `v_${hookIdx}${bodyIdx}${ctaIdx}`;
    busy.current = true;
    patch({ isProcessing: true });
    setS((prev) => ({
      ...prev,
      variations: [
        ...prev.variations.filter((v) => v.id !== id),
        { id, hookIdx, bodyIdx, ctaIdx, status: 'generating' as const, error: null, videoUrl: null, clipVideos: {} },
      ],
    }));
    const setVar = (p: Partial<AdsSession['variations'][number]>) => setS((prev) => ({ ...prev, variations: prev.variations.map((v) => v.id === id ? { ...v, ...p } : v) }));
    try {
      // The line for every clip under this combination.
      const lines: Record<string, string> = {};
      const first = cur.script[0];
      const last = cur.script[cur.script.length - 1];
      cur.script.forEach((sc) => { lines[String(sc.clip_number)] = sc.spoken_line; });
      lines[String(first.clip_number)] = m.hooks[hookIdx] || first.spoken_line;
      lines[String(last.clip_number)] = m.ctas[ctaIdx] || last.spoken_line;
      const body = m.bodies[bodyIdx] || {};
      Object.entries(body).forEach(([k, v]) => { if (lines[k] !== undefined) lines[k] = v; });

      // Reuse every clip whose spoken line is unchanged; regenerate the rest.
      // The variation is fronted by the same locked presenter as the main ad.
      const cast = await ensureCast(cur);
      const clipVideos: Record<string, string> = {};
      let continuity: string | null = null;
      let prevFrame: string | null = null;
      for (const sc of cur.script) {
        const key = String(sc.clip_number);
        const original = cur.clips.find((c) => c.clipNumber === sc.clip_number);
        if (lines[key] === sc.spoken_line && original?.videoUrl) {
          clipVideos[key] = original.videoUrl;
          prevFrame = original.lastFrameUrl;
          continue;
        }
        say(`Variation H${hookIdx + 1}B${bodyIdx + 1}C${ctaIdx + 1}: regenerating clip ${sc.clip_number} with the new line…`);
        const plan = cur.scenePlan.find((p) => p.clip_number === sc.clip_number)!;
        const newScript: ScriptClip = { ...sc, spoken_line: lines[key], word_count: wordCount(lines[key]) };
        const newPlan: ScenePlan = { ...plan, spoken_line: lines[key] };
        const res = await generateClipAgentic({
          plan: newPlan, script: newScript, aspect: cur.aspect,
          characterRefUrl: cast.url, characterDescription: cast.description, model: clipEngine, integration: clipIntegration,
          continuityNote: continuity, previousFrameUrl: prevFrame, onNote: say,
        });
        if (!res.videoUrl) throw new Error(`Clip ${sc.clip_number} failed: ${res.note || res.issues.join('; ') || 'render error'}`);
        if (res.fallbackFrom) setToast(omniFallbackMessage(res.fallbackFrom));
        clipVideos[key] = res.videoUrl;
        prevFrame = res.lastFrameUrl;
        continuity = res.continuityNote || null;
      }

      setVar({ status: 'assembling', clipVideos });
      say('Assembling the variation…');
      const result = await assembleWithOverlays({
        clips: resolvedClips(lines, clipVideos), session: cur,
        reviewQuote: (cur.research?.customer_language || [])[0] || '',
        fileTag: id,
        onProgress: (note) => say(`Variation: ${note}`),
        onLog: (line) => setFfLogs((prev) => prev.length > 400 ? [...prev.slice(-380), line] : [...prev, line]),
      });
      setVar({ status: 'done', videoUrl: result.url });
      say('Variation ready.');
    } catch (e: any) {
      setVar({ status: 'error', error: String(e?.message || e) });
      fail('Variation build failed', e);
    } finally { busy.current = false; patch({ isProcessing: false }); }
  }

  // ------------------------------------------------------------ step gates ----
  function stepReachable(n: number): boolean {
    if (n <= 1) return true;
    if (n === 2) return !!(s.productUrl.trim() || s.productDescription.trim());
    if (n === 3) return !!s.research;
    if (n === 4) return s.selectedAngleIds.length > 0 && s.script.length > 0;
    if (n === 5) return s.script.length > 0 && s.scenePlan.length > 0;
    if (n === 6) return s.scenePlan.length > 0;
    if (n === 7) return s.clips.some((c) => !!c.videoUrl);
    if (n === 8) return !!s.finalVideoUrl;
    return false;
  }

  const totalSeconds = s.script.reduce((acc, c) => acc + c.duration_seconds, 0);
  const estMb = (totalSeconds * 0.5).toFixed(1);

  // ---------------------------------------------------------------- render ----
  return (
    <AppShell
      title="Ads Studio"
      header={false}
      watermark={false}
      scroll={false}
      maxWidth="full"
      padding={0}
    >
    <div className="ads-studio-app" style={{ display: 'flex', height: '100%', minHeight: 0, background: 'transparent', color: T.ink, fontFamily: T.sans }}>
      <style>{ADS_RESPONSIVE_CSS}</style>

      {/* ---- progress rail ---- */}
      <aside className="ads-rail" style={{ width: 216, flexShrink: 0, borderRight: `1px solid ${T.line}`, padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        <div className="ads-rail-brand" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14, paddingLeft: 6 }}>
          <VergeMark size={30} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em' }}>Ads Studio</div>
            <div style={{ fontSize: 10.5, color: T.muted }}>Agentic ad engine</div>
          </div>
        </div>
        {STEPS.map((st) => {
          const active = s.currentStep === st.n;
          const done = stepReachable(st.n + 1);
          const reachable = stepReachable(st.n);
          return (
            <button
              key={st.id} type="button"
              onClick={() => { if (!reachable) return; setRunwayOpen(false); patch({ currentStep: st.n }); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10,
                background: active ? T.raised : 'transparent', border: `1px solid ${active ? T.lineStrong : 'transparent'}`,
                color: reachable ? (active ? T.ink : T.soft) : T.muted, cursor: reachable ? 'pointer' : 'not-allowed',
                opacity: reachable ? 1 : 0.45, textAlign: 'left', fontFamily: T.sans, fontSize: 12.5, fontWeight: active ? 700 : 500,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: done ? T.good : active ? T.accent : T.panel, color: done || active ? '#ffffff' : T.muted,
                fontSize: 11, fontWeight: 800, border: `1px solid ${done || active ? 'transparent' : T.line}`,
              }}>{done ? <Check size={13} /> : st.n}</span>
              STEP {st.n}: {st.label.toUpperCase()}
            </button>
          );
        })}
        <div className="ads-rail-extra" style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.line}` }}>
          <button
            type="button"
            onClick={() => setRunwayOpen(true)}
            title="Recipes — Saved Videos and the Runway recipe templates, which write their own presenter and ad angle"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 10,
              background: runwayOpen ? T.raised : 'transparent', border: `1px solid ${runwayOpen ? T.lineStrong : 'transparent'}`,
              color: runwayOpen ? T.ink : T.soft, cursor: 'pointer', textAlign: 'left',
              fontFamily: T.sans, fontSize: 12.5, fontWeight: runwayOpen ? 700 : 500,
            }}
            data-testid="nav-recipes"
          >
            <span style={{
              width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: runwayOpen ? T.highlight : T.panel, color: runwayOpen ? '#FFFFFF' : T.muted,
              border: `1px solid ${runwayOpen ? 'transparent' : T.line}`,
            }}><Sparkles size={12} /></span>
            RECIPES
          </button>
        </div>
        <div className="ads-rail-footer" style={{ marginTop: 'auto', paddingTop: 14 }}>
          <Btn small kind="danger" onClick={() => { if (window.confirm('Start over? The current ad session is cleared (uploaded files stay in storage).')) { clearSession(); setS(emptySession()); setBlobUrl(null); setFfLogs([]); setClipPhases({}); setPhaseNow(Date.now()); say(''); } }}>
            <Trash2 size={13} /> New session
          </Btn>
        </div>
      </aside>

      {/* ---- main panel ---- */}
      <main className="ads-main" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px 60px' }}>
        {stageNote ? (
          <details style={{ ...card, marginBottom: 16, borderColor: T.lineStrong, background: T.panel }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: T.soft, listStylePosition: 'inside' }}>
              Production status — <span style={{ fontWeight: 500, color: T.muted }}>{customerError(stageNote)}</span>
            </summary>
            <div style={{ display: 'grid', gap: 5, marginTop: 10 }}>
              {STEPS.map((step) => {
                const done = step.n < s.currentStep && stepReachable(step.n + 1);
                const active = step.n === s.currentStep;
                return <div key={step.id} style={{ fontSize: 11.5, color: done ? T.good : active ? T.highlight : T.muted }}>{done ? '✓' : active ? '•' : '○'} {step.label}</div>;
              })}
            </div>
          </details>
        ) : null}

        {runwayOpen ? (
          <RecipesPanel
            onUseVideo={adoptVideo}
            prefill={{
              productName: s.research?.product_name || '',
              productDescription: s.research?.one_liner || s.productDescription,
              productImage: s.productImages[0]?.url || s.screenshots[0]?.url || '',
              sourceVideo: s.productVideos[0]?.url || '',
            }}
          />
        ) : (
        <>
        {/* ================= STEP 1 — PRODUCT ================= */}
        {s.currentStep === 1 && (
          <div style={{ maxWidth: 760 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Product intake</h2>
            <p style={{ margin: '0 0 20px', color: T.muted, fontSize: 13.5 }}>Everything the engine works from. The URL is required; the avatar keeps the same presenter across every clip.</p>
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={card}>
                <span style={labelStyle}>Product URL (required)</span>
                <input style={inputStyle} placeholder="https://yourproduct.com" value={s.productUrl} onChange={(e) => patch({ productUrl: e.target.value })} />
                <details style={{ marginTop: 14 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: T.soft, listStylePosition: 'inside' }}>Advanced <span style={{ color: T.muted, fontWeight: 500 }}>— description, offer and format: {s.aspect}</span></summary>
                  <div style={{ height: 12 }} />
                <span style={labelStyle}>Product description (optional — supplements the URL)</span>
                <textarea style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }} value={s.productDescription} onChange={(e) => patch({ productDescription: e.target.value })} placeholder="What it does, who it's for, what makes it different…" />
                <div style={{ height: 12 }} />
                <span style={labelStyle}>Offer / CTA (optional)</span>
                <input style={inputStyle} placeholder='e.g. "Get 50% off today"' value={s.offerCta} onChange={(e) => patch({ offerCta: e.target.value })} />
                <div style={{ height: 12 }} />
                <span style={labelStyle}>Ad format</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['9:16', '1:1', '16:9'] as const).map((a) => (
                    <Btn key={a} small kind={s.aspect === a ? 'primary' : 'ghost'} onClick={() => patch({ aspect: a })}>{a === '9:16' ? '9:16 · Reels/TikTok' : a === '1:1' ? '1:1 · Feed' : '16:9 · Wide'}</Btn>
                  ))}
                </div>
                </details>
              </div>
              <details style={card}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: T.soft, listStylePosition: 'inside' }}>Advanced assets <span style={{ color: T.muted, fontWeight: 500 }}>— presenter, screenshots, product media and logo</span></summary>
                <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
                <div>
                  <FilePick label="Avatar / presenter reference (used for character consistency)" accept="image/*" onFiles={(f) => addFiles('avatar', [f[0]])} hint={s.avatar ? `Replace ${s.avatar.name}` : 'Upload avatar image'} />
                  {s.avatar ? <div style={{ marginTop: 8 }}><img src={s.avatar.url} alt="avatar" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 12, border: `1px solid ${T.lineStrong}` }} /></div> : null}
                </div>
                <div>
                  <FilePick label="Product screenshots (composited into device mockups)" accept="image/*" multiple onFiles={(f) => addFiles('screenshots', f)} />
                  <AssetChips items={s.screenshots} onRemove={(i) => setS((p) => ({ ...p, screenshots: p.screenshots.filter((_, x) => x !== i) }))} />
                </div>
                <div>
                  <FilePick label="Product images" accept="image/*" multiple onFiles={(f) => addFiles('productImages', f)} />
                  <AssetChips items={s.productImages} onRemove={(i) => setS((p) => ({ ...p, productImages: p.productImages.filter((_, x) => x !== i) }))} />
                </div>
                <div>
                  <FilePick label="Product videos (optional)" accept="video/*" multiple onFiles={(f) => addFiles('productVideos', f)} />
                  <AssetChips items={s.productVideos} onRemove={(i) => setS((p) => ({ ...p, productVideos: p.productVideos.filter((_, x) => x !== i) }))} />
                </div>
                <div>
                  <FilePick label="Logo (optional — subtle watermark)" accept="image/*" onFiles={(f) => addFiles('logo', [f[0]])} hint={s.logo ? `Replace ${s.logo.name}` : 'Upload logo'} />
                </div>
                </div>
              </details>
              <div>
                <Btn kind="primary" disabled={s.isProcessing || !(s.productUrl.trim() || s.productDescription.trim())} onClick={runResearch}>
                  {s.isProcessing ? <Spin label="Starting research" /> : <Wand2 size={15} />} Start Research <ChevronRight size={15} />
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 2 — RESEARCH ================= */}
        {s.currentStep === 2 && (
          <div style={{ maxWidth: 860 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Product research</h2>
            <p style={{ margin: '0 0 20px', color: T.muted, fontSize: 13.5 }}>Your director read the site (including reviews, testimonials, pricing and about pages where available). Verified details came from the site; inferred details are creative hypotheses. Correct anything before continuing.</p>
            {s.researchStatus === 'loading' && <div className="ads-rise" style={{ ...card }}><div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}><Spin size={120} caption="Researching your product" /></div></div>}
            {s.isProcessing && s.researchStatus !== 'loading' && s.currentStep >= 3 && s.currentStep <= 5 && <div className="ads-rise" style={{ ...card, display: 'flex', justifyContent: 'center', padding: '18px 0', marginBottom: 14 }}><Spin size={120} caption={s.currentStep === 3 ? 'Your director is working on your angles' : s.currentStep === 4 ? 'Writing your script' : 'Planning your scenes'} /></div>}
            {s.researchStatus === 'error' && (
              <div className="ads-rise" style={{ ...card, borderColor: T.bad, background: 'rgba(153,27,27,.07)', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(153,27,27,.1)', flexShrink: 0 }}><AlertTriangle size={16} color={T.bad} /></span>
                <div style={{ minWidth: 'min(100%, 220px)', flex: 1 }}><div style={{ color: T.ink, fontWeight: 700, marginBottom: 5 }}>Research failed</div>
                <div style={{ color: T.soft, fontSize: 13, marginBottom: 12 }}>{customerError(s.researchError)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn kind="primary" onClick={runResearch}><RefreshCw size={14} /> Retry</Btn>
                  <Btn onClick={() => patch({ currentStep: 1 })}>Paste a description manually instead</Btn>
                </div></div>
              </div>
            )}
            {s.research && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={card}>
                  <span style={labelStyle}>Product</span>
                  <input style={{ ...inputStyle, fontWeight: 700 }} value={s.research.product_name} onChange={(e) => patch({ research: { ...s.research!, product_name: e.target.value } })} />
                  <div style={{ height: 10 }} />
                  <textarea style={{ ...inputStyle, minHeight: 54 }} value={s.research.one_liner} onChange={(e) => patch({ research: { ...s.research!, one_liner: e.target.value } })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
                  {([
                    ['Core features', 'core_features'], ['Pain points', 'pain_points'], ['Desires / outcomes', 'desires'],
                    ['Objections', 'objections'], ['Customer language', 'customer_language'], ['Proof elements', 'proof_elements'],
                  ] as const).map(([label, key]) => (
                    <div key={key} style={card}>
                      <span style={labelStyle}>{label} (one per line)</span>
                      <textarea
                        style={{ ...inputStyle, minHeight: 96, fontSize: 13 }}
                        value={(s.research![key] as string[]).join('\n')}
                        onChange={(e) => patch({ research: { ...s.research!, [key]: e.target.value.split('\n').filter(Boolean) } })}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
                  {([
                    ['Pricing / offer', 'pricing'], ['Target audience', 'target_audience'], ['Mechanism (how it works)', 'mechanism'],
                    ['Awareness level', 'awareness_level'], ['Positioning', 'positioning'],
                  ] as const).map(([label, key]) => (
                    <div key={key} style={card}>
                      <span style={labelStyle}>{label}</span>
                      <textarea style={{ ...inputStyle, minHeight: 60, fontSize: 13 }} value={String(s.research![key])} onChange={(e) => patch({ research: { ...s.research!, [key]: e.target.value } })} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn onClick={runResearch} disabled={s.isProcessing}><RefreshCw size={14} /> Re-run research</Btn>
                  <Btn kind="primary" disabled={s.isProcessing} onClick={runAngles}>Looks good — continue <ChevronRight size={15} /></Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 3 — ANGLES ================= */}
        {s.currentStep === 3 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Ad angles</h2>
                <p style={{ margin: 0, color: T.muted, fontSize: 13.5 }}>Each card is a genuinely different reason to buy. Select one or more.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={runAngles} disabled={s.isProcessing}><RefreshCw size={14} /> Regenerate angles</Btn>
                <Btn kind="primary" onClick={runOpusPick} disabled={s.isProcessing || !s.angles.length}><Sparkles size={14} /> Director picks best</Btn>
              </div>
            </div>
            {s.opusPick && (
              <div style={{ ...card, marginBottom: 14, borderColor: T.highlight }}>
                <span style={labelStyle}>Director recommends</span>
                <div style={{ fontSize: 13.5, color: T.soft }}>
                  <b style={{ color: T.ink }}>{(s.angles.find((a) => a.id === s.opusPick!.angleId) || { angle_name: '' }).angle_name}</b> — {s.opusPick.reason}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(330px, 100%), 1fr))', gap: 12 }}>
              {s.angles.map((a) => {
                const selected = s.selectedAngleIds.includes(a.id);
                const isPick = s.opusPick?.angleId === a.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => setS((prev) => ({
                      ...prev,
                      selectedAngleIds: selected ? prev.selectedAngleIds.filter((x) => x !== a.id) : [...prev.selectedAngleIds, a.id],
                      activeAngleId: selected ? (prev.activeAngleId === a.id ? prev.selectedAngleIds.filter((x) => x !== a.id)[0] || null : prev.activeAngleId) : a.id,
                    }))}
                    style={{ ...card, cursor: 'pointer', border: `${selected ? 2 : 1}px solid ${selected ? T.accent : isPick ? T.highlight : T.line}` }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <Tag tone="info">{a.angle_type}</Tag>
                      {selected ? <Tag tone="ok">Selected</Tag> : isPick ? <Tag tone="warn">Director pick</Tag> : null}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>{a.angle_name}</div>
                    <div style={{ fontSize: 13.5, color: T.ink, marginBottom: 8, fontStyle: 'italic' }}>“{a.hook}”</div>
                    <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>{a.core_idea}</div>
                  </div>
                );
              })}
            </div>
            {!s.angles.length && !s.isProcessing && (
              <div className="ads-rise" style={{ ...card, padding: '32px 24px', textAlign: 'center' }}><span style={{ display: 'grid', placeItems: 'center', width: 54, height: 54, margin: '0 auto 14px', borderRadius: 17, background: T.panel, border: `1px solid ${T.line}` }}><Sparkles size={23} color={T.accent} /></span><div style={{ color: T.ink, fontSize: 16, fontWeight: 700 }}>Find the angle that makes this ad click</div><div style={{ margin: '7px auto 16px', maxWidth: 430, color: T.muted, fontSize: 13.5, lineHeight: 1.6 }}>Your director will turn the research into distinct hooks, objections, outcomes and creative directions.</div><Btn kind="primary" onClick={runAngles}><Wand2 size={14} /> Generate angles</Btn></div>
            )}
            {s.selectedAngleIds.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Btn kind="primary" disabled={s.isProcessing} onClick={() => runScript(s.activeAngleId || s.selectedAngleIds[0])}>
                  Write the script <ChevronRight size={15} />
                </Btn>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 4 — SCRIPT ================= */}
        {s.currentStep === 4 && (
          <div style={{ maxWidth: 980 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Script</h2>
              {s.selectedAngleIds.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {s.selectedAngleIds.map((id) => {
                    const a = s.angles.find((x) => x.id === id);
                    if (!a) return null;
                    return <Btn key={id} small kind={s.activeAngleId === id ? 'primary' : 'ghost'} onClick={() => runScript(id)} title="Writes a fresh script for this angle">{a.angle_name.slice(0, 26)}</Btn>;
                  })}
                </div>
              )}
            </div>
            <p style={{ margin: '0 0 16px', color: T.muted, fontSize: 13.5 }}>Edit any spoken line directly. Word limits are hard: 4s→9 · 6s→13 · 8s→17 · 10s→22 words.</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {s.script.map((c, i) => {
                const limit = WORD_LIMITS[c.duration_seconds];
                const over = c.word_count > limit;
                return (
                  <div key={c.clip_number} style={{ ...card, borderColor: over ? T.bad : T.line }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <Tag tone="info">Clip {c.clip_number} · {c.clip_role}</Tag>
                      <Tag tone={over ? 'bad' : 'ok'}>{c.word_count}/{limit} words</Tag>
                      <span style={{ fontSize: 12, color: T.muted }}>emotion: {c.emotion || '—'}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                        {([4, 6, 8, 10] as ClipDuration[]).map((d) => (
                          <Btn key={d} small kind={c.duration_seconds === d ? 'primary' : 'ghost'} onClick={() => setScriptDuration(i, d)}>{d}s</Btn>
                        ))}
                      </span>
                    </div>
                    <textarea
                      style={{ ...inputStyle, minHeight: 52, fontSize: 15, fontWeight: 600, borderColor: over ? T.bad : T.line }}
                      value={c.spoken_line}
                      onChange={(e) => setScriptLine(i, e.target.value)}
                    />
                    <div style={{ marginTop: 8, fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
                      <b style={{ color: T.soft }}>Visual:</b> {c.visual_concept} {c.overlay_idea ? <span>· <b style={{ color: T.soft }}>Overlay:</b> {c.overlay_idea}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {s.script.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Btn onClick={() => runScript(s.activeAngleId || s.selectedAngleIds[0])} disabled={s.isProcessing}><RefreshCw size={14} /> Rewrite script</Btn>
                <Btn kind="primary" disabled={s.isProcessing || scriptViolations > 0} onClick={runScenePlan}>Approve script — plan the scenes <ChevronRight size={15} /></Btn>
                {scriptViolations > 0 && <span style={{ color: T.bad, fontSize: 13 }}>{scriptViolations} clip(s) over the word limit</span>}
                <span style={{ marginLeft: 'auto', color: T.muted, fontSize: 13 }}>Total ≈ {totalSeconds}s</span>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 5 — SCENE PLAN ================= */}
        {s.currentStep === 5 && (
          <div style={{ maxWidth: 1060 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Scene plan</h2>
            <p style={{ margin: '0 0 14px', color: T.muted, fontSize: 13.5 }}>One production card per clip. The voice is locked once and reused verbatim across every clip.</p>
            {s.voiceDescription ? (
              <div style={{ ...card, marginBottom: 14 }}>
                <span style={labelStyle}>Locked voice (all clips)</span>
                <input style={inputStyle} value={s.voiceDescription} onChange={(e) => { const v = e.target.value; setS((prev) => ({ ...prev, voiceDescription: v, scenePlan: prev.scenePlan.map((p) => ({ ...p, voice_description: v.split(' · ')[0] || v })) })); }} />
              </div>
            ) : null}
            {s.generatedAssets.length > 0 && (
              <div style={{ ...card, marginBottom: 14 }}>
                <span style={labelStyle}>Generated assets (reused across clips)</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.generatedAssets.map((g) => (
                    <div key={g.url} style={{ width: 110 }}>
                      <img src={g.url} alt="" style={{ width: 110, height: 78, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.line}` }} />
                      <div style={{ fontSize: 10.5, color: T.muted, marginTop: 3 }}>{g.description.slice(0, 48)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(460px, 100%), 1fr))', gap: 12 }}>
              {s.scenePlan.map((p) => {
                const sc = s.script.find((c) => c.clip_number === p.clip_number);
                return (
                  <div key={p.clip_number} style={card}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <Tag tone="info">Clip {p.clip_number} · {sc?.clip_role}</Tag>
                      {p.use_screenshot_mockup && <Tag tone="warn">{p.screenshot_mockup_type} mockup</Tag>}
                      {p.overlay_type !== 'none' && !p.use_screenshot_mockup && <Tag>{p.overlay_type}</Tag>}
                      <span style={{ marginLeft: 'auto' }}>
                        <Btn small onClick={() => regenPlanForClip(p.clip_number)} disabled={s.isProcessing}><RefreshCw size={12} /> Regenerate plan</Btn>
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: T.ink, fontStyle: 'italic', marginBottom: 10 }}>“{p.spoken_line}”</div>
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ fontSize: 12, fontWeight: 700, color: T.muted, cursor: 'pointer', listStylePosition: 'inside' }}>Advanced — camera, performance, continuity and production prompt</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 8, marginTop: 10 }}>
                      {([
                        ['Camera', 'camera_movement'], ['Framing', 'framing'], ['Micro-action', 'micro_action'], ['Gesture', 'gesture'],
                        ['Expression', 'expression'], ['Environment', 'environment'], ['Lighting', 'lighting'], ['Style', 'visual_style'],
                        ['Continuity', 'continuity_notes'], ['Avoid', 'do_not_show'],
                      ] as const).map(([label, key]) => (
                        <div key={key}>
                          <span style={{ ...labelStyle, marginBottom: 3 }}>{label}</span>
                          <input style={{ ...inputStyle, padding: '6px 9px', fontSize: 12.5 }} value={String(p[key] || '')} onChange={(e) => editPlanField(p.clip_number, key, e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <span style={{ ...labelStyle, marginBottom: 3 }}>Overlay text (exact)</span>
                      <input style={{ ...inputStyle, padding: '6px 9px', fontSize: 12.5 }} value={p.overlay_text} onChange={(e) => editPlanField(p.clip_number, 'overlay_text', e.target.value)} />
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <span style={{ ...labelStyle, marginBottom: 3 }}>Production prompt</span>
                      <textarea style={{ ...inputStyle, minHeight: 130, fontSize: 12, fontFamily: T.mono, marginTop: 6 }} value={p.veo_prompt} onChange={(e) => editPlanField(p.clip_number, 'veo_prompt', e.target.value)} />
                    </div>
                    </details>
                  </div>
                );
              })}
            </div>
            {s.scenePlan.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <VideoIntegrationPicker
                  label="Video provider"
                  integration={clipIntegration}
                  model={clipEngine}
                  sceneOnly
                  disabled={s.isProcessing}
                  onChange={onClipVideoSelection}
                  note={clipEngine === 'gemini-omni-flash-preview'
                    ? 'Omni Flash carries your avatar reference into every cut — the safest pick when the same presenter has to appear throughout.'
                    : 'Every clip in this run uses the provider above. If the platform refuses a model, the clip falls back to Omni Flash and the card shows which engine actually ran.'}
                  style={{ marginBottom: 14, maxWidth: 560 }}
                />
                <Btn kind="primary" disabled={s.isProcessing} onClick={runGeneration}><Play size={15} /> Generate all clips <ChevronRight size={15} /></Btn>
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 6 — GENERATE ================= */}
        {s.currentStep === 6 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Generation</h2>
                <p style={{ margin: 0, color: T.muted, fontSize: 13.5 }}>Each clip is filmed, quality-checked, retaken once if needed, and chained for continuity.</p>
              </div>
              <div className="ads-step-actions" style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={runGeneration} disabled={s.isProcessing}><Play size={14} /> {s.clips.some((c) => c.videoUrl) ? 'Resume / generate remaining' : 'Start generation'}</Btn>
                <Btn kind="primary" disabled={s.isProcessing || !s.clips.some((c) => c.videoUrl)} onClick={() => patch({ currentStep: 7 })}>Review <ChevronRight size={14} /></Btn>
              </div>
            </div>

            <VideoIntegrationPicker
              label="Video provider"
              integration={clipIntegration}
              model={clipEngine}
              sceneOnly
              disabled={s.isProcessing}
              onChange={onClipVideoSelection}
              note="All six native Audos video integrations are available. Provider errors surface on the clip card; Omni Flash may stand in when a Group A or Runway model is rejected."
              style={{ marginBottom: 16, maxWidth: 560 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
              {s.script.map((sc, clipIndex) => {
                const clip = s.clips.find((c) => c.clipNumber === sc.clip_number);
                const status = clip?.status || 'pending';
                const phaseSteps = clipPhases[sc.clip_number] || freshClipPhases().map((step) => ({ ...step, status: status === 'accepted' || status === 'regenerated' ? 'done' as const : status === 'failed' ? (step.id === 'render' ? 'failed' as const : 'pending' as const) : step.status }));
                return (
                  <div key={sc.clip_number} className="ads-card ads-rise" style={{ ...card, borderColor: status === 'failed' ? T.bad : status === 'regenerated' ? T.warn : status === 'accepted' ? T.good : T.line, animationDelay: `${Math.min(clipIndex, 10) * 45}ms` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Tag tone="info">Clip {sc.clip_number} · {sc.clip_role}</Tag>
                      {status === 'generating' || status === 'inspecting' ? <Tag tone="warn">Generating…</Tag>
                        : status === 'accepted' ? <Tag tone="ok">✓ Accepted</Tag>
                        : status === 'regenerated' ? <Tag tone="warn">⚠ Regenerated</Tag>
                        : status === 'failed' ? <Tag tone="bad">✗ Failed</Tag>
                        : <Tag>Pending</Tag>}
                    </div>
                    <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
                      {phaseSteps.map((step, phaseIndex) => {
                        const elapsed = step.status === 'running' && step.startedAt ? formatClipElapsed(phaseNow - step.startedAt) : step.elapsedMs !== undefined ? formatClipElapsed(step.elapsedMs) : '—';
                        return <div key={step.id} className="ads-rise" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 8, background: T.panel, animationDelay: `${phaseIndex * 35}ms` }}><span style={{ display: 'flex', color: step.status === 'done' ? T.good : step.status === 'running' ? T.highlight : step.status === 'failed' ? T.bad : T.muted }}>{step.status === 'done' ? <Check size={11} /> : step.status === 'running' ? <Spin /> : step.status === 'failed' ? <AlertTriangle size={11} /> : <Circle size={10} />}</span><span style={{ minWidth: 0, flex: 1, color: step.status === 'pending' ? T.muted : T.soft, fontSize: 11 }}>{step.label}</span><span style={{ color: step.status === 'running' ? T.highlight : step.status === 'failed' ? T.bad : T.muted, fontSize: 9.5, fontFamily: T.mono, textTransform: 'uppercase' }}>{step.status}</span><span style={{ minWidth: 52, textAlign: 'right', color: T.muted, fontSize: 9.5, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>{elapsed}</span></div>;
                      })}
                    </div>
                    <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: s.aspect === '9:16' ? '9/16' : s.aspect === '1:1' ? '1/1' : '16/9', maxHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {clip?.videoUrl ? (
                        <video src={clip.videoUrl} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (status === 'generating' ? <div style={{ display: 'grid', placeItems: 'center', gap: 8, color: T.muted, fontSize: 12 }}><Spin size={110} caption="Filming this clip" /></div> : <div style={{ display: 'grid', placeItems: 'center', gap: 7, padding: 18, color: T.muted, fontSize: 12, textAlign: 'center' }}><Film size={22} color={T.accent} /><span>Ready for its first take</span></div>)}
                    </div>
                    {clip && clip.issues.length > 0 ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: T.warn }}>{clip.issues.slice(0, 3).map((iss, x) => <div key={x}>• {iss}</div>)}</div>
                    ) : null}
                    {clip?.note ? <div style={{ marginTop: 6, fontSize: 12, color: T.muted }}>{clip.note}</div> : null}
                    {clip?.modelUsed && clip.videoUrl ? <div style={{ marginTop: 4, fontSize: 10.5, color: T.muted }}>Engine: {engineDisplayName(clip.modelUsed)} · takes: {clip.attempts}</div> : null}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      <Btn small disabled={s.isProcessing} onClick={() => regenerateOneClip(sc.clip_number)}><RefreshCw size={12} /> Regenerate</Btn>
                      <Btn small disabled={s.isProcessing} onClick={() => setEditingPrompt(editingPrompt === sc.clip_number ? null : sc.clip_number)}><Pencil size={12} /> Edit prompt</Btn>
                    </div>
                    {editingPrompt === sc.clip_number && (
                      <PromptEditor
                        initial={clip?.promptUsed || (s.scenePlan.find((p) => p.clip_number === sc.clip_number) || { veo_prompt: '' }).veo_prompt}
                        onRun={(prompt) => { setEditingPrompt(null); regenerateOneClip(sc.clip_number, prompt); }}
                        onCancel={() => setEditingPrompt(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= STEP 7 — REVIEW ================= */}
        {s.currentStep === 7 && (
          <div style={{ maxWidth: 1060 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Review &amp; assemble</h2>
                <p style={{ margin: 0, color: T.muted, fontSize: 13.5 }}>Total {totalSeconds}s · estimated ~{estMb} MB · overlays and captions are burned in at assembly.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <FilePick label="" accept="image/*" onFiles={(f) => addFiles('avatar', [f[0]])} hint="Replace avatar" />
                <FilePick label="" accept="image/*" multiple onFiles={(f) => addFiles('screenshots', f)} hint="Add screenshot" />
              </div>
            </div>

            {s.assemblyStatus === 'error' && (
              <div className="ads-rise" style={{ ...card, borderColor: T.bad, background: 'rgba(153,27,27,.07)', marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(153,27,27,.1)', flexShrink: 0 }}><AlertTriangle size={16} color={T.bad} /></span><div style={{ minWidth: 'min(100%, 220px)', flex: 1 }}><div style={{ color: T.ink, fontWeight: 700 }}>Assembly failed</div>
                <div style={{ color: T.soft, fontSize: 13, margin: '6px 0 10px' }}>{customerError(s.assemblyError)}</div>
                <Btn kind="primary" onClick={runAssembly}><RefreshCw size={14} /> Retry assembly</Btn>
              </div></div>
            )}

            {s.finalVideoUrl && (
              <div style={{ ...card, marginBottom: 14, borderColor: T.good }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <video src={blobUrl || s.finalVideoUrl} controls style={{ width: s.aspect === '9:16' ? 240 : 420, maxWidth: '100%', borderRadius: 10, background: '#000' }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Final ad</div>
                    <div style={{ color: T.muted, fontSize: 13, marginBottom: 12 }}>Assembled in your browser with captions and overlays burned in.</div>
                    <a href={blobUrl || s.finalVideoUrl} download={`ads-studio-${Date.now()}.mp4`} style={{ textDecoration: 'none' }}>
                      <Btn kind="primary"><Download size={15} /> Download MP4</Btn>
                    </a>
                    <div style={{ marginTop: 12 }}>
                      <Btn onClick={runMatrix} disabled={s.isProcessing}><Plus size={14} /> Build variations <ChevronRight size={14} /></Btn>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 10 }}>
              {s.script.map((sc, i) => {
                const clip = s.clips.find((c) => c.clipNumber === sc.clip_number);
                const plan = s.scenePlan.find((p) => p.clip_number === sc.clip_number);
                const limit = WORD_LIMITS[sc.duration_seconds];
                const over = sc.word_count > limit;
                return (
                  <div key={sc.clip_number} className="ads-card ads-rise ads-review-card" style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap', animationDelay: `${Math.min(i, 10) * 45}ms` }}>
                    <div className="ads-review-thumb" style={{ width: 150 }}>
                      <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: s.aspect === '9:16' ? '9/16' : s.aspect === '1:1' ? '1/1' : '16/9' }}>
                        {clip?.videoUrl ? <video src={clip.videoUrl} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ color: T.muted, fontSize: 11, padding: 8 }}>No clip</div>}
                      </div>
                    </div>
                    <div className="ads-review-copy" style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <Tag tone="info">Clip {sc.clip_number} · {sc.clip_role} · {sc.duration_seconds}s</Tag>
                        {clip?.status === 'accepted' && <Tag tone="ok">✓</Tag>}
                        {clip?.status === 'regenerated' && <Tag tone="warn">⚠ retaken</Tag>}
                        {(!clip || clip.status === 'failed') && <Tag tone="bad">✗ missing</Tag>}
                        <Tag tone={over ? 'bad' : 'ok'}>{sc.word_count}/{limit}w</Tag>
                      </div>
                      <textarea style={{ ...inputStyle, minHeight: 44, fontSize: 13.5, borderColor: over ? T.bad : T.line }} value={sc.spoken_line} onChange={(e) => setScriptLine(i, e.target.value)} />
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
                        Overlay: {plan?.use_screenshot_mockup ? `${plan.screenshot_mockup_type} mockup with real screenshot` : plan && plan.overlay_type !== 'none' ? `${plan.overlay_type}${plan.overlay_text ? ` — “${plan.overlay_text}”` : ''}` : 'caption only'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <Btn small disabled={s.isProcessing} onClick={() => regenerateOneClip(sc.clip_number)}><RefreshCw size={12} /> Regenerate</Btn>
                        <Btn small disabled={s.isProcessing} onClick={() => setEditingPrompt(editingPrompt === sc.clip_number ? null : sc.clip_number)}><Pencil size={12} /> Production prompt</Btn>
                      </div>
                      {editingPrompt === sc.clip_number && (
                        <PromptEditor
                          initial={clip?.promptUsed || plan?.veo_prompt || ''}
                          onRun={(prompt) => { setEditingPrompt(null); regenerateOneClip(sc.clip_number, prompt); }}
                          onCancel={() => setEditingPrompt(null)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn kind="primary" disabled={s.isProcessing || !s.clips.some((c) => c.videoUrl)} onClick={runAssembly}>
                {s.assemblyStatus === 'assembling' ? <Spin label="Assembling your ad" /> : <Wand2 size={15} />} Assemble Final Ad
              </Btn>
              <Btn small onClick={() => setShowLogs(!showLogs)}>{showLogs ? 'Hide' : 'Show'} assembly logs</Btn>
            </div>
            {showLogs && (
              <pre style={{ ...card, marginTop: 10, maxHeight: 220, overflow: 'auto', fontSize: 11, fontFamily: T.mono, color: T.muted, whiteSpace: 'pre-wrap' }}>
                {ffLogs.length ? ffLogs.join('\n') : 'No assembly output yet.'}
              </pre>
            )}
          </div>
        )}

        {/* ================= STEP 8 — VARIATIONS ================= */}
        {s.currentStep === 8 && (
          <div style={{ maxWidth: 1060 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Variations</h2>
                <p style={{ margin: 0, color: T.muted, fontSize: 13.5 }}>Hooks × bodies × CTAs. Unchanged clips are reused — only lines that differ are regenerated.</p>
              </div>
              <Btn onClick={runMatrix} disabled={s.isProcessing}><RefreshCw size={14} /> {s.matrix ? 'Regenerate matrix' : 'Generate matrix'}</Btn>
            </div>
            {s.matrix && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 16 }}>
                  <div style={card}>
                    <span style={labelStyle}>Hooks ({s.matrix.hooks.length})</span>
                    {s.matrix.hooks.map((h, i) => <div key={i} style={{ fontSize: 12.5, color: i ? T.soft : T.muted, marginBottom: 6 }}><b style={{ color: T.accent }}>H{i + 1}{i === 0 ? ' (original)' : ''}:</b> {h}</div>)}
                  </div>
                  <div style={card}>
                    <span style={labelStyle}>Bodies ({s.matrix.bodies.length})</span>
                    {s.matrix.bodies.map((b, i) => <div key={i} style={{ fontSize: 12.5, color: i ? T.soft : T.muted, marginBottom: 6 }}><b style={{ color: T.accent }}>B{i + 1}{i === 0 ? ' (original)' : ''}:</b> {Object.values(b).join(' / ').slice(0, 140)}</div>)}
                  </div>
                  <div style={card}>
                    <span style={labelStyle}>CTAs ({s.matrix.ctas.length})</span>
                    {s.matrix.ctas.map((c, i) => <div key={i} style={{ fontSize: 12.5, color: i ? T.soft : T.muted, marginBottom: 6 }}><b style={{ color: T.accent }}>C{i + 1}{i === 0 ? ' (original)' : ''}:</b> {c}</div>)}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 10 }}>
                  {s.matrix.hooks.map((_, hi) => s.matrix!.bodies.map((_, bi) => s.matrix!.ctas.map((_, ci) => {
                    const isOriginal = hi === 0 && bi === 0 && ci === 0;
                    const v = s.variations.find((x) => x.hookIdx === hi && x.bodyIdx === bi && x.ctaIdx === ci);
                    return (
                      <div key={`${hi}-${bi}-${ci}`} style={{ ...card, borderColor: v?.status === 'done' ? T.good : v?.status === 'error' ? T.bad : T.line }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Tag tone="info">H{hi + 1} · B{bi + 1} · C{ci + 1}</Tag>
                          {isOriginal && <Tag tone="ok">Original</Tag>}
                          {v && (v.status === 'generating' || v.status === 'assembling') ? <Tag tone="warn">{v.status}…</Tag> : null}
                          {v?.status === 'error' && <Tag tone="bad">failed</Tag>}
                        </div>
                        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 8, minHeight: 30 }}>“{s.matrix!.hooks[hi].slice(0, 66)}”</div>
                        {isOriginal ? (
                          s.finalVideoUrl
                            ? <a href={blobUrl || s.finalVideoUrl} download style={{ textDecoration: 'none' }}><Btn small kind="primary"><Download size={12} /> Download</Btn></a>
                            : <span style={{ fontSize: 12, color: T.muted }}>Assemble the main ad first</span>
                        ) : v?.status === 'done' && v.videoUrl ? (
                          <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                            <video src={v.videoUrl} controls preload="metadata" style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 180 }} />
                            <a href={v.videoUrl} download style={{ textDecoration: 'none' }}><Btn small kind="primary"><Download size={12} /> Download</Btn></a>
                          </div>
                        ) : v?.status === 'error' ? (
                          <div>
                            <div style={{ fontSize: 11.5, color: T.bad, marginBottom: 6 }}>{customerError(v.error).slice(0, 120)}</div>
                            <Btn small disabled={s.isProcessing} onClick={() => buildVariation(hi, bi, ci)}><RefreshCw size={12} /> Retry</Btn>
                          </div>
                        ) : v ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}><Spin size={44} label="Building the variation" /> building…</div>
                        ) : (
                          <Btn small disabled={s.isProcessing} onClick={() => buildVariation(hi, bi, ci)}><Play size={12} /> Build this variation</Btn>
                        )}
                      </div>
                    );
                  })))}
                </div>
              </div>
            )}
            {!s.matrix && !s.isProcessing && (
              <div className="ads-rise" style={{ ...card, padding: '32px 24px', textAlign: 'center' }}><span style={{ display: 'grid', placeItems: 'center', width: 54, height: 54, margin: '0 auto 14px', borderRadius: 17, background: T.panel, border: `1px solid ${T.line}` }}><Sparkles size={23} color={T.accent} /></span><div style={{ color: T.ink, fontSize: 16, fontWeight: 700 }}>Turn one winning ad into a test matrix</div><div style={{ margin: '7px auto 16px', maxWidth: 430, color: T.muted, fontSize: 13.5, lineHeight: 1.6 }}>Mix fresh hooks, bodies and calls to action while reusing every clip that does not need to change.</div><Btn kind="primary" onClick={runMatrix}><Wand2 size={14} /> Generate the variation matrix</Btn></div>
            )}
          </div>
        )}
        </>
        )}
      </main>

      {toast ? (
        <div
          role="status"
          className="ads-engine-toast ads-rise"
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60, maxWidth: 380,
            display: 'flex', alignItems: 'flex-start', gap: 9,
            background: T.card, borderRadius: 12, padding: '12px 14px',
            border: `1px solid ${T.highlight}`, boxShadow: '0 18px 40px rgba(120,80,0,0.14)',
          }}
          data-testid="ads-engine-toast"
        >
          <Sparkles size={14} color={T.highlight} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1, fontSize: 12.5, color: T.soft, lineHeight: 1.5 }}>{toast}</span>
          <button
            type="button" onClick={() => setToast('')} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', padding: 0, lineHeight: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      <AgentChatProvider appContext={agentContext}>
        <AgentChatButton />
        <AgentChatPanel />
      </AgentChatProvider>
    </div>
    </AppShell>
  );
}
