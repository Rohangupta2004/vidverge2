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
 *   4  Video             a 30-45s script written from the read-out, filmed by
 *                        Veo and finished by Remotion with the brand graphics.
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
import { Archive, BarChart3, Ghost, Plus } from 'lucide-react';
import { ownerKey } from './api';
import {
  Analysis, Competitor, Insights, Matrix, Profile, SavedSummary,
  autoName, emptyAnalysis, includedCompetitors, listSaved, loadAnalysis,
  recordHandoff, removeAnalysis, saveAnalysis,
} from './store';
import { DEFAULT_ACCENT, INK, LINE, MONO, SPIN_CSS, TEXT, TEXT_DIM, TEXT_MUTED, normalizeHex, rgba } from './theme';
import { AccentProvider, Button, Notice, Breadcrumb, Pill, useAccent } from './ui';
import { openVidvergeStudio, saveVidvergeHandoff } from '../../lib/vidvergeHandoff';
import BrandScreen from './screens/BrandScreen';
import CompetitorsScreen from './screens/CompetitorsScreen';
import CompareScreen from './screens/CompareScreen';
import VideoScreen from './screens/VideoScreen';
import SavedScreen from './screens/SavedScreen';

type ScreenId = 'brand' | 'competitors' | 'compare' | 'video';

const STEPS: Array<{ id: ScreenId; label: string }> = [
  { id: 'brand', label: 'Your brand' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'compare', label: 'Compare' },
  { id: 'video', label: 'Video' },
];

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
        <Ghost size={19} style={{ color: accent }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: 1.7, color: TEXT }}>VERGEYE</div>
        <div style={{ fontSize: 10.4, color: TEXT_MUTED, fontFamily: MONO, letterSpacing: 0.5 }}>
          {analysis.brandName ? autoName(analysis.brandName, analysis.competitors) : 'Competitive positioning'}
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

export default function VergeyeApp() {
  const [analysis, setAnalysis] = useState<Analysis>(emptyAnalysis);
  const [screen, setScreen] = useState<ScreenId>('brand');
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<SavedSummary[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [handoffNote, setHandoffNote] = useState('');

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

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const patch = useCallback((next: Partial<Analysis>) => {
    setAnalysis((prev) => ({ ...prev, ...next }));
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
  const onInsights = (insights: Insights) => patch({ insights, status: 'compared' });

  const openSaved = async (id: number) => {
    setError('');
    try {
      const loaded = await loadAnalysis(id);
      setAnalysis(loaded);
      live.current = loaded;
      setShowSaved(false);
      setScreen(
        loaded.scriptPlan || loaded.videoUrl ? 'video'
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

  /**
   * Hand the finished script to Ads Studio. The hand-off is recorded on the
   * saved comparison so there is a durable record of what was sent, and passed
   * through the shell's own hand-off channel so Ads Studio actually opens on
   * step 1 with the script already in it.
   */
  const useInAdsStudio = async () => {
    const current = live.current;
    const script = current.scriptPlan?.script || current.script;
    if (!script) return;
    setHandoffNote('');
    try {
      if (current.id) await recordHandoff(current.id, 'ads-studio');
      saveVidvergeHandoff({
        appId: 'ads-studio',
        prompt: [
          `${current.brandName || 'Our product'} — competitive positioning ad.`,
          current.brandUrl,
          '',
          script,
        ].filter(Boolean).join('\n'),
        attachment: current.mockupUrl
          ? { url: current.mockupUrl, name: 'product-mockup.png', type: 'image/png' }
          : null,
      });
      patch({ handoff: { app: 'ads-studio', at: new Date().toISOString() } });
      openVidvergeStudio('ads-studio');
    } catch (e: any) {
      setHandoffNote(`The script could not be handed over: ${String(e?.message || e)}`);
    }
  };

  const reachable = (id: ScreenId): boolean => {
    if (id === 'brand') return true;
    if (id === 'competitors') return !!analysis.brand;
    if (id === 'compare') return includedCompetitors(analysis).length > 0;
    return !!analysis.matrix;
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
    />
  ) : screen === 'competitors' && analysis.brand ? (
    <CompetitorsScreen
      brand={analysis.brand}
      competitors={analysis.competitors}
      onCompetitors={onCompetitors}
      onContinue={() => setScreen('compare')}
    />
  ) : screen === 'compare' && analysis.brand ? (
    <CompareScreen
      brand={analysis.brand}
      competitors={includedCompetitors(analysis)}
      matrix={analysis.matrix}
      insights={analysis.insights}
      onMatrix={onMatrix}
      onInsights={onInsights}
      onContinue={() => setScreen('video')}
    />
  ) : screen === 'video' && analysis.brand ? (
    <VideoScreen
      analysis={analysis}
      brand={analysis.brand}
      competitors={includedCompetitors(analysis)}
      insights={analysis.insights}
      matrix={analysis.matrix}
      onPatch={patch}
      onUseInAdsStudio={useInAdsStudio}
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
    />
  );

  return (
    <AccentProvider accent={accent}>
      <div
        className="vergeye-app"
        style={{
          minHeight: '100%',
          background: `radial-gradient(ellipse 90% 55% at 12% -8%, ${rgba(accent, 0.1)} 0%, transparent 58%), ${INK}`,
          color: TEXT,
          fontFamily: 'inherit',
        }}
      >
        <style>{SPIN_CSS}</style>

        <div className="vergeye-pad" style={{ maxWidth: 1420, margin: '0 auto', padding: '26px 30px 60px' }}>
          <Header
            analysis={analysis}
            onSaved={() => setShowSaved(!showSaved)}
            savedCount={saved.length}
            showingSaved={showSaved}
            onNew={startNew}
            saving={saving}
          />

          {!showSaved ? (
            <div style={{ marginBottom: 22 }}>
              <Breadcrumb steps={STEPS} current={screen} reachable={reachable} onJump={(id) => setScreen(id as ScreenId)} />
            </div>
          ) : null}

          {error ? <Notice tone="bad">{error}</Notice> : null}
          {handoffNote ? <Notice tone="bad">{handoffNote}</Notice> : null}

          {body}

          <div style={{
            marginTop: 34, paddingTop: 16, borderTop: `1px solid ${LINE}`,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            fontSize: 11.4, color: TEXT_MUTED,
          }}>
            <BarChart3 size={13} />
            <span style={{ color: TEXT_DIM }}>
              Everything Vergeye says comes from each product&apos;s own public website, read at the time you ran the analysis.
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: MONO, opacity: 0.7 }}>{ownerKey().slice(0, 10)}</span>
          </div>
        </div>
      </div>
    </AccentProvider>
  );
}
