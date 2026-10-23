# Script-to-Video big scenes, Director context, and production reliability report

Date: 2026-10-23

## What existed before this change

The app already had a large V2 pipeline: a shared video-model registry, Seedance 2.5, Kling 3.0 and Kling 3.0 Omni adapters, timed-beat fields, per-film Director history, server-side credit charging/refunds through `vv-credits`, durable film/scene checkpoints, and the `stv-scene-generate` plus `s2v-recovery-sweeper` server functions. It also already reused `s2v_films`, `s2v_film_scenes`, `creatables_jobs`, `vv_credit_accounts`, and `vv_credit_ledger`; no new table was needed.

The observed Director overflow had a specific cause: `assistantRuntime.ts` budgeted only the first request. Tool continuations then appended complete tool JSON, validation/provider payloads and image blocks without measuring the final serialized body again. The initial system prompt also embedded the complete film plan, every scene, assets and validation. A long-lived film therefore exceeded the proxy's 200,000-character limit after **Diagnose from evidence**.

The observed durable-generation error also has a specific cause. `S2V_KLING_WORKSPACE_TOKEN` is a stored visitor/browser workspace token, not an all-user workspace service credential. The video proxies require `X-Workspace-DB-Token`; server functions cannot mint or retain a visitor token. The current check returns HTTP 400 (and prior live probes recorded 401/403 for server-side status calls). Gemini Omni can run unattended on the existing route, but Kling and Seedance cannot be made fully closed-tab for every user from workspace code alone.

## Changed

- Added one shared typed context budget (`contextBudget.ts`) used by the Director and all planner/script/Prompt Director calls through `opus.ts`: 120k character ceiling, final serialized-body measurement, data/base64 stripping, bounded tool results, key-field preservation, rolling summaries, latest-turn/system preservation, and one aggressive retry after a proxy length error.
- Compacted Director project and scene-only diagnosis packets. Full saved chat remains in the film; older sent context becomes a persisted running summary. The UI now shows a visible **Context compacted** notice instead of exposing the raw proxy error.
- Claude Opus 5 is now primary for planner, script writer, Prompt Director and Director calls; GPT 6.1 Sol is secondary for text-only fallback. No unsupported Gemini proxy endpoint was invented.
- Added the deterministic big-scene planner. It fills the selected model's maximum legal clip length first, totals the requested duration exactly, generates contiguous variable-length beat timecodes, attaches cast references to every scene, and chooses video-reference versus last-frame continuity from capability flags.
- Extended the single capability registry with Prompt Director family, negative-prompt, and continuity flags. The Create and Render UI now read limits from that registry.
- Added Script-aware **Auto / best for this script** scoring for dialogue, references/characters, duration and motion. Modern model order is Seedance 2.5, Kling 3.0 Omni, Kling 3.0, then Gemini Omni Flash; legacy Seedance 2.0 is removed from the picker.
- Added a typed Prompt Director adapter and standalone system prompt. Every prepared provider prompt is now a single big-scene timeline with exact timecodes, a repeated identity anchor, model-specific wording, continuity notes, references, negative/avoid behavior, and a short “why this prompt” explanation.
- Scene cards now expose expandable editable timecoded beats and an editable final provider prompt before generation.
- Added typed failure classification/recovery policy for moderation, prompt, reference, rate-limit, timeout, outage, credential and credit failures, with bounded three-attempt semantics and fallback only when explicitly allowed. Raw provider failures are saved in the existing `creatables_jobs.response_json`; the new workspace-session-gated `s2v-admin-diagnoses` server function exposes them only to founder/admin identities, and the Jobs panel renders that cross-user view when authorized.
- Consolidated failed-scene controls into one action row: Retry, Regenerate prompt and Skip. The failure box has a plain title/cause/next step, a collapsed technical section, and an actionable model switch for the next retry. Duplicate Retry inside the error component was removed.
- Replaced readiness prose with pass/fail checks, added a readable header Jobs list, made Director diagnosis progress visible, made proposal cards read **Apply fix / Dismiss**, kept the composer sticky, and raised app button/card touch targets to at least 44px.
- Updated `stv-scene-generate` to fail fast with `workspace_service_credential_unavailable` and an exact diagnosis instead of the vague “durable workspace token check returned HTTP 400.” It explicitly refuses to recommend rotating another person's browser token.

## Verification

The workspace syntax/safety gate accepted every file write and every server-function edit. Added deterministic unit suites cover:

- 15s, 30s, 45s, 60s and 90s on Seedance 2.5, Kling 3.0, Kling 3.0 Omni and Gemini Omni Flash;
- exact scene totals, exact beat totals, cast-reference attachment and capability-driven continuity;
- Prompt Director JSON structure, anchors and timecodes;
- oversized history, oversized tool results, base64/data URLs, one-retry behavior, and preservation of the system prompt/latest turn;
- error classification, three-attempt bounds, fallback consent, and timecode preservation during prompt softening.

No paid generation was started, no table/data was created or deleted, and no publish was requested.

## Not verified / platform blocker

A full browser build, Android Chrome interaction pass, real Opus diagnosis call and paid provider generation were not run from this workspace bridge. Most importantly, all-user closed-tab Kling/Seedance orchestration remains blocked by the Audos platform authentication contract: server functions need a workspace-level service credential accepted by the video proxy. `S2V_KLING_WORKSPACE_TOKEN` is not that credential. This requires a platform change; it cannot be implemented in this workspace's files or hook registry. Until then, Gemini Omni remains the verified unattended route, while Kling/Seedance must use an authenticated open-tab submit/status path and now fail fast rather than hanging for about 45 minutes.
