/**
 * ADS STUDIO — RECIPES.
 *
 * The fourth top-level surface of Ads Studio, reached from the left rail under
 * the eight workflow steps. Opening it parks the Veo workflow exactly where it
 * stands; nothing in the session is touched until the customer presses "Use in
 * Ad" on a saved clip, which hands back into App.tsx.
 *
 *   Saved Videos    — every finished clip in the workspace video catalog,
 *                     filtered by the provider that made it, with Download
 *                     and "Use in Ad".
 *   Runway Recipes  — the Runway recipe templates. The product ad and UGC
 *                     recipes now cast themselves: give them a product image
 *                     and a line about the product and the presenter and the
 *                     ad angle are written automatically (see
 *                     lib/adPersona.ts), then ride into the recipe's own
 *                     creative brief.
 *
 * The former Character Studio and Auto-Write Angle tabs are gone — both jobs
 * happen by themselves inside the Runway recipe flow now.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Clapperboard, Download, Film, RefreshCw, RotateCcw,
} from 'lucide-react';
import { T } from './api';
import { Btn, Tag, card } from './ui';
import {
  SavedVideo, formatVideoDate, listWorkspaceVideos, posterSrc, providerLabel, shortPrompt,
} from './recipesApi';
import RunwayStudio from '../../components/RunwayStudio';
import RecipeAngleScript from './RecipeAngleScript';
import type { RecipeBrief } from './RecipeAngleScript';

export type RecipeSection = 'videos' | 'runway';

/** Motion the design system asks for and inline styles cannot express:
 * stagger-in, hover lift, micro-press, and a pulse skeleton for loading. */
const RECIPES_CSS = `
@keyframes rx-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes rx-pulse { 0%, 100% { opacity: .4; } 50% { opacity: .75; } }
.rx-rise { animation: rx-rise .36s cubic-bezier(.22,.9,.3,1) both; }
.rx-skeleton { animation: rx-pulse 1.5s ease-in-out infinite; }
.rx-card { transition: transform .22s cubic-bezier(.22,.9,.3,1), box-shadow .22s ease, border-color .22s ease; }
.rx-card:hover { transform: translateY(-2px); box-shadow: 0 4px 24px rgba(0,0,0,.4); }
.rx-tab { transition: color .22s ease; }
.rx-tab:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  .rx-rise, .rx-skeleton { animation: none !important; }
  .rx-card, .rx-tab { transition: none !important; }
}
`;

const SECTIONS: { id: RecipeSection; label: string; blurb: string }[] = [
  { id: 'videos', label: 'Saved Videos', blurb: 'Every finished clip this workspace has generated.' },
  { id: 'runway', label: 'Runway Recipes', blurb: 'Product ads, UGC, product swaps, multi-shot films, localized ads and campaign imagery — the presenter and angle write themselves.' },
];

export interface RecipesPanelProps {
  /** Attach a finished clip to the ad as product footage and jump to Step 1. */
  onUseVideo: (video: { name: string; url: string }) => void;
  /** What the workflow already knows, so the recipes start pre-filled. */
  prefill: {
    productName: string;
    productDescription: string;
    productImage: string;
    sourceVideo: string;
  };
}

function SectionHeader({ title, blurb, right }: { title: string; blurb: string; right?: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>{title}</h2>
        <p style={{ margin: 0, color: T.muted, fontSize: 13.5, maxWidth: 680 }}>{blurb}</p>
      </div>
      {right}
    </div>
  );
}

// ===========================================================================
// 1 — SAVED VIDEOS
// ===========================================================================

const VIDEO_FILTERS: { id: string; label: string }[] = [
  { id: 'runway', label: 'Runway' },
  { id: 'veo', label: 'Veo' },
  { id: 'gemini', label: 'Omni Flash' },
  { id: 'stitched', label: 'Assembled' },
  { id: 'all', label: 'Everything' },
];

