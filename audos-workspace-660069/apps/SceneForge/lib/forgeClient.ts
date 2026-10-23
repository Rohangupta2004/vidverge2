/**
 * SceneForge (Oct 2026 rebuild) — the browser-side client.
 *
 * Everything stateful goes through the `sceneforge-pipeline` server function
 * (session-gated, durable job-row + tick), so a reload resumes instead of
 * restarting. Generation, provider polling and post-production run in the
 * durable server worker; this module only owns interactive browser work:
 *   — the complete ElevenLabs voice catalog (shared lib/elevenLabsVoices),
 *   — every paginated HeyGen public/account avatar look through the same-origin
 *     proxy with X-Workspace-DB-Token,
 *   — project commands and read-only progress refreshes.
 * Idea-to-script runs on gpt-6.1-sol through the OpenAI proxy per the app AI
 * policy (interactive tier, X-Workspace-DB-Token).
 */
import { callHook, getWorkspaceToken, WORKSPACE_ID } from '../../../lib/workspace';
import type { ForgeAvatar, ForgeAvatarBundle, ForgeChoices, ForgeProject } from './forgeTypes';

// ---------------------------------------------------------------------------
// Pipeline ops
// ---------------------------------------------------------------------------

async function pipeline(body: Record<string, unknown>): Promise<any> {
  return callHook('sceneforge-pipeline', body);
}

export async function listProjects(): Promise<ForgeProject[]> {
  const data = await pipeline({ op: 'list' });
  return Array.isArray(data?.projects) ? data.projects : [];
}

export async function createProject(input: {
  topic: string;
  script: string;
  niche: string;
  style: string;
  target_length_sec: number;
  choices: ForgeChoices;
}): Promise<ForgeProject> {
  const data = await pipeline({ op: 'create', ...input });
  if (!data?.ok || !data.project) throw new Error(data?.error || 'The project could not be created.');
  return data.project;
}

export async function startProject(projectId: string, script: string, choices: ForgeChoices): Promise<ForgeProject> {
  const data = await pipeline({ op: 'start', project_id: projectId, script, choices });
  if (!data?.ok || !data.project) throw new Error(data?.error || 'Generation could not start.');
  return data.project;
}

export interface TickResult {
  project: ForgeProject | null;
  insufficient?: { required: number; shortfall: number | null };
}

export async function tickProject(projectId: string): Promise<TickResult> {
  const data = await pipeline({ op: 'tick', project_id: projectId });
  if (data?.code === 'insufficient_credits') {
    return { project: data.project || null, insufficient: { required: Number(data.required) || 0, shortfall: data.shortfall == null ? null : Number(data.shortfall) } };
  }
  return { project: data?.project || null };
}

export async function getProject(projectId: string): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'get', project_id: projectId });
  return data?.project || null;
}

export async function chooseDraft(projectId: string, variation: number): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'choose_draft', project_id: projectId, variation });
  return data?.project || null;
}

export async function cancelProject(projectId: string): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'cancel', project_id: projectId });
  return data?.project || null;
}

export async function retryFromStep(projectId: string): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'retry_step', project_id: projectId });
  if (!data?.ok) throw new Error(data?.error || 'This step could not be retried.');
  return data.project || null;
}

export async function reviewStep(
  projectId: string,
  step: string,
  action: 'approve' | 'regenerate' | 'edit',
  value?: string,
): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'step_action', project_id: projectId, step, action, value });
  if (!data?.ok) throw new Error(data?.error || `The ${step} step could not be updated.`);
  return data.project || null;
}

export async function applyEdit(projectId: string, changes: {
  accent?: string;
  music_mood?: string;
  timing_shift?: number;
  event_text?: Record<number, string>;
  scene_gestures?: Record<number, string>;
  scene_emotions?: Record<number, string>;
}): Promise<ForgeProject | null> {
  const data = await pipeline({ op: 'edit', project_id: projectId, ...changes });
  if (data?.ok === false) throw new Error(data?.error || 'The edit could not be applied.');
  return data?.project || null;
}

