# VERGEYE ADS STUDIO — Phase 5 quality and optimization report

Date: 21 October 2026  
Status: **working draft; not published**  
New generation spend: **$0.00**  
Draft-browser screenshots: **not captured** — the browser had no authenticated Audos draft session or draft preview URL. The public site was not used as a substitute.

## Phase 4 prerequisite

**PASS.** Phase 4 exists in the current draft. Evidence: automatic snapshot **451** (“Cursor edit saved (12 files)”, 20:56 UTC) follows the Phase 4 snapshots, and `apps/AdsStudio/PHASE4_VERIFICATION.md` plus the Phase 4 campaign production, Script-to-Video, Omni edit, image, content and export paths are present. Phase 5 used this current draft as its baseline.

## Executive result

Phase 5 added a campaign and final-video quality validator, fixed three confirmed reliability bugs, added durable idempotency for paid campaign-image requests, serialized campaign generation to prevent state loss, bounded browser waits for research, and preserved all existing Vidverge production routes. No billing table was changed. No provider generation, wallet debit, refund or publish occurred.

Full paid end-to-end generation remains **NOT TESTED** because this task had no authenticated draft Preview session and deliberately did not substitute the published site or incur media spend. Source/contract checks below distinguish what is proven from what still requires an authenticated human walkthrough.

## Quality validator — every required check

| Check | Status | Evidence / behavior |
|---|---|---|
| Output duration | PASS (validator implemented); paid runtime NOT TESTED | Script-to-Video Finish reads the encoded MP4 duration from `loadedmetadata`, compares it with the approved/requested runtime, and uses a ±5% or 1-second tolerance. Campaign video assets also require explicit review before approval. |
| Aspect ratio | PASS (validator implemented); paid runtime NOT TESTED | Finish measures encoded width/height and compares it with the approved 16:9 or 9:16 ratio. Campaign assets retain the planned ratio. |
| Audio/video sync where checkable | PASS (partial automation) | Narration duration is automatically checked against its scene duration. Full dialogue, caption, music-ducking and visual-beat sync remains an explicit human playback check. |
| Missing/damaged frames | PASS (partial automation) | Missing scene assets and failed scene validations automatically fail. Final black/frozen/corrupt/duplicated transition frames require a human scrub check. |
| Product visual accuracy | PASS (human gate) | The validator requires comparison against the supplied real-product reference/screenshot and says when no canonical reference exists, rather than asserting accuracy. |
| Presenter consistency | PASS (human gate) | UGC/talking-head assets and films with character references require identity, wardrobe, voice and appearance review. |
| Brand colours/logos | PASS (human gate) | Campaign checks display the approved accent/logo evidence and require a person to confirm palette, logo treatment and safe areas. |
| Text/caption accuracy | PASS (human gate) | Image copy remains deterministic overlays; final video copy/captions require explicit spelling and wording confirmation. |
| Appropriate CTA | PASS | Missing campaign CTAs fail automatically; CTA appropriateness and destination require human approval. |
| User-approved claims only | PASS | Every asset requires human claim approval. Unsubstantiated and competitor-sensitive claims are explicitly marked mandatory review; automation never marks them substantiated. |
| Asset-use rights | PASS (human gate) | Every asset requires confirmation for logos, product images, presenter references, source clips, music and external assets. |
| Generated people | PASS | UGC/talking-head and presenter-led work requires confirmation that generated people are dramatized/generated performers, never real customers or endorsers. |
| Research source access limits | PASS by existing contract/source review; live source failure NOT TESTED | Existing Vergeye architecture records CAPTCHA/login/rate-limit/access failures as unavailable and prohibits bypass. This task did not execute protected or rate-limited sources. |

Campaign approvals persist inside the saved Phase 4 production document. Final-video approvals persist in the existing `s2v_films.plan.background.quality_review` checkpoint, so leaving and reopening the project does not discard them.

## End-to-end scenarios

