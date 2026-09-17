/**
 * Stage 3 — Plan. One LLM call produces a VideoPlan (schema-validated by
 * schema/video-plan.schema.json), then post-validation
 * (src/plan/validate.ts) enforces the composition, budget, plate, and rhythm
 * rules. Hard violations trigger up to 2 retries with the concrete violation
 * list appended, so the model fixes what actually failed.
 *
 * The planner is a text-reasoning task over structured analyses — it runs on
 * the frontier text model (gpt-5.6-sol) through the same authenticated proxy.
 */
import videoPlanSchema from '../../schema/video-plan.schema.json';
import { assertValid } from './jsonSchema';
import { validateAndRepairPlan, type PlanIssue } from './validate';
import { applyBeatGrid, settleUiOnBeats } from '../sync/grid';
import type { VideoPlan, ScreenAnalysis, IngestedScreen, IngestedClip, SyncSpec } from '../types';

/** Presenter Mix context (Phase 2): conformed clips + the beat grid. */
export interface PlanMix {
  clips: IngestedClip[];
  sync: SyncSpec | null;
  /** Optional extra directive, e.g. which clip is the presenter. */
  presenterNote?: string;
}

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

const PLANNER_SYSTEM = [
  'You are a motion-design director planning a product demo video from real screenshots.',
  'You never rebuild UI and never invent copy: overlays quote the brief or transcribed region text.',
  'Return ONLY a JSON VideoPlan matching the provided schema. 30fps, 1920x1080.',
  '',
  'CAMERA — every scene has exactly ONE bed op (push | pan | scrollSim | deviceTilt) and 0–2 accents',
  '(focus | lift | parallax | cursor | highlight | callout | maskWipe | compare).',
  'Rules: never repeat a bed op back-to-back; cursor never with focus; lift and parallax are exclusive;',
  'scrollSim only on scrollable screens; deviceTilt at most once (it owns the single glass sweep).',
  '',
  'UI MOTION — up to 2 ops per scene, never overlapping in time, attached to analysed regions by regionId,',
  'role-matched (countUp→metric, chartDraw→media/panel, listStagger→row/card, typeIn→headline/form,',
  'progressFill→metric/panel, toggleFlip→row, statusFlip→row/card, badgePop→nav/row, tabSlide→nav,',
  'ripple→cta, notify is frame-anchored, skeleton any). A region whose plateColor is null cannot take a',
  'plate op — use highlight instead. A cursor scene fires exactly ONE ui op, after clickAt.',
  'No ui op more than twice across the whole video.',
  '',
  'RHYTHM — total 20–40 seconds. Vary scene durations (never identical). Put the strongest screenshot',
  '60–70% through, not first. The final scene holds its resolved frame at rest for at least 20 frames.',
  '',
  'OVERLAYS — margin type only (top/bottom/left/right), four sizes, headline <= 42 chars, caption <= 90.',
  'theme.source is "derived": pick accent from the analysed palettes. Choose ONE motion preset',
  '(calm | snappy | cinematic | kinetic) that matches the product\'s voice in the brief.',
].join('\n');

const MIX_RULES = [
  'PRESENTER MIX — real footage is available. A scene is EITHER a screenshot scene (rules above) OR a clip scene:',
  '{ "id", "kind": "clip", "src": "<clipId>", "duration", "trim": [inSeconds, outSeconds], "grade": "auto", "audio": "strip" | "duck", "overlay"?, "out"?: { "carry": "left"|"right"|"up"|"down"|"in"|"out" }, "plate"? }.',
  'Use each clip at most once, at most 4 clips total. trim must sit inside the clip and the scene duration must fit inside the trim — clips are NEVER looped to fill time. Leave at least 2 beats of trim headroom beyond the scene duration: bar alignment can extend a clip scene by up to half a bar, and a re-timed source (24/25fps) yields fewer composition frames per second of trim.',
  'HONESTY (hard rule): generated footage is atmosphere, texture and context ONLY — open or bridge with it. It never depicts the product, a customer, a testimonial or a deployment; every pixel of interface comes from a screenshot scene.',
  'AUDIO: default "strip" — silence is better than one clip\'s ambience. "duck" only where sound is the point (the presenter clip): the music bed ducks −12dB under it.',
  'CUTTING: footage is NEVER cross-dissolved into UI — every clip boundary is a hard cut, match cut, or whip. At each footage boundary set out.carry on the OUTGOING scene so camera velocity continues into the incoming direction. Match the shape: prefer cuts where a region bbox in the outgoing frame aligns with a strong shape in the incoming clip.',
  'PLATE: a clip showing a blank-screen device may carry "plate": { "screenId", "corners": [2–4 keyframes of {"at", "tl", "tr", "br", "bl"} in 0–1 clip coords], "blur" matched to the shot focus (0–2.5), "glow" 0.1–0.25, "reflection" 0.04–0.08 }. Omit the plate if hands or objects pass in front of the screen — those shots are rejected.',
  'BEAT GRID: the video is cut to sync.bpm (frames per beat = fps*60/bpm). Make every scene duration a whole number of beats — 4, 6, 8 or 12 — never raw frames; larger scene changes on a bar line. UI motion ops must FINISH on a beat (landOn "settle"): a countUp finishing on the downbeat is the most satisfying moment.',
].join('\n');

