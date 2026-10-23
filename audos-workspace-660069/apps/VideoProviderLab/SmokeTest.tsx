/**
 * VIDEO PROVIDER LAB — "Run All Tests" API smoke harness.
 *
 * One button that walks every entry in the lab catalog, sends the SMALLEST
 * legal generation each endpoint accepts, and reads the outcome into a table:
 * which model, which plugin, which endpoint, pass or fail, how long it took,
 * the exact error text, and a link to whatever came back.
 *
 * It reuses the lab's own runners (./labClient) rather than re-implementing
 * the request shapes, so a test exercises the same code path a real run does
 * — a green row here means the app's own client works against that provider,
 * not just that some hand-written probe does.
 *
 * THIS SPENDS THE WALLET. Every accepted submit is a real paid generation, so
 * the run is behind an explicit confirm that names the count, each test sends
 * the shortest duration and lowest resolution the endpoint allows with audio
 * off, and polling is capped well below the lab's normal ceiling: a model that
 * is still rendering at the cap is reported as 'slow', not as a failure, and
 * the provider keeps going.
 *
 * No key, environment variable or BYOK secret is read here. Every request goes
 * through labClient to a same-origin /api path carrying only
 * X-Workspace-DB-Token, exactly like a normal run.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCopy, Clock, MinusCircle, Play, Square, XCircle,
} from 'lucide-react';

import {
  LAB_MODELS,
  LAB_VERIFIED_AT,
  defaultRunInput,
  describeRunBlock,
  effectiveRunInput,
  labVerified,
} from './labModels';
import type { LabModel, LabRunInput } from './labModels';
import { CANCELLED, describeError, errorText, runLabModel } from './labClient';
import type { RunContext } from './labClient';

// ---------------------------------------------------------------------------
// Test parameters
// ---------------------------------------------------------------------------

/** Short, neutral, and over every endpoint's 10-character floor. */
const SMOKE_PROMPT = 'A red ball bouncing on a white floor.';

/**
 * How long one model is polled before the harness stops waiting. The lab's own
 * ceilings run to eight minutes, which would make a full sweep unreadable; a
 * model still working at this point is recorded as 'slow' with its job left
 * running, which is the honest answer rather than a false failure.
 */
const SMOKE_CAP_MS = 150000;

/** Concurrent tests. Enough to keep a sweep short, low enough that a provider
 *  rate limit is not what the table ends up measuring. */
const LANES = 3;

