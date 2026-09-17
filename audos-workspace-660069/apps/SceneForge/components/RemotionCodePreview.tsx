import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Player } from 'https://esm.sh/@remotion/player@4.0.525?external=react,react-dom';
import { transform } from 'https://esm.sh/sucrase@3.35.1?bundle';
import * as Remotion from 'https://esm.sh/remotion@4.0.525?external=react,react-dom';
import { listAssets, type Asset, type Project, type Scene } from '../lib/supabase';

const FPS = 30;
const ALLOWED_MODULES = new Set(['react', 'remotion']);
const looksLikeVideo = (url?: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown preview error');
}

function cleanSource(code: string) {
  return code.trim()
    .replace(/^```(?:tsx|typescript|jsx|javascript)?\s*/i, '')
    .replace(/\s*```$/, '');
}

function assertSafeSource(source: string) {
  const modulePattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(modulePattern)) {
    if (!ALLOWED_MODULES.has(match[1])) throw new Error(`Preview blocked unsupported import “${match[1]}”. Only React and Remotion are available.`);
  }

  const blocked: Array<[RegExp, string]> = [
    [/\bimport\s*\(/, 'dynamic imports'],
    [/\brequire\s*\(/, 'direct require calls'],
    [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\b/, 'network or background APIs'],
    [/\b(?:window|document|globalThis|localStorage|sessionStorage|indexedDB|navigator|location)\b/, 'browser globals'],
    [/\b(?:eval|Function)\s*\(/, 'nested code evaluation'],
  ];
  for (const [pattern, label] of blocked) {
    if (pattern.test(source)) throw new Error(`Preview blocked ${label} in generated code.`);
  }
}

function compileComposition(code: string): { component?: React.ComponentType<any>; error?: string } {
  try {
    const source = cleanSource(code);
    if (!source) throw new Error('The scene has no Remotion code to preview.');
    assertSafeSource(source);
    const compiled = transform(source, {
      transforms: ['typescript', 'jsx', 'imports'],
      production: true,
      jsxRuntime: 'classic',
    }).code;
    const exportsObject: Record<string, unknown> = {};
    const moduleObject: { exports: any } = { exports: exportsObject };
    const safeRequire = (name: string) => {
      if (name === 'react') return React;
      if (name === 'remotion') return Remotion;
      throw new Error(`Preview blocked unsupported module “${name}”.`);
    };
    // Generated code receives only React, Remotion and its props. Common browser,
    // network, storage, worker, timer and nested-eval globals are shadowed.
    const factory = new Function(
      'React', 'require', 'module', 'exports',
      'window', 'document', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket',
      'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location',
      'Function', 'setTimeout', 'setInterval', 'requestAnimationFrame',
      `"use strict";\n${compiled}\nreturn module.exports.default || exports.default || module.exports;`,
    );
    const component = factory(
      React, safeRequire, moduleObject, exportsObject,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
    );
    if (!component || (typeof component !== 'function' && typeof component !== 'object')) {
      throw new Error('The generated file must default-export a React composition.');
    }
    return { component };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

function CodeFailure({ error, code }: { error: string; code: string }) {
  return <div className="rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,var(--space-surface-panel))] p-4">
    <div className="flex items-start gap-2 text-sm font-semibold text-[var(--space-semantic-danger)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Remotion preview could not run: {error}</span>
    </div>
    <p className="mt-2 text-xs text-[var(--space-text-secondary)]">The generated source is shown below so you can inspect or copy the failing code before rendering.</p>
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--space-border-default)] bg-[#070A12] p-3 font-mono text-xs leading-relaxed text-[var(--space-text-secondary)]"><code>{code}</code></pre>
  </div>;
}

function RuntimeFailure({ error, onError }: { error: Error; onError: (message: string) => void }) {
  const message = messageOf(error);
  useEffect(() => onError(message), [message, onError]);
  return <Remotion.AbsoluteFill style={{ background: '#070A12', alignItems: 'center', justifyContent: 'center', padding: 64, color: '#F8FAFC', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>
    <div style={{ fontSize: 42, fontWeight: 700 }}>Preview render failed</div>
    <div style={{ marginTop: 18, fontSize: 26, color: '#f87171' }}>{message}</div>
  </Remotion.AbsoluteFill>;
}

export default function RemotionCodePreview({ scene, project, onClose }: {
  scene: Scene;
  project: Project | null;
  onClose: () => void;
}) {
  const code = String(scene.remotion_code || '');
  const compiled = useMemo(() => compileComposition(code), [code]);
  const fallbackAssets = useMemo<Asset[]>(() => scene.render_url && !looksLikeVideo(scene.render_url) ? [{
    id: `preview-${scene.id}`,
    project_id: scene.project_id,
    scene_id: scene.id,
    asset_type: 'scene_image',
    element_name: 'scene-image',
    storage_path: '',
    public_url: scene.render_url,
    source: 'generated',
  }] : [], [scene.id, scene.project_id, scene.render_url]);
  const [assets, setAssets] = useState<Asset[]>(fallbackAssets);
  const [runtimeError, setRuntimeError] = useState('');
  useEffect(() => setRuntimeError(''), [scene.id, code]);
  useEffect(() => {
    let active = true;
    setAssets(fallbackAssets);
    if (!project?.id) return () => { active = false; };
    listAssets(project.id)
      .then((rows) => {
        if (!active) return;
        const sceneAssets = rows.filter((asset) => asset.scene_id === scene.id && asset.public_url);
        setAssets(sceneAssets.length ? sceneAssets : fallbackAssets);
      })
      .catch(() => { if (active) setAssets(fallbackAssets); });
    return () => { active = false; };
  }, [project?.id, scene.id, fallbackAssets]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  const seconds = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const durationInFrames = Math.max(1, Math.min(18000, Math.round(Number.isFinite(seconds) && seconds > 0 ? seconds * FPS : FPS)));
  const vertical = project?.aspect_ratio === '9:16';
  const inputProps = { assets, motionBgSrc: project?.motion_bg_url || '', description: scene.description };
  const failure = compiled.error || runtimeError;
  const Component = compiled.component as React.ComponentType<any> | undefined;

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={`Scene ${scene.scene_index} Remotion preview`} className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl border border-[var(--space-border-strong)] bg-[var(--space-surface-panel-strong)] shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--space-border-default)] bg-[var(--space-surface-panel-strong)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--space-text-brand)]">Browser preview</p>
          <h2 className="truncate text-lg font-semibold text-[var(--space-text-primary)]">Scene {scene.scene_index} · {scene.scene_type}</h2>
        </div>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] px-3 py-1 text-xs text-[var(--space-text-brand)]">{Math.ceil(durationInFrames / FPS)}s · {vertical ? '9:16' : '16:9'}</span>
        <button onClick={onClose} aria-label="Close preview" className="rounded-lg border border-[var(--space-border-default)] p-2 text-[var(--space-text-secondary)] transition hover:bg-[var(--space-surface-muted)] hover:text-[var(--space-text-primary)]"><X className="h-4 w-4" /></button>
      </div>
      <div className="p-5">
        {failure ? <CodeFailure error={failure} code={code} /> : Component ? <div className={vertical ? 'mx-auto max-w-sm overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black' : 'overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black'}>
          <Player
            key={`${scene.id}-${code.length}-${assets.map((asset) => asset.public_url || '').join('|')}`}
            component={Component}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={FPS}
            compositionWidth={vertical ? 1080 : 1920}
            compositionHeight={vertical ? 1920 : 1080}
            controls
            style={{ width: '100%', aspectRatio: vertical ? '9 / 16' : '16 / 9' }}
            errorFallback={({ error }: { error: Error }) => <RuntimeFailure error={error} onError={setRuntimeError} />}
          />
        </div> : null}
        {!failure ? <p className="mt-3 text-xs text-[var(--space-text-muted)]">This is a local browser preview of the saved composition. Play, pause, or drag the scrubber without starting a full render.</p> : null}
      </div>
    </div>
  </div>;
}
