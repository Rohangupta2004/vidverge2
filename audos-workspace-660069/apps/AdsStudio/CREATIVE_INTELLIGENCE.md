# Vergeye Ads Studio — Creative Intelligence contracts

Version: `vergeye.creative-strategy.v1` + `vergeye.s2v-handoff.v1` · Draft · 21 October 2026

Phase 2 extends the merged Vergeye Ads Studio; it does not add another app or renderer. The strategy agent receives only the approved Brand Profile, campaign goal, optional direction, selected competitor profiles, and approved findings. It never receives full project history. Approved strategy remains in the existing `vergeye_comparisons.insights_json.creativeStrategy` document, so the current autosave/resume path stays authoritative.

## Phase 2 runtime contract

### `CreativeAngle`

```ts
type CreativeAngle = {
  id: string;
  type: 'Problem > Solution' | 'Before > After' | 'Product Demo' |
    'Competitive Differentiation' | 'Explainer' | 'Founder Story' | 'UGC-style' |
    'Cinematic' | 'SaaS Launch' | 'Curiosity Hook' | 'Feature Highlight' |
    'Customer Pain Point' | 'Social Trend Adaptation' | 'Benefit-focused';
  conceptName: string;
  marketingObjective: string;
  targetAudience: string;
  openingHook: string;
  coreMessage: string;
  suggestedVideoStyle: string;
  cta: string;
  recommendedDurationSec: number;
  recommendedPlatforms: string[];
  whyItMayWork: string;
  reasoningType: 'evidence-backed' | 'analysis' | 'hypothesis';
  strategicReasoning: string;
  evidence: Array<{ label: string; sourceUrl: string; findingId?: string; observedAt?: string }>;
  productionComplexity: 'low' | 'medium' | 'high';
  scoreBreakdown: {
    brandFit: number; audienceRelevance: number; evidenceStrength: number;
    productionFeasibility: number; distinctiveness: number;
  };
  totalScore: number;
  rank: number;
  compatibilityTags: string[];
  claimReview: 'clear' | 'needs_human_review';
  source: 'agent' | 'custom' | 'combined';
};
```

The server function `vergeye-creative-strategy` owns deterministic validation after the model call: allowed types, lengths, score clamps and totals, evidence URL/id checks, default competitor-name redaction, guarantee neutralisation, UGC testimonial guardrails, unsupported comparison review flags, and final ranking.

### `CreativeBrief`

`CreativeBrief` is the Phase 2 → Phase 3 handoff. One brief is emitted per approved angle × selected content type. It includes brand snapshot, goal, concept, audience, hook, message, style, CTA, duration, format, aspect ratio, platforms, evidence/reasoning, complexity, route, image text policy, requirements, and claim-review state. `production.scenePlanningReady` is always `true` after deterministic construction.

Routes:

- every video subtype → existing Script-to-Video five-stage engine and its existing `s2v_*` tables/hooks;
- `SaaS launch` selects the existing Product Launch component workflow inside that engine and requires real/approved UI;
- UGC, talking head, cinematic, competitive differentiation, motion graphics, explainer, social short and compatible custom blends are style configuration objects, never separate renderers;
- image ads → later image composition (`GPT Image` creates imagery; exact text is overlaid afterwards);
- marketing content → later text production.

## Phase 3 implemented contract

`buildVergeyeVideoHandoff()` emits the style-specific editable script plus the complete CreativeBrief, Brand Kit snapshot, selected style configuration, campaign references, originating angle id, aspect, requested runtime, claim-review state, router mode and one-line routing reason. Script-to-Video consumes it without creating a new table, queue, storyboard, editor or project type.

The shared style engine is version `vergeye.video-style.v1`; the verified three-model capability registry is `vergeye.video-capabilities.2026-10-21.v1`. Automatic, manual and hybrid routing evaluate duration, style, complexity, character consistency, product references, camera motion, dialogue/audio, aspect/resolution, availability and recorded failures. The current proxy contract—not upstream marketing—sets limits: Seedance 2.5 is 4–30s; Kling Omni 3.0 is 5s/10s, not 15s; Gemini Omni 1.1 Flash is up to 8s.

Before approval, Script-to-Video exposes an editable plan for objective/dialogue, visual, camera, cast, environment, sound, continuity, reference URL, duration and model, plus reorder/add/delete/regenerate controls. Approve Plan & Start hands the same rows to the durable worker. Regeneration names the affected scene and extra credit authorization; approved scenes stay untouched.

## Phase 3–5 durable contracts

### `Campaign`

```ts
type Campaign = {
  id: string; ownerKey: string; name: string; goal: string;
  brandProfileSnapshot: object; researchReportId?: number;
  approvedAngleIds: string[]; creativeBriefIds: string[];
  status: 'draft' | 'briefed' | 'producing' | 'review' | 'complete' | 'failed';
  createdAt: string; updatedAt: string;
};
```

Phase 3 may promote this document to an additive `vg_campaigns` table only when server-side multi-asset production needs leased workers. Until then, the existing saved comparison row is the campaign aggregate.

### `CampaignAsset`

```ts
type CampaignAsset = {
  id: string; campaignId: string; creativeBriefId: string;
  kind: 'video' | 'image' | 'article' | 'comparison' | 'landing-copy' | 'caption' | 'headline-cta';
  provider: string; model: string; sourceUrl?: string; outputUrl?: string;
  exactTextLayers?: Array<{ text: string; role: string; placement: string }>;
  provenance: Array<{ sourceUrl: string; findingId?: string }>;
  status: 'planned' | 'quoted' | 'generating' | 'ready' | 'failed';
  qaState: 'not-run' | 'pass' | 'needs-review' | 'fail';
  createdAt: string; updatedAt: string;
};
```

