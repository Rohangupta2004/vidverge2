# Pre-generation steps — ready-to-register hook code

**Status (updated Aug 13 2026): PARTIALLY LIVE.**

- `fetch-website-images` (section 1) is REGISTERED and LIVE — hook id
  `8cd45ad3-6847-442f-ac8d-81a83d1c862c`, executing at
  `POST /api/hooks/execute/workspace-660069/fetch-website-images` (verified
  live Aug 13 2026: stripe.com returned 8 images in ~300ms). The URL-to-video
  form already calls it directly. Its customer-tools REGISTRY entry is still
  missing (see section 4a), so the in-chat agent cannot use it yet.
- `generate-character-image` (section 2) is still NOT registered.
- `generate-video` now consumes `reference_image_url` (string, optional —
  attached to scene 1 as the Veo start frame, non-fatal if invalid) and
  `reference_image_scene` (integer, optional, 1-based). The matching
  `produce_video` registry delta is staged in section 4b.
- **THE MODEL PICKER DOES NOTHING IN CHAT** (found Aug 16 2026). The hook has
  accepted `model` / `video_model` and `mode` / `kling_mode` for a while, and
  the options bar next to the composer has offered a model dropdown for just as
  long — but `produce_video` never declared those parameters, so Reel cannot
  pass them and EVERY in-chat render comes out on the pipeline's default
  whatever the customer picked. Reported by a customer who chose Gemini Omni
  Flash and got Veo 3.1 twice. The registry delta that fixes it is staged in
  **section 4c**; it is the only thing standing between the dropdown and a
  working choice, and no workspace-file change can substitute for it.
- The registry entries now ALSO require an authenticated platform session:
  customer-tools GET/PUT answer 401 to the code bridge as of Aug 13 2026
  (see section 4).

The matching agent instructions ARE already in `agent/customer-prompt.md`,
under "Pre-generation steps". That section is deliberately gated on the tools
being available, so today it is inert and the live flow is unchanged. The
moment the two tools below are registered, Reel starts running Step A and
Step B on its own — no further prompt edit needed.

---

## Why this is a file and not a live hook

Hook management is authenticated. From the build-agent runner:

```
GET   /api/workspaces/workspace-660069/hooks            -> 401 {"error":"Authentication required"}
GET   /api/workspaces/workspace-660069/hooks/<id>       -> 401
PATCH /api/workspaces/workspace-660069/hooks/<id>       -> 401
```

`http://localhost:5000` is the platform's own runner and is not routable from
the workspace code bridge; `https://audos.com` is reachable but answers 401 on
every hook route. There is no alternate route (`/api/workspace-settings/*/hooks`
and `/api/hooks/*` both 404).

Two things nearby were NOT walled off when first checked (Aug 11 2026) — but
only one of them still is:

- `GET|PUT /api/workspace-settings/f24710e5-7c6d-4db4-92b4-c2c235877575/customer-tools`
  responded 200 unauthenticated on Aug 11 2026. **STALE — re-verified Aug 13
  2026: both GET and PUT now answer `401 {"error":"Authentication required"}`
  from the code bridge** (same wording as the hook-management wall; also 401
  with Bearer/runtime tokens, X-Session-Id, and the `workspace-660069` path
  variant). Beware the false positive: a PUT with MALFORMED JSON returns 400
  from the global body parser, which runs before auth — a well-formed PUT
  still gets 401. The registry can now only be edited from an authenticated
  platform session — see section 4.
- The hook *execute* endpoints (`/api/hooks/execute/workspace-660069/<name>`)
  are public, which is how the browser calls them (re-verified Aug 13 2026).

Per the Server Hooks dashboard (`*-default-server-hooks.tsx`): "there is no
'new hook' button by design. To create one, open the Agent panel and ask Otto."
So the way to land this is to hand Otto the code below.

---

## Endpoint correction (verified)

