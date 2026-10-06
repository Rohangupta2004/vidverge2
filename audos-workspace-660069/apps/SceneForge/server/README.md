# SceneForge Motion Editor — server functions

The three server functions behind the Motion Graphics Editor are **registered
in the platform's hook registry, not in this folder**. That is not a
convention choice: the platform runs a hook only from the registry, it stores
no source path, and it will never re-register a function from a same-named
file in the space tree. A `.ts` copy here would be dead code that drifts from
what actually executes — and because the compiler copies `apps/` into the
published page, it would also ship server source to the browser. So this file
documents the contracts instead, and the code is edited with the
`workspace_server_functions` tool (Otto: `manage_server_functions`).

All three are called from `apps/SceneForge/lib/editorRender.ts`, which forwards
`X-Workspace-DB-Token` and `X-Session-Id` from the browser. Execute URL shape:
`/api/hooks/execute/workspace-660069/<name>`.

---

## `sceneforge-composite-video`

The export pipeline. Three ops.

### `op: "render"`

```json
{
  "op": "render",
  "video_id": "v_abc123",
  "row_id": 12,
  "base_video_url": "https://.../heygen-master.mp4",
  "aspect_ratio": "9:16",
  "duration_sec": 28.4,
  "overlays": [
    { "asset_url": "https://.../plate.png", "start_time": 1.2, "end_time": 4.4, "layer": "graphic" },
    { "asset_url": "https://.../card.mp4", "start_time": 9, "end_time": 13, "layer": "broll", "slot": 1, "fade_out": true }
  ],
  "inserts": [{ "clip_url": "https://.../card.mp4", "at_sec": 18, "duration_sec": 4 }],
  "assembly": { "color_grade": "warm", "pacing": "fast_cut", "transitions": [{ "before_slot": 1, "type": "cross_dissolve" }] },
  "music": { "url": "https://.../bed.mp3", "volume": 0.22, "fadeInSec": 1.2, "fadeOutSec": 1.6, "replaceOriginalAudio": false },
  "speech": [[0.1, 4.4], [5.2, 9.8]]
}
```

Answer: `{ success: true, render: RenderJob }` — see `RenderJob` in
`apps/SceneForge/lib/motionEditor.ts`. A render that fails still answers 200
with `render.status === "failed"` and `render.error`, so the editor can show
which step broke instead of a bare HTTP error.

Order of work:

| Aspect | What runs |
|---|---|
| `9:16` | `POST /api/workspaces/:id/videos/overlay` at 1080×1920 with every timed asset and the assembly directives → optional card stitch. |
| `16:9` | One `POST /api/render/remotion` pass at 1920×1080 that draws the same timed assets **and** mixes the music bed with speech ducking → optional card stitch. |

Two limits the function reports rather than hides:

- The portrait compositor keeps the base audio (`-map 0:a`), so a 9:16 export
  cannot mix a music bed. The `audio` step comes back `skipped` with that
  reason and the bed stays a separate downloadable track.
- `video-stitch` normalises a merged export to 1280×720, so a portrait film
  with **cut-in** cards returns 16:9. Overlay placement is the default for
  exactly this reason.

Safety: a `render` call while `render_job.status` is `running`/`pending`
returns the job in flight instead of starting a second paid render. Overlay
counts above 40 are refused up front (`code: "too_many_overlays"`) rather than
spending a render that would time out — a hook's outbound request is cut off
at 90 seconds.

### `op: "status"`

`{ op, video_id, row_id }` → `{ success: true, render }`. Polls the Remotion
operation for a landscape export, runs any pending card stitch when it
completes, and writes the terminal state. This is how a render survives a
reload.

### `op: "normalize"`

`{ op, base_video_url, aspect_ratio, duration_sec }` → `{ success: true,
baseVideoUrl }`. Re-encodes a portrait master to a verified 1080×1920 MP4 on
workspace storage, which fixes both an expiring HeyGen signed URL and a
browser that cannot read the file cross-origin for transcription. Portrait
only (`code: "portrait_only"` otherwise), because it runs through the same
overlay endpoint.

Writes (trusted path): `vv_heygen_renders.render_job`, `.final_video_url`,
`.status`, `.error_text`, and `.video_url` on a successful re-host.

---

## `sceneforge-stitch-hyperframes`

```json
{
  "base_video_url": "https://.../master.mp4",
  "inserts": [{ "clip_url": "https://.../card.mp4", "at_sec": 12, "duration_sec": 4 }],
  "duration_sec": 28.4,
  "video_id": "v_abc123"
}
```

→ `{ success, stitchedUrl, order, note }`.

Trims the base either side of each insert point with `POST /api/video/clip`,
then merges `[base 0..t1, card 1, base t1..t2, …]` with
`POST /api/workspaces/:id/videos/stitch`. At most six inserts per call; base
slices under 0.2s are dropped because ffmpeg cannot cut a usable clip that
short. Still images are refused (`code: "no_video_inserts"`) — a card rendered
as a styled still belongs on the overlay path.

---

## `sceneforge-caption-generate`

```json
{ "words": [{ "word": "Welcome", "start": 0.08, "end": 0.42 }], "max_chars": 32, "video_id": "v_abc123" }
```

→ `{ success, source: "word_timestamps", segments: [{ id, start, end, text }] }`.

**Why the browser uploads the audio.** Both platform transcription endpoints
take `multipart/form-data`; a hook sandbox has no `FormData`, no `Blob` and no
byte array, so it cannot build that request. The browser reads the master's
bytes and posts them to
`POST /api/workspaces/:id/audio/transcribe-timestamped` (Deepgram word
timings), then sends the timings here. This function owns the part that must
be identical for every caller: how words become lines — break on a pause
longer than 0.65s, on a sentence end, at `max_chars`, or after 3.2s; hold a
very short line for at least 0.55s without overlapping the next one.

A `{ transcript, duration }` body is accepted as a degraded fallback and comes
back with `source: "even_spacing"` plus a note, so the editor never presents
evenly spaced lines as the presenter's real timings.