| Test | Status | Evidence | What remains |
|---|---|---|---|
| A. SaaS launch: website URL → brand → competitors → research → angle → SaaS script → S2V → routing → timeline edit → export | **NOT TESTED** end to end | Source path exists: Vergeye Discover/Research/Strategize; `SaaS launch` brief; `buildVergeyeVideoHandoff`; shared Script-to-Video stages; Finish handoff to Video Enhancer. Phase 4 report confirms the route contract. | Authenticated draft walkthrough, real URL extraction, actual production, editor handoff and export. |
| B. 15s UGC ad: character, dialogue, branding, cost | **NOT TESTED** end to end | 15s UGC defaults to 9:16; script rules forbid invented testimonials; cast approval/reference reuse, dialogue, brand context, per-second estimate and new presenter/claims/rights QA gates are present. | Generate a real 15s ad and inspect presenter consistency, spoken dialogue, final branding and provider receipt. |
| C. Multi-shot cinematic on Seedance and/or Kling | **NOT TESTED** end to end | Shared routing supports Seedance 2.5 and Kling Omni 3.0 legal blocks, continuity references, final-frame extraction, stitch and final scene-asset QA. Existing S2V acceptance evidence covers a two-block Omni stitch, not this exact Seedance/Kling campaign. | Paid Seedance/Kling multi-shot render, continuity review and final compilation playback. |
| D. Quick revision via Omni Flash, unaffected assets unchanged | **NOT TESTED** paid runtime; **PASS** source path | Selected scene `asset_url` is the source input; revisions keep before/after, Accept and Undo; only one scene updates and assembly is invalidated. Other scene rows/assets remain unchanged. | Authenticated paid Omni edit and before/after playback. |
| E. Multi-asset campaign sharing one brand context | **NOT TESTED** live production; **PASS** deterministic planning | Standard pack expands to 18 planned deliverables under one campaign/angle/Brand Profile/research/Brand Kit. Stable asset keys, campaign library/export and per-asset QA are present. | Generate/reload/export the full pack in authenticated Preview. |
| F. Failure recovery: provider/research/network/interruption/no duplicate paid generation | **NOT TESTED** full runtime; **PASS** safe probes and source controls | `vv-image-generate` still rejected the no-session probe with HTTP 401 in 55ms before any provider call. Missing Ads worker job returned HTTP 404 in 300ms. Credit ledger query after task start returned zero rows. Durable operation keys now checkpoint before a paid campaign image request and replay done/running/error state. Campaign generation is serialized. | Authenticated fault injection against provider 429/5xx, browser interruption after submit, research-source unavailable, and reload/resume with a real operation receipt. |

## Reliability checks

| Check | Status | Evidence |
|---|---|---|
| Idempotent paid requests | PASS for campaign images; existing video paths retained | Campaign image operation key includes campaign, asset, revision, attempt and request fingerprint. `vv-image-generate` inserts the key before provider submission; a unique index rejects races; repeats replay the persisted response/status. |
| No duplicate paid generation after uncertain response | PASS by source | Network, timeout-like, HTTP 429, HTTP 5xx and post-generation storage uncertainty remain `running/reconciling`; the same key never auto-submits again. |
| Retries with backoff | PARTIAL | Existing S2V workers use bounded polling/fallback and Ads Studio polls every 8s with a 15-minute cap. Campaign paid images intentionally do not retry an uncertain POST. Authenticated 429/Retry-After behavior remains untested. |
| Timeouts | PASS | Ads worker has three-minute execution budgets and a 15-minute no-progress cap. Vergeye browser research now stops waiting after two minutes and warns that server work may still finish, rather than hanging or blindly retrying. The image hook remains under the registry’s bounded default timeout. An attempted timeout metadata update was rejected by the tool contract and was not retried. |
| Rate-limit/concurrency controls | PASS for campaign generation; research runtime NOT TESTED | Campaign production now permits one generation at a time, preventing stale-state overwrite. Provider 429 is treated as uncertain/no-resubmit. Parallel research-agent load behavior requires authenticated fault injection. |
| Durable checkpoints/autosave | PASS by source | Campaign state remains in `vergeye_comparisons.insights_json.creativeStrategy.production`; keyed paid image receipts use existing `creatables_jobs`; S2V uses its project/scene rows and background checkpoint. |
| Resume after leaving page | PASS by source; runtime NOT TESTED | Reopening with the same operation key returns done/running/error without a new submit; S2V and Ads workers already adopt provider operations. Browser-close exercise remains unrun. |
| Error observability | PASS | Customer UI shows plain generation/quality errors; operation ledger retains status/error/result; no provider debug payload is shown in campaign UI. |
| Ledger accuracy | PASS for this task; paid runtime NOT TESTED | `vv_credit_ledger` had zero entries after Phase 5 began. Existing video charge/refund paths and stable refund keys were preserved. No billing table/schema was changed. |
| Refunds on failed generations | PASS by existing worker source; runtime NOT TESTED | `ads-studio-worker` calls idempotent `vv-credits` refunds on terminal provider failure or 15-minute no-progress closure. Campaign images use platform wallet billing; no new custom refund policy was invented. |

## Performance, UX and accessibility

| Check | Status | Evidence |
|---|---|---|
| Fast first interaction | PASS by source | Phase 5 adds no blocking request on load; validators compute locally. |
| Background research progress | PASS by existing UI/source; runtime NOT TESTED | Existing Discover/Research role states and saved/cache timestamps were preserved. |
| Loading/empty/error states | PASS by source | Busy buttons, campaign empty state, reconciliation message, final assembly progress, per-layer errors and quality pass/review/fail states are explicit. |
| Desktop and mobile layouts | PASS by source; visual runtime NOT TESTED | Campaign image grid collapses to one column at 760px; usage cards collapse; shared stage rail/mobile fallbacks remain. No authenticated draft screenshots were possible. |
| Accessible controls/contrast | PASS by source with remaining visual audit | Quality confirmations use labelled checkboxes; selects have visible labels; status uses text plus colour/icon; controls retain the amber/charcoal system. Automated contrast and keyboard traversal were not run. |
| No debug information in customer UI | PASS | Messages describe user actions/status and do not expose stack traces, provider payloads or secrets. |
| Consistent Vidverge styling | PASS by source | New controls use existing Phantom/Vidverge tokens and Script-to-Video `T` tokens; no competing theme was introduced. |

