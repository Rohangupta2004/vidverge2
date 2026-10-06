// The four HyperFrames motion-graphic bundles, authored as HTML/CSS/JS.
//
// HOW HYPERFRAMES WORKS, AND WHY THESE BUNDLES LOOK LIKE THIS. A HyperFrame
// is a zipped web page that HeyGen loads in a headless browser and records as
// an MP4. The spec's key economy is that VARIABLES ARE INJECTED AT RENDER
// TIME: the zip is uploaded ONCE and then re-rendered with different text and
// colours forever. So nothing in these bundles is baked — every piece of copy
// and every colour is read from the injected variables at runtime, which is
// what makes one upload serve every card in every film.
//
// Because the injection channel is not documented in the platform catalog,
// `readVariables()` in each bundle checks every plausible source in turn
// (globals HeyGen may define, the query string) and falls back to its own
// defaults. A bundle therefore renders something correct no matter which
// channel the account actually uses, instead of recording a page full of
// empty strings.
//
// The animation is driven by CSS keyframes against a fixed timeline and the
// page signals readiness on `window.__hyperframeReady`, so the recorder
// captures a deterministic clip rather than whatever happened to be painted.
import { createZip, bundleFingerprint, type ZipEntry } from './zipWriter';
import type { CardTemplateId } from './motionEditor';

/** Variables every bundle understands, on top of its own copy fields. */
export interface FrameBrandVariables {
  primary: string;
  accent: string;
  background: string;
  text: string;
  font: string;
  logo: string;
}

export const BRAND_VARIABLE_KEYS: (keyof FrameBrandVariables)[] = ['primary', 'accent', 'background', 'text', 'font', 'logo'];

// ——— Shared bundle parts ———

// One runtime for all four bundles: variable resolution, brand application
// and the readiness signal. Kept identical across bundles so a fix lands
// everywhere at once.
const RUNTIME_JS = [
  '(function () {',
  '  function fromQuery() {',
  '    try {',
  '      var out = {};',
  '      new URLSearchParams(window.location.search).forEach(function (value, key) { out[key] = value; });',
  '      return out;',
  '    } catch (e) { return {}; }',
  '  }',
  '  function merge(target, source) {',
  '    if (!source || typeof source !== "object") return target;',
  '    Object.keys(source).forEach(function (key) {',
  '      var value = source[key];',
  '      if (value !== null && value !== undefined && value !== "") target[key] = value;',
  '    });',
  '    return target;',
  '  }',
  '  // Checked in ascending order of authority: later sources win, so an',
  '  // explicitly injected global beats a bundled default.',
  '  window.readVariables = function (defaults) {',
  '    var out = merge({}, defaults || {});',
  '    merge(out, window.HYPERFRAME_DEFAULTS);',
  '    merge(out, fromQuery());',
  '    merge(out, window.variables);',
  '    merge(out, window.VARIABLES);',
  '    merge(out, window.HYPERFRAMES_VARIABLES);',
  '    merge(out, window.HYPERFRAME_VARIABLES);',
  '    merge(out, window.__HYPERFRAME__ && window.__HYPERFRAME__.variables);',
  '    merge(out, window.hyperframe && window.hyperframe.variables);',
  '    return out;',
  '  };',
  '  window.applyBrand = function (vars) {',
  '    var root = document.documentElement.style;',
  '    root.setProperty("--primary", vars.primary || "#6366f1");',
  '    root.setProperty("--accent", vars.accent || "#8b5cf6");',
  '    root.setProperty("--bg", vars.background || "#0b1022");',
  '    root.setProperty("--fg", vars.text || "#ffffff");',
  '    root.setProperty("--font", vars.font || "Inter, system-ui, -apple-system, Segoe UI, sans-serif");',
  '  };',
  '  window.mountLogo = function (vars) {',
  '    var slot = document.getElementById("logo");',
  '    if (!slot) return;',
  '    if (vars.logo) {',
  '      var img = document.createElement("img");',
  '      img.src = vars.logo;',
  '      img.alt = "";',
  '      slot.appendChild(img);',
  '    } else {',
  '      slot.remove();',
  '    }',
  '  };',
  '  // The recorder waits for this flag, so a clip never starts mid-layout.',
  '  window.signalReady = function () {',
  '    requestAnimationFrame(function () {',
  '      requestAnimationFrame(function () { window.__hyperframeReady = true; document.body.setAttribute("data-ready", "1"); });',
  '    });',
  '  };',
  '})();',
  '',
].join('\n');

