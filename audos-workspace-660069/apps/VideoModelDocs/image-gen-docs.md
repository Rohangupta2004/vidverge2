# Image Generation — Integration Documentation
> Source: integrations/image-and-video-generation/docs.md | Updated: 2026-10-14

---

## `POST /api/veo/generate/image` — App Picks Model

```json
{
  "model": "gemini-3.1-flash-image" | "gemini-2.5-flash-image-preview" | "dall-e-3",
  "prompt": "A professional headshot photo",
  "negativePrompt": "<optional>",
  "aspectRatio": "1:1" | "16:9" | "9:16" | "3:4" | "4:3" | "4:5" | "5:4",
  "editImageData": "<optional base64 for image edits>"
}
```

| Model | Recommended | Notes |
|---|---|---|
| `gemini-3.1-flash-image` | ✅ Use this | text-to-image, image-to-image edits, portrait ratios |
| `gemini-2.5-flash-image-preview` | ❌ Retired | Google returns 404 — do not use in new code |
| `dall-e-3` | ✅ | No portrait ratios (`3:4`, `4:3`, `4:5`, `5:4` → 400) |

- **image-to-image:** send `editImageData` (raw base64, no `data:` prefix)
- **Portrait/landscape ratios:** `3:4`, `4:3`, `4:5`, `5:4` — Gemini only; DALL-E returns 400
- `gemini-3.1-flash-image` cost: **$0.067/image** (1K output)
- `dall-e-3` cost: **$0.04/image**
- Response `imageUrl` is a `data:` URL with provider MIME type (Gemini returns `image/jpeg`)

---

## `POST /api/generate/image` — Platform-Managed Model

```json
{
  "prompt": "A professional headshot photo",
  "aspectRatio": "1:1" | "16:9" | "9:16" | "3:4" | "4:3" | "4:5" | "5:4",
  "quality": "standard" | "hd",
  "returnBase64": false,
  "model": "gpt-image-2"
}
```

- Default model: `gpt-image-1.5` (auto Gemini fallback)
- Only override accepted: `"gpt-image-2"` (+ `gpt-image-1.5` fallback for OpenAI-compatible ratios)
- `3:4`, `4:3`, `4:5`, `5:4` → uses Gemini natively; `"gpt-image-2"` + these ratios → `400 unsupported_aspect_ratio`
- `quality: "standard"` = 1K | `quality: "hd"` = 2K
- Response: `imageUrl` (GCS-uploaded)

---

## Complete Model Comparison — Character Consistency

| Feature | Gemini Omni Flash | Kling 3.0-Omni | Seedance 2.5 |
|---|---|---|---|
| Reference images | ✅ up to 10 per clip | ✅ 2–4 references | ✅ max 3 asset refs |
| `referenceType: "style"` | ✅ | N/A | ❌ |
| Seed for reproducibility | `Seed: n` in prompt text | ❌ (removed from proxy) | N/A |
| Last frame lock | ✅ `lastFrameImage` | ✅ `tailImageData` in pro | ✅ (requires first frame) |
| First/last-frame interpolation | ✅ | ✅ | ✅ |
| Max duration | 8s | 10s | 30s |
| Max resolution | 720p | 1080p (pro) | 720p |
| Audio | ✅ optional | ❌ (silent) | ✅ optional |
| Negative prompt | ✅ | ✅ ≤2500 chars | ❌ (put in prompt) |
| Integer seed param | ❌ (prompt-text only) | ❌ (removed) | N/A |
| Fallback behaviour | N/A (primary) | → falls back to Omni | N/A |
| Cost | ≈$0.40/clip | $0.21–$0.42 / 5s | token-based |
| Production-ready | ✅ | ✅ | ⚠️ Not yet deployed |
