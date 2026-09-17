/**
 * Video Series — batch mode for a library of short clips that all share ONE
 * subject (a skills library, a feature tour, an exercise set).
 *
 * Five steps:
 *   1. Clip list — paste the prompt list you already write by hand (the
 *      `## Category` / `**Title** (Level)` / `> prompt` shape), or have AI write
 *      one from a brief. A "standard player description" line in the pasted doc
 *      is detected and offered as the subject instead of becoming a clip.
 *   2. Subject   — CharacterStep, pre-filled with that detected description, so
 *      one portrait becomes the reference image locked into every clip.
 *   3. Review    — the queue grouped by category: include/exclude, edit any
 *      prompt, optionally draw a test frame, pick the MODEL every clip renders
 *      on, and see the honest time estimate before anything renders.
 *   4. Render    — clips render 1–3 at a time with per-clip status, pause and
 *      resume, and retry for the ones that fail. A failed clip never stops the
 *      batch.
 *   5. Library   — every finished clip playable and downloadable on its own,
 *      grouped exactly like the list. NOTHING is stitched: a series is a set of
 *      separate files, which is the whole point (that is Long Video's job).
 *
 * The series lives in the `video_series` table, so closing the tab does not
 * lose finished clips — and clips already submitted keep rendering server-side
 * and are picked back up on resume.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Lock,
  Pause,
  Play,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  User,
} from 'lucide-react';
import CharacterStep from './CharacterStep';
import VideoResultHero from '../../components/VideoResultHero';
import { generateScenePreview } from './studioApi';
import {
  clampText,
  DEFAULT_VIDEO_MODEL,
  getTone,
  modelHasSound,
  shortModelLabel,
  TONES,
  type AspectRatio,
  type CharacterRef,
} from './videoTypes';
import {
  buildSeriesSubject,
  clipSecondsFor,
  CONCURRENCY_CHOICES,
  createSeriesRow,
  FORMAT_EXAMPLE,
  groupClips,
  isContentFilterError,
  listSeriesRows,
  makeSeriesClip,
  MAX_SERIES_CLIPS,
  parseSeriesDoc,
  renderSubjectAnchorFrame,
  renumberClips,
  submitClipRender,
  updateSeriesRow,
  waitForSceneRender,
  withoutSubjectImage,
  withSubjectAnchorFrame,
  writeSeriesClips,
  type ClipRun,
  type SeriesClip,
  type SeriesClipRow,
  type SeriesRow,
  type SeriesSubject,
} from './seriesApi';
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

type Step = 'input' | 'subject' | 'review' | 'render' | 'library';

const SERIES_STEPS = ['Clip list', 'Subject', 'Review', 'Render', 'Library'] as const;

const STEP_INDEX: Record<Step, number> = {
  input: 0,
  subject: 1,
  review: 2,
  render: 3,
  library: 4,
};

type PreviewState = { status: 'loading' | 'ready' | 'error'; url?: string };

/** Rough per-clip render time, used only for the honest estimate on Review. */
const MINUTES_PER_CLIP = 3;

function StatusPill({ run }: { run: ClipRun }) {
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

function LevelBadge({ level }: { level: string }) {
  if (!level) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color: T.accentFg,
        border: `1px solid ${T.accentBorder}`,
        background: T.accentSoft,
        whiteSpace: 'nowrap',
      }}
    >
      {level}
    </span>
  );
}

/**
 * Vertical or widescreen. Offered on the FIRST screen as well as on Review —
 * shape is the thing people decide before anything else, and hunting for it on
 * a later step is how you end up with 19 clips in the wrong orientation.
 */
function AspectChips({ aspect, onChange }: { aspect: AspectRatio; onChange: (next: AspectRatio) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Chip selected={aspect === '9:16'} onClick={() => onChange('9:16')} testId="chip-series-aspect-9-16">
        <RectangleVertical size={13} /> 9:16 · Vertical
      </Chip>
      <Chip selected={aspect === '16:9'} onClick={() => onChange('16:9')} testId="chip-series-aspect-16-9">
        <RectangleHorizontal size={13} /> 16:9 · Wide
      </Chip>
    </div>
  );
}

function SubjectStrip({ subject, clipCount }: { subject: SeriesSubject; clipCount: number }) {
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
        {subject.imageUrl ? (
          <img
            src={subject.imageUrl}
            alt={subject.name}
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: T.text }}>
          <Lock size={12} color={T.accentFg} /> {subject.name} — locked for all {clipCount} clips
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
          {subject.referenceImageUrl
            ? 'The same reference image and description go into every clip, so clip 1 and clip 19 are the same person.'
            : 'No photo on this subject, so the lock is text-only. Add a photo for the strongest match across the set.'}
        </span>
      </div>
    </Card>
  );
}