The original brief specified `POST /api/workspaces/{workspaceId}/image/generate`
with `{ prompt, aspectRatio, workspaceId }` returning `result.url`. **That route
does not exist** — it 404s, as do `/api/image/generate` and
`/api/veo/generate-image`.

The real platform image endpoint — the one `lib/reelioStudio.ts` `generateImage()`
already uses for App Mockups — is:

```
POST https://audos.com/api/generate/image
{ "prompt": "...", "aspectRatio": "1:1", "quality": "high" }
-> { "success": true, "imageUrl": "https://storage.googleapis.com/..." }
```

Verified live: posting `{}` returns `400 {"error":"prompt is required"}`. Note
the response field is `imageUrl`, **not** `url`. `generate-character-image`
below uses this endpoint.

---

## What has already been tested

Both hook bodies were run outside the sandbox (Node 20, same `fetch` /
`AbortController` / `URL` / `matchAll` primitives the hook runtime provides)
before being written down here, so the code below is not a sketch:

**`fetch-website-images`**

- Live pages: `https://stripe.com` returned 8 images led by its `og:image`;
  `https://www.apple.com` returned 8 hero/product shots with alt text.
- A synthetic page covered the parsing edge cases, all passing: `og:image`
  before `twitter:image` before `<img>`; duplicate URLs collapsed; root-relative
  (`/img/x.png`) and path-relative (`products/x.jpg` under `/store/`) URLs
  resolved against the right base; `&amp;` decoded in query strings; `data-src`
  lazy images picked up; single-quoted attributes read; and `logo`, `.svg`,
  `.ico`, `tracking-pixel`, `http://` and `data:` sources all excluded.
- A dead domain returned `{ success: false }` after 3 attempts in ~6s (the 2s
  and 4s backoffs), which is the non-fatal path the agent is told to shrug off.

**`generate-character-image`**

- A real call against `https://audos.com/api/generate/image` returned
  `success: true` in 30.5s with a durable GCS URL; the asset is a 1024x1024 PNG
  head-and-shoulders portrait on a clean background that matches the input
  description. The prompt template needs no tuning.
- An HTTP 400 is returned to the caller after exactly 1 request (never retried),
  and an HTTP 503 retries 3 times over ~6s before giving up — matching the
  `fetchJsonWithRetry` contract the other VidVerge hooks follow.
- An unsupported `aspect_ratio` falls back to `1:1`; a missing
  `character_description` is rejected before any outbound call.

What could NOT be tested from here is registration itself, and anything
involving the live `generate-video` code (see section 3) — that source is behind
the same 401.

---

## 1. Hook `fetch-website-images`

**LIVE since Aug 13 2026** — registered as hook id
`8cd45ad3-6847-442f-ac8d-81a83d1c862c`, executing at
`POST /api/hooks/execute/workspace-660069/fetch-website-images`. The "Create
with" block below is kept for reference only; do not register it again. What
is still missing is the registry entry (section 4a).

**Description:** Scrape candidate product/hero image URLs from a website so the
visitor can pick which ones the video should reference. Returns up to 8 images
with their alt text. Failures are non-fatal.

**Create with:**

```bash
POST /api/workspaces/workspace-660069/hooks
{ "name": "fetch-website-images", "language": "javascript",
  "description": "<the description above>", "code": "<the code below>" }
```

Suggested `metadata.timeout`: `60000` (a 10s page fetch plus two backoff waits).

