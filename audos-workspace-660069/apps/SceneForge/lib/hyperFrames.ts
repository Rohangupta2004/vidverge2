// Stat / feature cards for the Motion Graphics Editor.
//
// WHY EACH CARD RENDERS ON ITS OWN. The old approach built one enormous
// template JSON describing every card in the film and handed it to the
// renderer in a single request, which is exactly what ran into the payload
// limit. Here every card is an independent render keyed by its own variables:
// one card is one small request, and the finished clip is composited at the
// timestamp the customer chose. Adding a tenth card costs the same as the
// first.
//
// TWO RENDER PATHS, both real:
//   1. HeyGen HyperFrames (`POST v3/hyperframes/renders` through the
//      workspace's HeyGen proxy) returns an animated MP4 clip. Since the
//      HeyGen suite landed, that path renders a real uploaded HTML/CSS/JS
//      bundle (lib/hyperFrameBundles, uploaded once and re-rendered with
//      injected variables) rather than naming a template id HeyGen was never
//      given — see lib/heygenFrames.
//   2. When that endpoint is not available on the account, the SAME card is
//      drawn by lib/motionPlates and composited as a timed full-frame plate.
// The editor records which path produced each card and says so on the card,
// so a static card is never presented as an animated one.
import { renderFrame } from './heygenFrames';
import { renderCardPlate } from './motionPlates';
import type { AspectRatio, BrandKit, CardTemplateId } from './motionEditor';

export interface CardField {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
}

export interface CardTemplate {
  id: CardTemplateId;
  name: string;
  blurb: string;
  fields: CardField[];
  defaultDuration: number;
}

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    id: 'feature-card',
    name: 'Feature Card',
    blurb: 'One capability, stated plainly, with a supporting line.',
    defaultDuration: 4,
    fields: [
      { key: 'title', label: 'Feature', placeholder: 'Renders in one pass' },
      { key: 'body', label: 'Supporting line', placeholder: 'No timeline wrangling, no exports to chase.', multiline: true },
    ],
  },
  {
    id: 'stat-counter',
    name: 'Stat Counter',
    blurb: 'A single number the viewer should remember.',
    defaultDuration: 3,
    fields: [
      { key: 'value', label: 'Number', placeholder: '3.4x' },
      { key: 'label', label: 'What it measures', placeholder: 'faster than editing by hand' },
    ],
  },
  {
    id: 'product-cta',
    name: 'Product CTA',
    blurb: 'The ask: one line and one button.',
    defaultDuration: 4,
    fields: [
      { key: 'title', label: 'Offer', placeholder: 'Start free today' },
      { key: 'body', label: 'Detail', placeholder: 'No card needed for the first three videos.', multiline: true },
      { key: 'cta', label: 'Button text', placeholder: 'Try it free' },
    ],
  },
  {
    id: 'quote-card',
    name: 'Quote Card',
    blurb: 'A customer sentence in their own words.',
    defaultDuration: 4.5,
    fields: [
      { key: 'quote', label: 'Quote', placeholder: 'We shipped a week of content in an afternoon.', multiline: true },
      { key: 'attribution', label: 'Who said it', placeholder: 'Priya, Head of Growth' },
    ],
  },
];

export function templateOf(id: CardTemplateId): CardTemplate {
  return CARD_TEMPLATES.find((template) => template.id === id) || CARD_TEMPLATES[0];
}

export function emptyVariables(id: CardTemplateId): Record<string, string> {
  const out: Record<string, string> = {};
  templateOf(id).fields.forEach((field) => { out[field.key] = ''; });
  return out;
}

export function cardSummary(id: CardTemplateId, variables: Record<string, string>): string {
  const first = templateOf(id).fields[0];
  const value = String(variables?.[first.key] || '').trim();
  return value || templateOf(id).name;
}

export type CardRenderPath = 'hyperframes' | 'plate';

export interface CardRenderResult {
  clipUrl: string;
  renderedBy: CardRenderPath;
  /** Set when HyperFrames was tried and declined, so the UI can be honest. */
  note: string;
}

/**
 * Whether this account's HeyGen plan answers the HyperFrames render endpoint.
 * Resolved by the first real attempt and remembered for the session, so a
 * second card does not pay for another rejected request.
 */
let hyperFramesSupported: boolean | null = null;
export function hyperFramesState(): boolean | null { return hyperFramesSupported; }

// The editor's card fields were named before the HTML bundles existed, so the
// two vocabularies differ (`title` here is `headline` in the Feature Card
// bundle). Renaming the editor's keys would orphan every card already saved in
// a project, so the editor keeps its names and they are TRANSLATED here. Both
// spellings are sent: the bundle reads the ones it knows and ignores the rest.
const BUNDLE_ALIASES: Record<CardTemplateId, Record<string, string>> = {
  'feature-card': { title: 'headline', body: 'bullet1' },
  'stat-counter': { value: 'stat', label: 'label' },
  'product-cta': { title: 'product', body: 'tagline', cta: 'cta' },
  'quote-card': { quote: 'quote', attribution: 'author' },
};

function bundleVariables(template: CardTemplateId, variables: Record<string, string>): Record<string, string> {
  const aliases = BUNDLE_ALIASES[template] || {};
  const out: Record<string, string> = { ...variables };
  Object.entries(aliases).forEach(([editorKey, bundleKey]) => {
    const value = String(variables?.[editorKey] ?? '').trim();
    if (value && !out[bundleKey]) out[bundleKey] = value;
  });
  return out;
}

async function renderWithHyperFrames(template: CardTemplateId, variables: Record<string, string>, aspect: AspectRatio, durationSec: number, kit: BrandKit): Promise<string> {
  const render = await renderFrame(template, bundleVariables(template, variables), kit, aspect, durationSec);
  return render.clipUrl;
}

/**
 * Render ONE card and return something the compositor can actually use.
 * HyperFrames is tried first; its absence is not an error the customer has to
 * solve, so the plate path takes over and the card still ships.
 */
export async function renderCard(
  template: CardTemplateId,
  variables: Record<string, string>,
  kit: BrandKit,
  aspect: AspectRatio,
  durationSec: number,
): Promise<CardRenderResult> {
  if (hyperFramesSupported !== false) {
    try {
      const clipUrl = await renderWithHyperFrames(template, variables, aspect, durationSec, kit);
      hyperFramesSupported = true;
      return { clipUrl, renderedBy: 'hyperframes', note: '' };
    } catch (e: any) {
      const message = String(e?.message || e);
      // A schema/availability rejection means this account has no HyperFrames
      // endpoint; a transient failure should not disable the path for good.
      // 'not available on this ... plan' is what lib/heygenApi's capability
      // gate reports once it has learned the endpoint is absent, so it has to
      // be recognised here too or every card re-reports it as a hiccup.
      const unavailable = /not found|404|unsupported|not permitted|not available|no such|invalid url|unknown endpoint|400/i.test(message);
      if (unavailable) hyperFramesSupported = false;
      const plateUrl = await renderCardPlate(template, variables, kit, aspect);
      return {
        clipUrl: plateUrl,
        renderedBy: 'plate',
        note: unavailable
          ? 'HeyGen HyperFrames is not available on this account, so the card was rendered as a styled still and will be composited at its timestamp.'
          : `HyperFrames did not answer (${message.slice(0, 120)}), so the card was rendered as a styled still instead.`,
      };
    }
  }
  const plateUrl = await renderCardPlate(template, variables, kit, aspect);
  return { clipUrl: plateUrl, renderedBy: 'plate', note: 'Rendered as a styled still — HeyGen HyperFrames is not available on this account.' };
}
