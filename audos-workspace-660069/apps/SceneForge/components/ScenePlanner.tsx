import { Image, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { IMAGE_MODELS } from '../agents/imageAgent';
import type { Scene } from '../lib/supabase';

interface Props {
  scenes: Scene[];
  duration: number;
  share: 'low' | 'medium' | 'high';
  onShare: (value: 'low' | 'medium' | 'high') => void;
  imageModel: string;
  onImageModel: (value: string) => void;
  onPatch: (id: string, patch: Partial<Scene>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onUpload: (scene: Scene, file: File) => void;
  onGenerateImage: (scene: Scene) => void;
  generatingSceneId?: string | null;
  onGenerate: () => void;
}
export default function ScenePlanner(props: Props) {
  const { scenes, duration, share, onShare, imageModel, onImageModel, onPatch, onRemove, onAdd, onUpload, onGenerateImage, generatingSceneId, onGenerate } = props;
  const approved = scenes.filter((scene) => scene.approved).length;
  return <div className="mx-auto max-w-6xl px-6 py-9">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 5 · Scene plan</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Balance presenter and visuals</h1>
    <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="mb-3 flex items-center justify-between text-sm text-[var(--space-text-secondary)]"><span>Avatar timeline · {duration.toFixed(1)} seconds</span><span>{approved} of {scenes.length} approved</span></div>
      <div className="relative h-16 overflow-hidden rounded-xl bg-[var(--space-surface-muted)]">
        <div className="absolute inset-y-0 left-0 w-[5%] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_25%,transparent)]" />
        {scenes.map((scene) => <div key={scene.id} title={'Scene ' + scene.scene_index + ': ' + scene.description} className="absolute inset-y-2 rounded-lg bg-[var(--space-brand-highlight-600)]" style={{ left: (scene.script_start_sec / duration * 100) + '%', width: Math.max(1, (scene.script_end_sec - scene.script_start_sec) / duration * 100) + '%' }} />)}
        <span className="absolute bottom-1 left-2 text-[10px] text-[var(--space-text-muted)]">First 5 seconds always stay on avatar</span>
      </div>
      <div className="mt-4 flex gap-2">{(['low', 'medium', 'high'] as const).map((value) => <button key={value} onClick={() => onShare(value)} className={share === value ? 'rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-sm capitalize text-white' : 'rounded-lg bg-[var(--space-surface-card)] px-3 py-2 text-sm capitalize text-[var(--space-text-secondary)]'}>{value} · {value === 'low' ? '30%' : value === 'medium' ? '50%' : '65%'}</button>)}</div>
    </div>
    <div className="mt-5 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div><p className="font-semibold text-[var(--space-text-primary)]">Scene image model</p><p className="mt-1 text-sm text-[var(--space-text-secondary)]">Choose the picture maker for previews and final scene assets. Existing model choices remain available.</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{IMAGE_MODELS.map((model) => <button key={model.id} type="button" onClick={() => onImageModel(model.id)} className={imageModel === model.id ? 'rounded-xl border border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent)] p-4 text-left' : 'rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 text-left'}><span className="block font-semibold text-[var(--space-text-primary)]">{model.label}</span><span className="mt-1 block text-xs text-[var(--space-text-muted)]">{model.detail}</span>{model.id.startsWith('gpt-image') ? <span className="mt-2 inline-block rounded-full bg-[var(--space-brand-primary-600)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">GPT Image</span> : null}</button>)}</div>
    </div>
    <div className="mt-5 space-y-3">{scenes.map((scene) => <div key={scene.id} className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-[var(--space-text-primary)]">Scene {scene.scene_index}</strong>
        <input type="number" step={0.1} value={scene.script_start_sec} onChange={(e) => onPatch(scene.id, { script_start_sec: Number(e.target.value) })} className="input w-24" />
        <span className="text-[var(--space-text-muted)]">to</span>
        <input type="number" step={0.1} value={scene.script_end_sec} onChange={(e) => onPatch(scene.id, { script_end_sec: Number(e.target.value) })} className="input w-24" />
        <input value={scene.scene_type} onChange={(e) => onPatch(scene.id, { scene_type: e.target.value })} className="input w-36" />
        <label className="ml-auto flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><input type="checkbox" checked={scene.approved} onChange={(e) => onPatch(scene.id, { approved: e.target.checked })} /> Approved</label>
      </div>
      <textarea value={scene.description} onChange={(e) => onPatch(scene.id, { description: e.target.value })} rows={2} className="mt-3 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm text-[var(--space-text-primary)]" />
      <div className="mt-3 flex items-start gap-3">
        <span className="flex h-[60px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)]">
          {scene.render_url
            ? <img src={scene.render_url} alt={`Scene ${scene.scene_index} preview`} width={80} height={60} className="h-full w-full object-cover" />
            : generatingSceneId === scene.id ? <Loader2 className="h-4 w-4 animate-spin text-[var(--space-text-brand)]" />
              : <Image className="h-4 w-4 text-[var(--space-text-muted)]" />}
        </span>
        <span className="text-xs text-[var(--space-text-muted)]">{scene.status === 'error' ? 'image failed — try another model or edit the description' : scene.render_url ? 'image ready' : generatingSceneId === scene.id ? 'generating image…' : 'no image yet'}</span>
      </div>
      {scene.render_url ? <img src={scene.render_url} alt={`Scene ${scene.scene_index} visual`} className="mt-3 max-h-56 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] object-contain" /> : null}
      <div className="mt-3 flex flex-wrap gap-3"><label className="cursor-pointer text-sm text-[var(--space-text-brand)]"><Upload className="mr-1 inline h-4 w-4" />Use my image<input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(scene, file); e.currentTarget.value = ''; }} /></label><button disabled={Boolean(generatingSceneId) || !scene.description.trim()} onClick={() => onGenerateImage(scene)} className="text-sm text-[var(--space-text-brand)] disabled:opacity-50">{generatingSceneId === scene.id ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Image className="mr-1 inline h-4 w-4" />}Generate image</button><button onClick={() => onRemove(scene.id)} className="text-sm text-[var(--space-semantic-danger)]"><Trash2 className="mr-1 inline h-4 w-4" />Remove</button></div>
    </div>)}</div>
    <div className="mt-5 flex flex-wrap gap-3"><button onClick={onAdd} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-4 py-3 text-[var(--space-text-primary)]"><Plus className="h-4 w-4" />Add time range</button><button disabled={!scenes.length || approved !== scenes.length} onClick={onGenerate} className="rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white disabled:opacity-40">Generate all scenes</button></div>
  </div>;
}
