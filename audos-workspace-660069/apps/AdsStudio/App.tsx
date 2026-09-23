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
  Check, ChevronRight, Download, Loader2, Megaphone, Pencil,
  Play, Plus, RefreshCw, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import {
  AdsSession, ClipDuration, GeneratedClip, ScenePlan, ScriptClip,
  STEPS, T, UploadedAsset, WORD_LIMITS, clearSession, emptySession,
  generateImageAsset, loadSession, saveSession, uploadUserFile, wordCount,
} from './api';
import {
  assembleVeoPrompt, buildScenePlan, continuityNoteFromFrame, fetchSiteResearch,
  generateAngles, generateVariationMatrix, pickBestAngle,
  regenerateScenePlanForClip, researchProduct, writeScript,
} from './opus';
import { generateClipAgentic, assembleWithOverlays, ResolvedClip } from './pipeline';
import EnginePicker from '../../components/EngineSelector';
import RunwayRecipesPanel from '../../components/RunwayRecipesPanel';
import { runwayVideoModel } from '../../lib/videoEngines';

// ---------------------------------------------------------------------------
// Small UI atoms (inline — the app is self-contained)
// ---------------------------------------------------------------------------

const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 };
const inputStyle: React.CSSProperties = { width: '100%', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px', color: T.ink, fontSize: 14, fontFamily: T.sans, outline: 'none', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' };

function Btn(props: { onClick?: () => void; children: any; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; small?: boolean; title?: string }) {
  const { kind = 'ghost', small } = props;
  const bg = kind === 'primary' ? T.accent : kind === 'danger' ? 'rgba(239,68,68,0.14)' : T.panel;
  const color = kind === 'primary' ? '#fff' : kind === 'danger' ? T.bad : T.soft;
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        background: bg, color, border: `1px solid ${kind === 'ghost' ? T.line : 'transparent'}`,
        borderRadius: 10, padding: small ? '6px 10px' : '10px 16px', fontSize: small ? 12 : 14,
        fontWeight: 600, fontFamily: T.sans, cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >{props.children}</button>
  );
}

function Tag(props: { children: any; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  const toneColor = props.tone === 'ok' ? T.good : props.tone === 'warn' ? T.warn : props.tone === 'bad' ? T.bad : T.accent;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: toneColor, border: `1px solid ${toneColor}`, borderRadius: 999, padding: '2px 9px', opacity: 0.95, whiteSpace: 'nowrap' }}>
      {props.children}
    </span>
  );
}

function Spin() { return <Loader2 size={15} style={{ animation: 'adsspin 1s linear infinite' }} />; }

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
// The app
// ---------------------------------------------------------------------------