// ---------------------------------------------------------------------------
// Idea → script (gpt-6.1-sol via the OpenAI proxy — interactive tier)
// ---------------------------------------------------------------------------

export async function ideaToScript(idea: string, niche: string, targetSeconds: number): Promise<string> {
  const token = await getWorkspaceToken();
  if (!token) throw new Error('Your workspace session is not ready yet — refresh and try again.');
  const wordsTarget = Math.round((targetSeconds / 60) * 140);
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-6.1-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 6000,
      messages: [
        {
          role: 'system',
          content:
            'You write spoken presenter scripts for avatar videos. Conversational, specific, zero filler. ' +
            'Write ONLY the words the presenter says — no stage directions, no headings, no markdown. ' +
            'Tailor examples and vocabulary to the stated niche/industry so the video feels made for that audience.',
        },
        {
          role: 'user',
          content:
            'Niche/industry: ' + (niche || 'general business') + '\n' +
            'Target length: about ' + targetSeconds + ' seconds (~' + wordsTarget + ' words).\n' +
            'Idea: ' + idea,
        },
      ],
    }),
  });
  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!res.ok || !text) throw new Error(data?.error?.message || data?.error || 'The script could not be generated.');
  return String(text).trim();
}

// ---------------------------------------------------------------------------
// HeyGen catalog — browser-only same-origin proxy, token-authenticated, all pages.
// ---------------------------------------------------------------------------

const HEYGEN_PROXY = () => `/api/workspaces/${WORKSPACE_ID}/provider-credentials/heygen/proxy`;
async function heygen(path: string, init?: RequestInit): Promise<any> {
  const token = await getWorkspaceToken();
  if (!token) throw new Error('Your workspace session is not ready yet — refresh and try again.');
  const response = await fetch(`${HEYGEN_PROXY()}/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: { ...(init?.method ? { 'Content-Type': 'application/json' } : {}), 'X-Workspace-DB-Token': token, ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HeyGen HTTP ${response.status}: ${data?.error?.message || data?.message || data?.error || 'request failed'}`);
  return data;
}

// HeyGen caps list page sizes at 50 — a larger `limit` is rejected with
// HTTP 400 "Input should be less than or equal to 50". Page with next_token
// until the API stops returning one, accumulating the full catalog.
const HEYGEN_PAGE_LIMIT = 50;
const HEYGEN_MAX_PAGES = 200;

async function collectHeygenPages(path: string, extract: (data: any) => any[]): Promise<any[]> {
  const items: any[] = [];
  const seenTokens = new Set<string>();
  let next = '';
  for (let page = 0; page < HEYGEN_MAX_PAGES; page += 1) {
    const joiner = path.includes('?') ? '&' : '?';
    const suffix = next ? `&next_token=${encodeURIComponent(next)}` : '';
    const data = await heygen(`${path}${joiner}limit=${HEYGEN_PAGE_LIMIT}${suffix}`);
    const pageItems = extract(data) || [];
    items.push(...pageItems);
    next = String(
      data?.next_token || data?.nextToken || data?.page_token || data?.next_page_token ||
      data?.data?.next_token || data?.data?.nextToken || data?.data?.page_token || data?.data?.next_page_token || '',
    );
    const hasMore = data?.has_more ?? data?.hasMore ?? data?.data?.has_more ?? data?.data?.hasMore;
    if (!next || seenTokens.has(next) || hasMore === false || !pageItems.length) break;
    seenTokens.add(next);
  }
  return items;
}

