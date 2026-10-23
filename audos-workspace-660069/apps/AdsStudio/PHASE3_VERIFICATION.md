# VERGEYE ADS STUDIO — Phase 3 verification report

Date: 21 October 2026  
Status: working draft, not published  
New paid generation spend in this task: **$0.00**

## PASS

- **Phase 2 exists before Phase 3.** `apps/AdsStudio/creativeStrategy.ts`, `CreativeStrategyScreen.tsx`, `CREATIVE_INTELLIGENCE.md`, and enabled hook `vergeye-creative-strategy` were present. Hook fingerprint: `2ab748801292c3936a1ee7b03f5cb39294e1af3ba8c88a8e1b571266e18b47a7`.
- **One video production engine.** Every Vergeye video `CreativeBrief` now routes to app id `script-to-video`. Vergeye Quick Start also opens Script-to-Video. No new video project table, render queue, storyboard engine or editor was created.
- **Structured handoff.** Contract `vergeye.s2v-handoff.v1` carries the generated editable script, original `CreativeBrief`, Brand Kit snapshot, selected style configuration, campaign references, campaign id, originating angle id, aspect, total runtime, claim-review state, router mode, recommended model and one-line routing reason.
- **Style engine.** Version `vergeye.video-style.v1` defines UGC ad, Talking Head, Cinematic, SaaS Launch, Competitive Differentiation, Motion Graphics, Explainer, Social Short and Custom Style as configuration over Script-to-Video. SaaS Launch requires real/approved UI and the existing Product Launch component workflow. Competitive copy is unnamed by default; exact motion-graphics text stays in deterministic composition.
- **Versioned model capability registry.** `vergeye.video-capabilities.2026-10-21.v1` records exact ids, inputs, legal durations, resolutions, ratios, audio, reference limits, edits, latency disclosure, cost basis, rate-limit disclosure, availability and fallback:
  - Seedance 2.5: `openrouter/bytedance/seedance-2.5`, every whole second 4–30, 480p/720p, six ratios, optional audio, first/last frames or 1–3 asset refs.
  - Kling Omni 3.0: app id `kling-3.0-omni`, provider id `kling-v3-omni`, **5s or 10s only on the current proxy (not 15s)**, std/pro, silent, 2–4 refs.
  - Gemini Omni 1.1 Flash: `gemini-omni-1.1-flash`, up to 8s, 720p, optional audio, seed + up to 10 refs, first/last interpolation and real `videoData` edit.
- **Router modes.** Automatic evaluates style, duration, complexity, cast consistency, product refs, camera movement, dialogue/audio, aspect/resolution, availability and supplied failure history. Manual shows model restrictions/cost differences. Hybrid preserves explicit per-scene assignments and automatically routes unassigned scenes.
- **Fallback policy.** The existing durable worker still records model switches. Kling failure routes the affected block to Gemini Omni; if Omni fails, it stops before Seedance and asks for creator authorization. Updated worker fingerprint: `225b80877de73c238886415d03f6c58f54d10a0b08574abd565bd0f68c690c47`.
- **No `veo_generations` foreign-key regression.** `stv-scene-generate` explicitly sends no `X-App-Id` to `/api/veo/generate/video`. Fingerprint remains `c8c26f76dc13eff2ebe4906c6547a85f5e44739227855fc59d088e5db79771ef`.
- **Editable paid-generation gate.** Before Start, each block now exposes objective, exact dialogue/VO, visual, camera, cast, environment, sound, continuity, reference URL, duration and model, plus reorder/add/delete/regenerate. “Approve plan & start production” is explicit and shows category-level cost authorization. Changing a block clears its prepared prompt so the durable worker rebuilds it from the approved plan; camera/environment/sound/continuity fields are inserted into that prompt.
- **Background ownership.** Once the durable worker owns a film, browser auto-generation, resume, watchdogs, auto-post, assembly recovery and targeted edits stay read-only; the browser only adopts WorkspaceDB checkpoints.
- **Targeted regeneration authorization.** Redo names the affected scene, states that other approved scenes remain unchanged, shows additional video-credit exposure and requires confirmation before a paid rerender.
- **Existing durable storage reused.** WorkspaceDB evidence: `s2v_films` has 6 rows, `s2v_film_scenes` 22, `s2v_characters` 24, `s2v_references` 1, and `s2v_asset_registry` 8. No Phase 3 table was added.
- **Prior end-to-end engine evidence exists.** Film row **62** is `ready`, model `kling-3.0-omni`, duration `31.139002`, final URL: `https://storage.googleapis.com/audos-images/uploads/s2v/df76b31f-aa6d-48a2-a5e5-058ea36f30e4.mp4`. Scene rows **573–575** are completed and retain provider clip URLs, including Kling scene 573: `https://storage.googleapis.com/audos-images/kling/941924969188706574/941924969188706574.mp4`.
- **Reference evidence exists.** `s2v_references` row **3** is `@alex`, type `character`, with durable URL `https://storage.googleapis.com/audos-images/chat-attachments/b331ed2c-472e-4858-bf3c-8ac43b40918c.jpg`. Character-bible samples include ready rows **1–5** with durable generated-image URLs.
- **Source safety gates.** Every new/edited TypeScript, Markdown and server-function write in this task was accepted by the Audos safety/syntax pipeline.

## FAIL

- **Kling secret acceptance could not be proven.** The name-only check against `s2v-recovery-sweeper` returned HTTP **409**, code `upstream_400`, exact error: **“The Kling credential could not be verified without starting a paid render.”** The hooks reference only `S2V_KLING_WORKSPACE_TOKEN`; no secret value was read or printed. This is not proof that the secret is missing, but it is a failed acceptance check.

## NOT TESTED

- **Authenticated direct credential check.** Executing `stv-scene-generate` without a customer workspace session returned HTTP **401**, exact error **“Workspace session required”**. An authenticated Preview session is required to exercise that gate.
- **New Phase 3 browser handoff.** No authenticated click-through from a saved CreativeBrief into Script-to-Video was run in this agent session.
- **New Phase 3 paid output.** No Seedance, Kling, Omni, image, edit or final-render request was started. No wallet debit/refund was created. This intentionally kept new spend at $0, below the $5 ceiling.
- **Compiled-space and responsive UI walkthrough.** No publish was requested, so no publish compile or desktop/mobile Preview walkthrough was run.
- **Current in-flight row.** Film **65** is `producing`; scene **581** is `generating` with no stored operation id while `plan.background.stage` is `failed`. It predates these Phase 3 edits and was not mutated. Reopen/recovery behavior for that row was not exercised.

## Files and registered function changed

- `lib/vergeyeVideoProduction.ts`
- `lib/vidvergeHandoff.ts`
- `lib/videoEngines.ts`
- `apps/AdsStudio/creativeStrategy.ts`
- `apps/AdsStudio/ARCHITECTURE.md`
- `apps/AdsStudio/CREATIVE_INTELLIGENCE.md`
- `apps/AdsStudio/PHASE3_VERIFICATION.md`
- `apps/ScriptToVideo/App.tsx`
- `apps/ScriptToVideo/CreateFlow.tsx`
- `apps/ScriptToVideo/RenderRoom.tsx`
- `apps/ScriptToVideo/pipeline/videoModelService.ts`
- `apps/Phantom/App.tsx`
- `agent/customer-prompt.md`
- registered server function `s2v-recovery-sweeper`