const C = {
  bg: '#0D0B05',
  card: '#15120A',
  raised: '#1C1808',
  line: 'rgba(245,158,11,0.18)',
  lineStrong: 'rgba(245,158,11,0.45)',
  accent: '#f59e0b',
  ink: '#fffaf1',
  soft: '#e6d9c9',
  muted: '#bba899',
  good: '#10b981',
  bad: '#ef4444',
  warn: '#f59e0b',
  info: '#22d3ee',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type TestState = 'idle' | 'running' | 'pass' | 'fail' | 'slow' | 'skipped';

interface TestRow {
  key: string;
  name: string;
  provider: string;
  plugins: string[];
  endpoint: string;
  state: TestState;
  ms: number;
  note: string;
  error: string;
  videoUrl: string;
}

const STATE_LOOK: Record<TestState, { label: string; color: string; Icon: ComponentType<any> }> = {
  idle: { label: 'Not run', color: C.muted, Icon: MinusCircle },
  running: { label: 'Running', color: C.accent, Icon: Clock },
  pass: { label: 'Working', color: C.good, Icon: CheckCircle2 },
  fail: { label: 'Failed', color: C.bad, Icon: XCircle },
  slow: { label: 'Still rendering', color: C.info, Icon: Clock },
  skipped: { label: 'Not callable', color: C.warn, Icon: AlertTriangle },
};

const VERIFIED_COLOR: Record<string, string> = {
  pass: C.good,
  fail: C.bad,
  inconclusive: C.info,
  'no-endpoint': C.muted,
};

function seedRow(model: LabModel): TestRow {
  return {
    key: model.key,
    name: model.name,
    provider: model.provider,
    plugins: model.plugins.slice(),
    endpoint: model.submitPath,
    state: 'idle',
    ms: 0,
    note: '',
    error: '',
    videoUrl: '',
  };
}

/**
 * The cheapest request this entry accepts. defaultRunInput already picks the
 * first (shortest) duration and the lowest resolution each model declares, so
 * this only has to force audio off and attach the generated test still to the
 * endpoints that cannot run without one.
 */
function smokeInput(model: LabModel, testImage: string): LabRunInput {
  const base = defaultRunInput(model, SMOKE_PROMPT);
  const needsImage = model.image === 'required';
  return effectiveRunInput(model, {
    ...base,
    prompt: SMOKE_PROMPT,
    duration: model.params.durationMin ?? model.params.durations[0] ?? base.duration,
    audio: false,
    images: needsImage && testImage ? [testImage] : [],
  });
}

/**
 * A red ball on white, drawn in the browser. It costs nothing, needs no
 * network, and matches the prompt — so an image-to-video model is asked to
 * animate the same subject every other model is asked to imagine.
 */
function drawTestImage(): string {
  if (typeof document === 'undefined') return '';
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size * 0.42, size * 0.4, size * 0.04, size * 0.5, size * 0.5, size * 0.3);
  gradient.addColorStop(0, '#ff8a80');
  gradient.addColorStop(1, '#c62828');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.8, size * 0.24, size * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}

/** The poller's timeout message is not a provider failure — the job is still
 *  running and may well land. Treat it as its own outcome. */
function isStillRendering(message: string): boolean {
  return /still (rendering|working)/i.test(message);
}

