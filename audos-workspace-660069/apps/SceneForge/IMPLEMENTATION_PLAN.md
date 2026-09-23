# SceneForge → Premium Motion-Graphics Explainer — Implementation Plan

> **Status: PLAN ONLY.** Written 2026-09-23 after a full read of every file under `apps/SceneForge/` and the founder's 12 spec documents (story-engine.md, render-rules.md, heygen-mcp.md, vox-visual-language.md, data-and-maps.md, README/AGENTS/CLAUDE/SKILL/CHANGES/PROMPTS + template README) plus the QC reference images (qc_sheet.jpg = 11-frame temporal contact strip; qc_keyframes.jpg = frame 0 + the frames on both sides of every cut; both in the cream paper-cut style). This document is self-contained: an implementing session should be able to execute it without re-reading the specs.

---

## 0. Current architecture (verified against source, Sep 23 2026)

**Pipeline** (`App.tsx`, statuses on `Project.status`): `scripting → script_review → avatar_render → style_choice → scene_planning → scene_review → asset_gen/coding → assembling → checks → done → editing`.

**One LLM** (`agents/orchestrator.ts`, `claude-opus-5` via `POST /proxy/anthropic/v1/messages` with `X-Workspace-DB-Token`; 256 KB body cap, `max_tokens ≤ 8192`, opus gets `thinking:{type:'adaptive'}` + `output_config:{effort:'medium'}`): writes the script + per-beat image briefs (`writeScript`, 130 wpm, default 5 min), plans the scene manifest against HeyGen word timestamps (`planScenes` — 4 visual kinds `ai_video | image | motion_graphic | text_overlay`, 10 motion layout kinds, per-scene `composition {mode: overlay|central|fullscreen, position, scale, keepAvatarVisible, purpose}`), reviews the assembly (`reviewAssembly`), and routes Verger change requests (`routeChangeRequest`). The **Motion Director** (`agents/motionDirector.ts`, same model) writes per-scene Visual Timeline JSON (`director_timeline`: layers with role/type/zone/entrance/exit, camera, pacing, transitions from `zoom_match_cut | spatial_collapse | push_through | slide_context | layer_reveal | wipe_directional | crossfade`); `reviseSceneDirection` is the QA auto-fix; `fallbackDirection` is the deterministic fallback.