let avatarCache: ForgeAvatar[] | null = null;
export async function loadAvatars(forceReload = false): Promise<ForgeAvatar[]> {
  if (forceReload) avatarCache = null;
  if (avatarCache) return avatarCache;
  const raw: any[] = [];
  let lastError: unknown = null;
  try {
    raw.push(...await collectHeygenPages('v2/avatars', (d) => [
      ...(d?.data?.avatars || d?.avatars || []),
      ...(d?.data?.talking_photos || []),
    ]));
  } catch (error) {
    lastError = error;
    try {
      const flat = await heygen('v2/avatars');
      raw.push(...(flat?.data?.avatars || flat?.avatars || []), ...(flat?.data?.talking_photos || []));
    } catch (flatError) {
      lastError = flatError;
    }
  }
  try {
    raw.push(...await collectHeygenPages('v3/avatars/looks', (d) => (
      Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.looks) ? d.data.looks : []
    )));
  } catch (error) {
    lastError = error;
  }
  if (!raw.length && lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  const mapped = raw.map((a): ForgeAvatar | null => {
    const id = String(a?.avatar_id || a?.id || '');
    if (!id) return null;
    const labels = a?.labels || {};
    const tags = Array.isArray(a?.tags) ? a.tags.map(String) : [];
    const listField = (...values: any[]): string[] => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map(String).map((value) => value.trim()).filter(Boolean))];
    const gestures = listField(a?.gestures, a?.supported_gestures, a?.gesture_types, labels?.gestures);
    const emotions = listField(a?.emotions, a?.supported_emotions, a?.emotion_types, labels?.emotions);
    const supportedEngines = listField(a?.supported_api_engines, a?.supportedApiEngines);
    const text = [a?.avatar_name, a?.look_name, a?.name, a?.description, a?.ethnicity, a?.region, a?.category, a?.avatar_type, labels.ethnicity, labels.region, ...tags].filter(Boolean).join(' ').toLowerCase();
    const indian = /\b(india|indian|south[ -]?asian|desi|hindi|punjabi|bengali|tamil|telugu|malayalam|marathi)\b/.test(text);
    return {
      id, name: String(a?.avatar_name || a?.look_name || a?.name || `Avatar ${id.slice(0, 8)}`),
      gender: String(a?.gender || labels.gender || 'unspecified').toLowerCase(),
      age: String(a?.age || labels.age || 'unspecified').toLowerCase(),
      region: indian ? 'indian-south-asian' : String(a?.region || labels.region || a?.ethnicity || labels.ethnicity || 'other').toLowerCase(),
      ethnicity: String(a?.ethnicity || labels.ethnicity || (indian ? 'South Asian' : '')),
      style: String(a?.style || labels.style || a?.avatar_style || a?.avatar_type || 'standard').toLowerCase(),
      category: String(a?.category || a?.avatar_type || a?.type || (a?.is_public === false ? 'account' : 'public')).toLowerCase(),
      description: String(a?.description || labels.description || ''), tags: indian ? [...tags, 'Indian', 'South Asian'] : tags,
      previewImage: String(a?.preview_image_url || a?.preview_image || a?.image_url || a?.thumbnail_url || ''),
      previewVideo: String(a?.preview_video_url || a?.preview_video || a?.video_url || ''),
      gestures,
      emotions,
      supportedEngines,
    };
  }).filter(Boolean) as ForgeAvatar[];
  const deduped = [...new Map(mapped.reverse().map((avatar) => [avatar.id, avatar])).values()];
  if (!deduped.length) throw new Error('HeyGen returned an empty avatar catalog.');
  avatarCache = deduped.sort((a, b) => a.name.localeCompare(b.name));
  return avatarCache;
}

/**
 * Bundle HeyGen avatars by presenter name — "Abigail (office)" and
 * "Abigail (standing)" group under one "Abigail" row, so the gallery shows one
 * sideways-scrolling row of looks per person.
 */
export function bundleAvatars(avatars: ForgeAvatar[]): ForgeAvatarBundle[] {
  const groups = new Map<string, ForgeAvatarBundle>();
  for (const a of avatars) {
    const first = a.name.split(/[\s_(\-]/)[0] || a.name;
    const key = first.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.looks.push(a);
    else groups.set(key, { key, name: first, looks: [a] });
  }
  return [...groups.values()].sort((x, y) => y.looks.length - x.looks.length || x.name.localeCompare(y.name));
}

