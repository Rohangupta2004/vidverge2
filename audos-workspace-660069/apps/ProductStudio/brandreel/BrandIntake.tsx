/**
 * BRAND REEL · STEP 1 — the URL input and the Brand Summary card.
 *
 * Nothing is generated here. The page is harvested server-side, the model
 * turns that evidence into a Brand Object, and the customer confirms or
 * lightly edits it before a single credit is spent. Once a brand exists the
 * whole card is themed with THEIR accent colour, not VidVerge's.
 */
import { useState } from 'react';
import { Check, Globe, ImageIcon, Link2, Play, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { BrandObject, BrandTheme, ScrapedVideo } from './types';
import { Card, ColourField, ErrorNote, GhostButton, PrimaryButton, Pill, SectionLabel, Spinner, TextField } from './ui';

const EXAMPLES = ['linear.app', 'notion.com', 'stripe.com'];

function VideoChip({ theme, video }: { theme: BrandTheme; video: ScrapedVideo }) {
  const label = video.kind === 'file' ? 'On-page video' : video.kind === 'youtube' ? 'YouTube' : video.kind === 'vimeo' ? 'Vimeo' : 'LinkedIn';
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none',
        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)',
        borderRadius: 10, padding: 7, minWidth: 0, flex: '1 1 190px',
      }}
    >
      <span
        style={{
          width: 54, height: 34, borderRadius: 7, flexShrink: 0, overflow: 'hidden',
          background: video.thumbnail ? `center / cover no-repeat url(${JSON.stringify(video.thumbnail)})` : theme.primarySoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {video.thumbnail ? null : <Play size={13} style={{ color: theme.primary }} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: theme.text, fontSize: 11.5, fontWeight: 700 }}>{label}</span>
        <span style={{ display: 'block', color: theme.textMuted, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {video.url.replace(/^https?:\/\//, '').slice(0, 44)}
        </span>
      </span>
    </a>
  );
}

export interface BrandIntakeProps {
  theme: BrandTheme;
  url: string;
  onUrlChange: (v: string) => void;
  scanning: boolean;
  scanNote: string;
  error: string;
  brand: BrandObject | null;
  onScan: () => void;
  onBrandChange: (patch: Partial<BrandObject>) => void;
  onConfirm: () => void;
  onRescan: () => void;
  modelNote: string;
  scrapeNotes: string[];
  confirming: boolean;
}

export default function BrandIntake(props: BrandIntakeProps) {
  const { theme, brand } = props;
  const [featuresDraft, setFeaturesDraft] = useState<string | null>(null);

  if (!brand) {
    return (
      <div className="br-rise" style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: theme.primarySoft, border: theme.borderStrong,
            }}
          >
            <Globe size={24} style={{ color: theme.primary }} />
          </div>
          <h2 style={{ margin: 0, color: theme.text, fontSize: 'clamp(20px, 4vw, 27px)', fontWeight: 800, letterSpacing: -0.4 }}>
            Paste your product URL
          </h2>
          <p style={{ margin: '9px auto 0', maxWidth: 480, color: theme.textMuted, fontSize: 13.5, lineHeight: 1.6 }}>
            I read the page, pull your real copy, colours, logo, screenshots and any video already on it, then write you
            six different ad scripts to choose from. Nothing is generated until you pick one.
          </p>
        </div>

        <Card theme={theme} style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
              <Link2 size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
              <input
                className="br-input"
                type="url"
                inputMode="url"
                value={props.url}
                placeholder="yourproduct.com"
                onChange={(e) => props.onUrlChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !props.scanning) props.onScan(); }}
                disabled={props.scanning}
                data-testid="input-brand-url"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.13)',
                  borderRadius: 11, color: theme.text, fontSize: 14.5, padding: '13px 14px 13px 36px', fontFamily: 'inherit',
                }}
              />
            </div>
            <PrimaryButton
              theme={theme}
              onClick={props.onScan}
              busy={props.scanning}
              disabled={!props.url.trim()}
              testId="button-scan-brand"
              style={{ padding: '13px 24px', flex: '0 0 auto' }}
            >
              {props.scanning ? 'Reading your page…' : (<><Search size={15} /> Scan my site</>)}
            </PrimaryButton>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
            <span style={{ color: theme.textMuted, fontSize: 11.5 }}>Try one:</span>
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                className="br-btn"
                disabled={props.scanning}
                onClick={() => props.onUrlChange(e)}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 999, color: theme.textMuted, fontSize: 11.5, fontWeight: 600, padding: '4px 11px',
                }}
              >
                {e}
              </button>
            ))}
          </div>

          {props.scanning && props.scanNote ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, color: theme.textMuted, fontSize: 12.5 }}>
              <Spinner color={theme.primary} />
              {props.scanNote}
            </div>
          ) : null}
        </Card>

        <ErrorNote theme={theme} message={props.error} onRetry={props.url.trim() ? props.onScan : undefined} />
      </div>
    );
  }

  const featuresText = featuresDraft ?? brand.features.join('\n');
  const commitFeatures = (text: string) => {
    setFeaturesDraft(null);
    props.onBrandChange({ features: text.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 6) });
  };

  return (
    <div className="br-rise" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card theme={theme} accentEdge style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: theme.border, flexWrap: 'wrap' }}>
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt=""
              style={{ height: 30, width: 'auto', maxWidth: 120, objectFit: 'contain', borderRadius: 6 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : null}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: theme.text, fontSize: 15.5, fontWeight: 800, letterSpacing: -0.2 }}>Brand summary</div>
            <div style={{ color: theme.textMuted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Read from {brand.url.replace(/^https?:\/\//, '')}
            </div>
          </div>
          <Pill theme={theme}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: theme.primary, display: 'inline-block' }} />
            {brand.primaryColor}
          </Pill>
          <GhostButton theme={theme} onClick={props.onRescan} testId="button-rescan-brand">
            <RefreshCw size={13} /> Different URL
          </GhostButton>
        </div>

        <div className="br-grid-2" style={{ padding: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
            <TextField theme={theme} label="Product name" value={brand.name} maxLength={60} testId="input-brand-name" onChange={(v) => props.onBrandChange({ name: v })} />
            <TextField theme={theme} label="Tagline" value={brand.tagline} maxLength={120} testId="input-brand-tagline" onChange={(v) => props.onBrandChange({ tagline: v })} />
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', color: theme.textMuted, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                Value propositions — one per line
              </span>
              <textarea
                className="br-input"
                rows={5}
                value={featuresText}
                onChange={(e) => setFeaturesDraft(e.target.value)}
                onBlur={(e) => commitFeatures(e.target.value)}
                data-testid="input-brand-features"
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.28)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: theme.text,
                  fontSize: 13, lineHeight: 1.6, padding: '9px 12px', resize: 'vertical', fontFamily: 'inherit',
                }}
              />
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <TextField theme={theme} label="Call to action" value={brand.cta} maxLength={40} testId="input-brand-cta" onChange={(v) => props.onBrandChange({ cta: v })} />
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <TextField theme={theme} label="Display font" value={brand.fontFamily} maxLength={60} onChange={(v) => props.onBrandChange({ fontFamily: v })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <ColourField theme={theme} label="Primary colour" value={brand.primaryColor} onChange={(v) => props.onBrandChange({ primaryColor: v })} />
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <ColourField theme={theme} label="Secondary colour" value={brand.secondaryColor} onChange={(v) => props.onBrandChange({ secondaryColor: v })} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
            <div>
              <SectionLabel theme={theme}>Page screenshot</SectionLabel>
              <div
                style={{
                  marginTop: 6, borderRadius: 12, overflow: 'hidden', border: theme.border,
                  background: 'rgba(0,0,0,0.35)', aspectRatio: '16 / 10',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {brand.heroImageUrl ? (
                  <img src={brand.heroImageUrl} alt={`${brand.name} homepage`} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.textMuted, fontSize: 12 }}>
                    <ImageIcon size={15} /> No screenshot captured
                  </span>
                )}
              </div>
            </div>

            {brand.images.length > 0 ? (
              <div>
                <SectionLabel theme={theme}>Images found on the page</SectionLabel>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 6 }}>
                  {brand.images.slice(0, 8).map((img) => (
                    <img
                      key={img.url}
                      src={img.url}
                      alt={img.alt}
                      title={img.alt || img.url}
                      style={{ width: 58, height: 44, objectFit: 'cover', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {brand.scrapedVideos.length > 0 ? (
              <div>
                <SectionLabel theme={theme}>Video already on the page</SectionLabel>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 6 }}>
                  {brand.scrapedVideos.slice(0, 4).map((v) => <VideoChip key={v.url} theme={theme} video={v} />)}
                </div>
              </div>
            ) : null}

            {brand.audience || brand.problem ? (
              <div>
                <SectionLabel theme={theme}>What I understood</SectionLabel>
                <div style={{ marginTop: 6, color: theme.textMuted, fontSize: 12.5, lineHeight: 1.6 }}>
                  {brand.audience ? <div><strong style={{ color: theme.text, fontWeight: 700 }}>For:</strong> {brand.audience}</div> : null}
                  {brand.problem ? <div><strong style={{ color: theme.text, fontWeight: 700 }}>Problem:</strong> {brand.problem}</div> : null}
                  {brand.toneOfVoice ? <div><strong style={{ color: theme.text, fontWeight: 700 }}>Voice:</strong> {brand.toneOfVoice}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: theme.border, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
            Edit anything that looks off — every script and every frame is written from exactly what is on this card.
          </div>
          <PrimaryButton theme={theme} onClick={props.onConfirm} busy={props.confirming} testId="button-confirm-brand">
            {props.confirming ? 'Writing your scripts…' : (<><Check size={15} /> Looks right — write my scripts</>)}
          </PrimaryButton>
        </div>
      </Card>

      {props.modelNote ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.textMuted, fontSize: 11.5 }}>
          <Sparkles size={13} style={{ color: theme.primary }} /> {props.modelNote}
        </div>
      ) : null}
      {props.scrapeNotes.map((n) => (
        <div key={n} style={{ color: theme.textMuted, fontSize: 11.5 }}>{n}</div>
      ))}
      <ErrorNote theme={theme} message={props.error} onRetry={props.onConfirm} />
    </div>
  );
}
