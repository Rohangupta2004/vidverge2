# Patch spec: record real render-failure reasons + stop auto-retrying content-filter rejections

**Status: APPLIED to BOTH hooks and verified. `check-video-status`: verified
live Aug 13 2026, ~18:50 UTC. `video-render-watcher`: code read back Aug 15
2026 (~02:10 UTC) via the hooks MCP surface (`workspace_server_functions`) —
its registered source contains `extractFailureReason` (top-level
`statusData.errorMessage`, then the failed clip's `errorMessage`, bounded
for-loop, 500-char cap), the `NON_RETRIABLE` classification gating the
resubmit (`if (retriable && await attemptAutoResubmit(row, failureReason))`),
the real reason on both the resubmit and final-failure writes, the
non-retriable founder notification wording, CAS-gated updates, and
fetchJsonWithRetry on every outbound call. DO NOT re-apply this patch to
either hook.**

NOTE ON ACCESS (corrected Aug 15 2026): raw HTTP hook management
(`GET/PATCH /api/workspaces/660069/hooks/*`) does answer 401 to the code
bridge's HTTP credentials — but the bridge's MCP tool surface exposes
`workspace_server_functions` (list/read/create/update on this workspace's
hooks), which is how the watcher was read and how the phone-shot opt-out was
applied to generate-video the same day. Future agents: use that tool, do not
fetch the HTTP endpoints.

The spec below is kept for reference; it is expressed against landmarks, not
as a literal diff.

### What is verified (from the outside, no hook read required)

1. **Real reason persisted.** `video_jobs` row 72's `error` is byte-identical
   to the top-level `errorMessage` that
   `GET /api/veo/status-long-video/long_video_1786639548564_3pp2lv` still
   returns — the full "Clip 1 failed: Content filtered: … celebrity likeness
   …" text, not `'generation failed'`.
2. **No resubmit on a content rejection.** Row 72 kept `retry_count = 0`,
   where rows 65 and 67 had each burned a second identical render. The
   infrastructural path is untouched: the `render job lost by the video
   service` rows still auto-retry once.
3. **Which hook did it.** Row 72 was finalized at 18:52:32. Every
   watcher-written row in the table lands at :12–:14 past the hour (01:12,
   08:14, 10:14, 23:14), so `check-video-status` recorded row 72. The watcher
   (hook `99624e48-7c35-459c-ab3a-0bd55b7e0ae7`) demonstrably carries the
   EARLIER resubmit patch — its `{"dryRun": true}` summary reports
   `resubmitted` — but no render has failed through it since this patch was
   deployed, so its failure-reason half is unproven. Whoever next has an
   authenticated session should `GET` that hook and confirm
   `extractFailureReason` / `NON_RETRIABLE` are present in its code.
4. **The 14 legacy `'generation failed'` rows cannot be backfilled.** The
   render service forgets a job's detail: row 71's job
   (`long_video_1786636438025_4s2ba7`) already answers with an empty body.

### Correction to this spec's premise (measured Aug 13 2026 19:25–19:30 UTC)

This document assumed a content-filter rejection is DETERMINISTIC — "the same
payload fails the same way". That is not what happens. A verification render
(`video_jobs` row 75) reused the *exact* portrait rows 71 and 72 were rejected
for, as the same job-level `startImage`, and it **completed**. So the filter is
at least partly nondeterministic on identical input. Skipping the resubmit is
still defensible as spend control, but it is not true that a retry cannot
succeed — and the client should not tell the user the photo is unusable. See
the IMAGE-ANCHOR VERDICT block in `tools/generate-video.ts`.

Targets — the two hooks that detect a failed render:

- `check-video-status` — hook id `f778318d-aa0b-4f53-bb09-04d30d50403c`
- `video-render-watcher` — hook id `99624e48-7c35-459c-ab3a-0bd55b7e0ae7`

(`generate-video`, id `819cc424-ff05-4d38-91dc-713f512e8392`, needs no change
for this patch.)

---

## Context: what already shipped, and what this patch adds

Auto-resubmit-once went LIVE on Aug 13 2026 (deployed from an authenticated
session; E2E-verified the same morning — rows 67/69, sessions
`subotto-verify-e2e` / `wses_e2e_verify_reel`). Working as deployed:
`retry_count` cap of 1, identical resubmit from the stored
`video_jobs.veo_payload`, `job_id` swapped to the new render while
`session_id` is untouched, honest `error = 'auto-retried after: <…>'` note,
CAS-gated updates so the two hooks never double-act, `resubmitted` count in
the watcher summary, and `agent/customer-prompt.md` already documents the
behaviour for the agent. **Do not redo any of that.**

Two pieces of the original spec are missing from the deployed code. Both were
verified live on Aug 13 2026:

### Gap 1 — the real failure reason is thrown away

`GET /api/veo/status-long-video/:job_id` DOES expose failure detail on a
failed job (verified on two live failed jobs; detail was still available ~80
minutes after failure — until the render service forgets the job):

```json
{
  "jobId": "long_video_1786605249073_9ir5qm",
  "clips": [
    {
      "index": 0,
      "status": "failed",
      "progress": 50,
      "operationId": "models/veo-3.1-generate-preview/operations/…",
      "errorMessage": "Content filtered: The image was flagged as containing a celebrity likeness. If the person is AI-generated or not a real celebrity, this is a false positive in Google's safety filter. Try using a different image or modifying the face to be less photorealistic."
    }
  ],
  "overallStatus": "failed",
  "overallProgress": 71,
  "errorMessage": "Clip 1 failed: Content filtered: The image was flagged as containing a celebrity likeness. …"
}
```

