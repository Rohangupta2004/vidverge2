# Script-to-Video frame chaining report

Draft only. Films 68 and 69 were not modified.

## Provider inputs for scene N >= 2

| Model | Exact image order now sent | Effective cap and drop behavior | Source |
|---|---|---|---|
| Gemini Omni 1.1 Flash | `imageData` = immediate previous scene’s validated last frame first; then `referenceImages` = one best sheet for each on-screen character, product, environment, style | 10 total images including `imageData`, so a chained scene has up to 9 additional references. Lowest roles drop first: style, environment, product, then excess character sheets. Continuity never drops. | `image-and-video-generation` / `google-veo3` docs; `pipeline/videoModelService.ts`; `s2v-recovery-sweeper` |
| Kling 3.0 Omni | Scene N>=2 uses image-to-video with `imageData` = continuity frame. Asset references cannot accompany that route, so character identity remains in the per-scene prompt. Scene 1 may use the 2–4 image reference route; one reference uses the first-frame route. | Continuation route: 1 frame. Scene-1 multi-image route: 2–4 references. | `kling-video` docs; `pipeline/videoModelService.ts`; `s2v-recovery-sweeper` |
| Kling 3.0 | `imageData` = continuity frame. Character/product/environment/style images are not sent on chained scenes; on-screen character descriptions remain in the prompt. | 1 first-frame input. | `kling-video` docs; `pipeline/videoModelService.ts`; `s2v-recovery-sweeper` |
| Seedance 2.0 Fast | `imageData` = continuity frame. Other images are omitted on chained scenes; on-screen character descriptions remain in the prompt. | 1 first-frame input. App planning ceiling is 8s, based on three measured 8.041667s outputs from film 68; docs confirm no `referenceImages`. | `google-veo3` docs; `v2Contracts.ts`; `pipeline/videoModelService.ts` |
| Seedance 2.5 | `imageData` = continuity frame. Asset references cannot be combined with a frame, so chained scenes send no character sheets as images; their scene-specific descriptions remain in the prompt. Scene 1 may send up to 3 asset references. | 1 frame on the chained route, or up to 3 assets on the scene-1 reference route. | `image-and-video-generation` / `google-veo3` docs; `pipeline/videoModelService.ts`; `s2v-recovery-sweeper` |
| OpenRouter Veo 3.1 / Fast / Lite | `imageData` = continuity frame. No `referenceImages`. | 1 first-frame input. | `image-and-video-generation` / `google-veo3` docs; `pipeline/videoModelService.ts` |

Scene 1 keeps its existing exception: it has no continuity frame. Its on-screen character sheet may lead, or it may remain prompt-only when the selected adapter has no applicable scene-1 image route. Storyboard images remain review-only and are excluded from provider requests.

## Silent-break audit

The previous code had these break paths:

1. Browser `extractFinalFrame` errors were caught and the scene completed without a keyframe; the next scene was prepared independently.
2. The old rank was character (500), product (400), continuity (350), environment (250), style (100), so a character sheet could displace continuity.
3. The unattended path explicitly chose character references over Seedance 2.5 continuity because that model cannot combine frames and assets.
4. The unattended reset heuristic could suppress chaining for words such as “elsewhere”, “new location”, or “cut to”.
5. The unattended source lookup selected the latest completed earlier scene, so it could jump over a failed/missing immediate scene.
6. Server extraction failure still marked a clip completed and prepared the next scene independently.
7. Browser bulk generation could submit multiple prepared scenes concurrently, allowing a downstream regeneration to use an older prior frame.
8. A saved keyframe was not re-fetched, decoded, pixel-checked, or aspect-checked immediately before submission.
9. Manual films skipped the post-clip vision check, and vision-check failure could be accepted on trust.
10. Scene cards displayed planned references and recomputed labels, not immutable evidence from the provider body.
11. Accepting an Omni edit cleared its keyframe but did not immediately extract and validate the edited clip’s new outgoing frame.

## Enforcement added