```javascript
// fetch-website-images — pull candidate product/hero images off a page.
// Input:  request.body.args.website_url
// Output: { success, images: [{ url, alt }], count } | { success: false, error }
const TIMEOUT_MS = 10000;
const MAX_IMAGES = 8;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 2000, 4000];
const BAD_TOKENS = ['logo', 'icon', 'favicon', 'avatar', 'badge', 'sprite', 'pixel', 'tracking'];
const BAD_EXT = ['.svg', '.ico'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const args = (request && request.body && request.body.args) || {};
let websiteUrl = String(args.website_url || args.websiteUrl || '').trim();
if (!websiteUrl) {
  return { success: false, error: 'website_url is required' };
}
if (!/^https?:\/\//i.test(websiteUrl)) websiteUrl = 'https://' + websiteUrl;

let base;
try {
  base = new URL(websiteUrl);
} catch (e) {
  return { success: false, error: 'website_url is not a valid URL' };
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Bounded `for` retry loop on purpose: the edge WAF answers 403 to any hooks
// PATCH whose code contains an unbounded `while`.
async function fetchTextWithRetry(label, url) {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.log('[' + label + '] attempt ' + attempt + '/' + MAX_ATTEMPTS + ' after error: ' + lastError);
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    let outcome = { done: false };
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.ok && text) {
        outcome = { done: true, value: { ok: true, html: text } };
      } else if (res.ok) {
        lastError = 'empty response body';
      } else {
        lastError = 'HTTP ' + res.status;
        // 4xx is never transient — retrying just burns the execution budget.
        const transient = res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 425;
        if (!transient) outcome = { done: true, value: { ok: false, error: lastError } };
      }
    } catch (e) {
      lastError = (e && e.message) || String(e);
    } finally {
      clearTimeout(timer);
    }
    if (outcome.done) return outcome.value;
  }
  return { ok: false, error: lastError };
}

// Read one attribute off a tag. The leading [\s"'] boundary is what stops a
// lookup for `src` from matching `data-src`.
function attr(tag, name) {
  const re = new RegExp('[\\s"\']' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = tag.match(re);
  if (!m) return '';
  if (m[2] !== undefined) return m[2];
  if (m[3] !== undefined) return m[3];
  return m[4] || '';
}

function absolutize(raw) {
  const cleaned = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!cleaned || cleaned.slice(0, 5).toLowerCase() === 'data:') return null;
  try {
    return new URL(cleaned, base).toString();
  } catch (e) {
    return null;
  }
}

const images = [];
const seen = new Set();

// One filter for every source. Meta images are NOT exempt from the junk list:
// plenty of sites (apple.com, for one) point og:image at their logo, which is
// exactly what this step is meant to skip.
function push(rawUrl, alt) {
  const abs = absolutize(rawUrl);
  if (!abs || !/^https:\/\//i.test(abs) || seen.has(abs)) return;
  const lower = abs.toLowerCase();
  const path = lower.split('?')[0];
  if (BAD_EXT.some(function (ext) { return path.endsWith(ext); })) return;
  if (BAD_TOKENS.some(function (tok) { return lower.indexOf(tok) !== -1; })) return;
  seen.add(abs);
  images.push({ url: abs, alt: String(alt || '').trim() });
}

const fetched = await fetchTextWithRetry('fetch_website_images', websiteUrl);
if (!fetched.ok) {
  return { success: false, error: 'Could not read ' + websiteUrl + ': ' + fetched.error };
}

const html = fetched.html;
const metaTags = Array.from(html.matchAll(/<meta\b[^>]*>/gi)).map(function (m) { return m[0]; });

function metaKey(tag) {
  return (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
}

// Priority order: og:image, then twitter:image, then page <img> tags.
for (const tag of metaTags) {
  const key = metaKey(tag);
  if (key === 'og:image' || key === 'og:image:secure_url' || key === 'og:image:url') {
    push(attr(tag, 'content'), '');
  }
}
for (const tag of metaTags) {
  const key = metaKey(tag);
  if (key === 'twitter:image' || key === 'twitter:image:src') {
    push(attr(tag, 'content'), '');
  }
}

const imgTags = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map(function (m) { return m[0]; });
for (const tag of imgTags) {
  if (images.length >= MAX_IMAGES) break;
  push(attr(tag, 'src') || attr(tag, 'data-src'), attr(tag, 'alt'));
}

const top = images.slice(0, MAX_IMAGES);
console.log('[fetch_website_images] ' + top.length + ' image(s) from ' + base.hostname);

return {
  success: true,
  images: top,
  count: top.length,
  source_url: websiteUrl,
  message: top.length
    ? 'Found ' + top.length + ' image(s) on ' + base.hostname + '.'
    : 'No usable images found on ' + base.hostname + '.',
};
```

