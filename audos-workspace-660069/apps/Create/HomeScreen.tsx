/**
 * Screen 1 — the hero.
 *
 * ONE thing on the page: a big centred TEXTAREA that takes a one-line idea, a
 * product URL, or a full pasted multi-scene script — with the three mode pills
 * (Standard | Sports Series | Product) directly under it. Everything technical
 * or secondary (the agentic mode selector, reference uploads, the screenshot
 * animator, the classic storyboard flow, the older builders) lives behind one
 * quiet "⚙ Advanced" disclosure, hidden by default.
 *
 * WHAT PRESSING CREATE DOES:
 *   - a pasted multi-scene SPORTS script routes straight into Sports & Events
 *     with the script pre-filled (same detection the chat uses),
 *   - a URL starts the AGENTIC pipeline from that page's brief,
 *   - anything else starts the agentic pipeline from the typed idea.
 * The visitor still confirms the whole shot list on the plan screen before a
 * credit is spent. The classic scene-by-scene flow stays one tap away under
 * Advanced.
 */
import { useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Megaphone,
  MonitorSmartphone,
  Paperclip,
  Settings,
  Sparkles,
  Trophy,
  Wand2,
  X,
} from 'lucide-react';
import MyVideos from './MyVideos';
import ModeSelector from './ModeSelector';
import { uploadImage } from './studioApi';
import { setHomeDraft, setMode, startFromIdea, startFromUrl, useVideoStudio } from './videoStore';
import { detectSportsScript, setSportsScript } from './sportsRunner';
import {
  planProduction,
  setProductionInputs,
  setRequestedMode,
  shotsDone,
  useProduction,
} from './agenticRunner';
import { getMode } from './agenticTypes';
import { ErrorNotice, FONT, PrimaryButton, SparkleExpand, T, TextLink } from './ui';

