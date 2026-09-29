/**
 * AGENT STUDIO — the single-prompt agentic surface of Script-to-Video.
 * (This file kept its original ModelTester.tsx name so no import path breaks;
 * the component it exports is the Agent Studio.)
 *
 * Type a prompt, pick a Runway model from the card grid, press Generate: the
 * agent answers in a conversation, walks the REAL generation states
 * (analyzing → submitting → generating → processing → ready) and the finished
 * clip appears in the thread with a download button.
 *
 * Nothing here is faked. Every step state comes from an actual event: the
 * capabilities read, the POST /api/generate/runway/video response, and the
 * status Runway reports on GET /api/generate/runway/status/:taskId. A slow or
 * `uncertain` job is polled, never resubmitted — a duplicate submit is a
 * duplicate charge.
 *
 * Model ids come from runwayRoster.ts, which resolves the platform's own
 * spelling from the live capabilities catalog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Circle, CircleDot, Download,
  Loader2, Send, Sparkles, Square, Wand2,
} from 'lucide-react';
import { T } from './api';
import ModelGrid, { ModelGridOption } from './ModelGrid';
import {
  DEFAULT_RUNWAY_MODEL_ID, RW_T2V_RATIOS, RunwayRosterModel, clampRosterDuration,
  rosterDurations, rosterInputLabel, rosterModel, rosterNote, rosterRatio,
  rosterState, submitModelId, subscribeRunwayRoster, syncRunwayRoster,
  textToVideoRoster,
} from './runwayRoster';

type Format = '16:9' | '9:16' | '1:1';
type StepState = 'pending' | 'active' | 'done' | 'failed';

interface Step { key: string; label: string; state: StepState; detail: string }

interface Turn {
  id: string;
  prompt: string;
  modelLabel: string;
  format: Format;
  ratio: string;
  duration: number;
  steps: Step[];
  status: 'running' | 'ready' | 'failed' | 'stopped';
  videoUrl: string;
  error: string;
  startedAt: number;
  finishedAt: number;
}

const FORMATS: { value: Format; label: string; pair: string; hint: string }[] = [
  { value: '16:9', label: 'Widescreen', pair: '1280:720', hint: '1280×720' },
  { value: '9:16', label: 'Vertical', pair: '720:1280', hint: '720×1280' },
  { value: '1:1', label: 'Square', pair: '960:960', hint: '960×960' },
];

const STARTERS = [
  'Slow cinematic push across a matte-black espresso machine as steam curls through warm rim light.',
  'A founder closes her laptop in a glass office at golden hour, city traffic blurred behind her.',
  'Macro shot of rain beading on a running shoe, then the foot pushes off a wet city street.',
];

function newStepList(modelLabel: string): Step[] {
  return [
    { key: 'analyze', label: 'Analyzing your prompt', state: 'active', detail: '' },
    { key: 'submit', label: `Handing the shot to ${modelLabel}`, state: 'pending', detail: '' },
    { key: 'generate', label: 'Generating video', state: 'pending', detail: '' },
    { key: 'process', label: 'Processing and storing the file', state: 'pending', detail: '' },
    { key: 'ready', label: 'Ready to watch', state: 'pending', detail: '' },
  ];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `s2v-studio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function workspaceToken(): Promise<string> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const token = String((window as any).__workspaceDb?.token || '');
    if (token) return token;
    await sleep(200);
  }
  throw new Error('Your workspace session is still loading — wait a moment and press Generate again.');
}

function rawMessage(data: any, fallback: string): string {
  return String(data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || data?.errorMessage || fallback);
}

/** Turn a provider/HTTP failure into something a customer can act on. */
function friendly(status: number, data: any, modelLabel: string): string {
  const raw = rawMessage(data, '');
  const code = String(data?.error?.code || data?.code || '');
  if (status === 400) return `Runway rejected this request for ${modelLabel}: ${raw || 'invalid request'}. Try another model, or shorten the prompt.`;
  if (status === 401) return 'Your workspace session is not ready — refresh the page and try again.';
  if (status === 402 || /insufficient/i.test(raw + code)) return 'The workspace wallet balance is too low for this render. Top it up, then press Generate again.';
  if (status === 409) return 'That exact request is already running — wait for it to finish rather than paying for a duplicate.';
  if (status === 429) return 'Runway is rate-limited right now. Wait a minute and try again.';
  if (status === 503 || /generation_disabled|provider_unavailable/i.test(code)) return raw || 'Runway generation is switched off on the platform right now — try again shortly.';
  return raw || `Runway answered HTTP ${status}.`;
}