### Registry entry

```json
{
  "name": "fetch_website_images",
  "description": "Scrape real product/hero images from a website URL so the user can pick which to reference in their video. Returns up to 8 image URLs with their alt text. Show them to the user as inline markdown images and ask which to use before generating anything. A failure here is non-fatal - carry on without product images.",
  "parameters": {
    "website_url": {
      "type": "string",
      "required": true,
      "description": "The user's website or product page URL, e.g. https://example.com."
    }
  },
  "action": {
    "type": "api_call",
    "method": "POST",
    "endpoint": "/api/hooks/execute/workspace-660069/fetch-website-images",
    "bodyMapping": { "website_url": "website_url" }
  }
}
```

---

## 2. Hook `generate-character-image`

**Description:** Generate a portrait reference image for the video's main
character so the user can approve the look before a render is started. The
approved URL is passed back into `produce_video` as `character_image_url` and
becomes the Veo seed frame.

Suggested `metadata.timeout`: `120000` (image generation runs ~15–30s, and the
retry loop can add two more attempts).

```javascript
// generate-character-image — portrait reference for the video's character.
// Input:  request.body.args.{ character_description, aspect_ratio?, style? }
// Output: { success, image_url, prompt_used } | { success: false, error }
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 2000, 4000];
const ALLOWED_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const IMAGE_ENDPOINT = 'https://audos.com/api/generate/image';
const TRANSIENT_TEXT = /(rate limit|quota|overloaded|unavailable|deadline exceeded|bad gateway|timeout|timed out|econnreset|socket hang up)/i;

const args = (request && request.body && request.body.args) || {};
const characterDescription = String(args.character_description || args.characterDescription || '').trim();
if (!characterDescription) {
  return { success: false, error: 'character_description is required' };
}

let aspectRatio = String(args.aspect_ratio || args.aspectRatio || '1:1').trim() || '1:1';
if (ALLOWED_RATIOS.indexOf(aspectRatio) === -1) aspectRatio = '1:1';
const style = String(args.style || '').trim() || 'photorealistic';

const prompt =
  'Portrait photo of a real person: ' + characterDescription +
  '. Photorealistic, professional lighting, clean background, face clearly visible, sharp focus.' +
  ' The subject is shown from the shoulders up, looking at the camera. Style: ' + style + '.';

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Same bounded-`for` retry shape the other VidVerge hooks use (no `while` — the
// edge WAF 403s a hooks PATCH containing an unbounded one).
async function fetchJsonWithRetry(label, url, options, validate) {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.log('[' + label + '] attempt ' + attempt + '/' + MAX_ATTEMPTS + ' after error: ' + lastError);
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
    let outcome = { done: false };
    try {
      const res = await fetch(url, options);
      const data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        lastError = (data && data.error) || ('HTTP ' + res.status);
        const transient = res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 425;
        if (!transient) outcome = { done: true, value: { ok: false, error: lastError } };
      } else if (validate(data)) {
        outcome = { done: true, value: { ok: true, data: data } };
      } else {
        // A 2xx whose body is unusable is treated as transient.
        lastError = (data && data.error) || 'response did not include an image URL';
        if (!TRANSIENT_TEXT.test(lastError) && data && data.error) {
          outcome = { done: true, value: { ok: false, error: lastError } };
        }
      }
    } catch (e) {
      lastError = (e && e.message) || String(e);
    }
    if (outcome.done) return outcome.value;
  }
  return { ok: false, error: lastError };
}

const result = await fetchJsonWithRetry(
  'generate_character_image',
  IMAGE_ENDPOINT,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: prompt,
      aspectRatio: aspectRatio,
      quality: 'high',
      workspaceId: platform.workspaceId,
    }),
  },
  function (data) { return !!(data && data.success && typeof data.imageUrl === 'string' && data.imageUrl); },
);

if (!result.ok) {
  return { success: false, error: 'Could not generate the character image: ' + result.error };
}

console.log('[generate_character_image] generated ' + aspectRatio + ' portrait');

return {
  success: true,
  image_url: result.data.imageUrl,
  prompt_used: prompt,
  aspect_ratio: aspectRatio,
};
```

