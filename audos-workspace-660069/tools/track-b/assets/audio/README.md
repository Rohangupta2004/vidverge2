# audio/
The APPROVED music catalog plus frozen voiceover lines.

**Platform orchestrator path:** `catalog.json` here is the manifest of the
approved catalog. The durable public MP3 URLs behind it are minted once via the
platform's `elevenlabs-audio` integration (AI-generated, workspace-licensed)
by the `trackb-orchestrator` server function and stored in `trackb_config`
(key `music_catalog`). The orchestrator freezes those tracks into every
project's `frozen_audio`, which is what the Product Editor's music picker
offers and what `trackb-render` bakes into the film (via props, never inlined).

- Music: only tracks placed here (licensed) are selectable in the Product Editor's music picker and resolvable by the assets stage. A music brief that matches nothing here halts as PLAN_DEFECT — the module never sources music from the open web.
- Voice: one voice identity per film. Voiceover WAVs are generated locally (`hyperframes tts`, Kokoro) and recorded in each project's ledger with voice_id + seed + stability so single-line regeneration reuses the exact same voice settings.
