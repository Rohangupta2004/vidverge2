import type { ScriptToVideoHandoff } from './vidvergeHandoff';

export const VERGEYE_VIDEO_PRODUCTION_VERSION = '2026-10-21.phase4';
export const VERGEYE_STYLE_ENGINE_VERSION = 'vergeye.video-style.v1';
export const VERGEYE_CAPABILITY_REGISTRY_VERSION = 'vergeye.video-capabilities.2026-10-21.v2';

export type VergeyeVideoStyleId =
  | 'ugc-ad' | 'talking-head' | 'cinematic' | 'saas-launch'
  | 'competitive-differentiation' | 'motion-graphics' | 'explainer'
  | 'social-short' | 'custom';
export type VergeyeRouterMode = 'automatic' | 'manual' | 'hybrid';
export type VergeyeModelId = 'seedance-2.5' | 'kling-3.0-omni' | 'omni-1.1-flash';

export interface VergeyeStyleConfiguration {
  id: VergeyeVideoStyleId;
  label: string;
  scriptRules: string[];
  visualPreset: string;
  shotPreferences: string[];
  audioDirection: string;
  defaultAspect: '16:9' | '9:16';
  preferredModel: VergeyeModelId;
  productionWorkflow: 'script-to-video' | 'product-launch-components' | 'remotion-composition';
  compatibleWith: VergeyeVideoStyleId[];
  guardrails: string[];
}