function SavedVideos({ onUseVideo }: { onUseVideo: RecipesPanelProps['onUseVideo'] }) {
  const [provider, setProvider] = useState<string>('runway');
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listWorkspaceVideos(which, 120);
      setVideos(page.videos);
      setCounts(page.counts);
      setTotal(page.total);
    } catch (e: any) {
      setError(e?.message || 'The saved video library could not be read.');
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(provider); }, [provider, load]);

  return (
    <div>
      <SectionHeader
        title="Saved Videos"
        blurb="Every finished clip stored in this workspace, newest first. Download one, or drop it into a new ad as product footage."
        right={<Btn small disabled={loading} onClick={() => void load(provider)}><RefreshCw size={13} /> Refresh</Btn>}
      />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {VIDEO_FILTERS.map((f) => (
          <Btn key={f.id} small kind={provider === f.id ? 'primary' : 'ghost'} onClick={() => setProvider(f.id)}>
            {f.label}{f.id === 'all' ? ` (${total || 0})` : counts[f.id] ? ` (${counts[f.id]})` : ''}
          </Btn>
        ))}
      </div>

      {error ? (
        <div className="rx-rise" style={{ ...card, borderColor: T.bad, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 10, background: 'rgba(153,27,27,.1)', flexShrink: 0 }}><AlertTriangle size={16} color={T.bad} /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', color: T.ink, fontSize: 14, fontWeight: 700 }}>The video library could not be read</span>
            <span style={{ display: 'block', marginTop: 4, color: T.muted, fontSize: 13, lineHeight: 1.55 }}>{error}</span>
          </span>
          <Btn small kind="primary" onClick={() => void load(provider)}><RotateCcw size={12} /> Retry</Btn>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="rx-skeleton" style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16/9', background: T.panel }} />
              <div style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ height: 10, width: '45%', borderRadius: 999, background: T.panel }} />
                <div style={{ height: 10, width: '80%', borderRadius: 999, background: T.panel }} />
                <div style={{ height: 10, width: '60%', borderRadius: 999, background: T.panel }} />
              </div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="rx-rise" style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, margin: '0 auto 16px', borderRadius: 18, background: T.panel, border: `1px solid ${T.line}` }}>
            <Film size={24} color={T.accent} />
          </div>
          <div style={{ color: T.ink, fontSize: 16, fontWeight: 700 }}>
            {provider === 'all' ? 'No clips saved yet' : `No ${providerLabel(provider)} clips yet`}
          </div>
          <div style={{ margin: '8px auto 0', maxWidth: 440, color: T.muted, fontSize: 13.5, lineHeight: 1.7 }}>
            {provider === 'runway'
              ? 'Every Runway Recipe you run is saved here the moment it finishes — including the clips the Omni Flash stand-in films when Runway is switched off on this deployment.'
              : `Anything this workspace generates on ${providerLabel(provider)} lands here automatically, ready to download or drop into an ad.`}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            {total && provider !== 'all' ? (
              <Btn small kind="primary" onClick={() => setProvider('all')}>Show all {total} saved clips</Btn>
            ) : null}
            <Btn small onClick={() => void load(provider)}><RefreshCw size={12} /> Check again</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
          {videos.map((v, index) => (
            <div key={v.id} className="rx-card rx-rise" style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', animationDelay: `${Math.min(index, 11) * 40}ms` }}>
              <div style={{ background: '#000', aspectRatio: v.aspectRatio === '9:16' ? '9/16' : v.aspectRatio === '1:1' ? '1/1' : '16/9', maxHeight: 280 }}>
                <video
                  src={posterSrc(v.url)}
                  controls
                  preload="metadata"
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              </div>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Tag tone="info">{providerLabel(v.provider)}</Tag>
                  {v.aspectRatio ? <Tag>{v.aspectRatio}</Tag> : null}
                </div>
                <div style={{ fontSize: 11.5, color: T.muted }}>{formatVideoDate(v.createdAt)}</div>
                <div style={{ fontSize: 12, color: T.soft, lineHeight: 1.5 }}>{shortPrompt(v.prompt)}</div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                  <Btn small kind="primary" onClick={() => onUseVideo({ name: `${providerLabel(v.provider)} clip`, url: v.url })}>
                    <Clapperboard size={12} /> Use in Ad
                  </Btn>
                  <a href={v.url} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                    <Btn small><Download size={12} /> Download</Btn>
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// The Recipes shell
// ===========================================================================

export default function RecipesPanel(props: RecipesPanelProps) {
  const [section, setSection] = useState<RecipeSection>('runway');
  // The optional angle -> script pre-step. Nothing is applied until the
  // customer presses "Use in the recipe", so the recipes behave exactly as
  // they always did for anyone who skips it.
  const [brief, setBrief] = useState<RecipeBrief | null>(null);

  return (
    <div>
      <style>{RECIPES_CSS}</style>
      <div
        style={{
          position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${SECTIONS.length}, minmax(0, 1fr))`,
          maxWidth: 420, padding: 4, marginBottom: 20,
          borderRadius: 999, background: T.panel, border: `1px solid ${T.line}`,
        }}
        role="tablist"
        data-testid="recipes-subnav"
      >
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 4, bottom: 4, left: 4, width: `calc(${100 / SECTIONS.length}% - 4px)`,
            borderRadius: 999, background: T.accent,
            transform: `translateX(${Math.max(0, SECTIONS.findIndex((s) => s.id === section)) * 100}%)`,
            transition: 'transform .28s cubic-bezier(.22,.9,.3,1)',
          }}
        />
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            className="rx-tab"
            aria-selected={section === s.id}
            title={s.blurb}
            onClick={() => setSection(s.id)}
            style={{
              position: 'relative', zIndex: 1,
              background: 'transparent',
              color: section === s.id ? '#fff' : T.soft,
              border: 'none',
              borderRadius: 999, padding: '9px 15px', fontSize: 13, fontWeight: 700,
              fontFamily: T.sans, cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'videos' ? <SavedVideos onUseVideo={props.onUseVideo} /> : null}
      {section === 'runway' ? (
        <>
        <RecipeAngleScript
          productName={props.prefill.productName}
          productDescription={props.prefill.productDescription}
          applied={Boolean(brief)}
          onApply={setBrief}
          onClear={() => setBrief(null)}
        />
        <RunwayStudio
          title="Runway Recipes"
          subtitle="Ready-made ad recipes — Product Ads, UGC, Product Swaps, Multi-Shot films, Localized Ads, Campaign Imagery and Stock Images — plus raw text/image to video on the Runway Gen 4 models. Upload the product and say what it is: the creator who presents it and the angle the ad runs on are written for you. Every generation is quoted before anything is charged."
          autoPersona
          theme={{
            panel: T.panel, card: T.card, line: T.line, lineStrong: T.lineStrong,
            ink: T.ink, soft: T.soft, muted: T.muted, accent: T.accent, onAccent: '#ffffff',
            good: T.good, bad: T.bad, font: T.sans,
          }}
          prefill={{
            productName: props.prefill.productName,
            productDescription: props.prefill.productDescription,
            productImage: props.prefill.productImage,
            sourceVideo: props.prefill.sourceVideo,
            ...(brief ? { concept: brief.concept, prompt: brief.prompt, shots: brief.shots } : {}),
          }}
        />
        </>
      ) : null}
    </div>
  );
}