/** A single line with a real hostname reads as a URL; everything else is a brief. */
function looksLikeUrl(text: string): boolean {
  if (!text || /\s/.test(text)) return false;
  try {
    const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/** The three top-level pills. Standard is the default and stays selected here. */
const MODE_PILLS = [
  { id: 'standard' as const, label: 'Standard', icon: Wand2 },
  { id: 'sports' as const, label: 'Sports Series', icon: Trophy },
  { id: 'product' as const, label: 'Product', icon: Megaphone },
];

export default function HomeScreen() {
  const studio = useVideoStudio();
  const production = useProduction();
  // The hero draft lives in the STORE, not in component state: a tab switch,
  // the mobile shell's hidden second copy of this app, and a full reload all
  // keep a half-typed brief (persisted via vidverge_create_state in the
  // store's debounced form mirror). `url` survives from an analyzed page;
  // `idea` holds typed text — setHomeDraft writes the draft back.
  const value = studio.url || studio.idea;
  const setValue = setHomeDraft;
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const screenshotRef = useRef<HTMLInputElement | null>(null);
  const busy = reading || studio.fetching;
  const referenceImages = production.inputs.productImageUrls || [];

  const validated = (): string | null => {
    const text = value.trim();
    if (!text) {
      setFieldError('Describe your video, paste a script, or drop a product URL to continue.');
      return null;
    }
    setFieldError('');
    setError(null);
    return text;
  };

  /**
   * The default path: a sports script goes straight to Sports & Events
   * pre-filled; a URL or idea hands the brief to the agentic pipeline.
   */
  const submit = () => {
    const text = validated();
    if (!text) return;
    if (detectSportsScript(text).verdict === 'sports') {
      setSportsScript(text);
      setMode('sports');
      return;
    }
    if (looksLikeUrl(text)) setProductionInputs({ source: 'url', url: text, brief: '' });
    else setProductionInputs({ source: 'idea', url: '', brief: text });
    setMode('agentic');
    void planProduction();
  };

  /** The classic scene-by-scene storyboard flow, kept one tap away (Advanced). */
  const submitClassic = () => {
    const text = validated();
    if (!text) return;
    if (looksLikeUrl(text)) void startFromUrl(text);
    else startFromIdea(text);
  };

  /** Upload up to ten visual references without turning any one of them into the whole brief. */
  const handleReferenceFiles = async (files: File[]) => {
    const remaining = Math.max(0, 10 - referenceImages.length);
    const selected = files.filter((file) => file.type.startsWith('image/')).slice(0, remaining);
    if (selected.length === 0) return;
    setError(null);
    setReading(true);
    try {
      const uploaded = await Promise.all(selected.map((file) => uploadImage(file, 'references')));
      setProductionInputs({ productImageUrls: [...referenceImages, ...uploaded].slice(0, 10) });
    } catch (e: any) {
      setError((e && e.message) || 'Those references could not be uploaded — try them again.');
    }
    setReading(false);
  };

  const removeReference = (url: string) => {
    setProductionInputs({ productImageUrls: referenceImages.filter((item) => item !== url) });
  };

  /** A product screenshot routes straight to UI Motion — see the mode router. */
  const handleScreenshot = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const url = await uploadImage(file, 'mockups');
      setProductionInputs({
        source: 'screenshot',
        screenshotUrl: url,
        brief: value.trim() || production.inputs.brief,
        url: looksLikeUrl(value.trim()) ? value.trim() : production.inputs.url,
      });
      setMode('agentic');
      void planProduction();
    } catch (e: any) {
      setError((e && e.message) || 'That screenshot could not be uploaded — try another one.');
    }
    setReading(false);
  };

  // A production that is already running (or finished) must be findable from
  // here: its board lives in another mode, so without this the visitor would
  // have no way back to a run that is still spending.
  const liveProduction =
    production.shots.length > 0 && production.phase !== 'setup' && production.phase !== 'plan'
      ? production
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100%' }}>
      {liveProduction ? (
        <button
          type="button"
          onClick={() => setMode('agentic')}
          className="rc-lift rc-press rc-ring"
          data-testid="bar-agentic-production"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            minHeight: 56,
            marginBottom: 24,
            padding: '12px 16px',
            borderRadius: 14,
            cursor: 'pointer',
            textAlign: 'left',
            border: `1px solid ${liveProduction.phase === 'done' ? 'rgba(74,222,128,0.32)' : T.accentBorder}`,
            background: liveProduction.phase === 'done' ? 'rgba(74,222,128,0.07)' : T.accentSoft,
          }}
        >
          <Sparkles
            size={15}
            color={liveProduction.phase === 'done' ? T.success : T.accentFg}
            style={{ flexShrink: 0 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>
              {liveProduction.phase === 'done'
                ? `“${liveProduction.title || 'Your production'}” is cut`
                : liveProduction.phase === 'paused'
                  ? `“${liveProduction.title || 'Your production'}” is paused`
                  : `Producing “${liveProduction.title || 'your video'}”…`}
            </span>
            <span style={{ display: 'block', marginTop: 1, fontSize: 11.5, color: T.muted }}>
              {getMode(liveProduction.mode).label} · {shotsDone(liveProduction)} of {liveProduction.shots.length} shots
            </span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.accentFg, flexShrink: 0 }}>Open →</span>
        </button>
      ) : null}

      <div
        className="rc-fade"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'min(64vh, 700px)',
          textAlign: 'center',
          padding: 'clamp(24px, 6vh, 64px) 0',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 12px',
            marginBottom: 26,
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: T.accentFg,
            border: `1px solid ${T.accentBorder}`,
            background: T.accentSoft,
          }}
        >
          <Sparkles size={12} /> AI video studio
        </span>

        <h1
          className="rc-grad-text"
          style={{
            margin: 0,
            fontSize: 'clamp(22px, 5vw, 28px)',
            fontWeight: 750,
            letterSpacing: -0.8,
            lineHeight: 1.15,
          }}
        >
          What are we making today?
        </h1>
        <p
          style={{
            margin: '14px 0 30px',
            maxWidth: 460,
            fontSize: 15,
            lineHeight: 1.6,
            color: T.sub,
          }}
        >
          Drop a product URL, describe an idea, or paste a full multi-scene script — we script, cast and
          render it with the same character in every shot.
        </p>

        {/* THE input — the biggest, brightest thing on the screen, deliberately.
            Everything else here is a quiet link; this is the product. */}
        <div
          className="rc-glow"
          style={{
            width: '100%',
            padding: 6,
            borderRadius: 20,
            background: fieldError
              ? 'linear-gradient(135deg, rgba(248,113,113,0.55), rgba(127,29,29,0.2))'
              : 'linear-gradient(135deg, rgba(37,99,235,0.34), rgba(59,130,246,0.18) 45%, rgba(45,212,191,0.22))',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 8,
              borderRadius: 17,
              background: 'rgba(10,15,30,0.88)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <textarea
              className={`rc-hero-input${fieldError ? ' rc-input-error' : ''}`}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (fieldError) setFieldError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Describe your video or paste a full script..."
              autoFocus
              rows={value.split('\n').length > 3 ? Math.min(10, value.split('\n').length) : 3}
              aria-label="Your video idea, product URL, or full script"
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? 'hero-input-error' : undefined}
              data-testid="input-hero-url"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '14px 16px',
                borderRadius: 13,
                border: '1px solid transparent',
                background: 'transparent',
                color: T.text,
                fontSize: 15.5,
                lineHeight: 1.55,
                fontFamily: FONT,
                outline: 'none',
                resize: 'vertical',
                minHeight: 84,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              {value ? (
                <button
                  type="button"
                  className="rc-quiet rc-ring"
                  onClick={() => {
                    setValue('');
                    setFieldError('');
                  }}
                  aria-label="Clear input"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 36, padding: '4px 8px' }}
                >
                  <X size={13} /> Clear
                </button>
              ) : (
                <span />
              )}
              <PrimaryButton
                onClick={submit}
                disabled={busy}
                testId="button-hero-start"
                style={{ minHeight: 50, padding: '14px 26px', fontSize: 16, borderRadius: 13 }}
              >
                {studio.fetching ? <Loader2 size={17} className="rc-spin" /> : null}
                {studio.fetching ? 'Analyzing…' : 'Create'} {studio.fetching ? null : <ArrowRight size={17} />}
              </PrimaryButton>
            </div>
          </div>
        </div>
        {fieldError ? (
          <p id="hero-input-error" role="alert" style={{ width: '100%', margin: '10px 0 0', textAlign: 'left', color: T.danger, fontSize: 13, lineHeight: 1.5 }}>
            {fieldError}
          </p>
        ) : null}

        {/* THE MODE PILLS — the one visible mode decision: Standard is the
            default; Sports Series and Product open their dedicated builders. */}
        <div
          role="radiogroup"
          aria-label="Studio mode"
          style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 20 }}
          data-testid="home-mode-pills"
        >
          {MODE_PILLS.map((pill) => {
            const Icon = pill.icon;
            const selected = pill.id === 'standard';
            return (
              <button
                key={pill.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  if (pill.id === 'sports') {
                    // Carry a pasted script with them so nothing is retyped.
                    const text = value.trim();
                    if (text && !looksLikeUrl(text)) setSportsScript(text);
                    setMode('sports');
                  } else if (pill.id === 'product') {
                    setMode('product-ad');
                  }
                }}
                className="rc-press rc-ring"
                data-testid={`pill-mode-${pill.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  minHeight: 44,
                  padding: '9px 16px',
                  borderRadius: 999,
                  fontFamily: FONT,
                  fontSize: 13.5,
                  fontWeight: selected ? 700 : 600,
                  cursor: 'pointer',
                  color: selected ? '#fff' : T.sub,
                  border: selected ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
                  background: selected
                    ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%)'
                    : 'transparent',
                  boxShadow: selected ? '0 8px 24px -12px rgba(37,99,235,0.8)' : 'none',
                  transition: 'all .16s ease',
                }}
              >
                <Icon size={14} />
                {pill.label}
              </button>
            );
          })}
        </div>

        {/* A typed idea is worth expanding before it becomes a script. */}
        {value.trim() && !looksLikeUrl(value.trim()) && value.trim().length < 220 ? (
          <div className="rc-fade" style={{ marginTop: 14 }}>
            <SparkleExpand
              value={value}
              onChange={setValue}
              spec={{
                field: 'Video idea',
                words: 60,
                label: 'Expand this idea with AI',
              }}
              testId="button-expand-hero-idea"
            />
          </div>
        ) : null}

        {referenceImages.length > 0 ? (
          <div
            className="rc-mobile-scroll rc-fade"
            style={{ display: 'flex', width: '100%', gap: 10, marginTop: 14, overflowX: 'auto', paddingBottom: 2 }}
            data-testid="strip-create-references"
          >
            {referenceImages.map((url, index) => (
              <div key={url} style={{ position: 'relative', width: 68, height: 68, flex: '0 0 68px' }}>
                <img
                  src={url}
                  alt={`Visual reference ${index + 1}`}
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', borderRadius: 12, border: `1px solid ${T.border}` }}
                />
                <button
                  type="button"
                  onClick={() => removeReference(url)}
                  aria-label={`Remove reference ${index + 1}`}
                  className="rc-iconbtn rc-ring"
                  style={{ position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 999, border: 0, background: 'rgba(0,0,0,0.72)', color: '#fff', cursor: 'pointer' }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {referenceImages.length < 10 ? (
              <button
                type="button"
                onClick={() => !busy && fileRef.current?.click()}
                className="rc-iconbtn rc-ring"
                aria-label="Add more visual references"
                style={{ width: 68, height: 68, flex: '0 0 68px', borderRadius: 12, border: `1px dashed ${T.borderStrong}`, background: T.panel, color: T.accentFg, cursor: busy ? 'wait' : 'pointer' }}
              >
                {reading ? <Loader2 size={17} className="rc-spin" /> : <ImagePlus size={17} />}
              </button>
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onClick={(event) => { event.currentTarget.value = ''; }}
          onChange={(event) => void handleReferenceFiles(Array.from(event.target.files || []))}
        />
        <input
          ref={screenshotRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => void handleScreenshot(e.target.files && e.target.files[0])}
        />

        {/* ⚙ ADVANCED — every technical control and secondary entry point,
            hidden by default so the hero stays a single obvious action. */}
        <div style={{ width: '100%', marginTop: 26, textAlign: 'left' }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="rc-quiet rc-ring"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, fontSize: 12.5 }}
            aria-expanded={advancedOpen}
            data-testid="button-toggle-home-advanced"
          >
            <Settings size={13} /> Advanced {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          {advancedOpen ? (
            <div className="rc-fade" style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 12 }}>
              <div>
                <ModeSelector
                  value={production.requestedMode}
                  onChange={setRequestedMode}
                  label="Agentic pipeline mode"
                  compact
                />
                <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.6, color: T.muted }}>
                  {production.requestedMode === 'auto'
                    ? 'AUTO reads your brief, picks the mode, and routes every single shot to the engine that can deliver it.'
                    : getMode(production.requestedMode).blurb}{' '}
                  You confirm the whole shot list before anything renders.
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                <TextLink
                  onClick={() => !busy && referenceImages.length < 10 && fileRef.current?.click()}
                  testId="link-upload-image"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {reading ? <Loader2 size={13} className="rc-spin" /> : <Paperclip size={13} />}
                  {reading
                    ? 'Uploading references…'
                    : referenceImages.length > 0
                      ? `References · ${referenceImages.length}/10`
                      : 'Reference images'}
                </TextLink>
                <TextLink
                  onClick={() => !busy && screenshotRef.current && screenshotRef.current.click()}
                  testId="link-upload-screenshot"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <MonitorSmartphone size={13} /> Animate a product screenshot
                </TextLink>
                <TextLink onClick={submitClassic} testId="link-classic-flow">
                  Use the classic storyboard flow
                </TextLink>
              </div>

              <div>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: 0.7, textTransform: 'uppercase', color: T.muted }}>
                  Older builders
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <TextLink onClick={() => setMode('long')} testId="tab-mode-long">
                    Long video · multi-scene
                  </TextLink>
                  <TextLink onClick={() => setMode('series')} testId="tab-mode-series">
                    Series · many clips
                  </TextLink>
                  <TextLink onClick={() => setMode('episodes')} testId="tab-mode-episodes">
                    Long series · episodes
                  </TextLink>
                  <TextLink
                    onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'videos' } }))}
                    testId="link-open-library"
                  >
                    My videos
                  </TextLink>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginTop: 18, maxWidth: 520, width: '100%' }}>
            <ErrorNotice>
              <span style={{ flex: 1 }}>{error}</span>
              <TextLink
                onClick={() => fileRef.current?.click()}
                testId="button-retry-image"
                style={{ minHeight: 32, padding: '2px 6px', color: T.danger, fontWeight: 700, flexShrink: 0 }}
              >
                Try another
              </TextLink>
            </ErrorNotice>
          </div>
        ) : null}
      </div>

      <MyVideos refreshKey={studio.job && studio.job.phase === 'ready' ? 1 : 0} />
    </div>
  );
}
