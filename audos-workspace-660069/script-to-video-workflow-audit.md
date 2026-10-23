# Script-to-Video workflow audit — draft

Date: 21 October 2026  
Scope: `script-to-video` (`apps/ScriptToVideo/`) plus shared Vidverge Design System v3 tokens  
Publish state: **draft only — not published**

## Executive result

The founder screenshot was **not an old-live-only screen**. The current live snapshot and the pre-change draft had identical checksums for the relevant Script-to-Video files, including `CreateFlow.tsx` (`md5:m1a9Iw5W8eWQKB2+7vbWzw==`) and `App.tsx` (`md5:ZQqUyp9DKaHMPNZHtsqCcQ==`). The old labels — Character reference image, Stored References, Reference image, Director note, and Plan my film — were therefore present in both live and draft.

The draft now opens a new intake: **Start with an idea** or **Use my own script**. Idea mode writes an editable production script and requires acceptance. Own-script mode offers **Skip — keep my wording** or **Ask AI to improve / fill gaps**; the proposal does not replace the original until accepted. Required cards collect type, agent-recommended/overridden style, optional storyboard choice, duration, orientation, and model before the production plan can be created.

## Current model contracts (integration docs checked 21 October 2026)

- **Seedance 2.5**: exact model `openrouter/bytedance/seedance-2.5`; every integer from **4–30 seconds**; 480p/720p; optional audio; first/last frames or up to three asset references. References cannot be combined with first/last frames.
- **Kling Omni 3.0**: exact app model `kling-3.0-omni`; the current Audos proxy exposes only **5 or 10 seconds**, silent, 720p/1080p. The founder’s 15-second belief is not supported by the present proxy contract.
- **Gemini Omni 1.1 Flash**: up to **8 seconds**, 720p, up to ten references, seed + references, first/last frame, and actual existing-video edit via `videoData`.

Block packing now uses the real maximum first:

| Total | Seedance 2.5 | Kling Omni 3.0 |
|---|---|---|
| 15s | 15 | 10 + 5 |
| 30s | 30 | 10 + 10 + 10 |
| 45s | 30 + 15 | 10 + 10 + 10 + 10 + 5 |
| 60s | 30 + 30 | 10 + 10 + 10 + 10 + 10 + 10 |

## Handwritten workflow audit

1. **Implemented — two start modes.** `CreateFlow.tsx` now has Idea and Own Script. `manualScript.ts` supplies the prompt-maker/formatter proposal. Changes require **Accept script**; **Keep original** and **Skip — keep my wording** preserve the customer’s source.
2. **Implemented — question cards.** Type, style, storyboard, duration, orientation, and model are collected before plan creation. Recommended and optional states are named. Chat-triggered create requests now open this intake instead of bypassing it (`App.tsx`).
3. **Implemented — exactly two planner models.** The planner grid contains only Seedance 2.5 and Kling Omni 3.0. The agent recommends Kling for recurring people/dialogue and Seedance for longer cinematic blocks; the customer can override.
4. **Implemented — legal duration packing.** `CreateFlow.tsx` previews the block plan. `pipeline/orchestrator.ts` packs provider maximums first and rebalances only an illegal final remainder.
5. **Implemented — type and style with recommendation.** Intake cards mark the recommendation and keep override controls.
6. **Implemented — detailed prompt per block.** `s2v-recovery-sweeper` writes timed establish/develop/land sections, exact source-script coverage, story context, continuity, references, dialogue, and negatives for every saved block.
7. **Implemented — full-script character/narrator analysis.** `pipeline/opus.ts` now explicitly requires complete-script analysis, main/recurring characters only, side characters only when they recur, and voice-only narrators to remain narration rather than visual cast.
8. **Implemented — individual character sheets.** `pipeline/orchestrator.ts` creates one locked identity reference per recurring character; `RenderRoom.tsx` now exposes a Character sheets panel with appearance, reference state, and generated image when ready.
9. **Implemented — optional storyboard.** The intake collects Yes/No. Accepted film plans persist the choice, and `RenderRoom.tsx` shows an optional block storyboard with duration, summary, visual goal, and direct block navigation.
10. **Implemented — frame chaining.** Each dependent block carries the full timed prompt, canonical cast/look references, and the previous completed block’s extracted ending frame when continuity applies. Server-side frame extraction and final stitch are in `s2v-recovery-sweeper`.
11. **Implemented — optional Omni edit.** `App.tsx`, `RenderRoom.tsx`, and `videoModelService.ts` send the existing MP4 as `videoData`; the board shows Before/After Compare, Accept revision, and Undo/keep original. The real 8-second edit cap is shown rather than silently truncating.

## Closed-browser completion and credentials

Implemented in server functions:

- `stv-scene-generate` validates the owned film and starts the durable runner.
- `s2v-recovery-sweeper` leases work, resumes expired runs, submits/polls one dependent block at a time, extracts continuity frames, stitches and verifies the MP4, saves history, and emits one occurrence-keyed completion notification.
- Seedance and Kling submit/status requests reference `{{secrets.S2V_KLING_WORKSPACE_TOKEN}}` only through `platform.secretsProxy`. Source, logs, chat, and database rows never receive the token value. Each scene records only `credential_used: custom_secret:S2V_KLING_WORKSPACE_TOKEN`.
- A Kling failure automatically retries that block on `gemini-omni-1.1-flash` and records the from/to/reason switch. Because Omni’s real maximum is 8s, a failed 10s Kling block is split into legal dependent 8s + 2s Omni blocks so total runtime is preserved. If Omni also fails, production stops and asks whether to switch the film to Seedance 2.5; it does not switch silently.