function formatMs(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function SmokeTestPanel() {
  const [rows, setRows] = useState<Record<string, TestRow>>({});
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState('');
  const [open, setOpen] = useState(false);

  // A run is cancelled by flipping this, not by unmounting: each lane checks
  // it between models and each live poll is cancelled through its own handle.
  const abort = useRef(false);
  const cancels = useRef<Array<() => void>>([]);

  /** Entries the lab will actually call. An unavailable entry is recorded as
   *  'Not callable' with its reason rather than quietly dropped — the point of
   *  the sweep is a complete picture. */
  const testable = useMemo(() => LAB_MODELS.filter((model) => model.available), []);
  const untestable = useMemo(() => LAB_MODELS.filter((model) => !model.available), []);

  const patch = useCallback((key: string, next: Partial<TestRow>) => {
    setRows((prev) => ({ ...prev, [key]: { ...(prev[key] || seedRow(labModelByKey(key))), ...next } }));
  }, []);

  const runOne = useCallback(async (model: LabModel, testImage: string) => {
    const started = Date.now();
    patch(model.key, { ...seedRow(model), state: 'running', note: 'Submitting…' });

    const input = smokeInput(model, testImage);
    const block = describeRunBlock(model, input);
    if (block) {
      patch(model.key, { ...seedRow(model), state: 'skipped', error: block });
      return;
    }

    const tried: string[] = [];
    const ctx: RunContext = {
      note: (note) => patch(model.key, { note }),
      tried: (path) => { if (tried.indexOf(path) === -1) tried.push(path); },
      register: (cancel) => { cancels.current.push(cancel); },
    };

    try {
      // The lab's normal ceiling would make a full sweep take most of an hour,
      // so this run gets a shorter leash. Nothing else about the model changes.
      const capped: LabModel = { ...model, capMs: Math.min(model.capMs, SMOKE_CAP_MS) };
      const result = await runLabModel(capped, input, ctx);
      patch(model.key, {
        ...seedRow(model),
        state: 'pass',
        ms: Date.now() - started,
        videoUrl: result.videoUrl,
        note: result.modelUsed ? `Returned by ${result.modelUsed}` : 'Returned a playable file.',
      });
    } catch (error) {
      const message = errorText(error);
      if (message === CANCELLED) {
        patch(model.key, { ...seedRow(model), state: 'idle', ms: Date.now() - started, note: 'Stopped before it finished.' });
        return;
      }
      patch(model.key, {
        ...seedRow(model),
        state: isStillRendering(message) ? 'slow' : 'fail',
        ms: Date.now() - started,
        error: describeError(error, tried),
      });
    }
  }, [patch]);

  const runAll = useCallback(async (models: LabModel[]) => {
    if (!models.length) return;
    setConfirming(false);
    setRunning(true);
    abort.current = false;
    cancels.current = [];

    // Unavailable entries never reach the network; they are stamped up front so
    // the table is complete from the first paint.
    setRows((prev) => {
      const next = { ...prev };
      untestable.forEach((model) => {
        next[model.key] = {
          ...seedRow(model),
          state: 'skipped',
          error: model.unavailableReason || `${model.name} has no endpoint on this platform.`,
        };
      });
      models.forEach((model) => { next[model.key] = { ...seedRow(model), state: 'running', note: 'Queued…' }; });
      return next;
    });

    const testImage = drawTestImage();
    const queue = models.slice();

    const lane = async (): Promise<void> => {
      while (!abort.current) {
        const model = queue.shift();
        if (!model) return;
        await runOne(model, testImage);
      }
    };

    const lanes: Promise<void>[] = [];
    const width = Math.min(LANES, queue.length);
    for (let index = 0; index < width; index += 1) lanes.push(lane());

    await Promise.all(lanes);
    setRunning(false);
  }, [runOne, untestable]);

  const stop = useCallback(() => {
    abort.current = true;
    cancels.current.forEach((cancel) => { try { cancel(); } catch { /* already settled */ } });
    cancels.current = [];
    setRunning(false);
  }, []);

  const ordered = useMemo(() => {
    const list: TestRow[] = [];
    LAB_MODELS.forEach((model) => {
      const row = rows[model.key];
      if (row) list.push(row);
    });
    return list;
  }, [rows]);

  const tally = useMemo(() => {
    const counts = { pass: 0, fail: 0, slow: 0, skipped: 0, running: 0 };
    ordered.forEach((row) => {
      if (row.state === 'pass') counts.pass += 1;
      else if (row.state === 'fail') counts.fail += 1;
      else if (row.state === 'slow') counts.slow += 1;
      else if (row.state === 'skipped') counts.skipped += 1;
      else if (row.state === 'running') counts.running += 1;
    });
    return counts;
  }, [ordered]);

  const failures = useMemo(() => ordered.filter((row) => row.state === 'fail'), [ordered]);

  /**
   * There is no support-ticket API on this platform — /api/workspaces/:id/tickets
   * and every neighbouring path answer 404 — so the honest substitute is a
   * report the founder can paste wherever they actually raise issues.
   */
  const copyReport = useCallback(async () => {
    if (!failures.length) return;
    const lines: string[] = [
      'Video model API failures — Vidverge',
      `Captured: ${new Date().toISOString()}`,
      '',
    ];
    failures.forEach((row) => {
      lines.push(`✖ ${row.name} (${row.provider})`);
      lines.push(`  Endpoint: ${row.endpoint}`);
      lines.push(`  Plugin:   ${row.plugins.join(', ') || 'none'}`);
      lines.push(`  Error:    ${row.error.replace(/\s+/g, ' ').trim()}`);
      lines.push('');
    });
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied a report for ${failures.length} failing model${failures.length === 1 ? '' : 's'}.`);
    } catch {
      setCopied('Could not reach the clipboard — select the error text in the table instead.');
    }
    window.setTimeout(() => setCopied(''), 6000);
  }, [failures]);

  const retryFailures = useCallback(() => {
    const keys = failures.map((row) => row.key);
    const models = LAB_MODELS.filter((model) => model.available && keys.indexOf(model.key) >= 0);
    void runAll(models);
  }, [failures, runAll]);

  return (
    <div
      style={{
        marginTop: 16,
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: -0.1 }}>
            API smoke test — every model, one minimal call each
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.soft, lineHeight: 1.6, maxWidth: 880 }}>
            {`Sends the shortest, lowest-resolution clip each endpoint accepts, with audio off and the prompt “${SMOKE_PROMPT}”, then reports exactly what came back. Image-to-video models get a generated red-ball still so they can run too. Results below carry the live outcome; the grey chip is what the last full sweep found on ${LAB_VERIFIED_AT}.`}
          </p>
        </div>
        <button
          type="button"
          className="vpl-btn"
          onClick={() => setOpen((value) => !value)}
          style={{
            background: 'transparent',
            color: C.soft,
            border: `1px solid ${C.lineStrong}`,
            borderRadius: 9,
            padding: '7px 13px',
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: 'pointer',
          }}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            {running ? (
              <button
                type="button"
                className="vpl-btn"
                onClick={stop}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'transparent', color: C.soft,
                  border: `1px solid ${C.lineStrong}`, borderRadius: 9,
                  padding: '9px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
                }}
              >
                <Square size={13} /> Stop the sweep
              </button>
            ) : (
              <button
                type="button"
                className="vpl-btn"
                onClick={() => setConfirming(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: C.accent, color: '#0a0a0a', border: 'none', borderRadius: 9,
                  padding: '9px 16px', fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
                }}
              >
                <Play size={14} /> Run all tests ({testable.length})
              </button>
            )}

            {!running && failures.length ? (
              <button
                type="button"
                className="vpl-btn"
                onClick={retryFailures}
                style={{
                  background: 'transparent', color: C.soft,
                  border: `1px solid ${C.lineStrong}`, borderRadius: 9,
                  padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                }}
              >
                {`Re-run ${failures.length} failure${failures.length === 1 ? '' : 's'}`}
              </button>
            ) : null}

            {failures.length ? (
              <button
                type="button"
                className="vpl-btn"
                onClick={() => { void copyReport(); }}
                title="This platform exposes no support-ticket API, so the failures are copied as text you can paste wherever you raise issues."
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'transparent', color: C.soft,
                  border: `1px solid ${C.lineStrong}`, borderRadius: 9,
                  padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                }}
              >
                <ClipboardCopy size={13} /> Copy failure report
              </button>
            ) : null}
          </div>

          {confirming ? (
            <div
              style={{
                marginTop: 12,
                background: C.raised,
                border: `1px solid ${C.lineStrong}`,
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 12.5, color: C.soft, lineHeight: 1.6 }}>
                {`This submits ${testable.length} real generations and bills the workspace wallet. Each one is the cheapest clip its endpoint allows, but it is not free — a full sweep is on the order of a few dollars. Models that reject the request cost nothing.`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="vpl-btn"
                  onClick={() => { void runAll(testable); }}
                  style={{
                    background: C.accent, color: '#0a0a0a', border: 'none', borderRadius: 8,
                    padding: '7px 14px', fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
                  }}
                >
                  Yes, run them
                </button>
                <button
                  type="button"
                  className="vpl-btn"
                  onClick={() => setConfirming(false)}
                  style={{
                    background: 'transparent', color: C.soft,
                    border: `1px solid ${C.lineStrong}`, borderRadius: 8,
                    padding: '7px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {copied ? (
            <div style={{ marginTop: 10, fontSize: 12, color: C.info }}>{copied}</div>
          ) : null}

          {ordered.length ? (
            <>
              {/* Summary */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <Tally color={C.good} label="Working" value={tally.pass} />
                <Tally color={C.bad} label="Failed" value={tally.fail} />
                <Tally color={C.info} label="Still rendering" value={tally.slow} />
                <Tally color={C.warn} label="Not callable" value={tally.skipped} />
                {tally.running ? <Tally color={C.accent} label="Running" value={tally.running} /> : null}
              </div>

              {/* Results table */}
              <div className="vpl-scroll" style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 920 }}>
                  <thead>
                    <tr>
                      {['Result', 'Model', 'Endpoint', 'Time', 'Detail', `Sweep ${LAB_VERIFIED_AT}`].map((head) => (
                        <th
                          key={head}
                          style={{
                            textAlign: 'left',
                            padding: '8px 10px',
                            borderBottom: `1px solid ${C.lineStrong}`,
                            color: C.muted,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: 0.7,
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((row) => {
                      const look = STATE_LOOK[row.state];
                      const verified = labVerified(row.key);
                      return (
                        <tr key={row.key} style={{ borderBottom: `1px solid ${C.line}` }}>
                          <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: look.color, fontWeight: 700 }}>
                              <look.Icon size={13} />
                              {look.label}
                            </span>
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <div style={{ color: C.ink, fontWeight: 600 }}>{row.name}</div>
                            <div style={{ color: C.muted, fontSize: 10.5, marginTop: 2 }}>{row.provider}</div>
                            <div style={{ color: C.muted, fontSize: 10, fontFamily: MONO, marginTop: 2 }}>
                              {row.plugins.join(' · ') || 'no plugin'}
                            </div>
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top', fontFamily: MONO, fontSize: 10.5, color: C.soft }}>
                            {row.endpoint}
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top', fontFamily: MONO, color: C.soft, whiteSpace: 'nowrap' }}>
                            {formatMs(row.ms)}
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top', color: C.soft, lineHeight: 1.55, maxWidth: 420 }}>
                            {row.error ? <span style={{ color: C.bad }}>{row.error}</span> : row.note || '—'}
                            {row.videoUrl ? (
                              <div style={{ marginTop: 5 }}>
                                <a
                                  href={row.videoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: C.accent, fontSize: 11.5 }}
                                >
                                  Open the clip
                                </a>
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top', maxWidth: 260 }}>
                            {verified ? (
                              <span style={{ color: VERIFIED_COLOR[verified.outcome] || C.muted, fontSize: 11, lineHeight: 1.5 }}>
                                <strong>{verified.outcome}</strong>
                                {` — ${verified.note}`}
                              </span>
                            ) : (
                              <span style={{ color: C.muted, fontSize: 11 }}>not in the last sweep</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {failures.length ? (
                <p style={{ margin: '12px 0 0', fontSize: 11.5, color: C.muted, lineHeight: 1.65 }}>
                  This platform publishes no support-ticket API — <code style={{ fontFamily: MONO }}>/api/workspaces/:id/tickets</code>{' '}
                  and its neighbours all answer 404 — so failures cannot be filed automatically. Use{' '}
                  <strong>Copy failure report</strong> above and send it wherever you raise platform issues.
                </p>
              ) : null}
            </>
          ) : (
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: C.muted, lineHeight: 1.65 }}>
              {`Nothing has been tested in this session yet. The last full sweep ran on ${LAB_VERIFIED_AT} — press Run all tests to re-check every provider live.`}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function Tally({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 7,
        background: `${color}14`,
        border: `1px solid ${color}44`,
        borderRadius: 9,
        padding: '6px 12px',
      }}
    >
      <strong style={{ color, fontSize: 16, fontWeight: 800 }}>{value}</strong>
      <span style={{ color: C.soft, fontSize: 11.5 }}>{label}</span>
    </span>
  );
}

/** Rows are keyed by lab key, so a patch arriving for a model the table has
 *  not seeded yet can still build a complete row. */
function labModelByKey(key: string): LabModel {
  const found = LAB_MODELS.find((model) => model.key === key);
  if (found) return found;
  return LAB_MODELS[0];
}

export default SmokeTestPanel;
