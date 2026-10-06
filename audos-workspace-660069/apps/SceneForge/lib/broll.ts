// B-ROLL OVERLAY — AUDIO-TRANSPARENT BY CONSTRUCTION.
//
// A B-roll clip NEVER replaces a scene and never touches the soundtrack: it
// is composited as a muted corner picture-in-picture over the generated scene
// inside the ONE Remotion assembly render (see remotion/AssemblyComp
// BrollPip). The film's original audio — the presenter's narration and the
// music bed — runs underneath completely undisturbed, because the overlay is
// a <Video muted> layer and nothing is re-encoded afterwards.
//
// Two sources:
//   * UPLOAD   — the customer's own footage, stored through the platform
//                file-storage endpoint.
//   * PEXELS   — https://api.pexels.com/videos/search, reached through the
//                workspace secrets proxy with the founder's own
//                PEXELS_API_KEY. The key cannot be listed from app code, so
//                the first search IS the probe: its verdict is latched once
//                and the UI then shows either results or one precise setup
//                line (missing key / rejected key / host not allow-listed).
//
// Timing is explicit: every clip carries start_sec / end_sec RELATIVE TO THE
// SCENE WINDOW, so "pin this B-roll at 2.5s for 3 seconds" renders exactly.

import { uploadFile } from './proxy';
import { updateScene, WORKSPACE_ID, type Scene } from './supabase';

export type BrollPosition = 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left';
export type BrollSource = 'pexels' | 'upload' | 'generated';

// A type alias rather than an interface on purpose: the Scene row types this
// column as Record<string, unknown>, and only an alias carries the implicit
// index signature that makes the assignment check out without a cast.
export type BrollClip = {
  url: string;
  poster?: string;
  source: BrollSource;
  query?: string;
  position: BrollPosition;
  /** Fraction of the frame width the PiP occupies (0.15–0.5). The brief's
   * default corner treatment is 30% in the top right. */
  width_pct: number;
  /** Seconds from the START of the scene window. */
  start_sec: number;
  end_sec: number;
  credit?: string;
};

export const BROLL_POSITIONS: { id: BrollPosition; label: string }[] = [
  { id: 'top_right', label: 'Top right' },
  { id: 'top_left', label: 'Top left' },
  { id: 'bottom_right', label: 'Bottom right' },
  { id: 'bottom_left', label: 'Bottom left' },
];

