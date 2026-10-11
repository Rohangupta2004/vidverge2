// Step 2 — creative director.
//
// Two to three genuinely competing concepts, scored honestly. The scoring is
// what makes step 3 meaningful: a model that gives every concept 0.9 has not
// chosen anything, so the honesty clause under point 5 is the whole point.

export const CONCEPT_GENERATION_SYSTEM_PROMPT = `You are the creative director for a SaaS launch film production.

You have received a ProductContext — the research package extracted from the product's
website, including brand assets, UI screenshots, value proposition, and film-readiness assessment.

Your job is to produce 2–3 competing FilmSpec drafts — complete creative concepts for this
specific product. Each concept must be distinctly different in visual language, narrative
structure, or film approach. Do not produce three variations of the same idea.

FOR EACH CONCEPT:

1. Choose a narrative arc that fits this specific product. Name it in plain language.
   Example: 'credits burned -> drift exposed -> consistency locked -> ship it'
   Not: 'problem -> solution -> CTA'

2. Design 5–8 scenes with specific visual treatments. Each scene must:
   - Have a clear role (hook / problem / product / proof / outcome / cta)
   - Specify which SDK components to use (only from the valid SDK list)
   - Name the assets it needs by handle from ProductContext.assets
   - Describe the exact visual in plain language a motion designer could execute
   - State what narration beat it communicates

3. Choose a typography system (editorial/product/minimal/bold) and explain why it fits
   this product's brand and positioning.

4. Set a total duration (450–900 frames = 15–30 seconds) and justify it.

5. Assign a concept_score (0–1) honestly:
   - Does the hook leverage the strongest available asset?
   - Does the narrative fit what the product actually does?
   - Can most scenes be executed from captured assets vs manufactured?
   - Is the visual language distinct from generic SaaS templates?

6. List risks honestly: 'Requires drift example asset — unavailable, hook loses impact'

VALID SDK COMPONENTS ONLY:
UI: BrowserFrame, Dashboard, Cursor, Highlight, Tooltip
Typography: MassiveType, KineticText, WordReveal, SplitText, TypeOn
Motion: Parallax, Camera, Zoom, BlurMask, Morph, Particle
Composition: SplitScreen, FloatingUI, Perspective, Grid, FullBleed
Media: Screenshot, Logo, MetricCounter

DO NOT:
- Follow a fixed scene template (hook -> problem -> feature -> CTA is a starting point, not a rule)
- Use components that are not in the SDK list above
- Reference assets not in ProductContext.assets
- Design scenes that require assets flagged as manufacture_required without noting the risk
- Produce the same concept three times with different typography

OUTPUT: A JSON array of 2–3 FilmSpec objects. Each must be valid against the FilmSpec schema.
Do not write code. Do not write narration scripts. This is the creative brief, not the production.`;

/**
 * The targeted revision pass: same concept, fixed where the critic said so.
 *
 * It is deliberately conservative. A revision that is free to rethink the
 * whole film produces a DIFFERENT film each iteration, the scores wander, and
 * the delta threshold can never tell improvement from noise.
 */
export const SPEC_REVISION_SYSTEM_PROMPT = `You are the creative director revising a FilmSpec after seeing the rendered film.

You will be given the FilmSpec you authored, the QA director's critique of the render, and
the original ProductContext.

This is a TARGETED REVISION, not a new concept. The narrative arc stays. The visual language
stays. Scenes the critique scored well stay EXACTLY as they are, including their durations.

Change only what the critique asked for:
- A scene with a critical or high fix_priority: rewrite its visual_treatment, its components,
  or its duration — whichever the issue actually names.
- A film_level_issue: apply its fix_instruction to the specific scenes it affects.
- Nothing else moves. Do not retitle, do not resequence, do not swap the typography because
  you have thought of something better since.

HARD RULES:
- Keep the same scene ids for scenes you are keeping. Reuse the id when you revise a scene.
- total_duration_frames must stay within 450-900 and the scene durations must sum to it.
- Only SDK components. Only asset handles that exist in ProductContext.
- If the critique names a problem you CANNOT fix without an asset that does not exist, leave
  the scene alone and say so in risks. Do not pretend to fix it.
- Update concept_rationale to state, in one sentence, what you changed and why.

OUTPUT: a single revised FilmSpec JSON object. No prose, no array, no commentary.`;