- Scene N>=2 and every regeneration now resolve the immediate scene N-1 at submit time, revalidate its durable HTTPS PNG with the same decode/dimensions/aspect/flatness validator, and place it first.
- A missing, stale, wrong-scene, invalid, or not-yet-produced frame blocks submission. The source card exposes **Retry frame** and a confirmed **Continue without continuity frame** action; the choice and timestamp persist in the existing `spec.background.frame_extraction` JSON.
- Browser FFmpeg.wasm remains the existing singleton loader and extraction sequence: duration-0.1s, duration-0.5s, then canvas end/earlier fallbacks. Temporary wasm files are deleted after each attempt. Canvas results now pass the same validation before use.
- The unattended path uses server FFmpeg only when no tab is needed. It tries end-0.1s then end-0.5s and stores `server-ffmpeg`, source scene, URL, and offset. If it cannot produce a durable frame, production pauses at “Waiting for your tab to extract the last frame”; no later scene is submitted.
- References are continuity, on-screen characters (one sheet per character), product, environment, style. Character-library images not named on the scene are excluded; all on-screen character descriptions and stated frame positions remain in prompt text.
- Post-clip vision now requires every expected character to be visible and fails closed. One bounded repair render remains; a failed/missing-character clip never supplies the next frame.
- `spec.request_evidence` is saved when the exact request body is built, before provider submission. Scene cards render two source-of-truth rows: frame source/method/offset/thumbnail, and every actually sent reference in provider order plus cap drops and reasons.
- Bulk generation now runs sequentially in continuity order.

## MEASURED

- Server-frame capability probe used the existing 4s Video Provider Lab Omni clip, not films 68/69. `/api/video/frames` returned a durable PNG at 3.90s via server FFmpeg in 3.868s.
- The updated unattended function parsed and reached its non-billing credential-check branch. The unrelated stored Kling credential check returned upstream HTTP 400; no generation was started.
- A three-scene, 4s-per-scene Omni acceptance fixture with two approved character sheets was created as film 70. Authenticated Start rejected the expired saved test session with `401 Invalid workspace session` before billing. Film 70 and all three scene rows were immediately deleted; no history row or paid render was created.

## READ IN CODE / DOCS

- FFmpeg.wasm is loaded once and reused by `pipeline/assemble.ts`; frame extraction deletes its input/output files in `finally`.
- Platform docs establish Omni’s 10-image total, Seedance 2.5’s mutually exclusive frame-vs-3-assets modes, Seedance 2.0/Veo single-seed behavior, and Kling Omni’s 2–4 reference route versus first-frame route.
- Both browser and unattended builders persist exact ordered request evidence in existing JSON columns. No WorkspaceDB table was created or altered.
- Films 68 and 69 received no writes.

## NOT TESTED

- The paid three-scene visual-continuity/character-visibility run could not start without a current validated workspace session. Therefore scene-2/scene-3 stored request rows and final visual continuity were not measured in this run.
- Browser FFmpeg.wasm loading and canvas fallback were not executed in a live preview.
- Phone/desktop screenshots were not taken because no preview URL or successful draft build was available.
- Full TypeScript typecheck and app build were not run: this workspace bridge exposes source writes and publish, but no draft-only compile command; publishing was explicitly forbidden.

## Files and server functions changed

- `apps/ScriptToVideo/api.ts`
- `apps/ScriptToVideo/App.tsx`
- `apps/ScriptToVideo/RenderRoom.tsx`
- `apps/ScriptToVideo/v2Contracts.ts`
- `apps/ScriptToVideo/pipeline/frames.ts`
- `apps/ScriptToVideo/pipeline/opus.ts`
- `apps/ScriptToVideo/pipeline/orchestrator.ts`
- `apps/ScriptToVideo/pipeline/videoModelService.ts`
- `apps/ScriptToVideo/FRAME_CHAINING_REPORT.md`
- Server function `s2v-recovery-sweeper`
- Disabled acceptance harness `s2v-background-acceptance-oct21`
