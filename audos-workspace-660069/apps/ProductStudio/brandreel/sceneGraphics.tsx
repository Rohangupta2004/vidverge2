/**
 * BRAND REEL — the storyboard preview, drawn in the browser.
 *
 * This is the SCREEN-SIDE TWIN of the SceneGraphic dispatcher inside
 * composition.ts. Same shapes, same brand tokens, same layout — rendered at
 * their finished state (every animation at 100%) so the customer sees the
 * frame they are going to get before anything is rendered.
 *
 * WHY IT EXISTS: the reel used to preview an AI-generated still per scene.
 * That image was a plausible-looking product interface belonging to nobody,
 * it cost money per scene, it took ~15s each, and it was not what the video
 * actually rendered. Now the preview IS the composition's own layout, so the
 * storyboard is truthful and instant.
 *
 * KEEPING THE TWO IN STEP: composition.ts holds the animated version as a
 * string submitted to the render service, so the two cannot share code. When
 * you change a shape in one, change it in the other — the component names and
 * prop names are deliberately identical to make the pairing obvious.
 */
import type { CSSProperties } from 'react';
import type { BrandObject, BrandTheme, SceneVisual, StoryboardScene } from './types';
import { tint } from './types';

/** The finished state of every entrance animation. */
const DONE = 1;

function frameStyle(theme: BrandTheme): CSSProperties {
  return {
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#0b0f18',
    boxShadow: `0 18px 44px rgba(0,0,0,0.45), 0 0 26px ${tint(theme.primary, 0.1)}`,
  };
}

// ---------------------------------------------------------------------------
// UISkeleton — the drawn application interface (no screenshot available)
// ---------------------------------------------------------------------------

