/**
 * Rejection gate (Phase 2 §9) — ALWAYS ON for generated footage.
 *
 * Honesty rule (§12, hard): generated footage may never depict the product, a
 * customer, a testimonial, or a real deployment. Atmosphere, texture and
 * context only — every pixel of interface comes from a screenshot. This gate
 * ENFORCES that: 5 frames are sampled across every generated clip and a
 * vision model answers, per frame:
 *
 *   "Does this frame contain a screen displaying an interface, or any legible
 *    text, logo or signage?"
 *
 * Any YES: the clip is discarded (the caller regenerates up to 2 attempts,
 * then falls back to a screenshot scene). Every rejection is logged with the
 * frame and the reason.
 */
import { CLIP_RULES } from '../types';
import { extractFrames } from './grade';

export interface GateRejection { timestamp: number; frameUrl: string; reason: string; }
export interface GateResult { passed: boolean; framesChecked: number; rejections: GateRejection[]; }

const GATE_QUESTION = 'Does this frame contain a screen displaying an interface, or any legible text, logo or signage?';

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

/** Run the gate on one generated clip URL. Throws only on infrastructure failure. */
export async function screenGateCheck(clipUrl: string, durationSeconds: number, workspaceId: string): Promise<GateResult> {
  const n = CLIP_RULES.gateFrameSamples;
  const timestamps = Array.from({ length: n }, (_, i) => Math.max(0.05, Math.min(durationSeconds - 0.05, durationSeconds * (0.05 + (0.9 * i) / (n - 1)))));
  const frames = await extractFrames(clipUrl, timestamps, workspaceId);

  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_completion_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a strict content gate for generated b-roll footage.',
            `For EACH numbered frame, answer the question: "${GATE_QUESTION}"`,
            'Be conservative: partial screens, blurry-but-legible text, watermarks, and brand marks all count as YES.',
            'A device with a completely BLANK (dark or evenly lit, contentless) screen is NO.',
            'Return ONLY JSON: {"frames":[{"index":number,"verdict":"YES"|"NO","reason":string}]} — one entry per frame, in order.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Check ${frames.length} frames sampled across one generated clip.` },
            ...frames.map((frame, i) => ({ type: 'image_url', image_url: { url: frame.url, detail: 'low' } })),
          ],
        },
      ],
      stream: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `The rejection-gate vision check failed (${response.status}).`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(String(body?.choices?.[0]?.message?.content || ''));
  } catch {
    throw new Error('The rejection-gate vision check returned unparseable JSON.');
  }

  const verdicts: any[] = Array.isArray(parsed?.frames) ? parsed.frames : [];
  const rejections: GateRejection[] = [];
  verdicts.forEach((v, i) => {
    if (String(v?.verdict || '').toUpperCase().startsWith('Y')) {
      const frame = frames[Math.min(frames.length - 1, Number.isInteger(v?.index) ? v.index : i)];
      rejections.push({
        timestamp: frame?.timestamp ?? timestamps[i],
        frameUrl: frame?.url || '',
        reason: String(v?.reason || 'screen/interface, legible text, logo or signage detected'),
      });
    }
  });
  // If the model returned fewer verdicts than frames, fail closed on the missing ones.
  if (verdicts.length < frames.length) {
    for (let i = verdicts.length; i < frames.length; i++) {
      rejections.push({ timestamp: frames[i].timestamp, frameUrl: frames[i].url, reason: 'no verdict returned for this frame — failing closed' });
    }
  }
  for (const r of rejections) {
    console.warn(`[screens-to-motion:gate] REJECTED frame @${r.timestamp.toFixed(2)}s — ${r.reason} — ${r.frameUrl}`);
  }
  return { passed: rejections.length === 0, framesChecked: frames.length, rejections };
}

/**
 * Self-test for the acceptance criterion "a clip deliberately containing
 * visible UI is rejected by the gate": run the real gate against a clip you
 * KNOW shows an interface; returns true when the gate correctly rejects it.
 */
export async function runGateSelfTest(uiClipUrl: string, durationSeconds: number, workspaceId: string): Promise<{ correctlyRejected: boolean; result: GateResult }> {
  const result = await screenGateCheck(uiClipUrl, durationSeconds, workspaceId);
  return { correctlyRejected: !result.passed, result };
}
