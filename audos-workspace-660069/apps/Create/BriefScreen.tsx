/**
 * Screen 2 — confirm what we found.
 *
 * The URL fetch (or the vision read of an uploaded image) lands here as an
 * editable summary card: product name, tagline, key features, brand feel.
 * Below it, a one-line format row, optional character and app-mockup controls,
 * and the single primary action — Generate video. Reviewing the storyboard
 * first is offered as a quiet secondary link for people who want the old
 * approval gate.
 */
import { ArrowLeft, Check, Film, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import AddOns from './AddOns';
import { LENGTHS, scenePlanFor, TONES } from './videoTypes';
import type { LengthId } from './videoTypes';
import {
  generateVideo,
  isJobActive,
  openStoryboard,
  refetchBrief,
  setAspect,
  setIdea,
  setLength,
  setModel,
  setTone,
  startOver,
  toggleImage,
  updateBrief,
  useVideoStudio,
} from './videoStore';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  ModelPicker,
  PrimaryButton,
  SectionLabel,
  SeriesBadge,
  T,
  TextArea,
  TextInput,
  TextLink,
} from './ui';

function SkeletonCard() {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="card-brief-loading">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: T.sub }}>
        <Loader2 size={14} className="rc-spin" color={T.accentFg} /> Reading your page…
      </div>
      {[70, 92, 84].map((w, i) => (
        <div key={i} className="rc-skeleton" style={{ height: 12, width: `${w}%`, borderRadius: 6 }} />
      ))}
    </Card>
  );
}