export default function AdsStudioApp() {
  const [s, setS] = useState<AdsSession>(() => loadSession());
  const [stageNote, setStageNote] = useState('');
  const [ffLogs, setFfLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<number | null>(null);
  const busy = useRef(false);
  const live = useRef(s);
  useEffect(() => { live.current = s; saveSession(s); }, [s]);

  const patch = (p: Partial<AdsSession>) => setS((prev) => ({ ...prev, ...p }));
  const say = (n: string) => setStageNote(n);

  function fail(context: string, e: any) {
    say(`${context}: ${String(e?.message || e)}`);
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
      say('Opus is analysing the product…');
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
    say('Opus is generating ad angles…');
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
    say('Opus is picking the strongest angle…');
    try {
      const pick = await pickBestAngle(live.current.research!, live.current.angles);
      setS((prev) => ({
        ...prev, opusPick: pick, isProcessing: false,
        selectedAngleIds: prev.selectedAngleIds.includes(pick.angleId) ? prev.selectedAngleIds : [...prev.selectedAngleIds, pick.angleId],
        activeAngleId: pick.angleId,
      }));
      say('Opus made its pick — see the highlighted card.');
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
    say(`Opus is writing the script for “${angle.angle_name}”…`);
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

  const scriptViolations = s.script.filter((c) => c.word_count > WORD_LIMITS[c.duration_seconds]).length;

  // ----------------------------------------------------------- scene plan ----
  async function runScenePlan() {
    if (busy.current) return;
    const cur = live.current;
    const angle = cur.angles.find((a) => a.id === cur.activeAngleId);
    if (!angle || !cur.research || !cur.script.length) return;
    busy.current = true;
    patch({ isProcessing: true, currentStep: 5 });
    say('Opus is directing the scene plan…');
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
      say(`Generating clip ${sc.clip_number} of ${cur.script.length}…`);
      const res = await generateClipAgentic({
        plan: { ...plan, spoken_line: sc.spoken_line }, script: sc, aspect: cur.aspect,
        avatarUrl: cur.avatar?.url || null, modelId: cur.videoModel || null,
        continuityNote: continuity, previousFrameUrl: prevFrame, onNote: say,
      });
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
    try {
      const prev = cur.clips.filter((c) => c.clipNumber < clipNumber && c.lastFrameUrl).sort((a, b) => b.clipNumber - a.clipNumber)[0];
      const continuity = prev?.lastFrameUrl ? await continuityNoteFromFrame(prev.lastFrameUrl) : null;
      const res = await generateClipAgentic({
        plan: { ...plan, spoken_line: sc.spoken_line }, script: sc, aspect: cur.aspect,
        avatarUrl: cur.avatar?.url || null, modelId: cur.videoModel || null, continuityNote: continuity,
        previousFrameUrl: prev?.lastFrameUrl || null, promptOverride: promptOverride || null, onNote: say,
      });
      setClipState(clipNumber, { videoUrl: res.videoUrl, status: res.status, issues: res.issues, attempts: res.attempts, lastFrameUrl: res.lastFrameUrl, promptUsed: res.promptUsed, modelUsed: res.modelUsed, note: res.note });
      if (res.videoUrl && live.current.finalVideoUrl) patch({ finalVideoUrl: null, assemblyStatus: 'idle' });
      say(res.videoUrl ? `Clip ${clipNumber} regenerated.` : `Clip ${clipNumber} failed again — see its card.`);
    } catch (e: any) {
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
    say('Opus is writing alternative hooks, bodies and CTAs…');
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
          avatarUrl: cur.avatar?.url || null, modelId: cur.videoModel || null, continuityNote: continuity, previousFrameUrl: prevFrame, onNote: say,
        });
        if (!res.videoUrl) throw new Error(`Clip ${sc.clip_number} failed: ${res.note || res.issues.join('; ') || 'render error'}`);
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
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: T.canvas, color: T.ink, fontFamily: T.sans }}>
      <style>{'@keyframes adsspin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }'}</style>

      {/* ---- progress rail ---- */}
      <aside style={{ width: 216, flexShrink: 0, borderRight: `1px solid ${T.line}`, padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14, paddingLeft: 6 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${T.accentDeep}, ${T.highlight})`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Megaphone size={18} color="#fff" />
          </span>
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
              onClick={() => reachable && patch({ currentStep: st.n })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10,
                background: active ? T.raised : 'transparent', border: `1px solid ${active ? T.lineStrong : 'transparent'}`,
                color: reachable ? (active ? T.ink : T.soft) : T.muted, cursor: reachable ? 'pointer' : 'not-allowed',
                opacity: reachable ? 1 : 0.45, textAlign: 'left', fontFamily: T.sans, fontSize: 12.5, fontWeight: active ? 700 : 500,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: done ? T.good : active ? T.accent : T.panel, color: done || active ? '#08101F' : T.muted,
                fontSize: 11, fontWeight: 800, border: `1px solid ${done || active ? 'transparent' : T.line}`,
              }}>{done ? <Check size={13} /> : st.n}</span>
              STEP {st.n}: {st.label.toUpperCase()}
            </button>
          );
        })}
        <div style={{ marginTop: 'auto', paddingTop: 14 }}>
          <Btn small kind="danger" onClick={() => { if (window.confirm('Start over? The current ad session is cleared (uploaded files stay in storage).')) { clearSession(); setS(emptySession()); setBlobUrl(null); setFfLogs([]); say(''); } }}>
            <Trash2 size={13} /> New session
          </Btn>
        </div>
      </aside>

      {/* ---- main panel ---- */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px 60px' }}>
        {stageNote ? (
          <div style={{ ...card, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, borderColor: T.lineStrong, background: T.panel }}>
            {s.isProcessing ? <Spin /> : <Sparkles size={15} color={T.highlight} />}
            <span style={{ fontSize: 13, color: T.soft }}>{stageNote}</span>
          </div>
        ) : null}

        {/* ================= STEP 1 — PRODUCT ================= */}
        {s.currentStep === 1 && (
          <div style={{ maxWidth: 760 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Product intake</h2>
            <p style={{ margin: '0 0 20px', color: T.muted, fontSize: 13.5 }}>Everything the engine works from. The URL is required; the avatar keeps the same presenter across every clip.</p>
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={card}>
                <span style={labelStyle}>Product URL (required)</span>
                <input style={inputStyle} placeholder="https://yourproduct.com" value={s.productUrl} onChange={(e) => patch({ productUrl: e.target.value })} />
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
              </div>
              <div style={{ ...card, display: 'grid', gap: 16 }}>
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
              <div>
                <Btn kind="primary" disabled={s.isProcessing || !(s.productUrl.trim() || s.productDescription.trim())} onClick={runResearch}>
                  {s.isProcessing ? <Spin /> : <Wand2 size={15} />} Start Research <ChevronRight size={15} />
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 2 — RESEARCH ================= */}
        {s.currentStep === 2 && (
          <div style={{ maxWidth: 860 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Product research</h2>
            <p style={{ margin: '0 0 20px', color: T.muted, fontSize: 13.5 }}>Opus read the site (and /reviews, /testimonials, /pricing, /about where they exist). [VERIFIED] came from the site; [INFERRED] is a creative hypothesis. Correct anything before continuing.</p>
            {s.researchStatus === 'loading' && <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center' }}><Spin /> Researching…</div>}
            {s.researchStatus === 'error' && (
              <div style={{ ...card, borderColor: T.bad }}>
                <div style={{ color: T.bad, fontWeight: 700, marginBottom: 8 }}>Research failed</div>
                <div style={{ color: T.soft, fontSize: 13, marginBottom: 12 }}>{s.researchError}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn kind="primary" onClick={runResearch}><RefreshCw size={14} /> Retry</Btn>
                  <Btn onClick={() => patch({ currentStep: 1 })}>Paste a description manually instead</Btn>
                </div>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
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
                <Btn kind="primary" onClick={runOpusPick} disabled={s.isProcessing || !s.angles.length}><Sparkles size={14} /> Opus picks best</Btn>
              </div>
            </div>
            {s.opusPick && (
              <div style={{ ...card, marginBottom: 14, borderColor: T.highlight }}>
                <span style={labelStyle}>Opus recommends</span>
                <div style={{ fontSize: 13.5, color: T.soft }}>
                  <b style={{ color: T.ink }}>{(s.angles.find((a) => a.id === s.opusPick!.angleId) || { angle_name: '' }).angle_name}</b> — {s.opusPick.reason}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12 }}>
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
                      {selected ? <Tag tone="ok">Selected</Tag> : isPick ? <Tag tone="warn">Opus pick</Tag> : null}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>{a.angle_name}</div>
                    <div style={{ fontSize: 13.5, color: T.ink, marginBottom: 8, fontStyle: 'italic' }}>“{a.hook}”</div>
                    <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>{a.core_idea}</div>
                  </div>
                );
              })}
            </div>
            {!s.angles.length && !s.isProcessing && (
              <div style={card}><Btn kind="primary" onClick={runAngles}><Wand2 size={14} /> Generate angles</Btn></div>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: 12 }}>
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ fontSize: 12, color: T.muted, cursor: 'pointer' }}>Veo prompt (assembled)</summary>
                      <textarea style={{ ...inputStyle, minHeight: 130, fontSize: 12, fontFamily: T.mono, marginTop: 6 }} value={p.veo_prompt} onChange={(e) => editPlanField(p.clip_number, 'veo_prompt', e.target.value)} />
                    </details>
                  </div>
                );
              })}
            </div>
            {s.scenePlan.length > 0 && (
              <div style={{ marginTop: 16 }}>
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
                <p style={{ margin: 0, color: T.muted, fontSize: 13.5 }}>Each clip is filmed, inspected by Opus, auto-retaken once if rejected, and chained for continuity.</p>
                <div style={{ marginTop: 10, maxWidth: 560 }}>
                  <EnginePicker
                    label="Clip engine"
                    value={s.videoModel || 'gemini-omni-flash-preview'}
                    onChange={(id) => patch({ videoModel: id })}
                    groupAIds="all"
                    includeRunway
                    disabled={s.isProcessing}
                    note={(() => {
                      const rw = runwayVideoModel(s.videoModel);
                      if (!rw) return 'Default: Gemini Omni Flash — the proven avatar-consistent engine. Changing the engine affects newly generated clips only.';
                      const seconds = s.script.reduce((a, c) => a + Math.min(10, Math.max(2, c.duration_seconds)), 0);
                      return `Runway is gated — every clip is quoted FREE before the paid submit (≈ $${(rw.pricePerSecondUsd * seconds).toFixed(2)} for all ${s.script.length} clips at $${rw.pricePerSecondUsd.toFixed(2)}/s). If Runway answers 503 the clip shows “Runway generation is being enabled — check back soon.” and the rest of the run keeps working.`;
                    })()}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={runGeneration} disabled={s.isProcessing}><Play size={14} /> {s.clips.some((c) => c.videoUrl) ? 'Resume / generate remaining' : 'Start generation'}</Btn>
                <Btn kind="primary" disabled={s.isProcessing || !s.clips.some((c) => c.videoUrl)} onClick={() => patch({ currentStep: 7 })}>Review <ChevronRight size={14} /></Btn>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {s.script.map((sc) => {
                const clip = s.clips.find((c) => c.clipNumber === sc.clip_number);
                const status = clip?.status || 'pending';
                return (
                  <div key={sc.clip_number} style={{ ...card, borderColor: status === 'failed' ? T.bad : status === 'regenerated' ? T.warn : status === 'accepted' ? T.good : T.line }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Tag tone="info">Clip {sc.clip_number} · {sc.clip_role}</Tag>
                      {status === 'generating' || status === 'inspecting' ? <Tag tone="warn">Generating…</Tag>
                        : status === 'accepted' ? <Tag tone="ok">✓ Accepted</Tag>
                        : status === 'regenerated' ? <Tag tone="warn">⚠ Regenerated</Tag>
                        : status === 'failed' ? <Tag tone="bad">✗ Failed</Tag>
                        : <Tag>Pending</Tag>}
                    </div>
                    <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: s.aspect === '9:16' ? '9/16' : s.aspect === '1:1' ? '1/1' : '16/9', maxHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {clip?.videoUrl ? (
                        <video src={clip.videoUrl} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (status === 'generating' ? <Spin /> : <span style={{ color: T.muted, fontSize: 12 }}>No clip yet</span>)}
                    </div>
                    {clip && clip.issues.length > 0 ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: T.warn }}>{clip.issues.slice(0, 3).map((iss, x) => <div key={x}>• {iss}</div>)}</div>
                    ) : null}
                    {clip?.note ? <div style={{ marginTop: 6, fontSize: 12, color: T.muted }}>{clip.note}</div> : null}
                    {clip?.modelUsed && clip.videoUrl ? <div style={{ marginTop: 4, fontSize: 10.5, color: T.muted, fontFamily: T.mono }}>model: {clip.modelUsed} · takes: {clip.attempts}</div> : null}
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
            {/* Runway Recipes — quoted free before any paid submit; 503-guarded */}
            <details style={{ marginTop: 18 }}>
              <summary style={{ fontSize: 13, fontWeight: 700, color: T.soft, cursor: 'pointer' }}>Runway Recipe tools — product ads, UGC, swaps, multi-shot, localization, campaign images (free quote before every paid call)</summary>
              <div style={{ marginTop: 10 }}>
                <RunwayRecipesPanel uploadFile={(f) => uploadUserFile(f).then((a) => a.url)} />
              </div>
            </details>
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
              <div style={{ ...card, borderColor: T.bad, marginBottom: 12 }}>
                <div style={{ color: T.bad, fontWeight: 700 }}>Assembly failed</div>
                <div style={{ color: T.soft, fontSize: 13, margin: '6px 0 10px' }}>{s.assemblyError}</div>
                <Btn kind="primary" onClick={runAssembly}><RefreshCw size={14} /> Retry assembly</Btn>
              </div>
            )}

            {s.finalVideoUrl && (
              <div style={{ ...card, marginBottom: 14, borderColor: T.good }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <video src={blobUrl || s.finalVideoUrl} controls style={{ width: s.aspect === '9:16' ? 240 : 420, borderRadius: 10, background: '#000' }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Final ad</div>
                    <div style={{ color: T.muted, fontSize: 13, marginBottom: 12 }}>Assembled in your browser with FFmpeg — captions and overlays burned in.</div>
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
                  <div key={sc.clip_number} style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ width: 150 }}>
                      <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: s.aspect === '9:16' ? '9/16' : s.aspect === '1:1' ? '1/1' : '16/9' }}>
                        {clip?.videoUrl ? <video src={clip.videoUrl} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ color: T.muted, fontSize: 11, padding: 8 }}>No clip</div>}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
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
                        <Btn small disabled={s.isProcessing} onClick={() => setEditingPrompt(editingPrompt === sc.clip_number ? null : sc.clip_number)}><Pencil size={12} /> Veo prompt</Btn>
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
                {s.assemblyStatus === 'assembling' ? <Spin /> : <Wand2 size={15} />} Assemble Final Ad
              </Btn>
              <Btn small onClick={() => setShowLogs(!showLogs)}>{showLogs ? 'Hide' : 'Show'} FFmpeg logs</Btn>
            </div>
            {showLogs && (
              <pre style={{ ...card, marginTop: 10, maxHeight: 220, overflow: 'auto', fontSize: 11, fontFamily: T.mono, color: T.muted, whiteSpace: 'pre-wrap' }}>
                {ffLogs.length ? ffLogs.join('\n') : 'No FFmpeg output yet.'}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
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
                            <div style={{ fontSize: 11.5, color: T.bad, marginBottom: 6 }}>{(v.error || '').slice(0, 120)}</div>
                            <Btn small disabled={s.isProcessing} onClick={() => buildVariation(hi, bi, ci)}><RefreshCw size={12} /> Retry</Btn>
                          </div>
                        ) : v ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.muted }}><Spin /> building…</div>
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
              <div style={card}><Btn kind="primary" onClick={runMatrix}><Wand2 size={14} /> Generate the variation matrix</Btn></div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
