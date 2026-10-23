# Script-to-Video V2 — implementation report

## Implementation map

- `apps/ScriptToVideo/App.tsx` — existing application shell and project controller; extended with V2 creation inputs, automatic authorized start, durable pause/resume/stop-future-jobs, project-owned storyboard generation, and Omni edit provenance.
- `apps/ScriptToVideo/CreateFlow.tsx` — existing intake reused; now supports Idea or Script independently from Agentic or Manual control, Review Plan or Run Automatically, 10 styles + Custom, 5/8/10/15/30/60/120s + custom up to 30:00, 16:9/9:16/1:1, five explicit audio policies, spend ceiling, complete supported model picker, project-scoped upload, and opt-in cross-project import.
- `apps/ScriptToVideo/RenderRoom.tsx` — existing plan/production board reused; now shows timed beats, storyboard-only previews, reference-budget exclusions, real provider states, accessible progress, billed/ceiling values, pause/resume/stop, all supported models, and windowed AI Edit evidence.
- `apps/ScriptToVideo/ReviewFinish.tsx` — existing measured-media QA, native-audio assembly and direct download reused; Quick Edit is now an equal local action and is visibly separate from billable AI Edit.
- `apps/ScriptToVideo/QuickEditor.tsx` — added deterministic, non-destructive editor: source trim, draggable/resizeable text and uploaded image/video, CTA/end-card styling, colour, font size, position, timing, opacity, layer order, fade/rise/scale, optional audio and volume, responsive preview, versioned Remotion export. Native source audio stays on. Connected Remotion exports are capped at 10:00; longer masters must be trimmed for one Quick Edit export.
- `apps/ScriptToVideo/v2Contracts.ts` — added the versioned operation-level capability registry, V2 state/intent contracts, 10 style presets, audio policies, long-form section planner, reference ranker and 30:00 duration parser.
- `apps/ScriptToVideo/api.ts` — existing `s2v_films.plan`, `s2v_film_scenes.spec` and asset JSON storage reused; expanded types for the complete section 17 contract, square output, provider job states, edit versions and export records. Uploads are workspace-namespaced. Project asset reads no longer include another project's assets unless the explicit import picker is opened.
- `apps/ScriptToVideo/pipeline/opus.ts` — Agent 1/Agent 2 consequential planning now uses the connected frontier Claude id `claude-opus-5` with adaptive thinking and medium effort. Public-URL image inspection stays a bounded routine vision task on the existing interactive vision client. Planning is model-aware, duration-aware, style/audio/budget-aware, and carries provider-specific timed beats.
- `apps/ScriptToVideo/pipeline/orchestrator.ts` — existing code-driven state machine reused; now persists V2 contracts, registry snapshot, continuity manifest, sections, manual locks, budgets, job/retry state, actual duration, billed progress, assembled media and export records. It refuses duration padding/truncation, preserves critical references, handles Fully silent without audio generation, and records non-blocking optional-reference exclusions.
- `apps/ScriptToVideo/pipeline/videoModelService.ts` — existing tested adapters reused; added operation-level capability export, critical-first reference validation, optional exclusion evidence, and separate Omni 1.1 existing-video editing. A source over 8s is trimmed to `[0,8]`, only that window is edited, the remainder is untouched, the two are server-stitched, and frames are extracted on both sides of the boundary.
- `apps/ScriptToVideo/pipeline/assemble.ts` — existing FFmpeg/audio-preserving assembly reused; added 1:1 output.
- Server functions `stv-scene-generate`, `s2v-recovery-sweeper`, `asset-image-gen` — existing secure gateway and durable runner reused. Start checkpoints V2 state; the worker enforces maximum credits, pause/stop, stable operation ids and bounded retry. Initial cast/storyboard images now use verified fast Gemini 3.1 drafts; explicit Premium regenerate tries authenticated `gpt-image-2` HD and records any confirmed-failure fallback. Gemini Omni can run on the durable server worker; Seedance/Kling start through the authenticated tab when the stored background credential is unavailable, while accepted operation ids still persist for refresh recovery.

Known pre-existing inconsistencies found and corrected: planning names said “Opus” while calls went to GPT; only three styles and four duration presets were exposed; 1:1 and 120s/30:00 were absent; audio semantics were ambiguous; optional references could be silently sliced; Omni edits rejected every source over 8s rather than preserving the remainder; Quick Edit left the app; automatic runs had no persisted spend ceiling or real pause/stop state.

## Confirmed connected model contracts