export const VERGEYE_VIDEO_STYLES: Record<VergeyeVideoStyleId, VergeyeStyleConfiguration> = {
  'ugc-ad': {
    id: 'ugc-ad', label: 'UGC ad', defaultAspect: '9:16', preferredModel: 'omni-1.1-flash', productionWorkflow: 'script-to-video',
    scriptRules: ['Open with a natural first-person hook in the first two seconds.', 'Use a problem, discovery, proof and CTA arc.', 'Never present invented dialogue as a real customer testimonial or endorsement.'],
    visualPreset: 'Creator-shot vertical video, authentic handheld framing, natural available light, polished but not overproduced.',
    shotPreferences: ['direct-to-camera hook', 'product-in-hand proof', 'tight reaction insert', 'clear CTA close'],
    audioDirection: 'Natural creator delivery, light room tone, captions composed after generation.',
    compatibleWith: ['social-short', 'talking-head', 'explainer'],
    guardrails: ['No fabricated testimonial claims.', 'Label dramatised scenarios when required.'],
  },
  'talking-head': {
    id: 'talking-head', label: 'Talking head', defaultAspect: '9:16', preferredModel: 'seedance-2.5', productionWorkflow: 'script-to-video',
    scriptRules: ['Presenter leads every claim.', 'Keep sentences speakable and preserve exact approved wording.', 'Use cutaways only when they clarify the presenter.'],
    visualPreset: 'Presenter-led portrait film with a stable approved cast sheet, clean eyeline and restrained branded environment.',
    shotPreferences: ['medium presenter', 'tight emphasis', 'approved product cutaway', 'presenter CTA'],
    audioDirection: 'Presenter dialogue is primary; music stays low and captions are deterministic overlays.',
    compatibleWith: ['ugc-ad', 'cinematic', 'explainer', 'social-short'],
    guardrails: ['Preferred generation model is Seedance 2.5.', 'Do not clone or imply a real person without an approved reference.'],
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', defaultAspect: '16:9', preferredModel: 'seedance-2.5', productionWorkflow: 'script-to-video',
    scriptRules: ['Write visual action rather than abstract adjectives.', 'Give every beat a motivated transition and a stable continuity endpoint.', 'Reserve copy for deterministic composition.'],
    visualPreset: 'Premium cinematic naturalism, intentional lens language, motivated camera movement and a controlled brand palette.',
    shotPreferences: ['cinematic opening', 'motivated reveal', 'product hero movement', 'resolved end frame'],
    audioDirection: 'Optional native ambience, authored VO and a music arc that supports transitions.',
    compatibleWith: ['talking-head', 'saas-launch', 'explainer'],
    guardrails: ['Never sacrifice script coverage to fit one clip.', 'Split into legal dependent blocks.'],
  },
  'saas-launch': {
    id: 'saas-launch', label: 'SaaS Launch', defaultAspect: '16:9', preferredModel: 'omni-1.1-flash', productionWorkflow: 'product-launch-components',
    scriptRules: ['Lead with the user outcome, then demonstrate the approved product flow.', 'Use existing Product Launch component grammar for UI motion.', 'Only describe screens supplied by the brand or captured from the real product.'],
    visualPreset: 'Code-driven SaaS launch film combining real approved UI, product mockups and restrained cinematic transitions.',
    shotPreferences: ['outcome hook', 'real UI demo', 'feature proof', 'branded result', 'CTA plate'],
    audioDirection: 'Concise launch VO, UI-led sound design and exact text composed in code.',
    compatibleWith: ['cinematic', 'motion-graphics', 'explainer'],
    guardrails: ['Never fabricate product interfaces.', 'Use real/approved screenshots and Product Launch components.'],
  },
  'competitive-differentiation': {
    id: 'competitive-differentiation', label: 'Competitive Differentiation', defaultAspect: '16:9', preferredModel: 'omni-1.1-flash', productionWorkflow: 'remotion-composition',
    scriptRules: ['Compare customer outcomes and decision criteria.', 'Do not name competitors by default.', 'Named claims require approved evidence and human review.'],
    visualPreset: 'Evidence-led comparison film with precise split layouts, sourced proof and neutral visual language.',
    shotPreferences: ['category tension', 'criteria comparison', 'substantiated proof', 'positioning close'],
    audioDirection: 'Measured explanatory VO; exact comparison text is composed, never AI-rendered.',
    compatibleWith: ['explainer', 'motion-graphics', 'saas-launch'],
    guardrails: ['No unsubstantiated superiority claims.', 'No competitor marks without permission.'],
  },
  'motion-graphics': {
    id: 'motion-graphics', label: 'Motion Graphics', defaultAspect: '16:9', preferredModel: 'omni-1.1-flash', productionWorkflow: 'remotion-composition',
    scriptRules: ['Express one idea per composition beat.', 'Keep all exact wording in deterministic text layers.', 'Use generated imagery only as background or texture.'],
    visualPreset: 'Precise code-driven composition with kinetic type, charts, product assets and brand-safe transitions.',
    shotPreferences: ['kinetic hook', 'diagram or metric', 'layered product proof', 'exact CTA plate'],
    audioDirection: 'Beat-aware motion, authored VO and designed SFX; no AI-generated text in footage.',
    compatibleWith: ['saas-launch', 'competitive-differentiation', 'explainer'],
    guardrails: ['Prefer Remotion/composition for text.', 'Do not ask video models to spell brand copy.'],
  },
  explainer: {
    id: 'explainer', label: 'Explainer', defaultAspect: '16:9', preferredModel: 'omni-1.1-flash', productionWorkflow: 'script-to-video',
    scriptRules: ['State the problem, mechanism, proof and next step.', 'Use plain language and one learning objective per scene.', 'Mark hypotheses and unsupported claims.'],
    visualPreset: 'Clear product explainer mixing presenter, approved UI and simple diagrams.',
    shotPreferences: ['problem setup', 'mechanism visual', 'worked example', 'proof', 'CTA'],
    audioDirection: 'Warm instructional VO, moderate pace, light music and readable captions.',
    compatibleWith: ['talking-head', 'motion-graphics', 'social-short'],
    guardrails: ['Do not turn analysis into factual evidence.'],
  },
  'social-short': {
    id: 'social-short', label: 'Social Short', defaultAspect: '9:16', preferredModel: 'omni-1.1-flash', productionWorkflow: 'script-to-video',
    scriptRules: ['Hook in the first two seconds.', 'Use short spoken lines and visual pattern changes.', 'End with one explicit CTA.'],
    visualPreset: 'Fast vertical short with safe-zone composition, strong opening motion and deterministic captions.',
    shotPreferences: ['scroll-stopping hook', 'two fast proof beats', 'pattern interrupt', 'CTA close'],
    audioDirection: 'Punchy dialogue/VO, captions always on, music ducked under speech.',
    compatibleWith: ['ugc-ad', 'talking-head', 'explainer'],
    guardrails: ['Default to 9:16.', 'Do not silently shorten the requested runtime.'],
  },
  custom: {
    id: 'custom', label: 'Custom Style', defaultAspect: '16:9', preferredModel: 'omni-1.1-flash', productionWorkflow: 'script-to-video',
    scriptRules: ['Combine only compatible style configurations.', 'Write each transition between styles explicitly.', 'Preserve one brand look and one continuity plan.'],
    visualPreset: 'Creator-selected blend over the same Script-to-Video engine.',
    shotPreferences: ['cinematic opening', 'approved product demo', 'talking-head close'],
    audioDirection: 'One coherent mix plan across all combined sections.',
    compatibleWith: ['cinematic', 'saas-launch', 'talking-head', 'motion-graphics', 'explainer', 'social-short'],
    guardrails: ['A combination is configuration, never a second storyboard or renderer.'],
  },
};