function pickVideoUrl(data: any): string {
  const ok = (value: unknown) => typeof value === 'string' && /^https?:\/\//.test(value);
  const direct = [data?.videoUrl, data?.video_url, data?.downloadUrl, data?.url].find(ok);
  if (direct) return String(direct);
  for (const key of ['outputs', 'output', 'media', 'mediaUrls', 'assets', 'videos', 'results']) {
    const list = Array.isArray(data?.[key]) ? data[key] : [];
    for (const item of list) {
      if (ok(item)) return String(item);
      const nested = [item?.url, item?.uri, item?.videoUrl, item?.video_url].find(ok);
      if (nested) return String(nested);
    }
  }
  return '';
}

/** Runway's own status vocabulary, in customer words. */
function statusWords(state: string): string {
  switch (state) {
    case 'admitting': return 'Runway is admitting the job';
    case 'charged': return 'Credits reserved';
    case 'submitting': return 'Handing the shot to the model';
    case 'queued': return 'Queued at the provider';
    case 'running': return 'Rendering frames';
    case 'throttled': return 'Waiting for provider capacity';
    case 'persisting': return 'Writing the finished file to storage';
    case 'uncertain': return 'Runway has not confirmed this job yet — still checking, never resubmitting';
    default: return state ? `Provider status: ${state}` : 'Working';
  }
}

const STUDIO_CSS = `
.s2v-studio-glass { background: linear-gradient(170deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.09); backdrop-filter: blur(14px); }
.s2v-studio-orb { background: conic-gradient(from 140deg, #f59e0b, #7C3AED, #EC4899, #f59e0b); }
.s2v-studio-send:hover:not(:disabled) { filter: brightness(1.08); }
.s2v-studio-chip:hover:not(:disabled) { border-color: rgba(245,158,11,0.55) !important; color: #EDEBE8 !important; }
@keyframes s2v-studio-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.s2v-studio-turn { animation: s2v-studio-in 0.28s ease both; }
`;

function StepRow({ step }: { step: Step }) {
  const color = step.state === 'done' ? T.done : step.state === 'active' ? T.live : step.state === 'failed' ? T.fault : T.dim;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      <span style={{ color, display: 'flex', flexShrink: 0, marginTop: 2 }}>
        {step.state === 'done' ? <Check size={13} />
          : step.state === 'active' ? <Loader2 size={13} className="animate-spin" />
            : step.state === 'failed' ? <AlertTriangle size={13} />
              : <Circle size={11} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ color: step.state === 'pending' ? T.dim : step.state === 'failed' ? T.fault : T.bone, fontSize: 12.5, fontWeight: step.state === 'active' ? 650 : 500 }}>
          {step.label}
        </span>
        {step.detail ? <span style={{ color: T.muted, fontSize: 11.5, marginLeft: 8 }}>{step.detail}</span> : null}
      </span>
    </div>
  );
}