## Whole-experience review

Checked `Desktop.tsx`, `components/AgentChatView.tsx`, `components/Settings.tsx` and `components/EmailGate.tsx` after the app-surface changes. Desktop still has one `ads-studio` registration and the intact additive `iconMap`; Agent Chat already names the full campaign pack in its first-run welcome/starter; Settings remains on the same credit model; Email Gate stays on the Vidverge dark amber system and preserves `EMAIL_GATE_VERSION = 118`. These four surfaces required no Phase 5 edits.

## Confirmed bugs and fixes

| Confirmed bug | Responsible file/hook | Fix |
|---|---|---|
| Parallel asset generations used stale captured state and could overwrite another asset or usage record. | `apps/AdsStudio/CampaignProductionPanel.tsx` | Added a current-state ref/commit path and serialized campaign generation. Async completion now merges into the latest persisted state. |
| Campaign image requests had no durable idempotency record; a network interruption could leave the user unsure whether retrying would charge twice. | `apps/AdsStudio/campaignProduction.ts`, registered `vv-image-generate`, `creatables_jobs` | Added stable operation keys, pre-submit checkpoint, unique-key race protection, persisted terminal response, and reconciliation state for uncertain outcomes. |
| Phase 4 had only a `qaState` label and no implemented campaign/final-video validator or rights/claims/people gate. | `apps/AdsStudio/campaignProduction.ts`, `CampaignProductionPanel.tsx`, `apps/ScriptToVideo/ReviewFinish.tsx` | Added automatic and human checks, encoded media metadata validation, explicit claim/competitor review, generated-person disclosure, and durable approvals. |
| Vergeye research calls had no browser-side timeout, so a lost connection could leave the UI waiting indefinitely. | `apps/Phantom/api.ts` | Added a two-minute abort boundary with an honest reconciliation message and no automatic retry of uncertain work. |

## Safe probes and spend evidence

- `vv-image-generate` with no validated session: **401 Workspace session required**, 55ms; no provider call.
- `ads-studio-worker` status for missing job: **404 No such job**, 300ms; no write/provider call.
- `creatables_jobs` query for the gate-only operation key: **0 rows**.
- `vv_credit_ledger` query from 20:59 UTC onward: **0 rows**.
- Total media/LLM generation spend in Phase 5: **$0.00**.

## Documentation follow-up

A draft follow-up was created for `server-functions`: the presented tool contract documented `timeout_ms` on update, but the actual update call rejected it as an unknown argument. The draft asks the platform docs/tool schema to state the real timeout-edit contract. This mismatch did not block Phase 5 because the function already has a bounded registered execution timeout.

## Remaining / not tested

1. Authenticated draft desktop/mobile walkthrough and screenshots across Discover → Research → Strategize → Create → Edit.
2. Paid scenario A–F outputs and provider receipts, including Seedance/Kling continuity and Omni revision playback.
3. Real network interruption after submit, 429/Retry-After, provider 5xx, and reopened-browser reconciliation.
4. Full keyboard/contrast audit and composed-PNG CORS export in Preview.
5. Research concurrency under unavailable/rate-limited sources.

These are runtime verification gaps, not hidden passes. No CAPTCHA, authentication or rate-limit bypass was attempted.

## Rollback notes

- Restore point **451** is the last restorable automatic Phase 4 baseline before Phase 5 changes. Snapshot **452** records the Phase 5 pre-edit request but currently reports non-restorable; use 451 if a full rollback is needed.
- The `creatables_jobs` change is additive: nullable `operation_key`, `request_hash`, `response_json` plus a unique index on `operation_key`. Existing row 13 was untouched and all new fields remain null on it.
- Rolling back app/hook source leaves the additive nullable columns inert; no data migration or billing rollback is required.
- No billing tables were altered destructively or otherwise.

## Unpublished draft changes that need publishing after review

- `apps/AdsStudio/campaignProduction.ts`
- `apps/AdsStudio/CampaignProductionPanel.tsx`
- `apps/ScriptToVideo/ReviewFinish.tsx`
- `apps/Phantom/api.ts`
- `apps/AdsStudio/PHASE5_QUALITY_REPORT.md`
- registered server function `vv-image-generate`
- additive WorkspaceDB schema on `creatables_jobs`

Nothing was published in this task.
