/**
 * VERGER CAPABILITY MANIFEST — the explicit, always-current record of what
 * every Vidverge app can and cannot do. Verger's system prompt embeds this
 * text so it never promises anything outside it.
 *
 * Grounded in the REAL registry: ids match config.json `apps[].id` byte for
 * byte (see lib/appIds.ts). `routable` mirrors TARGET_APPS in ../types.ts —
 * only those studios consume a Verger brief via the shared handoff; the rest
 * can be OPENED but a brief would be dropped on their floor.
 */

export type ToolCost = 'free' | 'video_seconds' | 'render_compute';

export interface VergerToolCapability {
  id: string;
  name: string;
  kind: 'studio' | 'media' | 'ai';
  input: string;
  output: string;
  cost: ToolCost;
  approvalRequired: boolean;
  execution: string;
  limits: string[];
}

export interface AppCapability {
  /** config.json app id. */
  id: string;
  name: string;
  does: string;
  inputs: string;
  output: string;
  /** True when saveVidvergeHandoff carries a brief into it. */
  routable: boolean;
  limits: string[];
}

export const CAPABILITIES: AppCapability[] = [
  {
    id: 'vidverge-engine',
    name: 'Video Engine',
    does: 'Autonomous image/video generation and code-driven motion-graphics production used across Vidverge workflows.',
    inputs: 'Creative brief, source assets, references and production direction.',
    output: 'Generated visual assets and finished MP4 motion/video work.',
    routable: false,
    limits: ['Open it directly for hands-on production; it does not consume Verger\u2019s shared brief handoff yet.'],
  },
  {
    id: 'sceneforge',
    name: 'SceneForge',
    does: 'Presenter-led avatar video: HeyGen presenter, ElevenLabs voice, agent-planned motion graphics and B-roll.',
    inputs: 'Script or idea; presenter + voice choices; style/niche/music choices.',
    output: 'One 16:9 master AND a native 9:16 portrait layout, MP4.',
    routable: true,
    limits: ['Credits charged once per video (1 credit = 1 second) before the avatar render.', 'Long scripts are chunked; drafts come as four 5s style previews to pick from.'],
  },
  {
    id: 'script-to-video',
    name: 'Script-to-Video',
    does: 'Turns a script (yours or AI-drafted) into a shot-by-shot film with cast sheets, storyboard and per-scene model routing.',
    inputs: 'Script or idea; optional @name character references and brand kit.',
    output: 'Finished MP4 film, scene by scene.',
    routable: true,
    limits: ['Per-clip caps: Gemini Omni 8s (720p, up to 10 refs), Seedance 2.5 4–30s, Kling 5s/10s silent.', 'The user\u2019s own script wording is never replaced without acceptance.'],
  },
  {
    id: 'faceless',
    name: 'Faceless',
    does: 'Narration-first faceless film timed to the spoken words, with editorial QA.',
    inputs: 'Topic or script; voice and style choices.',
    output: 'Finished narration-led MP4.',
    routable: true,
    limits: ['No on-camera presenter — use SceneForge for that.'],
  },
  {
    id: 'video-enhancer',
    name: 'Video Enhancer',
    does: 'Hands-on editing of footage the user already has: transcript cuts, silence/filler removal, captions, overlays, reframing, multi-format export.',
    inputs: 'Uploaded footage.',
    output: 'Edited MP4 in chosen aspect ratios.',
    routable: true,
    limits: ['Edits existing footage; it does not generate new scenes from text.'],
  },
  {
    id: 'ads-studio',
    name: 'Vergeye Ads Studio',
    does: 'Brand research → competitor findings → ranked creative angles → ad production (video via Script-to-Video, plus image/content assets).',
    inputs: 'Brand website or profile; campaign goal.',
    output: 'Campaign assets: ad videos, statics, copy.',
    routable: true,
    limits: ['Shows expected video credits before production.', 'Never fabricates testimonials or unsubstantiated competitor claims.'],
  },
  {
    id: 'cineagent',
    name: 'Studio (CineAgent)',
    does: 'Fully autonomous editor: upload raw footage, receive a directed, scored, reviewed 1080p cut.',
    inputs: 'Uploaded raw footage.',
    output: 'Autonomous 1080p MP4 cut.',
    routable: false,
    limits: ['No scene/prompt/timeline controls — use Video Enhancer for hands-on edits.', 'Open it directly; a Verger brief is not carried in.'],
  },
  {
    id: 'brand-context',
    name: 'Brand Kit',
    does: 'Reads a public website and saves verified brand context (identity, offer, audience, visuals) that studios reuse.',
    inputs: 'Public website URL.',
    output: 'Saved reusable brand profile.',
    routable: false,
    limits: ['A setup surface, not a generator.', 'Open it directly; a Verger brief is not carried in.'],
  },
];

/**
 * The only tool registry the planner may promise. Studio entries delegate to
 * the existing product surfaces/server functions; media entries are called by
 * Verger directly. Adding a tool anywhere else does not make it available.
 */
