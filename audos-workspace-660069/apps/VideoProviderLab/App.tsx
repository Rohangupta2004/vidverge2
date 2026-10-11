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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Download, FileText, Film, Music, Paperclip, Send, X,
} from 'lucide-react';

import {
  DEFAULT_LAB_MODEL_KEY,
  LAB_GROUPS,
  LAB_MODELS,
  defaultRunInput,
  effectiveRunInput,
  labModel,
  retargetRunInput,
} from './labModels';
import type { LabModel, LabRunInput } from './labModels';
import {
  CANCELLED,
  MAX_IMAGE_BYTES,
  describeError,
  errorText,
  readImageFile,
  runLabModel,
  workspaceId,
  workspaceToken,
} from './labClient';
import type { RunContext, RunResult } from './labClient';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import AppShell from '../../components/ui/AppShell';

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const C = {
  bg: '#FFFDF4',
  card: '#FFFFFF',
  raised: '#FFFAEB',
  line: 'rgba(180,120,0,0.14)',
  lineStrong: 'rgba(180,120,0,0.36)',
  accent: '#C8920A',
  accentSurface: 'rgba(200,146,10,0.10)',
  ink: '#1A1000',
  soft: '#3D2800',
  muted: '#7A6030',
  good: '#166534',
  bad: '#991B1B',
  warn: '#B45309',
  headerBg: '#1A1000',
  headerText: '#FFF8E8',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
}

type ChatMessage = UserMessage | RunMessage;

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
      '.vpl-turn { animation: vpl-rise 180ms ease both; }',
      '.vpl-scroll::-webkit-scrollbar { height: 6px; width: 6px; }',
      '.vpl-scroll::-webkit-scrollbar-thumb { background: rgba(180,120,0,0.35); border-radius: 99px; }',
      '.vpl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(180,120,0,0.65); }',
      '.vpl-scroll::-webkit-scrollbar-track { background: #FFF9E8; }',
      '.vpl-input:focus { outline: none; }',
      '.vpl-select:focus { outline: none; border-color: rgba(200,146,10,0.7); box-shadow: 0 0 0 3px rgba(200,146,10,0.22); }',
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

export default function App() {
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

  const mounted = useRef(true);
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
  }, [patchRun, pushMessage, seedRun]);

  const send = useCallback(() => {
    if (busy) return;
    const text = prompt.trim();
    if (!text && !pending.length) return;

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

    pushMessage({ kind: 'user', id: messageId('you'), text, attachments: pending });
    setPrompt('');
    setPending([]);
    setAttachNotice('');
    launch(model, (ctx) => runLabModel(model, runInput, ctx));
  }, [active, busy, input, launch, pending, prompt, pushMessage]);

  // -------------------------------------------------------------------------
  // Surface
  // -------------------------------------------------------------------------

  const hasToken = Boolean(workspaceToken());
  const spaceWorkspaceId = workspaceId();
  const credentialWarning = !hasToken
    ? 'no workspace credential — reload the space'
    : !spaceWorkspaceId ? 'no workspaceId — the HeyGen entries cannot build their proxy path' : '';
  const canSend = !busy && Boolean(prompt.trim() || pending.length);

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
          height: '100dvh',
          minHeight: 0,
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
            gap: 12,
            padding: '0 16px',
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
          <select
            className="vpl-select"
            value={activeKey}
            onChange={(event) => selectModel(event.target.value)}
            title={`${active.provider} · ${active.costHint}`}
            style={{
              marginLeft: 'auto',
              background: '#2A1E00',
              color: C.headerText,
              border: '1px solid rgba(200,146,10,0.4)',
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 12.5,
              fontFamily: FONT,
              maxWidth: 320,
              minWidth: 0,
              cursor: 'pointer',
            }}
          >
            {LAB_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {LAB_MODELS.filter((model) => model.group === group.id).map((model) => (
                  <option
                    key={model.key}
                    value={model.key}
                    disabled={!model.available}
                    style={{
                      color: model.available ? C.headerText : 'rgba(255,248,232,0.5)',
                      background: '#2A1E00',
                    }}
                  >
                    {model.available ? model.name : `${model.name} — unavailable`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Row 2 — conversation */}
        <div
          ref={scrollRef}
          className="vpl-scroll"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '18px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            background: C.bg,
          }}
        >
          {!messages.length ? (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.soft }}>Describe a shot to generate it</div>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
                {`${active.name} is selected. Attach reference images or a source clip with the paperclip — every run goes through the Audos proxy and bills the workspace wallet.`}
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
                          border: '1px solid rgba(200,146,10,0.35)',
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
                        background: 'rgba(153,27,27,0.06)',
                        border: '1px solid rgba(153,27,27,0.25)',
                        borderRadius: 9,
                        padding: '9px 11px',
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      <AlertCircle size={14} color={C.bad} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div
                        style={{
                          fontSize: 11.5,
                          color: '#991B1B',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: MONO,
                        }}
                      >
                        {message.error}
                      </div>
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
        </div>

        {/* Row 3 — input */}
        <div
          style={{
            flexShrink: 0,
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
                width: 36,
                height: 36,
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
              placeholder="Describe what to generate…"
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
                width: 36,
                height: 36,
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
