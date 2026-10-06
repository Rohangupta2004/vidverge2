import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, ImagePlus, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { forgeApi } from '../lib/forge';
import type { Project, Scene } from '../lib/supabase';

/**
 * Asset Studio — the Asset Generator, now living INSIDE SceneForge instead of
 * as a separate dock app. It generates art-directed stills through the same
 * `asset-image-gen` server function (HyperFrames + Omni Flash policy: Gemini
 * Omni Flash's image model behind the schema-validated proxy, durable GCS
 * URLs) and, because it runs inside a project, every generated image can be
 * attached STRAIGHT onto a scene: attaching goes through the sceneforge-v2
 * hook's adopt_upload op, which writes the scene's protected render_url, so
 * the picture flows directly into the assembly composition.
 */
const GEN_HOOK = '/api/hooks/execute/workspace-660069/asset-image-gen';

interface GeneratedAsset { url: string; prompt: string; madeAt: number }

function storeKey(projectId: string) { return `sceneforge_asset_studio_${projectId}`; }

export default function AssetStudio({ project, scenes, onAdopted, onClose }: {
  project: Project;
  scenes: Scene[];
  /** Mirrors the adopted picture into the live scene list. */
  onAdopted: (sceneId: string, url: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [gallery, setGallery] = useState<GeneratedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success');
  const [retryAction, setRetryAction] = useState<null | (() => void)>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storeKey(project.id)) || '[]');
      if (Array.isArray(saved)) setGallery(saved.filter((row) => row && row.url));
    } catch { /* fresh studio */ }
  }, [project.id]);

  const selectedScene = useMemo(() => scenes.find((scene) => scene.id === sceneId) || null, [scenes, sceneId]);

  function persist(next: GeneratedAsset[]) {
    try { window.localStorage.setItem(storeKey(project.id), JSON.stringify(next.slice(0, 24))); } catch { /* best-effort */ }
  }

  function pickScene(id: string) {
    setSceneId(id);
    const scene = scenes.find((row) => row.id === id);
    // The scene's own image brief is the best starting prompt; the customer
    // can still rewrite it entirely.
    if (scene && !prompt.trim()) setPrompt(scene.image_prompts?.[0] || scene.description || '');
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setNotice(''); setRetryAction(null);
    try {
      const ws = (window as any).__workspaceDb;
      const sid = String((window as any).__spaceSessionId || '');
      const response = await fetch(GEN_HOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ws?.token ? { 'X-Workspace-DB-Token': ws.token } : {}),
          ...(sid ? { 'X-Session-Id': sid } : {}),
        },
        body: JSON.stringify({ op: 'generate', prompt: text, aspect: project.aspect_ratio === '9:16' ? '9:16' : '16:9', session_id: sid }),
      });
      const raw = await response.json().catch(() => null);
      const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
      const url = data?.imageUrl;
      if (!response.ok || !url) throw new Error(String(data?.error || `Image generation failed (HTTP ${response.status}).`));
      setGallery((all) => { const next = [{ url: String(url), prompt: text, madeAt: Date.now() }, ...all]; persist(next); return next; });
      setNoticeKind('success'); setRetryAction(null);
      setNotice('Image ready — attach it to a scene below or download it.');
    } catch (e: any) { setNoticeKind('error'); setNotice(e.message || String(e)); setRetryAction(() => () => { void generate(); }); } finally { setBusy(false); }
  }

  async function attach(asset: GeneratedAsset) {
    if (!selectedScene || attaching) { if (!selectedScene) { setNoticeKind('error'); setNotice('Pick the scene this image belongs to first.'); setRetryAction(null); } return; }
    setAttaching(asset.url); setNotice(''); setRetryAction(null);
    try {
      const adopted = await forgeApi.adoptUpload(project.id, selectedScene.id, asset.url, `asset-studio-scene-${selectedScene.scene_index}`);
      onAdopted(selectedScene.id, adopted.imageUrl || asset.url);
      setNoticeKind('success'); setRetryAction(null);
      setNotice(`Attached to scene ${selectedScene.scene_index} — it now feeds the assembly directly.`);
    } catch (e: any) { setNoticeKind('error'); setNotice(e.message || String(e)); setRetryAction(() => () => { void attach(asset); }); } finally { setAttaching(''); }
  }

  return <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-xl flex-col border-l border-[var(--space-border-default)] bg-[var(--space-surface-card)] shadow-2xl">
    <div className="flex items-center justify-between border-b border-[var(--space-border-default)] p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-[var(--space-text-primary)]"><ImagePlus className="h-5 w-5 text-[var(--space-text-brand)]" />Asset Studio</h2>
        <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">Generate stills on Omni Flash and attach them straight onto this film's scenes.</p>
      </div>
      <button aria-label="Close Asset Studio" onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)]"><X className="h-5 w-5 text-[var(--space-text-primary)]" /></button>
    </div>
    <div className="flex-1 overflow-y-auto p-5">
      <label className="text-xs font-medium text-[var(--space-text-secondary)]">Scene to attach to
        <select value={sceneId} onChange={(e) => pickScene(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm text-[var(--space-text-primary)]">
          <option value="">Choose a scene…</option>
          {scenes.map((scene) => <option key={scene.id} value={scene.id}>Scene {scene.scene_index} · {String(scene.description || '').slice(0, 60)}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-xs font-medium text-[var(--space-text-secondary)]">Art direction
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Describe the still — subject, composition, lighting, mood. Picking a scene pre-fills its own brief." className="mt-1 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm text-[var(--space-text-primary)] placeholder:text-[var(--space-text-muted)] focus:border-[var(--space-brand-primary-500)] focus:outline-none" />
      </label>
      <button disabled={busy || !prompt.trim()} onClick={() => void generate()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 font-semibold text-white transition-all hover:bg-[var(--space-brand-primary-700)] disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy ? 'Painting the still…' : 'Generate image'}
      </button>
      {notice ? noticeKind === 'error' ? <div role="alert" className="sf-fade-up mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-[var(--space-semantic-danger)]" /><span className="min-w-[min(100%,180px)] flex-1 text-[var(--space-text-secondary)]">{notice}</span>{retryAction ? <button onClick={retryAction} className="flex items-center gap-1 rounded-lg bg-[var(--space-brand-primary-600)] px-2.5 py-1.5 text-xs font-semibold text-white"><RefreshCw className="h-3 w-3" />Retry</button> : null}</div> : <p className="sf-fade-up mt-3 rounded-xl bg-[color-mix(in_srgb,var(--space-semantic-success-500)_10%,transparent)] p-3 text-sm text-[var(--space-text-secondary)]">{notice}</p> : null}
      {gallery.length ? <div className="mt-5">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-muted)]">Generated for this project</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {gallery.map((asset, index) => <div key={asset.url} className="sf-card overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] transition-all hover:-translate-y-0.5 hover:border-[var(--space-border-strong)] hover:shadow-xl" style={{ animationDelay: `${Math.min(index, 9) * 45}ms` }}>
            <img src={asset.url} alt="Generated asset" className="aspect-video w-full object-cover" />
            <div className="flex items-center gap-2 p-2">
              <button disabled={!selectedScene || Boolean(attaching)} onClick={() => void attach(asset)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--space-brand-primary-600)] px-2 py-2 text-xs font-semibold text-white transition-all hover:bg-[var(--space-brand-primary-700)] disabled:opacity-40">
                {attaching === asset.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{selectedScene ? `Use for scene ${selectedScene.scene_index}` : 'Pick a scene first'}
              </button>
              <a href={asset.url} download target="_blank" rel="noreferrer" aria-label="Download image" className="rounded-lg border border-[var(--space-border-default)] p-2 text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]"><Download className="h-3.5 w-3.5" /></a>
            </div>
          </div>)}
        </div>
      </div> : <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-5 py-9 text-center"><ImagePlus className="h-7 w-7 text-[var(--space-text-brand)]" /><p className="mt-3 font-semibold text-[var(--space-text-primary)]">Create the first still for this project</p><p className="mt-1 text-sm text-[var(--space-text-muted)]">Pick a scene, describe the shot, and generate an image you can attach in one tap.</p><button disabled={busy || !prompt.trim()} onClick={() => void generate()} className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Sparkles className="h-4 w-4" />Generate first image</button></div>}
    </div>
  </aside>;
}
