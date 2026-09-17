# generate-video hook patch — Gemini Omni Flash PRIMARY, Veo 3.1 fallback

> ## SUPERSEDED — DO NOT APPLY (Aug 16 2026)
>
> Everything below describes an Omni Flash path that authenticates with a
> WORKSPACE SECRET (`{{secrets.GOOGLE_API_KEY}}` through `platform.secretsProxy`,
> against `generativelanguage.googleapis.com` directly). **That is not how Omni
> Flash runs here, and no such secret exists on this workspace.**
>
> The live `generate-video` hook renders `gemini-omni-flash-preview` through the
> SAME platform proxy Veo 3.1 uses — `POST /api/veo/generate/video` with the
> model id in the body and `workspaceId` for wallet attribution. The Google
> credentials are held platform side, so Omni Flash needs no workspace secret,
> no secrets proxy and no allow-listed host: it authenticates identically to
> Veo 3.1, and picking it in the model dropdown is the whole of the setup.
>
> Applying this document would reintroduce a secret reference that resolves to
> nothing and fail every Omni Flash render. It is kept only as a record of the
> route that was considered and rejected.

**Status: SUPERSEDED — the design below was never applied and must not be. Historical text follows.**

**Original status line: NOT APPLIED YET — must be applied by Otto / an authenticated platform
session.** Hook management is walled off from build agents (re-verified
2026-08-13: `GET`/`PATCH` on
`/api/workspaces/workspace-660069/hooks/819cc424-ff05-4d38-91dc-713f512e8392`
answer `401 {"error":"Authentication required"}` from the workspace code
bridge — deliberate platform hardening, not a bug). Read the live hook code
first (`GET .../hooks/819cc424-ff05-4d38-91dc-713f512e8392`, the `code` field
is ~19KB), apply the changes below, `PATCH` the code back, and verify
`updatedAt` advanced.

**Apply AFTER (or together with)** the still-pending character-consistency
patch in `tools/generate-video-character-consistency-patch.md` — this patch
assumes its `referenceImageUrl` / `hasReferenceImage` parsing (section 2
there) exists. If applying both in one PATCH, do the character patch's edits
first, then layer this one on top.

**Goal:** every `generate-video` call tries **Gemini Omni Flash** (synchronous
Interactions API) first; on any error, timeout, or missing video it falls back
automatically to the existing **Veo 3.1** long-video pipeline, which stays
byte-for-byte as it is today. No silent failures: if BOTH models fail the hook
returns a structured `both_models_failed` error. Success responses carry
`model_used` so the app/agent can surface it.

---

## 0. Prerequisites (check before patching)

- **`GOOGLE_API_KEY` workspace secret** must exist, be enabled, and
  `generativelanguage.googleapis.com` must be allow-listed for it in the
  secrets proxy (see the `custom-api-keys` integration docs). If the secret is
  missing, every Omni Flash attempt fails fast with `unknown_secret` and the
  hook falls back to Veo — safe, but pure wasted latency, so confirm it first.
- `video_jobs` now has a **`model_used`** text column (added additively via
  `workspace_db_alter_table` on 2026-08-13) — persist it on every insert.
- The client side already sends the job-level `referenceImageUrl` anchor from
  BOTH app paths (see "Client status" at the bottom).

## 1. Raise the hook timeout in the same PATCH

Omni Flash is synchronous — the Interactions call blocks until the video is
rendered, which can take minutes — and the sandbox's per-fetch timeout equals
`metadata.timeout`. Today the hook has `metadata.timeout = 240000`; that
leaves no room for an Omni attempt PLUS a slow Veo fallback submit (~120s
worst case). PATCH body should therefore carry both fields:

```json
{ "code": "<updated code>", "metadata": { "timeout": 480000 } }
```