const BASE_CSS = [
  '*, *::before, *::after { box-sizing: border-box; }',
  'html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }',
  'body {',
  '  font-family: var(--font);',
  '  color: var(--fg);',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  /* Transparent by default so a card can be composited OVER the presenter;',
  '     a bundle that wants a filled frame sets .filled on its stage. */',
  '  background: transparent;',
  '}',
  '.stage { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 7%; }',
  '.stage.filled { background: radial-gradient(120% 90% at 10% 0%, color-mix(in srgb, var(--primary) 32%, var(--bg)), var(--bg) 62%); }',
  '.card {',
  '  position: relative;',
  '  width: 100%;',
  '  border-radius: 28px;',
  '  padding: 7% 7.5%;',
  '  background: color-mix(in srgb, var(--bg) 82%, transparent);',
  '  border: 1px solid color-mix(in srgb, var(--primary) 38%, transparent);',
  '  box-shadow: 0 40px 120px rgba(0, 0, 0, .45);',
  '}',
  '.rule { height: 6px; width: 84px; border-radius: 99px; background: linear-gradient(90deg, var(--primary), var(--accent)); }',
  '#logo { position: absolute; top: 6%; left: 7%; }',
  '#logo img { height: 46px; width: auto; object-fit: contain; }',
  '.in { opacity: 0; animation: rise .62s cubic-bezier(.2, .85, .3, 1) forwards; }',
  '@keyframes rise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }',
  '@keyframes pop { from { opacity: 0; transform: scale(.86); } to { opacity: 1; transform: none; } }',
  '',
].join('\n');