export default function AgentStudio() {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState<string>(() => {
    try { return window.sessionStorage.getItem('s2v:studioModel') || DEFAULT_RUNWAY_MODEL_ID; } catch { return DEFAULT_RUNWAY_MODEL_ID; }
  });
  const [format, setFormat] = useState<Format>('16:9');
  const [duration, setDuration] = useState(5);
  const [gridOpen, setGridOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [generating, setGenerating] = useState(false);
  const [, setCatalogRev] = useState(0);

  const runRef = useRef(0);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Keep the roster live: a model the platform enables becomes selectable here
  // without an app update.
  useEffect(() => {
    void syncRunwayRoster();
    return subscribeRunwayRoster(() => setCatalogRev((n) => n + 1));
  }, []);

  useEffect(() => {
    try { window.sessionStorage.setItem('s2v:studioModel', modelId); } catch { /* preference only */ }
  }, [modelId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const roster = textToVideoRoster();
  const model: RunwayRosterModel | null = rosterModel(modelId) || rosterModel(DEFAULT_RUNWAY_MODEL_ID) || roster[0] || null;

  // A disabled model must never stay selected — fall back to the default.
  useEffect(() => {
    if (model && !model.available) {
      const fallback = roster.find((m) => m.available);
      if (fallback && fallback.id !== model.id) setModelId(fallback.id);
    }
  }, [model?.id, model?.available]);

  const durations = rosterDurations(model);
  useEffect(() => {
    if (durations.indexOf(duration) < 0) setDuration(clampRosterDuration(model?.defaultDurationS ?? 5, model));
  }, [model?.id, durations.join(',')]);

  // Only offer the shapes the chosen model accepts for a text-only prompt —
  // Gen 4.5 text-to-video takes 1280:720 and 720:1280 and answers 400 on any
  // wider pair, so showing Square here would just buy a rejection.
  const allowedRatios = model?.t2vRatios?.length ? model.t2vRatios : RW_T2V_RATIOS;
  const formatChoices = FORMATS.filter((f) => allowedRatios.indexOf(f.pair) >= 0);
  const formats = formatChoices.length ? formatChoices : FORMATS.slice(0, 1);
  useEffect(() => {
    if (!formats.some((f) => f.value === format)) setFormat(formats[0].value);
  }, [model?.id, formats.map((f) => f.value).join(',')]);

  const lockedCount = roster.filter((m) => !m.available).length;

  const options: ModelGridOption[] = useMemo(() => roster.map((m) => ({
    id: m.id,
    label: m.label,
    family: m.family,
    blurb: m.blurb,
    meta: `${rosterInputLabel(m)} · ${m.minDurationS}–${m.maxDurationS}s`,
    badge: m.id === DEFAULT_RUNWAY_MODEL_ID ? 'Default' : m.speed === 'fast' ? 'Fast' : m.speed === 'cinematic' ? 'Cinematic' : '',
    available: m.available,
    unavailableReason: m.unavailableReason,
  })), [roster.map((m) => `${m.id}:${m.available}`).join('|')]);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const patchStep = useCallback((id: string, key: string, patch: Partial<Step>) => {
    setTurns((list) => list.map((t) => (t.id === id
      ? { ...t, steps: t.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }
      : t)));
  }, []);

  const stopRun = useCallback(() => {
    runRef.current += 1;
    setGenerating(false);
    setTurns((list) => list.map((t) => (t.status === 'running'
      ? {
        ...t,
        status: 'stopped',
        finishedAt: Date.now(),
        steps: t.steps.map((s) => (s.state === 'active' ? { ...s, state: 'pending', detail: 'stopped here' } : s)),
        error: 'You stopped watching this render. Runway keeps working on it server-side — nothing was wasted and nothing was resubmitted.',
      }
      : t)));
  }, []);

  async function generate() {
    const clean = prompt.trim();
    if (!clean || generating) return;
    if (!model) return;
    if (clean.length < 10) return;

    const run = runRef.current + 1;
    runRef.current = run;
    const alive = () => runRef.current === run;

    const imageToVideo = false;
    const ratio = rosterRatio(format, model, imageToVideo);
    const seconds = clampRosterDuration(duration, model);
    const id = uuid();
    const turn: Turn = {
      id,
      prompt: clean,
      modelLabel: model.label,
      format,
      ratio,
      duration: seconds,
      steps: newStepList(model.label),
      status: 'running',
      videoUrl: '',
      error: '',
      startedAt: Date.now(),
      finishedAt: 0,
    };
    setTurns((list) => [...list, turn]);
    setPrompt('');
    setGridOpen(false);
    setGenerating(true);

    try {
      // 1 — analyze: confirm the session, refresh the live catalog, resolve the
      // exact model id and the ratio this model accepts in this mode.
      const token = await workspaceToken();
      await syncRunwayRoster();
      if (!alive()) return;
      const live = rosterModel(model.id) || model;
      if (!live.available && rosterState() === 'live') {
        throw new Error(live.unavailableReason || `${live.label} is not enabled on the platform right now — pick another model.`);
      }
      const submitId = submitModelId(live);
      const finalRatio = rosterRatio(format, live, imageToVideo);
      const finalSeconds = clampRosterDuration(seconds, live);
      patchTurn(id, { ratio: finalRatio, duration: finalSeconds });
      patchStep(id, 'analyze', { state: 'done', detail: `${finalRatio} · ${finalSeconds}s · ${submitId}` });
      patchStep(id, 'submit', { state: 'active' });

      // 2 — submit. Text-to-video sends promptText + ratio + duration only; a
      // fresh Idempotency-Key per submit is required by the proxy.
      const submit = await fetch('/api/generate/runway/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-DB-Token': token,
          'Idempotency-Key': uuid(),
        },
        body: JSON.stringify({
          model: submitId,
          promptText: clean.slice(0, 1000),
          ratio: finalRatio,
          duration: finalSeconds,
        }),
      });
      const submitted = await submit.json().catch(() => null);
      if (!alive()) return;
      // A provider timeout comes back as 202 with status 'uncertain' — that is
      // a live job, not a failure.
      if (!submit.ok && submit.status !== 202) throw new Error(friendly(submit.status, submitted, live.label));
      const taskId = String(submitted?.taskId || submitted?.task_id || submitted?.id || '');
      if (!taskId) throw new Error(rawMessage(submitted, 'Runway accepted the request but returned no task id, so there is nothing to poll. Try again.'));
      patchStep(id, 'submit', { state: 'done', detail: `task ${taskId.slice(0, 12)}…` });
      patchStep(id, 'generate', { state: 'active', detail: statusWords(String(submitted?.status || 'queued')) });

      // 3/4 — poll. Only 'succeeded' is success. 'uncertain' and 'persisting'
      // keep polling and are NEVER resubmitted.
      const deadline = Date.now() + 20 * 60 * 1000;
      let processing = false;
      let misses = 0;
      while (Date.now() < deadline) {
        await sleep(3000);
        if (!alive()) return;
        let res: Response | null = null;
        let data: any = null;
        try {
          res = await fetch(`/api/generate/runway/status/${encodeURIComponent(taskId)}`, {
            headers: { 'X-Workspace-DB-Token': await workspaceToken() },
          });
          data = await res.json().catch(() => null);
        } catch {
          misses += 1;
          if (misses >= 8) throw new Error('The connection to Runway kept dropping. The render may still finish — reload and check rather than starting a second one.');
          continue;
        }
        if (!alive()) return;
        if (!res || !res.ok) {
          misses += 1;
          if (misses >= 8) throw new Error(friendly(res ? res.status : 0, data, live.label));
          continue;
        }
        misses = 0;
        const state = String(data?.status || '').toLowerCase();

        if (state === 'succeeded') {
          const url = pickVideoUrl(data);
          patchStep(id, 'generate', { state: 'done', detail: '' });
          if (!url) throw new Error('Runway finished but returned no playable file. Generate again — failed tasks are refunded automatically.');
          patchStep(id, 'process', { state: 'done', detail: '' });
          patchStep(id, 'ready', { state: 'done', detail: '' });
          patchTurn(id, { status: 'ready', videoUrl: url, finishedAt: Date.now() });
          return;
        }
        if (state === 'failed' || state === 'cancelled') {
          throw new Error(`Runway ended this clip ${state}: ${rawMessage(data, 'no successful output')}. Your credits were refunded automatically.`);
        }
        if (state === 'persisting' && !processing) {
          processing = true;
          patchStep(id, 'generate', { state: 'done', detail: '' });
          patchStep(id, 'process', { state: 'active', detail: statusWords(state) });
        } else if (processing) {
          patchStep(id, 'process', { state: 'active', detail: statusWords(state) });
        } else {
          const elapsed = Math.round((Date.now() - turn.startedAt) / 1000);
          patchStep(id, 'generate', { state: 'active', detail: `${statusWords(state)} · ${elapsed}s` });
        }
      }
      throw new Error('This render is taking unusually long. It may still finish at Runway — check back instead of submitting a duplicate.');
    } catch (e: any) {
      if (!alive()) return;
      const message = String(e?.message || e);
      setTurns((list) => list.map((t) => (t.id === id
        ? {
          ...t,
          status: 'failed',
          error: message,
          finishedAt: Date.now(),
          steps: t.steps.map((s) => (s.state === 'active' ? { ...s, state: 'failed' } : s)),
        }
        : t)));
    } finally {
      if (alive()) setGenerating(false);
    }
  }

  const canGenerate = prompt.trim().length >= 10 && !!model && !generating;
  const catalogLine = rosterState() === 'loading' ? 'Reading the live Runway catalog\u2026' : rosterNote();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'radial-gradient(1100px 520px at 50% -10%, rgba(245,158,11,0.09), transparent 70%)' }}>
      <style>{STUDIO_CSS}</style>

      {/* —— Conversation —— */}
      <div ref={threadRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 20px 8px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!turns.length ? (
            <div style={{ textAlign: 'center', padding: '26px 0 6px' }}>
              <div className="s2v-studio-orb" style={{ width: 52, height: 52, borderRadius: '50%', margin: '0 auto 16px', filter: 'blur(0.2px)', boxShadow: '0 0 34px rgba(245,158,11,0.32)' }} />
              <div style={{ color: T.bone, fontSize: 25, fontWeight: 750, letterSpacing: -0.55 }}>What should I film for you?</div>
              <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.6, maxWidth: 520, margin: '9px auto 0' }}>
                Describe one shot in plain language. I pick up your chosen Runway model, submit the render, report every step as it really happens, and hand back the finished clip.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560, margin: '22px auto 0' }}>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="s2v-studio-chip"
                    onClick={() => setPrompt(s)}
                    style={{ textAlign: 'left', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: T.muted, borderRadius: 12, padding: '11px 14px', fontSize: 12.5, lineHeight: 1.5, cursor: 'pointer' }}
                  >
                    <Sparkles size={12} color={T.live} style={{ display: 'inline', marginRight: 8, verticalAlign: '-1px' }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((turn) => (
            <div key={turn.id} className="s2v-studio-turn" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {/* the person */}
              <div style={{ alignSelf: 'flex-end', maxWidth: '86%', background: '#1B2130', color: '#E7EAF1', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '15px 15px 5px 15px', padding: '11px 14px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {turn.prompt}
              </div>

              {/* the agent */}
              <div className="s2v-studio-glass" style={{ borderRadius: 16, padding: '15px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
                  <span className="s2v-studio-orb" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }} />
                  <span style={{ color: T.bone, fontSize: 12.5, fontWeight: 750 }}>Vidverge Director</span>
                  <span style={{ color: T.dim, fontSize: 11 }}>
                    {turn.modelLabel} · {turn.ratio} · {turn.duration}s
                  </span>
                  {turn.status === 'ready' && turn.finishedAt ? (
                    <span style={{ marginLeft: 'auto', color: T.done, fontSize: 11, fontWeight: 700 }}>
                      Done in {Math.max(1, Math.round((turn.finishedAt - turn.startedAt) / 1000))}s
                    </span>
                  ) : null}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {turn.steps.map((step) => <StepRow key={step.key} step={step} />)}
                </div>

                {turn.error ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 13, color: turn.status === 'stopped' ? T.muted : T.fault, fontSize: 12.5, lineHeight: 1.55, background: turn.status === 'stopped' ? 'rgba(255,255,255,0.04)' : 'rgba(226,114,111,0.08)', border: `1px solid ${turn.status === 'stopped' ? 'rgba(255,255,255,0.08)' : 'rgba(226,114,111,0.28)'}`, borderRadius: 10, padding: '10px 13px' }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{turn.error}</span>
                  </div>
                ) : null}

                {turn.videoUrl ? (
                  <div style={{ marginTop: 14 }}>
                    <video
                      key={turn.videoUrl}
                      src={turn.videoUrl}
                      controls
                      playsInline
                      style={{ display: 'block', width: '100%', maxHeight: 460, background: '#000', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 11, flexWrap: 'wrap' }}>
                      <a
                        className="s2v-lift"
                        href={turn.videoUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', borderRadius: 10, padding: '10px 18px', fontSize: 12.5, fontWeight: 750, textDecoration: 'none', boxShadow: '0 2px 12px rgba(245,158,11,0.28)' }}
                      >
                        <Download size={14} /> Download MP4
                      </a>
                      <button
                        type="button"
                        className="s2v-studio-chip"
                        onClick={() => setPrompt(turn.prompt)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 10, padding: '10px 16px', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}
                      >
                        <Wand2 size={13} /> Edit this prompt and try another model
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* —— Composer —— */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(8,12,20,0.86)', padding: '12px 20px 16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {gridOpen ? (
            <div className="s2v-studio-glass" style={{ borderRadius: 16, padding: '14px 15px', marginBottom: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
                <span style={{ color: T.bone, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>Video model</span>
                <span style={{ color: T.dim, fontSize: 11 }}>{catalogLine}</span>
                <button
                  type="button"
                  onClick={() => setGridOpen(false)}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: T.muted, fontSize: 11.5, cursor: 'pointer' }}
                >
                  Collapse <ChevronDown size={13} />
                </button>
              </div>
              <ModelGrid options={options} value={model?.id || ''} onChange={setModelId} disabled={generating} />
              {lockedCount && rosterState() === 'live' ? (
                <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.55, marginTop: 11, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '9px 12px' }}>
                  {lockedCount} of these {roster.length} models are greyed out because the Audos Runway proxy is not listing them yet — submitting one answers “model must be one of: gen4.5, gen4_turbo”. This grid re-reads the platform catalog every time you open it, so each model unlocks by itself the moment Audos enables it. Nothing here needs another app update.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="s2v-studio-glass" style={{ borderRadius: 18, padding: '12px 13px 11px' }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}
              rows={3}
              placeholder="Describe the shot — subject, action, setting, camera move, light and mood."
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: T.bone, fontSize: 14, lineHeight: 1.6, resize: 'none', fontFamily: T.sans, padding: '2px 4px 8px' }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="s2v-studio-chip"
                onClick={() => setGridOpen((open) => !open)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(245,158,11,0.10)', border: `1px solid ${T.live}`, color: T.bone, borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <Sparkles size={12} color={T.live} />
                {model?.label || 'Choose a model'}
                {gridOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>

              <div style={{ display: 'inline-flex', gap: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: 3 }}>
                {formats.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    title={`${f.label} — ${f.hint}`}
                    onClick={() => setFormat(f.value)}
                    style={{ background: format === f.value ? T.bone : 'transparent', color: format === f.value ? T.canvas : T.muted, border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'inline-flex', gap: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: 3 }}>
                {durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    title={`${d}-second clip`}
                    onClick={() => setDuration(d)}
                    style={{ background: duration === d ? T.bone : 'transparent', color: duration === d ? T.canvas : T.muted, border: 'none', borderRadius: 999, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {d}s
                  </button>
                ))}
              </div>

              {generating ? (
                <button
                  type="button"
                  onClick={stopRun}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.06)', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  <Square size={13} /> Stop watching
                </button>
              ) : (
                <button
                  type="button"
                  className="s2v-studio-send s2v-lift"
                  disabled={!canGenerate}
                  onClick={() => void generate()}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, background: canGenerate ? T.live : 'rgba(255,255,255,0.05)', color: canGenerate ? '#1A1205' : T.dim, border: 'none', borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 800, cursor: canGenerate ? 'pointer' : 'default', boxShadow: canGenerate ? '0 2px 14px rgba(245,158,11,0.3)' : 'none' }}
                >
                  <Send size={14} /> Generate video
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, color: T.dim, fontSize: 11 }}>
            <CircleDot size={10} color={generating ? T.live : T.dim} />
            <span>
              {generating
                ? 'Rendering — you can keep this open; a slow job is polled, never resubmitted.'
                : prompt.trim().length > 0 && prompt.trim().length < 10
                  ? 'Add a little more detail — at least 10 characters so the model has something to work with.'
                  : `⌘/Ctrl + Enter to generate · ${catalogLine}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
