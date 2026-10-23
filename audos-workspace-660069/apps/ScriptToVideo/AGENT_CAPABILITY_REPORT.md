# Script-to-Video Director capability report

Date: 2026-10-22  
Scope: `apps/ScriptToVideo` only. This task did not call publish. Platform status recorded a separate/concurrent publish at 15:58 UTC while this task was still saving and verifying files.

## Capability matrix

| Capability | Implementation | Model | Evidence/source |
|---|---|---|---|
| Tool use | Ten project tools: read project, read scene failure, inspect visuals, edit brief, edit character, edit/re-split prompt timing, regenerate one scene, approve plan, start render, stop/pause render. Mutations become visible proposals and require Approve or Decline; reversible plan changes carry an Undo snapshot. | Claude Opus 5 | `anthropic-text-generation` platform docs: `/proxy/anthropic/v1/messages` forwards `tools` and `tool_choice`; model guidance selects `claude-opus-5` for tool orchestration and consequential multi-step reasoning. Existing app controls in `App.tsx` and `pipeline/orchestrator.ts` confirm the project mutations and durable render hooks used by the tools. |
| Vision | `inspect_scene_visuals` attaches saved character sheets, uploaded references, storyboard stills, first frames and extracted final frames (up to the proxy/app's existing ten-image practice). | Claude Opus 5 | Existing verified `pipeline/opus.ts` sends Anthropic URL image blocks and records `method: "opus_vision"`; current `s2v_film_scenes` rows contain first/final frame URLs and Opus vision verdicts. No new image endpoint was invented. |
| Reasoning | The tool agent uses adaptive thinking with the only documented Opus 5 effort setting: medium. Small edits are limited to one narrowly scoped proposal rather than adding another model call. | Claude Opus 5 | `anthropic-text-generation` docs: Opus 5 cannot disable thinking and must use `thinking: {type:"adaptive"}` with `output_config: {effort:"medium"}`. |
| Structured output | Anthropic input schemas plus local semantic validators run before any proposal can touch project state. Invalid arguments are returned to the model once for repair; a second invalid attempt becomes a visible error and changes nothing. | Claude Opus 5 | `anthropic-text-generation` docs confirm `tools` forwarding; implementation is in `assistantRuntime.ts`. |
| Long context and memory | Every final serialized request is capped at 120,000 input characters and 220 KB. System instructions and the latest turn are always preserved; older turns become a persisted rolling summary, oversized tool results keep head/tail plus status/error/ids, and inline base64/data URLs are removed. `Diagnose from evidence` sends a fresh compact packet for the failed scene only. A proxy length rejection triggers one aggressive retry. Full saved chat remains in `s2v_films.plan.assistant`; it is compacted for sending, never deleted. | Claude Opus 5 primary; GPT 6.1 Sol secondary/vision | Shared implementation: `contextBudget.ts`; the documented proxy ceilings remain 200,000 conversation characters and 256 KB body, leaving deliberate headroom. No table was created. |
| Proactive diagnosis | Visible cards trigger on stored scene failure, the existing 15-minute no-progress threshold, stored character/identity validation failure, or a measured silent clip. Diagnosis tools expose provider status, operation ID, actual model/duration, stored error, validation, references and audio-probe measurements; missing evidence is stated rather than guessed. | Claude Opus 5 | Existing `pipeline/orchestrator.ts` exports the stall threshold and update-time calculation. Existing `pipeline/capture.ts` measures decoded PCM energy. `RenderRoom.tsx` now persists that measured result into scene validation. |
| Safe limits | Tool validation and execution retain cast approval, immutable source script, model duration ranges, audio-capable model rules, reference limits, saved authorization ceiling and durable start/stop behavior. Regeneration is refused while another provider job is active. | Deterministic app code; Claude Opus 5 selects tools | `v2Contracts.ts` capability registry version `2026-10-22.1`, `modelPicker.ts`, `videoModelService.ts`, and current `stv-scene-generate` / `s2v-recovery-sweeper` contracts. |

Timeout policy: the first calls have no guessed browser timeout. After two successful calls of the same mode (text or vision), the next timeout is the measured maximum plus the measured range; text timings never set a vision timeout. Each successful duration is persisted with that film.

## Every AI call in the Director

All Director model traffic goes through one audited call site, `callClaude()` in `assistantRuntime.ts`.

| Logical call | Trigger | Model | Reasoning | Max output | Tools | Vision |
|---|---|---|---|---:|---|---|
| Initial turn | Every user message | `claude-opus-5` | adaptive / medium | 16,000 | Ten validated project tools | No image unless the saved conversation itself contains none; project facts are text context. |
| Tool-result continuation | After a read/diagnosis tool | `claude-opus-5` | adaptive / medium | 16,000 | Available until a mutation proposal is formed | Yes when the selected tool returns saved reference/storyboard/extracted-frame URLs. |
| Proposal explanation | After a mutation proposal | `claude-opus-5` | adaptive / medium | 16,000 | Omitted, so no unapproved second action can be requested | No new images. |

Claude Opus 5 is primary for text planning and tool use. GPT 6.1 Sol is the text-only fallback and the approved vision route when frame evidence must be inspected; no unsupported Gemini endpoint is invented.

## Verification status

### Measured in this task

- Strict isolated TypeScript check passed for the new `assistantRuntime.ts` and rewritten `AgentPanel.tsx` using current TypeScript and React types.
- Every Audos write passed the workspace syntax/safety gate.
- A manual pre-change snapshot was created: “Before Script-to-Video tool-using director upgrade.”
- No premium image/video generation or long render was run.

### Read and verified from current code/data

- The model, reasoning, token, body-size and context limits above were read from current `anthropic-text-generation` docs.
- Existing film/scene/asset schemas and sample rows were read through WorkspaceDB. They include real failed provider errors, operation provenance, visual validation results, character references and extracted frames.
- Current render controls and durable worker hooks were read before wiring tools; no Agent Studio code was added.

### Not tested

- No draft preview URL was available in the authenticated browser, so the requested screenshots, mobile/desktop interaction checks and one tiny real Opus call could not be run. The live published build was deliberately not used because it predates this draft.
- A full workspace typecheck/build was not available without invoking publish, which this task did not do. Platform status later showed a separate/concurrent publish at 15:58 UTC; this task did not use that live build for verification.