### Registry entry

```json
{
  "name": "generate_character_image",
  "description": "Generate a portrait reference image for the video's main character. Show the result to the user and ask for approval before proceeding to video generation. If they want changes, call it again with an updated description. Once approved, pass the returned image_url to produce_video as character_image_url.",
  "parameters": {
    "character_description": {
      "type": "string",
      "required": true,
      "description": "The character's appearance, e.g. 'early-30s woman, dark curly hair, blue blazer'. Use the same synthesised profile you pass to produce_video."
    },
    "aspect_ratio": {
      "type": "string",
      "required": false,
      "default": "1:1",
      "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"],
      "description": "Portrait framing. Defaults to 1:1."
    },
    "style": {
      "type": "string",
      "required": false,
      "default": "photorealistic",
      "description": "Visual style of the portrait, e.g. photorealistic, cinematic, editorial."
    }
  },
  "action": {
    "type": "api_call",
    "method": "POST",
    "endpoint": "/api/hooks/execute/workspace-660069/generate-character-image",
    "bodyMapping": {
      "character_description": "character_description",
      "aspect_ratio": "aspect_ratio",
      "style": "style"
    }
  }
}
```

### How to add both to the registry

The registry is a single document — read it, append to `registry.tools`, PUT it
back whole. Do not PUT a partial list; it replaces the array.

```bash
curl -s https://audos.com/api/workspace-settings/f24710e5-7c6d-4db4-92b4-c2c235877575/customer-tools -o reg.json
# append the two entries above to .registry.tools, then:
curl -X PUT -H 'Content-Type: application/json' --data-binary @reg.json \
  https://audos.com/api/workspace-settings/f24710e5-7c6d-4db4-92b4-c2c235877575/customer-tools
```

**Register the hooks BEFORE the registry entries.** A registered tool pointing at
a missing hook fails inside live customer conversations.

Also mind the naming lesson from `tools/generate-video.ts`: `produce_video` is
named that because a customer tool called `generate_video` collided with a
platform built-in and killed every agent turn. `fetch_website_images` and
`generate_character_image` were picked to avoid that class of collision — check
them against platform built-ins before registering.

---

## 3. Patch `generate-video` (hook id `819cc424-ff05-4d38-91dc-713f512e8392`)

This is the part that makes the approved character image actually matter.
Without it, `character_image_url` keeps being accepted and ignored, exactly as
it is today for My Characters.

The hook's current source could not be read from here (`GET .../hooks/<id>` is
401), so the following is expressed against the landmarks documented in
`tools/generate-video.ts` rather than as a literal diff. Read the live code
first, then apply.

**a) Parse the new args**, alongside the existing ones at the top:

```javascript
const characterImageUrl = String(args.character_image_url || args.characterImageUrl || '').trim();
const productImages = Array.isArray(args.product_images)
  ? args.product_images.filter(function (u) { return typeof u === 'string' && /^https?:\/\//.test(u); })
  : [];
```

**b) Character image wins the `startImage` slot.** In the `veoPayload`
construction block:

```javascript
// Character image takes priority as the seed for visual consistency.
// The website screenshot only opens the video when there is no character image.
if (characterImageUrl) {
  veoPayload.startImage = characterImageUrl;
  const charSeedNote = 'The first frame MATCHES the provided reference image exactly — same person, same face, same hair, same outfit. ';
  if ((scenes[0].prompt.length + charSeedNote.length) <= PROMPT_MAX_CHARS) {
    scenes[0].prompt = charSeedNote + scenes[0].prompt.slice(0, PROMPT_MAX_CHARS - charSeedNote.length);
  }
} else if (screenshotUrl && websitePlacement === 'start') {
  veoPayload.startImage = screenshotUrl;
  // ... existing start-placement scene note, unchanged ...
}
```

