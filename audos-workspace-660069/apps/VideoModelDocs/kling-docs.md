# Kling Video — Integration Documentation
> Source: integrations/kling-video/docs.md | Updated: 2026-10-14

## Authentication
Platform-managed `KLING_API_KEY` — never expose to apps. Send `X-Workspace-DB-Token: window.__workspaceDb.token` with every generation and status request. Cross-workspace access is refused.

---

## Current Model Roster (as of 2026-10-14)

| App Model ID | Provider Identity | Inputs Supported | std USD/sec | pro USD/sec |
|---|---|---|---|---|
| `kling-2.5-turbo` | `kling-v2-5-turbo` | text, first frame; first+last in pro | $0.042 | $0.070 |
| `kling-2.6` | `kling-v2-6` | text, first frame, first+last | $0.042 | $0.070 |
| `kling-3.0` | `kling-v3` | text, first frame, first+last | $0.084 | $0.112 |
| `kling-3.0-omni` | `kling-v3-omni` | text, first frame, first+last, **2–4 reference images** | $0.084 | $0.112 |

- **Text/image default:** `kling-2.5-turbo`
- **Multi-image default:** `kling-3.0-omni`
- `std` = 720p | `pro` = 1080p
- All generations: **silent, single-shot, 5 or 10 seconds**
- Default mode/duration: `std` / `"5"`
- **5-second text/image cost:** $0.21 | **5-second multi-image cost:** $0.42

---

## Retired Model IDs (still parse → replaced by operation default)

| Old ID | Status |
|---|---|
| `kling-v1` | Retired — multi-image on this ID is **refused** |
| `kling-v1-5` | Retired |
| `kling-v1-6` | Retired |
| `kling-v2-master` | Retired |

Results disclose replacements in `modelFallback` with `requestedModel`, resolved `model`, and `providerModel`. **Show this notice to users; do not label replacement output as the retired model.** Unknown model IDs return `400` before billing — no silent fallback.

---

## API Endpoints

```
POST /api/generate/kling/text-to-video
POST /api/generate/kling/image-to-video
POST /api/generate/kling/multi-image
GET  /api/generate/kling/status/:taskId
POST /api/generate/kling/extend
POST /api/generate/kling/lip-sync
GET  /api/generate/kling/models
```

| Endpoint | Body / Notes |
|---|---|
| `POST text-to-video` | `prompt` required; optional: `model`, `mode`, `duration`, `aspectRatio`, `negativePrompt` |
| `POST image-to-video` | `imageData` required; optional: `tailImageData`, `prompt`, `negativePrompt`, `model`, `mode`, `duration` |
| `POST multi-image` | `images` (2–4 references), optional: `prompt`, `model`, `mode`, `duration` |
| `GET status/:taskId` | No `generationType` query; ownership selects correct polling API including Omni |
| `POST extend` | `sourceTaskId`, optional `prompt`, `negativePrompt`, `cfgScale`; older compatible videos only ($0.25); current-model sources refused before billing |
| `POST lip-sync` | `videoTaskId`, `audioType: "text" | "audio"`, corresponding `text` or `audioUrl`; ($0.25) |
| `GET models` | Public discovery, model-specific prices, aliases, capabilities, replacement policy — **STATIC LIST, not a liveness oracle** |

---

## Parameters

| Param | Values | Notes |
|---|---|---|
| `aspect` | `16:9`, `9:16`, `1:1` | |
| `mode` | `std`, `pro` | `std` = 720p, `pro` = 1080p |
| `duration` | `'5'` or `'10'` | ≥8s snaps to `'10'`, else `'5'` |
| `negativePrompt` | string ≤2500 chars | ✅ Supported |
| `cfgScale` | number | Optional (extend only) |
| Omni `negativePrompt` | ❌ | Put negative descriptions inside `prompt` instead |

---

## UNSUPPORTED Fields (rejected before billing, not stripped)

`cameraControl`, `dynamicMasks`, `cfgScale` (in standard gen), `seed`, native audio, voice controls, video references, element IDs, multi-shot controls, 4K. Do not send unsupported fields including empty values.

---

## Route Selection Logic

```
refs >= 2 + model has multi-image → multi-image (Elements / Omni)
refs == 1                         → image-to-video
refs == 0                         → text-to-video
```

Multi-image Omni reference IDs are `image_1`, `image_2`, etc. — refer to them as `@image_1` in the prompt when needed.

---

## Polling

- Every **5 seconds**
- Up to **12-minute timeout**
- 6 consecutive missed status checks → `poll_lost` error
- `status === 'completed' && videoUrl` → done
- `status === 'failed'` → throw with provider error message

---

## Kickoff Response Shape

```json
{
  "taskId": "...",
  "status": "...",
  "model": "...",
  "requestedModel": "...",
  "providerModel": "...",
  "mode": "std",
  "duration": "5",
  "generationType": "...",
  "estimatedDuration": "...",
  "modelFallback": { }
}
```

Status includes: `videoId`, `videoUrl`, `videoDuration`, `errorMessage`.

---

## Error & Billing

| Code | Meaning |
|---|---|
| `400` | Invalid/unsupported selection |
| `401` | Unauthenticated |
| `402` | Insufficient wallet |
| `403` | Wrong workspace or task owner |
| `429` | Throttled (honor `Retry-After`) |
| `503` | Platform credential unavailable |
| `502` | Provider kickoff failure |

Failed kickoffs → inspect `refunded`; never infer from status. Discontinued model: `code: "kling_model_discontinued"`, `providerCode`, `providerStatus`, `retryable: false`, `refunded`. Polling a failed task does NOT authorize another paid generation.

---

## Code Example

```javascript
const headers = {
  'Content-Type': 'application/json',
  'X-Workspace-DB-Token': window.__workspaceDb.token
};
const start = await fetch('/api/generate/kling/text-to-video', {
  method: 'POST', headers,
  body: JSON.stringify({
    prompt: 'Gentle waves on a quiet beach',
    model: 'kling-2.5-turbo',
    mode: 'std',
    duration: '5'
  })
});
const task = await start.json();
if (!start.ok) throw new Error(task.error);
const status = await fetch(
  `/api/generate/kling/status/${encodeURIComponent(task.taskId)}`,
  { headers }
);
const result = await status.json();
// Only completed + videoUrl is playable; "queued" is NOT success
```

---

## Fallback Behaviour

If Kling is unavailable (503, no models, network error) → falls back to **Gemini Omni Flash** with the same reference images. `fallbackFrom` is reported so the UI can tell the user what happened.
