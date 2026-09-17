/**
 * Brand confirmation card (PRD 1.1) — shown after the product page is captured
 * and BEFORE generation starts. Presents everything the claude-opus-5 brand
 * extractor pulled from the real page — dominant colours (primary, secondary,
 * accent, background, text), typography, tone of voice, product name, tagline,
 * and key features — for the user to review and edit. The confirmed kit is
 * persisted on the project and becomes the single colour/typography source for
 * the whole generated film. Nothing downstream invents or hardcodes colours.
 */
import { useMemo, useState } from 'react';
import { Check, Clapperboard, Palette, Pipette, Type, X } from 'lucide-react';
import type { BrandKit, ScrapedProductBrief } from '../../lib/trackB/api';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  card: 'var(--space-surface-card)',
  panelStrong: 'var(--space-surface-panel-strong)',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10,
  border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13, outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: S.muted, marginBottom: 5,
};

const COLOR_ROLES: { key: keyof NonNullable<BrandKit['colors']> & string; label: string; fallback: string }[] = [
  { key: 'primary', label: 'Primary', fallback: '#6d5efc' },
  { key: 'secondary', label: 'Secondary', fallback: '#8b7dfc' },
  { key: 'accent', label: 'Accent', fallback: '#22d3ee' },
  { key: 'background', label: 'Background', fallback: '#090b14' },
  { key: 'text', label: 'Text', fallback: '#f8fafc' },
];

function hex6(v: string | null | undefined, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(String(v ?? '')) ? String(v).toLowerCase() : fallback;
}

/** PRD 2.2 — style picker. Each style fixes a motion-label set and a pacing
 *  server-side (trackb-project plan_render). Social Ad is the default. */
export type ProductVideoStyle = 'cinematic' | 'social_ad' | 'explainer' | 'documentary';
const PV_STYLES: { id: ProductVideoStyle; name: string; hint: string }[] = [
  { id: 'cinematic', name: 'Cinematic', hint: 'Slow, deliberate — slow pans & dolly-ins' },
  { id: 'social_ad', name: 'Social Ad', hint: 'Fast, punchy — whip-cuts & quick reveals' },
  { id: 'explainer', name: 'Explainer', hint: 'Steady, even — clear readable beats' },
  { id: 'documentary', name: 'Documentary', hint: 'Natural, unhurried — handheld drift' },
];

