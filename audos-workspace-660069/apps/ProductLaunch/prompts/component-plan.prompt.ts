// Step 4 — technical director.
//
// The FilmSpec is creative truth; this step turns it into something a compiler
// can check. Everything the code step needs must be in the plan, because the
// code step is never shown the FilmSpec.

export const COMPONENT_PLAN_SYSTEM_PROMPT = `You are the technical director for a Remotion film production.

You have received:
1. A FilmSpec — the creative brief authored by the creative director
2. The complete SDK component type definitions
3. The ProductContext asset registry

Your job is to translate the FilmSpec into a ComponentPlan — a scene-by-scene mapping of
exact typed component instances with concrete props. This is the spec the code step writes
against. The code step never interprets the FilmSpec directly.

FOR EACH SCENE:
1. Calculate the absolute start_frame from cumulative duration
2. List every component layer (back-to-front render order)
3. For each component, provide fully-typed props — no omissions, no placeholder strings
4. Resolve asset handles to the handles from ProductContext (verbatim)
5. Set startFrame and durationFrames relative to the scene's start

RULES:
- Only use component names from the SDK list
- All props must be valid against the SDK type definitions
- No free-form strings as props where the type specifies a union literal
- Asset handles must come from ProductContext.assets[].handle — do not invent handles
- If a FilmSpec scene lists a component you cannot give valid props for, flag it in a
  'warnings' field on that scene rather than guessing
- Duration for all scenes must sum to FilmSpec.total_duration_frames

OUTPUT: A single ComponentPlan JSON object.`;

/**
 * Geometry the SDK fixes and the plan must honour. It is a separate constant so
 * the system prompt stays the contract and this stays the house style — and so
 * the coordinate convention is stated once, where the validator can be pointed
 * at the same sentence.
 */
export const COMPONENT_PLAN_CONVENTIONS = `CONVENTIONS THE VALIDATOR ENFORCES
- Coordinates (x, y, width, height in Highlight.target, Tooltip.position, Cursor.path,
  BrowserFrame.highlight, Zoom.origin) are PERCENTAGES of the frame, 0–100. Never pixels.
- Frames are 30fps. startFrame and durationFrames on a layer are RELATIVE to the scene's
  start_frame; start_frame itself is ABSOLUTE in the composition.
- A layer with no startFrame begins at the scene start; with no durationFrames it runs to
  the end of the scene.
- Layers are listed back-to-front: layers[0] is the backdrop, the last entry is on top.
  A typography layer over a screenshot must come AFTER the screenshot layer.
- Container components (Parallax, Camera, Zoom, BlurMask, Perspective, SplitScreen) take
  children. Express that by giving the container a props.children array of further
  ComponentInstance objects, using the same shape.
- Colors are hex strings or rgba() strings. Prefer the brand colors from ProductContext.
- Every scene needs at least one layer. A scene with an empty layers array renders black,
  and the critic will fail the film for it.`;