### `ModelDecision`

```ts
type ModelDecision = {
  id: string; campaignAssetId: string; intent: string;
  selectedIntegration: string; selectedModel: string;
  alternatives: Array<{ model: string; reasonRejected: string }>;
  routingReason: string; capabilityRegistryVersion: string;
  quotedCredits?: number; quotedProviderCost?: number; currency?: string;
  decidedAt: string;
};
```

Routing must extend `lib/videoEngines.ts` and `lib/videoEngineClient.ts`; no new provider catalog belongs in Vergeye.

### `Revision`

```ts
type Revision = {
  id: string; campaignAssetId: string; parentRevisionId?: string;
  version: number; requestedBy: 'user' | 'qa' | 'critic';
  instruction: string; changedFields: string[];
  priorOutputUrl?: string; outputUrl?: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  createdAt: string;
};
```

A revision is append-only. It never mutates the approved CreativeBrief or silently replaces evidence/claims.

### `ExportRecord`

```ts
type ExportRecord = {
  id: string; campaignId: string; campaignAssetId: string;
  revisionId?: string; format: string; aspectRatio: string;
  destination: 'download' | 'workspace-library' | 'social-publisher';
  outputUrl: string; bytes?: number; durationSec?: number;
  exportedAt: string; status: 'ready' | 'failed'; error?: string;
};
```

## Cost and claim rules

- Strategy, rankings and brief construction spend no video credits.
- Video estimate is exact under the shared Vidverge meter: one credit per finished second × quantity × approved angles.
- Image generation does not start in Phase 2. Phase 3 must obtain and show the provider quote before charge.
- Competitive facts require a source; otherwise `claimReview` is `needs_human_review`.
- Competitors are not named by default. UGC-style never implies a real customer testimonial or endorsement.
- Scores explain planning criteria only and must never be presented as expected conversion, revenue, engagement or guaranteed performance.

## Current architecture conflicts and least disruptive fixes

1. **Product Launch accepts a URL, not a full CreativeBrief.** Phase 2 now consumes the handoff and prefills the approved URL; it does not fork Product Launch. A manual-only Brand Profile still needs a URL before the launch engine can reconstruct a real product UI.
2. **Existing Ads Studio rich production state is localStorage while Vergeye research is server-persisted.** Phase 2 keeps approved strategy/briefs in the durable comparison row and hands a compact brief into the existing engine. Moving the mature production session to a new campaign table would be an unnecessary Phase 2 migration.
3. **Image and marketing production surfaces do not yet exist inside the merged studio.** Phase 2 emits complete contracts and estimates but does not create duplicate generators. Phase 3 should consume the contracts through platform integrations and existing composition/render systems.
4. **`ad-recipe-studio` is still independently registered in the current draft.** This predates Phase 2 and conflicts with the architecture note that Vergeye Ads Studio is the one merged ad product. Phase 2 did not copy or modify that implementation. The least disruptive correction is a separate owner-approved registry consolidation after confirming which existing recipe entry points must remain reachable from Ads Studio; removing the registration without that check could strand saved user workflows.

## Phase 2 QA evidence

### PASS

- Audos source safety gates accepted both new TypeScript modules and every targeted TypeScript/config edit; the config schema gate accepted the updated app description.
- `vergeye-creative-strategy` is stored, enabled, and registered with `workspace_session` execution auth.
- An internal execution without a validated customer session returned `401 Workspace session required` in 56 ms. This proves the auth gate stops the request before the OpenAI proxy or any data write.
- The browser request sends both `X-Session-Id` and the required `X-Workspace-DB-Token`; the server forwards the workspace token to `/proxy/openai/v1/chat/completions` with `gpt-6.1-sol`, `reasoning_effort: medium`, `max_completion_tokens: 6000`, JSON mode, and one call per generation step.
- Deterministic post-model code covers the 14-type allow-list, required field normalization, score clamping/recalculation/ranking, approved-finding evidence checks, competitor-name redaction, guarantee neutralisation, unsupported comparison review flags, UGC testimonial guardrails, and fallback records for omitted types.
- Strategy state, selections and briefs reuse the existing `vergeye_comparisons.insights_json` autosave contract. No table, billing schema, worker queue, Script-to-Video production code, or Video Provider Lab code was changed.
- Video cost preview uses the existing locked meter: one video credit per finished second × quantity × approved angles. Image generation is not started in Phase 2 and requires a later provider quote.
- Shell consistency was checked across Desktop, AgentChatView, Settings and EmailGate. Desktop and Settings already matched; AgentChat first-run copy/starter and EmailGate Vergeye/60-credit copy were updated. `EMAIL_GATE_VERSION` was preserved and incremented to 118.

### FAIL

- None observed in the source safety gates or server-function registration.

### NOT TESTED

- Authenticated Preview generation against the live OpenAI proxy: the build-agent run has no validated customer workspace session, and the expected auth gate prevented a model call.
- Full compiled-space/module-resolution check and manual desktop/mobile browser walkthrough: this task remains an unpublished draft and no publish/preview compile was triggered.
- Authenticated WorkspaceDB autosave/reopen, cross-studio handoff clicks, Product Launch URL prefill, and Script-to-Video/Ads Studio intake prefill in a customer browser.
- Any paid image/video generation, provider quote, credit debit/refund, render, or export. No paid operation was attempted.