function page(title: string, bodyHtml: string, styles: string, script: string): ZipEntry[] {
  return [
    {
      name: 'index.html',
      text: [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>' + title + '</title>',
        '<link rel="stylesheet" href="styles.css">',
        '</head>',
        '<body>',
        bodyHtml,
        '<script src="runtime.js"></script>',
        '<script src="card.js"></script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    },
    { name: 'styles.css', text: BASE_CSS + '\n' + styles + '\n' },
    { name: 'runtime.js', text: RUNTIME_JS },
    { name: 'card.js', text: script },
  ];
}

export interface FrameField {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
}

export interface FrameTemplate {
  id: CardTemplateId;
  name: string;
  blurb: string;
  fields: FrameField[];
  defaultDuration: number;
  entries: ZipEntry[];
}

// ——— Feature Card: headline + three bullets ———

const FEATURE: FrameTemplate = {
  id: 'feature-card',
  name: 'Feature Card',
  blurb: 'A headline and up to three bullet points on your brand colour.',
  defaultDuration: 5,
  fields: [
    { key: 'headline', label: 'Headline', placeholder: 'Everything in one pass' },
    { key: 'bullet1', label: 'Bullet 1', placeholder: 'Script, render and edit together' },
    { key: 'bullet2', label: 'Bullet 2', placeholder: 'One character across every scene' },
    { key: 'bullet3', label: 'Bullet 3', placeholder: 'Export in 175 languages' },
  ],
  entries: page(
    'Feature Card',
    [
      '<div class="stage filled">',
      '  <div class="card">',
      '    <div id="logo"></div>',
      '    <div class="rule in" style="animation-delay:.05s"></div>',
      '    <h1 id="headline" class="in" style="animation-delay:.14s"></h1>',
      '    <ul id="bullets"></ul>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      'h1 { font-size: 6.4vmin; line-height: 1.08; letter-spacing: -.02em; margin: 5% 0 0; font-weight: 800; }',
      'ul { list-style: none; margin: 6% 0 0; padding: 0; display: grid; gap: 3.4%; }',
      'li { display: flex; align-items: flex-start; gap: 3%; font-size: 3.5vmin; line-height: 1.38; opacity: 0; animation: rise .55s cubic-bezier(.2,.85,.3,1) forwards; }',
      'li .dot { flex: 0 0 auto; margin-top: .55em; height: 11px; width: 11px; border-radius: 99px; background: linear-gradient(135deg, var(--primary), var(--accent)); }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    headline: "Everything in one pass",',
      '    bullet1: "", bullet2: "", bullet3: "",',
      '    primary: "#6366f1", accent: "#8b5cf6", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("headline").textContent = vars.headline || "";',
      '  var list = document.getElementById("bullets");',
      '  // Only bullets that were actually filled in are rendered, so a',
      '  // two-point card does not record an empty third row.',
      '  ["bullet1", "bullet2", "bullet3"].forEach(function (key, index) {',
      '    var text = (vars[key] || "").trim();',
      '    if (!text) return;',
      '    var li = document.createElement("li");',
      '    li.style.animationDelay = (0.34 + index * 0.16) + "s";',
      '    var dot = document.createElement("span");',
      '    dot.className = "dot";',
      '    var label = document.createElement("span");',
      '    label.textContent = text;',
      '    li.appendChild(dot);',
      '    li.appendChild(label);',
      '    list.appendChild(li);',
      '  });',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

// ——— Stat Counter: a number that counts up ———

const STAT: FrameTemplate = {
  id: 'stat-counter',
  name: 'Stat Counter',
  blurb: 'One number, counted up on screen, with a label underneath.',
  defaultDuration: 4,
  fields: [
    { key: 'stat', label: 'Number', placeholder: '10,000' },
    { key: 'label', label: 'What it measures', placeholder: 'videos shipped this month' },
    { key: 'prefix', label: 'Prefix (optional)', placeholder: '$' },
    { key: 'suffix', label: 'Suffix (optional)', placeholder: '+' },
  ],
  entries: page(
    'Stat Counter',
    [
      '<div class="stage filled">',
      '  <div class="card" style="text-align:center">',
      '    <div id="logo"></div>',
      '    <div id="stat" class="in"></div>',
      '    <div id="label" class="in" style="animation-delay:.42s"></div>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      '#stat { font-size: 17vmin; font-weight: 900; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums;',
      '  background: linear-gradient(135deg, var(--primary), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }',
      '#label { margin-top: 4%; font-size: 3.9vmin; line-height: 1.34; color: color-mix(in srgb, var(--fg) 76%, transparent); }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    stat: "10,000", label: "videos shipped this month", prefix: "", suffix: "",',
      '    primary: "#6366f1", accent: "#8b5cf6", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("label").textContent = vars.label || "";',
      '  var slot = document.getElementById("stat");',
      '  var raw = String(vars.stat == null ? "" : vars.stat).trim();',
      '  // The count-up only runs on a value that IS a number. "3.4x" or',
      '  // "Half" is shown as written rather than mangled into a tween.',
      '  var digits = raw.replace(/,/g, "");',
      '  var target = parseFloat(digits);',
      '  var numeric = /^-?[0-9]+(\\.[0-9]+)?$/.test(digits) && isFinite(target);',
      '  var decimals = numeric && digits.indexOf(".") >= 0 ? digits.split(".")[1].length : 0;',
      '  var grouped = raw.indexOf(",") >= 0;',
      '  function render(value) {',
      '    var text = numeric',
      '      ? (grouped ? value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })',
      '                 : value.toFixed(decimals))',
      '      : raw;',
      '    slot.textContent = (vars.prefix || "") + text + (vars.suffix || "");',
      '  }',
      '  if (!numeric) { render(0); window.signalReady(); return; }',
      '  var duration = 1500;',
      '  var started = null;',
      '  function frame(now) {',
      '    if (started === null) started = now;',
      '    var progress = Math.min(1, (now - started) / duration);',
      '    // Ease-out cubic: fast first, settling on the final figure.',
      '    render(target * (1 - Math.pow(1 - progress, 3)));',
      '    if (progress < 1) requestAnimationFrame(frame);',
      '  }',
      '  render(0);',
      '  window.signalReady();',
      '  requestAnimationFrame(frame);',
      '})();',
      '',
    ].join('\n'),
  ),
};

// ——— Product CTA ———

const CTA: FrameTemplate = {
  id: 'product-cta',
  name: 'Product CTA',
  blurb: 'Product name, one-line tagline and a call-to-action button.',
  defaultDuration: 4.5,
  fields: [
    { key: 'product', label: 'Product name', placeholder: 'SceneForge' },
    { key: 'tagline', label: 'Tagline', placeholder: 'Your whole video, from one brief.' },
    { key: 'cta', label: 'Button text', placeholder: 'Start free' },
    { key: 'url', label: 'Shown under the button', placeholder: 'sceneforge.app' },
  ],
  entries: page(
    'Product CTA',
    [
      '<div class="stage filled">',
      '  <div class="card" style="text-align:center">',
      '    <div id="logo"></div>',
      '    <h1 id="product" class="in"></h1>',
      '    <p id="tagline" class="in" style="animation-delay:.2s"></p>',
      '    <div id="cta" class="btn"></div>',
      '    <div id="url" class="in" style="animation-delay:.62s"></div>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      'h1 { font-size: 8vmin; font-weight: 900; letter-spacing: -.03em; margin: 4% 0 0; line-height: 1.04; }',
      'p { font-size: 4vmin; line-height: 1.36; margin: 4% 0 0; color: color-mix(in srgb, var(--fg) 78%, transparent); }',
      '.btn { display: inline-block; margin-top: 7%; padding: 2.6% 7%; border-radius: 999px; font-size: 3.7vmin; font-weight: 800;',
      '  color: #fff; background: linear-gradient(135deg, var(--primary), var(--accent));',
      '  box-shadow: 0 18px 50px color-mix(in srgb, var(--primary) 45%, transparent);',
      '  opacity: 0; animation: pop .5s cubic-bezier(.2,.9,.3,1) .42s forwards; }',
      '#url { margin-top: 4%; font-size: 2.9vmin; letter-spacing: .04em; color: color-mix(in srgb, var(--fg) 58%, transparent); }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    product: "SceneForge", tagline: "", cta: "Start free", url: "",',
      '    primary: "#6366f1", accent: "#8b5cf6", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("product").textContent = vars.product || "";',
      '  var tagline = document.getElementById("tagline");',
      '  var button = document.getElementById("cta");',
      '  var url = document.getElementById("url");',
      '  // Each optional element is removed rather than left blank, so the',
      '  // card stays vertically balanced whichever fields were filled in.',
      '  if ((vars.tagline || "").trim()) tagline.textContent = vars.tagline; else tagline.remove();',
      '  if ((vars.cta || "").trim()) button.textContent = vars.cta; else button.remove();',
      '  if ((vars.url || "").trim()) url.textContent = vars.url; else url.remove();',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

// ——— Quote Card ———

const QUOTE: FrameTemplate = {
  id: 'quote-card',
  name: 'Quote Card',
  blurb: 'A customer testimonial with their name and your logo.',
  defaultDuration: 5,
  fields: [
    { key: 'quote', label: 'Quote', placeholder: 'We shipped a week of content in an afternoon.', multiline: true },
    { key: 'author', label: 'Who said it', placeholder: 'Priya Nair' },
    { key: 'role', label: 'Their role (optional)', placeholder: 'Head of Growth, Northwind' },
  ],
  entries: page(
    'Quote Card',
    [
      '<div class="stage filled">',
      '  <div class="card">',
      '    <div id="logo"></div>',
      '    <div class="mark in">&ldquo;</div>',
      '    <blockquote id="quote" class="in" style="animation-delay:.16s"></blockquote>',
      '    <div class="who in" style="animation-delay:.42s">',
      '      <span class="bar"></span>',
      '      <div><div id="author"></div><div id="role"></div></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      '.mark { font-size: 14vmin; line-height: .6; font-weight: 900; color: color-mix(in srgb, var(--primary) 70%, transparent); height: 7vmin; }',
      'blockquote { margin: 3% 0 0; font-size: 5vmin; line-height: 1.28; font-weight: 600; letter-spacing: -.015em; }',
      '.who { margin-top: 7%; display: flex; align-items: center; gap: 3.5%; }',
      '.who .bar { flex: 0 0 auto; width: 6px; height: 7.4vmin; border-radius: 99px; background: linear-gradient(180deg, var(--primary), var(--accent)); }',
      '#author { font-size: 3.4vmin; font-weight: 800; }',
      '#role { font-size: 2.8vmin; margin-top: .4em; color: color-mix(in srgb, var(--fg) 62%, transparent); }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    quote: "", author: "", role: "",',
      '    primary: "#6366f1", accent: "#8b5cf6", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("quote").textContent = vars.quote || "";',
      '  document.getElementById("author").textContent = vars.author || "";',
      '  var role = document.getElementById("role");',
      '  if ((vars.role || "").trim()) role.textContent = vars.role; else role.remove();',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

export const FRAME_TEMPLATES: FrameTemplate[] = [FEATURE, STAT, CTA, QUOTE];

export function frameTemplate(id: CardTemplateId): FrameTemplate {
  return FRAME_TEMPLATES.find((template) => template.id === id) || FEATURE;
}

/** Build the uploadable zip for one template. */
export function bundleZip(id: CardTemplateId): { blob: Blob; fingerprint: string } {
  const template = frameTemplate(id);
  return { blob: createZip(template.entries), fingerprint: bundleFingerprint(template.entries) };
}

/**
 * The cache key for a template's uploaded zip. It includes the bundle's
 * CONTENT fingerprint, so editing a template in this file invalidates the old
 * upload automatically instead of silently re-rendering the previous design.
 */
export function bundleCacheKey(id: CardTemplateId): string {
  const template = frameTemplate(id);
  return 'hyperframe:' + id + ':' + bundleFingerprint(template.entries);
}

export function emptyFrameVariables(id: CardTemplateId): Record<string, string> {
  const out: Record<string, string> = {};
  frameTemplate(id).fields.forEach((field) => { out[field.key] = ''; });
  return out;
}
