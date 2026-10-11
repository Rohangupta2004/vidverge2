/**
 * AUTO-WRITTEN PRESENTER + AD ANGLE.
 *
 * A Runway recipe only ever asks the customer for two things: a picture of the
 * product and a line about what it is. The two creative decisions that used to
 * sit in their own Ads Studio tabs — WHO fronts the ad, and WHY it lands — are
 * written from those two facts here, through the platform OpenAI proxy.
 *
 * Both halves come back in one call and regenerate independently, so re-rolling
 * the angle never disturbs a presenter the customer already likes.
 */

import { workspaceToken } from './aiModels';

export interface AdCharacter {
  name: string;
  appearance: string;
  personality: string;
}

export interface AdAngleIdea {
  /** Short label for the angle, e.g. "The 3pm slump". */
  name: string;
  /** The pain the ad speaks to. */
  pain: string;
  /** ONE spoken opening line. */
  hook: string;
  cta: string;
}

export interface AdPersona {
  character: AdCharacter | null;
  angle: AdAngleIdea | null;
}

export interface ProductBrief {
  productName: string;
  productDescription: string;
}

/** Which half to write. 'both' is the automatic first pass. */
export type PersonaTarget = 'both' | 'character' | 'angle';

/** Balanced tier at chat-speed latency — this is short interactive copy. */
const PERSONA_MODEL = 'gpt-5.6-terra';

/** The presenter's portrait goes through the workspace's shared
 * `vv-image-generate` server function, which owns the platform image route.
 * Browser code never calls an image provider directly.
 *
 * 'auto' rather than 'dall-e-3': probed 30 Sep 2026, a dall-e-3 request answers
 * 200 with a failed job and no image, so the hook silently falls back to the
 * managed OpenAI model anyway. Asking for the managed route directly returns
 * the same picture without the dead provider round-trip. */
const PORTRAIT_MODEL = 'auto';

const PERSONA_SYSTEM = [
  'You cast and position short-form UGC video ads.',
  'From a product you decide (a) the creator who fronts the ad and (b) the angle the ad runs on.',
  'The creator is an ordinary, believable real person: age range, build, hair, face, wardrobe and where they film.',
  'Never a celebrity, never a named brand ambassador, never a fictional or fantasy character.',
  'The angle names the pain it speaks to, ONE spoken opening hook under 14 words (no greeting, no "introducing"),',
  'and a single call to action of at most 8 words.',
  'Never invent a price, a statistic, a review, an award, a medical claim or a guarantee that was not given to you.',
  'Plain spoken English — the hook is read aloud on camera, not printed.',
  'Answer with JSON ONLY, no markdown fence and no commentary.',
].join(' ');

const ANGLE_EXTEND_SYSTEM = [
  'You finish an ad angle the customer started writing themselves.',
  'Their draft is the intent: keep their idea, their voice and any wording they clearly want kept.',
  'Complete only what is unfinished — name the angle, name the pain it speaks to, sharpen their words into ONE spoken hook under 14 words,',
  'and write a call to action of at most 8 words.',
  'Never swap their idea for a different one, and never invent a price, a statistic, a review, an award, a medical claim or a guarantee.',
  'Plain spoken English — the hook is read aloud on camera, not printed.',
  'Answer with JSON ONLY, no markdown fence and no commentary.',
].join(' ');

function answerShape(want: PersonaTarget): string {
  const character = '"character":{"name":"...","appearance":"...","personality":"..."}';
  const angle = '"angle":{"name":"...","pain":"...","hook":"...","cta":"..."}';
  if (want === 'character') return `{${character}}`;
  if (want === 'angle') return `{${angle}}`;
  return `{${character},${angle}}`;
}

export function briefText(brief: ProductBrief): string {
  return [brief.productName, brief.productDescription]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' — ');
}

/**
 * Enough to write from? A real sentence about the product. The writer reads
 * TEXT only — the product image is what the recipe films, not what the caster
 * needs — so a missing image must never block the presenter and angle. The
 * length floor keeps the writer from firing on a half-typed first word.
 */
export function briefReady(_productImage: string, brief: ProductBrief): boolean {
  return briefText(brief).length >= 12;
}

/** Identity of the product the current persona was written for. Text-only:
 * swapping the product image never rewrites a presenter the customer already
 * likes, and casting works before any image is uploaded. */
export function personaSignature(_productImage: string, brief: ProductBrief): string {
  return briefText(brief).toLowerCase();
}

function parsePersona(raw: string): AdPersona {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The writer did not answer with usable JSON.');
  const parsed = JSON.parse(text.slice(start, end + 1));
  const c = parsed && parsed.character;
  const a = parsed && parsed.angle;
  const character: AdCharacter | null = c && (c.name || c.appearance)
    ? {
      name: String(c.name || 'Your presenter').trim(),
      appearance: String(c.appearance || '').trim(),
      personality: String(c.personality || '').trim(),
    }
    : null;
  const angle: AdAngleIdea | null = a && (a.hook || a.name)
    ? {
      name: String(a.name || 'Ad angle').trim(),
      pain: String(a.pain || '').trim(),
      hook: String(a.hook || '').trim(),
      cta: String(a.cta || '').trim(),
    }
    : null;
  if (!character && !angle) throw new Error('The writer returned nothing usable — try again.');
  return { character, angle };
}

/** One call to the platform text proxy. The workspace token is required — the
 * proxy rejects anonymous calls with 401 no_credentials. */
