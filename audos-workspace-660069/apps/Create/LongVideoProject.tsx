/**
 * Long Video / Project mode — the multi-scene, consistent-character flow.
 *
 * Five steps, its own rail, and it never touches the short-video wizard:
 *   1. Character  — reuses CharacterStep (saved quick-picks, AI portrait,
 *                   photo upload). Required here: the character IS the anchor.
 *   2. Brief      — brand/product context + ONE brief, plus tone, length and
 *                   aspect. An optional product shot is read with vision and
 *                   every scene is written to match it.
 *   3. Scene plan — the brief is decomposed by the planner into 3–6 sequential
 *                   scenes of 10–20s. Shown as an editable card list that the
 *                   user confirms before a single credit is spent.
 *   4. Generate   — scenes render ONE AT A TIME through the existing
 *                   generate-video hook, each with the IDENTICAL locked
 *                   anchor. Every finished clip URL is stored before the next
 *                   scene starts, and a failed scene can be retried on its own
 *                   without touching the scenes that already landed.
 *   5. Deliver    — all clips are stitched into one MP4 (see stitchProject in
 *                   projectApi.ts for the three paths) and delivered as a
 *                   single download.
 *
 * The whole run also lives in the `video_projects` table, so a project that is
 * interrupted (reload, closed tab) can be resumed from the project list
 * instead of being re-rendered from scratch.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Download,
  Film,
  Layers,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import CharacterStep from './CharacterStep';
import VideoResultHero from '../../components/VideoResultHero';
import { describeProductImage, generateScenePreview, uploadImage } from './studioApi';
import {
  clampText,
  DEFAULT_VIDEO_MODEL,
  getTone,
  modelHasSound,
  sceneImagePrompt,
  shortModelLabel,
  TONES,
  type AspectRatio,
  type BoardScene,
  type CharacterRef,
} from './videoTypes';
import {
  beatCountFor,
  buildCharacterAnchor,
  createProjectRow,
  estimatedSecondsFor,
  estimatedTotalSeconds,
  isContentFilterError,
  listProjectRows,
  makePlannedScene,
  MAX_PROJECT_SCENES,
  MAX_SCENE_SECONDS,
  MIN_PROJECT_SCENES,
  MIN_SCENE_SECONDS,
  planScenes,
  PROJECT_LENGTHS,
  renumberScenes,
  resolvePhoneShotScene,
  stitchProject,
  submitSceneRender,
  updateProjectRow,
  waitForSceneRender,
  withoutImageAnchor,
  type CharacterAnchor,
  type PlannedScene,
  type ProjectBrief,
  type ProjectRow,
  type ProjectSceneRow,
  type SceneRun,
  type StitchOutcome,
} from './projectApi';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  GhostButton,
  IconButton,
  ModelPicker,
  PrimaryButton,
  StepHeader,
  StepIndicator,
  T,
  TextArea,
  TextInput,
} from './ui';

type Step = 'character' | 'brief' | 'plan' | 'render' | 'done';

/** One scene's preview still — the visual half of the approval gate. */
type ImageState = { status: 'loading' | 'ready' | 'error'; url?: string };

const PROJECT_STEPS = ['Character', 'Brief', 'Scene plan', 'Generate', 'Deliver'] as const;

const STEP_INDEX: Record<Step, number> = {
  character: 0,
  brief: 1,
  plan: 2,
  render: 3,
  done: 4,
};

const EMPTY_BRIEF: ProjectBrief = {
  brand: '',
  brandContext: '',
  brief: '',
  toneId: 'professional',
  aspect: '9:16',
  targetSeconds: 60,
  // OFF by default (Aug 15 2026): the phone-mockup beat is opt-in everywhere now,
  // because an on-by-default product placement put a phone in films nobody had
  // asked one for. Ticking the box gives the film exactly ONE such beat — the
  // closing CTA scene unless it is moved on the next step (resolvePhoneShotScene
  // reads an absent scene as "last").
  phoneShot: false,
  // The model every scene renders on. It lives on the brief so it rides into
  // brief_json and a resumed project carries on with the model it started on —
  // the same shared picker the Create screens and Video Series use.
  model: DEFAULT_VIDEO_MODEL,
};

function slugify(text: string): string {
  return (text || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

function StatusPill({ run }: { run: SceneRun }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending: { label: 'Queued', color: T.muted, bg: 'rgba(255,255,255,0.04)', border: T.border },
    submitting: { label: 'Starting', color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.28)' },
    rendering: { label: 'Rendering', color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.28)' },
    done: { label: 'Done', color: T.success, bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.28)' },
    failed: { label: 'Failed', color: T.danger, bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.28)' },
  };
  const s = map[run.status] || map.pending;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
      }}
    >
      {run.status === 'rendering' || run.status === 'submitting' ? <Loader2 size={10} className="rc-spin" /> : null}
      {run.status === 'done' ? <Check size={10} /> : null}
      {run.status === 'failed' ? <AlertTriangle size={10} /> : null}
      {s.label}
    </span>
  );
}

/** The locked anchor, shown wherever the user needs to trust the lock. */
function AnchorStrip({ anchor, sceneCount }: { anchor: CharacterAnchor; sceneCount: number }) {
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span
        style={{
          position: 'relative',
          display: 'block',
          width: 46,
          height: 46,
          flexShrink: 0,
          borderRadius: 10,
          overflow: 'hidden',
          border: `1px solid ${T.borderStrong}`,
          background: '#000',
        }}
      >
        {anchor.imageUrl ? (
          <img
            src={anchor.imageUrl}
            alt={anchor.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(160deg, rgba(124,58,237,0.3), #0a0a0f)',
            }}
          >
            <User size={18} color="rgba(255,255,255,0.6)" />
          </span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: T.text }}
        >
          <Lock size={12} color={T.accentFg} /> {anchor.name} — locked for all {sceneCount} scenes
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
          {anchor.referenceImageUrl
            ? 'The same reference image and character block go into every scene render — that is what stops the face drifting.'
            : 'No photo on this character, so the lock is text-only. Add a photo next time for the strongest match.'}
        </span>
      </div>
    </Card>
  );
}

