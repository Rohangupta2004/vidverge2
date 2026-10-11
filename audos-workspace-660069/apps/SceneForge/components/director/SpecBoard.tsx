// STEP 3 — the scene plan, as the customer reviews and edits it.
//
// Every field the LLM wrote is editable here, because the director is a good
// first pass and never the last word. Each card shows the ACTUAL graphic
// looping beside its fields, so a change is judged on the picture rather than
// on the JSON. The raw JSON is one click away for anyone who would rather
// edit it directly.
import { useMemo, useState } from 'react';
import { Braces, ChevronDown, ChevronUp, Code2, Copy, Plus, Trash2 } from 'lucide-react';
import { VISUAL_TYPES, AVATAR_PLACEMENTS, normalizeSceneSpec, sequenceSpecs, totalDurationSec, type SceneSpec, type VisualType } from '../../lib/sceneSpec';
import SceneThumb from './SceneThumb';

export interface SpecBoardProps {
  specs: SceneSpec[];
  accent: string;
  onChange: (specs: SceneSpec[]) => void;
  /** Disabled while a render is in flight — the plan is already committed. */
  readOnly?: boolean;
}

const TYPE_HINT: Record<VisualType, string> = {
  text_reveal: 'The label is the hero. A number in it counts up.',
  diagram: 'Elements: the subject first, then its parts.',
  timeline: 'Elements: one event each, written “YEAR Label”.',
  chart: 'Data points drive the bars or the curve; elements label them.',
  orbit: 'Elements: [centre, orbiter]. Label is the duration.',
  flow: 'Elements are the stages in order; animation names what travels.',
  map: 'Elements[0] is the place.',
  image_kenburns: 'Image prompt decides the photograph.',
  callout: 'Elements[0] is what is pointed at; label names it.',
  highlight: 'Label is the word that flares inside the caption.',
};

const field = 'w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-base)] px-3 py-2 text-sm outline-none focus:border-[var(--space-brand-primary-500)]';
const labelText = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]';

