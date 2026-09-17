# Track B — Customer Product Editor

The customer-facing editor is a **narrow UI wrapping `@hyperframes/player`** (the
`<hyperframes-player>` web component). It is NOT a second composition engine and
never exposes CodeMirror or composition source to the customer.

## Where the pieces live

| Piece | Location | Why |
|---|---|---|
| Mutation contract (canonical) | `track-b/editor/mutation-contract.json` | Single definition of what a customer may change |
| Authoritative enforcement | `trackb-project` **server function** (platform hook registry) | Ownership, validation, credits, undo/redo, user-wins conflict rules run server-side |
| Customer UI | `apps/ProductStudio/` (space app) | The Audos space compiler only ships `apps/`, `components/`, `lib/` etc. — files under `track-b/` are not part of the compiled page, so the UI lives in `apps/` and implements this contract 1:1 |
| Shared client types/constants | `lib/trackB/` | Imported by the space app; mirrors `schema/project.schema.json` (that file is canonical) |

## Customer controls (complete list)

- **Text** — headline, caption per scene
- **Timing** — scene duration, validated against the PLANNER `timing_range` and global bounds
- **Music** — track selection from the project's approved/frozen audio assets + volume
- **Colour** — brand-token based (never free-form hex)
- **Regenerate Scene** — credit-gated, isolated, budget-enforced

Everything else (layout, motion system, asset sources, composition code) is
PLANNER/BUILDER-owned and rejected server-side with an explicit reason.

## Preview

The editor points `<hyperframes-player src>` at the project's published
composition when one exists, and falls back to the last rendered MP4 otherwise.
Edits made after the last render are flagged "pending re-render" — the preview
never pretends to be a live second renderer.