export default function VideoSeries({
  onExit,
  onBusyChange,
}: {
  onExit?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('input');
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState('');
  const [clips, setClips] = useState<SeriesClip[]>([]);
  const [detectedSubject, setDetectedSubject] = useState('');
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [subject, setSubject] = useState<SeriesSubject | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [toneId, setToneId] = useState('professional');
  const [concurrency, setConcurrency] = useState(1);
  /**
   * The model every clip of this batch renders on, picked on Review. It used to
   * not exist here at all, which is why batches came back on the render
   * pipeline's own default no matter what the customer wanted.
   */
  const [model, setModel] = useState<string>(DEFAULT_VIDEO_MODEL);
  const [runs, setRuns] = useState<Record<string, ClipRun>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  /** A calm, non-error line about this batch — today only the Kling fallback. */
  const [runNotice, setRunNotice] = useState<string | null>(null);
  /** Whether the ONE manual same-photo re-roll has been spent (see retryWithPhoto). */
  const [photoRetryUsed, setPhotoRetryUsed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [listKey, setListKey] = useState(0);
  const [aiBrief, setAiBrief] = useState('');
  const [aiCount, setAiCount] = useState(8);
  const [aiBusy, setAiBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [persisted, setPersisted] = useState(false);
  /** Why the series was not saved, in plain language, when saving was refused. */
  const [persistNotice, setPersistNotice] = useState<string | null>(null);

  const clipsRef = useRef<SeriesClip[]>([]);
  const runsRef = useRef<Record<string, ClipRun>>({});
  const subjectRef = useRef<SeriesSubject | null>(null);
  const titleRef = useRef('');
  const aspectRef = useRef<AspectRatio>('16:9');
  const toneRef = useRef('professional');
  const concurrencyRef = useRef(1);
  const modelRef = useRef<string>(DEFAULT_VIDEO_MODEL);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  /**
   * Which run owns the workers. Stopping bumps it, and every await checks it —
   * so a stopped batch cannot wake back up and render alongside the one that
   * replaced it (abortRef alone could not do that: the next runSeries clears it
   * while the old workers are still mid-poll).
   */
  const runTokenRef = useRef(0);
  const pauseRef = useRef(false);
  const seriesIdRef = useRef<number | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    aspectRef.current = aspect;
  }, [aspect]);
  useEffect(() => {
    toneRef.current = toneId;
  }, [toneId]);
  useEffect(() => {
    concurrencyRef.current = concurrency;
  }, [concurrency]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(
    () => () => {
      abortRef.current = true;
    },
    [],
  );

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
    let alive = true;
    void (async () => {
      const rows = await listSeriesRows();
      if (alive) setSeriesList(rows);
    })();
    return () => {
      alive = false;
    };
  }, [listKey]);

  useEffect(() => {
    if (step !== 'render') return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  const runOf = (key: string): ClipRun => runsRef.current[key] || { status: 'pending' };
  const viewRun = (key: string): ClipRun => runs[key] || { status: 'pending' };

  const patchRun = (key: string, patch: Partial<ClipRun>) => {
    const prev: ClipRun = runsRef.current[key] || { status: 'pending' };
    runsRef.current = { ...runsRef.current, [key]: { ...prev, ...patch } };
    setRuns(runsRef.current);
  };

  const clipRows = (): SeriesClipRow[] =>
    clipsRef.current.map((c) => {
      const r = runOf(c.key);
      return {
        index: c.index,
        category: c.category,
        title: c.title,
        level: c.level,
        prompt: c.prompt,
        include: c.include,
        status: r.status,
        jobId: r.jobId,
        url: r.url,
      };
    });

  const doneCount = (): number =>
    clipsRef.current.filter((c) => c.include && runOf(c.key).status === 'done').length;

  const persist = async (patch: Record<string, unknown> = {}) => {
    await updateSeriesRow(seriesIdRef.current, {
      clips_json: clipRows(),
      done_count: doneCount(),
      ...patch,
    });
  };

  // ---- Step 1: the clip list ----
  const applyParse = (text: string) => {
    const parsed = parseSeriesDoc(text);
    if (parsed.clips.length === 0) {
      setClips([]);
      setParseNote(null);
      return;
    }
    setClips(parsed.clips);
    clipsRef.current = parsed.clips;
    if (parsed.subjectDescription) setDetectedSubject(parsed.subjectDescription);
    if (parsed.title && !titleRef.current) {
      setTitle(parsed.title);
      titleRef.current = parsed.title;
    }
    const groups = groupClips(parsed.clips).filter((g) => g.category);
    setParseNote(
      `Found ${parsed.clips.length} clip${parsed.clips.length === 1 ? '' : 's'}` +
        (groups.length > 0 ? ` in ${groups.length} categor${groups.length === 1 ? 'y' : 'ies'}` : '') +
        (parsed.subjectDescription
          ? '. Your standard subject description was detected too — it will be locked to every clip instead of repeated as a clip.'
          : '.'),
    );
  };

  const handleDoc = (text: string) => {
    setDoc(text);
    applyParse(text);
  };

  const runAiWriter = async () => {
    if (!aiBrief.trim() || aiBusy) return;
    setAiBusy(true);
    const written = await writeSeriesClips({
      brief: aiBrief,
      count: aiCount,
      subjectDescription: detectedSubject,
    });
    setAiBusy(false);
    if (written.length === 0) {
      setParseNote('The clip writer could not answer just now — paste your own list above instead.');
      return;
    }
    setClips(written);
    clipsRef.current = written;
    const groups = groupClips(written).filter((g) => g.category);
    setParseNote(
      `Wrote ${written.length} clips${groups.length > 0 ? ` in ${groups.length} categories` : ''}. Edit anything on the next screens.`,
    );
  };

  // ---- Step 2: subject ----
  const handleSubject = (picked: CharacterRef) => {
    const locked = buildSeriesSubject(picked);
    setSubject(locked);
    subjectRef.current = locked;
    setStep('review');
  };

  // ---- Step 3: review ----
  const updateClip = (key: string, patch: Partial<SeriesClip>) => {
    setClips((list) => {
      const next = list.map((c) => (c.key === key ? { ...c, ...patch } : c));
      clipsRef.current = next;
      return next;
    });
  };

  const removeClip = (key: string) => {
    setClips((list) => {
      const next = renumberClips(list.filter((c) => c.key !== key));
      clipsRef.current = next;
      return next;
    });
  };

  const addClip = () => {
    setClips((list) => {
      if (list.length >= MAX_SERIES_CLIPS) return list;
      const lastCategory = list.length > 0 ? list[list.length - 1].category : '';
      const next = renumberClips([...list, makeSeriesClip(list.length + 1, lastCategory, 'New clip', '', '')]);
      clipsRef.current = next;
      return next;
    });
  };

  const drawPreview = (clip: SeriesClip) => {
    if (!(clip.prompt || '').trim()) return;
    const subjectNote = subject ? ` Featuring ${clampText(subject.description, 180)}.` : '';
    const prompt = clampText(
      `Cinematic film still: ${clip.prompt}${subjectNote} ${getTone(toneId).prompt} mood, professional cinematography, high detail. No text, no captions, no watermarks.`,
      900,
    );
    setPreviews((m) => ({ ...m, [clip.key]: { status: 'loading' } }));
    void generateScenePreview(prompt, aspect)
      .then((url) => setPreviews((m) => ({ ...m, [clip.key]: { status: 'ready' as const, url } })))
      .catch(() => setPreviews((m) => ({ ...m, [clip.key]: { status: 'error' as const } })));
  };

  const included = clips.filter((c) => c.include && (c.prompt || '').trim());

  const startSeries = async () => {
    if (!subject || runningRef.current) return;
    if (included.length === 0) {
      setRunError('Include at least one clip with a prompt.');
      return;
    }
    const fresh: Record<string, ClipRun> = {};
    clips.forEach((c) => {
      fresh[c.key] = { status: 'pending' };
    });
    runsRef.current = fresh;
    setRuns(fresh);
    setRunError(null);
    setStep('render');

    // OPENING-FRAME ANCHOR: with a single reference image the renderer animates
    // out of it, so the anchor is frame 0 of every clip — a studio portrait made
    // all of them open on the same headshot for a beat. Anchor on an
    // in-situation frame instead:
    // a test frame the user already drew if there is one, otherwise draw a
    // single full-body still now (one image, seconds, before any clip renders).
    let locked = subjectRef.current || subject;
    const drawn = included.map((c) => previews[c.key]).find((p) => p && p.status === 'ready' && !!p.url);
    let anchorFrame = drawn && drawn.url ? drawn.url : '';
    if (!anchorFrame) {
      anchorFrame = await renderSubjectAnchorFrame({
        subject: locked,
        clipPrompt: included[0].prompt,
        aspect,
        toneId,
      });
    }
    if (anchorFrame) {
      locked = withSubjectAnchorFrame(locked, anchorFrame);
      setSubject(locked);
      subjectRef.current = locked;
    }

    const saved = await createSeriesRow({
      title: titleRef.current || 'Untitled series',
      source_doc: doc || null,
      subject_name: locked.name,
      subject_description: locked.block,
      subject_image_url: locked.imageUrl || null,
      reference_image_url: locked.referenceImageUrl || null,
      subject_json: locked,
      aspect_ratio: aspect,
      tone: getTone(toneId).prompt,
      model,
      concurrency,
      clip_count: included.length,
      done_count: 0,
      clips_json: clipRows(),
      status: 'rendering',
    });
    seriesIdRef.current = saved.id;
    setPersisted(!!saved.id);
    setPersistNotice(saved.notice || null);
    setListKey((k) => k + 1);
    void runSeries();
  };

  const runOneClip = async (
    clip: SeriesClip,
    locked: SeriesSubject,
    total: number,
    stale: () => boolean,
  ) => {
    if (stale()) return;
    const existing = runOf(clip.key);
    if (existing.status === 'done' && existing.url) return;

    let jobId = existing.jobId;
    if (!jobId) {
      patchRun(clip.key, { status: 'submitting', error: undefined, message: 'Starting this clip…' });
      const submitted = await submitClipRender({
        clip,
        subject: locked,
        seriesTitle: titleRef.current,
        aspect: aspectRef.current,
        toneId: toneRef.current,
        total,
        model: modelRef.current,
        seriesId: seriesIdRef.current,
      });
      // Said out loud rather than swallowed: the customer picked a model, so if
      // the render had to move engines they should be told, once.
      if (submitted.notice) setRunNotice(submitted.notice);
      if (!submitted.success || !submitted.jobId) {
        patchRun(clip.key, {
          status: 'failed',
          error: submitted.error || 'This clip could not be started.',
          message: undefined,
        });
        await persist();
        return;
      }
      jobId = submitted.jobId;
    }

    patchRun(clip.key, { status: 'rendering', jobId, error: undefined, message: 'Rendering…' });
    await persist({ status: 'rendering' });

    try {
      const result = await waitForSceneRender(jobId, {
        onTick: (message) => patchRun(clip.key, { message }),
        isAborted: stale,
      });
      patchRun(clip.key, { status: 'done', url: result.clipUrls[0], message: undefined });
      // Each finished clip is saved before the next one starts.
      await persist();
    } catch (e: any) {
      if (stale()) return;
      patchRun(clip.key, {
        status: 'failed',
        error: (e && e.message) || 'This clip failed to render.',
        message: undefined,
      });
      await persist();
    }
  };

  /**
   * Render the queue with a small worker pool. A failed clip does NOT stop the
   * batch — the run finishes and the failures are retried individually.
   */
  const runSeries = async (onlyKey?: string) => {
    if (runningRef.current) return;
    const locked = subjectRef.current;
    if (!locked) return;
    runningRef.current = true;
    abortRef.current = false;
    pauseRef.current = false;
    const token = ++runTokenRef.current;
    /** True once this batch has been stopped, or replaced by a newer one. */
    const stale = () => abortRef.current || runTokenRef.current !== token;
    setRunning(true);
    setPaused(false);
    setRunError(null);

    try {
      const all = clipsRef.current.filter((c) => c.include && (c.prompt || '').trim());
      const queue = onlyKey
        ? all.filter((c) => c.key === onlyKey)
        : all.filter((c) => runOf(c.key).status !== 'done');
      let cursor = 0;
      const lanes = Math.max(1, Math.min(3, concurrencyRef.current));

      const worker = async () => {
        // Bounded: one pass per queued clip at most.
        for (let guard = 0; guard <= queue.length; guard++) {
          if (stale() || pauseRef.current) return;
          const clip = queue[cursor];
          cursor += 1;
          if (!clip) return;
          await runOneClip(clip, locked, all.length, stale);
        }
      };

      await Promise.all(Array.from({ length: lanes }, () => worker()));
      if (stale()) return;

      if (pauseRef.current) {
        setPaused(true);
        await persist({ status: 'paused' });
        return;
      }

      const done = doneCount();
      const failed = all.length - done;
      if (failed > 0) {
        setRunError(
          `${failed} of ${all.length} clip${all.length === 1 ? '' : 's'} didn't render. Retry them below — the finished ones are safe.`,
        );
      }
      await persist({ status: failed === 0 ? 'completed' : 'partial' });
      // Retrying one clip keeps you on the render screen; a finished batch
      // moves on to the library.
      if (!onlyKey) setStep('library');
      setListKey((k) => k + 1);
    } finally {
      // Only the batch that still owns the workers may unlock them — a stopped
      // one must not report "not running" for the batch that came after it.
      if (runTokenRef.current === token) {
        runningRef.current = false;
        setRunning(false);
      }
    }
  };

  const pauseSeries = () => {
    pauseRef.current = true;
    setPaused(true);
  };

  /** Every unfinished clip back to 'pending'; finished clips are kept as they are. */
  const resetUnfinishedRuns = (): Record<string, ClipRun> => {
    const kept: Record<string, ClipRun> = {};
    clipsRef.current.forEach((c) => {
      const r = runOf(c.key);
      kept[c.key] = r.status === 'done' && r.url ? r : { status: 'pending' };
    });
    runsRef.current = kept;
    setRuns(kept);
    return kept;
  };

  /**
   * STOP NOW — halt the batch without waiting for the clip in flight.
   *
   * Pause is polite: it lets the current clip land first, which can be another
   * three minutes. "Stop" has to mean stop, so this drops every lane at its next
   * tick and puts any clip left mid-render back to 'pending' — nothing is left
   * wearing a spinner for a render nobody is watching. Finished clips are
   * untouched and "Carry on with the rest" picks the batch up from here.
   *
   * It ends the WAIT, not the spend: a clip the engine already took finishes at
   * their end and lands in My Videos.
   */
  const stopSeries = () => {
    abortRef.current = true;
    runTokenRef.current += 1;
    pauseRef.current = false;
    runningRef.current = false;
    setRunning(false);
    setPaused(true);
    setRunError(null);
    resetUnfinishedRuns();
    void persist({ status: 'paused' });
  };

  /**
   * The safety filter rejected the subject's photo and it keeps rejecting it.
   * Drop the image half of the lock, keep the written description, and let the
   * batch carry on — finished clips are untouched. (The rejection is not
   * strictly deterministic — the same photo has passed on a later attempt, see
   * isContentFilterError — so this is the reliable escape, not the only one.)
   */
  const dropPhotoAndContinue = () => {
    const locked = subjectRef.current;
    if (!locked || runningRef.current) return;
    const textOnly = withoutSubjectImage(locked);
    subjectRef.current = textOnly;
    setSubject(textOnly);
    resetUnfinishedRuns();
    setRunError(null);
    void updateSeriesRow(seriesIdRef.current, {
      subject_json: textOnly,
      subject_image_url: null,
      reference_image_url: null,
    });
    void runSeries();
  };

  /**
   * ONE manual re-roll of the content filter with the SAME photo. The
   * rejection is measurably nondeterministic — the identical portrait passed
   * as the identical start image on a later attempt (video_jobs row 75,
   * Aug 13 2026) — and the image anchor holds the subject better than the
   * text-only lock, so the user may choose to spend one more render per
   * failed clip on keeping it. Offered ONCE, mirroring the pipeline's own
   * retry cap: after a second rejection only the reliable escapes remain.
   */
  const retryWithPhoto = () => {
    if (runningRef.current) return;
    setPhotoRetryUsed(true);
    resetUnfinishedRuns();
    setRunError(null);
    void runSeries();
  };

  /**
   * The safety filter rejected the locked subject's photo. Keep the parsed clip
   * list (nobody wants to re-paste 19 prompts) and send them back to pick a
   * different subject.
   */
  const changeSubject = () => {
    if (runningRef.current) return;
    resetUnfinishedRuns();
    setRunError(null);
    // A different subject means a different photo, so the one-shot same-photo
    // retry becomes available again.
    setPhotoRetryUsed(false);
    setStep('subject');
  };

  const retryClip = (clip: SeriesClip) => {
    if (runningRef.current) return;
    patchRun(clip.key, { status: 'pending', jobId: undefined, url: undefined, error: undefined, message: undefined });
    void runSeries(clip.key);
  };

  const resumeSeries = (row: SeriesRow) => {
    const rows = Array.isArray(row.clips_json) ? row.clips_json : [];
    if (rows.length === 0 || runningRef.current) return;
    const restored = renumberClips(
      rows.map((r, i) => {
        const clip = makeSeriesClip(i + 1, r.category || '', r.title || `Clip ${i + 1}`, r.level || '', r.prompt || '');
        return { ...clip, include: r.include !== false };
      }),
    );
    const restoredRuns: Record<string, ClipRun> = {};
    restored.forEach((c, i) => {
      const r = rows[i];
      restoredRuns[c.key] =
        r.status === 'done' && r.url
          ? { status: 'done', url: r.url, jobId: r.jobId }
          : { status: 'pending', jobId: r.status === 'rendering' ? r.jobId : undefined };
    });

    const locked: SeriesSubject =
      row.subject_json && row.subject_json.block
        ? row.subject_json
        : buildSeriesSubject({
            name: row.subject_name || 'Your subject',
            description: row.subject_description || '',
            imageUrl: row.subject_image_url || undefined,
            source: 'saved',
          });

    setTitle(row.title || 'Untitled series');
    titleRef.current = row.title || 'Untitled series';
    setDoc(row.source_doc || '');
    setClips(restored);
    clipsRef.current = restored;
    setRuns(restoredRuns);
    runsRef.current = restoredRuns;
    setSubject(locked);
    subjectRef.current = locked;
    const nextAspect: AspectRatio = row.aspect_ratio === '9:16' ? '9:16' : '16:9';
    setAspect(nextAspect);
    aspectRef.current = nextAspect;
    const lanes = Math.max(1, Math.min(3, row.concurrency || 1));
    setConcurrency(lanes);
    concurrencyRef.current = lanes;
    // Resume on the model the batch was STARTED on, so the clips still to render
    // match the ones that already landed.
    const savedModel = row.model || DEFAULT_VIDEO_MODEL;
    setModel(savedModel);
    modelRef.current = savedModel;
    seriesIdRef.current = row.id;
    setPersisted(true);
    setRunError(null);
    setRunNotice(null);
    setStep('render');
    void runSeries();
  };

  const openSeries = (row: SeriesRow) => {
    const rows = Array.isArray(row.clips_json) ? row.clips_json : [];
    if (rows.length === 0) return;
    const restored = renumberClips(
      rows.map((r, i) => {
        const clip = makeSeriesClip(i + 1, r.category || '', r.title || `Clip ${i + 1}`, r.level || '', r.prompt || '');
        return { ...clip, include: r.include !== false };
      }),
    );
    const restoredRuns: Record<string, ClipRun> = {};
    restored.forEach((c, i) => {
      const r = rows[i];
      restoredRuns[c.key] = r.status === 'done' && r.url ? { status: 'done', url: r.url, jobId: r.jobId } : { status: 'pending' };
    });
    setTitle(row.title || 'Untitled series');
    titleRef.current = row.title || 'Untitled series';
    setClips(restored);
    clipsRef.current = restored;
    setRuns(restoredRuns);
    runsRef.current = restoredRuns;
    // Carry the locked subject over too, so stepping back to Render works.
    if (row.subject_json && row.subject_json.block) {
      setSubject(row.subject_json);
      subjectRef.current = row.subject_json;
    }
    const nextAspect: AspectRatio = row.aspect_ratio === '9:16' ? '9:16' : '16:9';
    setAspect(nextAspect);
    aspectRef.current = nextAspect;
    const savedModel = row.model || DEFAULT_VIDEO_MODEL;
    setModel(savedModel);
    modelRef.current = savedModel;
    seriesIdRef.current = row.id;
    setPersisted(true);
    setStep('library');
  };

  const resetSeries = () => {
    abortRef.current = true;
    runningRef.current = false;
    setStep('input');
    setTitle('');
    titleRef.current = '';
    setDoc('');
    setClips([]);
    clipsRef.current = [];
    setDetectedSubject('');
    setParseNote(null);
    setSubject(null);
    subjectRef.current = null;
    setRuns({});
    runsRef.current = {};
    setPreviews({});
    setExpanded({});
    setRunError(null);
    setRunNotice(null);
    setPaused(false);
    setCopied(false);
    setPhotoRetryUsed(false);
    seriesIdRef.current = null;
    setPersisted(false);
    setListKey((k) => k + 1);
  };

  const doneClips = clips.filter((c) => viewRun(c.key).status === 'done' && viewRun(c.key).url);

  const copyLinks = () => {
    const text = doneClips.map((c) => `${c.index}. ${c.title}\n${viewRun(c.key).url || ''}`).join('\n\n');
    try {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the links are on screen and selectable anyway */
    }
  };

  const totalMinutes = Math.round((included.length * MINUTES_PER_CLIP) / Math.max(1, concurrency));
  const groups = groupClips(clips);
  const liveDone = clips.filter((c) => c.include && viewRun(c.key).status === 'done').length;
  const liveTotal = clips.filter((c) => c.include && (c.prompt || '').trim()).length;
  // The batch renders in queue order, so the LAST finished clip is the one that
  // just landed. It gets a full-size player on both the render screen and the
  // library, because a finished clip should never be a 92px thumbnail.
  const newestReady =
    [...clips].reverse().find((c) => viewRun(c.key).status === 'done' && !!viewRun(c.key).url) || null;
  const newestReadyUrl = newestReady ? viewRun(newestReady.key).url || '' : '';

  // -------------------------------------------------------------------------
  return (
    <div>
      <StepIndicator current={STEP_INDEX[step]} steps={SERIES_STEPS} />

      {/* ---- 1. Clip list ---- */}
      {step === 'input' ? (
        <div className="rc-fade" style={{ maxWidth: 720 }}>
          <StepHeader
            title="Build a series of clips"
            subtitle={`Many short clips, one subject, no stitching — each clip comes out as its own ~${clipSecondsFor(model)}s file. Paste the prompt list you already write, and the same person is locked into every single one.`}
            onBack={onExit}
            backLabel="Video modes"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FieldLabel>Series name</FieldLabel>
                <TextInput
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. HoopViz Skill Videos"
                  testId="input-series-title"
                />
              </div>
              <div>
                <FieldLabel hint="Vertical for TikTok, Reels and Shorts; wide for YouTube. Every clip in the series uses this shape.">
                  Shape
                </FieldLabel>
                <AspectChips aspect={aspect} onChange={setAspect} />
              </div>
              <div>
                <FieldLabel hint="One '## Category' heading per group, then '**Clip title** (Level)' and the prompt on a '>' line. Any other notes in the document are ignored.">
                  Your clip list
                </FieldLabel>
                <TextArea
                  value={doc}
                  onChange={handleDoc}
                  rows={12}
                  placeholder={FORMAT_EXAMPLE}
                  testId="input-series-doc"
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <GhostButton
                    onClick={() => handleDoc(FORMAT_EXAMPLE)}
                    style={{ padding: '7px 12px', fontSize: 12.5 }}
                    testId="button-load-example"
                  >
                    <ImageIcon size={13} /> Load an example list
                  </GhostButton>
                  {doc ? (
                    <GhostButton
                      onClick={() => handleDoc('')}
                      style={{ padding: '7px 12px', fontSize: 12.5 }}
                      testId="button-clear-doc"
                    >
                      <Trash2 size={13} /> Clear
                    </GhostButton>
                  ) : null}
                </div>
                {parseNote ? (
                  <p
                    style={{ margin: '10px 0 0', fontSize: 12.5, color: T.accentFg, lineHeight: 1.55 }}
                    data-testid="text-parse-note"
                  >
                    {parseNote}
                  </p>
                ) : null}
              </div>
            </Card>

            <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldLabel hint="No list yet? Describe the set and we'll write the prompts for you.">
                Or have AI write the list
              </FieldLabel>
              <TextArea
                value={aiBrief}
                onChange={setAiBrief}
                rows={3}
                placeholder="e.g. Basketball skill demos grouped into dribbling, shooting, passing, defense and footwork — one clip per skill, beginner to advanced"
                testId="input-series-ai-brief"
                expand={{
                  field: 'Series brief (what the set of clips covers)',
                  context: [
                    title ? `Series: ${title}` : '',
                    detectedSubject ? `Recurring subject: ${detectedSubject}` : '',
                  ]
                    .filter(Boolean)
                    .join(' — '),
                  words: 60,
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: T.muted }}>How many clips?</span>
                {[6, 8, 12, 19].map((n) => (
                  <Chip key={n} selected={aiCount === n} onClick={() => setAiCount(n)} testId={`chip-ai-count-${n}`}>
                    {n}
                  </Chip>
                ))}
              </div>
              <GhostButton onClick={() => void runAiWriter()} disabled={!aiBrief.trim() || aiBusy} testId="button-ai-write-list">
                {aiBusy ? <Loader2 size={14} className="rc-spin" /> : <Sparkles size={14} />}
                {aiBusy ? 'Writing the list…' : 'Write the clip list'}
              </GhostButton>
            </Card>

            <PrimaryButton
              onClick={() => setStep('subject')}
              disabled={clips.length === 0}
              full
              testId="button-series-to-subject"
            >
              {clips.length > 0
                ? `Continue with ${clips.length} clip${clips.length === 1 ? '' : 's'} →`
                : 'Paste or write a clip list to continue'}
            </PrimaryButton>
          </div>

          {seriesList.length > 0 ? (
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
                <Film size={15} color={T.accentFg} /> Your series
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seriesList.map((row) => {
                  const rows = Array.isArray(row.clips_json) ? row.clips_json : [];
                  const finished = (row.done_count || 0) >= (row.clip_count || 0) && (row.clip_count || 0) > 0;
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
                      data-testid={`series-row-${row.id}`}
                    >
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: T.text }}>
                          {row.title || 'Untitled series'}
                        </span>
                        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted }}>
                          {row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}
                          {` · ${row.done_count || 0}/${row.clip_count || rows.length} clips`}
                          {row.aspect_ratio ? ` · ${row.aspect_ratio}` : ''}
                          {` · ${row.status || 'planning'}`}
                        </span>
                      </div>
                      {rows.length > 0 ? (
                        <GhostButton onClick={() => openSeries(row)} style={{ padding: '7px 12px', fontSize: 12.5 }}>
                          <Film size={13} /> Open
                        </GhostButton>
                      ) : null}
                      {!finished && rows.length > 0 ? (
                        <GhostButton onClick={() => resumeSeries(row)} style={{ padding: '7px 12px', fontSize: 12.5 }}>
                          <Play size={13} /> Resume
                        </GhostButton>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- 2. Subject ---- */}
      {step === 'subject' ? (
        <>
          <CharacterStep
            required
            backLabel="Clip list"
            initialDescription={detectedSubject}
            subtitle={
              detectedSubject
                ? `We pulled this description straight out of your list. Generate a portrait from it (or upload a photo) and that exact look is locked into all ${clips.length} clips.`
                : `Describe or upload the one person who appears in all ${clips.length} clips. Their look is locked into every render — that's what keeps the set consistent.`
            }
            onBack={() => setStep('input')}
            onDone={handleSubject}
            onSkip={() => undefined}
          />
        </>
      ) : null}

      {/* ---- 3. Review ---- */}
      {step === 'review' && subject ? (
        <div className="rc-fade">
          <StepHeader
            title="Review the queue"
            subtitle={`${included.length} clip${included.length === 1 ? '' : 's'} · ~${clipSecondsFor(model)}s each · ${aspect}. Untick anything you don't want yet — no clip renders until you start the batch.`}
            onBack={() => setStep('subject')}
            backLabel="Subject"
          />

          <SubjectStrip subject={subject} clipCount={included.length} />

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
            <div>
              <ModelPicker value={model} onChange={setModel} />
              <p style={{ margin: '11px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
                {shortModelLabel(model)} renders every clip in this batch —{' '}
                {modelHasSound(model)
                  ? 'it speaks on camera, with music and ambience'
                  : 'picture only, no soundtrack'}
                , {clipSecondsFor(model)}s per clip.
              </p>
            </div>
            <div>
              <FieldLabel hint="Vertical for TikTok, Reels and Shorts; wide for YouTube.">Shape</FieldLabel>
              <AspectChips aspect={aspect} onChange={setAspect} />
            </div>
            <div>
              <FieldLabel>Tone</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TONES.map((tone) => (
                  <Chip
                    key={tone.id}
                    selected={toneId === tone.id}
                    onClick={() => setToneId(tone.id)}
                    testId={`chip-series-tone-${tone.id}`}
                  >
                    {tone.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel hint="More at once finishes sooner but starts more renders at the same time.">
                How many at a time
              </FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CONCURRENCY_CHOICES.map((n) => (
                  <Chip
                    key={n}
                    selected={concurrency === n}
                    onClick={() => setConcurrency(n)}
                    testId={`chip-series-lanes-${n}`}
                  >
                    {n === 1 ? 'One at a time' : `${n} at a time`}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 18 }}>
            {groups.map((group) => (
              <div key={group.category || 'ungrouped'}>
                {group.category ? (
                  <h3
                    style={{
                      margin: '0 0 9px',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      color: T.accentFg,
                    }}
                  >
                    {group.category}
                    <span style={{ marginLeft: 7, color: T.muted, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                      {group.clips.length} clip{group.clips.length === 1 ? '' : 's'}
                    </span>
                  </h3>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.clips.map((clip) => {
                    const preview = previews[clip.key];
                    const open = !!expanded[clip.key];
                    return (
                      <Card
                        key={clip.key}
                        style={{ padding: '12px 14px', opacity: clip.include ? 1 : 0.5 }}
                        data-testid={`series-clip-${clip.index}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => updateClip(clip.key, { include: !clip.include })}
                            aria-label={clip.include ? 'Exclude this clip' : 'Include this clip'}
                            style={{
                              display: 'inline-flex',
                              marginTop: 2,
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              color: clip.include ? T.accentFg : T.muted,
                              cursor: 'pointer',
                            }}
                            data-testid={`toggle-clip-${clip.index}`}
                          >
                            {clip.include ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>

                          {preview && preview.status === 'ready' && preview.url ? (
                            <img
                              src={preview.url}
                              alt=""
                              style={{
                                width: 76,
                                flexShrink: 0,
                                borderRadius: 8,
                                border: `1px solid ${T.border}`,
                                background: '#000',
                                aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9',
                                objectFit: 'cover',
                              }}
                            />
                          ) : null}

                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11.5, fontWeight: 700, color: T.muted }}>{clip.index}</span>
                              <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{clip.title}</span>
                              <LevelBadge level={clip.level} />
                            </div>
                            {open ? (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <TextInput
                                  value={clip.title}
                                  onChange={(v) => updateClip(clip.key, { title: v })}
                                  placeholder="Clip title"
                                  testId={`input-clip-title-${clip.index}`}
                                />
                                <TextArea
                                  value={clip.prompt}
                                  onChange={(v) => updateClip(clip.key, { prompt: v })}
                                  rows={4}
                                  placeholder="What happens in this clip: the action, the technique cues, the setting, the camera…"
                                  testId={`input-clip-prompt-${clip.index}`}
                                  expand={{
                                    field: `Clip prompt — ${clip.title || `clip ${clip.index}`}`,
                                    context: `One continuous ~${clipSecondsFor(model)}s shot. ${getTone(toneId).visual}.${
                                      subject ? ` The recurring subject (do not re-describe them): ${subject.description}` : ''
                                    }`,
                                    words: 60,
                                  }}
                                />
                              </div>
                            ) : (
                              <p
                                style={{
                                  margin: '4px 0 0',
                                  fontSize: 12,
                                  color: T.muted,
                                  lineHeight: 1.5,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {clip.prompt || 'No prompt yet — open this clip and describe the shot.'}
                              </p>
                            )}
                          </div>

                          <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                            <IconButton
                              label="Draw a test frame for this clip"
                              onClick={() => drawPreview(clip)}
                              disabled={!!preview && preview.status === 'loading'}
                              style={{ width: 26, height: 26 }}
                            >
                              {preview && preview.status === 'loading' ? (
                                <Loader2 size={12} className="rc-spin" />
                              ) : (
                                <ImageIcon size={12} />
                              )}
                            </IconButton>
                            <IconButton
                              label={open ? 'Close this clip' : 'Edit this clip'}
                              onClick={() => setExpanded((m) => ({ ...m, [clip.key]: !open }))}
                              style={{ width: 26, height: 26 }}
                            >
                              <span style={{ fontSize: 11, fontWeight: 700 }}>{open ? '−' : '⋯'}</span>
                            </IconButton>
                            <IconButton
                              label="Remove this clip"
                              onClick={() => removeClip(clip.key)}
                              style={{ width: 26, height: 26 }}
                            >
                              <Trash2 size={12} />
                            </IconButton>
                          </span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <GhostButton onClick={addClip} disabled={clips.length >= MAX_SERIES_CLIPS} testId="button-add-clip">
              <Sparkles size={13} /> Add a clip
            </GhostButton>
          </div>

          {runError ? (
            <div style={{ marginBottom: 14 }}>
              <ErrorNotice>{runError}</ErrorNotice>
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
            <PrimaryButton onClick={() => void startSeries()} disabled={included.length === 0} full testId="button-start-series">
              <Lock size={15} /> Lock subject → render {included.length} clip{included.length === 1 ? '' : 's'}
            </PrimaryButton>
            <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.55 }}>
              Roughly {Math.max(2, totalMinutes)} minutes for all {included.length}
              {concurrency > 1 ? ` at ${concurrency} at a time` : ''}. You can pause between clips, and finished clips
              are saved as they land.
            </p>
          </div>
        </div>
      ) : null}

      {/* ---- 4. Render ---- */}
      {step === 'render' && subject ? (
        <div className="rc-fade" style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <h1
              style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: T.text }}
              data-testid="text-series-status"
            >
              {paused
                ? running
                  ? 'Pausing — finishing the clip in flight…'
                  : 'Stopped. Nothing is rendering.'
                : `Rendering clip ${Math.min(liveDone + 1, liveTotal)} of ${liveTotal}…`}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: T.muted }}>
              {title || 'Your series'} · {liveDone}/{liveTotal} done · {Math.floor(elapsed / 60)}:
              {String(elapsed % 60).padStart(2, '0')} elapsed
            </p>
          </div>

          <SubjectStrip subject={subject} clipCount={liveTotal} />

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
            aria-valuenow={liveDone}
            aria-valuemin={0}
            aria-valuemax={liveTotal}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.round((liveDone / Math.max(1, liveTotal)) * 100)}%`,
                background: 'linear-gradient(90deg, #8b5cf6, #7c3aed)',
                transition: 'width .4s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {running ? (
              <>
                {!paused ? (
                  <GhostButton onClick={pauseSeries} testId="button-pause-series">
                    <Pause size={13} /> Pause after this clip
                  </GhostButton>
                ) : null}
                <GhostButton onClick={stopSeries} testId="button-stop-series">
                  <Square size={13} /> Stop now
                </GhostButton>
              </>
            ) : (
              <PrimaryButton
                onClick={() => void runSeries()}
                disabled={running}
                style={{ padding: '11px 16px', fontSize: 13.5 }}
                testId="button-resume-series"
              >
                <Play size={14} /> {liveDone > 0 ? 'Carry on with the rest' : 'Start rendering'}
              </PrimaryButton>
            )}
            <GhostButton onClick={() => setStep('library')} testId="button-view-library">
              <Film size={13} /> See finished clips
            </GhostButton>
          </div>

          {/* The clip that just landed, watchable and downloadable right here
              instead of hiding in the queue list below. */}
          {newestReady && newestReadyUrl ? (
            <div style={{ marginBottom: 20 }}>
              <VideoResultHero
                src={newestReadyUrl}
                aspect={aspect}
                title={`${newestReady.index}. ${newestReady.title}`}
                badge={
                  liveDone >= liveTotal
                    ? `All ${liveTotal} clip${liveTotal === 1 ? '' : 's'} are ready`
                    : `${liveDone} of ${liveTotal} clips ready`
                }
                note="Newest finished clip — playing muted. The rest of the batch keeps rendering below."
                downloadLabel="Download Video"
                surface={T.bg}
                autoScroll={false}
                testId="series-latest-clip-hero"
                playerTestId="video-series-latest"
                downloadTestId="link-download-latest-clip"
              />
            </div>
          ) : null}

          {clips.some((c) => isContentFilterError(viewRun(c.key).error)) ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorNotice>
                The video model's safety filter rejected your subject's photo, so the clips anchored to it keep
                failing.{' '}
                {photoRetryUsed
                  ? 'The same photo was already retried once here, so the reliable fixes are what is left. '
                  : 'The filter is not perfectly consistent — the very same photo can pass on a second try — so you can retry the failed clips with it once more (each clip retried is one more render). '}
                Carry on without the photo and the batch still holds your subject — their written description goes
                into every clip. Or pick a different subject, with your clip list kept intact: the filter flags one
                specific image, so another photo may pass, and an Animated-style portrait avoids the check altogether.
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {!photoRetryUsed ? (
                    <GhostButton
                      onClick={retryWithPhoto}
                      disabled={running}
                      style={{ padding: '9px 15px', fontSize: 13 }}
                      testId="button-retry-with-photo"
                    >
                      <RefreshCw size={13} /> Try that photo again
                    </GhostButton>
                  ) : null}
                  <PrimaryButton
                    onClick={dropPhotoAndContinue}
                    style={{ padding: '9px 15px', fontSize: 13 }}
                    testId="button-drop-photo"
                  >
                    <Play size={14} /> Carry on without the photo
                  </PrimaryButton>
                  <GhostButton onClick={changeSubject} testId="button-change-subject">
                    <User size={13} /> Choose a different subject
                  </GhostButton>
                </span>
              </ErrorNotice>
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {clips
              .filter((c) => c.include)
              .map((clip) => {
                const run = viewRun(clip.key);
                return (
                  <Card
                    key={clip.key}
                    style={{
                      padding: '11px 13px',
                      borderColor: run.status === 'failed' ? 'rgba(239,68,68,0.3)' : T.border,
                    }}
                    data-testid={`series-render-${clip.index}`}
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
                        {run.status === 'done' ? <Check size={12} /> : clip.index}
                      </span>

                      {run.status === 'done' && run.url ? (
                        <video
                          src={run.url}
                          controls
                          muted
                          playsInline
                          preload="metadata"
                          style={{
                            width: 92,
                            flexShrink: 0,
                            borderRadius: 8,
                            border: `1px solid ${T.border}`,
                            background: '#000',
                            aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9',
                            objectFit: 'cover',
                          }}
                          data-testid={`video-series-clip-${clip.index}`}
                        />
                      ) : null}

                      <div style={{ flex: 1, minWidth: 150 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{clip.title}</span>
                          <LevelBadge level={clip.level} />
                        </span>
                        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted }}>
                          {clip.category ? `${clip.category} · ` : ''}
                          {run.error || run.message || 'Waiting its turn'}
                        </span>
                      </div>

                      <StatusPill run={run} />

                      {run.status === 'failed' && !isContentFilterError(run.error) ? (
                        <GhostButton
                          onClick={() => retryClip(clip)}
                          disabled={running}
                          style={{ padding: '6px 11px', fontSize: 12 }}
                          testId={`button-retry-clip-${clip.index}`}
                        >
                          <RefreshCw size={12} /> Retry
                        </GhostButton>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
          </div>

          {runNotice ? (
            <div style={{ marginBottom: 12 }}>
              <p
                data-testid="note-series-model"
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

          {runError ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorNotice>{runError}</ErrorNotice>
            </div>
          ) : null}

          <Card>
            <p style={{ margin: 0, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
              A long batch keeps going while this screen is open. If you do close it, every clip already started keeps
              rendering and lands in <strong style={{ color: T.sub }}>My Videos</strong>
              {persisted ? ' — and you can reopen the series here and hit Resume to pick up the rest' : ''}.
            </p>
            {persistNotice ? (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>{persistNotice}</p>
            ) : null}
          </Card>
        </div>
      ) : null}

      {/* ---- 5. Library ---- */}
      {step === 'library' ? (
        <div className="rc-fade">
          <StepHeader
            title={doneClips.length > 0 ? `${doneClips.length} clip${doneClips.length === 1 ? '' : 's'} ready` : 'No finished clips yet'}
            subtitle={
              doneClips.length > 0
                ? `${title || 'Your series'} — every clip is its own file, grouped the way you listed them. Download them one by one, or copy all the links at once.`
                : 'Once clips finish rendering they show up here, each one downloadable on its own.'
            }
            onBack={() => setStep('render')}
            backLabel="Render"
          />

          {doneClips.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              <GhostButton onClick={copyLinks} testId="button-copy-links">
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Links copied' : 'Copy all links'}
              </GhostButton>
              <GhostButton onClick={resetSeries} testId="button-new-series">
                <Sparkles size={13} /> Start another series
              </GhostButton>
            </div>
          ) : null}

          {newestReady && newestReadyUrl ? (
            <div style={{ marginBottom: 26 }}>
              <VideoResultHero
                src={newestReadyUrl}
                aspect={aspect}
                title={`${newestReady.index}. ${newestReady.title}`}
                badge="Newest clip"
                note="Picture only — these clips have no soundtrack, so add your own audio wherever you post them. Every other finished clip is below."
                downloadLabel="Download Video"
                surface={T.bg}
                testId="series-library-hero"
                playerTestId="video-library-latest"
                downloadTestId="link-download-library-latest"
              />
            </div>
          ) : null}

          {groups.map((group) => {
            const ready = group.clips.filter((c) => viewRun(c.key).status === 'done' && viewRun(c.key).url);
            if (ready.length === 0) return null;
            return (
              <div key={group.category || 'ungrouped'} style={{ marginBottom: 26 }}>
                {group.category ? (
                  <h3
                    style={{
                      margin: '0 0 10px',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      color: T.accentFg,
                    }}
                  >
                    {group.category}
                  </h3>
                ) : null}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${aspect === '9:16' ? 190 : 260}px, 1fr))`,
                    gap: 12,
                  }}
                >
                  {ready.map((clip) => {
                    const url = viewRun(clip.key).url as string;
                    return (
                      <Card key={clip.key} style={{ padding: 0, overflow: 'hidden' }}>
                        <video
                          src={url}
                          controls
                          muted
                          playsInline
                          preload="metadata"
                          style={{
                            display: 'block',
                            width: '100%',
                            aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9',
                            objectFit: 'contain',
                            background: '#000',
                          }}
                          data-testid={`video-library-${clip.index}`}
                        />
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>
                              {clip.index}. {clip.title}
                            </span>
                            <LevelBadge level={clip.level} />
                          </div>
                          <a
                            href={url}
                            download={`${String(clip.index).padStart(2, '0')}-${clip.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rc-ghost"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 9,
                              padding: '6px 11px',
                              borderRadius: 9,
                              fontSize: 12,
                              fontWeight: 600,
                              color: T.sub,
                              textDecoration: 'none',
                              border: `1px solid ${T.border}`,
                              background: 'rgba(255,255,255,0.03)',
                            }}
                            data-testid={`link-download-clip-${clip.index}`}
                          >
                            <Download size={12} /> Download
                          </a>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {doneClips.length === 0 ? (
            <Card>
              <p style={{ margin: 0, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
                Nothing has finished yet. Go back to Render and start the batch — clips appear here as they land.
              </p>
            </Card>
          ) : (
            <Card style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <CheckCircle2 size={16} color={T.success} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
                These are separate files on purpose — a series is a library, not one film. If you want several of these
                joined into a single video instead, build it in <strong style={{ color: T.sub }}>Long Video</strong>.
              </p>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
