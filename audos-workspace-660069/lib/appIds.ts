/**
 * REGISTERED APP IDS — the identity every generation job is recorded against.
 *
 * `POST /api/veo/generate/video` and `POST /api/veo/generate/image` write a
 * row per job keyed to an app in the platform's `apps` table. An id with no
 * matching row is refused by the `veo_generations_app_id_apps_id_fk`
 * constraint, and because that rejection happens on the INSERT the clip is
 * never generated at all.
 *
 * This is what broke VFX Drop on live. `window.__APP_ID__` and
 * `window.__SPACE_ID__` both resolve to the SPACE ('workspace-660069'), which
 * is not an `apps` row, so reading the id off the window could only ever
 * produce a foreign-key violation. Surfaces must name their own id instead,
 * which is why these are hardcoded constants rather than a runtime lookup.
 *
 * Every value below is byte-identical to an `apps[].id` in config.json. If an
 * app is renamed or added there, change it here in the same edit — a drifted
 * id fails at generation time, not at compile time.
 */

export const APP_IDS = {
  vidvergeAgent: 'vidverge-agent',
  phantom: 'phantom',
  videoEnhancer: 'video-enhancer',
  scriptToVideo: 'script-to-video',
  sceneForge: 'sceneforge',
  adsStudio: 'ads-studio',
  saasVerger: 'saas-verger',
  facelessContent: 'faceless-content',
  productLaunch: 'product-launch',
  shortVideoEnhancer: 'short-video-enhancer',
  voiceStudio: 'voice-studio',
  vfxDrop: 'vfx-drop',
} as const;

export type AppId = (typeof APP_IDS)[keyof typeof APP_IDS];

const ALL_APP_IDS: readonly string[] = Object.keys(APP_IDS).map((key) => APP_IDS[key as keyof typeof APP_IDS]);

/** True when `id` is one of the twelve ids the platform has an app row for. */
export function isRegisteredAppId(id: unknown): id is AppId {
  return typeof id === 'string' && ALL_APP_IDS.indexOf(id) >= 0;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * The proxy's model enum accepts exactly one spelling of each engine. These
 * two are the full ids from the Group A catalog in ./videoEngines.ts — in
 * particular the fast Veo engine is `veo-3.1-fast-generate-preview`; the
 * shorthand `veo-3.1-fast` is not in the enum and answers 400.
 */
export const OMNI_FLASH_MODEL = 'gemini-omni-flash-preview';
export const VEO_31_FAST_MODEL = 'veo-3.1-fast-generate-preview';

export interface ModelChoice {
  id: string;
  label: string;
  hint: string;
}

/** The two engines offered wherever an app exposes a model dropdown. */
export const MODEL_CHOICES: ModelChoice[] = [
  {
    id: OMNI_FLASH_MODEL,
    label: 'Gemini Omni Flash',
    hint: 'Keeps a face, product or character consistent across shots. Best default.',
  },
  {
    id: VEO_31_FAST_MODEL,
    label: 'Veo 3.1 Fast',
    hint: 'Faster and cheaper per clip. Best for short standalone shots.',
  },
];

/**
 * The engine each surface leads with. Character- and continuity-heavy apps
 * default to Omni Flash because it is the only Group A model that holds a
 * subject across separate requests; the short-clip enhancers default to Veo
 * 3.1 Fast, where turnaround matters more than cross-shot consistency.
 */
export const DEFAULT_MODEL_BY_APP: Record<AppId, string> = {
  [APP_IDS.sceneForge]: OMNI_FLASH_MODEL,
  [APP_IDS.vfxDrop]: OMNI_FLASH_MODEL,
  [APP_IDS.facelessContent]: OMNI_FLASH_MODEL,
  [APP_IDS.shortVideoEnhancer]: VEO_31_FAST_MODEL,
  [APP_IDS.videoEnhancer]: VEO_31_FAST_MODEL,
  [APP_IDS.vidvergeAgent]: OMNI_FLASH_MODEL,
  [APP_IDS.phantom]: OMNI_FLASH_MODEL,
  [APP_IDS.scriptToVideo]: OMNI_FLASH_MODEL,
  [APP_IDS.adsStudio]: OMNI_FLASH_MODEL,
  [APP_IDS.saasVerger]: OMNI_FLASH_MODEL,
  [APP_IDS.productLaunch]: OMNI_FLASH_MODEL,
  [APP_IDS.voiceStudio]: OMNI_FLASH_MODEL,
};

export function defaultModelFor(appId: AppId): string {
  return DEFAULT_MODEL_BY_APP[appId] || OMNI_FLASH_MODEL;
}

/** Fall back to the app's default rather than forwarding a model the enum rejects. */
export function safeModelFor(appId: AppId, requested: string | null | undefined): string {
  const wanted = String(requested || '');
  return MODEL_CHOICES.some((choice) => choice.id === wanted) ? wanted : defaultModelFor(appId);
}