export interface VergeyeModelCapability {
  registryVersion: typeof VERGEYE_CAPABILITY_REGISTRY_VERSION;
  id: VergeyeModelId;
  exactApiModelId: string;
  providerModelId?: string;
  inputTypes: string[];
  duration: { minSeconds: number; maxSeconds: number; discreteSeconds?: number[]; behavior: string };
  resolutions: string[];
  aspectRatios: string[];
  audio: string;
  referenceImages: { min: number; max: number; rules: string };
  editingOperations: string[];
  editingVerification?: {
    verifiedMode: string;
    inputRequirement: string;
    affects: string;
    unverifiedShortcuts: string[];
    uiPolicy: string;
  };
  latency: string;
  creditCost: string;
  rateLimits: string;
  availability: string;
  fallback: string;
  verification: { docsCheckedAt: string; liveOutcome: 'pass' | 'inconclusive'; evidence: string };
}

export const VERGEYE_VIDEO_CAPABILITIES: Record<VergeyeModelId, VergeyeModelCapability> = {
  'seedance-2.5': {
    registryVersion: VERGEYE_CAPABILITY_REGISTRY_VERSION, id: 'seedance-2.5', exactApiModelId: 'openrouter/bytedance/seedance-2.5',
    inputTypes: ['text', 'first frame', 'first + last frame', '1–3 asset reference images'],
    duration: { minSeconds: 4, maxSeconds: 30, behavior: 'Every whole second from 4 through 30; plan multiple blocks for longer requests.' },
    resolutions: ['480p', '720p'], aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    audio: 'Optional generated audio.', referenceImages: { min: 0, max: 3, rules: 'Asset references cannot be combined with first/last frames.' },
    editingOperations: ['first-frame animation', 'first/last interpolation'], latency: 'Asynchronous; no guaranteed ETA is published.',
    creditCost: 'Admission estimate uses video tokens; final wallet settlement uses provider usage.cost. Quote/receipt is authoritative.',
    rateLimits: 'No fixed limit published by the proxy; surface HTTP 429 and honor Retry-After.', availability: 'Catalogued and observed returning a playable 30s MP4.',
    fallback: 'On failure, switch only the affected block to Gemini Omni 1.1 Flash and record the model switch.',
    verification: { docsCheckedAt: '2026-10-21', liveOutcome: 'pass', evidence: 'Platform image-and-video-generation contract plus Video Provider Lab recorded playable output on the exact id.' },
  },
  'kling-3.0-omni': {
    registryVersion: VERGEYE_CAPABILITY_REGISTRY_VERSION, id: 'kling-3.0-omni', exactApiModelId: 'kling-3.0-omni', providerModelId: 'kling-v3-omni',
    inputTypes: ['text', 'first frame', 'first + last frame', '2–4 reference images'],
    duration: { minSeconds: 5, maxSeconds: 10, discreteSeconds: [5, 10], behavior: 'The current Audos proxy exposes only 5s or 10s blocks. Upstream 15s behavior is not proxy support and is not used.' },
    resolutions: ['720p (std)', '1080p (pro)'], aspectRatios: ['16:9', '9:16', '1:1'],
    audio: 'Silent on the current proxy.', referenceImages: { min: 2, max: 4, rules: 'Multi-image references use @image_1…@image_4; continuation uses the first-frame route.' },
    editingOperations: ['first/last interpolation', 'lip-sync on a finished task', 'legacy-source extension only'], latency: 'Asynchronous; poll every five seconds. No guaranteed ETA.',
    creditCost: '$0.084/s std or $0.112/s pro for Kling 3.0 Omni under the documented proxy contract.',
    rateLimits: 'No fixed limit published; surface HTTP 429 and honor Retry-After.', availability: 'Contract catalog is available; account entitlement and a paid end-to-end output remain unverified.',
    fallback: 'Kling failure → Gemini Omni 1.1 Flash for the affected block. If Omni also fails, stop and ask before Seedance 2.5.',
    verification: { docsCheckedAt: '2026-10-21', liveOutcome: 'inconclusive', evidence: 'Kling integration docs and real models-catalog behavior; no paid generation was run in Phase 3.' },
  },
  'omni-1.1-flash': {
    registryVersion: VERGEYE_CAPABILITY_REGISTRY_VERSION, id: 'omni-1.1-flash', exactApiModelId: 'gemini-omni-1.1-flash',
    inputTypes: ['text', 'first frame', 'first + last frame', 'seed + up to 10 references', 'source video edit'],
    duration: { minSeconds: 2, maxSeconds: 8, behavior: 'Up to 8 seconds per block; split longer requested coverage without dropping words.' },
    resolutions: ['720p'], aspectRatios: ['16:9', '9:16'], audio: 'Optional generated audio.',
    referenceImages: { min: 0, max: 10, rules: 'References may combine with a seed; last-frame interpolation cannot combine with references.' },
    editingOperations: ['first/last interpolation', 'prompt-based existing-video edit via videoData'],
    editingVerification: {
      verifiedMode: 'A short prompt-based edit of an existing source clip.',
      inputRequirement: 'The selected existing clip must be sent as videoData with optional videoMimeType; compatible blocks are 2–8 seconds in the current editor.',
      affects: 'Only the selected shot revision; originals and every other scene remain immutable until the user accepts the preview.',
      unverifiedShortcuts: ['background change', 'object change', 'lighting change', 'appearance change'],
      uiPolicy: 'Expose one generic prompt-based edit. Hide or disable semantic shortcut buttons until the configured proxy contract verifies them individually.',
    },
    latency: 'Fast asynchronous safety/edit route; no guaranteed ETA.',
    creditCost: 'Provider response/receipt is authoritative; no stable universal per-second rate is documented.',
    rateLimits: 'No fixed limit published; surface HTTP 429 and honor Retry-After.', availability: 'Default platform video model and observed returning playable output.',
    fallback: 'Terminal fallback. If this also fails, stop and request creator authorization before switching to Seedance 2.5.',
    verification: { docsCheckedAt: '2026-10-21', liveOutcome: 'pass', evidence: 'Platform image-and-video-generation and google-veo3 contracts explicitly document videoData source-video editing. They do not separately guarantee background, object, lighting or appearance edit categories.' },
  },
};

