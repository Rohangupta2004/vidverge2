/**
 * HEALTH — the owner-only diagnostic screen for the video and audio providers.
 *
 * WHY THIS EXISTS. Model availability used to live in a hand-written table in
 * lib/videoEngines.ts: one paid sweep's verdict, frozen into source, read by
 * every picker in the product as if it were current. That is how the whole
 * Kling 2.x / 3.x roster stayed greyed out while it was live. The verdicts are
 * gone from that file, and this screen replaces them — it asks the live
 * endpoints when you open it, and reports exactly what they said.
 *
 * IT GENERATES NOTHING. Every probe here is a catalog read or a free quote:
 * no clip is rendered, no wallet is charged, nothing is written. That is the
 * whole design constraint — a health check that costs money is a health check
 * nobody runs.
 *
 * (Phase 2 will put the same probes behind a server function so other surfaces
 * can read the result without this lab being open.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, X } from 'lucide-react';

import { workspaceToken } from './labClient';
import { COLORS, alpha } from '../../components/theme';

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** A probe that has not answered inside this is reported as a timeout rather
 * than left spinning — the point of the screen is a verdict. */
const PROBE_TIMEOUT_MS = 15000;

export interface HealthRow {
  key: string;
  /** Which provider family the row belongs to, for grouping. */
  group: string;
  /** The model id, or the endpoint when the row is a catalog read. */
  id: string;
  ok: boolean | null;
  status: number | null;
  latencyMs: number | null;
  detail: string;
}

interface Probe {
  key: string;
  group: string;
  id: string;
  /** What the probe does, shown on the row so nobody has to guess. */
  what: string;
  run: (headers: Record<string, string>) => Promise<Response>;
}

function authHeaders(): Record<string, string> {
  const token = workspaceToken();
  return token ? { 'X-Workspace-DB-Token': token } : {};
}

function spaceAppId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  const w = window as unknown as { __APP_ID__?: string; __SPACE_ID__?: string };
  return String(w.__APP_ID__ || w.__SPACE_ID__ || 'workspace-660069');
}

async function withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * The probe set.
 *
 * Every one is documented as free: `/api/voices` and the music presets are the
 * public catalogs, the Kling and Runway catalogs are public discovery reads,
 * and the Runway quote is explicitly a free unauthenticated price check. The
 * workspace capabilities hook is this workspace's own cross-provider
 * availability read.
 */