(480s: worst case ≈ Omni attempt + upload + Veo submit with its 60s retry
backoff, still under the platform's 600000ms cap.)

## 2. The Omni Flash primary path

Insert AFTER the existing code has finished building the per-scene Veo
prompts (character seed line, character block, dialogue append, phone-screen
block, website outro scene, 950-char clamp — all of that runs ONCE and feeds
both models) and after `referenceImageUrl` / `hasReferenceImage` are parsed,
but BEFORE the Veo submit. Names below assume: `scenes` = the built array of
`{ prompt, ... }`, `aspectRatio` = the validated `16:9 | 9:16` string,
`totalDurationSeconds` = the job's target duration.

```javascript
// ===== GEMINI OMNI FLASH — PRIMARY MODEL (synchronous, no polling) =====
const OMNI_MODEL = 'gemini-omni-flash-preview';
let omniFlashError = '';
let omniVideoUrl = '';

async function tryOmniFlash() {
  // (a) Optional image input: when the job has a reference image
  //     (referenceImageUrl — character photo or product hero, already parsed),
  //     fetch its bytes as base64 through the secrets proxy. The sandbox has
  //     no Buffer/atob, so responseType 'binary' (base64 body) is the only
  //     clean way to get encodable bytes. An image fetch failure must NOT
  //     fail the Omni path — log and continue text-only.
  let imagePart = null;
  if (hasReferenceImage) {
    const img = await platform.secretsProxy({
      method: 'GET',
      url: referenceImageUrl,
      responseType: 'binary',
    });
    if (img.ok && img.encoding === 'base64' && img.body) {
      imagePart = {
        type: 'image',
        data: img.body,
        mime_type: (img.headers && img.headers['content-type']) || 'image/jpeg',
      };
    } else {
      console.warn('[generate-video] omni-flash reference image fetch failed (' +
        ((img && (img.code || img.error)) || 'unknown') + ') — continuing text-only');
    }
  }

  // (b) ONE combined prompt from the SAME per-scene prompts the Veo path
  //     uses — the character seed, dialogue and phone-screen guarantees ride
  //     along for free. (The 950-char clamp is per Veo scene prompt and
  //     stays; the combined Omni prompt has no documented cap.)
  const combinedPrompt =
    'Create ONE continuous ' + totalDurationSeconds + '-second ' + aspectRatio +
    ' video with native audio: characters speak their dialogue lines on camera with ' +
    'synced lips, plus fitting music and ambience. Play it as ' + scenes.length +
    ' consecutive scenes:\n' +
    scenes.map(function (s, i) { return 'Scene ' + (i + 1) + ': ' + s.prompt; }).join('\n');

  // (c) The Interactions API call. Image input turns `input` into an array:
  //     [{type:'image',...}, {type:'text',...}]; text-only stays a string.
  const omniInput = imagePart
    ? [imagePart, { type: 'text', text: combinedPrompt }]
    : combinedPrompt;

  const result = await platform.secretsProxy({
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/interactions?key={{secrets.GOOGLE_API_KEY}}',
    json: {
      model: OMNI_MODEL,
      input: omniInput,
      response_format: { type: 'video', aspect_ratio: aspectRatio },
    },
    responseType: 'json',
  });
  if (!result.ok) {
    // Covers upstream errors, timeouts, unknown_secret, host_not_allowed and
    // response_too_large (secretsProxy caps upstream responses at 10MB — a
    // long/high-bitrate MP4 can exceed it; that is an EXPECTED fallback
    // trigger, not a defect).
    throw new Error('interactions call failed: ' + (result.code ? result.code + ' ' : '') +
      (result.error || ('HTTP ' + result.status)));
  }

  // (d) The response is synchronous. The video lives in steps[]: find the
  //     step whose type == 'model_output'; content[0].data is the base64 MP4.
  const steps = (result.body && Array.isArray(result.body.steps)) ? result.body.steps : [];
  let videoB64 = '';
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st && st.type === 'model_output' && Array.isArray(st.content) && st.content[0] &&
        typeof st.content[0].data === 'string' && st.content[0].data) {
      videoB64 = st.content[0].data;
      break;
    }
  }
  if (!videoB64) {
    throw new Error('interactions response contained no model_output video step');
  }

  // (e) Durable URL: upload the MP4 through the platform's base64 JSON upload
  //     endpoint (the multipart /api/upload/file endpoint is unusable from the
  //     sandbox — no FormData). Upload failure = Omni path failure => Veo.
  const uploadRes = await fetch('https://audos.com/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageData: 'data:video/mp4;base64,' + videoB64,
      fileName: 'omni-flash-' + Date.now() + '.mp4',
    }),
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData || !uploadData.success || typeof uploadData.imageUrl !== 'string') {
    throw new Error('omni-flash video upload failed: ' +
      ((uploadData && uploadData.error) || ('HTTP ' + uploadRes.status)));
  }
  return uploadData.imageUrl;
}

try {
  omniVideoUrl = await tryOmniFlash();
} catch (e) {
  omniFlashError = String((e && e.message) || e);
  console.warn('[generate-video] gemini-omni-flash failed, falling back to veo-3.1: ' + omniFlashError);
}
```

**Sandbox rules honored:** bounded `for` loops only (an unbounded `while`
anywhere in the code makes the edge WAF 403 the PATCH itself), no
Buffer/require/FormData, secretsProxy never throws proxy-level failures.

## 3. Omni success: completed job, immediate delivery

When `omniVideoUrl` is non-empty, do NOT run the Veo submit. Insert a
**completed** `video_jobs` row and respond immediately (the render is already
done — there is nothing to poll):

```javascript
if (omniVideoUrl) {
  const jobId = 'omni_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  // SESSION ATTRIBUTION (unchanged rule): forwarded X-Session-Id header first,
  // body.session_id fallback — same as the Veo insert.
  await db.insert('video_jobs', {
    job_id: jobId,
    title: title,                                // same values the Veo insert uses
    status: 'completed',
    video_url: omniVideoUrl,
    script_json: scriptJson,
    character_description: characterDescription,
    tone: tone,
    duration_seconds: totalDurationSeconds,
    scene_count: scenes.length,
    aspect_ratio: aspectRatio,
    character_image_url: hasCharacterImage ? characterImageUrl : null,
    product_image_count: productImages.length,
    reference_image_url: hasReferenceImage ? referenceImageUrl : null,
    model_used: 'gemini-omni-flash',
    session_id: forwardedSessionId || body.session_id || null,
  });
  console.log('[generate-video] model_used=gemini-omni-flash job=' + jobId);
  respond(200, {
    success: true,
    job_id: jobId,
    status: 'completed',
    stage: 'ready',
    download_url: omniVideoUrl,
    video_url: omniVideoUrl,
    audio: 'ready',                 // Omni output is ONE MP4 with native audio — never stitched
    model_used: 'gemini-omni-flash',
    message: 'Your video is ready! 🎬',
  });
}
```

Wrap the ENTIRE existing Veo submit path in the matching `else` branch (the
sandbox is a top-level script — do not rely on a top-level `return`).

## 4. Veo 3.1 fallback — existing logic stays as-is

Inside the `else` branch, the current Veo code runs UNCHANGED:

- `POST https://audos.com/api/veo/generate-long-video` with
  `model: "veo-3.1-generate-preview"` and **`generateAudio: true` — NEVER
  remove it** (Veo-native audio is the pipeline's only sound source).
- The 950-char per-scene prompt clamp (the "1000-char prompt guard") stays.
- `startImage` seeding from `referenceImageUrl` (character-consistency patch
  section 2), website screenshot scenes, phone-screen block, retry backoff,
  session attribution on the insert — all unchanged.
- Two additive edits only:
  1. the Veo path's `video_jobs` insert gains `model_used: 'veo-3.1'`;
  2. the Veo path's success response gains `model_used: 'veo-3.1'` and a log
     line `console.log('[generate-video] model_used=veo-3.1 job=' + jobId)`.

## 5. Complete failure: structured error, never a silent 200

Today, when the Veo submit runs out of retries the hook responds
`502 { success:false, error, retry:true }`. Reshape that terminal branch (it
only runs after Omni already failed, since a successful Omni never reaches
Veo) to:

```javascript
respond(502, {
  success: false,
  error: 'both_models_failed',
  omniFlashError: omniFlashError || 'not attempted',
  veoError: String((veoError && veoError.message) || veoError),
  retry: true,
});
```

Keep the existing early 4xx VALIDATION responses (bad/missing script etc.)
exactly as they are — those reject the request before any model runs and are
not model failures. Never respond 200 without a video URL or a job id.

## 6. Companion guard in check-video-status (small, defensive)

Omni jobs are inserted already-`completed`, so the poll loop never touches
them — but `check-video-status` also BACKFILLS `video_stitches` rows for
completed multi-clip jobs by polling `GET /api/veo/status-long-video/:job_id`,
and an `omni_*` job id would 404 there every time. Add a one-line guard where
the backfill picks its candidates:

```javascript
if (row.model_used === 'gemini-omni-flash') { /* single MP4, native audio — skip backfill */ }
```

(`video-render-watcher` needs no change: it only sweeps rows stuck in
`processing`, and Omni rows are never in that state.)

## MUST survive the patch unchanged

- `generateAudio: true` in the Veo payload — DO NOT REMOVE.
- The 950-char per-scene prompt clamp (Veo prompt guard).
- Session scoping on every `video_jobs` READ and session attribution on every
  INSERT (header first, `body.session_id` fallback) — including the new Omni
  insert.
- Bounded `for` retry loops only — an unbounded `while` ANYWHERE in the code
  makes the edge WAF 403 the PATCH itself.
- CAS-gated status updates + founder notifications in check-video-status /
  video-render-watcher.
- The `phoneScreenBlock` phone-beat injection and website screenshot scenes.
- Never register a customer tool named `generate_video` (platform built-in
  collision — the working name is `produce_video`).

## After patching

1. Verify with `GET .../hooks/819cc424-ff05-4d38-91dc-713f512e8392` that
   `code` matches and `updatedAt` advanced, and that `metadata.timeout` is
   480000.
2. Add `referenceImageUrl` (string, optional — "public https URL of ONE image
   anchoring the video: the character's photo or the product hero image") to
   the `produce_video` registry entry's parameters + bodyMapping, so the
   agent-driven flow can pass it too.
3. Test end-to-end via the execute URL (ALWAYS with an `X-Session-Id` header —
   unattributed rows pollute every visitor's My Videos): one text-only job,
   one with `referenceImageUrl`, and one with an intentionally broken
   `GOOGLE_API_KEY` reference to watch the Veo fallback + `model_used`
   reporting fire.

## Client status (already live in the draft, no further app work needed)

- `apps/Create/studioApi.ts` `submitStudioVideo()` sends top-level
  `referenceImageUrl` (+ snake_case twin), priority: character photo/portrait
  first, else product hero image (`product_images[0]`).
- `lib/reelioStudio.ts` `submitVideo()` (Videos app / skill-video flow) now
  also sends top-level `referenceImageUrl`: the character picker photo first,
  else `character_data.image_url` (added 2026-08-13). Its per-scene
  `reference_image_url` + `reference_image_scene` screenshot fields are a
  DIFFERENT contract and were left untouched.
- `video_jobs.model_used` column exists (2026-08-13, additive).
