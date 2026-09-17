# Track B motion playbook (founder-supplied, Sep 2026)

This is the design-knowledge source the composition engineer (LLM 3) learns from.
The pipeline renders through the platform's Remotion service, so these are
IDEAS to adapt (interpolate/spring), never literal GSAP timelines or CLI runs —
the distilled, Remotion-adapted digest lives in the `trackb-orchestrator`
server function as `MOTION_PLAYBOOK`, and the scripter (LLM 1) picks one
`motion_style` per project: `apple_minimal` | `kinetic_clip` | `bento_grid`.

## Style presets

### 1. Apple Minimal / Simple Gradient (clean, calm, high prestige)
- Aesthetic: soft shifting pastel/mesh gradients (deep violet → electric cyan, soft sunset peach), large grotesque typography, generous negative space, frosted-glass cards (backdrop blur ~30px).
- Motion: gentle scale-in (0.96 → 1.0, ~0.8s, power2-style ease), letter-spacing (tracking) reveals on headlines, continuous subtle y-float (~8px) on cards.

### 2. Fast-Paced Kinetic / Clip Style (high energy, Reels/TikTok promo)
- Aesthetic: bold high-contrast text, 2–3 second scene beats, punchy neon accent badges, kinetic typography 70px+.
- Motion: whip-pan transitions (exit x:-1920, enter x:1920 → 0 at matched velocity), word-by-word staggers (y:40, ~0.05s stagger, back/overshoot ease), hard cuts with zero downtime.

### 3. SaaS Bento Grid / Feature Showcase (Linear/Stripe style)
- Aesthetic: dark slate tiles (#0d1117), fine 1px rgba(255,255,255,0.08) borders, feature pills, code-snippet-like panels.
- Motion: sequential tile pops (power3-style), simulated cursor that glides and clicks (ripple + state change), focus-zoom camera pans into one tile or into the real screenshot.

## Component ideas (recreate with interpolate/spring)
| Idea | Effect | Best for |
|---|---|---|
| tracing-beam | glowing line draws itself along a path between elements | data flow / steps |
| ui-focus-zoom | camera zoom + pan into part of the real screenshot | feature deep dives |
| text-stagger | word-by-word lift + shimmer | hero headlines |
| tilt-card | 3D perspective tilt on image cards | floating UI shots |
| ticker-takeover | slot-machine roll that locks into a stat | metrics / pricing |
| whip-pan-cut | speed-ramped lateral transition | punchy scene cuts |
| touch-indicator | expanding tap circle at an interaction point | mobile tours |

## Narrative arc (30s master template)
1. 0–5s hook — pain point, high-contrast text
2. 5–11s onboarding / pre-mapped features
3. 11–17s hero feature walkthrough
4. 17–23s daily dashboard / output view
5. 23–30s call to action + brand badge (logo chip)

## Mockups from the real thing
At least one feature scene shows the REAL captured screenshot inside a clean
browser/device mockup frame with a focus-zoom or cursor-click moment; the
visual director (LLM 2) additionally generates text-free product-UI mockup
imagery informed by what the product actually does.