export interface VergeyeRoutingInput {
  mode: VergeyeRouterMode;
  durationSeconds: number;
  styleId: VergeyeVideoStyleId;
  complexity?: 'low' | 'medium' | 'high';
  characterConsistency?: boolean;
  productReferenceCount?: number;
  cameraMovement?: 'static' | 'moderate' | 'complex';
  needsAudioOrDialogue?: boolean;
  needsSourceVideoEdit?: boolean;
  aspectRatio?: string;
  resolution?: string;
  availableModels?: VergeyeModelId[];
  manualModel?: VergeyeModelId;
  historicalFailures?: Partial<Record<VergeyeModelId, number>>;
}

export interface VergeyeRoutingDecision {
  model: VergeyeModelId | null;
  exactApiModelId: string | null;
  reason: string;
  restrictions: string[];
  estimatedCost: string;
  fallback: VergeyeModelId[];
  available: boolean;
}

export function routeVergeyeScene(input: VergeyeRoutingInput): VergeyeRoutingDecision {
  const available = new Set(input.availableModels || (Object.keys(VERGEYE_VIDEO_CAPABILITIES) as VergeyeModelId[]));
  const style = VERGEYE_VIDEO_STYLES[input.styleId] || VERGEYE_VIDEO_STYLES.custom;
  const restrictions: string[] = [];
  const failures = input.historicalFailures || {};
  const supports = (id: VergeyeModelId) => {
    const duration = VERGEYE_VIDEO_CAPABILITIES[id].duration;
    return available.has(id)
      && input.durationSeconds >= duration.minSeconds
      && input.durationSeconds <= duration.maxSeconds
      && (!duration.discreteSeconds || duration.discreteSeconds.includes(input.durationSeconds));
  };
  let model: VergeyeModelId | null = null;
  if (input.mode === 'manual' || (input.mode === 'hybrid' && input.manualModel)) {
    model = input.manualModel || null;
    if (!model) restrictions.push('Choose a model for this scene.');
  } else if (input.needsSourceVideoEdit) model = supports('omni-1.1-flash') ? 'omni-1.1-flash' : null;
  else if (input.styleId === 'talking-head' && supports('seedance-2.5')) model = 'seedance-2.5';
  else if (input.characterConsistency && (input.productReferenceCount || 0) >= 2 && !input.needsAudioOrDialogue && supports('kling-3.0-omni')) model = 'kling-3.0-omni';
  else if ((input.durationSeconds > 8 || input.cameraMovement === 'complex' || input.styleId === 'cinematic') && supports('seedance-2.5')) model = 'seedance-2.5';
  else if (supports(style.preferredModel)) model = style.preferredModel;
  else if (supports('omni-1.1-flash')) model = 'omni-1.1-flash';
  else if (supports('seedance-2.5')) model = 'seedance-2.5';
  if (model && !available.has(model)) { restrictions.push(`${model} is unavailable.`); model = null; }
  const chosenDuration = model ? VERGEYE_VIDEO_CAPABILITIES[model].duration : null;
  const durationValid = !chosenDuration || (input.durationSeconds >= chosenDuration.minSeconds
    && input.durationSeconds <= chosenDuration.maxSeconds
    && (!chosenDuration.discreteSeconds || chosenDuration.discreteSeconds.includes(input.durationSeconds)));
  if (model && !durationValid) restrictions.push(chosenDuration?.discreteSeconds
    ? `${model} accepts only ${chosenDuration.discreteSeconds.join('s or ')}s blocks. Split or rebalance the plan; never truncate it.`
    : `Split this ${input.durationSeconds}s scene into legal ${chosenDuration?.minSeconds}–${chosenDuration?.maxSeconds}s blocks; never truncate it.`);
  if (model === 'kling-3.0-omni' && input.needsAudioOrDialogue) restrictions.push('Kling is silent on the current proxy; use authored VO in finishing or choose Seedance/Omni.');
  if (model && Number(failures[model] || 0) > 1) restrictions.push(`${model} has ${failures[model]} recorded failures; review the recommendation before approval.`);
  const capability = model ? VERGEYE_VIDEO_CAPABILITIES[model] : null;
  const reason = !model ? 'No available model satisfies this scene without changing its requirements.'
    : input.mode === 'manual' ? `Manual assignment: ${capability!.exactApiModelId}.`
      : input.mode === 'hybrid' && input.manualModel ? `Hybrid assignment retained: ${capability!.exactApiModelId}.`
        : `${style.label}: ${capability!.exactApiModelId} best matches this scene’s duration, references, motion and audio needs.`;
  return { model, exactApiModelId: capability?.exactApiModelId || null, reason, restrictions, estimatedCost: capability?.creditCost || 'Unavailable', fallback: model === 'kling-3.0-omni' ? ['omni-1.1-flash'] : model === 'omni-1.1-flash' ? [] : ['omni-1.1-flash'], available: Boolean(model) && durationValid };
}

