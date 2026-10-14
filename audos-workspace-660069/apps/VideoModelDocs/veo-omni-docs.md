# Gemini Omni 1.1 Flash (Veo) — Integration Documentation
> Source: integrations/google-veo3/docs.md + integrations/image-and-video-generation/docs.md | Updated: 2026-10-14

## Canonical Model ID
```
gemini-omni-1.1-flash
```

## Retired / Alias IDs (all still accepted, all served by `gemini-omni-1.1-flash`)

| Retired ID | Old Name |
|---|---|
| `gemini-omni-flash-preview` | Omni Flash preview |
| `veo-3.1-generate-preview` | Veo 3.1 |
| `veo-3.1-fast-generate-preview` | Veo 3.1 Fast |
| `openrouter/google/veo-3.1` | Still accepted |
| `openrouter/google/veo-3.1-fast` | Still accepted |
| `openrouter/google/veo-3.1-lite` | Still accepted |
| `openrouter/bytedance/seedance-2.0-fast` | Still accepted |
| All Veo 3.x / 2.0 previews, Sora 2 | All → served by `gemini-omni-1.1-flash` |

---

## Capabilities

| Property | Value |
|---|---|
| Provider | Google |
| Max clip duration | 8 seconds |
| Output resolution | **720p max** (4K is NOT available — `FOUR_K_MODELS` is intentionally empty) |
| Aspect ratios | `16:9`, `9:16` |
| Audio | ✅ (optional, `generateAudio: true`) |
| Negative prompt | ✅ |
| Reference images | ✅ **Up to 10** (refs + seed combined) |
| Last-frame interpolation | ✅ (`imageData` + `lastFrameImage`) |
| Source-video editing | ✅ (`videoData` + `videoMimeType`) |
| Approximate cost | ≈ $0.40 / clip |
| Prompt limit | 10–10,000 characters (Audos limit) |

---

## API Endpoints

```
POST /api/veo/generate/video          — Schema-validated full proxy
POST /api/generate/video              — Lightweight convenience proxy (defaults to Omni)
GET  /api/veo/status/:operationId     — Poll status
GET  /api/generate/video/status/:operationId  — Alternate polling path
POST /api/veo/generate-long-video     — Automated multi-clip long video
GET  /api/veo/status-long-video/:jobId — Poll long video
```

---

## Full Request Body (`POST /api/veo/generate/video`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | enum | yes | `gemini-omni-1.1-flash` (default and recommended) |
| `prompt` | string 10–10,000 | yes | Never truncated by proxy |
| `negativePrompt` | string | no | Things that should NOT appear |
| `aspectRatio` | string | no, default `"16:9"` | `16:9` or `9:16` |
| `generateAudio` | boolean | no, default `false` | |
| `enhancePrompt` | boolean | no, default `true` | Compatibility only; current models ignore |
| `duration` | integer | no | 4–25 with existing normalization |
| `resolution` | string | no | `720p`, `1080p`, `4k` (Omni capped at `720p`) |
| `imageData` | string | no | First frame seed (base64 / `data:` URL / `http(s)://` URL) |
| `referenceImages` | array | no | Up to 10; each `{ imageData, mimeType?, referenceType? }` |
| `lastFrameImage` | object | no | Final frame `{ imageData, mimeType? }` — cannot combine with `referenceImages` |
| `videoData` | string | no | Source video for editing (base64 / `data:` URL / `http(s)://` URL) |
| `videoMimeType` | enum | no | `video/mp4`, `video/webm`, `video/quicktime`, `video/mpeg`, `video/mpg`, `video/mpegs`, `video/x-flv`, `video/wmv`, `video/3gpp` — defaults `video/mp4` |

---

## imageData / referenceImages Accepted Formats

Every `imageData` field accepts:
- Raw base64-encoded bytes (no `data:` prefix)
- `data:image/<mime>;base64,<bytes>` URL
- `http(s)://` URL — proxy downloads and forwards bytes to Google
- **Max size:** ~10MB decoded (`14_000_000` base64 chars per image)
- **Accepted MIME types:** `image/png`, `image/jpeg`, `image/webp`
- HTTP redirects: **refused**
- Private/loopback/RFC1918/CGNAT/IPv6-ULA/AWS-metadata IPs: **refused**

---

