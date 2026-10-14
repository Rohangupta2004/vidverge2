# SceneForge Phase 7 architecture

## Decision

New `motion_graphic` and `text_overlay` scenes stay as structured `composition_spec` data and render frame-by-frame inside the final server-side Remotion assembly. SceneForge no longer records those animations with `requestAnimationFrame`, SVG rasterisation, `canvas.captureStream`, or `MediaRecorder` in the active production path.

## Evidence

- The existing `AssemblyComp` already interprets independent element positions, timing, entrance/exit motion, camera depth, z-order, text, stats, charts, arrows, images and backgrounds deterministically at render time.
- Browser capture only progresses while the tab is alive and able to paint frames. The legacy recorder explicitly fails when a hidden/background tab produces a header-only WebM. That is the same lifecycle class that stranded long-running video jobs on 12 Oct 2026.
- The Remotion operation id is persisted and polling resumes after reload, so rendering is not coupled to one browser session.

## Compatibility contract

- `spec` remains the exact deterministic content/layout source.
- New compositions store `composition_spec` plus `video_prompt: "ec:…"`, derived from the same stable motion-spec bytes. Editing `spec` changes the fingerprint and forces a rebuild.
- Historical rows with a valid `mg:…` fingerprint and video URL remain readable and play as legacy media. They are not rewritten or deleted.
- Landscape output animates element layers in Remotion. The platform Remotion service is fixed at 1920×1080, so portrait output uses a deterministic transparent 1080×1920 card made from the same stored spec; it does not perform real-time browser capture.

## Paid generation contract

- Primary scene-video model: `openrouter/bytedance/seedance-2.0-fast`.
- Explicit routing fallback: canonical `gemini-omni-1.1-flash` (`OMNI_MODEL_ID`). The fallback receives the unchanged prompt, duration/scene division, seed image and available reference images, and the UI records why it fired.
- The shared `sceneDurationLimitsFrom`, `formatSceneDurationHint`, and `validateSceneDurations` contract runs before paid SceneForge submits. Seedance itself accepts 10s, but SceneForge advertises and enforces the 2–8s intersection that both Seedance and Omni can render, so fallback never truncates or silently splits the user's scene division. The active workbench and scene planner show that same effective rule.