function styleIdFor(subtype: unknown): VergeyeVideoStyleId {
  const value = String(subtype || '').toLowerCase();
  if (value.includes('ugc')) return 'ugc-ad';
  if (value.includes('talking head')) return 'talking-head';
  if (value.includes('cinematic')) return 'cinematic';
  if (value.includes('saas')) return 'saas-launch';
  if (value.includes('competitive')) return 'competitive-differentiation';
  if (value.includes('motion')) return 'motion-graphics';
  if (value.includes('explainer')) return 'explainer';
  if (value.includes('social')) return 'social-short';
  return 'custom';
}

function clean(value: unknown, fallback = ''): string { return String(value || fallback).replace(/\s+/g, ' ').trim(); }
function clampDuration(value: unknown): number { const n = Math.round(Number(value) || 30); return Math.max(6, Math.min(180, n)); }

export function buildStyleSpecificScript(brief: any, styleId = styleIdFor(brief?.contentSubtype)): string {
  const style = VERGEYE_VIDEO_STYLES[styleId];
  const duration = clampDuration(brief?.durationSec);
  const namesCompetitor = styleId === 'competitive-differentiation' && brief?.claimReview === 'clear' ? '' : 'Do not name competitors; compare the customer’s current approach.';
  const uiRule = styleId === 'saas-launch' ? 'Show only real approved product UI supplied in campaign references; never invent an interface.' : '';
  const textRule = styleId === 'motion-graphics' || styleId === 'competitive-differentiation' ? 'All exact on-screen copy is added in the deterministic composition layer, never rendered inside AI footage.' : '';
  const beats = [
    { title: 'Hook', share: .2, visual: style.shotPreferences[0], line: clean(brief?.hook, `What if ${clean(brief?.brand?.name, 'this product')} changed the way you work?`) },
    { title: 'Problem', share: .2, visual: style.shotPreferences[1] || 'problem setup', line: clean(brief?.objective, brief?.campaignGoal) },
    { title: styleId === 'saas-launch' ? 'Real product demo' : 'Proof', share: .28, visual: style.shotPreferences[2] || 'product proof', line: clean(brief?.coreMessage, brief?.brand?.positioning) },
    { title: 'Outcome', share: .18, visual: style.shotPreferences[3] || 'customer outcome', line: clean(brief?.reasoning?.whyItMayWork, `Make the value of ${clean(brief?.brand?.name, 'the product')} concrete.`) },
    { title: 'CTA', share: .14, visual: style.shotPreferences[4] || 'branded close', line: clean(brief?.cta, 'Learn more.') },
  ];
  const capability = VERGEYE_VIDEO_CAPABILITIES[style.preferredModel];
  const min = capability.duration.minSeconds;
  const max = capability.duration.maxSeconds;
  const minimumSceneCount = Math.max(1, Math.ceil(duration / max));
  const maximumSceneCount = Math.max(1, Math.floor(duration / min));
  const sceneCount = Math.max(minimumSceneCount, Math.min(beats.length, maximumSceneCount));
  const selected = sceneCount >= beats.length
    ? [...beats]
    : sceneCount === 1 ? [{ ...beats[0], title: `${beats[0].title} → CTA`, line: `${beats[0].line} ${beats[4].line}` }]
      : sceneCount === 2 ? [beats[0], beats[4]]
        : [beats[0], ...beats.slice(2, 2 + sceneCount - 2), beats[4]];
  while (selected.length < sceneCount) {
    selected.splice(selected.length - 1, 0, { ...beats[2], title: `Proof ${selected.length}`, line: beats[2].line });
  }
  const baseSeconds = Math.floor(duration / sceneCount);
  let remainder = duration - (baseSeconds * sceneCount);
  const speaker = styleId === 'ugc-ad' || styleId === 'talking-head' ? 'Presenter' : 'Narrator';
  return selected.map((beat, index) => {
    const seconds = baseSeconds + (remainder-- > 0 ? 1 : 0);
    return [`Scene ${index + 1} — ${beat.title} | ${seconds} sec`, '', 'Visual:', `${beat.visual}. ${style.visualPreset} ${uiRule} ${textRule}`.trim(), '', `Dialogue — ${speaker}:`, `> "${beat.line.replace(/"/g, '’')}"`, '', `Camera: ${style.shotPreferences[index] || 'motivated continuity move'}`, '', '---'].join('\n');
  }).concat([`Overall style: ${style.visualPreset} ${style.audioDirection} ${namesCompetitor}`.trim()]).join('\n\n');
}

