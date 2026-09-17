# Track B shared asset catalog

Resolution order (1): before touching stock sets or generation, the assets
stage looks here for a frozen asset whose filename starts with the manifest id.

- `icons/` — SVG, `currentColor` only
- `backgrounds/`, `textures/` — PNG/WebP (grain is NEVER an image — inline CSS `radial-gradient` only)
- `logos/`, `screenshots/` — product truth; sourced from intake captures, never invented
- `audio/` — the APPROVED music catalog. The Product Editor's music picker and the
  assets stage only accept tracks that exist here (or in a project's own ledger).
  Adding a track = dropping a licensed file here; the assets stage freezes and
  hashes it into each project that uses it.

Every asset a project uses is copied INTO that project and recorded in its
`assets/ledger.json` with source, licence, prompt (if generated), and sha256 —
projects never reference this catalog at render time.
