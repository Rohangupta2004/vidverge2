# Server-side pipeline durability audit

Audit date: 2026-10-23

## Required invariant

Every generation, provider poll, render, assembly, and multi-step production run must be owned by a persisted server job. A browser may upload user-selected files, send an explicit user command, and read persisted job state. Closing the tab, leaving the project, or switching studios must not stop work.

## Changes made in this pass

- **SceneForge**: `apps/SceneForge/App.tsx` now performs read-only `getProject` refreshes. It no longer calls the pipeline `tick` operation from its polling effect. `ForgeProductionBoard.tsx` now treats review as a paused approval state: the active phase does not spin while approval is required, and Approve / Regenerate / Edit are enabled only for the single persisted `review_step`.
- **Script-to-Video**: new automatic starts no longer select the signed-in-tab fallback. Provider work is routed to the durable server start; a provider that lacks server credentials is refused before submit rather than being run by browser timers. Browser automatic advancement and reopen-time `resumeFilm` were disabled. Existing read-only WorkspaceDB refresh remains.
- **Product Motion**: Remotion submission, provider polling, retries, compile repair, portrait finishing, frame checks, and final URL adoption now use the reusable `vv-render-job` server worker. The app only reads its persisted job. `vv-render-job` gained an owner-scoped `list` operation so Product Motion can reattach to the latest job after reopen.
- **Shared orchestration**: `vv-render-job` remains the reusable rendering pattern instead of adding another app-specific render loop.

## Platform auth blocker

Workspace server functions do not receive or mint `X-Workspace-DB-Token`. The platform-managed generation endpoints below require that browser credential and return `401 no_credentials` or `401 Same-origin request required` from server functions:

- HeyGen workspace credential proxy
- ElevenLabs voiceover and music generation
- Kling submit/status
- Seedance 2.5 status and some Seedance submit paths
- some wallet-gated media finishing endpoints

`platform.secretsProxy()` is available only for founder-owned custom API keys. It cannot use Audos's platform-managed ElevenLabs key or the workspace's encrypted HeyGen provider credential. Persisting a visitor workspace token in a project row is not a safe server credential and is not an acceptable workaround. No workspace source change can close this gap while retaining the platform-managed providers.

## Registered apps

| App | Current durability | What was moved / already server-side | Remaining browser dependency |
|---|---|---|---|
| SceneForge | Partial server durable | Existing `sceneforge-pipeline` has DB checkpoints, leases, self-continuation, server Remotion and server post-production. Browser tick removed; UI now reads state only. | The server function currently persists/replays a visitor workspace token for HeyGen, ElevenLabs, Veo submit, music and portrait finishing. This must be replaced by signed server-function access in the Audos platform; no browser fallback was added. |
| Script-to-Video | Partial server durable | `stv-scene-generate` + `s2v-recovery-sweeper` already persist Omni jobs, continuity frames, assembly and recovery. New automatic browser fallback was disabled. | Kling/Seedance server submit/status is rejected by the platform credential gate. Those selections now fail before paid submit instead of requiring an open tab. Some legacy manual foreground handlers remain in source but are no longer selected by automatic Start. |
| Faceless | Finishing durable only | `faceless-finishing-worker` owns Remotion polling and persists terminal state. `faceless-assets` already owns tokenless image and Seedance 2.0 provider calls. | Main script → ElevenLabs → timing → storyboard → images → clips orchestration still runs in `apps/Faceless/lib/pipeline.ts` in the browser. ElevenLabs and timestamped transcription require the browser workspace token, so the complete move is blocked at the platform auth layer. |
| Vergeye Ads Studio | Partial | `ads-studio-worker` adopts submitted Veo clips server-side; strategy is server-side in `vergeye-creative-strategy`. | Browser still owns provider submission, parts of AI direction/vision, and GSAP/FFmpeg.wasm assembly. Server credential and a persisted campaign worker are still required. |
| Video Engine / Vidverge | Mostly durable | `vidverge-orchestrator` and `vv-render-job` own long still, clip, audit and Remotion stages with leases and sweeps. | Registry description still names narration/timing as browser-only. ElevenLabs server auth is the blocker. |
| Verger / VidvergeAgent | Server-backed control surface | Persistent conversation/run storage and `vergeye-ops`/shared workers own production calls. UI is primarily commands and state display. | Any selected downstream studio inherits that studio's provider-auth limitation. |
| Video Enhancer | Mostly server-backed export | `veh-broll-generate` submits/polls B-roll server-side; `veh-render` exports MP4 server-side. | The app contains many legacy client editing/canvas modules. Interactive preview is valid, but any path that treats browser canvas output as final render still needs conversion to `veh-render`/`vv-render-job`. |
| Video Provider Lab | Partial | `vpl-background` persists runs and `creatables-worker` adopts tokenless Veo jobs, verifies frames, saves history and notifies. | Submit remains browser-side; Seedance 2.5, Kling, Runway and some status calls require browser credentials. The Lab must remain diagnostic until signed server access exists. |
| CineAgent | Not proven durable | No dedicated active CineAgent orchestrator was found in the server registry. | The app needs migration to a persisted worker before any long post-production path can be considered tab-independent. |
| Brand Kit | No long media pipeline | URL intake/storage is server-side through `brand-kit-fetch` and `brand-kit-store`. | None relevant to long-running rendering. |

