/**
 * VERGEYE — competitive positioning, from your own URL to a finished video.
 *
 * FOUR SCREENS, ONE OBJECT. The whole app is a single `Analysis` that each
 * screen adds a layer to:
 *
 *   1  Your brand        a URL is read into an editable brand profile, and the
 *                        accent for every later surface is taken from the site.
 *   2  Competitors       three Google searches name the rivals, then each one's
 *                        site is read; include or exclude whoever you like.
 *   3  Compare           a seven-row table with every cell filled from those
 *                        reads, editable, exportable as a PNG, with the
 *                        positioning read-out beside it.
 *   4  Strategize        ranked CreativeBriefs become style-specific scripts
 *                        and enter the shared five-stage Script-to-Video engine.
 *
 * WHY THE SAVE IS AUTOMATIC AND DEBOUNCED. Each screen is minutes of real
 * research and real wallet spend, so losing it to a closed tab would be the
 * worst failure this app has. Every change to the analysis writes the row
 * through vergeye-ops a second later, under an auto-generated name, which is
 * also what makes the Saved tab a history rather than a cache.
 *
 * WHAT IS DELIBERATELY NOT HERE. Nothing in this app is a dead control. There
 * is no screen that depends on a credential the workspace has not got, and no
 * step that parks waiting for a human — if a competitor's site refuses to be
 * read, the card says so and the column is dropped.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, BarChart3, Plus, Target } from 'lucide-react';
import { ownerKey } from './api';
import {
  Analysis, Competitor, Insights, Matrix, Profile, SavedSummary,
  autoName, emptyAnalysis, includedCompetitors, listSaved, loadAnalysis,
  removeAnalysis, saveAnalysis,
} from './store';
import { DEFAULT_ACCENT, INK, LINE, MONO, SPIN_CSS, TEXT, TEXT_DIM, TEXT_MUTED, normalizeHex, rgba } from './theme';
import { AccentProvider, Button, Notice, Pill, useAccent } from './ui';
import { openVidvergeStudio } from '../../lib/vidvergeHandoff';
import AppShell from '../../components/ui/AppShell';
import { withBrandContext } from '../../components/BrandContextLayer';
import { useBrandContext } from '../../components/brandContextStore';
import { VideoHistory } from '../../components/VideoHistory';
import BrandScreen from './screens/BrandScreen';
import CompetitorsScreen from './screens/CompetitorsScreen';
import CompareScreen from './screens/CompareScreen';
import SavedScreen from './screens/SavedScreen';
import CreativeStrategyScreen from '../AdsStudio/CreativeStrategyScreen';
import { emptyCreativeStrategy, upgradeCreativeStrategy, type CreativeStrategyState } from '../AdsStudio/creativeStrategy';

type ScreenId = 'brand' | 'competitors' | 'compare' | 'strategize';

const PRODUCT_STAGES = [
  { id: 'discover', label: 'Discover', state: 'ready' },
  { id: 'research', label: 'Research', state: 'ready' },
  { id: 'strategize', label: 'Strategize', state: 'ready' },
  { id: 'create', label: 'Create', state: 'engine' },
  { id: 'edit', label: 'Edit', state: 'engine' },
] as const;

function Header({
  analysis, onSaved, savedCount, showingSaved, onNew, saving,
}: {
  analysis: Analysis;
  onSaved: () => void;
  savedCount: number;
  showingSaved: boolean;
  onNew: () => void;
  saving: boolean;
}) {
  const accent = useAccent();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      paddingBottom: 18, marginBottom: 20, borderBottom: `1px solid ${LINE}`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
        background: rgba(accent, 0.15), border: `1px solid ${rgba(accent, 0.4)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Target size={19} style={{ color: accent }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: 1.7, color: TEXT }}>VERGEYE ADS STUDIO</div>
        <div style={{ fontSize: 10.4, color: TEXT_MUTED, fontFamily: MONO, letterSpacing: 0.5 }}>
          {analysis.brandName ? autoName(analysis.brandName, analysis.competitors) : 'Research intelligence → one production engine'}
        </div>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        {saving ? <Pill tone="accent">Saving</Pill> : analysis.id ? <Pill tone="good">Saved</Pill> : null}
        {analysis.brand ? (
          <Button small onClick={onNew}><Plus size={13} /> New</Button>
        ) : null}
        <Button small variant={showingSaved ? 'primary' : 'ghost'} onClick={onSaved}>
          <Archive size={13} /> Saved{savedCount > 0 ? ` (${savedCount})` : ''}
        </Button>
      </div>
    </div>
  );
}

const BrandedVergeyeApp = withBrandContext(VergeyeApp, 'Vergeye Ads Studio', { useBrand: true });
export default BrandedVergeyeApp;
export function VergeyeApp(_props: { onOpenCreate?: () => void } = {}) {
  const [analysis, setAnalysis] = useState<Analysis>(emptyAnalysis);
  const [screen, setScreen] = useState<ScreenId>('brand');
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<SavedSummary[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { save: saveBrandContext } = useBrandContext();

  const live = useRef(analysis);
  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => { live.current = analysis; }, [analysis]);

  const accent = normalizeHex(analysis.accentColor) || DEFAULT_ACCENT;

  const refreshSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      setSaved(await listSaved());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => { refreshSaved(); }, [refreshSaved]);

  /**
   * One debounced write per burst of edits. The row id comes back on the first
   * insert and every later write updates that row, so a long session is one
   * comparison rather than a trail of near-duplicates.
   */
  const scheduleSave = useCallback(() => {
    dirty.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const current = live.current;
      if (!current.brand) return;
      setSaving(true);
      try {
        const named: Analysis = {
          ...current,
          name: current.name || autoName(current.brandName, current.competitors),
        };
        const id = await saveAnalysis(named);
        dirty.current = false;
        if (id && id !== current.id) {
          setAnalysis((prev) => ({ ...prev, id, name: named.name }));
        }
        refreshSaved();
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setSaving(false);
      }
    }, 1200);
  }, [refreshSaved]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!dirty.current || !live.current.brand) return;
    const current = live.current;
    void saveAnalysis({
      ...current,
      name: current.name || autoName(current.brandName, current.competitors),
    }).catch(() => { /* the next open keeps the local handoff; autosave remains best-effort */ });
  }, []);

  const patch = useCallback((next: Partial<Analysis>) => {
    setAnalysis((prev) => {
      const merged = { ...prev, ...next };
      live.current = merged;
      return merged;
    });
    scheduleSave();
  }, [scheduleSave]);

  const onBrand = (brand: Profile, foundAccent: string) => {
    patch({
      brand,
      brandName: brand.name,
      brandUrl: brand.url,
      accentColor: normalizeHex(foundAccent) || normalizeHex(analysis.accentColor) || '',
      status: analysis.status === 'brand' ? 'brand' : analysis.status,
    });
  };

  const onCompetitors = (competitors: Competitor[]) => {
    patch({
      competitors,
      status: competitors.some((c) => c.fetched) ? 'competitors' : analysis.status,
      name: autoName(live.current.brandName, competitors),
    });
  };

  const onMatrix = (matrix: Matrix) => patch({ matrix, status: 'compared' });
  const onInsights = (insights: Insights) => patch({
    insights: { ...insights, creativeStrategy: live.current.insights?.creativeStrategy },
    status: 'compared',
  });

  const openSaved = async (id: number) => {
    setError('');
    try {
      const loaded = await loadAnalysis(id);
      setAnalysis(loaded);
      live.current = loaded;
      setShowSaved(false);
      setScreen(
        loaded.insights?.creativeStrategy?.campaignGoal ? 'strategize'
          : loaded.matrix ? 'compare'
            : loaded.competitors.length > 0 ? 'competitors'
              : 'brand',
      );
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const deleteSaved = async (id: number) => {
    setError('');
    try {
      await removeAnalysis(id);
      if (id === live.current.id) {
        const fresh = emptyAnalysis();
        setAnalysis(fresh);
        live.current = fresh;
        setScreen('brand');
      }
      refreshSaved();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const startNew = () => {
    const fresh = emptyAnalysis();
    setAnalysis(fresh);
    live.current = fresh;
    setScreen('brand');
    setShowSaved(false);
  };

  const openCreate = () => {
    // Phase 3 invariant: Vergeye orchestrates strategy, while every paid video
    // project is created by the existing five-stage Script-to-Video engine.
    // The mature Ads Studio implementation remains source-compatible but is no
    // longer a second Vergeye renderer, queue, storyboard or editor.
    openVidvergeStudio('script-to-video');
  };

  const openExistingApp = (appId: string) => {
    openVidvergeStudio(appId === 'ads-studio' ? 'script-to-video' : appId);
  };

  const updateCreativeStrategy = (creativeStrategy: CreativeStrategyState) => {
    const current = live.current.insights || {
      competitorsBetter: [], yourAdvantages: [], positioningGaps: [], messagingImprovements: [],
    };
    patch({ insights: { ...current, creativeStrategy } });
  };

  const approveBrand = async (brand: Profile) => {
    const verified = brand.fetched ? 'VERIFIED from public source' : 'AI-INFERRED / manual — human approved';
    const context = [
      `Brand Name: ${brand.name || ''}`,
      `Tagline: ${brand.tagline || ''}`,
      `Source: ${brand.url || 'manual description'} (${verified})`,
      `Category: ${brand.category || ''}`,
      `Audience: ${brand.audience || ''}`,
      `Products: ${(brand.features || []).join(', ')}`,
      `Positioning: ${brand.positioning || brand.usp || ''}`,
      `Pricing: ${brand.pricing || 'Not public'}`,
      `Colors: ${(brand.colors || []).join(', ') || brand.accent || ''}`,
      `Logo: ${brand.logoUrl || 'Not found'}`,
      `Human review: Approved in Vergeye Ads Studio on ${new Date().toISOString()}`,
    ].join('\n');
    await saveBrandContext(context);
  };

  const body = showSaved ? (
    <SavedScreen
      saved={saved}
      loading={loadingSaved}
      currentId={analysis.id}
      onOpen={openSaved}
      onRemove={deleteSaved}
      onRefresh={refreshSaved}
      onNew={startNew}
    />
  ) : screen === 'brand' ? (
    <BrandScreen
      brand={analysis.brand}
      brandUrl={analysis.brandUrl}
      accent={accent}
      onUrlChange={(brandUrl) => patch({ brandUrl })}
      onBrand={onBrand}
      onAccent={(next) => patch({ accentColor: normalizeHex(next) })}
      onContinue={() => setScreen('competitors')}
      onQuickStart={openCreate}
      onApprove={approveBrand}
    />
  ) : screen === 'competitors' && analysis.brand ? (
    <CompetitorsScreen
      brand={analysis.brand}
      competitors={analysis.competitors}
      onCompetitors={onCompetitors}
      onContinue={() => setScreen('compare')}
      onSkip={() => setScreen('strategize')}
    />
  ) : screen === 'compare' && analysis.brand ? (
    <CompareScreen
      brand={analysis.brand}
      competitors={includedCompetitors(analysis)}
      matrix={analysis.matrix}
      insights={analysis.insights}
      onMatrix={onMatrix}
      onInsights={onInsights}
      onContinue={() => setScreen('strategize')}
    />
  ) : screen === 'strategize' && analysis.brand ? (
    <CreativeStrategyScreen
      brand={analysis.brand}
      competitors={includedCompetitors(analysis)}
      insights={analysis.insights}
      strategy={upgradeCreativeStrategy(analysis.insights?.creativeStrategy || emptyCreativeStrategy())}
      onChange={updateCreativeStrategy}
      onBackToResearch={() => setScreen(analysis.matrix ? 'compare' : 'competitors')}
      onOpenApp={openExistingApp}
    />
  ) : (
    <BrandScreen
      brand={analysis.brand}
      brandUrl={analysis.brandUrl}
      accent={accent}
      onUrlChange={(brandUrl) => patch({ brandUrl })}
      onBrand={onBrand}
      onAccent={(next) => patch({ accentColor: normalizeHex(next) })}
      onContinue={() => setScreen('competitors')}
      onQuickStart={openCreate}
      onApprove={approveBrand}
    />
  );

  return (
    <AccentProvider accent={accent}>
      {/* The app keeps its own accent-driven header: the accent is read off the
          customer's site, so the title block has to wear their brand, not the
          shared amber one. The shell supplies the ground, beams and grid. */}
      <AppShell
        title="Vergeye Ads Studio"
        header={false}
        watermark={false}
        maxWidth={1420}
        className="vergeye-app"
        style={{
          background: `radial-gradient(ellipse 90% 55% at 12% -8%, ${rgba(accent, 0.1)} 0%, transparent 58%), ${INK}`,
          color: TEXT,
        }}
      >
        <style>{SPIN_CSS}</style>

        <div className="vergeye-pad">
          <Header
            analysis={analysis}
            onSaved={() => setShowSaved(!showSaved)}
            savedCount={saved.length}
            showingSaved={showSaved}
            onNew={startNew}
            saving={saving}
          />

          {!showSaved ? (
            <nav aria-label="Vergeye workflow" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 22, paddingBottom: 3 }}>
              {PRODUCT_STAGES.map((stage) => {
                const active = stage.id === 'discover' ? screen === 'brand'
                  : stage.id === 'research' ? (screen === 'competitors' || screen === 'compare')
                    : stage.id === 'strategize' ? screen === 'strategize'
                      : false;
                const disabled = (stage.id === 'research' || stage.id === 'strategize') && !analysis.brand;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (stage.id === 'discover') setScreen('brand');
                      else if (stage.id === 'research' && analysis.brand) setScreen(analysis.matrix ? 'compare' : 'competitors');
                      else if (stage.id === 'strategize' && analysis.brand) setScreen('strategize');
                      else if (stage.id === 'create') openCreate();
                      else if (stage.id === 'edit') openExistingApp('video-enhancer');
                    }}
                    style={{ minWidth: 118, minHeight: 44, padding: '9px 12px', borderRadius: 10, border: `1px solid ${active ? rgba(accent, 0.48) : LINE}`, background: active ? rgba(accent, 0.13) : 'transparent', color: disabled ? TEXT_MUTED : active ? TEXT : TEXT_DIM, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12.5, fontWeight: 650 }}
                  >
                    {stage.label}{disabled ? <span style={{ display: 'block', marginTop: 2, fontSize: 9.5, fontFamily: MONO }}>BRAND FIRST</span> : null}
                  </button>
                );
              })}
            </nav>
          ) : null}

          {error ? <Notice tone="bad">{error}</Notice> : null}

          {body}

          <div style={{
            marginTop: 34, paddingTop: 16, borderTop: `1px solid ${LINE}`,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            fontSize: 11.4, color: TEXT_MUTED,
          }}>
            <BarChart3 size={13} />
            <span style={{ color: TEXT_DIM }}>
              Verified findings link to the public source read during this run. Inferences and hypotheses are labelled for human review; unavailable sources stay unavailable rather than being invented.
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: MONO, opacity: 0.7 }}>{ownerKey().slice(0, 10)}</span>
          </div>

          <div style={{ marginTop: 28 }}>
            <VideoHistory />
          </div>
        </div>
      </AppShell>
    </AccentProvider>
  );
}