function UISkeleton({ theme }: { theme: BrandTheme }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', background: '#0b0f18' }}>
      <div style={{ width: '23%', borderRight: '1px solid rgba(255,255,255,0.07)', padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: theme.primary, flexShrink: 0 }} />
          <span style={{ height: 4, width: '58%', borderRadius: 2, background: 'rgba(255,255,255,0.22)' }} />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 4,
              width: `${56 + ((i * 17) % 34)}%`,
              borderRadius: 2,
              marginBottom: 6,
              background: i === 1 ? tint(theme.primary, 0.55) : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </div>
      <div style={{ flex: 1, padding: 9, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: 6 }}>
              <div style={{ height: 3, width: '46%', borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
              <div style={{ height: 8, width: `${48 + i * 12}%`, borderRadius: 2, background: tint(theme.primary, 0.75), marginTop: 6 }} />
            </div>
          ))}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: tint(theme.primary, 0.32), flexShrink: 0 }} />
            <span style={{ height: 4, flex: 1, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
            <span style={{ height: 4, width: 24, borderRadius: 2, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

function UIFrame({ theme, src, title, host, chips }: { theme: BrandTheme; src: string; title: string; host: string; chips: string[] }) {
  const label = (title || host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return (
    <div style={{ position: 'relative', width: '86%' }}>
      <div style={frameStyle(theme)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background: '#ff5f57' }} />
          <span style={{ width: 5, height: 5, borderRadius: 99, background: '#febc2e' }} />
          <span style={{ width: 5, height: 5, borderRadius: 99, background: '#28c840' }} />
          <span style={{ marginLeft: 6, flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 4, color: 'rgba(255,255,255,0.55)', fontSize: 7, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </span>
        </div>
        <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#080c14', overflow: 'hidden' }}>
          {src ? (
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
          ) : (
            <UISkeleton theme={theme} />
          )}
        </div>
      </div>
      {chips.slice(0, 3).map((chip, i) => (
        <div
          key={chip}
          style={{
            position: 'absolute',
            top: `${14 + i * 28}%`,
            left: i % 2 === 0 ? '-8%' : undefined,
            right: i % 2 === 0 ? undefined : '-8%',
            background: 'rgba(10,14,26,0.9)',
            border: `1px solid ${tint(theme.primary, 0.55)}`,
            borderRadius: 999,
            padding: '3px 8px',
            fontSize: 8,
            fontWeight: 700,
            color: '#fff',
            whiteSpace: 'nowrap',
            maxWidth: '58%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ color: theme.primary, marginRight: 4 }}>●</span>
          {chip}
        </div>
      ))}
    </div>
  );
}

function StatBlock({ theme, value, label }: { theme: BrandTheme; value: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={92} height={92} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
          <circle cx="60" cy="60" r="54" fill="none" stroke={theme.primary} strokeWidth="6" strokeLinecap="round" strokeDasharray={339.3} strokeDashoffset={339.3 * (1 - DONE)} />
        </svg>
        <div style={{ position: 'absolute', color: '#fff', fontSize: 27, fontWeight: 900, letterSpacing: -1 }}>{value}</div>
      </div>
      {label ? <div style={{ color: 'rgba(255,255,255,0.74)', fontSize: 10, fontWeight: 600, textAlign: 'center', maxWidth: 170 }}>{label}</div> : null}
    </div>
  );
}

function CheckList({ theme, items, label }: { theme: BrandTheme; items: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {label ? <div style={{ color: theme.primary, fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' }}>{label}</div> : null}
      {items.slice(0, 4).map((item) => (
        <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.primary }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none">
              <path d="M4 12.5L9.5 18L20 6" stroke={theme.onPrimary} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 650, lineHeight: 1.3 }}>{item}</div>
        </div>
      ))}
    </div>
  );
}

function ProcessFlow({ theme, items, label }: { theme: BrandTheme; items: string[]; label: string }) {
  const steps = items.slice(0, 3);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, width: '100%' }}>
      {label ? <div style={{ color: theme.primary, fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' }}>{label}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%' }}>
        {steps.map((item, i) => (
          <div key={item} style={{ display: 'contents' }}>
            <div style={{ flex: '0 1 auto', minWidth: 0, background: 'rgba(255,255,255,0.055)', border: `1px solid ${tint(theme.primary, 0.35)}`, borderRadius: 9, padding: '8px 9px', textAlign: 'center' }}>
              <div style={{ color: theme.primary, fontSize: 9, fontWeight: 900, marginBottom: 3 }}>{`0${i + 1}`}</div>
              <div style={{ color: '#fff', fontSize: 10.5, fontWeight: 700, lineHeight: 1.3 }}>{item}</div>
            </div>
            {i < steps.length - 1 ? (
              <div style={{ flex: '0 0 auto', width: 18, height: 2, borderRadius: 2, background: theme.primary }} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Comparison({ theme, items, itemsB, compareFrom, compareTo }: { theme: BrandTheme; items: string[]; itemsB: string[]; compareFrom: string; compareTo: string }) {
  const column = (heading: string, rows: string[], highlight: boolean) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: highlight ? tint(theme.primary, 0.12) : 'rgba(255,255,255,0.04)',
        border: `1px solid ${highlight ? tint(theme.primary, 0.5) : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 10,
        padding: 9,
      }}
    >
      <div style={{ color: highlight ? theme.primary : 'rgba(255,255,255,0.5)', fontSize: 8.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 7 }}>
        {heading}
      </div>
      {rows.slice(0, 3).map((item, i) => (
        <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: i ? 6 : 0 }}>
          <span style={{ marginTop: 4, width: 5, height: 5, borderRadius: 99, flexShrink: 0, background: highlight ? theme.primary : 'rgba(255,255,255,0.28)' }} />
          <span style={{ color: highlight ? '#fff' : 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: highlight ? 700 : 500, lineHeight: 1.35, textDecoration: highlight ? 'none' : 'line-through' }}>
            {item}
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 9, width: '100%' }}>
      {column(compareFrom || 'Before', items, false)}
      {column(compareTo || 'After', itemsB, true)}
    </div>
  );
}

function QuoteBlock({ theme, value, label }: { theme: BrandTheme; value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center', width: '100%' }}>
      <div style={{ color: theme.primary, fontSize: 28, fontWeight: 900, lineHeight: 0.7 }}>&ldquo;</div>
      <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, marginTop: 5 }}>{value}</div>
      <div style={{ height: 2, width: 40, background: theme.primary, borderRadius: 2, margin: '9px auto 0' }} />
      {label ? <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9.5, fontWeight: 600, marginTop: 6, letterSpacing: 0.6 }}>{label}</div> : null}
    </div>
  );
}

function FeatureCards({ theme, items }: { theme: BrandTheme; items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {items.slice(0, 3).map((item, i) => (
        <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: '8px 9px' }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.primary, color: theme.onPrimary, fontSize: 10, fontWeight: 900 }}>
            {i + 1}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, lineHeight: 1.3 }}>{item}</div>
            <div style={{ height: 2, width: 40, background: theme.primary, borderRadius: 2, marginTop: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CtaPlate({ theme, label, logoUrl }: { theme: BrandTheme; label: string; logoUrl: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      {logoUrl ? (
        <img src={logoUrl} alt="" style={{ height: 16, width: 'auto', maxWidth: 70, objectFit: 'contain' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      ) : null}
      <div
        style={{
          background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.primaryStrong} 100%)`,
          color: theme.onPrimary,
          borderRadius: 999,
          padding: '8px 22px',
          fontSize: 12.5,
          fontWeight: 900,
          boxShadow: `0 0 22px ${tint(theme.primary, 0.5)}`,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScenePreview — one storyboard frame
// ---------------------------------------------------------------------------

export interface ScenePreviewProps {
  theme: BrandTheme;
  brand: BrandObject;
  scene: StoryboardScene;
  /** The still this scene will actually use, when its shape is product-ui. */
  imageUrl: string;
  isLast: boolean;
  aspect: '16:9' | '9:16';
}

export default function ScenePreview(props: ScenePreviewProps) {
  const { theme, brand, scene, isLast } = props;
  const visual: SceneVisual = scene.visual;
  const tall = props.aspect === '9:16';
  const kind = isLast ? 'cta' : visual?.kind || 'kinetic';
  const hasGraphic = kind !== 'kinetic' && kind !== 'cta';

  return (
    <div
      style={{
        position: 'relative',
        width: tall ? 190 : 330,
        flexShrink: 0,
        aspectRatio: tall ? '9 / 16' : '16 / 9',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)',
        // The composition's own living backdrop, held still.
        background: `radial-gradient(ellipse 70% 55% at 22% 12%, ${tint(theme.primary, 0.22)} 0%, transparent 62%), radial-gradient(ellipse 60% 50% at 88% 96%, ${tint(theme.primaryStrong, 0.18)} 0%, transparent 64%), linear-gradient(160deg, ${theme.secondary} 0%, #05070d 72%)`,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          opacity: 0.6,
        }}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: hasGraphic ? 'flex-start' : 'center',
          padding: tall ? '16px 12px' : '14px 22px',
          boxSizing: 'border-box',
          gap: 6,
        }}
      >
        <div
          style={{
            border: `1px solid ${tint(theme.primary, 0.55)}`,
            background: tint(theme.primary, 0.14),
            color: theme.primary,
            borderRadius: 999,
            padding: '2px 9px',
            fontSize: 7,
            fontWeight: 800,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {isLast ? 'Get started' : `Scene ${scene.sceneNumber}`}
        </div>

        <div
          style={{
            color: '#fff',
            fontSize: hasGraphic ? (tall ? 13 : 17) : tall ? 18 : 25,
            fontWeight: 850,
            lineHeight: 1.15,
            letterSpacing: -0.4,
            textAlign: 'center',
            textShadow: '0 4px 18px rgba(0,0,0,0.7)',
          }}
        >
          {(isLast ? scene.headline || brand.name : scene.headline) || brand.name}
        </div>

        {scene.bodyText && !hasGraphic ? (
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: tall ? 9 : 11, fontWeight: 500, lineHeight: 1.4, textAlign: 'center' }}>
            {scene.bodyText}
          </div>
        ) : null}

        {isLast ? (
          <div style={{ marginTop: 4 }}>
            <CtaPlate theme={theme} label={brand.cta || 'Get started'} logoUrl={brand.logoUrl} />
          </div>
        ) : hasGraphic ? (
          <div style={{ marginTop: 3, width: '100%', display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            {kind === 'product-ui' ? (
              <UIFrame theme={theme} src={props.imageUrl} title={visual.label} host={brand.url} chips={visual.items} />
            ) : kind === 'stat' ? (
              <StatBlock theme={theme} value={visual.value} label={visual.label} />
            ) : kind === 'checklist' ? (
              <CheckList theme={theme} items={visual.items} label={visual.label} />
            ) : kind === 'process' ? (
              <ProcessFlow theme={theme} items={visual.items} label={visual.label} />
            ) : kind === 'comparison' ? (
              <Comparison theme={theme} items={visual.items} itemsB={visual.itemsB} compareFrom={visual.compareFrom} compareTo={visual.compareTo} />
            ) : kind === 'quote' ? (
              <QuoteBlock theme={theme} value={visual.value} label={visual.label} />
            ) : kind === 'feature-cards' ? (
              <FeatureCards theme={theme} items={visual.items} />
            ) : null}
          </div>
        ) : null}
      </div>

      {scene.voiceover ? (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 8,
            background: 'rgba(6,9,16,0.85)',
            border: `1px solid ${tint(theme.primary, 0.3)}`,
            borderLeft: `2px solid ${theme.primary}`,
            borderRadius: 6,
            padding: '4px 7px',
            color: '#fff',
            fontSize: 7.5,
            fontWeight: 600,
            lineHeight: 1.35,
            textAlign: 'center',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {scene.voiceover}
        </div>
      ) : null}
    </div>
  );
}