export default function BrandConfirmCard({ capture, busy, onConfirm, onCancel }: {
  capture: ScrapedProductBrief;
  busy: boolean;
  onConfirm: (kit: BrandKit, keyFeatures: string[], style: ProductVideoStyle) => void;
  onCancel: () => void;
}) {
  const extracted = capture.brand_kit ?? null;
  const initial = useMemo(() => ({
    name: extracted?.product_name || capture.product_name || '',
    tagline: extracted?.tagline || capture.tagline || '',
    tone: extracted?.tone_of_voice || capture.tone || '',
    fontStack: extracted?.typography?.font_stack || '',
    fontStyle: extracted?.typography?.style || '',
    colors: Object.fromEntries(COLOR_ROLES.map((r) => [r.key, hex6(extracted?.colors?.[r.key], r.fallback)])) as Record<string, string>,
    features: (capture.key_features ?? []).slice(0, 8).join('\n'),
  }), [extracted, capture]);

  const [name, setName] = useState(initial.name);
  const [tagline, setTagline] = useState(initial.tagline);
  const [tone, setTone] = useState(initial.tone);
  const [fontStack, setFontStack] = useState(initial.fontStack);
  const [fontStyle, setFontStyle] = useState(initial.fontStyle);
  const [colors, setColors] = useState<Record<string, string>>(initial.colors);
  const [features, setFeatures] = useState(initial.features);
  const [style, setStyle] = useState<ProductVideoStyle>('social_ad');

  const confirm = () => {
    const kit: BrandKit = {
      colors: {
        primary: hex6(colors.primary, '#6d5efc'),
        secondary: hex6(colors.secondary, '#8b7dfc'),
        accent: hex6(colors.accent, '#22d3ee'),
        background: hex6(colors.background, '#090b14'),
        text: hex6(colors.text, '#f8fafc'),
      },
      typography: {
        style: fontStyle.trim() || null,
        font_stack: fontStack.trim() || null,
        heading_font: extracted?.typography?.heading_font ?? null,
      },
      tone_of_voice: tone.trim() || null,
      product_name: name.trim() || null,
      tagline: tagline.trim() || null,
    };
    const keyFeatures = features.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 8);
    onConfirm(kit, keyFeatures, style);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirm your brand" style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(4,8,18,0.66)' }}>
      <div className="ps-fade-up" style={{ width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto', borderRadius: 18, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 'clamp(16px, 3vw, 24px)', boxSizing: 'border-box' }} data-testid="brand-confirm-card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', color: S.brand, background: 'var(--space-surface-accent-soft)', flexShrink: 0 }}>
            <Pipette size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: S.text }}>What the AI saw — look right?</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: S.sub, lineHeight: 1.55 }}>
              Extracted from your page's real colours, fonts and copy. Anything the page didn't reveal is marked “Not found” — edit any field before we generate; the whole film is designed from this kit.
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ padding: 6, borderRadius: 8, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', flexShrink: 0 }} data-testid="brand-close"><X size={13} /></button>
        </div>

        {/* live preview strip */}
        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0', padding: '12px 14px', borderRadius: 12, background: colors.background, border: `1px solid ${S.border}` }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: colors.text, fontFamily: fontStack || undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Your product'}</span>
          <span style={{ marginLeft: 'auto', height: 7, width: 84, borderRadius: 999, background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent})`, flexShrink: 0 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <span style={labelStyle}>Product name</span>
            <input value={name} maxLength={100} placeholder="Not found — type your product name" onChange={(e) => setName(e.currentTarget.value)} style={inputStyle} data-testid="brand-name" />
          </div>
          <div>
            <span style={labelStyle}>Tagline</span>
            <input value={tagline} maxLength={220} placeholder="Not found — add a tagline" onChange={(e) => setTagline(e.currentTarget.value)} style={inputStyle} data-testid="brand-tagline" />
          </div>
        </div>

        <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}><Palette size={10} /> Extracted colours</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8, marginBottom: 12 }}>
          {COLOR_ROLES.map((r) => (
            <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, cursor: 'pointer' }} title={`${r.label}: ${colors[r.key]}`}>
              <input
                type="color"
                value={colors[r.key]}
                onChange={(e) => { const v = e.currentTarget.value; setColors((cur) => ({ ...cur, [r.key]: v })); }}
                style={{ width: 26, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                aria-label={`${r.label} colour`}
                data-testid={`brand-color-${r.key}`}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: S.sub }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 9.5, color: S.muted }}>{colors[r.key]}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}><Type size={10} /> Typography (font stack)</span>
            <input value={fontStack} placeholder="e.g. Inter, system-ui, sans-serif" onChange={(e) => setFontStack(e.currentTarget.value)} style={inputStyle} data-testid="brand-font" />
          </div>
          <div>
            <span style={labelStyle}>Type personality</span>
            <input value={fontStyle} placeholder="e.g. geometric sans, bold and tight" onChange={(e) => setFontStyle(e.currentTarget.value)} style={inputStyle} data-testid="brand-font-style" />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>Detected tone</span>
          <input value={tone} maxLength={300} placeholder="Not found — describe how the brand talks" onChange={(e) => setTone(e.currentTarget.value)} style={inputStyle} data-testid="brand-tone" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>Key features (one per line — the script only uses these facts)</span>
          <textarea value={features} rows={4} placeholder={'Not found — add up to 3 key features, e.g.\nOne-click exports\nWorks with your data\nNo setup needed'} onChange={(e) => setFeatures(e.currentTarget.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 72, fontFamily: 'inherit', lineHeight: 1.5 }} data-testid="brand-features" />
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}><Clapperboard size={10} /> Video style</span>
          <div role="radiogroup" aria-label="Video style" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            {PV_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={style === s.id}
                onClick={() => setStyle(s.id)}
                style={{ padding: '9px 10px', borderRadius: 10, textAlign: 'left', cursor: 'pointer', border: `1px solid ${style === s.id ? 'var(--space-brand-primary-600)' : S.border}`, background: style === s.id ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text }}
                data-testid={`style-${s.id}`}
              >
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800 }}>{s.name}{s.id === 'social_ad' ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: S.brand }}>DEFAULT</span> : null}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 10, color: S.muted, lineHeight: 1.4 }}>{s.hint}</span>
              </button>
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 10.5, color: S.muted }}>Each style locks the film's motion vocabulary and pacing. One video is produced either way.</p>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ padding: '9px 15px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="brand-cancel">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }} data-testid="brand-confirm">
            <Check size={14} /> {busy ? 'Generating…' : 'Use this brand & generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
