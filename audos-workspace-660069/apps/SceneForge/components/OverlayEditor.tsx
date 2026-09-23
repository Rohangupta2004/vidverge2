// OVERLAY EDITOR — post-generation editing of the film's FIRST-CLASS overlay
// elements (text, labels, lower thirds, stats, citations, arrows, circles,
// highlights). Overlays live on each scene's `overlays` column and are
// composed above the scene visual by the ONE assembly composition, so an edit
// here NEVER regenerates an AI clip, an image or the HeyGen master — applying
// changes re-renders only the final composition from the existing assets.
//
// Edit → save (draft version bumps) → validate → re-render → the new output
// replaces the previous one only after it completes, verifies and passes the
// checks (App.completeAssembly owns that promotion).

import { ArrowUpRight, Circle as CircleIcon, Highlighter, Plus, Quote, RefreshCw, Save, Trash2, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { updateScene, type Project, type Scene } from '../lib/supabase';
import { OVERLAY_ELEMENT_TYPES, OVERLAY_POSITION_PRESETS, normalizeOverlays, type OverlayElementType, type SceneOverlayElement } from '../lib/directorPlan';

const TYPE_ICON: Partial<Record<OverlayElementType, typeof Type>> = { arrow: ArrowUpRight, circle: CircleIcon, highlight: Highlighter, citation: Quote };

function newOverlay(type: OverlayElementType, sceneKey: string, count: number, windowSec: number): SceneOverlayElement {
  const preset = type === 'lower_third' ? OVERLAY_POSITION_PRESETS.lower_third : type === 'stat' ? OVERLAY_POSITION_PRESETS.center : OVERLAY_POSITION_PRESETS.bottom_right;
  return {
    id: `${sceneKey}-ov-${Date.now().toString(36)}`,
    type,
    text: type === 'arrow' || type === 'circle' || type === 'highlight' ? '' : 'New overlay',
    x_pct: preset.x,
    y_pct: preset.y,
    ...(type === 'arrow' ? { target_x_pct: 50, target_y_pct: 40 } : {}),
    scale: 1,
    z_index: 10 + count,
    start_offset_sec: 0,
    duration_sec: Math.max(1, Math.min(3, windowSec)),
    anim_in: type === 'arrow' || type === 'circle' ? 'draw' : 'rise',
    anim_out: 'fade',
  };
}

function Num({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <label className="flex items-center gap-2 text-xs text-[var(--space-text-muted)]">
    <span className="w-16 shrink-0">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1 flex-1 accent-[var(--space-brand-primary-500)]" />
    <span className="w-10 text-right font-mono text-[var(--space-text-secondary)]">{value}</span>
  </label>;
}

export default function OverlayEditor({ project, scenes, busy, onSaved, onReRender }: {
  project: Project;
  scenes: Scene[];
  busy: boolean;
  /** Called after a save lands — the parent bumps the DirectorPlan draft version. */
  onSaved: () => void;
  /** Re-render ONLY the composition (existing assets are reused as-is). */
  onReRender: () => void;
}) {
  const middle = scenes.filter((scene) => scene.status !== 'skipped').sort((a, b) => a.scene_index - b.scene_index);
  const [sceneId, setSceneId] = useState(middle[0]?.id || '');
  const [draft, setDraft] = useState<SceneOverlayElement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const scene = middle.find((row) => row.id === sceneId) || middle[0] || null;
  const windowSec = scene ? Math.max(0.5, Number(scene.script_end_sec) - Number(scene.script_start_sec)) : 4;

  useEffect(() => {
    if (!scene) return;
    setDraft(normalizeOverlays(scene.overlays, scene.id));
    setDirty(false);
    setNote('');
  }, [scene?.id]);

  if (!scene) return null;

  const patchOverlay = (id: string, changes: Partial<SceneOverlayElement>) => {
    setDraft((all) => all.map((item) => item.id === id ? { ...item, ...changes } : item));
    setDirty(true);
  };
  const removeOverlay = (id: string) => { setDraft((all) => all.filter((item) => item.id !== id)); setDirty(true); };
  const addOverlay = (type: OverlayElementType) => { setDraft((all) => [...all, newOverlay(type, scene.id, all.length, windowSec)]); setDirty(true); };

  const save = async () => {
    setSaving(true); setNote('');
    try {
      const cleaned = normalizeOverlays(draft, scene.id);
      await updateScene(scene.id, { overlays: cleaned as unknown as Record<string, unknown>[] }, project.id);
      setDraft(cleaned);
      setDirty(false);
      setNote('Overlays saved. Re-render the composition to bake them into the film — no AI or HeyGen asset is regenerated.');
      onSaved();
    } catch (error: any) {
      setNote(error?.message || 'The overlays could not be saved.');
    } finally { setSaving(false); }
  };

  return <div>
    <div className="flex flex-wrap items-center gap-2">
      <select value={scene.id} onChange={(event) => setSceneId(event.target.value)} aria-label="Scene to edit" className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-2 text-sm text-[var(--space-text-primary)]">
        {middle.map((row) => <option key={row.id} value={row.id}>Scene {row.scene_index} · {Number(row.script_start_sec).toFixed(1)}–{Number(row.script_end_sec).toFixed(1)}s</option>)}
      </select>
      <div className="flex flex-wrap gap-1.5">
        {OVERLAY_ELEMENT_TYPES.map(({ id, label }) => {
          const Icon = TYPE_ICON[id] || Type;
          return <button key={id} onClick={() => addOverlay(id)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)] hover:text-[var(--space-text-primary)]"><Plus className="h-3 w-3" /><Icon className="h-3 w-3" />{label}</button>;
        })}
      </div>
    </div>

    {!draft.length ? <p className="mt-4 rounded-xl border border-dashed border-[var(--space-border-default)] p-4 text-sm text-[var(--space-text-muted)]">No overlay elements on this scene yet — add a label, citation, arrow or highlight above.</p> : null}

    <div className="mt-3 space-y-3">
      {draft.map((overlay) => <div key={overlay.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-brand)]">{overlay.type.replace('_', ' ')}</span>
          {overlay.type !== 'arrow' && overlay.type !== 'circle' && overlay.type !== 'highlight'
            ? <input value={overlay.text || ''} onChange={(event) => patchOverlay(overlay.id, { text: event.target.value })} placeholder="Overlay text" className="min-w-40 flex-1 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-sm text-[var(--space-text-primary)]" />
            : <input value={overlay.text || ''} onChange={(event) => patchOverlay(overlay.id, { text: event.target.value })} placeholder="Optional caption" className="min-w-40 flex-1 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-sm text-[var(--space-text-primary)]" />}
          <button aria-label="Delete overlay" onClick={() => removeOverlay(overlay.id)} className="rounded-lg p-1.5 text-[var(--space-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_14%,transparent)] hover:text-[var(--space-semantic-danger)]"><Trash2 className="h-4 w-4" /></button>
        </div>
        {overlay.type === 'citation' ? <input value={overlay.source || ''} onChange={(event) => patchOverlay(overlay.id, { source: event.target.value })} placeholder="Source — e.g. World Bank, 2024" className="mt-2 w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-sm text-[var(--space-text-primary)]" /> : null}
        {overlay.type === 'lower_third' || overlay.type === 'stat' ? <input value={overlay.subtext || ''} onChange={(event) => patchOverlay(overlay.id, { subtext: event.target.value })} placeholder="Supporting line" className="mt-2 w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-sm text-[var(--space-text-primary)]" /> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Num label="X %" value={Math.round(overlay.x_pct)} min={0} max={100} step={1} onChange={(v) => patchOverlay(overlay.id, { x_pct: v })} />
          <Num label="Y %" value={Math.round(overlay.y_pct)} min={0} max={100} step={1} onChange={(v) => patchOverlay(overlay.id, { y_pct: v })} />
          {overlay.type === 'arrow' ? <>
            <Num label="Tip X %" value={Math.round(overlay.target_x_pct ?? 50)} min={0} max={100} step={1} onChange={(v) => patchOverlay(overlay.id, { target_x_pct: v })} />
            <Num label="Tip Y %" value={Math.round(overlay.target_y_pct ?? 40)} min={0} max={100} step={1} onChange={(v) => patchOverlay(overlay.id, { target_y_pct: v })} />
          </> : null}
          <Num label="Size" value={Number(overlay.scale.toFixed(2))} min={0.5} max={2} step={0.05} onChange={(v) => patchOverlay(overlay.id, { scale: v })} />
          <Num label="Layer" value={overlay.z_index} min={1} max={40} step={1} onChange={(v) => patchOverlay(overlay.id, { z_index: v })} />
          <Num label="Start s" value={Number(overlay.start_offset_sec.toFixed(1))} min={0} max={Math.max(0, Math.round((windowSec - 0.4) * 10) / 10)} step={0.1} onChange={(v) => patchOverlay(overlay.id, { start_offset_sec: v })} />
          <Num label="Length s" value={Number(overlay.duration_sec.toFixed(1))} min={0.4} max={Math.round(windowSec * 10) / 10} step={0.1} onChange={(v) => patchOverlay(overlay.id, { duration_sec: v })} />
        </div>
      </div>)}
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button disabled={!dirty || saving} onClick={() => void save()} className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save overlay changes'}</button>
      <button disabled={busy || dirty} onClick={onReRender} title={dirty ? 'Save the overlay changes first' : 'Re-render the composition with the saved overlays'} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--space-text-primary)] disabled:opacity-40"><RefreshCw className="h-4 w-4" />Re-render composition only</button>
      <span className="text-xs text-[var(--space-text-muted)]">Overlay edits never regenerate AI video, images or the presenter — only the final composition re-renders, and the previous film stays until the new one passes its checks.</span>
    </div>
    {note ? <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{note}</p> : null}
  </div>;
}
