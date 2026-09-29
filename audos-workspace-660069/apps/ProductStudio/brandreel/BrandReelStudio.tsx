/**
 * BRAND REEL STUDIO — the Product Video app's first screen.
 *
 * Owns all four gates and the state that flows between them:
 *
 *   1  URL          → ps-brand-scrape → Claude → Brand Object
 *   2  Brand Summary → confirm/edit → six storyboard variants
 *   3  Select a variant → the storyboard, every frame DRAWN IN CODE
 *   4  Generate → Remotion composition → server render → MP4
 *
 * There is no image-generation step. Scene visuals are the customer's own
 * screenshot in a drawn browser frame, or a Remotion motion graphic built
 * from their own strings — see sceneGraphics.tsx (preview) and
 * composition.ts (render).
 *
 * The render survives tab switches and reloads: its operation id is persisted
 * and polling resumes on mount, the same contract the Remotion Studio tab uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Music, Radio, Sparkles } from 'lucide-react';
import type { BrandObject, BrandTheme, ScriptVariant } from './types';
import { brandTheme } from './types';
import {
  buildBrandObject, errorText, pollRender, scrapeBrand, submitRender, writeScriptVariants,
} from './api';
import { BRAND_REEL_TSX, buildReelProps } from './composition';
import { PV_MUSIC_BEDS } from '../remotionCompositions';
import BrandIntake from './BrandIntake';
import StoryboardColumns from './StoryboardColumns';
import MockupBoard from './MockupBoard';
import { Card, REEL_CSS, SectionLabel, StepRail } from './ui';
import { LB_SHIMMER_CSS } from '../../../components/LightBeam';
import { writeProductContext } from '../../../lib/productContext';

const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const RENDER_KEY = 'ps-brandreel-render-v1';
const STEPS = ['Your site', 'Pick a script', 'Preview & render'];

/** The studio's own look before a client brand exists — VidVerge amber. */
const HOUSE_BRAND = { primaryColor: '#f59e0b', secondaryColor: '#0d1220', fontFamily: 'Inter' };

type Step = 'intake' | 'scripts' | 'mockups';

interface StoredRender { operationId?: string; renderUrl?: string; ts?: number }

