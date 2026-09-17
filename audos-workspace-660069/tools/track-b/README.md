# Track B — Product Video module (HyperFrames)

Implements the **Product Video Track** PRD v1.1. This module is completely
separate from Track A (the Veo/Omni AI-footage pipeline): no Track A file,
server function, table, or config is modified or consumed by anything here.

## Runtime constraints (non-negotiable, enforced in code)

1. **No MCP.** Stages use shell commands, the local filesystem, and direct HTTPS
   to model APIs only.
2. **Offline rendering.** Once assets are frozen, the render stage re-audits the
   ledger hashes and rejects any composition that references a remote URL —
   rendering completes with zero network calls.
3. **Orchestrator-agnostic.** Every stage is a discrete CLI with file-based I/O
   and on-disk state (`pipeline-state.json`); the module does not know an
   orchestrator exists.

## Setup

```bash
npx skills add heygen-com/hyperframes --all --full-depth
npx hyperframes init --example blank
npx hyperframes doctor   # resolve everything it reports before running renders
```

Environment keys the orchestrator provides: `ANTHROPIC_API_KEY` (plan/build/QA),
`GEMINI_API_KEY` and/or `OPENAI_API_KEY` (asset generation). Model overrides:
`TRACKB_PLAN_MODEL` (default `claude-opus-5`), `TRACKB_BUILD_MODEL`
(default `claude-sonnet-5`), `TRACKB_QA_MODEL`.

## The 8-stage pipeline

Each stage: files in → files out, independently retryable, state on disk.
A project lives in one directory (anywhere on disk); pass it as `--project`.

```bash
node pipeline/intake/run.js   --project P --url https://example.com   # or --upload DIR | --apify FILE
node pipeline/plan/run.js     --project P [--brief "..."]             # Opus 5 → plan.json (route, scenes, voice_plan, asset manifest, checklist)
node pipeline/assets/run.js   --project P                             # catalog → stock icons → generated → scraped; frozen + ledgered + hashed + deduped
node pipeline/build/run.js    --project P                             # Sonnet → <project>/index.html (text = coded overlays only)
node pipeline/validate/run.js --project P                             # hyperframes lint && check && validate (+ keyframes diagnostics)
node pipeline/render/run.js   --project P --docker [--verify-determinism]
node pipeline/qa/run.js       --project P                             # vision QA + product fidelity, binary pass/fail, contact sheet
node pipeline/deliver/run.js  --project P [--confirm-audio] [--confirm-alpha]
```

Or sequentially: `node pipeline/run.js --project P --url ... --docker`.

Exit codes: `0` success · `1` stage failure (retryable) · `2` usage · `3` **PLAN_DEFECT**
(recorded in `<project>/plan-defects.json`; the pipeline halts and never improvises).

## Single source of truth

`<project>/project.json` is the HyperFrames project — Studio, the Product
Editor, the agent, and the Player all read/write this one model
(`schema/project.schema.json` is the canonical shape, including the
PLANNER/BUILDER/USER/SYSTEM field-ownership map and the scene states
`EDITABLE | BAKED | REGENERATING | ERROR | LOCKED`). Every mutation bumps
`project.version`; every render records the exact project/schema/manifest/
composition/audio/voice versions (`renders[]`).

## Routes

`config/routes.json`: Product Launch (20–40s) · Feature Update (10–20s) ·
Product Tour (45–90s) · Comparison (flexible) · Announcement (8–15s).
Timing envelopes are enforced when the plan is accepted and when the customer
edits scene durations.

## Credits

`config/credits.json` — configurable tiers, `expensive_threshold` (cost shown
before execution), zero-cost failure rule, and regeneration budgets
(max attempts / max credits / escalation threshold). The platform-side copy
lives in the `trackb_config` WorkspaceDB row and can be tuned without a deploy.

## Customer editing

See `editor/README.md` and `editor/mutation-contract.json`. The in-space
Product Editor (`apps/ProductStudio/`) wraps `@hyperframes/player`; the
`trackb-project` server function is the authoritative mutation gate (ownership,
validation, credits, undo/redo, user-wins conflict resolution, live sync).

## Track selection

The track selector is explicit — the customer chooses **Video** (Track A) or
**Product** (Track B) in the chat/product UI before generation; nothing
auto-routes silently. The choice persists as `track` on the project
(`'product'` here; Track A projects are not managed by this module).

## Asset format rules

Icons: SVG `currentColor` · Backgrounds/textures: PNG/WebP · Grain: inline CSS
`radial-gradient` ONLY (never SVG filters / `data:image/svg+xml`) · never
upscale low-res assets. All enforced in the build stage's hard checks.
