/**
 * REFERENCE ONLY — the executable video pipeline lives in the workspace server
 * function registry, not in this file. Update and verify the registered
 * `generate-video`, `check-video-status`, and `video-render-watcher` functions
 * with the workspace_server_functions tool.
 *
 * CURRENT PIPELINE
 * - Generation model: `gemini-omni-flash-preview` only, submitted through
 *   POST /api/veo/generate/video with `generateAudio: true`.
 * - Before clip submission, the hook resolves one generated full-body player
 *   reference. Standalone videos own their reference; series videos reuse the
 *   persistent `player_ref_image_url` on `video_series` or
 *   `video_episode_series`. The resolved URL is copied to `video_jobs` and sent
 *   in `referenceImages` on every clip.
 * - Omni clips are dependency-based: only clip 1 starts initially. Completion
 *   polling extracts its last frame, then submits clip 2 with the same player
 *   reference plus that frame as both `firstFrame` and the supported
 *   `imageData` seed. Chaining resets at each new video, including within a
 *   series.
 * - If player-reference creation fails, generation continues text-only. If a
 *   clip's ingredient is rejected for content/likeness, only that clip switches
 *   to the legacy imageData seed path; an existing in-situation/continuity seed
 *   wins, otherwise the first ingredient becomes frame 0. Other reference
 *   failures keep the text-only escape hatch, and later clips try ingredients
 *   again.
 * - Prompts require physically believable motion: grounded footfalls, natural
 *   weight shifts, accurate hand/object contact, stable anatomy, subtle
 *   breathing and micro-expressions, and continuous movement.
 * - Product images, an optional website screenshot clip, opt-in app mockups,
 *   anti-text prompting, and bounded transient retries remain supported.
 * - `video_jobs.veo_payload` stores exact clip bodies plus sequential progress,
 *   player/series provenance, extracted frames, fallbacks, and consistency
 *   scores. `video_clips` stores normalized per-clip verification metadata.
 * - `check-video-status` and `video-render-watcher` poll one dependency at a
 *   time, CAS-gate next-clip submissions, score each consecutive pair across
 *   player identity, kit, court, lighting, and action continuity, then stitch,
 *   preserve native audio through the browser remux handoff, and deduplicate
 *   notifications. Scoring errors never block delivery.
 *
 * IMAGE-ANCHOR VERDICT (Aug 26 2026)
 * - Controlled retest of the same photoreal studio headshot from video_jobs
 *   rows 73/74: all 3 new ingredient renders were rejected for policy/likeness,
 *   and all 3 remained blocked after both prompt-only safety rewrites. The same
 *   image had completed 2/2 renders through the old startImage seed path on Aug
 *   13, but the post-change seed fallback control was also rejected before and
 *   after its prompt rewrite. Seed fallback is therefore a bounded recovery,
 *   not a guarantee. A stylized/animated ingredient anchor still passes cleanly.
 * - Recent production telemetry also contains an explicit real-person/likeness
 *   ingredient rejection among otherwise successful anchored jobs. The result
 *   is decisive enough to stop treating prompt rewrites as the first recovery:
 *   photoreal ingredients are screened at least as strictly as seed images and
 *   can fail consistently even when the prompt contains no real-person name.
 *
 * INGREDIENT ANCHOR / FALLBACK
 * - Keep referenceImages as the default because successful renders start on
 *   action instead of a portrait card. On a content/likeness rejection, retry
 *   that clip once without referenceImages and with top-level imageData: reuse
 *   its existing in-situation/continuity frame when present (the Create clients
 *   still generate one), otherwise seed from the rejected first ingredient.
 * - The fallback is recorded in veo_payload.anchorSeedFallbacks while the exact
 *   replacement body and operation remain in { mode:'clips', clips, operations }.
 *   If seed mode is also rejected, the normal bounded prompt-safety retry and
 *   permanent blocked-scene behavior apply. Other clips remain ingredient-mode.
 *
 * CUSTOMER TOOLS
 * - `produce_video` -> /api/hooks/execute/workspace-660069/generate-video
 * - `check_video_status` -> /api/hooks/execute/workspace-660069/check-video-status
 *
 * The customer-facing flow and delivery wording live in
 * agent/customer-prompt.md. The app-side submission helpers live in
 * lib/reelioStudio.ts and apps/Create/studioApi.ts.
 */

export const GENERATE_VIDEO_TOOL_NAME = 'produce_video';
export const CHECK_VIDEO_STATUS_TOOL_NAME = 'check_video_status';
export const VIDEO_MODEL = 'gemini-omni-flash-preview';
export const GENERATE_VIDEO_HOOK_ENDPOINT =
  '/api/hooks/execute/workspace-660069/generate-video';
export const CHECK_VIDEO_STATUS_HOOK_ENDPOINT =
  '/api/hooks/execute/workspace-660069/check-video-status';
export const VIDEO_RENDER_WATCHER_HOOK_ENDPOINT =
  '/api/hooks/execute/workspace-660069/video-render-watcher';