const POSITION_IDS: BrollPosition[] = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeBroll(raw: unknown): BrollClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const url = String(source.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const position = String(source.position || 'top_right') as BrollPosition;
  const start = clamp(source.start_sec, 0, 3600, 0);
  const end = clamp(source.end_sec, start + 0.4, 3600, start + 3);
  const clip: BrollClip = {
    url,
    source: (['pexels', 'upload', 'generated'] as BrollSource[]).includes(source.source as BrollSource) ? source.source as BrollSource : 'upload',
    position: POSITION_IDS.includes(position) ? position : 'top_right',
    width_pct: clamp(source.width_pct, 0.15, 0.5, 0.3),
    start_sec: Math.round(start * 100) / 100,
    end_sec: Math.round(end * 100) / 100,
  };
  const poster = String(source.poster || '').trim();
  if (/^https?:\/\//i.test(poster)) clip.poster = poster;
  const query = String(source.query || '').trim();
  if (query) clip.query = query.slice(0, 120);
  const credit = String(source.credit || '').trim();
  if (credit) clip.credit = credit.slice(0, 120);
  return clip;
}

export function brollOf(scene: Scene): BrollClip | null {
  return normalizeBroll((scene as any).broll);
}

/** The scene window length in seconds, used to seed B-roll timing. */
export function sceneWindowSec(scene: Scene): number {
  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  return Number.isFinite(span) && span > 0 ? span : 4;
}

/**
 * A sensible first B-roll placement for a scene: top-right corner at 30% of
 * frame width, starting a beat into the scene and holding for most of it —
 * the brief's default, editable afterwards.
 */
export function defaultBrollFor(scene: Scene, url: string, extra: Partial<BrollClip> = {}): BrollClip {
  const window = sceneWindowSec(scene);
  const start = window > 3 ? 0.6 : 0;
  return normalizeBroll({
    url,
    source: 'upload',
    position: 'top_right',
    width_pct: 0.3,
    start_sec: start,
    end_sec: Math.max(start + 1, window - 0.3),
    ...extra,
  }) as BrollClip;
}

/** Persist (or clear) a scene's B-roll through the server function. */
export async function setSceneBroll(scene: Scene, clip: BrollClip | null): Promise<void> {
  await updateScene(scene.id, { broll: clip } as any, scene.project_id);
}

/** Upload the customer's own footage and return its durable URL. */
export async function uploadBrollClip(file: File): Promise<string> {
  const uploaded = await uploadFile(file, 'sceneforge-broll');
  return uploaded.url;
}

// ---------------------------------------------------------------------------
// Pexels Videos, through the workspace secrets proxy
// ---------------------------------------------------------------------------

export type PexelsVerdict = 'unknown' | 'usable' | 'missing' | 'host-not-allowed' | 'rejected';

export interface PexelsClip {
  id: string;
  url: string;
  poster: string;
  durationSec: number;
  width: number;
  height: number;
  credit: string;
}

export interface PexelsSearchResult {
  verdict: PexelsVerdict;
  clips: PexelsClip[];
  /** Exactly what to tell the founder when the search cannot run. */
  note: string;
}

// Stored secret NAME and the host its allow-list must contain. Both appear
// verbatim in the setup messages so the founder never has to guess.
const PEXELS_SECRET = 'PEXELS_API_KEY';
const PEXELS_HOST = 'api.pexels.com';
const CONFIG_FAILURES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

// One latch for the whole session: the docs are explicit that a configuration
// verdict must not be re-probed per search, and that transient codes must
// never latch.
let pexelsVerdict: PexelsVerdict = 'unknown';

export function pexelsVerdictNow(): PexelsVerdict { return pexelsVerdict; }

export function pexelsSetupNote(verdict: PexelsVerdict): string {
  if (verdict === 'missing') return `Stock B-roll search needs a “${PEXELS_SECRET}” custom API key (allow-listed for ${PEXELS_HOST}). Ask Otto to add it — until then, upload your own B-roll clips here and everything else works normally.`;
  if (verdict === 'rejected') return `${PEXELS_SECRET} was rejected by ${PEXELS_HOST} (401/403). The key exists but its value is wrong or revoked — ask Otto to rotate it. Uploads still work.`;
  if (verdict === 'host-not-allowed') return `${PEXELS_SECRET} is not allowed to call ${PEXELS_HOST}. Ask Otto to add that host to the key's allow-list. Uploads still work.`;
  return '';
}

function pickFile(files: any[]): { link: string; width: number; height: number } | null {
  const mp4s = (Array.isArray(files) ? files : [])
    .filter((file) => String(file?.file_type || '').includes('mp4') && /^https?:\/\//i.test(String(file?.link || '')))
    .map((file) => ({ link: String(file.link), width: Number(file.width) || 0, height: Number(file.height) || 0 }));
  if (!mp4s.length) return null;
  // A corner PiP never needs more than ~720p; the smallest file at or above
  // 640px wide keeps the render download fast without going soft.
  const sized = mp4s.filter((file) => file.width >= 640).sort((a, b) => a.width - b.width);
  return sized[0] || mp4s.sort((a, b) => b.width - a.width)[0];
}

/**
 * Search Pexels for B-roll. The call itself is the key probe: a configuration
 * refusal latches the verdict and returns the precise setup line, while a
 * transient failure is reported without latching so a later search still
 * tries. Never throws.
 */
export async function searchPexelsVideos(query: string, options: { perPage?: number; orientation?: 'landscape' | 'portrait' } = {}): Promise<PexelsSearchResult> {
  const term = String(query || '').trim();
  if (!term) return { verdict: pexelsVerdict, clips: [], note: 'Type what the B-roll should show, or pick one of the AI-suggested terms.' };
  if (pexelsVerdict !== 'unknown' && pexelsVerdict !== 'usable') {
    return { verdict: pexelsVerdict, clips: [], note: pexelsSetupNote(pexelsVerdict) };
  }
  const token = typeof window === 'undefined' ? '' : String((window as any).__workspaceDb?.token || '');
  if (!token) return { verdict: 'unknown', clips: [], note: 'The workspace session is not ready yet. Try the search again in a moment.' };
  try {
    const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/secrets/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        method: 'GET',
        url: `https://${PEXELS_HOST}/videos/search`,
        query: {
          query: term,
          per_page: String(Math.min(12, Math.max(1, options.perPage || 8))),
          orientation: options.orientation || 'landscape',
        },
        headers: { Authorization: `{{secrets.${PEXELS_SECRET}}}` },
        responseType: 'json',
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = String(data?.code || '');
      if (CONFIG_FAILURES.has(code)) {
        pexelsVerdict = code === 'unknown_secret' ? 'missing' : 'host-not-allowed';
        return { verdict: pexelsVerdict, clips: [], note: pexelsSetupNote(pexelsVerdict) };
      }
      // Transient or request-shape failures must NOT latch the verdict.
      return { verdict: 'unknown', clips: [], note: `Stock search could not run just now (${code || response.status}). Try again, or upload your own clip.` };
    }
    // A successful proxy round trip is not a successful API call — read the
    // UPSTREAM status before trusting the body.
    if (data?.status === 401 || data?.status === 403) {
      pexelsVerdict = 'rejected';
      return { verdict: pexelsVerdict, clips: [], note: pexelsSetupNote(pexelsVerdict) };
    }
    if (Number(data?.status) >= 400) {
      return { verdict: 'usable', clips: [], note: `Pexels answered ${data.status} for “${term}”. Try a different phrase.` };
    }
    pexelsVerdict = 'usable';
    const body = typeof data?.body === 'string' ? JSON.parse(data.body) : data?.body;
    const clips: PexelsClip[] = (Array.isArray(body?.videos) ? body.videos : [])
      .map((video: any): PexelsClip | null => {
        const file = pickFile(video?.video_files);
        if (!file) return null;
        return {
          id: String(video?.id || file.link),
          url: file.link,
          poster: String(video?.image || ''),
          durationSec: Number(video?.duration) || 0,
          width: file.width,
          height: file.height,
          credit: `Pexels · ${String(video?.user?.name || 'unknown')}`,
        };
      })
      .filter(Boolean) as PexelsClip[];
    return {
      verdict: 'usable',
      clips,
      note: clips.length ? '' : `No Pexels footage matched “${term}”. Try one of the AI-suggested terms, or upload your own clip.`,
    };
  } catch (error: any) {
    return { verdict: 'unknown', clips: [], note: `Stock search could not be reached: ${String(error?.message || error).slice(0, 140)}` };
  }
}
