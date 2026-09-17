/**
 * Screen 4 — script + visual storyboard: THE approval gate.
 *
 * While the AI writes the script a "Writing your script" state shows; then
 * every scene gets an AI-generated preview still (same visual language as
 * the final render prompt) so the user sees the exact plan before a single
 * video credit is spent. Images generate in PARALLEL with a skeleton per
 * card. Everything is editable inline: description (image regenerates on
 * blur when it changed), dialogue, duration. Scenes can be added, deleted,
 * dragged to reorder (grip handle; arrows on mobile), regenerated one at a
 * time or all at once, and the full script text can be toggled open.
 * The only place render credits are spent is the big CTA at the bottom.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { AspectRatio, BoardScene, CharacterRef } from './videoTypes';
import {
  clipOptionsFor,
  getTone,
  makeScene,
  renderClipSeconds,
  sceneImagePrompt,
} from './videoTypes';
import { generateScenePreview } from './studioApi';
import {
  Card,
  ErrorNotice,
  GhostButton,
  IconButton,
  ModelPicker,
  PrimaryButton,
  StepHeader,
  T,
  TextArea,
} from './ui';

type ImageState = { status: 'idle' | 'loading' | 'ready' | 'error'; url?: string };

export default function Storyboard({
  loadingScript,
  scenes,
  setScenes,
  character,
  toneId,
  styleWord,
  visualReference,
  aspect,
  title,
  onBack,
  onApprove,
  onImagesChange,
  initialImages,
  submitting,
  submitError,
  model,
  onModelChange,
}: {
  loadingScript: boolean;
  scenes: BoardScene[];
  setScenes: (scenes: BoardScene[]) => void;
  character: CharacterRef | null;
  toneId: string;
  styleWord: string;
  /** Vision read of an uploaded product image — every still matches it. */
  visualReference?: string;
  aspect: AspectRatio;
  title: string;
  onBack: () => void;
  onApprove: () => void;
  /** Reports the latest scene-preview URLs upward (shown during generation). */
  onImagesChange?: (urls: Record<string, string>) => void;
  /**
   * Previews already generated for these scenes, handed back by the studio
   * store after a remount. Adopted as-is — leaving this board and coming back
   * must not silently re-charge the visitor for images they already have.
   */
  initialImages?: Record<string, string>;
  submitting: boolean;
  submitError: string | null;
  /** The text-to-video model the render uses (one of VIDEO_MODELS). */
  model: string;
  onModelChange: (id: string) => void;
}) {
  const [images, setImages] = useState<Record<string, ImageState>>(() => {
    const seed: Record<string, ImageState> = {};
    Object.keys(initialImages || {}).forEach((key) => {
      const url = (initialImages || {})[key];
      if (url) seed[key] = { status: 'ready', url };
    });
    return seed;
  });
  const [showScript, setShowScript] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const tone = getTone(toneId);
  // Prompt-cache so re-renders / dialogue edits never regenerate an image —
  // only a *description* change (committed on blur) or an explicit respin does.
  const promptCache = useRef<Record<string, string>>({});

  // Restored previews were drawn from this exact brief, so prime the cache
  // with their prompts — otherwise the mount effect below reads them as stale
  // and regenerates every one of them.
  const cacheSeeded = useRef(false);
  if (!cacheSeeded.current) {
    cacheSeeded.current = true;
    Object.keys(initialImages || {}).forEach((key) => {
      const scene = scenes.find((s) => s.key === key);
      if (scene) {
        promptCache.current[key] = sceneImagePrompt(scene, character, tone.prompt, styleWord, visualReference);
      }
    });
  }

  // Report ready preview URLs upward (the Delivery screen keeps them visible).
  useEffect(() => {
    if (!onImagesChange) return;
    const urls: Record<string, string> = {};
    Object.keys(images).forEach((k) => {
      const st = images[k];
      if (st && st.status === 'ready' && st.url) urls[k] = st.url;
    });
    onImagesChange(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  const generateFor = (scene: BoardScene, force = false) => {
    if (!(scene.description || '').trim()) return;
    const prompt = sceneImagePrompt(scene, character, tone.prompt, styleWord, visualReference);
    if (!force && promptCache.current[scene.key] === prompt) return;
    promptCache.current[scene.key] = prompt;
    setImages((m) => ({ ...m, [scene.key]: { status: 'loading' } }));
    void generateScenePreview(prompt, aspect)
      .then((url) => {
        setImages((m) => ({ ...m, [scene.key]: { status: 'ready' as const, url } }));
      })
      .catch(() => {
        setImages((m) => ({ ...m, [scene.key]: { status: 'error' as const } }));
      });
  };

  // Generate all previews in parallel when the script lands (and for any
  // scene added later, once it has a description).
  useEffect(() => {
    scenes.forEach((s) => generateFor(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingScript, scenes.map((s) => s.key).join('|')]);

  const hasContent = scenes.some((s) => (s.description || '').trim().length > 0);

  const updateScene = (key: string, patch: Partial<BoardScene>) => {
    setScenes(scenes.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const commitDescription = (scene: BoardScene) => {
    // Called on blur — regenerate ONLY this scene's image if the text changed.
    generateFor(scene);
  };

  const addScene = () => {
    const durations = scenes.map((s) => s.durationSec).filter(Boolean);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 10;
    setScenes([...scenes, makeScene('Medium shot', '', '', avg, model)]);
  };

  const removeScene = (key: string) => {
    if (scenes.length <= 1) return;
    setScenes(scenes.filter((s) => s.key !== key));
  };

  const moveScene = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= scenes.length) return;
    const next = [...scenes];
    [next[idx], next[j]] = [next[j], next[idx]];
    setScenes(next);
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIndex === null || dragIndex === targetIdx) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...scenes];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIdx, 0, moved);
    setScenes(next);
    setDragIndex(null);
    setOverIndex(null);
  };

  const regenerateAll = () => {
    scenes.forEach((s) => generateFor(s, true));
  };

  const totalSeconds = scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0);

  // ---- Writing-script state ----
  if (loadingScript) {
    return (
      <div className="rc-fade">
        <StepHeader title="Writing your script…" subtitle="Shaping the story scene by scene — a few seconds." onBack={onBack} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={{ padding: 0, overflow: 'hidden' }}>
              <div className="rc-skeleton" style={{ aspectRatio: aspect === '9:16' ? '9 / 12' : '16 / 9' }} />
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="rc-skeleton" style={{ height: 12, width: '40%', borderRadius: 6 }} />
                <div className="rc-skeleton" style={{ height: 10, width: '90%', borderRadius: 6 }} />
                <div className="rc-skeleton" style={{ height: 10, width: '75%', borderRadius: 6 }} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rc-fade">
      <StepHeader
        title="Your storyboard"
        subtitle={`${title} · ${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ~${totalSeconds}s · ${aspect}. Review every shot — nothing renders until you approve.`}
        onBack={onBack}
      />

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <GhostButton onClick={() => setShowScript((v) => !v)} testId="button-toggle-script">
          <FileText size={13} /> {showScript ? 'Hide script' : 'Edit script'}
        </GhostButton>
        <GhostButton onClick={regenerateAll} testId="button-regenerate-all">
          <RefreshCw size={13} /> Regenerate all scenes
        </GhostButton>
      </div>

      {/* Full script text */}
      {showScript ? (
        <Card className="rc-fade" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {scenes.map((s, i) => (
              <div key={s.key}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: T.accentFg, marginBottom: 3 }}>
                  Scene {i + 1} — {s.shotType} · {s.durationSec}s
                </span>
                <p style={{ margin: 0, fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>{s.description || '(no description yet)'}</p>
                {s.dialogue ? (
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, fontStyle: 'italic', color: T.muted }}>“{s.dialogue}”</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        {scenes.map((s, i) => {
          const img = images[s.key] || { status: 'idle' as const };
          return (
            <Card
              key={s.key}
              className={`rc-fade${overIndex === i && dragIndex !== null && dragIndex !== i ? ' rc-drag-over' : ''}`}
              style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              onDragOver={(e: any) => {
                e.preventDefault();
                if (overIndex !== i) setOverIndex(i);
              }}
              onDrop={() => handleDrop(i)}
            >
              {/* Preview image — top half */}
              <div style={{ position: 'relative', aspectRatio: aspect === '9:16' ? '9 / 12' : '16 / 9', background: '#000' }}>
                {img.status === 'ready' && img.url ? (
                  <img
                    src={img.url}
                    alt={`Scene ${i + 1} preview`}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    data-testid={`img-scene-${i + 1}`}
                  />
                ) : img.status === 'error' ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: T.muted, fontSize: 12.5 }}>
                    <AlertTriangle size={20} color={T.danger} />
                    Preview failed
                    <GhostButton onClick={() => generateFor(s, true)} style={{ padding: '6px 12px', fontSize: 12 }}>
                      <RefreshCw size={12} /> Retry
                    </GhostButton>
                  </div>
                ) : img.status === 'loading' ? (
                  <div className="rc-skeleton" style={{ position: 'absolute', inset: 0 }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.muted, fontSize: 12.5, textAlign: 'center', padding: 16 }}>
                    Describe the scene below — the preview generates automatically.
                  </div>
                )}

                {/* Scene number badge */}
                <span
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 9px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                    background: 'rgba(0,0,0,0.62)',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  Scene {i + 1} — {s.shotType}
                </span>

                {/* Respin image only */}
                <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                  <IconButton
                    label="Regenerate this scene image"
                    onClick={() => generateFor(s, true)}
                    disabled={img.status === 'loading' || !(s.description || '').trim()}
                    style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)' }}
                  >
                    {img.status === 'loading' ? <Loader2 size={14} className="rc-spin" /> : <RefreshCw size={14} />}
                  </IconButton>
                </span>
              </div>

              {/* Card body */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {/* Drag handle + reorder arrows */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setOverIndex(null);
                      }}
                      title="Drag to reorder"
                      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', color: T.muted, padding: 4 }}
                      data-testid={`drag-scene-${i + 1}`}
                    >
                      <GripVertical size={14} />
                    </span>
                    <IconButton label="Move scene up" onClick={() => moveScene(i, -1)} disabled={i === 0} style={{ width: 26, height: 26 }}>
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton label="Move scene down" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1} style={{ width: 26, height: 26 }}>
                      <ArrowDown size={12} />
                    </IconButton>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} color={T.muted} />
                    {/* Only the length Omni Flash actually cuts. A free number
                        field would promise a duration the renderer cannot honor. */}
                    <select
                      value={s.durationSec}
                      onChange={(e) =>
                        updateScene(s.key, { durationSec: renderClipSeconds(Number(e.target.value), model) })
                      }
                      aria-label={`Scene ${i + 1} length`}
                      style={{
                        padding: '3px 6px',
                        borderRadius: 7,
                        border: `1px solid ${T.border}`,
                        background: 'rgba(255,255,255,0.04)',
                        color: T.sub,
                        fontSize: 12,
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                      data-testid={`input-scene-duration-${i + 1}`}
                    >
                      {clipOptionsFor(model).map((seconds) => (
                        <option key={seconds} value={seconds} style={{ background: '#101014', color: '#f5f5f7' }}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                    <IconButton label="Delete scene" onClick={() => removeScene(s.key)} disabled={scenes.length <= 1} style={{ width: 26, height: 26 }}>
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                </div>

                {/* Scene description — editable inline; image respins on blur */}
                <div>
                  <span style={{ display: 'block', marginBottom: 5, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    Scene description
                  </span>
                  <TextArea
                    value={s.description}
                    onChange={(v) => updateScene(s.key, { description: v })}
                    onBlur={() => commitDescription({ ...s, description: s.description })}
                    rows={3}
                    placeholder="What we see: setting, action, camera, mood…"
                    testId={`input-scene-description-${i + 1}`}
                    expand={{
                      field: `Scene ${i + 1} description (${s.shotType})`,
                      context: `${title}. ${tone.visual}. ${styleWord} look.${
                        character ? ` On camera: ${character.name} — ${character.description}` : ''
                      }`,
                      words: 65,
                    }}
                  />
                </div>

                {/* Dialogue — editable inline */}
                <div>
                  <span style={{ display: 'block', marginBottom: 5, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    Dialogue — spoken on camera
                  </span>
                  <TextArea
                    value={s.dialogue}
                    onChange={(v) => updateScene(s.key, { dialogue: v })}
                    rows={2}
                    placeholder="What they say on camera — Omni Flash speaks this out loud"
                    testId={`input-scene-dialogue-${i + 1}`}
                    expand={{
                      field: `Scene ${i + 1} spoken line`,
                      context: `${title}. Keep it one short punchy sentence someone can say out loud in ${s.durationSec} seconds.`,
                      words: 22,
                      label: 'Punch it up',
                    }}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add scene */}
      <div style={{ marginBottom: 24 }}>
        <GhostButton onClick={addScene} full testId="button-add-scene">
          <Plus size={14} /> Add scene
        </GhostButton>
      </div>

      {submitError ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorNotice>{submitError}</ErrorNotice>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        {/* The same honest engine label shown on the Create screen. */}
        <ModelPicker value={model} onChange={onModelChange} />
        <PrimaryButton
          onClick={onApprove}
          disabled={!hasContent || submitting}
          full
          testId="button-approve-storyboard"
        >
          {submitting ? (
            <>
              <Loader2 size={15} className="rc-spin" /> Starting the render…
            </>
          ) : (
            <>Looks good → Generate Video</>
          )}
        </PrimaryButton>
        <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center' }}>
          No video credits are spent until you approve. This is the only step that renders. Omni Flash includes sound.
        </p>
      </div>
    </div>
  );
}
