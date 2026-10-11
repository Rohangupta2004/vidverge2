// The HyperFrames motion-graphic bundles, authored as HTML/CSS/JS.
//
// Seven of them: the editor's four original cards, plus the three PRODUCT
// primitives SceneForge's own pipeline needs — a step sequence, a UI highlight
// and a comparison table. Those three exist because product graphic beats are
// now rendered by HeyGen as overlay clips rather than drawn as separate Remotion
// layers (lib/productGraphics), and a feature card and a stat counter could not
// express a process, an annotated screenshot or an A-vs-B table.
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
  '    root.setProperty("--primary", vars.primary || "#f59e0b");',
  '    root.setProperty("--accent", vars.accent || "#d97706");',
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
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
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
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
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
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
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
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
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

// ——— Step Sequence: a process, revealed one step at a time ———
//
// The product primitive behind a flowchart beat. Each step reveals in order with
// its connector drawing in behind it, so the viewer reads the process as a
// sequence rather than meeting a finished diagram all at once.

const STEPS: FrameTemplate = {
  id: 'step-sequence',
  name: 'Step Sequence',
  blurb: 'Up to five numbered steps revealing in order, joined by a drawn rail.',
  defaultDuration: 6,
  fields: [
    { key: 'headline', label: 'Headline', placeholder: 'How it works' },
    { key: 'step1', label: 'Step 1', placeholder: 'Write the brief' },
    { key: 'step2', label: 'Step 2', placeholder: 'Approve the storyboard' },
    { key: 'step3', label: 'Step 3', placeholder: 'Render in one pass' },
    { key: 'step4', label: 'Step 4 (optional)', placeholder: '' },
    { key: 'step5', label: 'Step 5 (optional)', placeholder: '' },
  ],
  entries: page(
    'Step Sequence',
    [
      '<div class="stage filled">',
      '  <div class="card">',
      '    <div id="logo"></div>',
      '    <div class="rule in" style="animation-delay:.05s"></div>',
      '    <h1 id="headline" class="in" style="animation-delay:.14s"></h1>',
      '    <ol id="steps"></ol>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      'h1 { font-size: 5.6vmin; line-height: 1.1; letter-spacing: -.02em; margin: 4% 0 0; font-weight: 800; }',
      'ol { list-style: none; margin: 6% 0 0; padding: 0; display: grid; gap: 3%; position: relative; }',
      'li { position: relative; display: flex; align-items: center; gap: 3.4%; font-size: 3.4vmin; line-height: 1.34;',
      '  opacity: 0; animation: rise .5s cubic-bezier(.2,.85,.3,1) forwards; }',
      '.num { flex: 0 0 auto; display: flex; align-items: center; justify-content: center;',
      '  height: 7.2vmin; width: 7.2vmin; border-radius: 99px; font-size: 3.1vmin; font-weight: 900; color: #fff;',
      '  background: linear-gradient(135deg, var(--primary), var(--accent));',
      '  box-shadow: 0 10px 28px color-mix(in srgb, var(--primary) 45%, transparent); }',
      // The rail is drawn per-step rather than as one spine, so a step that was
      // left blank never leaves a connector hanging in mid-air.
      '.rail { position: absolute; left: 3.6vmin; top: -3%; height: 3%; width: 3px; border-radius: 99px;',
      '  background: color-mix(in srgb, var(--primary) 55%, transparent); transform-origin: top;',
      '  transform: scaleY(0); animation: drawRail .4s ease-out forwards; }',
      '@keyframes drawRail { to { transform: scaleY(1); } }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    headline: "How it works",',
      '    step1: "", step2: "", step3: "", step4: "", step5: "",',
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("headline").textContent = vars.headline || "";',
      '  var list = document.getElementById("steps");',
      '  var filled = ["step1", "step2", "step3", "step4", "step5"]',
      '    .map(function (key) { return (vars[key] || "").trim(); })',
      '    .filter(function (text) { return text; });',
      '  filled.forEach(function (text, index) {',
      '    var li = document.createElement("li");',
      '    li.style.animationDelay = (0.34 + index * 0.42) + "s";',
      '    if (index > 0) {',
      '      var rail = document.createElement("span");',
      '      rail.className = "rail";',
      '      rail.style.animationDelay = (0.2 + index * 0.42) + "s";',
      '      li.appendChild(rail);',
      '    }',
      '    var num = document.createElement("span");',
      '    num.className = "num";',
      '    num.textContent = String(index + 1);',
      '    var label = document.createElement("span");',
      '    label.textContent = text;',
      '    li.appendChild(num);',
      '    li.appendChild(label);',
      '    list.appendChild(li);',
      '  });',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

// ——— UI Highlight: a screenshot, zoomed, with the part that matters marked ———
//
// The product primitive behind an annotated-image beat. The screenshot pushes in
// slowly while a highlight box wipes across the region the narration is talking
// about and a label arrives beside it — the two things a Remotion overlay kept
// getting wrong, because the box and the image were composited separately and
// drifted apart.

const UI_HIGHLIGHT: FrameTemplate = {
  id: 'ui-highlight',
  name: 'UI Highlight',
  blurb: 'A product screenshot zooming in, with one region highlighted and labelled.',
  defaultDuration: 5,
  fields: [
    { key: 'image', label: 'Screenshot URL', placeholder: 'https://\u2026/product.png' },
    { key: 'label', label: 'What to point at', placeholder: 'One click to render' },
    { key: 'detail', label: 'Supporting line (optional)', placeholder: 'No timeline, no exports.' },
    { key: 'focusX', label: 'Highlight centre X, 0\u2013100', placeholder: '50' },
    { key: 'focusY', label: 'Highlight centre Y, 0\u2013100', placeholder: '52' },
  ],
  entries: page(
    'UI Highlight',
    [
      '<div class="stage filled">',
      '  <div class="shot">',
      '    <div id="logo"></div>',
      '    <img id="image" alt="">',
      '    <span id="box"></span>',
      '    <div id="callout">',
      '      <div id="label"></div>',
      '      <div id="detail"></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      '.shot { position: relative; width: 100%; height: 100%; border-radius: 24px; overflow: hidden;',
      '  border: 1px solid color-mix(in srgb, var(--primary) 38%, transparent);',
      '  box-shadow: 0 40px 120px rgba(0,0,0,.5); background: color-mix(in srgb, var(--bg) 92%, transparent); }',
      '#image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;',
      '  transform: scale(1.02); animation: pushIn 5s ease-out forwards; }',
      '@keyframes pushIn { to { transform: scale(1.14); } }',
      '#box { position: absolute; height: 18%; width: 34%; border-radius: 14px;',
      '  border: 3px solid var(--accent); box-shadow: 0 0 0 9999px rgba(4,6,18,.46), 0 14px 40px rgba(0,0,0,.4);',
      '  clip-path: inset(0 100% 0 0); animation: wipeBox .62s cubic-bezier(.2,.85,.3,1) .7s forwards; }',
      '@keyframes wipeBox { to { clip-path: inset(0 0 0 0); } }',
      '#callout { position: absolute; left: 6%; right: 6%; bottom: 6%; padding: 3.4% 4%; border-radius: 18px;',
      '  background: color-mix(in srgb, var(--bg) 86%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--primary) 42%, transparent);',
      '  opacity: 0; animation: rise .55s cubic-bezier(.2,.85,.3,1) 1.15s forwards; }',
      '#label { font-size: 4vmin; font-weight: 800; letter-spacing: -.015em; }',
      '#detail { margin-top: 1.4%; font-size: 2.9vmin; line-height: 1.38; color: color-mix(in srgb, var(--fg) 74%, transparent); }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    image: "", label: "", detail: "", focusX: "50", focusY: "52",',
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  var image = document.getElementById("image");',
      '  var box = document.getElementById("box");',
      '  // Without a screenshot there is nothing to highlight, so the frame drops',
      '  // to the branded panel rather than recording a broken image icon.',
      '  if ((vars.image || "").trim()) image.src = vars.image; else { image.remove(); box.remove(); }',
      '  function pct(value, fallback) {',
      '    var parsed = parseFloat(value);',
      '    return isFinite(parsed) ? Math.max(6, Math.min(94, parsed)) : fallback;',
      '  }',
      '  if (box.parentNode) {',
      '    // The box is positioned by its CENTRE, which is how the caller thinks',
      '    // about it, and clamped so it can never hang off the frame.',
      '    var cx = pct(vars.focusX, 50);',
      '    var cy = pct(vars.focusY, 52);',
      '    box.style.left = Math.max(2, Math.min(64, cx - 17)) + "%";',
      '    box.style.top = Math.max(2, Math.min(74, cy - 9)) + "%";',
      '  }',
      '  var label = document.getElementById("label");',
      '  var detail = document.getElementById("detail");',
      '  if ((vars.label || "").trim()) label.textContent = vars.label; else label.remove();',
      '  if ((vars.detail || "").trim()) detail.textContent = vars.detail; else detail.remove();',
      '  if (!label.parentNode && !detail.parentNode) document.getElementById("callout").remove();',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

// ——— Comparison Table: two sides, revealed against each other ———
//
// The product primitive behind a comparison beat. The two columns arrive from
// opposite edges and their rows reveal in pairs, so the viewer reads the
// contrast row by row instead of being handed a finished table.

const COMPARE: FrameTemplate = {
  id: 'comparison-table',
  name: 'Comparison Table',
  blurb: 'Two labelled columns with up to four rows each, revealed in pairs.',
  defaultDuration: 6,
  fields: [
    { key: 'leftTitle', label: 'Left column', placeholder: 'By hand' },
    { key: 'rightTitle', label: 'Right column', placeholder: 'With SceneForge' },
    { key: 'left1', label: 'Left row 1', placeholder: 'Three days per video' },
    { key: 'right1', label: 'Right row 1', placeholder: 'One afternoon' },
    { key: 'left2', label: 'Left row 2', placeholder: '' },
    { key: 'right2', label: 'Right row 2', placeholder: '' },
    { key: 'left3', label: 'Left row 3', placeholder: '' },
    { key: 'right3', label: 'Right row 3', placeholder: '' },
    { key: 'left4', label: 'Left row 4', placeholder: '' },
    { key: 'right4', label: 'Right row 4', placeholder: '' },
  ],
  entries: page(
    'Comparison Table',
    [
      '<div class="stage filled">',
      '  <div class="card">',
      '    <div id="logo"></div>',
      '    <div class="cols">',
      '      <div class="col left"><div class="head" id="leftTitle"></div><ul id="leftRows"></ul></div>',
      '      <div class="col right"><div class="head" id="rightTitle"></div><ul id="rightRows"></ul></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n'),
    [
      '.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4%; align-items: start; }',
      '.col { padding: 5% 5.5%; border-radius: 20px; opacity: 0; }',
      '.col.left { background: color-mix(in srgb, var(--fg) 7%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--fg) 16%, transparent);',
      '  animation: slideFromLeft .6s cubic-bezier(.2,.85,.3,1) .12s forwards; }',
      '.col.right { background: color-mix(in srgb, var(--primary) 16%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--accent) 52%, transparent);',
      '  animation: slideFromRight .6s cubic-bezier(.2,.85,.3,1) .3s forwards; }',
      '@keyframes slideFromLeft { from { opacity: 0; transform: translateX(-22px); } to { opacity: 1; transform: none; } }',
      '@keyframes slideFromRight { from { opacity: 0; transform: translateX(22px); } to { opacity: 1; transform: none; } }',
      '.head { font-size: 3.6vmin; font-weight: 800; letter-spacing: -.01em; padding-bottom: 5%;',
      '  border-bottom: 1px solid color-mix(in srgb, var(--fg) 18%, transparent); }',
      '.col.right .head { color: var(--accent); }',
      'ul { list-style: none; margin: 5% 0 0; padding: 0; display: grid; gap: 4%; }',
      'li { font-size: 2.9vmin; line-height: 1.36; opacity: 0;',
      '  animation: rise .48s cubic-bezier(.2,.85,.3,1) forwards; }',
    ].join('\n'),
    [
      '(function () {',
      '  var vars = window.readVariables({',
      '    leftTitle: "", rightTitle: "",',
      '    left1: "", right1: "", left2: "", right2: "", left3: "", right3: "", left4: "", right4: "",',
      '    primary: "#f59e0b", accent: "#d97706", background: "#0b1022", text: "#ffffff"',
      '  });',
      '  window.applyBrand(vars);',
      '  window.mountLogo(vars);',
      '  document.getElementById("leftTitle").textContent = vars.leftTitle || "";',
      '  document.getElementById("rightTitle").textContent = vars.rightTitle || "";',
      '  // Rows reveal in PAIRS: row 2 on the right lands with row 2 on the left,',
      '  // which is what makes the frame read as a comparison rather than as two',
      '  // unrelated lists that happen to share a card.',
      '  ["left", "right"].forEach(function (side) {',
      '    var list = document.getElementById(side + "Rows");',
      '    [1, 2, 3, 4].forEach(function (row) {',
      '      var text = (vars[side + row] || "").trim();',
      '      if (!text) return;',
      '      var li = document.createElement("li");',
      '      li.style.animationDelay = (0.62 + (row - 1) * 0.34 + (side === "right" ? 0.1 : 0)) + "s";',
      '      li.textContent = text;',
      '      list.appendChild(li);',
      '    });',
      '  });',
      '  window.signalReady();',
      '})();',
      '',
    ].join('\n'),
  ),
};

export const FRAME_TEMPLATES: FrameTemplate[] = [FEATURE, STAT, CTA, QUOTE, STEPS, UI_HIGHLIGHT, COMPARE];

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