| Operation | Exact connected id | Duration | References / frames | Audio | Evidence |
|---|---|---:|---|---|---|
| Seedance 2.5 generation | `openrouter/bytedance/seedance-2.5` | every integer 4–30s | first+last frames **or** 1–3 asset images; about 10MB/image | optional | adapter + catalog; existing 30s plan rows |
| Seedance 2.0 Fast generation | `openrouter/bytedance/seedance-2.0-fast` | 4–10s in this implementation | one seed image | no confirmed native audio | adapter + catalog |
| Kling 3.0 Omni generation | `kling-3.0-omni` / provider `kling-v3-omni` | only 5s or 10s | first/last-frame route, or 2–4 multi-image references | silent on connected proxy | adapter + completed 10.041667s provider clip |
| Kling 3.0 generation | `kling-3.0` / provider `kling-v3` | only 5s or 10s | first/last frame; no multi-image set | silent on connected proxy | adapter + catalog |
| Gemini Omni Flash 1.1 generation | `gemini-omni-1.1-flash` | 2–8s | up to 10 total images; seed counts against the total; first+last supported | optional | adapter + prior successful acceptance record |
| Gemini Omni Flash 1.1 existing-video edit | `gemini-omni-1.1-flash` | verified edit window 2–8s | one source video | preserve unless user chose Fully silent | separate adapter operation + catalog |
| Reference image draft | `gemini-3.1-flash-image` | image | fast three-view cast sheet / storyboard | n/a | verified connected route used during planning |
| Premium reference regenerate | requested `gpt-image-2`, confirmed-failure fallback to Gemini 3.1 | image | explicit user action; actual model recorded | n/a | connected image catalog |
| Customer/director text | `claude-opus-5` | max 16,384 output tokens | adaptive thinking, medium effort | n/a | connected Anthropic proxy contract |

Important deviations from planning hints: the connected Kling proxy does **not** expose 15s or native audio and Kling Omni supports 2–4 references, not ~8. Omni generation/edit is verified to 8s, not 10s. The implementation therefore never labels a 15s result as a direct Omni edit; it edits 8s and splices the untouched remainder. Seedance 2.0 Standard was not added.

## Final architecture and contracts

The customer AgentChat remains on the existing Claude Agent SDK. Consequential Script-to-Video planning calls the exact connected Opus proxy once per meaningful planning task, not once per UI click. The code-driven orchestrator owns intents (`create/refine/override/plan/generate/edit/retry/approve/cancel/export`), state, locks, versions, budget and checkpoints. Agent 1 produces legal blocks, model assignment, exact duration, timed beats, references, alternatives and warnings. Agent 2 preserves accepted wording, generates clip-level script and provider-specific prompts, and carries style/audio/timing into image and video prompts.

All new durable state fits existing JSON columns—no table was created. `plan` stores the V2 project contract, registry snapshot, continuity manifest, long-form sections, spend authorization, assembled media, editor versions and export records. `spec` stores timed beats, model assignment, reference ids, storyboard-only ids, prompt version, stable idempotency key, provider id/status, bounded retry state and actual duration/cost. Storyboard assets are tagged `storyboard-only` and filtered from provider inputs. Reference rank is character > product > continuity frame > environment > optional style; critical overflow blocks before billing, while optional overflow is shown on the scene card.

The durable worker submits and polls server-side, survives navigation, adopts existing provider ids, prevents duplicate paid submits, and lets an in-flight provider job settle before pause/stop takes effect. Long-form projects are capped at 30:00 and sectioned at 2 or 5 minutes depending on length. Final assembly verifies a durable MP4 and measured metadata. Quick Edit creates a new deterministic version; AI Edit creates a billable scene revision and never overwrites the immutable source.

## UX walkthrough

1. Choose Idea or Script, then Agentic or Manual. Script can preserve exact wording or accept an AI proposal; it is never forced through idea generation.
2. Choose Review Plan or Run Automatically. Automatic asks for one maximum-credit ceiling and then starts the durable worker after planning/cast preparation if no action is required.
3. Choose style, aspect, duration, audio policy, model and project-local references. Cross-project assets are behind an explicit picker and are never preselected.
4. Review editable block/storyboard cards. Each shows model, exact duration, timed beats, action/dialogue, references, exclusions and “why this model.” Generate storyboard previews on demand; they remain human-review-only.
5. Approve once. Produce shows true per-clip status and playable clips, billed versus ceiling, pause/resume and stop-future-jobs.
6. Finish shows the measured master, QA evidence and equal Download / Quick Edit actions. Scene cards expose separate billable AI Edit. Quick Edit is deterministic and non-generative.

## Acceptance evidence

No new paid media was started in this task. Live-test spend: **$0 / 0 new credits**. Existing project 61 records “workspace wallet balance is too low” for a 30s Seedance submit, so premium live tests require founder funding approval.