async function callPlanner(brief: string, analyses: ScreenAnalysis[], screens: IngestedScreen[], feedback: PlanIssue[] | null, mix?: PlanMix | null): Promise<VideoPlan> {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: mix ? `${PLANNER_SYSTEM}\n\n${MIX_RULES}` : PLANNER_SYSTEM },
        {
          role: 'user',
          content: [
            `Product brief (40–600 chars, verbatim from the founder):\n${brief}`,
            `Screens (id, true pixel size):\n${screens.map((s) => `${s.screenId}: ${s.width}x${s.height} (${s.filename})`).join('\n')}`,
            mix && mix.clips.length
              ? `Clips (id, source, true fps, seconds, size):\n${mix.clips.map((c) => `${c.clipId}: ${c.source}, ${c.fps}fps, ${c.durationSeconds.toFixed(2)}s, ${c.width}x${c.height}`).join('\n')}`
              : '',
            mix && mix.sync
              ? `Beat grid: bpm ${mix.sync.bpm}, offsetMs ${mix.sync.offsetMs}, landOn ${mix.sync.landOn} — frames per beat = ${((30 * 60) / mix.sync.bpm).toFixed(2)}.`
              : '',
            mix && mix.presenterNote ? mix.presenterNote : '',
            `Screen analyses:\n${JSON.stringify(analyses)}`,
            `JSON Schema the plan must satisfy exactly:\n${JSON.stringify(videoPlanSchema)}`,
            feedback && feedback.length
              ? `YOUR PREVIOUS PLAN VIOLATED THESE RULES — fix every one:\n${feedback.map((i) => `- [${i.scene || 'video'}] ${i.message}`).join('\n')}`
              : '',
          ].filter(Boolean).join('\n\n'),
        },
      ],
      stream: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `Planning failed (${response.status}).`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(String(body?.choices?.[0]?.message?.content || ''));
  } catch {
    throw new Error('The planner returned unparseable JSON.');
  }
  assertValid(parsed, videoPlanSchema, 'VideoPlan');
  return parsed as VideoPlan;
}

export async function planVideo(
  brief: string,
  analyses: ScreenAnalysis[],
  screens: IngestedScreen[],
  onProgress?: (message: string) => void,
  mix?: PlanMix | null,
): Promise<{ plan: VideoPlan; issues: PlanIssue[] }> {
  let feedback: PlanIssue[] | null = null;
  let lastResult: { plan: VideoPlan; issues: PlanIssue[] } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    onProgress?.(attempt === 0 ? 'Directing the motion plan…' : `Re-planning (fixing ${feedback?.length} rule violations)…`);
    const raw = await callPlanner(brief, analyses, screens, feedback, mix);
    if (mix?.sync) {
      // Mechanical grid passes BEFORE validation: quantise every scene to whole
      // beats and settle UI op endings on the downbeat — the validator then
      // checks ±1-frame cut alignment on the result.
      raw.sync = mix.sync;
      applyBeatGrid(raw, 30);
      settleUiOnBeats(raw, 30);
    }
    const result = validateAndRepairPlan(raw, analyses, mix?.clips);
    lastResult = result;
    if (result.issues.length === 0) return result;
    feedback = result.issues;
  }
  // Ship the best repaired plan; remaining issues are surfaced to the caller.
  return lastResult!;
}
