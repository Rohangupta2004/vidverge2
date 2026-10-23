/**
 * VIDEO PROVIDER LAB — a focused chat surface over the platform's video models.
 *
 * One model selector in the header, one conversation underneath it, one input
 * bar at the bottom. Every send records a user turn (prompt plus whatever was
 * attached) and an assistant turn that fills in with the finished clip, the
 * provider's own error, or the point at which polling was stopped.
 *
 * The catalog lives in ./labModels.ts (what exists, which plugin powers it,
 * which parameters it takes) and the network layer in ./labClient.ts (one
 * submit/poll pair per plugin). This file is only the surface.
 *
 * No provider key, environment variable or BYOK secret appears anywhere in
 * this app or reaches the browser: every request goes to a same-origin /api
 * path where the platform adds the provider credential server-side and bills
 * the workspace wallet. `X-Workspace-DB-Token` is the only credential sent.
 *
 * The owner-only HEALTH view (./HealthPanel) sits beside the conversation. It
 * reads the live provider catalogs and reports ok/error plus latency per
 * endpoint, and it generates nothing — it is the live answer that replaced the
 * hand-written availability verdicts in lib/videoEngines.ts.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Activity, AlertCircle, ChevronDown, ChevronUp, Download, FileText, Film, Music, Paperclip, Send, X,
} from 'lucide-react';

import {
  CAMERA_PRESETS,
  DEFAULT_LAB_MODEL_KEY,
  LAB_GROUPS,
  LAB_MODELS,
  defaultRunInput,
  describeRunBlock,
  effectiveRunInput,
  isKlingTool,
  labModel,
  retargetRunInput,
} from './labModels';
import type { LabModel, LabRunInput } from './labModels';
import {
  CANCELLED,
  MAX_IMAGE_BYTES,
  describeError,
  errorText,
  listLabRuns,
  readImageFile,
  reconcileLabRun,
  runLabModel,
  watchLabJob,
  workspaceToken,
} from './labClient';
import type { LabRun, RunContext, RunResult } from './labClient';
import HealthPanel from './HealthPanel';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import AppShell from '../../components/ui/AppShell';
import { COLORS, FONT as THEME_FONT, alpha } from '../../components/theme';
import { withBrandContext } from '../../components/BrandContextLayer';
import { VideoHistory } from '../../components/VideoHistory';
import { saveVideoToHistory } from '../../lib/videoHistory';

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const C = {
  bg: COLORS.bg,
  card: COLORS.surface,
  raised: COLORS.surfaceAlt,
  line: COLORS.border,
  lineStrong: COLORS.borderHover,
  accent: COLORS.primary,
  accentSurface: alpha(COLORS.primary, 0.14),
  ink: COLORS.text,
  soft: COLORS.textMuted,
  muted: COLORS.textFaint,
  good: COLORS.success,
  bad: COLORS.error,
  warn: COLORS.warning,
  headerBg: COLORS.surface,
  headerText: COLORS.text,
};
const FONT = THEME_FONT.body;
const MONO = THEME_FONT.mono;

const MAX_ATTACHED_IMAGES = 4;
/** A data URL is held in memory and posted inline, so a feature-length upload
 *  would hang the tab long before the proxy ever saw it. */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_RUNS = 24;
/** Three lines of the 14px input before it starts scrolling instead of growing. */
const MAX_INPUT_HEIGHT = 74;
const STYLE_ID = 'video-provider-lab-styles';

// ---------------------------------------------------------------------------
// Thread records
// ---------------------------------------------------------------------------

type Phase = 'generating' | 'done' | 'error' | 'stopped';

type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  /** Read for images and video; empty for anything the lab only displays. */
  dataUrl: string;
}

interface UserMessage {
  kind: 'user';
  id: string;
  text: string;
  attachments: Attachment[];
}

interface RunMessage {
  kind: 'run';
  id: string;
  modelKey: string;
  modelName: string;
  provider: string;
  phase: Phase;
  note: string;
  videoUrl: string;
  modelUsed: string;
  detail: string;
  error: string;
  startedAt: number;
  finishedMs: number;
  /** Set once the run is saved in the server ledger — the render has been charged by then. */
  jobId?: number;
}

type ChatMessage = UserMessage | RunMessage;

const CREDIT_SENTENCES = [
  ' Credits were charged when the render was submitted and are NOT refunded automatically.',
  ' Credits may already have been charged for this render; nothing is refunded automatically from this app.',
];

/** Separates the headline reason from the credit sentence the server appends, so the charge gets its own callout. */
function splitRunError(raw: string): { timedOut: boolean; message: string } {
  let message = String(raw || '');
  CREDIT_SENTENCES.forEach((sentence) => { message = message.split(sentence).join(''); });
  message = message.trim();
  return { timedOut: /^timed out|made no progress for/i.test(message), message };
}

function messageId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function attachmentKind(mime: string): AttachmentKind {
  const type = String(mime || '').toLowerCase();
  if (type.indexOf('image/') === 0) return 'image';
  if (type.indexOf('video/') === 0) return 'video';
  if (type.indexOf('audio/') === 0) return 'audio';
  return 'file';
}