1. **Idea → 30s — PASSED AT PLAN/STATE LEVEL.** `packPlannedBlocks` makes one legal Seedance 2.5 30s request with internal timed beats; existing project 63 persists one 30s block. Playable 30s output not run live.
2. **Idea → 60s — PASSED AT PLAN/STATE LEVEL.** Deterministic packing yields 30+30 and exact-total validation. Not rendered live.
3. **Too-short copy — PASSED AT PLAN/STATE LEVEL.** A plan that cannot provide non-duplicated coverage for the requested runtime is refused with three actionable choices; it is never padded silently.
4. **Timed script — PASSED AT PLAN/STATE LEVEL.** Timed beats persist inside one `spec` and one provider request.
5. **Styles — PASSED AT PLAN/STATE LEVEL.** All ten presets + Custom flow into Agent 1/2 and reference-image prompts.
6. **Premium references — PARTIAL LIVE/STATE EVIDENCE.** Existing durable cast sheets prove the Gemini route; planning now uses that fast path. `gpt-image-2` HD is an explicit Premium regenerate with authenticated request and recorded fallback. This agent's smoke call was rejected before execution because the supplied visitor session had expired, so it incurred no image cost.
7. **Storyboard isolation — PASSED AT PLAN/STATE LEVEL.** Assets are tagged `storyboard-only`; adapter filtering excludes them.
8. **Frame chaining — PASSED LIVE (existing result).** Film 62 has completed clips with durable keyframes; scenes 574/575 used continuity data. The UI still surfaces quality-judge failures rather than claiming a false pass.
9. **Reference counts — PASSED AT PLAN/STATE LEVEL.** Endpoint-specific ranker blocks critical overflow and reports excluded optional inputs.
10. **Project isolation — PASSED AT PLAN/STATE LEVEL.** Project reads filter by `film_id`; explicit import picker is closed by default and session-owned.
11. **Audio — PASSED AT PLAN/STATE LEVEL.** No narration preserves native speech/effects; Fully silent creates no voice/music/SFX jobs and exports with native volume zero.
12. **Model override — PASSED AT PLAN/STATE LEVEL.** Manual locks persist; incompatible duration/audio combinations fail before billing with alternatives.
13. **Review — PASSED AT PLAN/STATE LEVEL.** Editable plan/storyboard/model/duration/reference controls and one approval action are wired.
14. **Auto — PASSED AT STATE LEVEL.** One ceiling persists; auto-start, budget preflight and blocked decision card are implemented. Paid completion not run.
15. **Background delay — PASSED AT STATE LEVEL.** Final worker sweep executed successfully (HTTP 200, no runnable films); provider ids/leases/checkpoints persist and the browser only reads state.
16. **Failures — PASSED AT STATE LEVEL.** Stable fingerprint/provider id duplicate protection; one initial + two transient retries; exponential backoff; permanent errors stop; fallback compatibility is duration-gated.
17. **Omni edit preservation — PASSED AT PLAN/STATE LEVEL.** 8s edit adapter + untouched-tail trim/stitch + two-sided boundary-frame evidence + version/cost provenance. Not run live.
18. **2-minute preset — PASSED AT PLAN/STATE LEVEL.** 120s preset, exact block sum, sections, budget and assembly inputs persist. Not rendered live.
19. **Up to 30m — PASSED AT PLAN/STATE LEVEL.** 30:00 hard cap, hierarchical sections, bounded jobs, controlled sequential concurrency, pause/resume/stop, budgets and server assembly are implemented. Full premium render intentionally not run.
20. **Remotion Quick Edit — PASSED AT PLAN/STATE LEVEL.** Preview and deterministic render payload support logo/image/video, animated CTA, drag/resize, order, opacity, timing, trim and optional audio. Live render needs an approved source and wallet.
21. **AI edit separated — PASSED AT PLAN/STATE LEVEL.** UI labels Quick Edit free/deterministic and AI Edit billable/Omni.
22. **UX — PASSED AT CODE/AUDIT LEVEL.** Touch targets, focus inheritance, ARIA progress/live status, mobile Quick Edit collapse and no mobile horizontal grid were checked. The workspace's recorded Vidverge design system is dark-only; no competing light palette was invented. Browser screenshots were not available from the workspace bridge.
23. **Security and cost — PASSED AT STATE LEVEL.** No BYOK UI; credentials stay server-side; project filtering, stable keys, pre-submit ceiling and duplicate prevention are enforced.
24. **Regression — PASSED AT STATE LEVEL.** Existing film 62 remains `ready / FINAL_VIDEO`, measured 31.139002s with a durable final MP4 and three completed 10.041667s clips; legacy reads and existing exports were not rewritten. No new provider call was made.

## Remaining blockers and open items

- Paid provider/image/Remotion acceptance is blocked by workspace wallet funding. Top up, then run the live matrix using the shortest/cheapest clips; do not run a 30-minute premium render without separate approval.
- The owner must review Remotion commercial licensing before offering the SaaS editor commercially.
- The Remotion service has a hard 10-minute single-export limit and fixed 1920×1080 render geometry. Quick Edit therefore clearly requires a ≤10:00 trim for longer masters; portrait/square preview is preserved in the UI but the server export is composed inside the fixed render frame.
- The stored Seedance/Kling background credential check currently returns upstream 400. This no longer strands Start: Gemini Omni uses the durable worker, while Seedance/Kling use the customer's authenticated tab and save accepted provider ids for refresh recovery. Existing completed Kling media remains the current live connection evidence.

Everything remains an **unpublished draft**. No new WorkspaceDB table was created, no existing table was replaced, and no app outside `apps/ScriptToVideo` was modified.