Yet the deployed hooks still record the literal `'generation failed'` on the
`video_jobs` row and notify the founder with the same empty phrase — the
watcher's dry-run for that exact job says *“could not be generated (generation
failed)”* while the endpoint above was simultaneously reporting the full
content-filter message. Completed clips in the same response carry `videoUrl`
instead of `errorMessage`, so only failed clips have detail.

### Gap 2 — content/safety rejections are auto-resubmitted anyway

A content-filter rejection is deterministic: the same payload fails the same
way, so the resubmit just burns one more paid render. That happened twice on
Aug 13 2026: rows **65** and **67** both failed on Google's content filter
(celebrity-likeness flag on the seed image), were auto-retried
(`retry_count = 1`), and failed again identically.

---

## The patch (apply to BOTH hooks, same logic in each)

Both hooks have a code path that handles `overallStatus === 'failed'` from the
status endpoint and (since the resubmit patch) branches on
`retry_count === 0` → resubmit vs. mark-failed-and-notify.

**a) Extract the real reason** right where `overallStatus === 'failed'` is
detected (`statusData` = the parsed status-endpoint body):

```javascript
function extractFailureReason(statusData) {
  var reason = (statusData && statusData.errorMessage) || '';
  if (!reason && statusData && Array.isArray(statusData.clips)) {
    // Bounded loop on purpose: the edge WAF 403s any hooks PATCH whose code
    // contains an unbounded while-loop (ticket 660069-9UP5RPNJ).
    for (var i = 0; i < statusData.clips.length; i++) {
      var c = statusData.clips[i];
      if (c && c.status === 'failed' && c.errorMessage) {
        reason = 'Clip ' + (Number(c.index || 0) + 1) + ' failed: ' + c.errorMessage;
        break;
      }
    }
  }
  reason = String(reason || '').trim();
  if (reason.length > 500) reason = reason.slice(0, 497) + '...';
  return reason || 'generation failed';
}
```

**b) Classify non-retriable rejections** and gate the resubmit on it:

```javascript
var NON_RETRIABLE = /content.?filter|filtered|safety|celebrit|likeness|prohibited|violat|inappropriate|sensitive content|policy|blocked/i;
var failureReason = extractFailureReason(statusData);
var retriable = !NON_RETRIABLE.test(failureReason);
```

The resubmit branch becomes `if (retriable && retry_count === 0) { … }` —
i.e. a content/safety rejection is marked failed immediately, even on the
first failure, with the real reason recorded. A reason that is absent or
looks infrastructural (including the existing lost-job / "not found" path)
keeps auto-retrying exactly as deployed today.

**c) Record the reason everywhere the literal `'generation failed'` is
written today:**

- resubmit path: `error: 'auto-retried after: ' + failureReason`
- final-failure path: `error: failureReason`
- founder notification: include `failureReason` instead of
  `(generation failed)`. For a non-retriable rejection, say it was a content
  rejection and that retrying the same payload will not help (the Veo message
  itself suggests the fix: different seed image / less photorealistic face).
  Keep notifications CAS-gated and non-fatal exactly as they are.

**d) Do NOT change:**

- the tool **response shapes** — the agent prompt and the in-chat progress
  card key off the existing field names (`stage`, `progress`, `audio`,
  `download_url`, `user_message`, `retried`). Reporting `stage: 'generating'`
  while a resubmit is in flight stays as is. Putting `failureReason` into the
  failed-state `user_message`/message text is fine; do not rename or remove
  any existing field.
- the CAS compare-and-swap guard on every status transition (it is what makes
  the watcher and an in-conversation poll unable to double-act on one job);
- session scoping on reads (`X-Session-Id` filter) and the rule that updates
  never touch `session_id`;
- `retry_count` semantics (cap stays 1);
- bounded `for` loops only — an unbounded while-loop over a literal true
  condition anywhere in the PATCHed code makes the edge WAF answer 403 to the
  PATCH itself (ticket 660069-9UP5RPNJ; the same filter even rejects bridge
  file writes whose text contains that token, which is why this sentence
  spells it out instead of quoting it).

---

## Testing (no staging copy of a hook exists — validate before pushing)

1. Run each patched hook body in Node inside an async wrapper with mocked
   `request` / `respond` / `db` / `platform` / `fetch` (the same harness used
   to verify the Aug 9 retry work). Feed it a mocked status response shaped
   like the JSON above and assert: content-filter failure → NO resubmit, row
   error = the real reason; bare `overallStatus: 'failed'` with no
   `errorMessage` anywhere → resubmit happens (when `retry_count = 0`) and
   error = `auto-retried after: generation failed`.
2. Smoke-test live without spending anything: `generate-video` with an empty
   script returns 400 before any API call; the watcher accepts
   `{ "dryRun": true }` and logs every action it would take without writing
   or notifying. Never trigger a real render to test.
3. After PATCHing, `GET` the hook back and confirm `code` matches what was
   sent and `updatedAt` advanced (the registry is the only source of truth —
   a file under `hooks/` proves nothing).