/** Images go through readImageFile; everything else the lab actually sends
 *  (today only a source video) is read the same way here. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function useLabStyles() {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '@keyframes vpl-spin { to { transform: rotate(360deg); } }',
      '@keyframes vpl-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }',
      '@keyframes vpl-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
      '.vpl-btn { transition: filter 120ms ease, transform 120ms ease; }',
      '.vpl-btn:hover:not(:disabled) { filter: brightness(1.15); }',
      '.vpl-btn:active:not(:disabled) { transform: translateY(1px); }',
      '.vpl-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.vpl-turn { animation: none; }',
      '.vpl-scroll::-webkit-scrollbar { height: 6px; width: 6px; }',
      `.vpl-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 6px; }`,
      `.vpl-scroll::-webkit-scrollbar-thumb:hover { background: ${COLORS.controlBorder}; }`,
      '.vpl-scroll::-webkit-scrollbar-track { background: transparent; }',
      `.vpl-input:focus, .vpl-select:focus { outline: 2px solid ${COLORS.focus}; outline-offset: 3px; border-color: ${COLORS.focus}; box-shadow: none; }`,
    ].join('\n');
    document.head.appendChild(style);
  }, []);
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: 99,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        display: 'inline-block',
        flexShrink: 0,
        animation: 'vpl-spin 0.8s linear infinite',
      }}
    />
  );
}

function FileChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const Icon = attachment.kind === 'video' ? Film : attachment.kind === 'audio' ? Music : FileText;
  return (
    <span
      title={attachment.name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 200,
        background: C.raised,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: '5px 8px',
        fontSize: 11,
        fontFamily: MONO,
        color: C.soft,
      }}
    >
      <Icon size={12} color={C.muted} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.muted, display: 'flex' }}
        >
          <X size={11} />
        </button>
      ) : null}
    </span>
  );
}

function ImageThumb({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return (
    <span
      style={{
        position: 'relative',
        width: 62,
        height: 62,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${C.lineStrong}`,
        background: C.bg,
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      <img
        src={attachment.dataUrl}
        alt={attachment.name}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            width: 18,
            height: 18,
            borderRadius: 5,
            border: 'none',
            background: 'rgba(26,16,0,0.6)',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <X size={10} />
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Kling controls — field pieces
// ---------------------------------------------------------------------------

const FIELD_STYLE: CSSProperties = {
  background: COLORS.input,
  color: C.ink,
  border: `1px solid ${C.lineStrong}`,
  minHeight: 44,
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12.5,
  fontFamily: FONT,
  minWidth: 0,
  boxSizing: 'border-box',
};

function Field({ label, children, grow, width }: {
  label: string;
  children: ReactNode;
  grow?: boolean;
  width?: number;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: grow ? '1 1 220px' : '0 0 auto',
        width: grow ? undefined : width,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/** A number box that lets the user clear and retype: it keeps its own text and
 *  only reports values that parse, clamped to the range. */
function NumberInput({ value, onCommit, min, max, step, placeholder, integer, allowEmpty }: {
  value: number | null;
  onCommit: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  integer?: boolean;
  allowEmpty?: boolean;
}) {
  const shown = (current: number | null) => (current === null || current === undefined ? '' : String(current));
  const [text, setText] = useState(shown(value));

  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? null : Number(current);
      return parsed === value ? current : shown(value);
    });
  }, [value]);

  return (
    <input
      className="vpl-select"
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        if (raw.trim() === '') {
          if (allowEmpty) onCommit(null);
          return;
        }
        let next = Number(raw);
        if (!Number.isFinite(next)) return;
        if (integer) next = Math.trunc(next);
        if (min !== undefined) next = Math.max(min, next);
        if (max !== undefined) next = Math.min(max, next);
        onCommit(next);
      }}
      onBlur={() => setText(shown(value))}
      style={{ ...FIELD_STYLE, width: '100%' }}
    />
  );
}

function describeToolTurn(model: LabModel, input: LabRunInput): string {
  const id = input.sourceTaskId.trim();
  if (model.params.extend) return `Extend clip ${id}`;
  const spoken = input.lipSyncText.trim() || input.lipSyncAudioUrl.trim();
  return `Lip sync clip ${id}: ${spoken}`;
}