**HeyGen is already the generation engine for the presenter** (`hooks/useHeyGen.ts`): REST **v3** through the platform credential proxy `/api/workspaces/{WORKSPACE_ID}/provider-credentials/heygen/proxy/…` (key = platform secret `HEYGEN_API_KEY` or a per-workspace credential; never in client code). Catalog: `GET v3/avatars/looks?limit=50` (token paging, cap 50), `GET v3/voices?limit=100`; submit: `POST v3/videos` (`type:'avatar'`, engine `avatar_iv|avatar_v|avatar_iii` resolved from the look's `supported_api_engines`, `script`, `voice_id`, `voice_settings:{speed 0.5–1.5}`, `resolution`, `aspect_ratio`, 9:16 forces `fit:'cover'`, `background {color|image}`, `output_format mp4|webm`); poll `GET v3/videos/{id}` every 15 s ×240; on complete store `video_url`, `duration`, and word timestamps parsed from `subtitle_url` WebVTT (fallback `approximateWordTimestamps`). Terminal failures are `HeyGenRenderError` (e.g. `SPACE_ENCRYPTION_DISABLED`, translated for humans) and clear `heygen_video_id`.

**Middle-visual production** (parallel 3-lane queue in `App.tsx → generateSupportingScenes`):
- `ai_video` → `lib/videoTool.ts` → `POST /api/veo/generate/video` model `gemini-omni-flash-preview` (max 8 s, loops in composition), poll `/api/veo/status/{op}`.
- `image` → `lib/imageTool.ts` → server function op `scene_image` → `/api/veo/generate/image` model `gemini-3.1-flash-image` (the ONLY image model).
- `motion_graphic` / `text_overlay` → `lib/motionPipeline.ts` `produceMotionScene`: ensure Director timeline → `lib/motionCapture.ts` records the GSAP+SVG build (SVG rasterized per frame to canvas → `canvas.captureStream(30)` + MediaRecorder VP9 WebM 7–8 Mbps, serialized capture queue, broken-capture byte-floor guard) → `lib/visualQa.ts` (frames at 8/25/50/75/92 %, ≤640 px JPEG, ≤150 KB total base64, Opus vision; issue codes `blank_frame, clipped_element, collision, unreadable_text, covered_face, z_order, missing_asset, timing, mechanical, content_mismatch`) → on flag, Director revision + re-render, max 2 retries.
- Reuse: `lib/assetReuse.ts` token-overlap matching; capture fingerprints `mg:<spec-hash>.d<direction-hash>` in `video_prompt` gate regeneration.

**Motion engine** (`components/MotionGraphicPlayer.tsx` `buildMotionGraphic(spec, W, H, dur, {transparent, panel, unitScale, directed})` + `lib/motionPrimitives.ts` 22 primitives + `lib/motionKit.ts` vocabulary + `lib/spatial.ts` zones/face-band/auto-shift): hardcoded **dark theme** — `BG '#0A0F1E'`, `PANEL '#121C30'`, `INK '#F8FAFC'`, `FONT 'Inter…'` — with content-aware accents (`lib/motionSpec.ts accentForSpec`). Serialization constraints: concrete hex only, per-element font stacks, data:-inlined images, attribute/transform tweens only.

**Assembly** (`App.tsx assemble` + `remotion/AssemblyComp.tsx`):
- **9:16** → `POST /api/workspaces/{id}/videos/overlay` (server FFmpeg; base = HeyGen master; overlays = full-frame timed assets; **PNG alpha is preserved** — verified by the `s2v-probe` hook Sep 22): motion overlays ship as 2–4 timed transparent 1080×1920 RGBA stills sampled from the same GSAP timeline (`generatePortraitMotionOverlayFrames`), over-avatar text as callout-pill PNGs (`generatePortraitCalloutImage`), images as framed card PNGs; fullscreen scenes/AI clips as full-frame assets. Broken-clip pre-flight (<24 KB ⇒ recapture/callout) prevents FFmpeg exit 234.
- **16:9** → `POST /api/render/remotion` with `createAssemblySource()` (avatar master as continuous `OffthreadVideo` base + one `Sequence` per scene; composition card styles; 15 effect presets; cinematic transition styles; 18 000-frame cap; transient stale-bundle retry ×3). The public Remotion endpoint renders **1920×1080 only**.
- Post-assembly: `completeAssembly` → `lib/checks.ts` six checks (`duration_match, audio_continuity, frame_samples, manifest_complete, scene_share 25–70 %, no_stale_bundle`) → `AssemblyProgress.tsx` Step 7 (player, `ChecksReport`, Opus assembly QC with per-scene weak flags + isolated retry, ElevenLabs music bed via server ops `music`/`mix_music`/`mix_status` — 16:9 mix only, portrait keeps avatar audio), `EditorHandoff` → Video Enhancer.

**Server side**: server function **`sceneforge-v2`** (registry id `e48bf894…`, ~35.5 KB, edit via `workspace_server_functions` op `edit` only — never files) — ops `status, plan_scenes, add_scene, save_scene, delete_scene, save_project, scene_image, adopt_upload, music, mix_music, mix_status, schema`. **Column allowlists silently drop unknown fields** — every new DB column must be added there.

**DB (WorkspaceDB)** — `sceneforge_projects` (37 cols; protected: `assembled_video_url, build_hash, checks`; plus server-only-by-hook: `music_url, music_prompt, final_video_url, stage_note`), `sceneforge_scenes` (29 cols; protected: `render_url, remotion_code`; unique `(project_id, scene_index)`), `sceneforge_assets` (protected `public_url`), `sceneforge_settings`, `verger_requests`. Full current column lists verified via `workspace_db_describe_table` — projects has NO beat/format/qc-sheet columns today; scenes has NO `narration_segment`/beat columns (the planner returns `narration_segment` but it is dropped at persist).

**Styles**: `styles/registry.ts` — visual skins (`vox-explainer` default, `documentary`, `map-animation`, `paper-collage`, + archive) control image-prompt prefix only (the motion engine ignores them); 8 editing presets (planning bias). **UI**: `TopicInput` (Step 1 of 8; topic/audience/language/1–15 min slider/aspect/editing preset/reference-video analysis via `/api/generate/video-analysis`), `ScriptReview`, `HeyGenModule` (avatar+voice pickers, options), `StylePicker` (Step 4), `ScenePlanner` (blueprint board, ~56 KB), `AssetProgress`, `AssemblyProgress` (Step 7), `SettingsPanel`, `AssetStudio`, `RemotionCodePreview` (legacy).

---

## A. Gap analysis

### A1. What SceneForge does today vs. what the spec suite requires

| Area | Today | Spec requirement | Gap |
|---|---|---|---|
| **Script engine** | Generic long-form research script: 130 wpm, default 300 s, plain paragraphs, no beat structure, CTA ending | story-engine.md: 45–60 s master, **170–200 wpm (~3 words/sec)**, beat map `HOOK(0–3s) / CONTEXT(3–8s) / ESCALATION×2–4 / PAYOFF(75–90%) / BUTTON(3–5s)`, word budgets per beat (60 s ⇒ 170–200 words: hook 10–14, context 18–22, escalation 80–100, payoff 40–45, button 10–12), 7 hook formulas ×3 variants, one idea per video, re-hook every 10–15 s, present tense / second person / numbers-not-adjectives, **cold-stop ending, no summary** | Add an **Explainer Short format** with a beat-mapped scripting task; persist beats; keep long-form as-is |
| **Visual language** | Dark tech canvas `#0A0F1E`, Inter, glass panels, topic-keyword accent rotation | vox-visual-language.md: **paper-cut collage** — cream field `#F2EDE4`, near-black `#1A1A1A`, ONE accent (default `#FFEB00`), Archivo Black headlines + Work Sans body, torn-edge cutouts (seeded 4–14 px @ 3–6 % rhythm), two-shadow stack, halftone, single grain overlay 0.08–0.14, tape accents, **highlighter sweep** (one per scene, lands 100–150 ms after text settles), `steps(6)` stutter on a few accents, duotone photos, palette locked per video | Motion engine needs a **theme layer** (tokens instead of hardcoded dark constants) + a `vox-paper` theme + 3 new primitives; per-project palette lock |
| **Timing discipline** | Scene windows from word timestamps; transitions 0.3–0.6 s cinematic moves; no cadence rules | Visual change every **2–4 s**; beat lands **0.12–0.15 s before its trigger word**; cuts are hard cuts (`set`, ~3 frames) not dissolves; frame-grid cut times (`frame/fps − 0.001` analog: snap to the 30 fps grid, round down); one highlighter per scene | Planner rules + a deterministic **plan linter**; hard-cut transition mode for the paper theme; frame-snap of scene windows |
| **QC** | Per-motion-scene Opus vision QA (auto-fix loop) + six mechanical checks + one Opus assembly review | render-rules.md `qc.py` gate: audio present, blackdetect, per-frame **luma sweep**, **cut integrity** (single-frame luma-delta = hard cut; catches off-by-one cuts), **platform-UI safe bands** (top 12 % / bottom 20 % empty), and **two contact sheets** — an 11-frame temporal strip (qc_sheet.jpg) and frame 0 + both frames at every cut (qc_keyframes.jpg) — plus a human editorial pass over every cell | New **film-level QC** over the assembled MP4 + a QC-sheet UI in Step 7 |
| **HeyGen usage** | Full-length avatar master, mp4, script+voice; webm plumbed in types but background dropped and unused by UI | heygen-mcp.md: presenter can float **OVER motion graphics** via `output_format:'webm'` (real VP9 alpha); full-frame A-roll cuts as the default presenter treatment; credits stated before spending; the API `duration` field **under-reports** the real file (always measure the delivered file); studio avatars 25 fps / digital twins 30 fps | Add the transparent-presenter option for 16:9; measure real duration from the downloaded file via a `<video>` element; surface plan/credit info; keep mp4 master as the default path |
| **Data & maps** | `Map` primitive = abstract pins/arcs; planner already varies layout kinds | data-and-maps.md: one chart type per beat, **static base lands on the cut, data animates after**, computed geometry, donut from 12 o'clock, real geography for map beats, **dot/unit population chart** | Chart-base-first choreography in the directed renderer; a `DotUnit` primitive; (optional) real-geo map asset |
| **Platform cuts** | Single master only | Master 45–60 s, then **28–35 s TikTok/Reels cut** (drop the context beat, hook straight to escalation) and full cut for Shorts | Derived-cut generator reusing existing scene media |
| **Output screen** | Step 7: live assembly job panel, player, six checks, Opus QC with per-scene retry, music bed, download, editor handoff | Same + QC sheet visualization (contact strip + cut pairs + luma chart) | Add a QC Sheet panel |

### A2. Files to CHANGE (exact paths)

| File | Why |
|---|---|
| `apps/SceneForge/agents/orchestrator.ts` | New `SCRIPT_TASK_SHORT` (beat map, hook formulas, word budgets, language rules, cold stop) returning `beats[]` + `hook_variants[]`; `SCENE_PLAN_TASK` additions (beat awareness, 2–4 s cadence, `highlight_phrase`, chart-type-per-beat variety, static-base-first rule, persist `narration_segment`/`beat_role`); `writeScript` wpm switch by format; plan post-processing: frame-snap windows, persist new fields |
| `apps/SceneForge/agents/motionDirector.ts` | DIRECTOR_TASK additions: theme vocabulary (`Highlighter`, `Cutout`, `DotUnit`), one-highlighter rule, chart static-base-on-cut rule, hard-cut transition preference for the paper theme |
| `apps/SceneForge/lib/motionKit.ts` | **Theme tokens**: replace the exported constants with a `MotionTheme` object (`bg, ink, inkSoft, inkMuted, panel, panelEdge, headlineFont, bodyFont, accent, paper?: {…}`) resolved per build; add `steps(6)` ease helper, highlighter sweep helper, torn-edge polygon generator (seeded), halftone pattern builder, grain overlay builder, two-shadow (SVG `feDropShadow`) filter builder |
| `apps/SceneForge/lib/motionPrimitives.ts` | Consume the theme; add primitives `Highlighter`, `Cutout` (torn-edge image card), `DotUnit`; chart/timeline/donut choreography: base (axis/labels/source) lands at `at`, data draws from `at + 0.15` |
| `apps/SceneForge/components/MotionGraphicPlayer.tsx` | `MotionBuildOptions.theme?: MotionTheme`; paper background (cream field + grain, no grid/glow) when the theme says so; duotone/desaturate treatment on backdrop images (SVG `feColorMatrix`, single filter — cheap) |
| `apps/SceneForge/lib/motionCapture.ts` | Pass the project theme into `buildMotionGraphic` (capture + portrait overlay frames + callout PNG colors follow the theme); callout pill colors from theme |
| `apps/SceneForge/lib/motionPipeline.ts` | Thread theme through; pass `highlight_phrase` to the director input |
| `apps/SceneForge/lib/visualTimeline.ts` | Add `Highlighter`/`Cutout`/`DotUnit` to `PrimitiveType`; add `hard_cut` to `TransitionType`; `chooseTransition` honors a `themeStyle: 'paper' | 'cinematic'` context (paper ⇒ hard cuts + energy in the incoming element) |
| `apps/SceneForge/lib/effects.ts` | No structural change; add `'hard_cut'` passthrough in composition transition typing if needed |
| `apps/SceneForge/remotion/AssemblyComp.tsx` | `transitionStyle` gains `hard_cut` (≤3-frame snap, no crossfade); scene-window frame snap (floor to frame grid); theme-aware scene fallback background (cream vs dark) driven by a new `props.themeTokens`; optional transparent-webm presenter layer (Phase 4) |
| `apps/SceneForge/styles/registry.ts` + `apps/SceneForge/styles/voxExplainer.ts` | `ForgeStyle` gains `motionTheme` (token set) + `themeStyle: 'paper' | 'cinematic'`; `vox-explainer` becomes the paper theme (`#F2EDE4 / #1A1A1A / #FFEB00`, Archivo Black/Work Sans stacks with system-safe fallbacks); other styles keep the dark theme so existing projects render unchanged |
| `apps/SceneForge/hooks/useHeyGen.ts` | Measure real duration of the delivered `video_url` via a metadata-only `<video>` load (API `duration` under-reports); webm submit variant (no `background` key); optional plan info fetch |
| `apps/SceneForge/components/HeyGenModule.tsx` | "Transparent presenter (16:9)" toggle (gated: mp4 default; webm only for looks that support it — verify by submit error, fall back to mp4 with a note); show measured vs. reported duration |
| `apps/SceneForge/components/TopicInput.tsx` | **Format selector**: `Explainer Short (30/45/60 s)` vs `Long form (minutes slider)`; short format defaults `9:16`, editing preset `vox_explainer` |
| `apps/SceneForge/components/ScriptReview.tsx` | Beat-aware review: show beats with per-beat word budgets and the 3 hook variants (pick one); plain paragraphs still editable |
| `apps/SceneForge/components/ScenePlanner.tsx` | Show `beat_role` chips on scene cards; highlighter-phrase field on motion scenes; plan-lint warnings strip (from `lib/planChecks.ts`) |
| `apps/SceneForge/components/AssemblyProgress.tsx` | Mount the new `QcSheet` panel under the player once `assembled_video_url` exists |
| `apps/SceneForge/lib/checks.ts` | Add film-QC summary check (7th check: `qc_sheet` pass/fail) once Phase 5 lands |
| `apps/SceneForge/lib/supabase.ts` | Types for new columns (`format`, `beats`, `hook_variants`, `style_tokens`, `qc_film_report`, `platform_cuts`; scene `beat_role`, `narration_segment`, `highlight_phrase`); keep `SERVER_ONLY_PROJECT_FIELDS` in sync |
| Server function `sceneforge-v2` (via `workspace_server_functions` op `edit`) | Extend `save_project` / `plan_scenes` / `save_scene` column allowlists with every new column; extend `status` op response to include them |
| `agent/customer-prompt.md` + `config.json` sceneforge app description | Describe the new format + QC sheet once shipped (Phase 6) |

### A3. Files to CREATE (exact paths)

| New file | Purpose |
|---|---|
| `apps/SceneForge/lib/storyEngine.ts` | Deterministic story-engine constants + validators: beat map windows, per-length word budgets, wpm targets, hook formula ids, re-hook cadence; `validateScriptBeats(beats, targetSec)` returning issues |
| `apps/SceneForge/lib/planChecks.ts` | Deterministic plan linter run after `planScenes` and before generation: frame-grid snap, cadence ≤4 s of no visual change, one highlighter/scene, comparison-both-sides, consecutive-kind variety, overlay face-safety (reuses `lib/spatial.ts` FACE_BAND), scene-share sanity, word-budget check per beat. Returns `{fixes[], warnings[]}` — auto-fixable items are applied to the plan (snap, clamp), the rest surface in `ScenePlanner` |
| `apps/SceneForge/lib/motionThemes.ts` | `MotionTheme` type + `DARK_THEME` (today's constants) + `PAPER_THEME` (vox spec: cream `#F2EDE4`, ink `#1A1A1A`, accent `#FFEB00`, headline `"'Archivo Black','Arial Black',sans-serif"`, body `"'Work Sans',Inter,Arial,sans-serif"`), `themeForProject(project, style)` (style registry + per-project `style_tokens` lock) |
| `apps/SceneForge/lib/filmQa.ts` | Browser film-QC over the assembled MP4 (see §F): frame extraction at frame 0 / every cut ±1 / 11-strip, luma sweep, cut-integrity, safe-band sampling, black-frame detection; returns `FilmQaReport` persisted to `qc_film_report` |
| `apps/SceneForge/components/QcSheet.tsx` | The QC sheet UI (see §F): contact strip, cut pairs, luma sparkline, verdict chips, re-run button |
| `apps/SceneForge/lib/platformCuts.ts` | Derives the 28–35 s cut plan from beats (drop CONTEXT, trim escalations) and re-runs assembly with the same media into `platform_cuts` (Phase 6) |
| `apps/SceneForge/styles/voxPaper.ts` *(optional split)* | If keeping `voxExplainer.ts` untouched for legacy projects: a new style id `vox-paper` carrying the paper `motionTheme`; registry default for new short-format projects |

**Naming caution:** the bundler matches file names case-insensitively — never create a sibling differing only in case (e.g. no `motionthemes.ts` next to `motionThemes.ts`).

### A4. DB schema gaps (see §C Phase 1 for exact DDL)

- `sceneforge_projects` lacks: `format`, `beats`, `hook_variants`, `style_tokens`, `qc_film_report`, `platform_cuts`.
- `sceneforge_scenes` lacks: `beat_role`, `narration_segment` (planner already writes it; it is silently dropped today), `highlight_phrase`.
- All additions are **additive nullable columns via `workspace_db_alter_table`** — never a replacement table. The `sceneforge-v2` allowlists must be extended in the same phase or the columns will silently never persist.

---

## B. Architecture decisions

### B1. HeyGen API access — keep the platform credential proxy (decided)

All HeyGen calls stay on the **existing same-origin proxy**: `/api/workspaces/${WORKSPACE_ID}/provider-credentials/heygen/proxy/<v3 path>`. The platform injects `X-Api-Key` server-side from the workspace provider credential when present, else from the platform secret **`HEYGEN_API_KEY`**. Nothing changes about key handling; no key ever appears in `apps/SceneForge/**` or the browser. If a server function ever needs HeyGen directly (none planned), it uses `platform.secretsProxy` with the secret NAME `HEYGEN_API_KEY` (the `{{secrets.HEYGEN_API_KEY}}` template form) — never an inline key.

heygen-mcp.md describes the **MCP connector**; this app uses the **REST v3 API** through the proxy. Semantic mapping (keep this table in mind whenever the spec says "tool"):

| heygen-mcp.md tool | This app's equivalent |
|---|---|
| `get_current_user` (credits) | No proxy-verified v3 equivalent in use; treat as OPTIONAL — attempt `GET v1/user/remaining_quota` once, tolerate 404, and otherwise surface HeyGen's own failure verdicts (already human-translated). Never block on it |
| `list_avatar_groups` / `list_avatar_looks` | `GET v3/avatars/looks` (paged, cap 50) — already implemented with progressive paging + 6 h cache |
| look `id` = `avatarId` | Same: the look id is `avatar_id` |
| `create_video_from_avatar {script, voiceId, aspectRatio, resolution, engine, fit, background}` | `POST v3/videos` — already implemented |
| `create_video_from_avatar {audioAssetId}` (lip-sync) | **NOT implementable here**: the asset-upload dance needs a binary PUT to a presigned URL and the workspace proxy forwards JSON GET/POST only. Decision: narration always comes FROM the avatar render (script + voice_id) — which CHANGES.md itself recommends ("get narration out of a full-length avatar render"). Document as a non-goal |
| `get_video` poll | `GET v3/videos/{id}` — already implemented (15 s × 240) |
| `outputFormat: 'webm'` transparent presenter | `POST v3/videos` with `output_format:'webm'`, no `background` key (already coded that way in `useHeyGen.generate`) — Phase 4 exposes it |

Operational facts from CHANGES.md to encode: long renders can sit in `processing` ~100 min for a ~70 s Avatar IV master (the existing 1 h poll ceiling should rise to 2 h for the long-form format); the API `duration` field under-reports the delivered file (always measure the downloaded file's real duration via a `<video>` metadata load before storing `avatar_duration_sec`); studio avatars return 25 fps, digital twins 30 fps (irrelevant to the FFmpeg/Remotion compositors, which conform inputs, but record it in the plan comments); `resolution:'4k'` is limited to eligible Avatar III digital-twin/studio looks (photo avatars max at 1080p) — gate the 4k option on `supported_api_engines` containing `avatar_iii` and fall back to 1080p on `invalid_parameter`.

### B2. Motion-graphics generation & compositing — keep the GSAP+SVG capture engine, add a THEME layer (decided)

**Recommendation: do NOT switch engines.** Evaluated options:
- *CSS/DOM animations*: not deterministic under capture, no portrait-alpha path — rejected.
- *Server Remotion per scene*: the platform Remotion endpoint is 1920×1080-only, has a documented stale-bundle failure mode, and per-scene renders were the old pipeline's mistake (slow, costly) — rejected for scenes; **kept as the 16:9 final compositor** (already in place).
- *HyperFrames (render-rules.md's own runtime)*: not available as a platform integration in this workspace — its RULES transfer (see §B4), its runtime does not.
- *Existing GSAP+SVG capture* (`buildMotionGraphic` → MediaRecorder → WebM; portrait path additionally samples the same timeline into timed transparent RGBA PNGs): deterministic (same build renders preview and capture), already wired into the Director + vision-QA auto-fix loop, already composites over the live presenter in 9:16 with verified alpha preservation — **keep**, and implement the Vox look as a **theme**, not a new renderer.

**Theme layer design** (`lib/motionThemes.ts`): every hardcoded color/font in `motionKit.ts`, `motionPrimitives.ts`, `MotionGraphicPlayer.tsx`, and `motionCapture.ts` (callout pill) resolves through a `MotionTheme` object. `DARK_THEME` reproduces today's values byte-for-byte so **every existing project and cached capture stays valid** (theme participates in the spec/direction fingerprint ONLY via the new `style_tokens` column on the project — changing the project theme re-fingerprints and re-captures, switching styles never silently reuses old-look clips: implement by appending a short theme hash to `sceneCaptureFingerprint`). `PAPER_THEME` implements vox-visual-language.md:
- Field cream `#F2EDE4`, ink `#1A1A1A`, ONE accent (default `#FFEB00`; the project may lock a different accent in `style_tokens`), 1–2 accents max — `accentForSpec` is bypassed when the theme declares a locked accent.
- Headlines `'Archivo Black','Arial Black',sans-serif` weight 400 all-caps (Archivo Black is a platform-pinned Google-font-family name in the shell; inside captured SVG the font must resolve from the browser — load it once via a `FontFace`/`document.fonts.load` call in the capture path and `await document.fonts.ready` as the callout path already does; if unavailable it degrades to Arial Black, acceptable). Body `'Work Sans',Inter,Arial,sans-serif`.
- Paper constructions as reusable kit helpers: **torn-edge polygon** (seeded from the scene id so re-renders are identical — vary point depth 4–14 px at every 3–6 % of edge length; scale the variance with element size per CHANGES.md's 16:9 finding), **two-shadow stack** (one tight `feDropShadow 0 2 0 rgba(0,0,0,.25)` + one soft `0 8 16 rgba(0,0,0,.20)` in a single filter — SVG filters rasterize fine through the `<img>` path but keep to ≤1 filter per cutout and ONE full-frame grain to respect the heavy-overlay lesson from render-rules.md), **halftone** (SVG `<pattern>` of dots), **grain** (one full-frame `feTurbulence` rect at opacity 0.10), **tape** (small rotated warm-white rect, ≤2 per video), **duotone photos** (single `feColorMatrix` desaturate + tint toward the palette on backdrop/cutout images).
- Motion defaults per the spec table: cutout entrance scale 0.85–0.95→1 `back.out(1.4)` 0.40–0.50 s; camera push `power2.inOut` 0.5–0.7 s at 104–106 %; highlighter 0.26 s `power3.out` landing **+0.12 s after** its text settles; word reveal stagger 0.05–0.08; bars 0.6 s stagger 0.12 `power3.out`; route draw 1.0–1.2 s `power1.inOut`; `steps(6)` ease on at most 1–2 accent elements per scene; never `linear`, never bare `from()` (motionKit already bans bare fades).

### B3. Story-engine script → HeyGen → scene-manifest mapping (decided)

The **continuous HeyGen master remains the audio spine** (`audio_strategy: 'continuous_heygen_voiceover'`) — this is exactly the documentary model the specs assume, and it sidesteps per-clip lip-sync entirely.

Flow for the new `format: 'explainer_short'`:
1. `writeScript` runs `SCRIPT_TASK_SHORT`: target 30/45/60 s at ~3 words/sec (i.e. 85–100 / 127–150 / 170–200 words), returns `{script, beats:[{role:'hook'|'context'|'escalation'|'payoff'|'button', text, target_start_sec, target_end_sec, image_brief}], hook_variants:[3 strings + formula id], sources, estimated_duration_sec}`. The script value is the beats joined — plain spoken words only (HeyGen reads it verbatim). Language rules baked into the task: one clause one idea, present tense, second person, numbers not adjectives, no throat-clearing, verbal transitions ("But watch what happens…"), re-hook cue every 10–15 s, biggest number withheld to 75–90 %, **end on the payoff line — no summary, no CTA before payoff** (long-form keeps its existing CTA ending).
2. Avatar render as today (`POST v3/videos`) → word timestamps from the subtitle VTT.
3. `planScenes` gets `beats` + timestamps. New hard rules appended to `SCENE_PLAN_TASK` for this format: align beat boundaries to the **actual spoken words** (match each beat's first/last words in the timestamp stream — the deterministic matcher lives in `lib/storyEngine.ts`, not the LLM: it re-times `beats[].start/end` before planning); the HOOK beat gets a `motion_graphic`/`text_overlay` **anchor overlay** in the first 3 s (composition `overlay`, presenter visible — replaces the old "first 5 s stay clean on the talking head" rule for this format only); something changes every 2–4 s (an overlay build, chart bar, map draw counts); exactly ONE `highlight_phrase` per scene (the planner names the phrase; the Highlighter primitive sweeps it); PAYOFF beat carries the biggest visual (big_stat / chart with the answer bar in accent); BUTTON beat is presenter-only, cold stop.
4. Every plan-persisted scene stores `beat_role`, `narration_segment`, `highlight_phrase`; `lib/planChecks.ts` then snaps windows to the frame grid (floor to 1/30 s), enforces cadence, and clamps overlaps.

### B4. Render-rules (HyperFrames) → this stack: what transfers and where it is enforced

render-rules.md is written for the HyperFrames HTML runtime; the engine differs but most rules are renderer-independent truths. Enforcement mapping:

| Rule (render-rules.md) | Enforced pre-generation | Enforced post-generation |
|---|---|---|
| Cuts are sets, not short tweens; cut time = frame/fps − ε | `planChecks.ts` frame-snaps windows; `AssemblyComp` `hard_cut` transition (≤3 frames) for paper theme | `filmQa.ts` cut-integrity: large luma delta at the declared cut frame, ~0 at the next (off-by-one cuts detected) |
| Every scene lands already composed; chart base on the cut, data after | Directed-renderer choreography (§E chart rule); Director task text | Vision QA `blank_frame` + new film-QC frame at each cut |
| Frame 0 composed (thumbnail) | Capture paints the first frame before recording (already does) | Film QC includes frame 0 in the sheet |
| Hidden-at-frame-0 needs CSS/initial state | motionKit sets initial states with `gsap.set` before capture (already) | Vision QA |
| Never animate layout props / no CSS-vs-GSAP transform conflicts | motionKit vocabulary only tweens transforms/attrs (already) | — |
| Draw lines via `strokeDashoffset` | `drawnLine`/`drawnPath` (already) | — |
| Heavy overlay caps (filters cause black captures) | Theme layer budget: ≤1 filter per cutout, 1 grain rect per frame (code review + a counter in `buildMotionGraphic` that logs when exceeded) | Film QC blackdetect |
| Audio present; +faststart muxing | Platform FFmpeg/Remotion own muxing — out of scope | Film QC verifies the assembled file has audible audio via `AudioContext.decodeAudioData` on a ranged fetch (best-effort; skip on CORS) |
| Safe bands (top 12 % / bottom 20 %) | `spatial.ts` zones already respect them for directed layers; `planChecks` validates overlay positions | Film QC samples the safe bands for non-background content (9:16 only) |
| Sharpness: no 3D tilt on text; no scale >1.0 pushes | motionKit has no 3D rotation; `cameraMove` push-in scales the ROOT above 1.0 — for the paper theme, author-big-scale-down: change `cameraMove('push_in')` to start at `scale 1/1.045` and settle at 1.0 (one-line change in `motionKit.cameraMove`, applies to all themes, strictly better) | — |

---

## C. Phase-by-phase implementation plan

Order is dependency-driven; each phase ships independently and keeps every existing project working. **Rules for the implementing session:** all writes through the audos MCP tools with `expected_version`; edit `sceneforge-v2` only via `workspace_server_functions` (`edit` op — its `codeBytes` is ~35.5 KB so anchored edits, not full `update`); all DDL via `workspace_db_alter_table` (additive; `COLUMN_EXISTS` on re-run is fine); no publish unless asked.

### Phase 1 — Format + story engine + data model

1. **DDL** (`workspace_db_alter_table`):
 - `sceneforge_projects` addColumns:
 - `format` text nullable default `'long_form'` — `'long_form' | 'explainer_short'`
 - `beats` json nullable — `[{role, text, start_sec, end_sec, image_brief, rehook?:string}]`
 - `hook_variants` json nullable — `[{formula, text}]` (3 entries; chosen one is beats[0].text)
 - `style_tokens` json nullable — locked `MotionTheme` overrides `{accent?, field?, ink?, themeId}`
 - `qc_film_report` json nullable — Phase 5 output
 - `platform_cuts` json nullable — Phase 6 output `[{platform, video_url, duration_sec, created_at}]`
 - `sceneforge_scenes` addColumns:
 - `beat_role` text nullable
 - `narration_segment` text nullable
 - `highlight_phrase` text nullable
2. **Server function `sceneforge-v2`** (`workspace_server_functions` op `edit`): find the project-column allowlist used by `save_project` and add `format, beats, hook_variants, style_tokens, platform_cuts` (browser-writable) and `qc_film_report` (browser-writable — it is advisory, like `qc_report`); find the scene allowlist used by `plan_scenes`/`save_scene`/`add_scene` and add `beat_role, narration_segment, highlight_phrase`. Verify with op `execute` (`{op:'schema'}` read-only diagnostic, then a `save_scene` round-trip on a scratch scene).
3. **`lib/storyEngine.ts`** (new): constants `WORD_BUDGETS = {30:{total:[85,100],hook:[8,10],context:[12,15],escalation:[30,40],payoff:[20,25],button:[8,10]}, 45:{…127–150…}, 60:{…170–200…}}`; `WPM_SHORT = 185` (170–200 band); `HOOK_FORMULAS` (demonstrative_anchor, named_entity, reversal, mock_pitch, cost_reveal, trend_callout, scene_set_pivot); `alignBeatsToTimestamps(beats, words)` — greedy match of each beat's leading/trailing words against `word_timestamps`, returns re-timed beats (fallback: proportional split when timestamps are approximate); `validateScriptBeats()`.
4. **`agents/orchestrator.ts`**: add `SCRIPT_TASK_SHORT` (persona unchanged) encoding the beat map, word budgets by target length, the 7 hook formulas with "write three variants, keep the most concrete noun", the language rules, re-hook cadence, withhold-payoff rule, and COLD STOP ("the payoff line is the last spoken line; never summarize, never add a sign-off"); return shape `{script, beats, hook_variants, sources, estimated_duration_sec, scene_image_briefs}`. `writeScript(input)` picks the task + wpm by `input.format`. Keep `claudeJson` budget: beats for a 60 s script are small; no token issues.
5. **`components/TopicInput.tsx`**: format toggle at the top — `Explainer Short` (segmented 30 s / 45 s / 60 s, default 45; forces the minutes slider hidden; recommends `9:16` + editing preset `vox_explainer`) vs `Long form` (existing slider). Pass `format` + `target_length_sec` through `start` → `createProject` (add `format` to the insert in `lib/supabase.ts createProject`).
6. **`components/ScriptReview.tsx`**: when `project.format === 'explainer_short'`, render beats as labeled sections (HOOK/CONTEXT/…) with live word-count vs budget chips and the 3 hook variants as radio options (choosing one rewrites beats[0] and the script head). Approval writes the possibly-edited script AND `beats`/`hook_variants` (via `patch`).
7. **`App.tsx`**: `begin()` stores `beats`/`hook_variants` from the script result; `confirmStyle()` passes `beats` into `planScenes` input; after `heygen` completes, run `alignBeatsToTimestamps` and persist re-timed `beats`.
8. **`lib/supabase.ts`**: type updates; `createProject` carries `format`.

### Phase 2 — Paper theme in the motion engine

1. **`lib/motionThemes.ts`** (new) as specified in §B2. `themeForProject(project, style)`: `project.style_tokens.themeId` wins; else `style.motionTheme`; else `DARK_THEME`.
2. **`lib/motionKit.ts`**: convert `INK/BG/PANEL/…/FONT` constants into a module-level `let currentTheme` + `setMotionTheme(theme)` OR (preferred, no globals) add a `theme` parameter to the helpers that use color/font and default it to `DARK_THEME` — mechanical but wide; keep exported legacy constants aliased to `DARK_THEME.*` so unconverted call sites compile. Add helpers: `stepsEase(n=6)`, `tornEdgePolygon(w, h, seed, variancePct)`, `halftonePattern(defs, accent, u)`, `grainRect(svg, W, H)`, `cutoutShadowFilter(defs)`, `highlighterSweep(tl, parent, textNode, accent, at)` (measures the text bbox, draws an accent rect at opacity .32 behind it, `scaleX 0→1` 0.26 s `power3.out`, `transform-origin` left, **starts 0.12 s after the text's entrance settles**), `duotoneFilter(defs, ink, field)`.
3. **`lib/motionPrimitives.ts`**: accept `theme` in `DirectedRenderContext` (thread from `buildMotionGraphic`); replace direct `INK/PANEL/BG` reads with `ctx.theme.*`; **new primitives**: `Highlighter` (role callout, wraps `highlighterSweep`, `targetLayerId` names the text layer), `Cutout` (image in a torn-edge clip with the two-shadow stack + optional tape; used for archival/backdrop imagery in the paper theme; replaces `ImageCard` when `theme.paper`), `DotUnit` (N×M dot grid; a subset re-colors/regroups to show a share — spec §data-and-maps "unusually visceral"); **chart choreography change**: for `Chart`/`TimelineRail`/`Comparison`/`Diagram`, the static base (axis line, tick labels, titles, source line) enters AT the layer's `entrance.at` with a `set`-like 1-frame reveal, data strokes/bars animate from `at + 0.15` — this is the data-and-maps "static base first" rule.
4. **`components/MotionGraphicPlayer.tsx`**: `MotionBuildOptions.theme`; paper builds: cream field rect + one grain rect, NO grid lines, NO radial glow; backdrop images route through `duotoneFilter` at opacity ~0.9 (full-color photography breaks the palette per spec); classic kind renderers read theme colors. Transparent/panel builds: panel color from theme (paper ⇒ warm white `rgba(242,237,228,0.92)` card with ink text, so over-avatar callouts match the film).
5. **`lib/motionCapture.ts`**: `generateSceneMotionClip`/`generatePortraitMotionOverlayFrames`/`generatePortraitCalloutImage` accept + forward the theme (callout pill: paper ⇒ cream pill / ink text). Append `t<themeHash>` to `sceneCaptureFingerprint` so theme changes re-capture. Load the two Google fonts before capture: `await Promise.all([document.fonts.load('400 64px "Archivo Black"'), document.fonts.load('500 32px "Work Sans"')]).catch(()=>{})`.
6. **`styles/registry.ts` / `styles/voxExplainer.ts`** (or new `styles/voxPaper.ts`): attach `motionTheme: PAPER_THEME` + `themeStyle:'paper'` to the vox style; image-prompt prefix updated to the paper language ("flat editorial paper-cut collage element, torn paper edges, limited palette of cream, near-black and one accent, halftone texture, no text, no lettering"); other styles get `motionTheme: DARK_THEME`, `themeStyle:'cinematic'`.
7. **`agents/motionDirector.ts`**: extend the primitive vocabulary in DIRECTOR_TASK (`Highlighter`, `Cutout`, `DotUnit`), add: "exactly ONE Highlighter per scene, targeting the scene's highlight_phrase, entering 0.1–0.15 s after its text settles"; "for Chart/Timeline/Comparison the frame of reference lands at the entrance instant and the data animates after"; pass `highlight_phrase` + `theme` (paper vs cinematic) in the payload from `lib/motionPipeline.ts`.
8. **`lib/visualTimeline.ts`**: add the three primitive names to `PRIMITIVES`; add `'hard_cut'` to `TRANSITIONS`; `chooseTransition(ctx)` gains `themeStyle` — paper: return `{type:'hard_cut', duration:0.1}` for every cut (the energy lives in the incoming element's entrance per vox spec correction #1), keep cinematic behavior otherwise.
9. **`remotion/AssemblyComp.tsx`**: `transitionStyle` implements `hard_cut` (no transform/opacity ramp; the scene simply appears — allow max 3 frames of a subtle 1.02→1.0 settle on the incoming layer); `buildTimeline` threads `themeStyle` into `chooseTransition`; scene fallback background + gradient scrim colors read from a new `props.themeTokens {field, ink, accent}` passed by `assemble()` (default = current dark values).

### Phase 3 — Beat-timed composition + plan linting

1. **`agents/orchestrator.ts` SCENE_PLAN_TASK** additions (format-gated paragraph appended when `format==='explainer_short'`): input now carries `beats`; every scene names `beat_role` + `narration_segment` + `highlight_phrase` (≤6 words, copied verbatim from the script); HOOK anchor-overlay rule (first 3 s: overlay composition, presenter visible, the concrete anchor named); visual change every 2–4 s — a scene longer than 4 s must be a building visual (chart/timeline/map/list), never a static card; chart-type-per-beat variety (line/donut/stacked/bars/dot-unit/map — never the same form twice in a row; prefer the fuller series over the tidy pair); PAYOFF carries the film's biggest visual; BUTTON beat: no middle visual. Post-processing in `planScenes()`: persist the three new fields (extend the mapped object).
2. **`lib/planChecks.ts`** (new) — deterministic, no LLM: snap `script_start_sec`/`script_end_sec` down to the 30 fps grid (`Math.floor(t*30)/30`), enforce ≥0.4 s gaps (already partially done in `planScenes`), cadence check (warn on any window >4 s whose kind is `image`/`text_overlay` with no build), one-highlighter check, comparison-both-sides check (spec `leftItems`+`rightItems` non-empty), consecutive-motion-kind variety warning, face-band check for overlay positions (via `spatial.FACE_BAND`), scene-share vs requested share, per-beat word-budget report. Called from `App.tsx confirmStyle()` right after `planScenes`; auto-fixes applied before `replaceFromPlan`, warnings stored in memory and shown in `ScenePlanner` as a dismissible strip.
3. **Beat → trigger-word timing**: `lib/storyEngine.ts triggerOffset()` — when a scene's `narration_segment` matches a run of word timestamps, shift the scene start to `firstWord.start − 0.13` (clamped ≥ previous scene end): the visual is on screen 0.12–0.15 s before its trigger word (SKILL.md §7). Applied inside `planChecks`.
4. **`components/ScenePlanner.tsx`**: beat-role chip per card (colored by beat), `highlight_phrase` input on motion/text scenes (writes through `patchScene`; edits re-fingerprint via spec normalization — add the phrase into the spec as `spec.highlight` so the fingerprint changes), lint-warnings strip.

### Phase 4 — HeyGen presenter polish + transparent presenter (16:9)

1. **`hooks/useHeyGen.ts`**: after `status==='completed'`, load `video_url` into a metadata-only `<video>` and use the measured duration when it differs from the API `duration` by >0.05 s (CHANGES.md under-report). Raise the poll ceiling to 2 h for `format==='long_form'` projects (`480` iterations). Add `generateTransparent(project, options)`: same submit with `output_format:'webm'` and no `background`; on HeyGen 400 (`invalid_parameter` — look doesn't support webm), throw a typed `WebmUnsupportedError` so the UI falls back.
2. **`components/HeyGenModule.tsx`**: 16:9-only toggle "Float the presenter over the graphics (transparent background)"; helper text: works with supported studio looks, digital twins keep their real room; on `WebmUnsupportedError` auto-retry as mp4 and note it. Show measured duration + "HeyGen renders can take a while for long scripts — a 70 s master has taken ~100 minutes" copy for long form.
3. **Assembly use** (`remotion/AssemblyComp.tsx` + `App.tsx assemble`, 16:9 only): when `project.heygen_video_url` ends `.webm` (alpha master), invert the layering — a new full-bleed theme-field background layer at the bottom, scene visuals as mid-layers, the presenter webm as the TOP layer in a right-third column (`objectFit:'contain'`, anchored bottom-right; Remotion `<OffthreadVideo>` renders VP9 alpha in Chrome), captions/callouts above it but face-safe. Keep the mp4 path byte-identical. 9:16 stays mp4-master-only (the FFmpeg overlay endpoint takes a base VIDEO plus overlays; a webm base is untested — out of scope).
4. **Duration/window hygiene**: portrait overlay windows already derive from the timeline; add a 1-frame pull-in on every overlay `end_time` (`end − 1/30`) in `App.tsx`'s portrait overlay mapping, mirroring the render-rules "inclusive window" rule so an overlay never lingers one frame into the next cut.

### Phase 5 — Film QC gate + QC sheet UI (see §F for full detail)

1. **`lib/filmQa.ts`** (new).
2. **`components/QcSheet.tsx`** (new).
3. **`components/AssemblyProgress.tsx`**: render `<QcSheet project scenes />` under the player when `assembled_video_url` exists; run automatically once per assembled URL (same `reviewedUrl`-style guard as the Opus QC) and persist to `qc_film_report` (allowlisted in Phase 1).
4. **`lib/checks.ts`**: 7th check `qc_sheet` — pass when `qc_film_report.assembly_url === assembled_video_url && report.pass` (pending report = pass with 'not yet run' detail so the gate never blocks delivery on a browser that cannot decode).

### Phase 6 — Platform cuts + docs

1. **`lib/platformCuts.ts`** (new): `planTikTokCut(project, scenes, beats)` — target 28–35 s: drop the CONTEXT beat's narration window; because narration is ONE continuous master, a derived cut re-times by **trimming the master**: build the cut from beat windows kept (`hook + escalations + payoff + button`), call the `video-clip`/`video-stitch` platform integrations? — NO: those endpoints answered 402 `ffmpeg exited null` in the Sep 16 probe (video-clip) and stitch normalizes to 1280×720. **Decision:** derive the cut as a second ASSEMBLY: 9:16 → one `videos/overlay` call whose `base_video_url` is the master and whose overlays are re-timed — but the base still carries CONTEXT narration, so a true trim needs a re-rendered SHORTER HeyGen master from the trimmed script (cheap at 30 s) — implement exactly that: `platformCuts` re-submits `POST v3/videos` with the trimmed script (same avatar/voice), re-times the kept scenes against the new subtitle timestamps by narration matching, reuses every cached clip/capture (fingerprints unchanged), assembles, stores in `platform_cuts`. UI: a "Derive 30 s TikTok cut" button in Step 7 (visible for `explainer_short`).
2. **`agent/customer-prompt.md`**: describe the Explainer Short format, the paper look, the QC sheet, and the TikTok cut so the in-space agent answers accurately. **`config.json`** sceneforge app description: one added sentence (keep additive; do not touch id/version/template).

---

## D. HeyGen API integration detail

**Secret name: `HEYGEN_API_KEY`** (platform secret; per-workspace override settable via `PUT /api/workspaces/:id/provider-credentials/heygen {apiKey}` — owner/admin action, never from app code). All calls: browser → `/api/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/provider-credentials/heygen/proxy/<path>`; the proxy is transparent (GET/POST, JSON, HeyGen status codes pass through; `Content-Type` only when a body exists — a bare GET with it makes v3 reject with "Extra inputs are not permitted").

**Call order (per project):**
1. `GET v3/avatars/looks?limit=50` (+`&token=` paging; cap 50/page, ~80-page ceiling; progressive render; 6 h two-sided cache) → picker. Fields used: `id` (the `avatar_id`), `name`, `preview_image_url`, `gender`, `default_voice_id`, `supported_api_engines`, `preferred_orientation`.
2. `GET v3/voices?limit=100` (+token) → `voice_id`, `name`, `language`, `gender`. Suggested voices: explicit compat ids on the look, else language match (`lib/heygenCatalog.suggestedVoices`).
3. `GET v3/avatars/looks/{avatar_id}` → `data.supported_api_engines` → engine = first of `['avatar_iv','avatar_v','avatar_iii']` supported (advisory-only failure tolerance already implemented). 4k gate: allow `resolution:'4k'` only when the chosen engine is `avatar_iii` (digital twin/studio); otherwise clamp to `1080p`.
4. `GET v3/voices/{voice_id}` — advisory validation.
5. `POST v3/videos` — request:
```json
{ "type":"avatar", "avatar_id":"<look id>", "engine":{"type":"avatar_iv"},
 "script":"<full narration>", "voice_id":"<voice>", "voice_settings":{"speed":1.0},
 "resolution":"1080p", "aspect_ratio":"9:16", "fit":"cover",
 "background":{"type":"color","value":"#0f172a"}, "output_format":"mp4" }
```
 Rules: 9:16 always `fit:'cover'` (letterboxing is burned in forever); unknown keys rejected (never send v2 `dimension`/`video_inputs`/nested `voice`); `output_format:'webm'` ⇒ omit `background`. Response: `data.video_id` (NOT `data.id`). Persist `heygen_video_id` immediately with retry ×3 (paid work; enables reload-resume).
6. **Async handling — poll, no webhook**: `GET v3/videos/{video_id}` every **15 s**, up to 240 iterations (raise to 480 for long form). Response `data`: `status pending|processing|completed|failed`, `video_url`, `thumbnail_url`, `subtitle_url`, `duration`, `failure_code`, `failure_message`. Up to 6 consecutive poll errors tolerated. `failed` ⇒ `HeyGenRenderError` (terminal; human-translated — `SPACE_ENCRYPTION_DISABLED` has dedicated copy), clear `heygen_video_id`, park reason in `stage_note`. Reload-resume: a project on `avatar_render` with `heygen_video_id` and no URL re-attaches to the poll (already implemented; keep).
7. **On complete**: measure REAL duration from the delivered file (metadata `<video>` load; API under-reports); parse `subtitle_url` VTT → per-word timestamps (existing `wordsFromSubtitle`), fallback `approximateWordTimestamps`; store `heygen_video_url`, `avatar_duration_sec` (measured), `word_timestamps`, `heygen_chunks[0]`; status → `style_choice`.
8. **Final video storage/display**: the HeyGen master URL lives on `sceneforge_projects.heygen_video_url` (HeyGen-hosted; if HeyGen URLs ever expire, add a re-host step through `/api/upload/file` — currently not needed and deliberately not planned). The assembled film lands in `assembled_video_url` (server-only; written by `save_project` through the hook after the FFmpeg/Remotion job), the music master in `final_video_url`; Step 7's player prefers `final_video_url || assembled_video_url` and the download button points at the same.

**Credits honesty** (heygen-mcp.md): before submit, show a one-line "This spends HeyGen plan credits; a failed render verdict is HeyGen's, not a retry loop" note in `HeyGenModule`; the app already never auto-rerolls a failed render (terminal errors require an explicit button press).

---

## E. Motion-graphics layer detail

### E1. Elements per scene type (vox-visual-language.md → engine mapping)

| Story beat / content | MotionSpec kind | Directed layers (paper theme) |
|---|---|---|
| HOOK anchor | `text_reveal` or `annotated_image` | `Cutout` (halftone/duotone anchor image, torn edges, two-shadow) center; `KineticHeadline` (Archivo Black caps, word-by-word springs) top; `Highlighter` on the key word (accent bar, +0.12 s); composition `overlay` over the presenter |
| Money/number beat | `big_stat` | `Metric` countup (exact value) dominant; `Highlighter` on the label phrase; camera push (author-big-scale-down) |
| Magnitude comparison | `bar_chart` | `Chart`: axis+labels+source land ON the cut; bars build `scaleY 0→1, 0.6 s, stagger 0.12, power3.out`; ONLY the answer bar carries the accent, others neutral gray (`color = mix(ink 35%, field)`) |
| Share of a whole | `bar_chart`→ prefer **`DotUnit`** (new) or donut treatment of `big_stat` | `DotUnit`: 10×10 dot grid; the narrated share re-colors to accent with a radial stagger |
| Chronology | `timeline` | `TimelineRail`: rail draws (`strokeDashoffset`), dated beats pop in sequence |
| A-vs-B | `comparison` | `Comparison`: BOTH sides filled (hard planner rule); left neutral, right accent-tinted; `spatial_collapse`-style internal reveal |
| Process | `flowchart` | `FlowChart`: steps enter left→right, connectors draw |
| Geography | `node_graph` (abstract map) | `Map`/`Diagram`: simplified landmass shapes as gray cutout polygons + 1–3 accent pins + route `strokeDashoffset` draw (matches qc_sheet.jpg scene 2); tight crop, no label swarms |
| Pure headline/quote | `text_reveal` | `KineticHeadline` + `Highlighter`; kicker line in Work Sans caps above (matches qc_sheet.jpg scene 1) |
| Archival/still beat | `image` / `annotated_image` | `Cutout` full treatment + optional tape; Ken Burns via author-big-scale-down |

Vertical discipline (all enforced by `spatial.ts` zones + planner rules): 1–2 stacked layers per beat; 2–5 words per text card (planner instruction + `wrapLines` clamps); content inside the middle 80 % width; nothing critical in top 12 % / bottom 20 %.

### E2. Parameterization by the story engine

The orchestrator writes `spec` (exact strings/numbers), `narration_segment`, `beat_role`, `highlight_phrase`, `composition`; the Director writes `director_timeline` (hierarchy/zones/timing/camera/transitions; `spec_fingerprint`-guarded). The theme (`style_tokens` + style registry) supplies ALL colors/fonts — the LLM never picks paper-theme colors (its `accent` field is honored only in cinematic themes; paper locks ONE accent per project). Beat timing parameterizes entrances: scene start is pre-shifted 0.13 s before the trigger word; the Highlighter's `at` = its target text layer's entrance + settle + 0.12 s.

### E3. Compositing with the HeyGen master (timing, z-order, export formats)

**9:16 (primary)** — FFmpeg overlay endpoint (`POST /api/workspaces/{id}/videos/overlay`, `X-Workspace-DB-Token`, body `{base_video_url, overlays:[{asset_url, start_time, end_time, position:'full'}], dimensions:{1080,1920}, output_format:'mp4', duration_seconds}`):
- Z-order = array order over the base; every overlay is full-frame; **PNG alpha preserved** (verified).
- `overlay`/`central` motion scenes → 2–4 timed transparent RGBA PNG stills sampled from the theme-aware GSAP timeline (progressive build over the live presenter); over-avatar text → one callout-pill PNG (theme colors); image scenes → framed card PNG; `fullscreen` motion scenes → captured WebM clip (VP9, browser MediaRecorder — served as-is; the endpoint re-encodes); `ai_video` → always fullscreen mp4 cutaways.
- Timing: `start_time`/`end_time` from the frame-snapped scene windows, end pulled in 1 frame (Phase 4.4).

**16:9** — Remotion assembly (single render): base `OffthreadVideo` master (or, with a webm alpha master, field background + scenes + presenter column on top); one `Sequence` per scene; composition cards (overlay 22–50 % width / central 50–80 %) with frame-accurate spring choreography; transitions per `transitionIn/Out` (paper ⇒ `hard_cut`). Motion clips loop if the window outruns them; 18 000-frame cap; stale-bundle retry ×3 stays.

**Export formats**: per-scene captures = WebM (VP9, alpha unused in fullscreen), portrait composites = PNG (RGBA), final = MP4 (server-encoded, both paths). Browser MediaRecorder cannot produce MP4 — never label the WebM captures as MP4 (heygen-video docs warning).

---

## F. QC / render-rules enforcement

### F1. Before generation (deterministic, free)
- `lib/storyEngine.ts validateScriptBeats` at script review: per-beat word budgets, hook length ≤14 words, sentence length ≤~14 avg (regex heuristics), "two ideas" heuristic (warn only), payoff-position check.
- `lib/planChecks.ts` after planning (see Phase 3): frame-grid snap, cadence, highlighter uniqueness, comparison completeness, face-band, variety, share.
- Existing per-scene pre-flight stays: capture byte-floor, portrait broken-clip check, `content_mismatch` vision check against the spec.

### F2. After per-scene generation (existing, kept)
`lib/visualQa.ts` Opus-vision loop with Director auto-fix (≤2 retries) — extend `QA_CHECKS` with two paper-theme codes: `palette_drift` (colors outside the locked palette) and `double_highlight` (more than one highlighter visible). No other changes.

### F3. After assembly — the film QC gate (`lib/filmQa.ts`, new)
Browser-side (the platform `/api/video/frames` endpoint answered 402 "ffmpeg exited null" in the Sep 16 probe — a platform-side fault — so frame extraction uses the same `<video>`+canvas technique `visualQa.extractClipFrames` already proves; the `video-frames` integration can be swapped in later if it heals):
1. Load `assembled_video_url` (crossOrigin anonymous; GCS-hosted, CORS-clean like scene clips). If the canvas taints or decode fails → report `status:'skipped'` with the reason; never block delivery.
2. **Cut list** = frame-snapped scene boundaries from the persisted scenes (both edges of every middle-visual window).
3. Extract: frame 0; 11 evenly spaced frames (the temporal strip — mirrors `qc_sheet.jpg`); for every cut, the frame before and after (mirrors `qc_keyframes.jpg`). Downscale to ~240 px-wide JPEGs.
4. **Luma sweep**: mean luma per sampled frame (canvas pixel average); flag `black_frame` (<12 mean) and record the sparkline.
5. **Cut integrity**: |Δluma| across each declared cut ≥ threshold at the cut frame AND ~0 at the next frame-pair ⇒ `hard cut`; a split delta ⇒ `dissolve/late cut` flag (render-rules §verification: catches off-by-one cuts, which contact sheets cannot).
6. **Safe bands** (9:16 only): sample the top 12 % and bottom 20 % rows of each strip frame; non-background variance above threshold ⇒ `safe_band_content` warning (background = theme field color ± tolerance, or the presenter — presenter pixels make this heuristic noisy, so it is a WARNING, never a failure).
7. **Audio present** (best-effort): `fetch` first ~2 MB with a Range header → `AudioContext.decodeAudioData`; failure ⇒ skip silently.
8. Persist `qc_film_report = {assembly_url, pass, frames:[{atSec, url? (uploaded thumbs via /api/upload/file), luma}], cuts:[{atSec, verdict, delta}], issues[], checkedAt}` via `save_project`.

### F4. The QC sheet UI (`components/QcSheet.tsx`, referencing qc_sheet.jpg / qc_keyframes.jpg)
A Step-7 panel titled **"QC sheet"** directly under the player:
- **Temporal strip**: 11 thumbnails in a row (wraps on small screens), each captioned with its timestamp — the visual analog of `qc_sheet.jpg`'s grid; clicking a cell seeks the player.
- **Cut pairs**: one row per cut — the two adjacent frames side-by-side with a verdict chip (`hard cut` green / `late or dissolved cut` amber, showing the luma delta) — the analog of `qc_keyframes.jpg`.
- **Luma sparkline** across the strip with the black-frame floor marked.
- **Verdict chips**: cuts clean / no black frames / safe bands clear / audio present; overall pass = the 7th delivery check.
- **Editorial reminder** text (render-rules: "the script proves the mechanical half; look at every cell — is this a clean, correct visualization of this exact line?") + a per-cell "flag scene" affordance that routes into the existing isolated scene retry (`retryFlaggedScene`).
- Re-run button (guarded by URL, like the Opus QC pass).

---

## G. API keys / secrets

| Secret NAME | Used by | Status / founder action |
|---|---|---|
| `HEYGEN_API_KEY` | HeyGen provider-credential proxy (avatar catalog, renders) | **Already wired** — the proxy injects it server-side. Only if the founder wants their own HeyGen account billed: set a workspace override via the provider-credential endpoint or by asking Otto to run `set_custom_api_key` with the exact name `HEYGEN_API_KEY`. Never hardcode; app code keeps calling the proxy path only |
| `ELEVENLABS_API_KEY` | `sceneforge-v2` `music` op (server-side via `platform.secretsProxy`) | Already used by the existing music bed; no change |
| Anthropic (Claude Opus) | `/proxy/anthropic/v1/messages` with `X-Workspace-DB-Token` | Platform-managed; no key, no action |
| Gemini Omni Flash (images + AI video) | `/api/veo/generate/*` with `X-Workspace-DB-Token` | Platform-managed; charges the workspace wallet — keep the wallet funded for AI-video scenes |
| Motion-render service | — | **None needed**: motion graphics render in-browser (GSAP capture); compositing uses platform FFmpeg/Remotion endpoints, no external service, no new key |

**No new secret is required for any phase of this plan.** The only founder-visible dependency is wallet balance for Omni Flash generations and HeyGen plan credits for avatar renders.

---

## H. Known constraints & gotchas the implementing session MUST respect

1. **Server-only columns**: any patch touching `assembled_video_url, build_hash, checks, music_url, music_prompt, final_video_url, stage_note` (projects) or `render_url, remotion_code` (scenes) goes through `sceneforge-v2` (`forgeApi`), or the whole patch 403s. Keep `SERVER_ONLY_PROJECT_FIELDS` in `lib/supabase.ts` in sync.
2. **Allowlists drop silently**: a new column that is not added to the hook's allowlists will appear to save and silently vanish. Phase 1 step 2 is not optional.
3. **`plan_scenes` upserts on `(project_id, scene_index)`** (unique index) — new scene fields ride the same op; never insert scenes from the browser.
4. **Anthropic proxy limits**: 256 KB request body, `max_tokens ≤ 8192`, `PLAN_TIMEOUT_MS 90 s`, one transient retry. Beat data is small; do NOT inflate the planner input with full spec prose — encode rules in the task string, not the input JSON.
5. **Capture requires a visible foreground tab** (MediaRecorder + rAF pause when hidden) — the byte-floor guard catches it; keep it.
6. **Remotion endpoint** renders 1920×1080 only; `calculateDemoVideoDuration` must tolerate a props-less call; stale-bundle transient retry stays; ≤18 000 frames.
7. **`videos/overlay`** accepts only full-frame assets; PNG alpha is preserved; a streamless overlay input fails the WHOLE composite with exit 234 (keep the pre-flight).
8. **Tailwind opacity modifiers on CSS vars emit nothing** — in shell UI always `color-mix(in_srgb, var(--…) N%, transparent)` (the codebase already complies; keep it in new UI).
9. **Case-insensitive bundler**: unique file basenames regardless of case.
10. **Never `report_blocked` / re-engine on HeyGen render failures** — they are terminal verdicts with human-readable mapping already; retry is a user action.
11. **Existing projects must keep working**: `format` defaults to `'long_form'`; DARK_THEME is byte-identical to today's constants; fingerprint changes only apply when a theme/spec actually changes; `text_graphics`/legacy scenes keep their paths.
12. **Do not create replacement tables**; all DDL is `workspace_db_alter_table` addColumns (re-running gives `COLUMN_EXISTS`, which is fine).

---

## I. Suggested implementation order & verification per phase

| Phase | Verify by |
|---|---|
| 1 | `workspace_db_describe_table` shows the new columns; `sceneforge-v2` `execute {op:'save_scene'}` round-trips `beat_role`; a new Explainer Short project writes beats and shows the beat-aware Script Review |
| 2 | A `vox-paper` motion scene previews cream/ink/yellow with a highlighter; capture a scene and confirm the WebM matches the preview; existing dark-theme project re-opens with untouched cached clips (fingerprints unchanged) |
| 3 | Plan a short project: every scene carries `beat_role`/`narration_segment`/`highlight_phrase`; windows sit on the frame grid; lint strip shows only intentional warnings |
| 4 | 16:9 project with a webm-capable look renders the floating presenter over the field; mp4 fallback note appears for unsupported looks; measured duration stored |
| 5 | Assemble any project: QC sheet renders the 11-strip + cut pairs; deliberately mis-time one scene by 1 frame in a test and confirm the cut-integrity flag |
| 6 | Derive a TikTok cut from a finished short; the derived MP4 lands in `platform_cuts` and plays in Step 7 |

*End of plan.*
