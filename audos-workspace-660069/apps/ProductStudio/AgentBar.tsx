/**
 * Agent bar — the full-width "Ask AI to edit…" input at the very bottom of the
 * editor. Sends the instruction plus a compact project summary to Claude
 * through the platform Anthropic proxy (X-Workspace-DB-Token required; the
 * tier comes from the shared model policy in lib/aiModels - parsing an
 * instruction into a fixed action list is classification work), expects a
 * strict-JSON action list back, and applies each action
 * through the SAME safe mutation contract as manual edits — actor 'agent',
 * base_version attached, so the server's user-wins conflict rule holds.
 * The result surfaces as a small toast above the bar, not a chat panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, X } from 'lucide-react';
import { trackB, getWorkspaceToken, type TrackBProjectRow, type MutationRejection } from '../../lib/trackB/api';
import { selectModel } from '../../lib/aiModels';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  card: 'var(--space-surface-card)',
  panelStrong: 'var(--space-surface-panel-strong)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

const AGENT_SYSTEM = `You are the in-editor assistant for a product-video editor. The user asks for edits in plain language; you answer with STRICT JSON only (no markdown fences, no commentary outside the JSON).

Return: {"reply": "<one short friendly sentence describing what you did or why you couldn't>", "actions": […]}

Each action is one of:
  {"operation":"set_headline","scene_id":"<id>","value":"<max 120 chars>"}
  {"operation":"set_caption","scene_id":"<id>","value":"<max 200 chars>"}
  {"operation":"set_duration","scene_id":"<id>","value":<seconds, stay inside that scene's timing_range>}
  {"operation":"set_title","value":"<max 140 chars>"}
  {"operation":"set_music_track","value":"<one of the frozen_audio ids>"}
  {"operation":"set_music_volume","value":<0..1>}
  {"operation":"set_brand_hex_primary"|"set_brand_hex_accent"|"set_brand_hex_background"|"set_brand_hex_text","value":"#RRGGBB"}
  {"operation":"reorder_scenes","value":["scene-id",…]}  // must be a permutation of ALL current scene ids

Rules: only edit EDITABLE scenes; use only supplied facts — never invent product claims; if the request needs an unsupported change (layout, motion, new scenes, image swaps), return an empty actions array and explain in reply that the Re-generate buttons in the controls panel handle scene/image regeneration. Keep the film's tone; small numbers of precise actions beat sweeping rewrites.`;

interface AgentAction { operation: string; scene_id?: string; value: unknown }

function extractJson(text: string): { reply?: string; actions?: AgentAction[] } | null {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export default function AgentBar({ row, disabled = false, onRefresh }: {
  row: TrackBProjectRow;
  disabled?: boolean;
  onRefresh: () => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState('');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const rowRef = useRef(row);
  useEffect(() => { rowRef.current = row; }, [row]);

  const showToast = useCallback((kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 9000);
  }, []);

  const send = useCallback(async () => {
    const instruction = prompt.trim();
    if (!instruction || working) return;
    const current = rowRef.current;
    setWorking(true);
    try {
      const token = getWorkspaceToken();
      if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
      const baseVersion = current.version;
      const proj = current.project;
      const summary = {
        title: proj?.title ?? current.title,
        status: current.status,
        brand_tokens: proj?.brand?.tokens ?? {},
        music: { selected: proj?.music?.track ?? null, volume: proj?.music?.volume ?? 0.7 },
        frozen_audio: (proj?.frozen_audio ?? []).map((a) => ({ id: a.id, label: a.label })),
        scenes: (proj?.scenes ?? []).map((s, i) => ({
          order: i + 1, id: s.id, state: s.state, headline: s.headline, caption: s.caption,
          duration_s: s.duration_s, timing_range: s.timing_range,
        })),
      };
      const res = await fetch('/proxy/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
        body: JSON.stringify({
          model: selectModel('classify'),
          max_tokens: 1600,
          system: AGENT_SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify({ instruction, project: summary }) }],
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(payload?.error?.message || payload?.error || `The assistant is unavailable (HTTP ${res.status}).`).slice(0, 240));
      const text = Array.isArray(payload?.content) ? payload.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text ?? '').join('') : '';
      const parsed = extractJson(text);
      if (!parsed) throw new Error('The assistant answered in an unexpected format — please rephrase and try again.');

      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      let applied = 0;
      let skipped = 0;
      const problems: string[] = [];
      for (const a of actions.slice(0, 12)) {
        try {
          if (a.operation === 'reorder_scenes') {
            const ids = Array.isArray(a.value) ? (a.value as unknown[]).map(String) : [];
            const r = await trackB.reorderScenes(current.id, ids, { actor: 'agent', intent: instruction.slice(0, 160) });
            if ((r as MutationRejection).ok === false) problems.push((r as MutationRejection).error);
            else if ((r as { applied?: boolean }).applied) applied += 1; else skipped += 1;
          } else {
            const r = await trackB.mutate(current.id, a.operation, a.value, a.scene_id, baseVersion, { actor: 'agent', intent: instruction.slice(0, 160) });
            if ((r as MutationRejection).ok === false) problems.push((r as MutationRejection).error);
            else if ((r as { applied?: boolean }).applied) applied += 1;
            else skipped += 1; // USER_WINS — a newer user edit was preserved
          }
        } catch {
          problems.push(`${a.operation} failed`);
        }
      }

      await onRefresh();
      const reply = String(parsed.reply || 'Done.').slice(0, 220);
      const bits: string[] = [];
      if (applied) bits.push(`${applied} change${applied === 1 ? '' : 's'} applied`);
      if (skipped) bits.push(`${skipped} skipped (your newer edit wins)`);
      if (problems.length) bits.push(problems[0]);
      showToast(problems.length && !applied ? 'error' : 'ok', bits.length ? `${reply} — ${bits.join(' · ')}` : reply);
      if (applied || !problems.length) setPrompt('');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'The assistant could not process that — please try again.');
    } finally {
      setWorking(false);
    }
  }, [prompt, working, onRefresh, showToast]);

  return (
    <div style={{ position: 'relative' }} data-testid="agent-bar">
      {toast ? (
        <div
          role="status"
          className="ps-fade-up"
          style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', borderRadius: 11, fontSize: 12.5, fontWeight: 600, lineHeight: 1.5, color: toast.kind === 'error' ? S.danger : S.success, background: `color-mix(in srgb, ${toast.kind === 'error' ? S.danger : S.success} 10%, var(--space-surface-panel-strong))`, border: `1px solid color-mix(in srgb, ${toast.kind === 'error' ? S.danger : S.success} 32%, transparent)`, zIndex: 5 }}
          data-testid="agent-toast"
        >
          <Bot size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ flex: 1, minWidth: 0 }}>{toast.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} style={{ padding: 2, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', flexShrink: 0 }}><X size={12} /></button>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 13, border: `1px solid ${S.borderStrong}`, background: S.panelStrong }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', color: S.brand, background: 'var(--space-surface-accent-soft)', flexShrink: 0 }}>
          {working ? <Loader2 size={15} className="rc-spin" /> : <Bot size={15} />}
        </span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder='Ask AI to edit… e.g. "punchier headline on scene 2", "swap scenes 3 and 4", "make the accent colour coral"'
          disabled={disabled || working}
          style={{ flex: 1, minWidth: 0, padding: '8px 4px', border: 'none', background: 'transparent', color: S.text, fontSize: 13.5, outline: 'none' }}
          data-testid="agent-input"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={disabled || working || !prompt.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, opacity: disabled || working || !prompt.trim() ? 0.6 : 1 }}
          data-testid="agent-send"
        >
          {working ? 'Editing…' : 'Send'} <Send size={12} />
        </button>
      </div>
    </div>
  );
}
