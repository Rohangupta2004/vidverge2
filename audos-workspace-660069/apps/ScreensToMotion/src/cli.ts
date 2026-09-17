/**
 * CLI — screenshots + brief → mp4.
 *
 * This is the headless entry point for the same pipeline the Screens to
 * Motion app runs: ingest → analyse → plan → render. It targets the Audos
 * platform endpoints, so it needs a browser-injected workspace token when run
 * inside the space. From Node it accepts the same inputs and prints the exact
 * fetch sequence; the render itself is queued through the platform's Remotion
 * service, which is the production path (there is no local `npx remotion
 * render` inside the workspace — the platform renders the emitted
 * composition server-side and returns a durable MP4 URL).
 *
 * Usage (from the app's dev console or a founder script with a token):
 *   runPipeline({ files, brief, token })            — full pipeline
 *   runFixtureRender({ urlA, urlB, token })         — T1: fixture plan → mp4
 */
import { buildCompositionSource } from './render/composition';
import { FIXTURE_PLAN, FIXTURE_ANALYSES, fixtureImages } from './render/fixturePlan';
import { buildMixFixture, verifyMixFixture, type MixFixtureInput, type MixVerification } from './render/mixFixture';
import type { VideoPlan, ScreenAnalysis, IngestedScreen, CompositionProps } from './types';

const FPS = 30;

export interface RenderHandle { operationId: string; }

export async function submitRender(
  props: CompositionProps,
  token: string,
  workspaceId: string,
  base = '',
): Promise<RenderHandle> {
  const durationInFrames = Math.max(60, props.plan.scenes.reduce((sum, s) => sum + s.duration, 0));
  const response = await fetch(`${base}/api/render/remotion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      workspaceId,
      compositionTsx: buildCompositionSource(),
      props,
      durationInFrames,
      fps: FPS,
      width: props.plan.meta.width,
      height: props.plan.meta.height,
    }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 402) throw new Error('The workspace wallet needs funds before this video can be rendered.');
  if (!response.ok || !body?.operationId) {
    throw new Error(body?.error || `The render could not be started (${response.status}).`);
  }
  return { operationId: String(body.operationId) };
}

export async function pollRender(
  handle: RenderHandle,
  token: string,
  onProgress?: (status: string, progress: number) => void,
  base = '',
): Promise<string> {
  for (let attempt = 0; attempt < 240; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await fetch(`${base}/api/render/remotion/${encodeURIComponent(handle.operationId)}`, {
      headers: { 'X-Workspace-DB-Token': token },
    });
    const status = await response.json().catch(() => null);
    if (!response.ok) throw new Error(status?.error || `Could not check the render (${response.status}).`);
    const state = String(status?.status || '').toLowerCase();
    onProgress?.(state, Number(status?.progress) || 0);
    const url = status?.videoUrl || status?.downloadUrl || status?.video_url || status?.download_url;
    if ((state === 'complete' || state === 'completed') && url) return String(url);
    if (state === 'failed' || state === 'error') throw new Error(status?.error || 'The Remotion render failed.');
  }
  throw new Error('The render is taking longer than expected.');
}

/** T1 verification: hand-written fixture plan → platform render → MP4 URL. */
export async function runFixtureRender(input: { urlA: string; urlB: string; token: string; workspaceId: string; base?: string }): Promise<string> {
  const props: CompositionProps = {
    plan: FIXTURE_PLAN,
    analyses: FIXTURE_ANALYSES,
    images: fixtureImages(input.urlA, input.urlB),
  };
  const handle = await submitRender(props, input.token, input.workspaceId, input.base || '');
  return await pollRender(handle, input.token, undefined, input.base || '');
}

/**
 * T6 verification (Phase 2 "done when"): a mixed fixture — two clips, four
 * screenshots, one music bed — is checked against the render-independent
 * acceptance criteria (every cut within ±1 frame of a beat, integer frame
 * mapping on every clip, no looping, carry at every footage boundary), then
 * rendered through the platform. The gate half of the acceptance test is
 * runGateSelfTest in ./clips/gate (needs a clip that deliberately shows UI).
 */
export async function runMixFixtureRender(
  input: MixFixtureInput & { token: string; workspaceId: string; base?: string },
): Promise<{ videoUrl: string; verification: MixVerification }> {
  const props = buildMixFixture(input);
  const verification = verifyMixFixture(props);
  if (!verification.ok) {
    throw new Error(`The mixed fixture failed acceptance checks:\n${verification.failures.join('\n')}`);
  }
  const handle = await submitRender(props, input.token, input.workspaceId, input.base || '');
  const videoUrl = await pollRender(handle, input.token, undefined, input.base || '');
  return { videoUrl, verification };
}

/** End-to-end driver used by the app (T9). Stage functions are injected so the
 * CLI stays platform-agnostic while the app wires the browser implementations. */
export async function runPipeline(input: {
  ingest: () => Promise<{ screens: IngestedScreen[]; analyses: ScreenAnalysis[]; brief: string }>;
  plan: (brief: string, analyses: ScreenAnalysis[], screens: IngestedScreen[]) => Promise<VideoPlan>;
  token: string;
  workspaceId: string;
  onProgress?: (stage: string, detail: string) => void;
}): Promise<{ videoUrl: string; plan: VideoPlan }> {
  input.onProgress?.('ingest', 'Validating and normalising screenshots…');
  const { screens, analyses, brief } = await input.ingest();
  input.onProgress?.('plan', 'Planning the motion design…');
  const plan = await input.plan(brief, analyses, screens);
  input.onProgress?.('render', 'Rendering the composition…');
  const handle = await submitRender({ plan, images: screens, analyses }, input.token, input.workspaceId);
  const videoUrl = await pollRender(handle, input.token, (state, progress) => {
    input.onProgress?.('render', `Rendering — ${state}${progress ? ` ${Math.round(progress * 100)}%` : ''}`);
  });
  return { videoUrl, plan };
}