The `else if (screenshotUrl && websitePlacement === 'end')` branch stays exactly
as it is — the appended outro scene with the screenshot as its `lastFrameImage`
is unaffected, and it remains the only place a `lastFrameImage` is set.

**c) Reference the chosen product image in each scene prompt**, while building
prompts, still respecting the cap:

```javascript
if (productImages.length > 0 && productImages[0]) {
  const productNote = ' The product featured looks exactly like what is shown at: ' + productImages[0];
  if ((p.length + productNote.length) <= PROMPT_MAX_CHARS) p += productNote;
}
```

**d) Persist the new fields** on the `video_jobs` insert:

```javascript
character_image_url: characterImageUrl || null,
product_image_count: productImages.length,
```

`video_jobs` is a WorkspaceDB (PostgreSQL) table, not SQLite — `PRAGMA
table_info(...)` does not apply. Confirm the columns first with
`workspace_db_describe_table({ table: 'video_jobs' })` and add them additively
with `workspace_db_alter_table` (`character_image_url` text, nullable;
`product_image_count` integer, nullable, default `0`) rather than raw DDL —
WorkspaceDB's SQL path is read-only and silently drops `ALTER TABLE`.

**e) Update the hook description** to mention `character_image_url` (now the
Veo seed frame) and `product_images`.

**f) Add the two new parameters to the `produce_video` registry entry** —
`character_image_url` already exists there and needs only a description update;
`product_images` (array of string URLs, optional) has to be added, and to
`bodyMapping`, or the agent cannot pass it.

### Constraints that must survive the patch

- Every `scenes[].prompt` stays ≤ `PROMPT_MAX_CHARS` (1000). One overlong scene
  400s the whole job.
- `generateAudio: true` stays in the Veo payload — it is the only source of
  audio in the pipeline.
- Keep the session scoping on every `video_jobs` read (filter on the forwarded
  `X-Session-Id`), and keep the CAS-gated status update that prevents
  double-notifying the founder.
- Outbound calls go through `fetchJsonWithRetry`, and the retry loop stays a
  bounded `for` — an unbounded `while` anywhere in the code makes the edge WAF
  403 the PATCH itself.

---

## 4. Registry updates ready for an authenticated session (Aug 13 2026)

**Why this section exists:** the customer-tools registry is now behind the
same auth wall as hook management — both
`GET` and `PUT /api/workspace-settings/f24710e5-7c6d-4db4-92b4-c2c235877575/customer-tools`
answer `401 {"error":"Authentication required"}` from the workspace code
bridge (verified Aug 13 2026; the "200 unauthenticated" note earlier in this
file was true on Aug 11 but is stale). The two changes below must therefore be
applied by Otto or another authenticated platform session.

Procedure (read-append-write, unchanged): GET the registry, modify
`registry.tools`, PUT the WHOLE document back as
`{ "registry": { "version": ..., "tools": [ ...full list... ] } }`. Never PUT
a partial tools array — the PUT replaces the entire list. And never register a
tool named `generate_video` — it collides with a platform built-in and kills
every agent turn (see tools/generate-video.ts).

### 4a. Append the `fetch_website_images` entry

The backing hook is LIVE (id `8cd45ad3-6847-442f-ac8d-81a83d1c862c`). Append
the exact "Registry entry" JSON from section 1 above to `registry.tools`,
unchanged. This un-gates "Step A — Website images" in
`agent/customer-prompt.md`, which is already written and deliberately inert
until the tool appears in the agent's tool list — no prompt edit needed.

### 4b. Update the `produce_video` entry for the now-live reference-image fields

The generate-video hook already consumes both fields. In the EXISTING
`produce_video` entry (do not touch its other parameters, and keep every other
tool in the array exactly as read):

1. Add to `parameters`:

