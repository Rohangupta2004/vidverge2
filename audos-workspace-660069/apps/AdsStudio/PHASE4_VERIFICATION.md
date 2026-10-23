# VERGEYE ADS STUDIO — Phase 4 verification report

Date: 21 October 2026  
Status: working draft, not published  
New generation spend in this task: **$0.00**  
Requested ceiling: about $5

## Phase 3 prerequisite

**PASS.** The current draft contains `apps/AdsStudio/PHASE3_VERIFICATION.md`, the `vergeye.s2v-handoff.v1` integration, `vergeye.video-capabilities.2026-10-21.v1`, the existing Script-to-Video project/table/hook family, editable pre-production blocks, durable production, targeted scene regeneration and the original Omni source-video revision path. Phase 4 extends those paths; it does not add a second video project, queue, storyboard, renderer or editor.

## PASS

- **Configured Omni capability verified and recorded.** The platform `image-and-video-generation` and `google-veo3` contracts explicitly verify `gemini-omni-1.1-flash` source-video editing via `videoData` plus optional `videoMimeType`, with compatible output blocks up to 8 seconds. They do not separately guarantee background replacement, object replacement, relighting or appearance changes. Canonical registry version is now `vergeye.video-capabilities.2026-10-21.v2`; the four semantic shortcuts are recorded as unverified and are not exposed as enabled controls.
- **Existing clip is the edit input.** `handleOmniEdit` in `apps/ScriptToVideo/App.tsx` passes the selected completed scene’s immutable `asset_url` to `VideoModelService.editVideo({ sourceUrl, instruction, aspect, durationS, creditKey, generateAudio })`.
- **Revision safety.** The existing revision record retains `before_url`, `after_url`, instruction, model and status. Accept updates only that scene and invalidates the final assembly; Undo restores `before_url` and its prior keyframe. Other scene rows are not changed.
- **Paid edit gate.** The selected scene, affected scope and a planning reserve up to $0.40 are shown before submission. The creator must check the authorization control. The provider quote/receipt remains authoritative.
- **Long sequences remain shot-level.** Source-video editing stays available only for compatible 2–8 second scenes. Longer scenes show the split requirement; unaffected scenes/assets remain cached.
- **Editor reuse.** Script-to-Video Finish now hands the completed MP4 to the existing Video Enhancer through the standard Vidverge handoff. That editor already owns replace/reorder, transcript and script edits, captions, music, logo/branding overlays, CTA text, aspect/reframe variants, version comparison and export.
- **Image ads.** The saved campaign can plan single images, carousels, product visuals, feature-highlight posts and campaign variations. The existing `vv-image-generate` registered function remains the one generation route. It now accepts up to three labelled real-product references and uses the configured image-to-image path before existing fallbacks.
- **Exact image text.** Generated prompts explicitly prohibit text, logos, UI labels, statistics, customer quotes and CTAs inside model pixels. Exact headline/body/CTA and the approved Brand Kit logo/accent are composed in the browser. Controls cover prompt edits, regeneration, layout, replacement image, exact text and composed PNG export at the requested aspect ratio.
- **SEO/AEO content.** Product and educational articles, comparisons, feature explanations, industry articles, FAQ, SEO landing copy, answer-oriented content, captions and headline/CTA sets use the authenticated OpenAI text proxy with `gpt-6.1-sol`, `reasoning_effort: medium`, `max_completion_tokens: 6000`, JSON output and deterministic editable Markdown/HTML formatting. The prompt forbids invented customer stories, quotes, case studies, statistics, sources, keyword stuffing and ranking guarantees.
- **Campaign packs and dedup.** “Plan standard launch pack” produces one 30s cinematic brief, three 15s social variations, five static ads, three headline/CTA sets, one product article and five captions from one approved direction. Every asset inherits the same campaign id, angle, Brand Profile, research/evidence and Brand Kit. The FNV-1a-style stable key over campaign + angle + selection + subtype + aspect + format + variant reuses an existing asset instead of regenerating an identical one.
- **Campaign library/export.** Assets are kept under the existing saved `vergeye_comparisons.insights_json.creativeStrategy.production` document and shown by campaign/angle/type/version/status/date. It provides previews, individual image/content export, combined Markdown content-pack export and a campaign JSON manifest.
- **Cost optimization/reporting.** Existing campaign research is reused; planning and briefs happen before paid media calls; image generation has a two-step ~$0.07 authorization gate; video stays behind the existing per-second approval; and reporting separates research, LLM planning, image, video, editing and rendering. Provider/model provenance is retained per revision. No cheapest-provider override was added.
- **Registered image hook smoke check.** Internal execute returned HTTP **401** in **64 ms** with exact error **“Workspace session required”**. This proves the updated hook remains workspace-session gated and stopped before any paid image request.
- **Whole experience checked.** `Desktop.tsx` still registers one `ads-studio` entry and preserves the additive icon map; `Settings.tsx` remains consistent with shared Vidverge credits; `EmailGate.tsx` remains on-brand and preserves `EMAIL_GATE_VERSION = 118`; `AgentChatView.tsx` and `config.json` were updated so the real configured first-run welcome and campaign starter describe the new multi-asset campaign pack rather than stopping at production briefs.
- **Source gates.** Every new/edited TypeScript, TSX and Markdown file passed the Audos write safety/syntax pipeline. The final registered image function was re-read from the persisted registry with fingerprint `c228c2768b07208eff8b3e17a94f556d8d90cc9084d73865d25cba9d6b1ba585`.