export function buildVergeyeVideoHandoff(brief: any): ScriptToVideoHandoff {
  const styleId = styleIdFor(brief?.contentSubtype);
  const style = VERGEYE_VIDEO_STYLES[styleId];
  const generatedScript = buildStyleSpecificScript(brief, styleId);
  const references = [brief?.brand?.logoUrl, ...(brief?.reasoning?.evidence || []).map((item: any) => item?.sourceUrl)].filter((url) => /^https?:\/\//i.test(String(url || '')));
  const durationSeconds = clampDuration(brief?.durationSec);
  const decision = routeVergeyeScene({ mode: 'automatic', durationSeconds: Math.min(durationSeconds, VERGEYE_VIDEO_CAPABILITIES[style.preferredModel].duration.maxSeconds), styleId, complexity: brief?.production?.complexity, characterConsistency: ['ugc-ad', 'talking-head'].includes(styleId), productReferenceCount: brief?.brand?.logoUrl ? 1 : 0, cameraMovement: styleId === 'cinematic' ? 'complex' : 'moderate', needsAudioOrDialogue: true, aspectRatio: brief?.aspectRatio });
  return {
    schemaVersion: 'vergeye.s2v-handoff.v1', source: 'vergeye-ads-studio', campaignId: clean(brief?.campaignId), originatingAngleId: clean(brief?.angleId), creativeBrief: brief,
    generatedScript, styleId, styleConfiguration: style, brandKit: brief?.brand || {}, campaignReferences: references,
    routerMode: 'automatic', recommendedModel: decision.model || style.preferredModel, routingReason: decision.reason,
    aspectRatio: brief?.aspectRatio === '9:16' ? '9:16' : style.defaultAspect, durationSeconds, storyboardRequired: true,
    claimReview: brief?.claimReview === 'needs_human_review' ? 'needs_human_review' : 'clear',
    productionNotes: [`Creative angle: ${clean(brief?.conceptName)} (${clean(brief?.angleId)}).`, `Style engine: ${style.label} · ${VERGEYE_STYLE_ENGINE_VERSION}.`, `Workflow: ${style.productionWorkflow}; all paid video generation remains inside Script-to-Video.`, `Router: ${decision.reason}`, ...style.guardrails, `CreativeBrief JSON: ${JSON.stringify(brief)}`],
  };
}
