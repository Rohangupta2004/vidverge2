# generate-video hook patch — character consistency in EVERY scene

**Status: NOT APPLIED YET — must be applied by Otto / an authenticated platform
session.** Hook management is walled off from build agents (re-verified
2026-08-12: `GET`, `PATCH` and `POST` on
`/api/workspaces/660069/hooks[/819cc424-ff05-4d38-91dc-713f512e8392]` all answer
`401 {"error":"Authentication required"}` — deliberate platform hardening, not a
bug). Read the live hook code first (`GET .../hooks/819cc424-ff05-4d38-91dc-713f512e8392`,
the `code` field is ~19KB), apply the changes below, `PATCH` the code back, and
verify `updatedAt` advanced.

**Why this is the #1 fix:** the founder's top complaint is that the character
changes appearance between scenes. Veo renders each scene from its own prompt;
unless the character reference is baked into EVERY scene prompt (and the
approved portrait is used as the job-level `startImage` seed), each scene can
render a different-looking person.

**What the client already does (live in the draft as of 2026-08-12, updated
2026-08-13):**
- `apps/Create/studioApi.ts` `submitStudioVideo()` injects a character seed
  line at the START of every `scene_description` it sends:
  `"Same character as start image: <brief description>."` when a portrait/photo
  exists, `"Same character in every scene: <brief description>."` when the
  character is text-only. No injection when the video has no character.
- It sends `character_image_url` (the approved portrait / uploaded photo),
  `character_data`, `dialogues`, `product_images`, `session_id`,
  `target_duration_seconds` (15 | 30 | 60) and `generateAudio: true`.
- **(Added 2026-08-13)** It also sends a single top-level `referenceImageUrl`
  — the explicit Veo image-to-video anchor. Priority already resolved
  client-side: the character's photo/portrait when one exists (human anchor
  wins), otherwise the product hero image (`product_images[0]`, i.e. the
  auto-selected hero from a URL fetch or the user's upload). Absent when the
  video has neither.
- `video_jobs` now HAS the columns `character_image_url` (text) and
  `product_image_count` (integer, default 0) — added additively via
  workspace_db_alter_table on 2026-08-12, so step 4 below can persist them.

The hook currently IGNORES `character_image_url` / `character_data` /
`dialogues` / `product_images`. The client-side seed injection is a stopgap
that improves consistency today; the hook patch below is what makes it robust
(seed image + guaranteed per-scene injection for EVERY caller, including the
agent's `produce_video` tool).

---

## 1. Per-scene character injection (THE core fix)

Parse alongside the existing args at the top (accept both `body.<field>` and
`body.args.<field>` like the other fields):

```javascript
const characterImageUrl = String(body.character_image_url || (body.args && body.args.character_image_url) || '').trim();
const hasCharacterImage = /^https?:\/\//.test(characterImageUrl);
// characterDescription already exists in the hook — reuse it.
```

Build ONE short seed line and prepend it to EVERY scene prompt — not just
scene 1:

```javascript
// Brief = first ~150 chars of the character description, no trailing period.
const briefCharacter = String(characterDescription || '').replace(/\s+/g, ' ').trim().slice(0, 150).replace(/[.…]+$/, '');
let CHARACTER_SEED = '';
if (hasCharacterImage) {
  CHARACTER_SEED = 'Same character as start image: ' + (briefCharacter || 'the person shown in the reference image') + '.';
} else if (briefCharacter) {
  CHARACTER_SEED = 'Same character in every scene: ' + briefCharacter + '.';
}
// If neither an image nor a description exists: no injection at all.
```

When building each scene's Veo prompt, prepend the seed to EVERY scene —
**deduped**, because the studio app already injects the same line into its
scene descriptions (never stack two copies):

```javascript
const alreadySeeded = /^\s*Same character/i.test(sceneDescription);
const seededDescription = CHARACTER_SEED && !alreadySeeded
  ? CHARACTER_SEED + ' ' + sceneDescription
  : sceneDescription;
```

The hook's existing characterBlock/styleBlock handling stays — the seed is
additive and sits at the very start of the prompt.

## 2. Reference image becomes the Veo seed frame (`startImage`)

**Field name confirmed against the platform's Veo docs (google-veo3
integration, `POST /api/veo/generate-long-video`):** the image-to-video
anchor is the JOB-LEVEL `startImage` — it seeds the very first clip's first
frame, and because every subsequent clip chains from the previous clip's
extracted last frame, the anchor propagates through the whole video. It
accepts a public `http(s)://` URL directly (the proxy downloads and forwards
the bytes; png/jpeg/webp, ~10MB max, no redirects, public hosts only).
There is no per-scene reference-image field on the long-video schema — scenes
only take `{ prompt, lastFrameImage? }` — so `startImage` at the top level is
the correct and only placement.

Parse the reference with this priority (first hit wins), accepting both
`body.<field>` and `body.args.<field>`:

```javascript
const referenceImageUrl = String(
  body.referenceImageUrl ||
  (body.args && body.args.referenceImageUrl) ||
  body.character_image_url ||
  (body.args && body.args.character_image_url) ||
  (body.character_data && body.character_data.image_url) ||
  '',
).trim();
const hasReferenceImage = /^https?:\/\//.test(referenceImageUrl);
```

(`referenceImageUrl` is the explicit contract — the Create app already sends
it with character-photo-over-product-hero priority resolved; the older
`character_image_url` / `character_data.image_url` fields stay honored as
fallbacks so every caller benefits.)

In the `veoPayload` construction block, the reference image wins the
`startImage` slot; the website screenshot only opens the video when there is
no reference image:

```javascript
if (hasReferenceImage) {
  veoPayload.startImage = referenceImageUrl;
} else if (screenshotUrl && websitePlacement === 'start') {
  veoPayload.startImage = screenshotUrl; // existing branch, unchanged
}
```

When NO reference image is present the payload must be byte-identical to
today's — no `startImage` key at all, no behavior change (that is the
no-regression requirement). The `"end"` placement (appended outro scene with
`lastFrameImage`) is untouched. `hasCharacterImage` in section 1 above is
`hasReferenceImage` — same variable, the seed line should say "Same character
as start image" whenever a startImage seed is set from a character photo.