## Other folders under `apps/`

These are not registered as current dock apps, but were audited because source remains present.

| Folder | Status |
|---|---|
| AssetGenerator | One-shot browser-triggered image generation; no resumable long pipeline identified. |
| Characters | Small UI surface; no long pipeline identified. |
| Creatables | Browser submits; `creatables-worker` adopts tokenless jobs. Token-gated providers can still enter `awaiting_browser`. |
| Create | Large legacy collection with browser agentic runners, series/sports runners and local stores. Not registered; do not reactivate without moving each runner to persisted workers. |
| Mockups | Small UI surface; no long pipeline identified. |
| ModelLab | Diagnostic clients submit and poll in browser. Treat as a lab, not a durable production pipeline. |
| MotionLaunch | All registered MotionLaunch hooks are disabled; current `motionLaunchClient.ts` owns planning, generation and stitch in the browser. Not durable. |
| Phantom | Legacy `phantom-*` hooks are disabled. Current production responsibility moved to `vergeye-ops`. |
| ProductMotion | Render stage moved in this pass to `vv-render-job`; reopen now reads the persisted latest job. Vision/code generation remains interactive browser work and should eventually become a persisted planning stage. |
| ProductStudio | Large legacy studio with browser wizard/render modules. The active Product Launch `pl-*` hook family is disabled; `clipstyle-run` and Track B are the durable replacements. |
| RiveSceneGenerator | Library-only folder in the current tree; no registered app entry or long pipeline found. |
| SaaSVerger | Library/components/remotion sources only in the current tree; no registered app entry found. |
| ScreensToMotion | Client app and source modules remain; no active dedicated persisted worker was identified. |
| ShortVideoEnhancer | Retired; `sve-*` hooks are disabled. Video Enhancer is the active replacement. |
| Studio | Legacy browser studio; no active dedicated persisted orchestration worker identified. |
| VFXDrop | Client-only pipeline module; no active dedicated durable worker identified. |
| VideoModelDocs | Documentation only. |
| shared | Design tokens only. |

## Safe verification performed

- No paid provider render was triggered.
- Snapshot v520 was created before changes.
- Every source patch passed the workspace write/syntax gate.
- Server function edits were stored and re-read by the registry.

## Required platform capability

The remaining work can only be completed after Audos exposes a workspace-scoped, signed server-function path for platform-managed HeyGen, ElevenLabs, Kling and Seedance operations (submit and status), including wallet attribution to the initiating user without replaying their browser token. Once that exists, SceneForge's persisted token can be removed, Faceless can move its full state machine into a worker, and the remaining browser submit/poll paths can be retired without losing provider access or customer credit guards.