const PROBES: Probe[] = [
  {
    key: 'voices',
    group: 'ElevenLabs',
    id: 'GET /api/voices',
    what: 'The voice catalog the narration pipeline picks from. An empty list means narration would fail.',
    run: () => withTimeout((signal) => fetch('/api/voices', { signal })),
  },
  {
    key: 'music-presets',
    group: 'ElevenLabs',
    id: 'GET /api/audio/music/presets',
    what: 'The music-bed presets. A failure here is why a film can end up silent.',
    run: () => withTimeout((signal) => fetch('/api/audio/music/presets', { signal })),
  },
  {
    key: 'kling-models',
    group: 'Kling',
    id: 'GET /api/generate/kling/models',
    what: 'Kling\u2019s model contract catalog. A CONTRACT, not proof of generation — it lists ids and prices, and it answers even when the provider account cannot render.',
    run: (headers) => withTimeout((signal) => fetch('/api/generate/kling/models', { headers, signal })),
  },
  {
    key: 'runway-capabilities',
    group: 'Runway',
    id: 'GET /api/generate/runway/capabilities',
    what: 'Which Runway models the proxy actually accepts right now. This is the roster the pickers sync from.',
    run: (headers) => withTimeout((signal) => fetch('/api/generate/runway/capabilities', { headers, signal })),
  },
  {
    key: 'runway-quote',
    group: 'Runway',
    id: 'POST /api/generate/runway/quote',
    what: 'A free price quote for a 5s Gen 4.5 clip. The closest thing to a real submit that costs nothing.',
    run: (headers) => withTimeout((signal) => fetch('/api/generate/runway/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'gen4.5', mode: 'text-to-video', ratio: '1280:720', duration: 5 }),
      signal,
    })),
  },
  {
    key: 'media-capabilities',
    group: 'Workspace',
    id: 'vv-media-capabilities',
    what: 'This workspace\u2019s own cross-provider availability read.',
    run: (headers) => withTimeout((signal) => fetch(`/api/hooks/execute/${spaceAppId()}/vv-media-capabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
      signal,
    })),
  },
];

/** Unwrap the hook runner's { response, _meta } envelope when it is present. */
function unwrap(raw: unknown): any {
  const value = raw as Record<string, unknown> | null;
  if (value && typeof value === 'object' && value.response !== undefined && value._meta !== undefined) {
    return value.response;
  }
  return value;
}

/** One readable line about what a successful probe actually returned. */
function summarize(key: string, body: any): string {
  if (!body || typeof body !== 'object') return 'Answered, but with no readable body.';
  if (key === 'voices') {
    const voices = Array.isArray(body.voices) ? body.voices : [];
    return voices.length
      ? `${voices.length} voices reachable (first: ${String(voices[0]?.name || voices[0]?.id || '?')}).`
      : 'Answered OK but listed NO voices — narration would fail on this account.';
  }
  if (key === 'music-presets') {
    const presets = Array.isArray(body.presets) ? body.presets : Array.isArray(body) ? body : [];
    return presets.length ? `${presets.length} music presets available.` : 'Answered OK but listed no presets.';
  }
  if (key === 'kling-models') {
    const models = Array.isArray(body.models) ? body.models : [];
    const ids = models.map((m: any) => String(m?.id || m?.model || m)).filter(Boolean);
    return ids.length ? `${ids.length} ids catalogued: ${ids.join(', ')}` : 'Answered OK but catalogued no models.';
  }
  if (key === 'runway-capabilities') {
    const models = Array.isArray(body.models) ? body.models : [];
    const ids = models.map((m: any) => String(m?.id || m?.model || m)).filter(Boolean);
    return ids.length ? `Live models: ${ids.join(', ')}` : 'Answered OK but listed no live models.';
  }
  if (key === 'runway-quote') {
    const credits = body.credits ?? body.price ?? body.total ?? null;
    return credits === null ? 'Quoted successfully.' : `Quoted ${String(credits)} credits for a 5s Gen 4.5 clip.`;
  }
  const keys = Object.keys(body).slice(0, 8);
  return keys.length ? `Answered with: ${keys.join(', ')}` : 'Answered OK.';
}

function errorLine(body: any, status: number): string {
  const text = body && typeof body === 'object'
    ? String(body.error || body.message || body.code || '')
    : '';
  if (status === 401) return `HTTP 401 — the workspace session is not signing these calls. ${text}`.trim();
  if (status === 402) return `HTTP 402 — the workspace wallet is empty. ${text}`.trim();
  if (status === 403) return `HTTP 403 — this session is not entitled to that endpoint. ${text}`.trim();
  if (status === 404) return `HTTP 404 — the platform does not serve that path. ${text}`.trim();
  if (status === 429) return `HTTP 429 — rate limited. ${text}`.trim();
  if (status === 503) return `HTTP 503 — the provider credential is unavailable platform-side. ${text}`.trim();
  return `HTTP ${status}${text ? ` — ${text}` : ''}`;
}

async function runProbe(probe: Probe): Promise<HealthRow> {
  const started = Date.now();
  const base = { key: probe.key, group: probe.group, id: probe.id };
  try {
    const response = await probe.run(authHeaders());
    const latencyMs = Date.now() - started;
    const body = unwrap(await response.json().catch(() => null));
    if (!response.ok) {
      return { ...base, ok: false, status: response.status, latencyMs, detail: errorLine(body, response.status) };
    }
    return { ...base, ok: true, status: response.status, latencyMs, detail: summarize(probe.key, body) };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    const aborted = /abort/i.test(message);
    return {
      ...base,
      ok: false,
      status: null,
      latencyMs,
      detail: aborted
        ? `No answer within ${Math.round(PROBE_TIMEOUT_MS / 1000)}s — treat it as down.`
        : `The request never completed: ${message}`,
    };
  }
}

function StatusPill({ ok }: { ok: boolean | null }) {
  const color = ok === null ? COLORS.textFaint : ok ? COLORS.success : COLORS.error;
  const label = ok === null ? 'Checking' : ok ? 'OK' : 'Error';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color,
        background: alpha(color, 0.12),
        border: `1px solid ${alpha(color, 0.35)}`,
        borderRadius: 999,
        padding: '2px 9px',
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {ok === null ? <Activity size={11} /> : ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {label}
    </span>
  );
}

export default function HealthPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const check = useCallback(async () => {
    setRunning(true);
    setRows(PROBES.map((probe) => ({
      key: probe.key, group: probe.group, id: probe.id, ok: null, status: null, latencyMs: null, detail: 'Checking…',
    })));
    // Probes run in parallel: they are independent reads, and one slow
    // provider must not decide how long the whole screen takes.
    const results = await Promise.all(PROBES.map(runProbe));
    if (!mounted.current) return;
    setRows(results);
    setRanAt(Date.now());
    setRunning(false);
  }, []);

  useEffect(() => { void check(); }, [check]);

  const hasToken = Boolean(workspaceToken());
  const groups = Array.from(new Set(PROBES.map((probe) => probe.group)));
  const failures = rows.filter((row) => row.ok === false).length;

  const cell: CSSProperties = {
    padding: '9px 10px',
    borderBottom: `1px solid ${COLORS.border}`,
    fontSize: 12,
    verticalAlign: 'top',
    textAlign: 'left',
  };

  return (
    <div
      className="vpl-scroll"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        padding: '18px 16px 28px',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>Provider health</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: COLORS.warning,
                background: alpha(COLORS.warning, 0.12),
                border: `1px solid ${alpha(COLORS.warning, 0.35)}`,
                borderRadius: 999,
                padding: '2px 9px',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              <ShieldAlert size={11} /> Owner only
            </span>
          </div>
          <p style={{ margin: '7px 0 0', fontSize: 12.5, color: COLORS.textMuted, lineHeight: 1.65, maxWidth: 680 }}>
            Read-only. Every check below is a catalog read or a free quote — no clip is generated and the wallet is
            never charged. This is the live answer to “is this provider up?”; the model catalogs in the codebase
            describe capabilities, not availability.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button
            type="button"
            className="vpl-btn"
            onClick={() => { void check(); }}
            disabled={running}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: running ? 'transparent' : COLORS.primary,
              color: running ? COLORS.textMuted : '#FFFFFF',
              border: running ? `1px solid ${COLORS.border}` : 'none',
              borderRadius: 9,
              padding: '8px 14px',
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: running ? 'default' : 'pointer',
            }}
          >
            <RefreshCw size={13} /> {running ? 'Checking…' : 'Re-check'}
          </button>
          <button
            type="button"
            className="vpl-btn"
            onClick={onClose}
            title="Back to the lab"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              color: COLORS.textMuted,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 9,
              padding: '8px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: 'pointer',
            }}
          >
            <X size={13} /> Close
          </button>
        </div>
      </div>

      {!hasToken ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            background: alpha(COLORS.warning, 0.1),
            border: `1px solid ${alpha(COLORS.warning, 0.3)}`,
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 14,
            fontSize: 12,
            lineHeight: 1.6,
            color: COLORS.warning,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            No workspace credential in this page, so the authenticated checks below will report 401 whatever the
            providers are doing. Reload the space and re-check.
          </span>
        </div>
      ) : null}

      {ranAt ? (
        <div style={{ fontSize: 11.5, color: COLORS.textFaint, fontFamily: MONO, marginBottom: 12 }}>
          {`Checked ${new Date(ranAt).toLocaleTimeString()} · ${failures ? `${failures} failing` : 'all clear'}`}
        </div>
      ) : null}

      {groups.map((group) => {
        const groupRows = rows.filter((row) => row.group === group);
        if (!groupRows.length) return null;
        return (
          <div key={group} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: COLORS.textFaint,
                marginBottom: 7,
              }}
            >
              {group}
            </div>
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 11, overflow: 'hidden', background: COLORS.surface }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: COLORS.surfaceAlt }}>
                    <th style={{ ...cell, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.textFaint }}>Model / endpoint</th>
                    <th style={{ ...cell, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.textFaint, width: 104 }}>Status</th>
                    <th style={{ ...cell, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.textFaint, width: 92 }}>Latency</th>
                    <th style={{ ...cell, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.textFaint }}>What it said</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => {
                    const probe = PROBES.find((item) => item.key === row.key);
                    return (
                      <tr key={row.key}>
                        <td style={{ ...cell, fontFamily: MONO, color: COLORS.text, wordBreak: 'break-all' }}>
                          {row.id}
                          {probe ? (
                            <div style={{ fontFamily: FONT, color: COLORS.textFaint, fontSize: 11, lineHeight: 1.55, marginTop: 4 }}>
                              {probe.what}
                            </div>
                          ) : null}
                        </td>
                        <td style={cell}><StatusPill ok={row.ok} /></td>
                        <td style={{ ...cell, fontFamily: MONO, color: COLORS.textMuted }}>
                          {row.latencyMs === null ? '—' : `${row.latencyMs} ms`}
                        </td>
                        <td style={{ ...cell, color: row.ok === false ? COLORS.error : COLORS.textMuted, lineHeight: 1.6, wordBreak: 'break-word' }}>
                          {row.detail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <p style={{ margin: 0, fontSize: 11.5, color: COLORS.textFaint, lineHeight: 1.7, maxWidth: 680 }}>
        A catalog answering OK proves the contract is reachable, not that a paid render will succeed — account
        entitlement is a separate thing. To prove one model end to end, run it from the lab with the shortest
        duration; that spends the wallet, which is exactly why it is not on this screen.
      </p>
    </div>
  );
}