export const TOOL_REGISTRY: VergerToolCapability[] = [
  ...CAPABILITIES.map((app): VergerToolCapability => ({
    id: `studio.${app.id}`,
    name: app.name,
    kind: 'studio',
    input: app.inputs,
    output: app.output,
    cost: app.id === 'brand-context' || app.id === 'video-enhancer' ? 'free' : 'video_seconds',
    approvalRequired: app.id !== 'brand-context' && app.id !== 'video-enhancer',
    execution: app.routable ? `Prefilled handoff to existing app ${app.id}; its registered worker owns the durable job.` : `Open existing app ${app.id}; no brief handoff contract is available.`,
    limits: app.limits,
  })),
  {
    id: 'media.trim',
    name: 'Server video trim',
    kind: 'media',
    input: 'Public source video URL and floating-point start/end seconds.',
    output: 'Permanent MP4 clip.',
    cost: 'free',
    approvalRequired: false,
    execution: 'POST /api/video/clip',
    limits: ['Maximum 10 minutes per call; Verger visual edits always trim at most 8 seconds.'],
  },
  {
    id: 'media.frames',
    name: 'Server frame sampler',
    kind: 'media',
    input: 'Public video URL and 1–20 timestamps.',
    output: 'Permanent PNG frame URLs.',
    cost: 'free',
    approvalRequired: false,
    execution: 'POST /api/video/frames',
    limits: ['At most 20 timestamps per request.'],
  },
  {
    id: 'ai.vision-edit-prompt',
    name: 'Vision edit prompt director',
    kind: 'ai',
    input: 'Sampled frame URLs, exact timestamp and plain-language edit request.',
    output: 'Detailed preserve/change/timing instruction.',
    cost: 'free',
    approvalRequired: false,
    execution: 'Authenticated gpt-6.1-sol image-input call through /proxy/openai/v1/chat/completions.',
    limits: ['Interactive tier: reasoning_effort medium and max_completion_tokens 6000.'],
  },
  {
    id: 'video.omni-flash-edit',
    name: 'Omni Flash source-video edit',
    kind: 'media',
    input: 'Public <=8s MP4/WebM/QuickTime/MPEG/FLV/WMV/3GPP clip, detailed prompt and source timestamp.',
    output: 'Edited MP4 clip, later spliced into the source.',
    cost: 'video_seconds',
    approvalRequired: true,
    execution: 'Authenticated POST /api/veo/generate/video with model gemini-omni-1.1-flash, videoData and videoMimeType.',
    limits: ['Maximum 8 seconds, 16:9 or 9:16, 720p.', 'One submit only; never automatically retry a paid edit.', 'UI estimates 8 credits before submission.'],
  },
  {
    id: 'media.splice',
    name: 'Server video splice',
    kind: 'media',
    input: 'Ordered permanent MP4 URLs (original prefix, edited clip, original suffix).',
    output: 'Verified permanent MP4 and catalog record.',
    cost: 'render_compute',
    approvalRequired: false,
    execution: 'POST /api/workspaces/:workspaceId/videos/stitch',
    limits: ['Plain concatenation; trim every segment first.', 'Failure is automatically wallet-refunded by the platform.'],
  },
];

/** Hard platform limits that apply to EVERYTHING Verger plans. */
export const GLOBAL_LIMITS: string[] = [
  'Pricing meter: 1 credit = 1 second of finished video, every provider. Only video GENERATION spends credits — conversation, scripts, storyboards and research are free.',
  'ALWAYS state the credit cost and get an explicit yes BEFORE any step that spends credits.',
  'Output is MP4 only (no transparent WebM); server renders are 1920×1080 @ 30fps (portrait is composed natively then delivered 9:16). No engine delivers 4K — never promise it. SceneForge and Faceless can use ElevenLabs premade voices without Voice Studio.',
  'Live engines: Gemini Omni 1.1 Flash (default), Seedance 2.5, Kling Omni 3.0, OpenRouter Veo 3.1 variants. Veo 3.0/2.0 and Sora are broken — never promise them.',
  'Omni Flash source-video editing accepts videoData plus videoMimeType, at most 8 seconds, 16:9/9:16 and 720p. Visual edits trim first, analyse sampled frames, ask approval, submit once, then splice server-side.',
  'Every provider call sends X-Workspace-DB-Token. Long-running provider work persists its operation id before polling so closing the tab does not re-submit or re-spend.',
  'Never overwrite work the user is actively editing; propose, then let them accept.',
];

export function appCapability(id: unknown): AppCapability | null {
  if (typeof id !== 'string') return null;
  return CAPABILITIES.find((c) => c.id === id) || null;
}

/** Ids Verger may open with a prefilled brief. */
export function routableAppIds(): string[] {
  return CAPABILITIES.filter((c) => c.routable).map((c) => c.id);
}

/** Every retained production app Verger may open, including open-only tools. */
export function openableAppIds(): string[] {
  return CAPABILITIES.map((c) => c.id);
}

/** The manifest rendered for the system prompt. */
export function toolRegistryText(): string {
  return TOOL_REGISTRY.map((tool) =>
    `• ${tool.id} — ${tool.name}\n  input: ${tool.input}\n  output: ${tool.output}\n  execution: ${tool.execution}\n  cost: ${tool.cost}; approval: ${tool.approvalRequired ? 'required' : 'not required'}\n  limits: ${tool.limits.join(' ')}`,
  ).join('\n');
}

export function capabilityManifestText(): string {
  const apps = CAPABILITIES.map((c) => {
    const route = c.routable ? 'routable: Verger can open it with a prefilled brief' : 'open only: a brief is NOT carried in';
    return `• ${c.name} (id ${c.id}) — ${c.does}\n  inputs: ${c.inputs}\n  output: ${c.output}\n  ${route}\n  limits: ${c.limits.join(' ')}`;
  }).join('\n');
  return `APPS:\n${apps}\n\nHARD PLATFORM LIMITS:\n${GLOBAL_LIMITS.map((l) => `• ${l}`).join('\n')}`;
}