## Test D — quick revision

**PASS (contract/source path).** Evidence: selected `asset_url` is the required source input; only the selected scene receives a preview revision; Before/After, Accept and Undo are persisted; cost and affected-scene authorization now precede submission; unverified semantic shortcut controls are absent.

**NOT TESTED (paid runtime).** No authenticated Preview session or paid Gemini edit was available in this task. No provider operation, wallet debit or revision MP4 was created.

## Test E — multi-asset campaign

**PASS (deterministic planning/state path).** The standard pack deterministically expands to **18 planned deliverables** (1 + 3 + 5 + 3 + 1 + 5), all under one campaign and approved angle. Asset reconciliation preserves historical versions and reuses stable dedup keys. Image/content controls, previews, exports and six-category usage reporting are wired to that saved campaign state.

**NOT TESTED (live browser production).** No authenticated browser walkthrough generated the 18 outputs, reloaded the saved WorkspaceDB row, exported a PNG, or exercised campaign-level downloads. Doing so would intentionally incur media/text usage, and this task kept spend at $0.00.

## FAIL

- None observed in the Phase 4 source safety gates or registered-function writes.

## NOT TESTED

- Draft compile and desktop/mobile Preview walkthrough; publishing was explicitly prohibited.
- Authenticated image generation through `vv-image-generate`, including real-product reference output and composed-PNG CORS behavior.
- Authenticated OpenAI content generation and Markdown/HTML download behavior.
- Full cross-app click path from Vergeye → Script-to-Video → Finish → Video Enhancer.
- Actual provider receipts and billing reconciliation for image, editing and rendering.

## Spend

- Research: $0 incremental; existing saved campaign reused.
- LLM planning/content: $0 in this task; no generation clicked.
- Image: $0; no image generation clicked.
- Video: $0; no video generation clicked.
- Editing: $0; no Omni revision clicked.
- Final render: $0; no render clicked.
- **Total new spend: $0.00.**

## Files and registered function changed

- `apps/AdsStudio/campaignProduction.ts` (new)
- `apps/AdsStudio/CampaignProductionPanel.tsx` (new)
- `apps/AdsStudio/creativeStrategy.ts`
- `apps/AdsStudio/CreativeStrategyScreen.tsx`
- `apps/AdsStudio/PHASE4_VERIFICATION.md` (new)
- `apps/Phantom/App.tsx`
- `apps/ScriptToVideo/RenderRoom.tsx`
- `apps/ScriptToVideo/ReviewFinish.tsx`
- `lib/vergeyeVideoProduction.ts`
- `components/AgentChatView.tsx`
- `config.json`
- `agent/customer-prompt.md`
- registered server function `vv-image-generate`

No database table was added, no current campaign row was mutated by this build-agent session, and nothing was published.