export default function BriefScreen() {
  const studio = useVideoStudio();
  const brief = studio.brief;
  const fromUrl = studio.source === 'url';
  const ready = !studio.fetching && !!brief;
  const canGenerate = ready && !!((brief && (brief.name.trim() || brief.features.trim())) || studio.idea.trim());
  const generating = studio.scriptLoading || isJobActive(studio.job);
  // What the chosen length will really come back as on Omni Flash. This is the
  // honest rendered duration rather than a generic label.
  const plan = scenePlanFor(studio.lengthId, studio.model);
  const plannedSeconds = plan.sceneCount * plan.sceneSeconds;
  // Every ✨ expand call gets the brief so far, so an expansion is about THIS
  // product rather than a generic paragraph about a product.
  const expandContext = [
    brief && brief.name ? `Product: ${brief.name}` : '',
    brief && brief.tagline ? `Tagline: ${brief.tagline}` : '',
    brief && brief.tone ? `Brand feel: ${brief.tone}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 840, margin: '0 auto' }}>
      {/* Back */}
      <div className="rc-mobile-stack" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 24 }}> 
        <TextLink
          onClick={startOver}
          testId="button-start-over"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={13} /> Start over
        </TextLink>
        {fromUrl && studio.url ? (
          <TextLink
            onClick={() => void refetchBrief()}
            testId="button-refetch"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={12} className={studio.fetching ? 'rc-spin' : ''} /> Re-read the page
          </TextLink>
        ) : null}
      </div>

      <SeriesBadge style={{ marginBottom: 18 }} />

      <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 700, letterSpacing: -0.7, color: T.text }}>
        {fromUrl ? "Here's what we found" : 'Your brief'}
      </h1>
      <p style={{ margin: '9px 0 26px', fontSize: 14, color: T.sub, lineHeight: 1.6 }}>
        {fromUrl
          ? 'Edit anything that isn’t quite right — this is what the script is written from.'
          : 'Fill in as much or as little as you like — this is what the script is written from.'}
        {studio.url ? (
          <span style={{ display: 'block', marginTop: 5, fontSize: 12.5, color: T.muted, wordBreak: 'break-all' }}>
            {studio.url}
          </span>
        ) : null}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* ---- The summary card ---- */}
        {studio.fetching || !brief ? (
          <SkeletonCard />
        ) : (
          <Card
            className="rc-glass rc-reveal"
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            data-testid="card-brief"
          >
            <div>
              <FieldLabel>Product or brand name</FieldLabel>
              <TextInput
                value={brief.name}
                onChange={(v) => updateBrief({ name: v })}
                placeholder="e.g. Northwind Coffee"
                testId="input-brief-name"
              />
            </div>
            <div>
              <FieldLabel>Tagline</FieldLabel>
              <TextInput
                value={brief.tagline}
                onChange={(v) => updateBrief({ tagline: v })}
                placeholder="One line that sells it"
                testId="input-brief-tagline"
                expand={{ field: 'Product tagline', context: expandContext, words: 24 }}
              />
            </div>
            <div>
              <FieldLabel>Key features</FieldLabel>
              <TextArea
                value={brief.features}
                onChange={(v) => updateBrief({ features: v })}
                rows={3}
                placeholder="The one to three things worth showing on screen"
                testId="input-brief-features"
                expand={{ field: 'Key product features', context: expandContext, words: 70 }}
              />
            </div>
            <div>
              <FieldLabel hint="How the brand talks — it steers the writing and the look.">Brand feel</FieldLabel>
              <TextInput
                value={brief.tone}
                onChange={(v) => updateBrief({ tone: v })}
                placeholder="e.g. warm, premium, a little playful"
                testId="input-brief-feel"
                expand={{ field: 'Brand voice and feel', context: expandContext, words: 26 }}
              />
            </div>

            {studio.visualReference ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: T.sub,
                  border: `1px solid ${T.accentBorder}`,
                  background: T.accentSoft,
                }}
                data-testid="note-visual-reference"
              >
                <Sparkles size={14} color={T.accentFg} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong style={{ color: T.text, fontWeight: 600 }}>Read from your image.</strong> Every scene is
                  drawn to match it — {studio.visualReference}
                </span>
              </div>
            ) : null}

            {studio.images.length > 0 ? (
              <div>
                <FieldLabel hint="Up to 4 — they become visual references for the render.">Product images</FieldLabel>
                <div className="rc-mobile-scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 12 }}>
                  {studio.images.slice(0, 8).map((img) => {
                    const selected = studio.selectedImages.includes(img.url);
                    return (
                      <button
                        key={img.url}
                        type="button"
                        onClick={() => toggleImage(img.url)}
                        aria-pressed={selected}
                        className="rc-lift-hover rc-press rc-ring"
                        style={{
                          position: 'relative',
                          aspectRatio: '1 / 1',
                          borderRadius: 14,
                          overflow: 'hidden',
                          padding: 0,
                          cursor: 'pointer',
                          background: '#000',
                          border: selected ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                          boxShadow: selected ? '0 0 0 3px rgba(59,130,246,0.16)' : 'none',
                        }}
                        data-testid="button-product-image"
                      >
                        <img
                          src={img.url}
                          alt={img.alt || 'product'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {selected ? (
                          <span style={{ position: 'absolute', top: 8, right: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, color: '#fff', background: T.accent, boxShadow: '0 4px 12px rgba(0,0,0,0.35)' }}>
                            <Check size={14} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <FieldLabel hint="Optional — an offer, an audience, a feature to lead with.">
                Anything else the video should hit?
              </FieldLabel>
              <TextArea
                value={studio.idea}
                onChange={setIdea}
                rows={2}
                placeholder="e.g. lead with the launch offer, aimed at first-time buyers"
                testId="input-idea"
                expand={{ field: 'What the video should get across', context: expandContext, words: 60 }}
              />
            </div>
          </Card>
        )}

        {/* ---- Format ---- */}
        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Format</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <Chip selected={studio.aspect === '9:16'} onClick={() => setAspect('9:16')} testId="chip-aspect-vertical">
              Vertical
            </Chip>
            <Chip selected={studio.aspect === '16:9'} onClick={() => setAspect('16:9')} testId="chip-aspect-wide">
              Wide
            </Chip>
            <span style={{ width: 1, alignSelf: 'stretch', background: T.border, margin: '0 4px' }} />
            {LENGTHS.map((l) => (
              <Chip
                key={l.id}
                selected={studio.lengthId === l.id}
                onClick={() => setLength(l.id as LengthId)}
                testId={`chip-length-${l.id}`}
              >
                {l.sub}
              </Chip>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {TONES.map((t) => (
              <Chip
                key={t.id}
                selected={studio.toneId === t.id}
                onClick={() => setTone(t.id)}
                testId={`chip-tone-${t.id}`}
              >
                {t.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* Character reference and product mockup stay optional, but are visible
            here in the URL → summary → references → generate flow. */}
        <AddOns />

        {studio.error ? (
          <ErrorNotice>
            <span style={{ flex: 1 }}>{studio.error}</span>
            <TextLink
              onClick={() => void (fromUrl && studio.url ? refetchBrief() : startOver())}
              testId="button-retry-brief"
              style={{ minHeight: 32, padding: '2px 6px', color: T.danger, fontWeight: 700, flexShrink: 0 }}
            >
              {fromUrl && studio.url ? 'Retry' : 'Start over'}
            </TextLink>
          </ErrorNotice>
        ) : null}

        {/* ---- The one action that spends credits ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ModelPicker value={studio.model} onChange={setModel} />

          <p
            style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center' }}
            data-testid="text-planned-length"
          >
            About {plannedSeconds}s of finished video — {plan.sceneCount} clips of {plan.sceneSeconds}s.
          </p>

          <PrimaryButton
            onClick={() => void generateVideo()}
            disabled={!canGenerate || generating}
            full
            testId="button-generate-video"
            style={{ minHeight: 56, padding: '16px 24px', fontSize: 16, borderRadius: 14, letterSpacing: -0.2 }}
          >
            {generating ? <Loader2 size={17} className="rc-spin" /> : <Wand2 size={17} />}
            {generating ? 'Preparing your video…' : 'Generate video ✨'}
          </PrimaryButton>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
            <TextLink
              onClick={openStoryboard}
              testId="link-review-storyboard"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Film size={12} /> Review the storyboard first
            </TextLink>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.6 }}>
            Renders take 2–6 minutes and include sound — your character speaks the script on camera, over music and ambience.{' '}
            You can switch tabs, open another app, or close this screen — it keeps going and the finished video
            waits for you here.
          </p>
        </div>
      </div>
    </div>
  );
}