Existing live acceptance evidence (from the disabled `s2v-background-acceptance-oct21` harness) proves the underlying closed-browser pipeline on two dependent 4-second Omni blocks: persisted operations, expired-lease recovery, server frame continuity, verified 8.10-second H.264/AAC stitch, library save, and exactly one deduplicated completion message. The **new Kling credential path is locally load-tested but not live-proven** because the owner-only secret is not available to this build agent.

Founder action required: store the current workspace token for `rohan24102004@gmail.com` as an enabled owner-only custom key named `S2V_KLING_WORKSPACE_TOKEN`, allow-listed for `audos.com`, then rerun the acceptance task. A multi-block paid Kling film, tab closure, remaining blocks, assembly/export, provenance, fallback, and one notification must be verified after that setup.

## Design System v3.0 revision

The palette was changed centrally in `components/theme.ts`, `config.json`, and `workspace-branding.json`; Script-to-Video consumes those tokens through `api.ts`. Amber is now a restrained action/selection accent over neutral charcoal surfaces.

Previous core values (recorded here for exact recovery):

- Surfaces: `#0D0E10`, `#17191D`, `#21242A`, `#2A2E35`
- Borders: `#393E47`, `#747D8B`
- Text: `#F6F2E9`, `#B7BBC4`, `#929AA7`
- Accent: `#F2B544`, hover `#FFD16F`, pressed `#D69529`, soft `#342716`
- Semantic: success `#79D5A5`, warning `#F1C778`, danger `#FF9A9A`, info `#9DBDFF`

New core values:

- Surfaces: `#101214`, `#171A1E`, `#20242A`, `#292E35`
- Borders: `#343A43`, `#596270`
- Text: `#F4F5F7`, `#C4C9D0`, `#9AA3AF`
- Accent: `#D9A441`, hover `#E5B75A`, pressed `#B8832E`, soft `#2B2418`
- Semantic: success `#72C99A`, warning `#E0B96B`, danger `#F28B8B`, info `#8FB5EA`

Script-to-Video create and production screens now use a 4/8/12/16/24/32 spacing rhythm, 44px controls, uniform card radii, dark-on-amber button labels, responsive question grids, a horizontally scrollable mobile stage rail, and a stacked mobile production board. Stale hard-coded amber glows were replaced with shared tokens.

Checked shared surfaces: `Desktop.tsx`, `AgentChatView.tsx` including the first-run state, `Settings.tsx`, and `EmailGate.tsx`. The shell/chat/settings inherit central tokens; the pre-shell Email Gate’s matching presentation constants were updated and its required version marker was preserved/incremented to 116. Source spot-checks: Faceless (loads `GlobalStyles`), Product Launch (uses `AppShell`), and Ads Studio (uses `AppShell` / shared tokens). No unrelated app palette rewrites were needed.

## Verification status

### Implemented

Draft source and server functions listed above. No publish was requested or performed.

### Locally tested

- All file writes passed Audos syntax/schema safety gates.
- `config.json` remained schema-valid after central token replacement.
- `s2v-recovery-sweeper` loaded and executed a non-mutating contract probe, returning the expected `400 Unknown op` in under 200ms with no logs.
- `stv-scene-generate` retained its workspace-session gate (unauthenticated probe returned 401 before execution).
- Current integration contracts were re-read rather than inferred.

### Live verified

- Draft-versus-live source comparison is verified by published-source checksums.
- The earlier two-block Omni closed-browser acceptance is recorded in the disabled acceptance harness.
- The new draft UI, palette, and secure Kling/Seedance secret path are **not live verified** because this task must remain unpublished.

### Blocked

- Owner-only token storage and the paid multi-block Kling closed-tab acceptance test.
- Before/after runtime screenshots require an authenticated draft preview. A browser check at 1280×800 found no existing Audos session, no local preview server, and an authentication gate on audos.com; the workspace UI never rendered, so no honest desktop or mobile after screenshot could be captured. The source-level before state is proven by the published checksums and the founder-provided screenshot. Capture the final desktop/mobile images from the authenticated Preview after the owner-token setup.

## Files changed

- `apps/ScriptToVideo/App.tsx`
- `apps/ScriptToVideo/CreateFlow.tsx`
- `apps/ScriptToVideo/RenderRoom.tsx`
- `apps/ScriptToVideo/api.ts`
- `apps/ScriptToVideo/pipeline/orchestrator.ts`
- `apps/ScriptToVideo/pipeline/opus.ts`
- `components/theme.ts`
- `components/EmailGate.tsx`
- `config.json`
- `workspace-branding.json`
- `agent/customer-prompt.md`
- `script-to-video-workflow-audit.md`

Server functions changed: `stv-scene-generate`, `s2v-recovery-sweeper`.