## Combining Rules (proxy-enforced — violations return `400`)

| Combination | Allowed |
|---|---|
| `imageData` + `lastFrameImage` (first/last-frame flow) | ✅ |
| `imageData` + `referenceImages` | ✅ |
| `referenceImages` alone | ✅ |
| `imageData` alone | ✅ |
| `lastFrameImage` alone | ✅ |
| `lastFrameImage` + `referenceImages` | ❌ 400 |

---

## Per-Model Image Input Support Matrix

| Model | `imageData` | `referenceImages` | `lastFrameImage` |
|---|:---:|:---:|:---:|
| `gemini-omni-1.1-flash` | ✅ | ✅ up to 10 | ✅ |
| `openrouter/bytedance/seedance-2.5` | ✅ | ✅ max 3 asset only, no frames | ✅ (requires `imageData` first) |
| Other `openrouter/*` | ✅ | ❌ → 400 | ❌ → 400 |

---

## Reference Type Values

- `referenceType: "asset"` (default) — subject/character reference
- `referenceType: "style"` — style/mood reference (Omni only; Seedance 2.5 returns 400 on `"style"`)

---

## Response (200)

```json
{
  "success": true,
  "generationId": "gen_abc123",
  "operationId": "operations/...",
  "status": "processing",
  "progress": 10,
  "cost": "0.40",
  "estimatedDuration": "1-3 minutes",
  "message": "Video generation started. Use the operationId to check status."
}
```

---

## Polling

```
GET /api/veo/status/:operationId
```

Response:
```json
{
  "status": "processing | completed | failed",
  "progress": 60,
  "videoUrl": "https://storage.googleapis.com/...",
  "errorMessage": "..."
}
```

Poll every **~5 seconds** until `completed` or `failed`.

---

## Character Consistency Pattern

```javascript
const characterRef = {
  imageData: heroCharacterBase64,
  mimeType: 'image/png',
  referenceType: 'asset'
};

for (const scenePrompt of scenePrompts) {
  const res = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-omni-1.1-flash',
      prompt: scenePrompt,
      aspectRatio: '16:9',
      duration: 8,
      referenceImages: [characterRef],
    })
  });
  const { operationId } = await res.json();
  // poll /api/veo/status/:operationId
}
```

---

## Long Video (Multi-Clip Chaining)

```
POST /api/veo/generate-long-video
```

```json
{
  "model": "gemini-omni-1.1-flash",
  "aspectRatio": "16:9",
  "startImage": "https://storage.googleapis.com/bucket/opening-frame.png",
  "scenes": [
    { "prompt": "A drone shot rising over a misty forest at dawn" },
    { "prompt": "The camera glides forward between the treetops" },
    { "prompt": "It breaks above the canopy into golden sunrise light" }
  ]
}
```

- `scenes`: 1–8 entries of `{ prompt, lastFrameImage? }`
- Each clip uses previous clip's last frame as its first frame
- `startImage`: optional seed for the very first clip
- Status values: `pending` → `processing` → `stitching` → `completed`
- `partial` = clips rendered but stitching failed
- `failed` = a clip could not be generated

Poll: `GET /api/veo/status-long-video/:jobId`

---

## First/Last Frame Interpolation

```javascript
await fetch('/api/veo/generate/video', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gemini-omni-1.1-flash',
    prompt: 'Camera pulls back from the subject as scene transitions to dusk',
    imageData: openingFrameBase64,
    lastFrameImage: { imageData: closingFrameBase64, mimeType: 'image/png' }
  })
});
```

---

## Seedance 2.5

**Model ID:** `openrouter/bytedance/seedance-2.5`

| Property | Value |
|---|---|
| Duration | **4–30 seconds** (integer, unrounded) |
| Resolution | 480p / 720p (default 720p) |
| Aspect ratios | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9` |
| Audio | ✅ optional |
| First frame | ✅ |
| Last frame | ✅ (requires first frame) |
| Reference images | ✅ max 3 asset images |
| `negativePrompt` | ❌ |
| `referenceType: "style"` | ❌ → 400 |
| Production-ready | ⚠️ Not yet deployed (2026-10-14) |

Pricing: `(width × height × 24 × seconds) / 1024` at $0.0000107/token. Actual cost uses OpenRouter `usage.cost`.