function readStoredRender(): StoredRender | null {
  try {
    const raw = window.localStorage.getItem(RENDER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredRender(state: StoredRender | null) {
  try {
    if (!state) window.localStorage.removeItem(RENDER_KEY);
    else window.localStorage.setItem(RENDER_KEY, JSON.stringify({ ...state, ts: Date.now() }));
  } catch {
    /* storage unavailable — the render still completes server-side */
  }
}

/** Narration for the whole reel, recorded from the scenes' own voiceover lines. */
async function recordNarration(variant: ScriptVariant): Promise<string> {
  const script = variant.scenes.map((s) => s.voiceover).filter(Boolean).join(' ').slice(0, 2000);
  if (!script) return '';
  const token = String((window as any).__workspaceDb?.token || '');
  if (!token) return '';
  const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ script }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.audioUrl) throw new Error(String(data?.error || `The voiceover service answered HTTP ${res.status}.`));
  return String(data.audioUrl);
}

export default function BrandReelStudio() {
  const [step, setStep] = useState<Step>('intake');
  const [url, setUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [brand, setBrand] = useState<BrandObject | null>(null);
  const [scrapeNotes, setScrapeNotes] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState('');
  const [intakeError, setIntakeError] = useState('');

  const [variants, setVariants] = useState<ScriptVariant[]>([]);
  const [variant, setVariant] = useState<ScriptVariant | null>(null);
  const [writing, setWriting] = useState(false);
  const [scriptError, setScriptError] = useState('');

  const [rendering, setRendering] = useState(false);
  const [renderNote, setRenderNote] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const [renderError, setRenderError] = useState('');

  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9');
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [musicBedId, setMusicBedId] = useState<string>('inspiring');
  const [narration, setNarration] = useState<'off' | 'on'>('off');

  const aliveRef = useRef(true);
  const resumedRef = useRef(false);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const theme: BrandTheme = useMemo(() => brandTheme(brand || HOUSE_BRAND), [brand]);

  // A render started earlier — even in a closed tab — picks back up here.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const stored = readStoredRender();
    if (!stored) return;
    if (stored.renderUrl && Date.now() - (stored.ts || 0) < 24 * 3600 * 1000) {
      setRenderUrl(stored.renderUrl);
      setStep('mockups');
      return;
    }
    if (!stored.operationId || Date.now() - (stored.ts || 0) > 30 * 60 * 1000) return;
    setStep('mockups');
    setRendering(true);
    setRenderNote('Picking up the render you already started…');
    void (async () => {
      try {
        let out = await pollRender(stored.operationId as string);
        while (aliveRef.current && out?.status === 'rendering' && out.operationId) {
          out = await pollRender(out.operationId);
        }
        if (!aliveRef.current) return;
        if (out?.status === 'complete' && out.renderUrl) {
          setRenderUrl(out.renderUrl);
          writeStoredRender({ renderUrl: out.renderUrl });
        } else {
          writeStoredRender(null);
          setRenderError(String(out?.error || 'That render did not finish.'));
        }
      } catch (e) {
        if (aliveRef.current) setRenderError(errorText(e));
      } finally {
        if (aliveRef.current) { setRendering(false); setRenderNote(''); }
      }
    })();
  }, []);

  // ---- step 1 -------------------------------------------------------------

  const scan = useCallback(async () => {
    const target = url.trim();
    if (!target || scanning) return;
    setScanning(true);
    setIntakeError('');
    setModelNote('');
    setScrapeNotes([]);
    try {
      setScanNote('Reading the page and pulling your copy, colours and images…');
      const scrape = await scrapeBrand(target);
      setScanNote('Working out what your product is and who it is for…');
      const { brand: built, answer } = await buildBrandObject(scrape);
      setBrand(built);
      // Hand the product on to the other surfaces — the Runway panels open
      // already knowing the name, tagline and hero shot instead of asking again.
      writeProductContext({ name: built.name, description: built.tagline, imageUrl: built.heroImageUrl || built.screenshotUrl });
      setScrapeNotes(scrape.notes);
      setModelNote(answer.degradedFrom ? 'The primary writer was unavailable, so the backup writer created this summary.' : '');
    } catch (e) {
      setIntakeError(errorText(e));
    } finally {
      setScanning(false);
      setScanNote('');
    }
  }, [url, scanning]);

  const patchBrand = useCallback((patch: Partial<BrandObject>) => {
    setBrand((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const resetToIntake = useCallback(() => {
    setBrand(null);
    setVariants([]);
    setVariant(null);
    setRenderUrl('');
    setRenderError('');
    setIntakeError('');
    setStep('intake');
    writeStoredRender(null);
  }, []);

  // ---- step 2 -------------------------------------------------------------

  const writeScripts = useCallback(async (target: BrandObject) => {
    setStep('scripts');
    setWriting(true);
    setScriptError('');
    setVariants([]);
    setVariant(null);
    try {
      const { variants: written, answer } = await writeScriptVariants(target, aspect);
      setVariants(written);
      setModelNote(answer.degradedFrom ? 'The primary writer was unavailable, so the backup writer created these scripts.' : '');
    } catch (e) {
      setScriptError(errorText(e));
    } finally {
      setWriting(false);
    }
  }, [aspect]);

  // ---- step 3 -------------------------------------------------------------
  // Nothing to generate: the storyboard draws itself from the chosen script.

  const selectVariant = useCallback((chosen: ScriptVariant) => {
    if (!brand) return;
    setVariant(chosen);
    setStep('mockups');
    setRenderUrl('');
    setRenderError('');
    writeStoredRender(null);
  }, [brand]);

  // ---- step 4 -------------------------------------------------------------

  const generateVideo = useCallback(async () => {
    if (!brand || !variant || rendering) return;
    setRendering(true);
    setRenderError('');
    setRenderUrl('');
    try {
      let voiceoverUrl = '';
      if (narration === 'on') {
        setRenderNote('Recording the narration…');
        try {
          voiceoverUrl = await recordNarration(variant);
        } catch (e) {
          setRenderError(`The reel is rendering without narration — ${errorText(e)}`);
        }
      }

      setRenderNote('Rendering your reel…');
      const { props, durationInFrames } = buildReelProps(brand, variant, [], {
        captionsEnabled,
        musicUrl: PV_MUSIC_BEDS.find((m) => m.id === musicBedId)?.url || '',
        voiceoverUrl,
      });

      let out = await submitRender(BRAND_REEL_TSX, props as unknown as Record<string, unknown>, durationInFrames);
      if (out?.operationId) writeStoredRender({ operationId: out.operationId });
      while (aliveRef.current && out?.status === 'rendering' && out.operationId) {
        out = await pollRender(out.operationId);
      }
      if (!aliveRef.current) return;
      if (out?.status === 'complete' && out.renderUrl) {
        setRenderUrl(out.renderUrl);
        writeStoredRender({ renderUrl: out.renderUrl });
      } else {
        writeStoredRender(null);
        throw new Error(String(out?.error || 'The render failed.'));
      }
    } catch (e) {
      if (aliveRef.current) setRenderError(errorText(e));
    } finally {
      if (aliveRef.current) { setRendering(false); setRenderNote(''); }
    }
  }, [brand, variant, rendering, narration, captionsEnabled, musicBedId]);

  const currentStepIndex = step === 'intake' ? 0 : step === 'scripts' ? 1 : 2;

  const finishRow = (
    <Card theme={theme} style={{ padding: 13 }}>
      <details>
        <summary style={{ cursor: 'pointer', color: theme.text, fontSize: 12.5, fontWeight: 800, listStylePosition: 'inside' }}>
          Advanced <span style={{ color: theme.textMuted, fontWeight: 500 }}>— captions, narration and music</span>
        </summary>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Radio size={14} style={{ color: theme.primary }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: theme.textMuted, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={captionsEnabled} onChange={(e) => setCaptionsEnabled(e.target.checked)} data-testid="toggle-captions" />
            Burned-in captions
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Sparkles size={14} style={{ color: theme.primary }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: theme.textMuted, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={narration === 'on'}
              onChange={(e) => setNarration(e.target.checked ? 'on' : 'off')}
              data-testid="toggle-narration"
            />
            Record the voiceover
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 'auto' }}>
          <Music size={14} style={{ color: theme.primary }} />
          <select
            value={musicBedId}
            onChange={(e) => setMusicBedId(e.target.value)}
            data-testid="select-music-bed"
            style={{
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 9,
              color: theme.text, fontSize: 12.5, padding: '7px 10px', fontFamily: 'inherit',
            }}
          >
            <option value="">No music bed</option>
            {PV_MUSIC_BEDS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>
      </details>
    </Card>
  );

  const productionStatus = step === 'mockups' ? (
    <Card theme={theme} style={{ padding: 13 }}>
      <details>
        <summary style={{ cursor: 'pointer', color: theme.text, fontSize: 12.5, fontWeight: 800, listStylePosition: 'inside' }}>
          Production status <span style={{ color: theme.textMuted, fontWeight: 500 }}>— {renderNote || (renderUrl ? 'Video ready' : renderError ? 'Needs attention' : 'Waiting for you to start the render')}</span>
        </summary>
        <div style={{ marginTop: 11, display: 'grid', gap: 6, color: theme.textMuted, fontSize: 12.5, lineHeight: 1.45 }}>
          <div>✓ Site and brand reviewed</div>
          <div>✓ Script selected and storyboard ready</div>
          <div>{rendering ? `• ${renderNote || 'Rendering your reel…'}` : renderUrl ? '✓ Final video rendered' : renderError ? `• ${renderError}` : '• Waiting for you to choose Generate video'}</div>
        </div>
      </details>
    </Card>
  ) : null;

  return (
    <div style={{ padding: 'clamp(12px, 2.4vw, 22px)', display: 'flex', flexDirection: 'column', gap: 15 }}>
      <style>{REEL_CSS}{LB_SHIMMER_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StepRail theme={theme} steps={STEPS} current={currentStepIndex} />
        {step === 'intake' && !brand ? (
          <details style={{ marginLeft: 'auto' }}>
            <summary style={{ cursor: 'pointer', color: theme.textMuted, fontSize: 12, fontWeight: 700, listStylePosition: 'inside' }}>
              Advanced <span style={{ fontWeight: 500 }}>— format: {aspect === '16:9' ? 'Widescreen' : 'Vertical'}</span>
            </summary>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
              <SectionLabel theme={theme}>Format</SectionLabel>
              {(['16:9', '9:16'] as const).map((a) => (
              <button
                key={a}
                type="button"
                className="br-btn"
                onClick={() => setAspect(a)}
                data-testid={`button-aspect-${a.replace(':', '-')}`}
                style={{
                  padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                  border: aspect === a ? theme.borderStrong : '1px solid rgba(255,255,255,0.1)',
                  background: aspect === a ? theme.primarySoft : 'rgba(255,255,255,0.04)',
                  color: aspect === a ? theme.primary : theme.textMuted,
                }}
              >
                {a === '16:9' ? 'Widescreen 16:9' : 'Vertical 9:16'}
              </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {step === 'intake' ? (
        <BrandIntake
          theme={theme}
          url={url}
          onUrlChange={setUrl}
          scanning={scanning}
          scanNote={scanNote}
          error={intakeError}
          brand={brand}
          onScan={scan}
          onBrandChange={patchBrand}
          onConfirm={() => brand && writeScripts(brand)}
          onRescan={resetToIntake}
          modelNote={modelNote}
          scrapeNotes={scrapeNotes}
          confirming={writing}
        />
      ) : step === 'scripts' ? (
        <StoryboardColumns
          theme={theme}
          variants={variants}
          selectedId={variant?.id || ''}
          writing={writing}
          error={scriptError}
          modelNote={modelNote}
          onSelect={selectVariant}
          onRegenerate={() => brand && writeScripts(brand)}
          onBack={() => setStep('intake')}
        />
      ) : brand && variant ? (
        <>
          {finishRow}
          {productionStatus}
          <MockupBoard
            theme={theme}
            brand={brand}
            variant={variant}
            onBack={() => { setRenderUrl(''); writeStoredRender(null); setStep('scripts'); }}
            onGenerate={generateVideo}
            rendering={rendering}
            renderNote={renderNote}
            renderUrl={renderUrl}
            error={renderError}
          />
        </>
      ) : (
        <Card theme={theme}>
          <div style={{ color: theme.textMuted, fontSize: 13 }}>
            That reel is no longer in memory. Scan your URL again to start a new one.
          </div>
        </Card>
      )}
    </div>
  );
}