export default function SpecBoard({ specs, accent, onChange, readOnly = false }: SpecBoardProps) {
  const [expanded, setExpanded] = useState<number | null>(specs.length ? specs[0].scene : null);
  const [jsonMode, setJsonMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [jsonError, setJsonError] = useState('');

  const total = useMemo(() => totalDurationSec(specs), [specs]);
  const mix = useMemo(() => {
    const counts = new Map<string, number>();
    specs.forEach((spec) => counts.set(spec.visual.type, (counts.get(spec.visual.type) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [specs]);

  const patch = (scene: number, change: Partial<SceneSpec>, visualChange?: Partial<SceneSpec['visual']>) => {
    onChange(sequenceSpecs(specs.map((spec) => (spec.scene === scene
      ? { ...spec, ...change, visual: { ...spec.visual, ...(visualChange || {}) } }
      : spec))));
  };

  const removeScene = (scene: number) => onChange(sequenceSpecs(specs.filter((spec) => spec.scene !== scene)));

  const duplicateScene = (scene: number) => {
    const index = specs.findIndex((spec) => spec.scene === scene);
    if (index < 0) return;
    const copy = { ...specs[index], visual: { ...specs[index].visual } };
    onChange(sequenceSpecs([...specs.slice(0, index + 1), copy, ...specs.slice(index + 1)]));
  };

  const openJson = () => {
    setDraft(JSON.stringify(specs, null, 2));
    setJsonError('');
    setJsonMode(true);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(draft);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('The plan must be a non-empty array of scenes.');
      onChange(sequenceSpecs(parsed.map(normalizeSceneSpec)));
      setJsonMode(false);
    } catch (e: any) {
      setJsonError(String(e?.message || e));
    }
  };

  if (!specs.length) return null;

  return (
    <section className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Scene plan</h3>
          <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">
            {specs.length} scenes · {total.toFixed(1)}s · {mix.map(([type, count]) => `${count} ${type.replace(/_/g, ' ')}`).join(', ')}
          </p>
        </div>
        <button onClick={jsonMode ? () => setJsonMode(false) : openJson} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-xs font-semibold">
          {jsonMode ? <><Code2 className="h-3.5 w-3.5" />Cards</> : <><Braces className="h-3.5 w-3.5" />JSON</>}
        </button>
      </header>

      {jsonMode ? (
        <div className="mt-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="h-[420px] w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-base)] p-3 font-mono text-xs outline-none"
          />
          {jsonError ? <p className="mt-2 text-xs text-[var(--space-semantic-danger-500)]">{jsonError}</p> : null}
          <div className="mt-3 flex gap-2">
            <button onClick={applyJson} disabled={readOnly} className="rounded-lg bg-[var(--space-brand-primary-600)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Apply plan</button>
            <button onClick={() => setJsonMode(false)} className="rounded-lg border border-[var(--space-border-default)] px-4 py-2 text-sm font-semibold">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {specs.map((spec) => {
            const open = expanded === spec.scene;
            return (
              <article key={spec.scene} className="overflow-hidden rounded-xl border border-[var(--space-border-default)]">
                <button onClick={() => setExpanded(open ? null : spec.scene)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--space-brand-primary-500)_16%,transparent)] text-xs font-bold">{spec.scene}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{spec.caption || spec.narration}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--space-text-muted)]">
                      {spec.visual.type.replace(/_/g, ' ')} · {spec.startSec.toFixed(1)}s – {(spec.startSec + spec.durationSec).toFixed(1)}s · narrator {spec.avatar.replace(/_/g, ' ')}
                    </span>
                  </span>
                  {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>

                {open ? (
                  <div className="grid gap-4 border-t border-[var(--space-border-default)] p-3 lg:grid-cols-[320px_1fr]">
                    <div>
                      <SceneThumb spec={spec} accent={accent} />
                      <p className="mt-2 text-[11px] leading-relaxed text-[var(--space-text-muted)]">{TYPE_HINT[spec.visual.type]}</p>
                      {!readOnly ? (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => duplicateScene(spec.scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold"><Copy className="h-3 w-3" />Duplicate</button>
                          <button onClick={() => removeScene(spec.scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--space-semantic-danger-500)]"><Trash2 className="h-3 w-3" />Remove</button>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className={labelText}>Visual</span>
                        <select disabled={readOnly} value={spec.visual.type} onChange={(event) => patch(spec.scene, {}, { type: event.target.value as VisualType })} className={`${field} mt-1`}>
                          {VISUAL_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelText}>Narrator</span>
                        <select disabled={readOnly} value={spec.avatar} onChange={(event) => patch(spec.scene, { avatar: event.target.value as SceneSpec['avatar'] })} className={`${field} mt-1`}>
                          {AVATAR_PLACEMENTS.map((placement) => <option key={placement} value={placement}>{placement.replace(/_/g, ' ')}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelText}>Label</span>
                        <input disabled={readOnly} value={spec.visual.label || ''} onChange={(event) => patch(spec.scene, {}, { label: event.target.value })} className={`${field} mt-1`} placeholder="365 DAYS" />
                      </label>
                      <label className="block">
                        <span className={labelText}>Duration (s)</span>
                        <input disabled={readOnly} type="number" min={1.6} max={14} step={0.2} value={spec.durationSec} onChange={(event) => patch(spec.scene, { durationSec: Math.max(1.6, Math.min(14, Number(event.target.value) || spec.durationSec)) })} className={`${field} mt-1`} />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className={labelText}>Elements (comma separated)</span>
                        <input disabled={readOnly} value={spec.visual.elements.join(', ')} onChange={(event) => patch(spec.scene, {}, { elements: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) })} className={`${field} mt-1`} placeholder="heart, arteries, blood" />
                      </label>
                      {spec.visual.type === 'chart' ? (
                        <label className="block sm:col-span-2">
                          <span className={labelText}>Data points (comma separated numbers)</span>
                          <input disabled={readOnly} value={(spec.visual.dataPoints || []).join(', ')} onChange={(event) => patch(spec.scene, {}, { dataPoints: event.target.value.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isFinite(entry)) })} className={`${field} mt-1`} placeholder="10000, 11000, 12100, 13310" />
                        </label>
                      ) : null}
                      {spec.visual.type === 'image_kenburns' ? (
                        <label className="block sm:col-span-2">
                          <span className={labelText}>Image prompt</span>
                          <input disabled={readOnly} value={spec.visual.imagePrompt || ''} onChange={(event) => patch(spec.scene, {}, { imagePrompt: event.target.value, imageUrl: '' })} className={`${field} mt-1`} placeholder="Crowd outside the Red Fort, August 1947" />
                        </label>
                      ) : null}
                      <label className="block sm:col-span-2">
                        <span className={labelText}>Caption</span>
                        <input disabled={readOnly} value={spec.caption || ''} onChange={(event) => patch(spec.scene, { caption: event.target.value })} className={`${field} mt-1`} />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className={labelText}>Narration (read by the presenter)</span>
                        <textarea disabled={readOnly} value={spec.narration} onChange={(event) => patch(spec.scene, { narration: event.target.value })} rows={2} className={`${field} mt-1`} />
                      </label>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}

          {!readOnly ? (
            <button
              onClick={() => onChange(sequenceSpecs([...specs, normalizeSceneSpec({ scene: specs.length + 1, durationSec: 4, narration: '', visual: { type: 'text_reveal', elements: [] }, avatar: 'small_right', caption: '' }, specs.length)]))}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--space-border-default)] py-2.5 text-sm font-semibold text-[var(--space-text-muted)] hover:border-[var(--space-brand-primary-500)]"
            >
              <Plus className="h-4 w-4" />Add a scene
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
