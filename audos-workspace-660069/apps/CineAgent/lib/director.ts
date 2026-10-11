// CineAgent — the creative director.
//
// Claude Opus 5 watches the footage (transcript, Gemini content analysis, real
// extracted frames) and authors the EditPlan. It is asked for JUDGEMENT — what
// the video is, what should go, what deserves motion design — and it answers
// in the executable schema that plan.ts validates and motionRuntime renders.

import { OPUS, callModelForJson, imageBlock, textBlock, type ContentBlock } from './ai';
import type {
  AnalysisReport, ContentAnalysis, EditPlan, QADefect, SampledFrame,
  SourceVideo, UserPrefs,
} from './types';
import { MAX_IMAGE_ASSETS, MAX_VIDEO_ASSETS } from './types';

// ---------------------------------------------------------------------------
// Gemini content-analysis prompt (whole-video understanding)
// ---------------------------------------------------------------------------

export const GEMINI_ANALYSIS_PROMPT = [
  'You are analyzing this video for a professional video editor. Watch it COMPLETELY, including the ending.',
  'Answer with ONE JSON object only (no prose, no markdown fence) with exactly these keys:',
  '{',
  '  "contentType": one short label like "talking-head", "tutorial", "product demo", "screen recording", "podcast", "vlog", "advertisement", "interview", "sports", "cinematic",',
  '  "summary": 3-5 sentences on what the video communicates and how it is structured,',
  '  "audience": who this is for,',
  '  "scenes": [{"start": seconds, "end": seconds, "description": what happens}] — every distinct scene or visual change,',
  '  "onScreenText": [any text already visible in the footage],',
  '  "keyMoments": [{"t": seconds, "description": important beat, action, or quotable line}],',
  '  "endingDescription": what the final 10 seconds contain,',
  '  "audioNotes": dialogue quality, music, noise, silences,',
  '  "qualityNotes": framing, lighting, camera movement, visual issues worth fixing or cutting',
  '}',
  'Timestamps must be real seconds within the video. Be specific and factual.',
].join('\n');

