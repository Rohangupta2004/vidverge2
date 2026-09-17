// Direct HTTP to model APIs (PRD runtime constraint 1: no MCP — shell, files,
// and direct HTTP only). Keys come from the environment the orchestrator
// provides: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY.
// Model choices follow the PRD: Opus 5 plans, Sonnet builds.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const PLAN_MODEL = process.env.TRACKB_PLAN_MODEL || 'claude-opus-5';
export const BUILD_MODEL = process.env.TRACKB_BUILD_MODEL || 'claude-sonnet-5';
export const QA_MODEL = process.env.TRACKB_QA_MODEL || 'claude-sonnet-5';

function requireKey(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. The orchestrator must provide it in the environment; this module never reads credentials from anywhere else.`);
  return v;
}

export async function anthropicMessage({ model, system, messages, maxTokens = 16000, temperature = 0.6 }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': requireKey('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, system, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`Anthropic ${model} HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export async function anthropicVision({ model = QA_MODEL, system, prompt, imagePaths, maxTokens = 4000 }) {
  const fs = await import('node:fs');
  const content = imagePaths.map((p) => ({
    type: 'image',
    source: { type: 'base64', media_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(p).toString('base64') },
  }));
  content.push({ type: 'text', text: prompt });
  return anthropicMessage({ model, system, messages: [{ role: 'user', content }], maxTokens, temperature: 0 });
}

export async function generateImageOpenAI({ prompt, size = '1536x1024' }) {
  const res = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${requireKey('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.TRACKB_IMAGE_MODEL_OPENAI || 'gpt-image-1', prompt, size, n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI images HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI images returned no b64_json payload');
  return Buffer.from(b64, 'base64');
}

export async function generateImageGemini({ prompt }) {
  const model = process.env.TRACKB_IMAGE_MODEL_GEMINI || 'gemini-2.5-flash-image';
  const res = await fetch(`${GEMINI_URL_BASE}/${model}:generateContent?key=${requireKey('GEMINI_API_KEY')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('Gemini returned no inline image data');
  return Buffer.from(part.inlineData.data, 'base64');
}

/** Generate an image with Gemini first, falling back to OpenAI (PRD resolution order 3). */
export async function generateImage({ prompt }) {
  const errors = [];
  if (process.env.GEMINI_API_KEY) {
    try {
      return { bytes: await generateImageGemini({ prompt }), model: 'gemini' };
    } catch (err) { errors.push(err.message); }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return { bytes: await generateImageOpenAI({ prompt }), model: 'openai' };
    } catch (err) { errors.push(err.message); }
  }
  throw new Error(`image generation failed (${errors.join(' | ') || 'no GEMINI_API_KEY or OPENAI_API_KEY in environment'})`);
}

export function extractJson(text) {
  // Models sometimes wrap JSON in fences; extract the first JSON object/array.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found in model response');
  return JSON.parse(candidate.slice(start));
}