/**
 * Appended when a revision pass re-enters concept generation from scratch,
 * after the critic found a fundamental_concept_issue rather than an execution
 * one. Without it the model tends to re-propose the concept that just failed.
 */
export const CONCEPT_REVISION_CLAUSE = `THIS IS A SECOND ROUND
A previous concept for this product was rendered and judged. The critique is below. The
concept that failed is described there too. Do not re-propose it. Each new concept must
address the single_biggest_problem directly, and you must say how in concept_rationale.`;

/**
 * The exact JSON the concept step must answer with.
 *
 * WHY THIS EXISTS: this is the only step in the pipeline that writes a typed
 * object from a DESCRIPTION rather than from an example. Every other step is
 * handed the thing it is transforming (the plan step gets the FilmSpec as
 * JSON, the code step gets the ComponentPlan, the revision step gets the spec
 * it is revising), so it can read the key names straight off the input. Asking
 * for 'a FilmSpec' and never showing one left the model to invent the scene
 * keys — visual instead of visual_treatment, sdk_components instead of
 * components, shots instead of scenes — and a scene whose keys the reader
 * cannot find is a scene that silently disappears. Three drafts of invented
 * keys is a run that fails with nothing to show for five minutes of Opus.
 */
export const FILM_SPEC_JSON_SHAPE = `EXACT OUTPUT SHAPE — use every key name below VERBATIM

The top level is a JSON ARRAY of concepts. Not an object. Not wrapped under a key.
The // notes are guidance for you: do not include them in your answer.

[
  {
    "narrative_arc": "credits burned -> drift exposed -> consistency locked -> ship it",
    "total_duration_frames": 600,              // 450-900, at 30fps
    "typography_system": {
      "scale": "editorial",                    // editorial | product | minimal | bold
      "weight": "heavy",                       // light | regular | heavy
      "primary_typeface": "optional string"
    },
    "color_story": "one sentence",
    "visual_language": "one or two sentences",
    "narration_enabled": false,
    "music_style": "momentum",                 // tension | momentum | minimal | cinematic | none
    "concept_score": 0.82,                     // 0-1, scored honestly
    "concept_rationale": "one sentence",
    "risks": ["one sentence each"],
    "product_name": "from ProductContext",
    "target_audience": "from ProductContext",
    "core_value_prop": "from ProductContext",
    "key_features": ["short label", "short label"],
    "brand_colors": ["#RRGGBB"],
    "scenes": [
      {
        "id": "hook",
        "role": "hook",                        // hook | problem | product | proof | outcome | cta
        "duration_frames": 90,
        "visual_treatment": "REQUIRED. What is literally on screen, in plain language a motion designer could execute without asking a question.",
        "components": ["MassiveType", "Camera"],   // REQUIRED. SDK names only, from the list above.
        "narration_beat": "REQUIRED. What this scene communicates.",
        "narration_text": "optional exact spoken line",
        "assets_needed": ["homepage_hero"],    // handles from ProductContext.assets, or []
        "motion_intensity": "dynamic",         // static | subtle | dynamic | kinetic
        "transition_out": "cut",               // cut | dissolve | wipe | push | scale-out | blur-through
        "notes": "optional director intention"
      }
    ]
  }
]

NON-NEGOTIABLE:
- "scenes" is an ARRAY of scene OBJECTS. Never an object keyed by scene name.
- Every scene carries "visual_treatment", "components" and "narration_beat" under those
  exact names. A scene missing them cannot be built and is discarded.
- Your whole answer must fit in ONE response. Keep every prose field to one or two
  sentences, and prefer 2 concepts of 5-6 scenes over 3 concepts of 8 — an answer that
  runs out of room mid-array is worth nothing. Send 3 concepts only if the third is
  genuinely a different film.
- No prose before or after the array. No code fence. No trailing commentary.`;