const BrandedVideoProviderLab = withBrandContext(App, 'Video Provider Lab');
export default BrandedVideoProviderLab;
function App() {
  const { spaceId } = useSpaceRuntime();

  // Keyed on the space so a tenant switch starts the thread fresh.
  return <VideoProviderLab key={spaceId || 'lab'} />;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function VideoProviderLab() {
  useLabStyles();

  const [activeKey, setActiveKey] = useState(DEFAULT_LAB_MODEL_KEY);
  const active = labModel(activeKey) || LAB_MODELS[0];
  const [input, setInput] = useState<LabRunInput>(() => defaultRunInput(active, ''));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachNotice, setAttachNotice] = useState('');
  const [tick, setTick] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(true);
  // The Health view replaces the conversation rather than floating over it, so
  // a diagnostic read can never be mistaken for a run in the thread.
  const [showHealth, setShowHealth] = useState(false);
  // Bumped whenever a run lands so the shared Your videos list reloads.
  const [historyKey, setHistoryKey] = useState(0);

  const mounted = useRef(true);
  const knownJobs = useRef<Set<number>>(new Set());
  const cancels = useRef<Record<string, Array<() => void>>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const stopPolling = useCallback((runId?: string) => {
    const ids = runId ? [runId] : Object.keys(cancels.current);
    ids.forEach((key) => {
      (cancels.current[key] || []).forEach((cancel) => {
        try { cancel(); } catch { /* already settled */ }
      });
      cancels.current[key] = [];
    });
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    stopPolling();
  }, [stopPolling]);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message].slice(-MAX_RUNS));
  }, []);

  const patchRun = useCallback((runId: string, next: Partial<RunMessage>) => {
    if (!mounted.current) return;
    setMessages((prev) => prev.map((message) => (
      message.kind === 'run' && message.id === runId ? { ...message, ...next } : message
    )));
  }, []);

  const refreshHistory = useCallback(() => {
    if (mounted.current) setHistoryKey((value) => value + 1);
  }, []);

  // RESUME. A render submitted and then abandoned (tab closed, space reloaded)
  // lives in the server ledger, not in this thread. On open, bring back every run
  // that is still in flight — watching it to its verdict — plus the last day's
  // failed or timed-out runs so the outcome and the credit note stay visible, and
  // re-check timed-out runs once because the provider may have finished them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const runs = await listLabRuns(24);
      if (cancelled || !mounted.current || !runs.length) return;
      const nowMs = Date.now();
      const startedAtOf = (run: LabRun) => new Date(run.started_at || run.created_at).getTime() || nowMs;
      const fresh = runs.filter((run) => !knownJobs.current.has(run.job_id));
      const open = fresh.filter((run) => run.status !== 'done' && run.status !== 'error');
      const failed = fresh
        .filter((run) => run.status === 'error' && nowMs - startedAtOf(run) < 24 * 60 * 60 * 1000)
        .slice(0, 5);
      const resumed = [...failed, ...open].sort((a, b) => startedAtOf(a) - startedAtOf(b));
      if (!resumed.length) return;

      const added: ChatMessage[] = [];
      resumed.forEach((run) => {
        knownJobs.current.add(run.job_id);
        const isOpen = run.status !== 'error';
        const startedAt = startedAtOf(run);
        added.push({ kind: 'user', id: `earlier-you:${run.job_id}`, text: run.prompt || 'Earlier run', attachments: [] });
        added.push({
          kind: 'run',
          id: `job:${run.job_id}`,
          modelKey: 'resumed',
          modelName: run.model_name,
          provider: `earlier run #${run.job_id}`,
          phase: isOpen ? 'generating' : 'error',
          note: isOpen ? 'Picked up where you left off — checking with the provider…' : '',
          videoUrl: '',
          modelUsed: '',
          detail: '',
          error: run.error_msg || '',
          startedAt,
          finishedMs: isOpen ? 0 : Math.max(0, (new Date(run.updated_at).getTime() || startedAt) - startedAt),
          jobId: run.job_id,
        });
      });
      setMessages((prev) => [...added, ...prev].slice(-MAX_RUNS));

      resumed.forEach((run) => {
        const id = `job:${run.job_id}`;
        const startedAt = startedAtOf(run);
        if (run.status === 'error') {
          if (!run.recoverable) return;
          void reconcileLabRun(run).then((outcome) => {
            if (outcome.state !== 'done' || !outcome.run.result_url) return;
            patchRun(id, {
              phase: 'done',
              error: '',
              videoUrl: outcome.run.result_url,
              modelUsed: outcome.run.model_used,
              detail: outcome.run.verification || 'Recovered: the provider finished this render after the wait limit closed it.',
              finishedMs: Date.now() - startedAt,
            });
            refreshHistory();
          });
          return;
        }
        void watchLabJob({
          jobId: run.job_id,
          label: run.model_name,
          fallbackModel: run.model_used,
          capMs: run.cap_ms,
          ctx: {
            note: (note) => patchRun(id, { note }),
            register: (cancel) => {
              if (!cancels.current[id]) cancels.current[id] = [];
              cancels.current[id].push(cancel);
            },
          },
        }).then((result) => {
          patchRun(id, {
            phase: 'done',
            note: '',
            videoUrl: result.videoUrl,
            modelUsed: result.modelUsed,
            detail: result.detail || '',
            finishedMs: Date.now() - startedAt,
          });
          refreshHistory();
        }).catch((error) => {
          if (errorText(error) === CANCELLED) {
            patchRun(id, { phase: 'stopped', note: '', finishedMs: Date.now() - startedAt });
          } else {
            patchRun(id, { phase: 'error', note: '', error: describeError(error, []), finishedMs: Date.now() - startedAt });
          }
        });
      });
    })();
    return () => { cancelled = true; };
  }, [patchRun, refreshHistory]);

  const runningCount = useMemo(
    () => messages.filter((message) => message.kind === 'run' && message.phase === 'generating').length,
    [messages],
  );
  const busy = runningCount > 0;

  // One shared heartbeat drives every live elapsed timer, so two concurrent
  // runs do not carry two intervals.
  useEffect(() => {
    if (!runningCount) return undefined;
    const id = window.setInterval(() => {
      if (mounted.current) setTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [runningCount]);

  const now = useMemo(() => Date.now(), [tick, runningCount]);

  const phaseSignature = useMemo(
    () => messages.map((message) => (message.kind === 'run' ? message.phase : 'u')).join('|'),
    [messages],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, phaseSignature]);

  useEffect(() => {
    const node = textRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [prompt]);

  const selectModel = useCallback((key: string) => {
    const model = labModel(key);
    if (!model) return;
    setActiveKey(key);
    setInput((prev) => retargetRunInput(prev, model));
  }, []);

  const patchInput = useCallback((next: Partial<LabRunInput>) => {
    setInput((prev) => ({ ...prev, ...next }));
  }, []);

  // Extend and Lip Sync act on a finished clip, so they run without a prompt
  // or attachment and are gated on their own required fields instead.
  const tool = isKlingTool(active);
  const toolBlock = tool ? describeRunBlock(active, { ...input, prompt, images: [] }) : null;

  // The controls strip is not Kling-only. Any entry that offers a choice of
  // clip length gets it too, because a long-form model is unusable without
  // one. Seedance uses a whole-second stepper so legal values are not snapped
  // to an outdated fixed list. Entries whose length the provider fixes still
  // provider fixes (the Higgsfield DoP image-to-video models) still show
  // nothing, rather than a control that is silently ignored.
  const showControls =
    tool ||
    active.group === 'kling' ||
    active.params.durations.length > 0 ||
    (active.params.durationMin !== null && active.params.durationMax !== null) ||
    active.params.resolutions.length > 0 ||
    active.params.audio;
  const controlsLabel = active.group === 'kling' ? 'Kling controls' : 'Run controls';
  const controlsHint = active.params.durationMin !== null && active.params.durationMax !== null
    ? `${active.name} accepts every whole second from ${active.params.durationMin} to ${active.params.durationMax}. The exact value is sent with the run — longer clips cost more.`
    : active.params.durations.length
      ? `${active.name} accepts ${active.params.durations.join(' / ')}s. The length picked here is sent with the run — longer clips cost more, and a length the provider refuses comes back verbatim on the run card.`
      : 'Only the controls this model accepts are shown; everything else is left to the provider.';

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  // Takes a plain array, not the live FileList: the picker is reset as soon as
  // the handler fires, and clearing an input's value empties its FileList, so
  // the files have to be copied out before the first await.
  const attachFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const added: Attachment[] = [];
    const problems: string[] = [];
    let imageSlots = MAX_ATTACHED_IMAGES - pending.filter((item) => item.kind === 'image').length;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const mime = String(file.type || '');
      const kind = attachmentKind(mime);
      const base = { id: messageId('att'), name: file.name, mime, kind };

      if (kind === 'image') {
        if (imageSlots <= 0) {
          problems.push(`Only ${MAX_ATTACHED_IMAGES} images travel with a run, so ${file.name} was skipped.`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          problems.push(`${file.name} is over the ~10MB inline limit the proxies enforce.`);
          continue;
        }
        try {
          added.push({ ...base, dataUrl: await readImageFile(file) });
          imageSlots -= 1;
        } catch (error) {
          problems.push(errorText(error));
        }
        continue;
      }

      if (kind === 'video') {
        if (!active.params.videoUpload) {
          problems.push(`${active.name} takes no source video, so ${file.name} rides along as a note only.`);
          added.push({ ...base, dataUrl: '' });
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          problems.push(`${file.name} is over the 20MB this lab can inline — trim it first.`);
          continue;
        }
        try {
          added.push({ ...base, dataUrl: await readFileAsDataUrl(file) });
        } catch (error) {
          problems.push(errorText(error));
        }
        continue;
      }

      added.push({ ...base, dataUrl: '' });
    }

    if (!mounted.current) return;
    setAttachNotice(problems.join(' '));
    if (added.length) setPending((prev) => [...prev, ...added]);
  }, [active, pending]);

  const removeAttachment = useCallback((id: string) => {
    setPending((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  const seedRun = useCallback((model: LabModel): RunMessage => ({
    kind: 'run',
    id: messageId(model.key),
    modelKey: model.key,
    modelName: model.name,
    provider: model.provider,
    phase: 'generating',
    note: 'Starting…',
    videoUrl: '',
    modelUsed: '',
    detail: '',
    error: '',
    startedAt: Date.now(),
    finishedMs: 0,
  }), []);

  /**
   * Each run owns its own try/catch and its own cancel list, so a provider
   * failing never takes the thread — or any other run — down with it.
   */
  const launch = useCallback((model: LabModel, work: (ctx: RunContext) => Promise<RunResult>) => {
    const run = seedRun(model);
    pushMessage(run);

    const triedPaths: string[] = [];
    const ctx: RunContext = {
      note: (note) => patchRun(run.id, { note }),
      tried: (path) => {
        if (triedPaths.indexOf(path) === -1) triedPaths.push(path);
      },
      register: (cancel) => {
        if (!cancels.current[run.id]) cancels.current[run.id] = [];
        cancels.current[run.id].push(cancel);
      },
      adopted: (jobId) => {
        knownJobs.current.add(jobId);
        patchRun(run.id, { jobId });
      },
    };

    void (async () => {
      try {
        const result = await work(ctx);
        patchRun(run.id, {
          phase: 'done',
          note: '',
          videoUrl: result.videoUrl,
          modelUsed: result.modelUsed,
          detail: result.detail || '',
          finishedMs: Date.now() - run.startedAt,
        });
        void saveVideoToHistory({
          appId: 'video-provider-lab',
          title: `${model.name} test render`,
          videoUrl: result.videoUrl,
        }).then(refreshHistory);
        refreshHistory();
      } catch (error) {
        if (errorText(error) === CANCELLED) {
          patchRun(run.id, { phase: 'stopped', note: '', finishedMs: Date.now() - run.startedAt });
        } else {
          patchRun(run.id, {
            phase: 'error',
            note: '',
            error: describeError(error, triedPaths),
            finishedMs: Date.now() - run.startedAt,
          });
        }
      } finally {
        cancels.current[run.id] = [];
      }
    })();
  }, [patchRun, pushMessage, refreshHistory, seedRun]);

  const send = useCallback(() => {
    if (busy) return;
    const text = prompt.trim();
    if (tool ? toolBlock : (!text && !pending.length)) return;

    const model = active;
    const images = pending
      .filter((item) => item.kind === 'image' && item.dataUrl)
      .map((item) => item.dataUrl)
      .slice(0, MAX_ATTACHED_IMAGES);
    const sourceVideo = pending.find((item) => item.kind === 'video' && item.dataUrl);

    const runInput = effectiveRunInput(model, {
      ...input,
      prompt: text,
      images,
      videoInput: model.params.videoUpload && sourceVideo ? sourceVideo.dataUrl : '',
    });

    const shownText = text || (tool ? describeToolTurn(model, input) : '');
    pushMessage({ kind: 'user', id: messageId('you'), text: shownText, attachments: pending });
    setPrompt('');
    setPending([]);
    setAttachNotice('');
    launch(model, (ctx) => runLabModel(model, runInput, ctx));
  }, [active, busy, input, launch, pending, prompt, pushMessage, tool, toolBlock]);

  // -------------------------------------------------------------------------
  // Surface
  // -------------------------------------------------------------------------

  const hasToken = Boolean(workspaceToken());
  const credentialWarning = hasToken ? '' : 'no workspace credential — reload the space';
  const canSend = !busy && (tool ? !toolBlock : Boolean(prompt.trim() || pending.length));

  return (
    <AppShell
      title="Video Provider Lab"
      header={false}
      watermark={false}
      grid={false}
      scroll={false}
      padding={0}
      maxWidth="full"
      contentStyle={{ color: C.ink, fontFamily: FONT }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          minHeight: 0,
          overflow: 'hidden',
          background: C.bg,
        }}
      >

        {/* Row 1 — header */}
        <div
          style={{
            flexShrink: 0,
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            padding: '8px 16px',
            background: C.headerBg,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: -0.2,
              whiteSpace: 'nowrap',
              color: C.headerText,
            }}
          >
            Video Provider Lab
          </span>
          {credentialWarning ? (
            <span style={{ fontSize: 10.5, color: C.warn, fontFamily: MONO, lineHeight: 1.4 }}>
              {credentialWarning}
            </span>
          ) : null}
          <button
            type="button"
            className="vpl-btn"
            onClick={() => setShowHealth((value) => !value)}
            title="Owner-only diagnostics: read the live provider catalogs and report ok/error plus latency. Generates nothing and charges nothing."
            style={{
              marginLeft: 'auto',
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: showHealth ? C.accentSurface : 'transparent',
              color: showHealth ? C.accent : C.soft,
              border: `1px solid ${showHealth ? alpha(COLORS.primary, 0.45) : C.line}`,
              borderRadius: 9,
              padding: '7px 11px',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: FONT,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            <Activity size={13} /> Health
          </button>
          <select
            className="vpl-select"
            value={activeKey}
            onChange={(event) => selectModel(event.target.value)}
            title={`${active.provider} · ${active.costHint}`}
            style={{
              background: COLORS.input,
              color: C.headerText,
              border: `1px solid ${alpha(COLORS.primary, 0.4)}`,
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 12.5,
              fontFamily: FONT,
              flex: '1 1 220px',
              maxWidth: 320,
              minWidth: 0,
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            {LAB_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {LAB_MODELS.filter((model) => model.group === group.id).map((model, index, list) => (
                  <Fragment key={model.key}>
                    {isKlingTool(model) && !(index > 0 && isKlingTool(list[index - 1])) ? (
                      <option
                        value="__kling-tools__"
                        disabled
                        style={{ color: COLORS.textFaint, background: COLORS.input }}
                      >
                        {'— Tools —'}
                      </option>
                    ) : null}
                    <option
                      value={model.key}
                      disabled={!model.available}
                      style={{
                        color: model.available ? C.headerText : COLORS.textFaint,
                        background: COLORS.input,
                      }}
                    >
                      {model.available ? model.name : `${model.name} — unavailable`}
                    </option>
                  </Fragment>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Row 2 — the owner-only health read, or the conversation */}
        {showHealth ? <HealthPanel onClose={() => setShowHealth(false)} /> : null}

        <div
          ref={scrollRef}
          className="vpl-scroll"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '18px 16px',
            display: showHealth ? 'none' : 'flex',
            flexDirection: 'column',
            gap: 14,
            background: C.bg,
          }}
        >
          {!messages.length ? (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.soft }}>Describe a shot to generate it</div>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
                {tool
                  ? `${active.name} is selected. Fill in the Kling controls below, then press send — every run goes through the Audos proxy and bills the workspace wallet.`
                  : `${active.name} is selected. Attach reference images or a source clip with the paperclip — every run goes through the Audos proxy and bills the workspace wallet.`}
              </p>
            </div>
          ) : null}

          {messages.map((message) => {
            if (message.kind === 'user') {
              const images = message.attachments.filter((item) => item.kind === 'image' && item.dataUrl);
              const others = message.attachments.filter((item) => !(item.kind === 'image' && item.dataUrl));
              return (
                <div key={message.id} className="vpl-turn" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '78%',
                      background: C.raised,
                      border: `1px solid ${C.lineStrong}`,
                      color: C.ink,
                      borderRadius: '14px 14px 4px 14px',
                      padding: '11px 13px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                    }}
                  >
                    {message.text ? (
                      <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {message.text}
                      </div>
                    ) : null}
                    {images.length ? (
                      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {images.map((item) => <ImageThumb key={item.id} attachment={item} />)}
                      </div>
                    ) : null}
                    {others.length ? (
                      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {others.map((item) => <FileChip key={item.id} attachment={item} />)}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }

            const elapsedMs = message.phase === 'generating'
              ? Math.max(0, now - message.startedAt)
              : message.finishedMs;

            return (
              <div key={message.id} className="vpl-turn" style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '78%',
                    minWidth: 220,
                    background: C.card,
                    border: `1px solid ${message.phase === 'generating' ? C.lineStrong : C.line}`,
                    color: C.ink,
                    borderRadius: '14px 14px 14px 4px',
                    padding: '11px 13px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{message.modelName}</span>
                    <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
                      {`${message.provider} · ${formatClock(elapsedMs)}`}
                    </span>
                  </div>

                  {message.phase === 'generating' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                          color: C.accent,
                          background: C.accentSurface,
                          border: `1px solid ${alpha(COLORS.primary, 0.35)}`,
                          borderRadius: 999,
                          padding: '4px 10px',
                        }}
                      >
                        <Spinner color={C.accent} /> Generating
                      </span>
                      <span style={{ fontSize: 12, color: C.soft, lineHeight: 1.55, flex: 1, minWidth: 140 }}>
                        {message.note}
                      </span>
                      <button
                        type="button"
                        className="vpl-btn"
                        onClick={() => stopPolling(message.id)}
                        title="Stops this run polling. The provider keeps rendering and the wallet charge stands."
                        style={{
                          background: 'transparent',
                          color: C.soft,
                          border: `1px solid ${C.lineStrong}`,
                          borderRadius: 8,
                          padding: '5px 10px',
                          fontSize: 11.5,
                          fontWeight: 600,
                          fontFamily: FONT,
                          cursor: 'pointer',
                        }}
                      >
                        Stop
                      </button>
                    </div>
                  ) : null}

                  {message.phase === 'done' && message.videoUrl ? (
                    <>
                      <video
                        src={message.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        style={{
                          width: '100%',
                          maxWidth: 420,
                          borderRadius: 10,
                          background: '#000000',
                          border: `1px solid ${C.line}`,
                          display: 'block',
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, wordBreak: 'break-all', flex: 1, minWidth: 120 }}>
                          {message.modelUsed}
                        </span>
                        <a
                          href={message.videoUrl}
                          download
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            color: C.accent,
                            border: `1px solid ${C.lineStrong}`,
                            borderRadius: 8,
                            padding: '5px 10px',
                            fontSize: 11.5,
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          <Download size={12} /> Download
                        </a>
                      </div>
                      {message.detail ? (
                        <div style={{ fontSize: 11.5, color: C.soft, lineHeight: 1.55 }}>{message.detail}</div>
                      ) : null}
                    </>
                  ) : null}

                  {message.phase === 'error' ? (
                    <div
                      style={{
                        background: alpha(COLORS.error, 0.08),
                        border: `1px solid ${alpha(COLORS.error, 0.3)}`,
                        borderRadius: 9,
                        padding: '9px 11px',
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      <AlertCircle size={14} color={C.bad} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                        {message.jobId !== undefined ? (
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.error }}>
                            {splitRunError(message.error).timedOut ? 'Timed out' : 'Render failed'}
                          </div>
                        ) : null}
                        <div
                          style={{
                            fontSize: 11.5,
                            color: COLORS.error,
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: MONO,
                          }}
                        >
                          {message.jobId !== undefined ? splitRunError(message.error).message : message.error}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {message.phase === 'error' && message.jobId !== undefined ? (
                    <div
                      style={{
                        background: alpha(COLORS.warning, 0.1),
                        border: `1px solid ${alpha(COLORS.warning, 0.35)}`,
                        borderRadius: 9,
                        padding: '8px 11px',
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        color: C.soft,
                      }}
                    >
                      <strong style={{ color: C.warn }}>Credit charge: </strong>
                      credits for this render were taken when it was submitted. A failed or timed-out run is not refunded
                      automatically — ask Otto to review run #{message.jobId} if you want the charge looked at.
                    </div>
                  ) : null}

                  {message.phase === 'stopped' ? (
                    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                      Polling stopped here. The provider kept rendering and the wallet charge stands — send again to
                      watch a fresh job.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 4 }}>
            <VideoHistory key={historyKey} />
          </div>
        </div>

        {/* Row 2b — run controls */}
        {showControls && !showHealth ? (
          <div
            className="vpl-scroll"
            style={{
              flexShrink: 0,
              background: C.card,
              borderTop: `1px solid ${C.line}`,
              padding: '8px 16px',
              maxHeight: '42vh',
              overflowY: 'auto',
            }}
          >
            <button
              type="button"
              className="vpl-btn"
              onClick={() => setControlsOpen((value) => !value)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: C.soft,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                fontFamily: FONT,
                cursor: 'pointer',
              }}
            >
              {controlsOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              {controlsLabel}
            </button>

            {controlsOpen ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, alignItems: 'flex-end' }}>
                {active.params.durationMin !== null && active.params.durationMax !== null ? (
                  <Field label={`Duration (${active.params.durationMin}–${active.params.durationMax}s)`} width={126}>
                    <NumberInput
                      value={input.duration}
                      onCommit={(next) => patchInput({ duration: next ?? active.params.durationMin ?? input.duration })}
                      min={active.params.durationMin}
                      max={active.params.durationMax}
                      step={active.params.durationStep}
                      integer
                    />
                  </Field>
                ) : active.params.durations.length ? (
                  <Field label="Duration" width={86}>
                    <select
                      className="vpl-select"
                      value={input.duration}
                      onChange={(event) => patchInput({ duration: Number(event.target.value) })}
                      style={FIELD_STYLE}
                    >
                      {active.params.durations.map((seconds) => (
                        <option key={seconds} value={seconds}>{`${seconds}s`}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {active.params.aspectRatios.length ? (
                  <Field label="Aspect" width={92}>
                    <select
                      className="vpl-select"
                      value={input.aspectRatio}
                      onChange={(event) => patchInput({ aspectRatio: event.target.value })}
                      style={FIELD_STYLE}
                    >
                      {active.params.aspectRatios.map((ratio) => (
                        <option key={ratio} value={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {active.params.resolutions.length ? (
                  <Field label="Resolution" width={96}>
                    <select
                      className="vpl-select"
                      value={input.resolution}
                      onChange={(event) => patchInput({ resolution: event.target.value })}
                      style={FIELD_STYLE}
                    >
                      {active.params.resolutions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {active.params.audio ? (
                  <Field label="Audio" width={86}>
                    <span
                      style={{
                        ...FIELD_STYLE,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={input.audio}
                        onChange={(event) => patchInput({ audio: event.target.checked })}
                        style={{ margin: 0, cursor: 'pointer' }}
                      />
                      {input.audio ? 'On' : 'Off'}
                    </span>
                  </Field>
                ) : null}

                {active.params.modes.length ? (
                  <Field label="Mode" width={110}>
                    <select
                      className="vpl-select"
                      value={input.mode}
                      onChange={(event) => patchInput({ mode: event.target.value })}
                      style={FIELD_STYLE}
                    >
                      {active.params.modes.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {active.params.camera ? (
                  <Field label="Camera preset" width={130}>
                    <select
                      className="vpl-select"
                      value={input.cameraPreset}
                      onChange={(event) => patchInput({ cameraPreset: event.target.value })}
                      style={FIELD_STYLE}
                    >
                      {CAMERA_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {active.params.seed ? (
                  <Field label="Seed" width={120}>
                    <NumberInput
                      value={input.seed}
                      onCommit={(next) => patchInput({ seed: next })}
                      min={0}
                      step={1}
                      integer
                      allowEmpty
                      placeholder="random"
                    />
                  </Field>
                ) : null}

                {active.params.negativePrompt ? (
                  <Field label="Negative prompt" grow>
                    <input
                      className="vpl-select"
                      type="text"
                      value={input.negativePrompt}
                      onChange={(event) => patchInput({ negativePrompt: event.target.value })}
                      placeholder="What to keep out of the clip…"
                      spellCheck={false}
                      style={FIELD_STYLE}
                    />
                  </Field>
                ) : null}

                {tool ? (
                  <Field label="Finished clip task ID" grow>
                    <input
                      className="vpl-select"
                      type="text"
                      value={input.sourceTaskId}
                      onChange={(event) => patchInput({ sourceTaskId: event.target.value })}
                      placeholder="Paste kling task ID…"
                      spellCheck={false}
                      style={{ ...FIELD_STYLE, fontFamily: MONO }}
                    />
                  </Field>
                ) : null}

                {active.params.lipSync ? (
                  <>
                    <div style={{ flex: '1 1 100%' }}>
                      <Field label="Lip Sync text (text-to-speech)" grow>
                        <textarea
                          className="vpl-select vpl-scroll"
                          value={input.lipSyncText}
                          onChange={(event) => patchInput({ lipSyncText: event.target.value })}
                          rows={2}
                          placeholder="What the character should say…"
                          spellCheck={false}
                          style={{ ...FIELD_STYLE, resize: 'vertical', lineHeight: 1.5 }}
                        />
                      </Field>
                    </div>
                    <Field label="OR audio URL" grow>
                      <input
                        className="vpl-select"
                        type="text"
                        value={input.lipSyncAudioUrl}
                        onChange={(event) => patchInput({ lipSyncAudioUrl: event.target.value })}
                        placeholder="https://…"
                        spellCheck={false}
                        style={FIELD_STYLE}
                      />
                    </Field>
                  </>
                ) : null}

                <div style={{ flex: '1 1 100%', fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
                  {active.params.multiImage
                    ? 'Attach 2–4 reference images with the paperclip — the same character will be kept across the clip.'
                    : active.params.extend
                      ? 'Every finished Kling clip prints its task ID under the video. The prompt bar is optional here and steers how the clip continues.'
                      : active.params.lipSync
                        ? 'Type dialogue for text-to-speech, or give an audio URL instead. Voice, language and speed overrides are omitted because this proxy does not support them.'
                        : active.group === 'kling'
                          ? 'Only the current proxy-supported fields are sent. Camera control, CFG scale, seed and native audio are omitted because the proxy rejects them before billing.'
                          : controlsHint}
                  {toolBlock ? <span style={{ color: C.warn }}>{` ${toolBlock}`}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Row 3 — input */}
        <div
          style={{
            flexShrink: 0,
            display: showHealth ? 'none' : 'block',
            background: C.card,
            borderTop: `1px solid ${C.line}`,
            padding: '10px 16px 14px',
          }}
        >
          {pending.length ? (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
              {pending.map((item) => (item.kind === 'image' && item.dataUrl ? (
                <ImageThumb key={item.id} attachment={item} onRemove={() => removeAttachment(item.id)} />
              ) : (
                <FileChip key={item.id} attachment={item} onRemove={() => removeAttachment(item.id)} />
              )))}
            </div>
          ) : null}

          {attachNotice ? (
            <div style={{ fontSize: 11.5, color: C.warn, lineHeight: 1.55, marginBottom: 8 }}>{attachNotice}</div>
          ) : null}

          <div style={{ marginBottom: 7, fontSize: 11, color: C.muted, lineHeight: 1.45 }} role="note">
            Cost before send: {active.costHint}. Longer clips and optional audio can cost more.
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: C.bg,
              border: `1px solid ${C.lineStrong}`,
              borderRadius: 14,
              padding: '7px 8px',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: 'none' }}
              onChange={(event) => {
                const picked = Array.from(event.target.files || []);
                event.target.value = '';
                void attachFiles(picked);
              }}
            />
            <button
              type="button"
              className="vpl-btn"
              onClick={() => fileRef.current?.click()}
              title="Attach files"
              style={{
                position: 'relative',
                width: 44,
                height: 44,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: C.muted,
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <Paperclip size={17} />
              {pending.length ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 99,
                    background: C.accent,
                    color: '#FFFFFF',
                    fontSize: 9.5,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                  }}
                >
                  {pending.length}
                </span>
              ) : null}
            </button>

            <textarea
              ref={textRef}
              className="vpl-input vpl-scroll"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={
                active.params.extend
                  ? 'Optional — steer how the clip continues, then press send…'
                  : active.params.lipSync
                    ? 'Dialogue goes in the Kling controls above — press send to sync…'
                    : 'Describe what to generate…'
              }
              spellCheck={false}
              style={{
                flex: 1,
                minWidth: 0,
                maxHeight: MAX_INPUT_HEIGHT,
                resize: 'none',
                background: 'transparent',
                color: C.ink,
                border: 'none',
                padding: '8px 2px',
                fontSize: 14,
                lineHeight: 1.5,
                fontFamily: FONT,
                overflowY: 'auto',
              }}
            />

            <button
              type="button"
              className="vpl-btn"
              onClick={send}
              disabled={!canSend}
              title={busy ? 'A run is already generating' : `Run ${active.name}`}
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: canSend ? C.accent : 'transparent',
                color: canSend ? '#FFFFFF' : C.muted,
                border: canSend ? 'none' : `1px solid ${C.line}`,
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              {busy ? <Spinner color={C.muted} /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