export function parseContentAnalysis(raw: string): ContentAnalysis | null {
  try {
    let text = String(raw || '').trim();
    const fence = text.indexOf('```');
    if (fence >= 0) {
      const after = text.slice(fence + 3).replace(/^json/i, '');
      const close = after.indexOf('```');
      text = (close >= 0 ? after.slice(0, close) : after).trim();
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(text.slice(start, end + 1));
    return {
      contentType: String(data.contentType || 'video'),
      summary: String(data.summary || ''),
      audience: String(data.audience || ''),
      scenes: (Array.isArray(data.scenes) ? data.scenes : []).map((s: any) => ({
        start: Number(s?.start || 0), end: Number(s?.end || 0), description: String(s?.description || ''),
      })).filter((s: any) => s.end > s.start),
      onScreenText: (Array.isArray(data.onScreenText) ? data.onScreenText : []).map((t: any) => String(t)).slice(0, 40),
      keyMoments: (Array.isArray(data.keyMoments) ? data.keyMoments : []).map((m: any) => ({
        t: Number(m?.t || 0), description: String(m?.description || ''),
      })),
      endingDescription: String(data.endingDescription || ''),
      audioNotes: String(data.audioNotes || ''),
      qualityNotes: String(data.qualityNotes || ''),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

const SCHEMA_DOC = `OUTPUT SCHEMA — answer with ONE JSON object, nothing else:
{
 "title": string, "logline": string, "contentType": string,
 "direction": string (your creative note: the arc you are building and why),
 "identity": {"primary":"#hex","secondary":"#hex","accent":"#hex","bg":"#hex","text":"#hex","fontStyle":"modern|editorial|bold|mono|elegant","tone": string},
 "frame": {"mode":"fit|cover","bgBlur": true|false},
 "timeline": [Segment, ...]  // the OUTPUT cut, played in order
 "overlays": [Overlay, ...], // motion graphics ON TOP of the playing cut, timed on OUTPUT seconds
 "captions": {"enabled": bool, "style": {"preset":"clean|bold|karaoke|minimal|editorial","position":"bottom|lower|center"}},
 "audio": {"keepOriginal": bool, "originalVolume": 0..1,
   "music": null | {"prompt": string (describe the underscore), "volume": 0..0.5, "duckTo": 0..0.3},
   "narration": null | {"segments":[{"text": string, "at": outputSeconds}]}},
 "assets": [AssetSpec, ...]
}

Segment = {"id":"s1","kind":"source","src":{"start":sec,"end":sec,"volume":0..1},"transitionIn":{"type":"cut|fade|dip|slide|zoom|whip","duration":0.1-1.2},"note":why}
        | {"id":"s2","kind":"generated","assetId":"a1","duration":sec(1.5-10),"transitionIn":...,"note":...}   // a generated clip/image full-frame
        | {"id":"s3","kind":"board","board":MotionSpec,"duration":sec(1.5-12),"transitionIn":...,"note":...}    // a pure motion-design section (no footage)
src times are SOURCE seconds in the original footage. Output time = segments played back to back.

Overlay = {"id":"o1","at":outputSec,"duration":sec,"anchor":"lower-third|center|top|left-panel|right-panel|full|corner","spec":MotionSpec,"note":why}

MotionSpec — the motion-design vocabulary (pick what COMMUNICATES; invent with "custom"):
 {"type":"kineticTitle","text":..,"subtext"?:..,"style":"rise|split|assemble|typeOn|blur|punch","size":"sm|md|lg|xl"}
 {"type":"lowerThird","title":..,"subtitle"?:..}
 {"type":"callout","text":..,"x":0-100,"y":0-100,"pointerTo"?:{"x":..,"y":..}}  // x,y are % of frame
 {"type":"stat","value":number,"prefix"?:..,"suffix"?:..,"label":..}            // animated count-up
 {"type":"barChart","title"?:..,"items":[{"label":..,"value":..}],"unit"?:..}
 {"type":"list","title"?:..,"items":[..]}                                        // staggered reveal
 {"type":"quote","text":..,"attribution"?:..}
 {"type":"chapter","index"?:n,"title":..,"subtitle"?:..}                        // full-frame chapter card
 {"type":"badge","text":..}
 {"type":"image","assetId":..,"motion":"kenburns|parallax|pop","caption"?:..}
 {"type":"progress","label"?:..,"from":n,"to":n,"suffix"?:..}
 {"type":"timeline","title"?:..,"items":[{"label":..,"detail"?:..}]}
 {"type":"keyword","words":[..]}                                                 // words that pop as they are said
 {"type":"custom","bg"?:"#hex","layers":[{"kind":"text|rect|ellipse|line|image","text"?:..,"assetId"?:..,"color"?:"#hex","fontSize"?:px,"weight"?:300-900,"radius"?:px,"start":sec,"end":sec,"ease":"linear|out|inOut|spring","from":{"x"?,"y"?,"w"?,"h"?,"scale"?,"rotate"?,"opacity"?,"blur"?},"to":{...}}]}
   // custom = keyframed free-form composition. x/y/w/h are % of a 1920x1080 frame (x,y = element CENTER); start/end are seconds relative to the overlay start. Use it to design anything the primitives cannot say.

AssetSpec = {"id":"a1","kind":"image","prompt": detailed art direction}
          | {"id":"a2","kind":"video","prompt": detailed shot direction,"model":"seedance|veo-fast|veo|omni","durationSec":4-8,"referenceFrameT"?: sourceSec,"referenceVideoClip"?:{"start":sourceSec,"end":sourceSec}}
Models: "seedance" (Seedance 2.0 Fast — stylized/organic motion, fast), "veo-fast"/"veo" (Veo 3.1 — cinematic realism), "omni" (Gemini Omni Flash — video-to-video; ALWAYS prefer referenceVideoClip over referenceFrameT when using omni — set start/end to a 2-6s clip from the source footage containing the character or scene you want to continue; the model receives the actual video motion for maximum consistency). Generated video must NEVER contain on-screen text — text is drawn by the deterministic graphics engine.`;

const DIRECTOR_PRINCIPLES = `You are a professional film editor, creative director and motion designer. You have full creative ownership: the uploader will NOT review your plan before it renders. Your output is judged against PREMIUM work — high-end SaaS launch films, editorial explainers, award-level ads. "Fine" is a failure; every choice must look intentional.

JUDGEMENT RULES:
- Understand what THIS video is and who it serves. Choose the approach that fits it — a talking-head explainer, a screen tutorial, an ad, a podcast and a cinematic piece all want different treatment. Do not apply a template.
- CUT with purpose: remove dead air, long silences, false starts, filler and repetition (the silence list tells you where). Tighten pacing, but never cut mid-sentence — land cut points in the gaps between words/sentences visible in the transcript timestamps.
- Motion design must COMMUNICATE: emphasize a claim, name a speaker, explain a concept, visualize a number, mark a chapter. If a moment is strong on its own, leave it clean. Random decoration is failure.
- A cold open matters: the first 3 seconds should hook (a kinetic title over the strongest early moment, or the best line pulled forward).
- Generated assets are for moments the footage cannot show (a concept illustration, a cinematic insert, an establishing shot). They must fit the story and the visual identity — never random stock-like filler. Budget: at most ${MAX_VIDEO_ASSETS} video + ${MAX_IMAGE_ASSETS} image assets; most edits need far fewer, many need none.
- Keep the subject's own voice: keepOriginal=true unless the footage has no usable speech. Never write narration that fights existing dialogue — narration is for silent footage or dedicated board sections.
- Music: a quiet underscore helps most spoken content (volume 0.1-0.2, duckTo ~0.05); energetic content can take more. Describe genre, mood, tempo, instrumentation AND an arc (how it builds and resolves) in the prompt. Omit music only when the footage's own sound is the point.
- Captions: enable for spoken content (most viewers watch muted). Choose the preset that fits the identity.
- The output frame is 1920x1080. frame.mode "fit" letterboxes/pillarboxes non-16:9 footage over a blurred fill; "cover" crops to fill. Choose per footage.
- TOTAL output length: aim for the strongest cut, typically 40-85% of the source. Every segment needs a reason (note).

CRAFT RULES (what separates premium from template):
- ONE idea per graphic. A graphic that says two things says nothing. Short words, few words: a kineticTitle over footage carries at most 5-6 words; put the rest in the dialogue, not on screen.
- Density discipline: roughly one overlay per 8-15 seconds at most, with real breathing room between graphics — at least 2s of clean footage after an overlay ends before the next begins. Never two overlays on screen at once. Vary the vocabulary — never the same spec type twice in a row.
- Type hierarchy is sacred: the renderer gives every primitive an eyebrow/display/support structure — write copy that fits it (subtext = short uppercase eyebrow phrase, 2-4 words; title = the idea; never sentences in titles).
- Placement: lowerThird for names/labels (never centered), center only for moments that deserve a full pause, corner badges for short status words. Respect the subject — never cover a face or the action; use left-panel/right-panel when the subject sits on one side.
- DESIGN A SIGNATURE MOMENT: at least one overlay or board in every edit should be a bespoke "custom" composition built for THIS content (layered keyframed text/shape/image) — the moment a viewer would screenshot. Make it earn that: deliberate timing, asymmetric layout, one strong idea. A film of only stock primitives reads as template work.
- Timing curves: let entrances land (0.4-0.6s), hold long enough to read twice (roughly 1s per 3 words + 1s), exit before the moment goes stale. An overlay under 1.5s or over 8s is almost always wrong (chapter cards and signature moments may run longer as boards).
- Palette: choose colors FROM the footage and subject matter — sample the mood of what you saw in the frames. High contrast between text and accent; never default to amber/cyan out of habit; identity.tone should read like an art director's note (e.g. "confident editorial navy with an electric coral accent").
- Asset prompts are shot direction, not descriptions: subject, composition, lens (e.g. 35mm, shallow DOF), lighting (e.g. soft window light, golden hour), movement, color grade, mood — and always visually consistent with the identity and the footage it will sit beside.`;

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return m + ':' + s;
}

/** Compact, timestamped transcript: sentence per line with [m:ss.s] markers. */
export function compactTranscript(analysis: AnalysisReport, maxChars = 24000): string {
  const words = analysis.words || [];
  if (!words.length) return analysis.transcript ? analysis.transcript.slice(0, maxChars) : '(no speech detected)';
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = words[0].s;
  let lastEnd = words[0].s;
  words.forEach((w) => {
    if (w.s - lastEnd > 1.2 && line.length) {
      lines.push('[' + fmtTime(lineStart) + '] ' + line.join(' ') + '  (pause ' + (w.s - lastEnd).toFixed(1) + 's)');
      line = [];
      lineStart = w.s;
    }
    line.push(w.w);
    lastEnd = w.e;
    if (/[.!?]$/.test(w.w) && line.length > 2) {
      lines.push('[' + fmtTime(lineStart) + '] ' + line.join(' '));
      line = [];
      lineStart = lastEnd;
    }
  });
  if (line.length) lines.push('[' + fmtTime(lineStart) + '] ' + line.join(' '));
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(transcript truncated)';
  return text;
}

function describeContext(source: SourceVideo, analysis: AnalysisReport, prefs: UserPrefs | null): string {
  const parts: string[] = [];
  parts.push('SOURCE FOOTAGE: "' + source.name + '" — ' + source.duration.toFixed(1) + 's, '
    + source.width + 'x' + source.height + ' (' + (source.width >= source.height ? 'landscape' : 'portrait/square') + ').');
  if (source.height > source.width) {
    parts.push('OUTPUT FORMAT: this film is DELIVERED PORTRAIT 1080x1920 (9:16) — the source orientation is preserved. '
      + 'Compose for a VERTICAL frame: stack graphics vertically, keep titles to 2-3 short words per line, prefer center/top/lower-third anchors '
      + '(left-panel/right-panel are too narrow in portrait), and remember x/y percentages map onto the vertical frame.');
  }
  const ca = analysis.contentAnalysis;
  if (ca) {
    parts.push('CONTENT ANALYSIS (from a vision model that watched the full video):'
      + '\n- type: ' + ca.contentType
      + '\n- summary: ' + ca.summary
      + '\n- audience: ' + ca.audience
      + (ca.scenes.length ? '\n- scenes:\n' + ca.scenes.map((s) => '  [' + fmtTime(s.start) + '-' + fmtTime(s.end) + '] ' + s.description).join('\n') : '')
      + (ca.keyMoments.length ? '\n- key moments:\n' + ca.keyMoments.map((m) => '  [' + fmtTime(m.t) + '] ' + m.description).join('\n') : '')
      + (ca.onScreenText.length ? '\n- on-screen text already in footage: ' + ca.onScreenText.join(' | ') : '')
      + '\n- ending: ' + ca.endingDescription
      + '\n- audio: ' + ca.audioNotes
      + '\n- quality: ' + ca.qualityNotes);
  }
  if (analysis.silences.length) {
    const top = analysis.silences.filter((s) => s.end - s.start >= 0.6).slice(0, 40);
    parts.push('SILENCES ≥ 0.6s (cut candidates): ' + top.map((s) => fmtTime(s.start) + '-' + fmtTime(s.end)).join(', '));
  }
  parts.push('TRANSCRIPT (word timings are ' + (analysis.wordsExact ? 'exact' : 'approximate') + '):\n' + compactTranscript(analysis));
  if (prefs) {
    const notes: string[] = [];
    if (prefs.tone) notes.push('tone/direction: ' + prefs.tone);
    if (prefs.intensity) notes.push('motion intensity: ' + prefs.intensity);
    if (prefs.captions && prefs.captions !== 'auto') notes.push('captions: ' + prefs.captions);
    if (prefs.music && prefs.music !== 'auto') notes.push('music: ' + prefs.music);
    if (notes.length) parts.push('UPLOADER PREFERENCES (respect them): ' + notes.join('; '));
  }
  return parts.join('\n\n');
}

function frameBlocks(frames: SampledFrame[], cap = 14): ContentBlock[] {
  const picked = frames.length <= cap ? frames : frames.filter((_, i) => i % Math.ceil(frames.length / cap) === 0).slice(0, cap);
  const blocks: ContentBlock[] = [];
  picked.forEach((f) => {
    blocks.push(textBlock('Frame at ' + fmtTime(f.t) + ':'));
    blocks.push(imageBlock(f.url));
  });
  return blocks;
}

/** The main direction call: footage in, executable EditPlan out. */
export async function directEdit(
  source: SourceVideo,
  analysis: AnalysisReport,
  prefs: UserPrefs | null,
): Promise<EditPlan> {
  const content: ContentBlock[] = [
    textBlock(describeContext(source, analysis, prefs)),
    ...frameBlocks(analysis.frames),
    textBlock('Direct the edit now. Remember: compact JSON, double-quoted keys, no trailing commas, no comments, ONE object.'),
  ];
  return callModelForJson<EditPlan>(content, {
    model: OPUS,
    system: DIRECTOR_PRINCIPLES + '\n\n' + SCHEMA_DOC,
    maxTokens: 8192,
    attempts: 3,
  });
}

// ---------------------------------------------------------------------------
// Refinement — the director reviews its own plan BEFORE a cent is spent
// ---------------------------------------------------------------------------

const REFINE_SYSTEM = `You are the same director doing a ruthless second pass on YOUR OWN edit plan before production. You are judged against premium launch films and editorial explainers. Fix, in order of importance:
1. HOOK — do the first 3 seconds grab? If not, restructure the open (pull the best line forward, or open on a kinetic title over the strongest moment).
2. CLUTTER — overlapping or back-to-back overlays, two ideas in one graphic, titles with sentence-length copy, graphics over the subject's face. Delete or tighten; prefer fewer, stronger graphics with breathing room.
3. SAMENESS — repeated spec types in a row, every overlay centered, a cut that never changes rhythm. Vary type, anchor and pacing.
4. SIGNATURE — ensure at least one bespoke "custom" composition (or an exceptional board) designed for THIS content. If the plan has none, upgrade the single most important overlay into one (layered keyframed text/shape, asymmetric, deliberate).
5. COPY — every on-screen word must earn its place: shorter, punchier, concrete. Eyebrow phrases uppercase-short (2-4 words). No filler like "Welcome to the video".
6. TIMING — overlays that are too short to read or linger too long; cuts landing mid-word (move to the nearest gap).
Keep everything that already works — this is a polish pass, not a redesign. Keep all ids you are not changing, keep the same JSON schema, and keep src timestamps within the source footage. Answer with the COMPLETE improved plan as ONE JSON object, nothing else.`;

export async function refinePlan(plan: EditPlan, source: SourceVideo): Promise<EditPlan> {
  const content: ContentBlock[] = [
    textBlock('SOURCE: ' + source.duration.toFixed(1) + 's of footage, ' + source.width + 'x' + source.height + '.'),
    textBlock('YOUR PLAN:\n' + JSON.stringify(plan)),
    textBlock('Do the polish pass now. ONE JSON object only, same schema, compact.'),
  ];
  return callModelForJson<EditPlan>(content, {
    model: OPUS,
    system: REFINE_SYSTEM,
    maxTokens: 8192,
    attempts: 2,
  });
}

// ---------------------------------------------------------------------------
// Review (vision QA on the rendered cut)
// ---------------------------------------------------------------------------

export interface ReviewVerdict {
  score: number;
  shippable: boolean;
  summary: string;
  defects: QADefect[];
}

const REVIEW_SYSTEM = `You are the same director reviewing YOUR OWN rendered cut before delivery. You are shown frames sampled from the FINISHED render plus the plan you wrote. Judge execution, not taste drift: missing/black/frozen frames, unreadable or overlapping text, graphics covering the subject, broken layout, wrong aspect handling, a graphic present when the plan said footage (or vice versa), visual inconsistency with the identity.

Answer ONE JSON object:
{"score":0..1,"shippable":bool,"summary":one paragraph,
 "defects":[{"severity":"critical|major|minor","where":"segment/overlay id or m:ss","issue":what is wrong,
  "action":"remove|shorten|retime|restyle|replace_text|drop_overlay|accept","details":how to fix}]}
shippable=true when nothing critical remains. Minor nitpicks do not block shipping. Be honest — a defect you wave through ships to a customer.`;

export async function reviewCut(
  outputFrames: { t: number; url: string }[],
  plan: EditPlan,
  measured: { duration: number; expected: number },
): Promise<ReviewVerdict> {
  const planSummary = {
    title: plan.title,
    direction: plan.direction,
    timeline: plan.timeline.map((s) => ({ id: s.id, kind: s.kind, note: s.note, src: s.src, duration: s.duration })),
    overlays: plan.overlays.map((o) => ({ id: o.id, at: o.at, duration: o.duration, type: o.spec.type, anchor: o.anchor })),
    captions: plan.captions,
  };
  const content: ContentBlock[] = [
    textBlock('THE PLAN YOU DIRECTED:\n' + JSON.stringify(planSummary).slice(0, 14000)),
    textBlock('Measured duration: ' + measured.duration.toFixed(1) + 's (expected ' + measured.expected.toFixed(1) + 's).'),
    textBlock('FRAMES SAMPLED FROM THE FINISHED RENDER (timestamps are output time):'),
  ];
  outputFrames.forEach((f) => {
    content.push(textBlock('Output ' + fmtTime(f.t) + ':'));
    content.push(imageBlock(f.url));
  });
  content.push(textBlock('Review now. ONE JSON object only.'));
  const verdict = await callModelForJson<ReviewVerdict>(content, {
    model: OPUS,
    system: REVIEW_SYSTEM,
    maxTokens: 3000,
    attempts: 2,
  });
  return {
    score: Math.max(0, Math.min(1, Number(verdict.score || 0))),
    shippable: Boolean(verdict.shippable),
    summary: String(verdict.summary || ''),
    defects: Array.isArray(verdict.defects) ? verdict.defects : [],
  };
}

// ---------------------------------------------------------------------------
// Revision (targeted — patch only what the review named)
// ---------------------------------------------------------------------------

const REVISE_SYSTEM = `You are revising your own edit plan. Apply ONLY the fixes implied by the listed defects — do not redesign anything that was not named. Keep every id you are not changing. Answer with the COMPLETE corrected plan as ONE JSON object in the exact same schema you used before (title, logline, contentType, direction, identity, frame, timeline, overlays, captions, audio, assets). Stay compact.`;

export async function revisePlan(plan: EditPlan, defects: QADefect[]): Promise<EditPlan> {
  const content: ContentBlock[] = [
    textBlock('CURRENT PLAN:\n' + JSON.stringify(plan)),
    textBlock('DEFECTS TO FIX:\n' + JSON.stringify(defects.filter((d) => d.action !== 'accept'))),
    textBlock('Send the complete corrected plan now. ONE JSON object only.'),
  ];
  return callModelForJson<EditPlan>(content, {
    model: OPUS,
    system: REVISE_SYSTEM,
    maxTokens: 8192,
    attempts: 2,
  });
}