async function proxyChat(system: string, user: string, maxTokens: number): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: PERSONA_MODEL,
      reasoning_effort: 'none',
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data && data.code ? ` [${data.code}]` : '';
    const message = String(
      (data && data.error && data.error.message) || (data && data.error)
      || `The writer could not be reached (HTTP ${res.status}).`,
    );
    throw new Error(`${message}${code}`);
  }
  return String(data?.choices?.[0]?.message?.content || '');
}

/** One proxy call. The workspace token is required — the proxy rejects anonymous calls. */
export async function generateAdPersona(input: { brief: ProductBrief; want?: PersonaTarget }): Promise<AdPersona> {
  const want = input.want || 'both';
  const asked = want === 'character'
    ? 'the creator only'
    : want === 'angle' ? 'the angle only' : 'the creator and the angle';

  const user = [
    `Product: ${briefText(input.brief) || 'an unnamed product'}`,
    '',
    `Write ${asked} for a short-form UGC video ad for this product.`,
    `Answer in exactly this shape: ${answerShape(want)}`,
  ].join('\n');

  return parsePersona(await proxyChat(PERSONA_SYSTEM, user, 900));
}

/**
 * AUTO-EXTEND — finish an angle the customer started writing themselves.
 *
 * The draft is the intent, not a prompt to improve on: the writer completes the
 * parts that are missing (the pain, a tightened spoken hook, a call to action)
 * and leaves their wording alone.
 */
export async function extendAdAngle(input: { draft: string; brief: ProductBrief }): Promise<AdAngleIdea> {
  const draft = String(input.draft || '').trim();
  if (draft.length < 3) throw new Error('Write a few words first — Auto-extend completes your own draft.');

  const user = [
    `Product: ${briefText(input.brief) || 'an unnamed product'}`,
    '',
    'The customer wrote this draft angle in their own words:',
    `"""${draft.slice(0, 5000)}"""`,
    '',
    'Complete it into a full ad angle for a short-form video ad. Keep their idea and their voice.',
    `Answer in exactly this shape: ${answerShape('angle')}`,
  ].join('\n');

  const written = parsePersona(await proxyChat(ANGLE_EXTEND_SYSTEM, user, 700));
  if (!written.angle) throw new Error('The writer could not complete that draft — add a little more and try again.');
  return written.angle;
}

/**
 * The persona as prompt text, for the recipe field that already carries the
 * creative direction and character description downstream.
 */
export function personaConceptLines(persona: AdPersona | null): string[] {
  if (!persona) return [];
  const lines: string[] = [];
  const c = persona.character;
  const a = persona.angle;
  if (c) {
    lines.push(`Presenter: ${c.name}${c.appearance ? ` — ${c.appearance}` : ''}`);
    if (c.personality) lines.push(`On camera they read as ${c.personality}`);
  }
  if (a) {
    if (a.pain) lines.push(`Ad angle — ${a.name}: ${a.pain}`);
    else if (a.name) lines.push(`Ad angle — ${a.name}`);
    if (a.hook) lines.push(`Open on this spoken hook: "${a.hook}"`);
    if (a.cta) lines.push(`Close on: ${a.cta}`);
  }
  return lines.map((line) => (/[.!?"]$/.test(line) ? line : `${line}.`));
}

// ---------------------------------------------------------------------------
// THE PRESENTER'S PORTRAIT
//
// A written description tells the customer who fronts their ad; a picture
// shows them. The still is generated from the SAME description the recipe is
// asked to film, so the two never disagree.
// ---------------------------------------------------------------------------

/** The space id the hook runner is addressed with. Space pages inject it, but
 * the literal id is kept as the last resort so a portrait still draws when the
 * global is missing. */
function spaceAppId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

/** The image brief for a cast presenter — a believable person, not a poster. */
export function presenterPortraitPrompt(character: AdCharacter, brief?: ProductBrief): string {
  const who = [character.appearance, character.personality]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('. ');
  const product = brief ? briefText(brief) : '';
  return [
    'Photorealistic head-and-shoulders portrait of one ordinary, believable person — the creator who fronts a short-form video ad.',
    who ? `The person: ${who}.` : '',
    product ? `They are about to talk about: ${product}.` : '',
    'Shot on a modern phone camera: natural daylight, soft shadows, realistic skin texture, relaxed genuine expression, looking into the lens.',
    'Simple uncluttered real-world background, shallow depth of field.',
    'One person only. No text, no logos, no watermarks, no borders, no collage. Not a celebrity and not a stock-photo smile.',
  ].filter(Boolean).join(' ');
}

/**
 * Draw the cast presenter. Routed through the workspace's shared
 * `vv-image-generate` server function, which owns the platform image route,
 * re-hosts provider data: URLs on durable storage and falls back to the managed
 * OpenAI image model when DALL·E answers with no picture.
 */
export async function generatePresenterPortrait(input: { character: AdCharacter; brief?: ProductBrief }): Promise<string> {
  const appId = spaceAppId();
  if (!appId) throw new Error('Your workspace session is still loading — try again in a moment.');
  const token = workspaceToken();
  const res = await fetch(`/api/hooks/execute/${appId}/vv-image-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Workspace-DB-Token': token } : {}),
    },
    body: JSON.stringify({
      prompt: presenterPortraitPrompt(input.character, input.brief),
      model: PORTRAIT_MODEL,
      aspect: '1:1',
      quality: 'hd',
    }),
  });
  const raw: any = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined
    ? raw.response
    : raw;
  const url = data && data.imageUrl;
  if (!res.ok || typeof url !== 'string' || !url) {
    throw new Error(String(data?.error || `The portrait could not be generated (HTTP ${res.status}).`));
  }
  return url;
}