## 3. Hard 1000-char clamp on every scene prompt

Apply AFTER assembling seed + character block + scene description + dialogue.
If the combined prompt exceeds the cap, truncate the SCENE DESCRIPTION only —
never the character seed, never the dialogue:

```javascript
const PROMPT_HARD_CAP = 950; // headroom under the API's 1000
function buildScenePrompt(fixedHead, sceneText, fixedTail) {
  // fixedHead = seed + character block; fixedTail = dialogue/phone-block text
  const fixedLen = fixedHead.length + fixedTail.length;
  let scenePart = String(sceneText || '');
  if (fixedLen + scenePart.length > PROMPT_HARD_CAP) {
    scenePart = scenePart.slice(0, Math.max(0, PROMPT_HARD_CAP - fixedLen - 1)) + '…';
  }
  return fixedHead + scenePart + fixedTail;
}
```

Route EVERY `scenes[].prompt` through this — including the phone-beat scene
and the appended website outro scene. One overlong scene 400s the whole job.

## 4. Persist the new fields on the video_jobs insert

The columns exist now (added 2026-08-12):

```javascript
character_image_url: hasCharacterImage ? characterImageUrl : null,
product_image_count: productImages.length,
```

## 5. Product images (Product Ad flow)

```javascript
const productImages = Array.isArray(body.product_images)
  ? body.product_images.filter(function (u) { return typeof u === 'string' && /^https?:\/\//.test(u); })
  : [];
// While building prompts, still respecting the cap:
if (productImages.length > 0 && productImages[0]) {
  const productNote = ' The product featured looks exactly like what is shown at: ' + productImages[0];
  if ((p.length + productNote.length) <= PROMPT_HARD_CAP) p += productNote;
}
```

## 6. Per-scene dialogue channel + retry backoff (from the earlier patch spec)

- `dialogues` (optional array, one string per scene): when present, append
  `' Voiceover/dialogue: "' + dialogues[i] + '"'` to scene i's prompt (the
  existing `script[].dialogue` handling stays as-is; this is an additional
  channel).
- `character_data` ({ name, description, image_url?, style?, environment? }):
  when present, build the CHARACTER_BLOCK from it (name + description + style
  + environment + 'MAINTAIN THIS CHARACTER CONSISTENTLY ACROSS ALL SCENES.')
  and fall back to the existing character_description path when absent.
- Extend `fetchJsonWithRetry` (do NOT replace): `MAX_ATTEMPTS = 5`,
  `RETRY_DELAYS_MS = [0, 2000, 4000, 8000, 16000, 30000]`, and 502/503 always
  retried with the full backoff (never the non-transient early exit). Worst
  case backoff (60s) + call time still fits `metadata.timeout` (240000).
- Also accept `target_duration_seconds` (15 | 30 | 60) as the preferred
  duration signal when sizing/validating the job, falling back to the
  existing `duration_seconds`.

## MUST survive the patch unchanged

- `generateAudio: true` in the Veo payload — DO NOT REMOVE (only audio source).
- Session scoping on every `video_jobs` READ (filter on forwarded
  X-Session-Id) and session attribution on the INSERT (header first,
  `body.session_id` fallback).
- Bounded `for` retry loops only — an unbounded `while` ANYWHERE in the code
  makes the edge WAF 403 the PATCH itself.
- CAS-gated status updates + founder notifications (this patch touches
  neither check-video-status nor video-render-watcher — don't regress them).
- The `phoneScreenBlock` phone-beat injection and website screenshot scenes.
- Never register a customer tool named `generate_video` (platform built-in
  collision — the working name is `produce_video`).

## After patching

1. Verify with `GET .../hooks/819cc424-ff05-4d38-91dc-713f512e8392` that
   `code` matches and `updatedAt` advanced.
2. Update the hook's `description` to mention `character_image_url` (Veo seed
   frame), `product_images`, and `target_duration_seconds`.
3. Add `product_images` + `target_duration_seconds` to the `produce_video`
   registry entry (parameters + bodyMapping); `character_image_url` already
   exists there and needs only a description update.
4. Consider also registering the two pre-generation hooks in
   `tools/pre-generation-hooks.md` (`fetch-website-images` exists already;
   `generate-character-image` still 404s — the studio app falls back to
   `POST /api/generate/image` until it lands).