export default function LongVideoProject({
  onExit,
  onBusyChange,
}: {
  /** Leave project mode (wired to the app's Short Video tab). */
  onExit?: () => void;
  /** True while a render is in flight, so the host can pin the user here. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('character');
  const [character, setCharacter] = useState<CharacterRef | null>(null);
  const [brief, setBrief] = useState<ProjectBrief>(EMPTY_BRIEF);
  const [title, setTitle] = useState('');
  const [scenes, setScenes] = useState<PlannedScene[]>([]);
  const [planning, setPlanning] = useState(false);
  const [planFallback, setPlanFallback] = useState(false);
  const [anchor, setAnchor] = useState<CharacterAnchor | null>(null);
  const [runs, setRuns] = useState<Record<string, SceneRun>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  /** A calm, non-error line about this run — today only the Kling fallback. */
  const [runNotice, setRunNotice] = useState<string | null>(null);
  /** Whether the ONE manual same-photo re-roll has been spent (see retryWithPhoto). */
  const [photoRetryUsed, setPhotoRetryUsed] = useState(false);
  const [stitchStage, setStitchStage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<StitchOutcome | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsKey, setProjectsKey] = useState(0);
  /** Whether this project got a row — i.e. whether it can really be resumed. */
  const [persisted, setPersisted] = useState(false);
  /** Why it did not, in plain language, when saving was refused. */
  const [persistNotice, setPersistNotice] = useState<string | null>(null);
  const [sceneImages, setSceneImages] = useState<Record<string, ImageState>>({});

  const fileRef = useRef<HTMLInputElement | null>(null);
  /** Last prompt drawn per scene, so a re-render never redraws for free. */
  const stillPromptCache = useRef<Record<string, string>>({});
  const scenesRef = useRef<PlannedScene[]>([]);
  const briefRef = useRef<ProjectBrief>(EMPTY_BRIEF);
  const titleRef = useRef('');
  const anchorRef = useRef<CharacterAnchor | null>(null);
  const runsRef = useRef<Record<string, SceneRun>>({});
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  /**
   * Which run owns the loop. Stopping bumps it, and every await inside runFrom
   * checks it — so a stopped run cannot wake back up and start rendering
   * alongside the one that replaced it (abortRef alone could not do that: the
   * next runFrom clears it while the old loop is still mid-poll).
   */
  const runTokenRef = useRef(0);
  const workspaceUuidRef = useRef<string | null>(null);
  const projectIdRef = useRef<number | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // Stop polling when the app window closes mid-render.
  useEffect(
    () => () => {
      abortRef.current = true;
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await listProjectRows();
      if (alive) setProjects(rows);
    })();
    return () => {
      alive = false;
    };
  }, [projectsKey]);

  // While scenes are rendering the user must stay on this screen — the final
  // stitch runs in this browser tab.
  useEffect(() => {
    if (onBusyChange) onBusyChange(step === 'render');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(
    () => () => {
      if (onBusyChange) onBusyChange(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (step !== 'render') return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  const patchBrief = (patch: Partial<ProjectBrief>) => {
    setBrief((b) => {
      const next = { ...b, ...patch };
      briefRef.current = next;
      return next;
    });
  };

  // ---- Scene preview stills ----
  // Same prompt language as the short-video storyboard, so what the user
  // approves is what gets rendered — and because every still carries the same
  // character description, the plan itself shows the consistency they are
  // paying for BEFORE any video credit is spent.
  const stillPromptFor = (scene: PlannedScene): string => {
    const board: BoardScene = {
      key: scene.key,
      shotType: scene.label || 'Medium shot',
      description: scene.prompt,
      dialogue: scene.dialogue,
      durationSec: scene.durationSec,
    };
    return sceneImagePrompt(board, character, getTone(brief.toneId).prompt, 'cinematic', brief.productReference);
  };

  const generateStill = (scene: PlannedScene, force = false) => {
    if (!(scene.prompt || '').trim()) return;
    const prompt = stillPromptFor(scene);
    if (!force && stillPromptCache.current[scene.key] === prompt) return;
    stillPromptCache.current[scene.key] = prompt;
    setSceneImages((m) => ({ ...m, [scene.key]: { status: 'loading' } }));
    void generateScenePreview(prompt, brief.aspect)
      .then((url) => setSceneImages((m) => ({ ...m, [scene.key]: { status: 'ready' as const, url } })))
      .catch(() => setSceneImages((m) => ({ ...m, [scene.key]: { status: 'error' as const } })));
  };

  // Draw every scene of a fresh plan in parallel.
  useEffect(() => {
    if (step !== 'plan' || planning) return;
    scenes.forEach((s) => generateStill(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, planning, scenes.map((s) => s.key).join('|')]);

  const patchRun = (key: string, patch: Partial<SceneRun>) => {
    const prev: SceneRun = runsRef.current[key] || { status: 'pending', clipUrls: [] };
    runsRef.current = { ...runsRef.current, [key]: { ...prev, ...patch } };
    setRuns(runsRef.current);
  };

  /** Source of truth for the async runner — always current, never stale. */
  const runOf = (key: string): SceneRun => runsRef.current[key] || { status: 'pending', clipUrls: [] };

  /** The same map mirrored into state, so the UI re-renders as scenes move on. */
  const viewRun = (key: string): SceneRun => runs[key] || { status: 'pending', clipUrls: [] };

  const collectClips = (): string[] =>
    scenesRef.current.reduce<string[]>((all, s) => all.concat(runOf(s.key).clipUrls || []), []);

  const sceneRows = (): ProjectSceneRow[] =>
    scenesRef.current.map((s) => {
      const r = runOf(s.key);
      return {
        index: s.index,
        label: s.label,
        prompt: s.prompt,
        dialogue: s.dialogue,
        durationSec: s.durationSec,
        status: r.status,
        jobId: r.jobId,
        clipUrls: r.clipUrls || [],
      };
    });

  const persist = async (patch: Record<string, unknown> = {}) => {
    await updateProjectRow(projectIdRef.current, {
      scenes_json: sceneRows(),
      clip_urls: collectClips(),
      ...patch,
    });
  };

  // ---- Step 1: character ----
  const handleCharacter = (picked: CharacterRef) => {
    setCharacter(picked);
    setStep('brief');
  };

  // ---- Step 2: brief ----
  const handleProductUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, 'products');
      patchBrief({ productImageUrl: url });
      const read = await describeProductImage(url);
      if (read) {
        patchBrief({
          productReference: read.visualReference,
          brand: briefRef.current.brand || read.brief.name,
          brandContext: briefRef.current.brandContext || read.brief.tagline || read.brief.features,
        });
      }
    } catch (e) {
      console.warn('[Create] product image upload failed:', e);
    }
    setUploading(false);
  };

  const runPlanner = async () => {
    if (!character) return;
    setPlanning(true);
    setStep('plan');
    const plan = await planScenes(briefRef.current, character);
    setScenes(plan.scenes);
    scenesRef.current = plan.scenes;
    setTitle(plan.title);
    titleRef.current = plan.title;
    setPlanFallback(plan.fallback);
    setPlanning(false);
  };

  // ---- Step 3: plan edits ----
  const updateScene = (key: string, patch: Partial<PlannedScene>) => {
    setScenes((list) => {
      const next = list.map((s) => (s.key === key ? { ...s, ...patch } : s));
      scenesRef.current = next;
      return next;
    });
  };

  const removeScene = (key: string) => {
    setScenes((list) => {
      if (list.length <= MIN_PROJECT_SCENES) return list;
      const next = renumberScenes(list.filter((s) => s.key !== key));
      scenesRef.current = next;
      return next;
    });
  };

  const addScene = () => {
    setScenes((list) => {
      if (list.length >= MAX_PROJECT_SCENES) return list;
      const next = renumberScenes([
        ...list,
        makePlannedScene(list.length + 1, 'New beat', '', '', MIN_SCENE_SECONDS),
      ]);
      scenesRef.current = next;
      return next;
    });
  };

  // ---- Step 4: lock the anchor and render the scenes in order ----
  const confirmPlan = async () => {
    if (!character || runningRef.current) return;
    const usable = renumberScenes(scenes.filter((s) => (s.prompt || '').trim().length > 0));
    if (usable.length < MIN_PROJECT_SCENES) {
      setRunError(`A project needs at least ${MIN_PROJECT_SCENES} scenes with a visual description.`);
      return;
    }
    // THE LOCK: built once, here, and reused verbatim for every scene call.
    // The approved scene-1 still leads the anchor priority, so each clip opens
    // on a real frame of the film instead of on the character's portrait.
    const openingStill = sceneImages[usable[0].key];
    const locked = buildCharacterAnchor(
      character,
      brief.productImageUrl,
      openingStill && openingStill.status === 'ready' ? openingStill.url : undefined,
    );
    anchorRef.current = locked;
    setAnchor(locked);
    setScenes(usable);
    scenesRef.current = usable;

    const fresh: Record<string, SceneRun> = {};
    usable.forEach((s) => {
      fresh[s.key] = { status: 'pending', clipUrls: [] };
    });
    runsRef.current = fresh;
    setRuns(fresh);
    setRunError(null);
    setRunNotice(null);
    setOutcome(null);
    setCurrentIndex(0);
    setStep('render');

    const saved = await createProjectRow({
      title: titleRef.current || 'Untitled project',
      brief: brief.brief,
      brand: [brief.brand, brief.brandContext].filter(Boolean).join(' — '),
      tone: getTone(brief.toneId).prompt,
      aspect_ratio: brief.aspect,
      target_seconds: brief.targetSeconds,
      scene_count: usable.length,
      character_name: locked.name,
      character_description: locked.block,
      character_image_url: locked.imageUrl || null,
      reference_image_url: locked.referenceImageUrl || null,
      character_anchor: locked,
      brief_json: briefRef.current,
      scenes_json: sceneRows(),
      clip_urls: [],
      status: 'generating',
    });
    projectIdRef.current = saved.id;
    setPersisted(!!saved.id);
    setPersistNotice(saved.notice || null);
    setProjectsKey((k) => k + 1);
    void runFrom(0);
  };

  const runFrom = async (fromIndex: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    const token = ++runTokenRef.current;
    /** True once this run has been stopped, or replaced by a newer one. */
    const stale = () => abortRef.current || runTokenRef.current !== token;
    setRunning(true);
    setRunError(null);
    try {
      const list = scenesRef.current;
      const locked = anchorRef.current;
      if (!locked) return;

      for (let i = fromIndex; i < list.length; i++) {
        if (stale()) return;
        const scene = list[i];
        const existing = runOf(scene.key);
        if (existing.status === 'done' && (existing.clipUrls || []).length > 0) continue;
        setCurrentIndex(i);

        let jobId = existing.jobId;
        if (!jobId) {
          patchRun(scene.key, { status: 'submitting', error: undefined, message: 'Starting this scene…' });
          const submitted = await submitSceneRender({
            scene,
            anchor: locked,
            brief: briefRef.current,
            projectTitle: titleRef.current,
            sceneTotal: list.length,
          });
          // Said out loud rather than swallowed: the customer picked a model,
          // so if the render had to move engines they should be told, once.
          if (submitted.notice) setRunNotice(submitted.notice);
          if (!submitted.success || !submitted.jobId) {
            const message = submitted.error || 'This scene could not be started.';
            patchRun(scene.key, { status: 'failed', error: message, message: undefined });
            setRunError(`Scene ${scene.index} — ${scene.label}: ${message}`);
            await persist({ status: 'failed', error: message });
            return;
          }
          jobId = submitted.jobId;
        }

        patchRun(scene.key, { status: 'rendering', jobId, error: undefined, message: 'Rendering this scene…' });
        await persist({ status: 'generating' });

        try {
          const result = await waitForSceneRender(jobId, {
            onTick: (message) => patchRun(scene.key, { message }),
            isAborted: stale,
          });
          if (result.workspaceUuid) workspaceUuidRef.current = result.workspaceUuid;
          patchRun(scene.key, {
            status: 'done',
            clipUrls: result.clipUrls,
            message: `${result.clipUrls.length} clip${result.clipUrls.length === 1 ? '' : 's'} ready`,
          });
          // Clips are persisted BEFORE the next scene starts, so an
          // interrupted project resumes instead of re-rendering.
          await persist({ status: 'generating' });
        } catch (e: any) {
          if (stale()) return;
          const message = (e && e.message) || 'This scene failed to render.';
          patchRun(scene.key, { status: 'failed', error: message, message: undefined });
          setRunError(`Scene ${scene.index} — ${scene.label}: ${message}`);
          await persist({ status: 'failed', error: message });
          return;
        }
      }

      if (stale()) return;
      await stitchAll();
    } finally {
      // Only the run that still owns the loop may unlock it — a stopped run
      // must not report "not running" for the run that came after it.
      if (runTokenRef.current === token) {
        runningRef.current = false;
        setRunning(false);
      }
    }
  };

  const stitchAll = async () => {
    const clips = collectClips();
    const label = `Stitching ${clips.length} clip${clips.length === 1 ? '' : 's'} into one MP4…`;
    setStitchStage(label);
    await persist({ status: 'stitching' });
    const result = await stitchProject(clips, {
      workspaceUuid: workspaceUuidRef.current,
      fileName: `reelio-${slugify(titleRef.current)}-${Date.now()}.mp4`,
      onStage: (stage) =>
        setStitchStage(
          stage === 'uploading'
            ? 'Saving your final cut…'
            : stage === 'server'
              ? 'Merging on the server…'
              : label,
        ),
    });
    setStitchStage(null);
    setOutcome(result);
    setStep('done');
    await persist({
      status: result.url ? 'completed' : 'partial',
      final_video_url: result.url || null,
      stitch_method: result.method,
      error: result.error || null,
    });
    setProjectsKey((k) => k + 1);
  };

  /**
   * The safety filter rejected the character photo. Drop the image half of the
   * lock, keep the written description, and carry on from the scene that failed
   * — finished scenes are untouched.
   */
  const dropPhotoAndContinue = (index: number) => {
    const locked = anchorRef.current;
    if (!locked || runningRef.current) return;
    const textOnly = withoutImageAnchor(locked);
    anchorRef.current = textOnly;
    setAnchor(textOnly);
    const scene = scenesRef.current[index];
    if (scene) {
      patchRun(scene.key, {
        status: 'pending',
        jobId: undefined,
        error: undefined,
        clipUrls: [],
        message: undefined,
      });
    }
    void persist({
      character_anchor: textOnly,
      character_image_url: null,
      reference_image_url: null,
    });
    void runFrom(index);
  };

  /**
   * STOP — the way out of a run that is already going.
   *
   * `abortRef` is the flag waitForSceneRender polls, so the loop drops out at
   * its next tick rather than carrying on invisibly behind the scene plan. The
   * scene the run was on goes back to 'pending' so nothing is left wearing a
   * spinner, every finished clip stays attached, and Generate picks the project
   * up from where it stopped.
   *
   * It ends the WAIT, not the spend: a clip the engine has already accepted
   * finishes at their end and lands in My Videos.
   */
  const stopRun = () => {
    abortRef.current = true;
    runTokenRef.current += 1;
    runningRef.current = false;
    setRunning(false);
    setStitchStage(null);
    setRunError(null);
    const scene = scenesRef.current[currentIndex];
    if (scene) {
      const run = runOf(scene.key);
      if (run.status === 'submitting' || run.status === 'rendering') {
        patchRun(scene.key, { status: 'pending', message: undefined, error: undefined });
      }
    }
    void persist({ status: 'paused' });
    setStep('plan');
  };

  /**
   * Pick a stopped run back up. runFrom() skips any scene that already has its
   * clips, so this never re-renders — and never re-charges for — work that
   * landed before the stop. The anchor is the SAME locked one, so the character
   * does not drift across the break.
   */
  const resumeRun = () => {
    if (runningRef.current || !anchorRef.current) return;
    setRunError(null);
    setStep('render');
    void runFrom(0);
  };

  /** Retry ONE failed scene with a fresh render; finished scenes are kept. */
  const retryScene = (index: number) => {
    const scene = scenesRef.current[index];
    if (!scene || runningRef.current) return;
    patchRun(scene.key, { status: 'pending', jobId: undefined, error: undefined, clipUrls: [], message: undefined });
    void runFrom(index);
  };

  /**
   * ONE manual re-roll of the content filter with the SAME photo. The
   * rejection is measurably nondeterministic — the identical portrait passed
   * as the identical start image on a later attempt (video_jobs row 75,
   * Aug 13 2026) — and the image anchor holds the face better than the
   * text-only lock, so the user may choose to spend exactly one extra render
   * on keeping it. Offered ONCE, mirroring the pipeline's own retry cap:
   * after a second rejection only the reliable escapes remain.
   */
  const retryWithPhoto = (index: number) => {
    if (runningRef.current) return;
    setPhotoRetryUsed(true);
    retryScene(index);
  };

  /** Keep following the render already in flight for this scene. */
  const resumeScene = (index: number) => {
    const scene = scenesRef.current[index];
    if (!scene || runningRef.current) return;
    patchRun(scene.key, { status: 'rendering', error: undefined, message: 'Picking the render back up…' });
    void runFrom(index);
  };

  const resumeProject = (row: ProjectRow) => {
    const rows = Array.isArray(row.scenes_json) ? row.scenes_json : [];
    if (rows.length === 0 || runningRef.current) return;
    const restored = rows.map((r, i) =>
      makePlannedScene(i + 1, r.label || `Scene ${i + 1}`, r.prompt || '', r.dialogue || '', r.durationSec || MIN_SCENE_SECONDS),
    );
    const restoredRuns: Record<string, SceneRun> = {};
    restored.forEach((s, i) => {
      const r = rows[i];
      const clipUrls = Array.isArray(r.clipUrls) ? r.clipUrls : [];
      restoredRuns[s.key] =
        r.status === 'done' && clipUrls.length > 0
          ? { status: 'done', clipUrls, jobId: r.jobId, message: `${clipUrls.length} clip${clipUrls.length === 1 ? '' : 's'} ready` }
          : { status: 'pending', clipUrls: [], jobId: r.status === 'rendering' ? r.jobId : undefined };
    });

    const storedAnchor = row.character_anchor;
    const locked: CharacterAnchor = storedAnchor && storedAnchor.block
      ? storedAnchor
      : buildCharacterAnchor(
          {
            name: row.character_name || 'Your character',
            description: row.character_description || '',
            imageUrl: row.character_image_url || undefined,
            source: 'saved',
          },
          row.reference_image_url || undefined,
        );
    const restoredBrief: ProjectBrief = row.brief_json && row.brief_json.brief
      ? row.brief_json
      : {
          ...EMPTY_BRIEF,
          brief: row.brief || '',
          brand: row.brand || '',
          aspect: (row.aspect_ratio === '16:9' ? '16:9' : '9:16') as AspectRatio,
          targetSeconds: row.target_seconds || 60,
        };

    setCharacter({
      name: locked.name,
      description: locked.description,
      imageUrl: locked.imageUrl,
      source: 'saved',
    });
    anchorRef.current = locked;
    setAnchor(locked);
    briefRef.current = restoredBrief;
    setBrief(restoredBrief);
    titleRef.current = row.title || 'Untitled project';
    setTitle(titleRef.current);
    scenesRef.current = restored;
    setScenes(restored);
    runsRef.current = restoredRuns;
    setRuns(restoredRuns);
    projectIdRef.current = row.id;
    setPersisted(true);
    setOutcome(null);
    setRunError(null);
    setRunNotice(null);
    setCurrentIndex(0);
    setStep('render');
    void runFrom(0);
  };

  const resetProject = () => {
    abortRef.current = true;
    runningRef.current = false;
    setStep('character');
    setCharacter(null);
    setBrief(EMPTY_BRIEF);
    briefRef.current = EMPTY_BRIEF;
    setTitle('');
    titleRef.current = '';
    setScenes([]);
    scenesRef.current = [];
    setAnchor(null);
    anchorRef.current = null;
    setRuns({});
    runsRef.current = {};
    setOutcome(null);
    setRunError(null);
    setRunNotice(null);
    setStitchStage(null);
    setSceneImages({});
    stillPromptCache.current = {};
    projectIdRef.current = null;
    setPersisted(false);
    setPhotoRetryUsed(false);
    setProjectsKey((k) => k + 1);
  };

  const totalEstimate = estimatedTotalSeconds(scenes);
  const doneCount = scenes.filter((s) => viewRun(s.key).status === 'done').length;
  const phoneShotOn = brief.phoneShot === true;
  /** The one scene that will carry the phone beat, or null when it is off. */
  const phoneShotScene = resolvePhoneShotScene(brief, scenes.length);

  // -------------------------------------------------------------------------
  return (
    <div>
      <StepIndicator current={STEP_INDEX[step]} steps={PROJECT_STEPS} />

      {/* ---- 1. Character ---- */}
      {step === 'character' ? (
        <>
          <Card style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: 9,
                background: T.accentSoft,
                border: `1px solid ${T.accentBorder}`,
              }}
            >
              <Layers size={16} color={T.accentFg} />
            </span>
            <div>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text }}>
                Long Video — one brief, many scenes, one character
              </span>
              <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
                Write a single brief and we split it into {MIN_PROJECT_SCENES}–{MAX_PROJECT_SCENES} sequential scenes,
                render them one at a time with the same character locked into every shot, then stitch them into one
                downloadable MP4.
              </span>
            </div>
          </Card>

          <CharacterStep
            required
            backLabel="Short Video"
            subtitle="Pick a saved character, generate one with AI, or upload a photo. Whoever you choose here is locked into every scene of the project — same face, same hair, same outfit, all the way through."
            onBack={onExit || (() => undefined)}
            onDone={handleCharacter}
            onSkip={() => undefined}
          />

          {projects.length > 0 ? (
            <div className="rc-fade" style={{ marginTop: 40 }}>
              <h2
                style={{
                  margin: '0 0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  color: T.text,
                }}
              >
                <Film size={15} color={T.accentFg} /> Your projects
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {projects.map((row) => {
                  const finished = row.status === 'completed' && !!row.final_video_url;
                  const resumable =
                    !finished && Array.isArray(row.scenes_json) && row.scenes_json.length > 0;
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        padding: '11px 14px',
                        borderRadius: 12,
                        border: `1px solid ${T.border}`,
                        background: T.panel,
                      }}
                      data-testid={`project-row-${row.id}`}
                    >
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: T.text }}>
                          {row.title || 'Untitled project'}
                        </span>
                        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted }}>
                          {row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}
                          {row.scene_count ? ` · ${row.scene_count} scenes` : ''}
                          {row.aspect_ratio ? ` · ${row.aspect_ratio}` : ''}
                          {` · ${row.status || 'planning'}`}
                        </span>
                      </div>
                      {finished ? (
                        <a
                          href={row.final_video_url || '#'}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rc-ghost"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '7px 12px',
                            borderRadius: 9,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: T.sub,
                            textDecoration: 'none',
                            border: `1px solid ${T.border}`,
                            background: 'rgba(255,255,255,0.03)',
                          }}
                        >
                          <Download size={13} /> Download
                        </a>
                      ) : null}
                      {resumable ? (
                        <GhostButton onClick={() => resumeProject(row)} style={{ padding: '7px 12px', fontSize: 12.5 }}>
                          <RefreshCw size={13} /> Resume
                        </GhostButton>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---- 2. Brief ---- */}
      {step === 'brief' && character ? (
        <div className="rc-fade" style={{ maxWidth: 640 }}>
          <StepHeader
            title="What's the film?"
            subtitle={`One brief — ${character.name} presents every scene of it. Describe the arc and we'll split it into scenes.`}
            onBack={() => setStep('character')}
            backLabel="Character"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FieldLabel hint="What the video is selling, launching or explaining.">Brand / product</FieldLabel>
                <TextInput
                  value={brief.brand}
                  onChange={(v) => patchBrief({ brand: v })}
                  placeholder="e.g. Northwind Coffee"
                  testId="input-project-brand"
                />
              </div>
              <div>
                <FieldLabel>What is it, in a line or two?</FieldLabel>
                <TextArea
                  value={brief.brandContext}
                  onChange={(v) => patchBrief({ brandContext: v })}
                  rows={2}
                  placeholder="e.g. Small-batch roasts shipped within 48 hours, for people who take mornings seriously."
                  testId="input-project-context"
                  expand={{
                    field: 'What the product or brand is',
                    context: brief.brand ? `Brand / product: ${brief.brand}` : undefined,
                    words: 40,
                  }}
                />
              </div>
              <div>
                <FieldLabel hint="Name the beats if you know them — the planner follows your order.">
                  The brief
                </FieldLabel>
                <TextArea
                  value={brief.brief}
                  onChange={(v) => patchBrief({ brief: v })}
                  rows={4}
                  autoFocus
                  placeholder="e.g. 60-second ad: intro → product demo → testimonial → CTA"
                  testId="input-project-brief"
                  expand={{
                    field: 'Long-video brief (the arc of the film, beat by beat)',
                    context: [
                      brief.brand ? `Brand / product: ${brief.brand}` : '',
                      brief.brandContext ? `About it: ${brief.brandContext}` : '',
                      `On camera in every scene: ${character.name} — ${character.description}`,
                    ]
                      .filter(Boolean)
                      .join(' — '),
                    words: 80,
                  }}
                />
              </div>
              <div>
                <FieldLabel hint="Optional. We read it with AI and every scene is written to match it.">
                  Product / brand image
                </FieldLabel>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => void handleProductUpload(e.target.files && e.target.files[0])}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {brief.productImageUrl ? (
                    <img
                      src={brief.productImageUrl}
                      alt="Product reference"
                      style={{
                        width: 62,
                        height: 62,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: `1px solid ${T.borderStrong}`,
                        background: '#000',
                      }}
                    />
                  ) : null}
                  <GhostButton
                    onClick={() => fileRef.current && fileRef.current.click()}
                    disabled={uploading}
                    testId="button-project-product-image"
                  >
                    {uploading ? <Loader2 size={14} className="rc-spin" /> : <Upload size={14} />}
                    {uploading ? 'Reading the image…' : brief.productImageUrl ? 'Replace image' : 'Add an image'}
                  </GhostButton>
                </div>
                {brief.productReference ? (
                  <p style={{ margin: '9px 0 0', fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
                    Reading it as: {clampText(brief.productReference, 220)}
                  </p>
                ) : null}
              </div>
            </Card>

            <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                {/* The same shared picker the Create screens and Video Series
                    use — the pick rides on the brief into every scene render. */}
                <ModelPicker
                  value={brief.model || DEFAULT_VIDEO_MODEL}
                  onChange={(id) => patchBrief({ model: id })}
                />
                <p style={{ margin: '11px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
                  {shortModelLabel(brief.model || DEFAULT_VIDEO_MODEL)} renders every scene of this project —{' '}
                  {modelHasSound(brief.model || DEFAULT_VIDEO_MODEL)
                    ? 'it speaks the dialogue on camera, with music and ambience'
                    : 'picture only, no soundtrack'}
                  .
                </p>
              </div>
              <div>
                <FieldLabel>Tone</FieldLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {TONES.map((tone) => (
                    <Chip
                      key={tone.id}
                      selected={brief.toneId === tone.id}
                      onClick={() => patchBrief({ toneId: tone.id })}
                      testId={`chip-project-tone-${tone.id}`}
                    >
                      {tone.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel
                  hint={`Split into ${MIN_PROJECT_SCENES}–${MAX_PROJECT_SCENES} scenes of ${MIN_SCENE_SECONDS}–${MAX_SCENE_SECONDS}s. 45–60s stitches into one file in your browser; 90s+ can outgrow that and fall back to a server merge. Renders are picture only — add your own music or voiceover after.`}
                >
                  Target length
                </FieldLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PROJECT_LENGTHS.map((len) => (
                    <Chip
                      key={len.seconds}
                      selected={brief.targetSeconds === len.seconds}
                      onClick={() => patchBrief({ targetSeconds: len.seconds })}
                      testId={`chip-project-length-${len.seconds}`}
                    >
                      {len.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>Aspect ratio</FieldLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(['9:16', '16:9'] as AspectRatio[]).map((ratio) => (
                    <Chip
                      key={ratio}
                      selected={brief.aspect === ratio}
                      onClick={() => patchBrief({ aspect: ratio })}
                      testId={`chip-project-aspect-${ratio.replace(':', '-')}`}
                    >
                      {ratio === '9:16' ? 'Vertical 9:16' : 'Widescreen 16:9'}
                    </Chip>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <button
                type="button"
                onClick={() => patchBrief({ phoneShot: !phoneShotOn })}
                aria-pressed={phoneShotOn}
                data-testid="toggle-project-phone-shot"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 11,
                  width: '100%',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    marginTop: 1,
                    flexShrink: 0,
                    borderRadius: 5,
                    border: `1px solid ${phoneShotOn ? T.accentBorder : T.borderStrong}`,
                    background: phoneShotOn ? T.accent : 'transparent',
                  }}
                >
                  {phoneShotOn ? <Check size={12} color="#fff" /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: T.text,
                    }}
                  >
                    <Smartphone size={13} color={T.accentFg} /> Include the VidVerge phone shot
                  </span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
                    Off unless you want it. Switch it on and one beat shows {character.name} holding up a phone with the
                    VidVerge app on screen — a single scene, the closing CTA by default, and you can move it on the next
                    step.
                  </span>
                </span>
              </button>
            </Card>

            <PrimaryButton
              onClick={() => void runPlanner()}
              disabled={!brief.brief.trim()}
              full
              testId="button-plan-scenes"
            >
              <Sparkles size={15} /> Plan the scenes
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* ---- 3. Scene plan ---- */}
      {step === 'plan' ? (
        <div className="rc-fade">
          <StepHeader
            title={planning ? 'Splitting your brief into scenes…' : 'Your scene plan'}
            subtitle={
              planning
                ? 'Working out the beats, the order and what each one says — then drawing a preview of each shot.'
                : `${scenes.length} scenes · ≈${totalEstimate}s · ${brief.aspect}. Each card is a real preview of that shot with your character in it. Edit anything — no video renders until you confirm.`
            }
            onBack={() => setStep('brief')}
            backLabel="Brief"
          />

          {planning ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <Card key={i} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div className="rc-skeleton" style={{ height: 12, width: '30%', borderRadius: 6 }} />
                  <div className="rc-skeleton" style={{ height: 10, width: '92%', borderRadius: 6 }} />
                  <div className="rc-skeleton" style={{ height: 10, width: '70%', borderRadius: 6 }} />
                </Card>
              ))}
            </div>
          ) : (
            <>
              {character ? (
                <AnchorStrip
                  anchor={buildCharacterAnchor(character, brief.productImageUrl)}
                  sceneCount={scenes.length}
                />
              ) : null}

              {planFallback ? (
                <div style={{ marginBottom: 16 }}>
                  <Card
                    style={{
                      borderColor: 'rgba(245,158,11,0.3)',
                      background: 'rgba(245,158,11,0.07)',
                      fontSize: 12.5,
                      color: T.sub,
                      lineHeight: 1.55,
                    }}
                  >
                    The AI planner didn't answer, so this is a structural split of your brief. Edit the scenes below —
                    they render exactly as written.
                  </Card>
                </div>
              ) : null}

              <div style={{ marginBottom: 16 }}>
                <FieldLabel>Project title</FieldLabel>
                <TextInput value={title} onChange={setTitle} placeholder="Name this project" testId="input-project-title" />
              </div>

              {/* One product placement per film: the user says which scene carries it. */}
              <Card style={{ marginBottom: 16 }}>
                <FieldLabel
                  hint={
                    phoneShotOn
                      ? 'Only this scene shows the app on a phone screen — every other scene renders without it.'
                      : 'No scene will hold up a phone with the app on screen.'
                  }
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Smartphone size={12} color={T.accentFg} /> VidVerge phone shot
                  </span>
                </FieldLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Chip
                    selected={!phoneShotOn}
                    onClick={() => patchBrief({ phoneShot: false })}
                    testId="chip-project-phone-off"
                  >
                    Leave it out
                  </Chip>
                  {scenes.map((scene) => (
                    <Chip
                      key={scene.key}
                      selected={phoneShotOn && phoneShotScene === scene.index}
                      onClick={() => patchBrief({ phoneShot: true, phoneShotScene: scene.index })}
                      testId={`chip-project-phone-scene-${scene.index}`}
                    >
                      {scene.index}. {scene.label}
                    </Chip>
                  ))}
                </div>
              </Card>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                {scenes.map((scene) => {
                  const img = sceneImages[scene.key];
                  return (
                  <Card key={scene.key} className="rc-fade" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* The visual approval gate: this shot, with THIS character. */}
                    <div
                      style={{
                        position: 'relative',
                        aspectRatio: brief.aspect === '9:16' ? '9 / 12' : '16 / 9',
                        background: '#000',
                      }}
                    >
                      {img && img.status === 'ready' && img.url ? (
                        <img
                          src={img.url}
                          alt={`Scene ${scene.index} preview`}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          data-testid={`img-project-scene-${scene.index}`}
                        />
                      ) : img && img.status === 'loading' ? (
                        <div className="rc-skeleton" style={{ position: 'absolute', inset: 0 }} />
                      ) : img && img.status === 'error' ? (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: T.muted,
                            fontSize: 12.5,
                          }}
                        >
                          <AlertTriangle size={18} color={T.danger} />
                          Preview failed
                          <GhostButton onClick={() => generateStill(scene, true)} style={{ padding: '6px 12px', fontSize: 12 }}>
                            <RefreshCw size={12} /> Retry
                          </GhostButton>
                        </div>
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 16,
                            textAlign: 'center',
                            color: T.muted,
                            fontSize: 12.5,
                          }}
                        >
                          Describe the scene below — the preview draws itself.
                        </div>
                      )}

                      <span
                        style={{
                          position: 'absolute',
                          top: 10,
                          left: 10,
                          maxWidth: 'calc(100% - 60px)',
                          padding: '4px 9px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#fff',
                          background: 'rgba(0,0,0,0.62)',
                          backdropFilter: 'blur(4px)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        Scene {scene.index} — {scene.label || 'Untitled beat'}
                      </span>

                      <span style={{ position: 'absolute', top: 8, right: 8 }}>
                        <IconButton
                          label="Redraw this scene preview"
                          onClick={() => generateStill(scene, true)}
                          disabled={(!!img && img.status === 'loading') || !(scene.prompt || '').trim()}
                          style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)' }}
                        >
                          {img && img.status === 'loading' ? (
                            <Loader2 size={14} className="rc-spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                        </IconButton>
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{ flex: 1, minWidth: 120 }}>
                        <TextInput
                          value={scene.label}
                          onChange={(v) => updateScene(scene.key, { label: v })}
                          placeholder="Beat name"
                          testId={`input-scene-label-${scene.index}`}
                        />
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={12} color={T.muted} />
                        <input
                          type="number"
                          min={MIN_SCENE_SECONDS}
                          max={MAX_SCENE_SECONDS}
                          value={scene.durationSec}
                          onChange={(e) =>
                            updateScene(scene.key, {
                              durationSec: Math.min(
                                MAX_SCENE_SECONDS,
                                Math.max(MIN_SCENE_SECONDS, Number(e.target.value) || MIN_SCENE_SECONDS),
                              ),
                            })
                          }
                          aria-label={`Scene ${scene.index} duration in seconds`}
                          style={{
                            width: 46,
                            padding: '4px 6px',
                            borderRadius: 7,
                            border: `1px solid ${T.border}`,
                            background: 'rgba(255,255,255,0.04)',
                            color: T.sub,
                            fontSize: 12,
                            textAlign: 'center',
                            outline: 'none',
                          }}
                          data-testid={`input-scene-seconds-${scene.index}`}
                        />
                        <span style={{ fontSize: 11.5, color: T.muted }}>
                          s → ≈{estimatedSecondsFor(scene.durationSec)}s ({beatCountFor(scene.durationSec)} clip
                          {beatCountFor(scene.durationSec) === 1 ? '' : 's'})
                        </span>
                        <IconButton
                          label="Remove this scene"
                          onClick={() => removeScene(scene.key)}
                          disabled={scenes.length <= MIN_PROJECT_SCENES}
                          style={{ width: 26, height: 26 }}
                        >
                          <Trash2 size={12} />
                        </IconButton>
                      </span>
                    </div>
                    <TextArea
                      value={scene.prompt}
                      onChange={(v) => updateScene(scene.key, { prompt: v })}
                      onBlur={() => generateStill(scene)}
                      rows={3}
                      placeholder="What we see: setting, action, camera, light…"
                      testId={`input-scene-prompt-${scene.index}`}
                      expand={{
                        field: `Scene ${scene.index} description (${scene.label || 'beat'})`,
                        context: `${title || 'This film'}. ${getTone(brief.toneId).visual}.${
                          character ? ` On camera: ${character.name} — ${character.description}` : ''
                        }`,
                        words: 45,
                      }}
                    />
                    <TextArea
                      value={scene.dialogue}
                      onChange={(v) => updateScene(scene.key, { dialogue: v })}
                      rows={2}
                      placeholder="The line spoken on camera in this scene"
                      testId={`input-scene-line-${scene.index}`}
                      expand={{
                        field: `Scene ${scene.index} spoken line`,
                        context: `${title || 'This film'}. One short punchy sentence ${
                          character ? character.name : 'the character'
                        } can say out loud in about ${scene.durationSec} seconds.`,
                        words: 22,
                        label: 'Punch it up',
                      }}
                    />
                    </div>
                  </Card>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
                <GhostButton
                  onClick={addScene}
                  disabled={scenes.length >= MAX_PROJECT_SCENES}
                  testId="button-add-project-scene"
                >
                  <Plus size={13} /> Add scene
                </GhostButton>
                <GhostButton onClick={() => void runPlanner()} testId="button-replan">
                  <RefreshCw size={13} /> Re-plan from the brief
                </GhostButton>
              </div>

              {runError ? (
                <div style={{ marginBottom: 14 }}>
                  <ErrorNotice>{runError}</ErrorNotice>
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
                {doneCount > 0 && anchor ? (
                  <>
                    <PrimaryButton onClick={resumeRun} full testId="button-resume-project-run">
                      <Play size={15} /> Carry on rendering — {doneCount} of {scenes.length} done
                    </PrimaryButton>
                    <GhostButton onClick={() => void confirmPlan()} full testId="button-confirm-plan">
                      <Lock size={15} /> Start this project again from scene 1
                    </GhostButton>
                    <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.55 }}>
                      Carrying on renders only the scenes still waiting — the finished ones are kept and cost
                      nothing twice. Starting again re-renders all {scenes.length}.
                    </p>
                  </>
                ) : (
                  <>
                    <PrimaryButton onClick={() => void confirmPlan()} full testId="button-confirm-plan">
                      <Lock size={15} /> Lock character → generate {scenes.length} scenes
                    </PrimaryButton>
                    <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.55 }}>
                      Scenes render one at a time — about {Math.max(2, scenes.length * 3)}–{scenes.length * 5} minutes
                      for all {scenes.length}. This is the only step that spends video credits.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* ---- 4. Sequential generation ---- */}
      {step === 'render' && anchor ? (
        <div className="rc-fade" style={{ maxWidth: 620, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <h1
              style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: T.text }}
              data-testid="text-project-status"
            >
              {stitchStage ||
                (runError
                  ? 'A scene needs another go'
                  : `Generating scene ${Math.min(currentIndex + 1, scenes.length)} of ${scenes.length}…`)}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: T.muted }}>
              {title || 'Your project'} · {doneCount}/{scenes.length} done · {Math.floor(elapsed / 60)}:
              {String(elapsed % 60).padStart(2, '0')} elapsed
            </p>
          </div>

          <AnchorStrip anchor={anchor} sceneCount={scenes.length} />

          {/* A calm, non-error line — the render is fine, it just moved engines. */}
          {runNotice ? (
            <div style={{ marginBottom: 16 }}>
              <p
                data-testid="note-project-model"
                style={{
                  margin: 0,
                  padding: '9px 12px',
                  borderRadius: 10,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: T.accentFg,
                  border: `1px solid ${T.accentBorder}`,
                  background: T.accentSoft,
                }}
              >
                {runNotice}
              </p>
            </div>
          ) : null}

          {/* Overall progress: scenes finished vs planned. */}
          <div
            style={{
              position: 'relative',
              height: 6,
              marginBottom: 16,
              borderRadius: 999,
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.07)',
            }}
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={scenes.length}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.round((doneCount / Math.max(1, scenes.length)) * 100)}%`,
                background: 'linear-gradient(90deg, #8b5cf6, #7c3aed)',
                transition: 'width .4s ease',
              }}
            />
          </div>

          {/* The way out, visible for the whole run instead of only after a
              failure — stopping was impossible here until now. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 7,
              marginBottom: 16,
            }}
          >
            <GhostButton onClick={stopRun} testId="button-stop-project" style={{ padding: '9px 16px' }}>
              <Square size={13} /> Stop generating
            </GhostButton>
            <p style={{ margin: 0, fontSize: 11.5, color: T.muted, textAlign: 'center', lineHeight: 1.55 }}>
              Takes you back to the scene plan with every finished scene kept, so you can carry on later. A
              clip already accepted by the render engine still finishes and lands in My Videos.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {scenes.map((scene, i) => {
              const run = viewRun(scene.key);
              const still = sceneImages[scene.key];
              return (
                <Card
                  key={scene.key}
                  style={{
                    padding: '12px 14px',
                    borderColor: run.status === 'failed' ? 'rgba(239,68,68,0.3)' : T.border,
                  }}
                  data-testid={`project-scene-${scene.index}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        flexShrink: 0,
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        color: run.status === 'done' ? '#fff' : T.muted,
                        background:
                          run.status === 'done'
                            ? 'linear-gradient(135deg, #4ade80, #22c55e)'
                            : 'rgba(255,255,255,0.07)',
                      }}
                    >
                      {run.status === 'done' ? <Check size={12} /> : scene.index}
                    </span>

                    {/* Before it renders: the still they approved. After: the
                        real clip, so the character can be checked as it builds. */}
                    {run.status === 'done' && run.clipUrls[0] ? (
                      <video
                        src={run.clipUrls[0]}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        style={{
                          width: 84,
                          flexShrink: 0,
                          borderRadius: 8,
                          border: `1px solid ${T.border}`,
                          background: '#000',
                          aspectRatio: brief.aspect === '9:16' ? '9 / 16' : '16 / 9',
                          objectFit: 'cover',
                        }}
                        data-testid={`video-project-scene-${scene.index}`}
                      />
                    ) : still && still.url ? (
                      <img
                        src={still.url}
                        alt={`Scene ${scene.index}`}
                        style={{
                          width: 84,
                          flexShrink: 0,
                          borderRadius: 8,
                          border: `1px solid ${T.border}`,
                          background: '#000',
                          aspectRatio: brief.aspect === '9:16' ? '9 / 16' : '16 / 9',
                          objectFit: 'cover',
                          opacity: run.status === 'pending' ? 0.5 : 1,
                        }}
                      />
                    ) : null}

                    <div style={{ flex: 1, minWidth: 140 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: T.text }}>
                        {scene.label}
                      </span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted }}>
                        ≈{estimatedSecondsFor(scene.durationSec)}s · {run.error || run.message || 'Waiting its turn'}
                      </span>
                    </div>
                    <StatusPill run={run} />
                  </div>
                  {run.status === 'failed' ? (
                    isContentFilterError(run.error) ? (
                      // The ANCHOR IMAGE was rejected, not the scene — but the
                      // rejection is NOT deterministic (the identical photo has
                      // passed as the identical start image on a later attempt,
                      // see isContentFilterError), so ONE same-photo re-roll is
                      // offered alongside the two reliable escapes. Each
                      // attempt is a paid render, so the offer is single-shot.
                      <div style={{ marginTop: 10 }}>
                        <ErrorNotice>
                          The video model's safety filter rejected this character's photo, so the scenes anchored to it
                          keep failing.{' '}
                          {photoRetryUsed
                            ? 'The same photo was already retried once here, so the reliable fixes are what is left. '
                            : 'The filter is not perfectly consistent — the very same photo can pass on a second try — so you can spend one more render to try it again. '}
                          Carry on without the photo and the video still keeps your character — their written
                          description goes into every scene, which is how most VidVerge videos are made. Or start over
                          with a different character: the filter flags one specific image, so another photo may pass,
                          and an Animated-style portrait avoids the check altogether.
                        </ErrorNotice>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          {!photoRetryUsed ? (
                            <GhostButton
                              onClick={() => retryWithPhoto(i)}
                              disabled={running}
                              style={{ padding: '9px 15px', fontSize: 13 }}
                              testId={`button-retry-with-photo-${scene.index}`}
                            >
                              <RefreshCw size={13} /> Try that photo again (one more render)
                            </GhostButton>
                          ) : null}
                          <PrimaryButton
                            onClick={() => dropPhotoAndContinue(i)}
                            style={{ padding: '9px 15px', fontSize: 13 }}
                            testId={`button-drop-photo-${scene.index}`}
                          >
                            <Play size={14} /> Carry on without the photo
                          </PrimaryButton>
                          <GhostButton onClick={resetProject} testId="button-change-character">
                            <User size={13} /> Start over with a different character
                          </GhostButton>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <GhostButton
                          onClick={() => retryScene(i)}
                          disabled={running}
                          style={{ padding: '7px 12px', fontSize: 12.5 }}
                          testId={`button-retry-scene-${scene.index}`}
                        >
                          <RefreshCw size={13} /> Retry scene {scene.index}
                        </GhostButton>
                        {run.jobId ? (
                          <GhostButton
                            onClick={() => resumeScene(i)}
                            disabled={running}
                            style={{ padding: '7px 12px', fontSize: 12.5 }}
                            testId={`button-resume-scene-${scene.index}`}
                          >
                            <Clock size={13} /> Keep waiting on this render
                          </GhostButton>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </Card>
              );
            })}
          </div>

          {runError ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorNotice>
                {runError} The scenes already finished are safe — retry just this one and the rest continue from there.
              </ErrorNotice>
            </div>
          ) : null}

          <Card>
            <p style={{ margin: 0, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
              Keep this screen open — the final stitch runs right here in your browser, and that is what turns the
              scenes into one finished file.
              {persisted ? (
                <>
                  {' '}
                  Every clip is saved as it lands, so you can
                  <strong style={{ color: T.sub }}> resume this project</strong> from the project list if you do close
                  it.
                </>
              ) : null}
            </p>
            {persistNotice ? (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>{persistNotice}</p>
            ) : null}
          </Card>
        </div>
      ) : null}

      {/* ---- 5. Deliver ---- */}
      {step === 'done' ? (
        <div className="rc-fade" style={{ width: '100%', maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          {outcome && outcome.url ? (
            <>
              <div style={{ textAlign: 'left' }}>
                <VideoResultHero
                  src={outcome.url}
                  aspect={brief.aspect}
                  title={title || 'Your project'}
                  badge={`Your ${scenes.length}-scene video is ready`}
                  note={
                    outcome.method === 'single'
                      ? 'One clip, no stitch needed. Picture only — add your own music or voiceover wherever you post it.'
                      : outcome.method === 'browser'
                        ? 'Stitched in your browser. Picture only — add your own music or voiceover wherever you post it.'
                        : 'Stitched on the server. Picture only — add your own music or voiceover wherever you post it.'
                  }
                  stickyActions
                  surface={T.bg}
                  playerTestId="video-player-project"
                  downloadTestId="link-download-project"
                  actions={
                    <GhostButton full onClick={resetProject} testId="button-new-project">
                      <Plus size={14} /> Start another project
                    </GhostButton>
                  }
                />
              </div>

              {/* Every shot in the finished cut — tap one to grab that scene
                  on its own. */}
              <div style={{ margin: '22px 0 18px', textAlign: 'left' }}>
                <span
                  style={{
                    display: 'block',
                    marginBottom: 8,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: T.muted,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  Scenes in this cut
                </span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(Math.max(scenes.length, 1), 4)}, 1fr)`,
                    gap: 8,
                  }}
                >
                  {scenes.map((scene) => {
                    const still = sceneImages[scene.key];
                    const clips = viewRun(scene.key).clipUrls || [];
                    return (
                      <a
                        key={scene.key}
                        href={clips[0] || outcome.url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Scene ${scene.index} — ${scene.label}`}
                        style={{ textDecoration: 'none' }}
                        data-testid={`link-project-scene-${scene.index}`}
                      >
                        <span
                          style={{
                            position: 'relative',
                            display: 'block',
                            borderRadius: 10,
                            overflow: 'hidden',
                            border: `1px solid ${T.border}`,
                            aspectRatio: brief.aspect === '9:16' ? '9 / 12' : '16 / 9',
                            background: '#000',
                          }}
                        >
                          {still && still.url ? (
                            <img
                              src={still.url}
                              alt=""
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : null}
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              left: 4,
                              padding: '2px 6px',
                              borderRadius: 6,
                              fontSize: 9.5,
                              fontWeight: 700,
                              color: '#fff',
                              background: 'rgba(0,0,0,0.65)',
                            }}
                          >
                            {scene.index}
                          </span>
                        </span>
                        <span
                          style={{
                            display: 'block',
                            marginTop: 5,
                            fontSize: 10.5,
                            color: T.muted,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {scene.label}
                        </span>
                      </a>
                    );
                  })}
                </div>
              </div>

            </>
          ) : (
            <>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  marginBottom: 16,
                }}
              >
                <AlertTriangle size={22} color="#fbbf24" />
              </div>
              <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: T.text }}>
                Your scenes rendered — the stitch didn't
              </h1>
              <p style={{ margin: '0 0 20px', fontSize: 13.5, color: T.sub, lineHeight: 1.6 }}>
                Every scene is finished and downloadable below, but neither stitcher could merge them into one file.
                {outcome && outcome.error ? ` (${clampText(outcome.error, 160)})` : ''} Download the numbered clips and
                join them in any editor, or try the stitch again.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18, textAlign: 'left' }}>
                {collectClips().map((url, i) => (
                  <a
                    key={`${url}_${i}`}
                    href={url}
                    download={`scene-${i + 1}.mp4`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rc-ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 13px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      color: T.sub,
                      textDecoration: 'none',
                      border: `1px solid ${T.border}`,
                      background: 'rgba(255,255,255,0.03)',
                    }}
                    data-testid={`link-project-clip-${i + 1}`}
                  >
                    <Download size={13} /> scene-{i + 1}.mp4
                  </a>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360, margin: '0 auto' }}>
                <PrimaryButton onClick={() => void stitchAll()} full testId="button-retry-stitch">
                  <RefreshCw size={15} /> Try the stitch again
                </PrimaryButton>
                <GhostButton full onClick={resetProject} testId="button-new-project-failed">
                  <ArrowRight size={14} /> Start another project
                </GhostButton>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