```json
"reference_image_url": {
  "type": "string",
  "required": false,
  "description": "URL of a real product image to visually anchor the video - e.g. the image the user picked in the fetch_website_images step. It is attached to scene 1 as the generation start frame. A missing or invalid URL is ignored (non-fatal), so pass it whenever the user picked one."
},
"reference_image_scene": {
  "type": "integer",
  "required": false,
  "description": "1-based index of the scene the reference image should influence. When omitted the image anchors scene 1 (the start frame)."
}
```

2. Add to `action.bodyMapping`:

```json
"reference_image_url": "reference_image_url",
"reference_image_scene": "reference_image_scene"
```

### 4c. Update the `produce_video` entry so the agent can pick the MODEL

**This is the fix for “I picked Gemini Omni Flash and got Veo 3.1.”** The
generate-video hook has accepted the model for a while — its own description
documents `model` / `video_model` (Kling ids `kling-v1`, `kling-v1-5`,
`kling-v1-6`, `kling-v2-master`; Veo-family ids `veo-3.1-generate-preview`,
`veo-3.1-fast-generate-preview`, `veo-3.0-generate-001`,
`veo-3.0-fast-generate-001`, `veo-2.0-generate-001`, `sora-2`, `sora-2-pro`,
`gemini-omni-flash-preview`) and `mode` / `kling_mode` (`std` | `pro`, ignored
on the Veo engine). What is missing is purely the REGISTRY declaration: with no
`model` parameter on the tool, Reel has nothing to pass, and the prompt
correctly forbids inventing an argument because an unknown one fails the whole
call. So the dropdown in the options bar is a control that cannot work, and the
Create app is the only place a model choice is honoured today.

The browser already hands Reel the exact values it needs: the `[VIDEO OPTIONS …]`
block built by `generationOptionsContext()` in `lib/reelioStudio.ts` names the
provider id and, on Kling, the tier. Nothing else has to change — the moment
these two parameters exist, Reel starts passing them and the in-chat picker
starts working. `agent/customer-prompt.md` is already written for both worlds:
while the parameters are absent Reel discloses the limitation up front and
offers the studio, and once they are present that branch simply never fires.

In the EXISTING `produce_video` entry (do not touch its other parameters, and
keep every other tool in the array exactly as read):

1. Add to `parameters`:

```json
"model": {
  "type": "string",
  "required": false,
  "enum": [
    "veo-3.1-generate-preview",
    "veo-3.1-fast-generate-preview",
    "veo-3.0-generate-001",
    "veo-3.0-fast-generate-001",
    "veo-2.0-generate-001",
    "sora-2",
    "sora-2-pro",
    "gemini-omni-flash-preview",
    "kling-v1-6",
    "kling-v2-master",
    "kling-v1-5",
    "kling-v1"
  ],
  "description": "The video model to render on. The user picks this in the options bar next to the chat composer and it arrives in the [VIDEO OPTIONS] block as 'provider id \"<id>\"' - pass that id here verbatim. Omit it to accept the pipeline default. The Veo/Sora/Gemini ids generate their own sound; the Kling ids are picture only, so never promise audio on a kling-* render."
},
"mode": {
  "type": "string",
  "required": false,
  "enum": ["std", "pro"],
  "description": "Kling render tier, ignored on every non-Kling model. The options bar sends it as 'tier \"<std|pro>\"' in the [VIDEO OPTIONS] block. 'pro' costs roughly double and looks better."
}
```

2. Add to `action.bodyMapping`:

```json
"model": "model",
"mode": "mode"
```

**Verifying it landed** (worth doing, because the symptom is silent — a render
simply comes back on the wrong engine): set the options bar to *Gemini Omni
Flash*, ask Reel in chat for a short video, and let it render. Then check the
newest row in **My Videos**, or read `model_used` on the newest `video_jobs`
row — the hook stamps the real engine id there at submit time. It should read
`gemini-omni-flash-preview`, not `veo-3.1-generate-preview`. Before this delta
is applied that check fails every time.
