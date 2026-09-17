/**
 * VidVerge Studio — the whole product in one clean flow:
 *   1. Pick a video type (8 cards)
 *   2. Fill the minimal inputs for that type (character / product image where
 *      they apply)
 *   3. Generate → live progress → player + Download
 * Plus a session-scoped My Videos tab.
 *
 * The render pipeline is untouched: submission goes through
 * lib/reelioStudio.submitVideo() into the platform `generate-video` hook,
 * status comes from `check-video-status`, and multi-scene audio is rebuilt
 * in-browser exactly like the chat progress card does.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, Clapperboard, Film, Minus, Plus, Sparkles } from 'lucide-react';
import type { SubmitVideoInput } from '../../lib/reelioStudio';
import { VIDEO_TYPES } from './videoTypesConfig';
import type { CharacterRef, ProductRef, VideoTypeDef } from './videoTypesConfig';
import CharacterSetup from './CharacterSetup';
import ProductImagePicker from './ProductImagePicker';
import GeneratePanel from './GeneratePanel';
import MyVideosGallery from './MyVideosGallery';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const STYLES = `
@keyframes rstSpin { to { transform: rotate(360deg); } }
@keyframes rstFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes rstPulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.rst-spin { animation: rstSpin .9s linear infinite; }
.rst-fade { animation: rstFadeUp .45s cubic-bezier(.16,1,.3,1) both; }
.rst-pulse { animation: rstPulse 1.6s ease-in-out infinite; }
.rst-type-card { transition: transform .25s cubic-bezier(.16,1,.3,1), border-color .2s ease, background .2s ease; }
.rst-type-card:hover { transform: translateY(-3px); border-color: var(--space-brand-primary-500) !important; background: var(--space-surface-panel-strong) !important; }
.rst-tab { transition: background .2s ease, color .2s ease; }
`;

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 11,
  border: '1px solid var(--space-border-default)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--space-text-primary)',
  fontSize: 13.5,
  outline: 'none',
  fontFamily: FONT,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--space-text-secondary)',
  marginBottom: 7,
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--space-text-primary)',
};

type Tab = 'create' | 'videos';
type Phase = 'form' | 'generating';

export default function App() {
  const [tab, setTab] = useState<Tab>('create');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<string[]>(['', '']);
  const [character, setCharacter] = useState<CharacterRef | null>(null);
  const [product, setProduct] = useState<ProductRef | null>(null);
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('9:16');
  const [sceneCount, setSceneCount] = useState(4);
  const [phase, setPhase] = useState<Phase>('form');
  const [payload, setPayload] = useState<SubmitVideoInput | null>(null);

  const typeDef: VideoTypeDef | null = typeId
    ? VIDEO_TYPES.find((t) => t.id === typeId) || null
    : null;

  const pickType = (t: VideoTypeDef) => {
    setTypeId(t.id);
    setInputs({});
    setSteps(['', '']);
    setCharacter(null);
    setProduct(null);
    setAspect(t.defaultAspect);
    setSceneCount(t.defaultScenes);
    setPhase('form');
    setPayload(null);
  };

  const backToPicker = () => {
    setTypeId(null);
    setPhase('form');
    setPayload(null);
  };

  // ------------------------------------------------------- validation
  const missing: string[] = useMemo(() => {
    if (!typeDef) return [];
    const out: string[] = [];
    for (const f of typeDef.fields) {
      if (f.required && !(inputs[f.key] || '').trim()) out.push(f.label);
    }
    if (typeDef.hasSteps) {
      const filled = steps.map((s) => s.trim()).filter(Boolean);
      if (filled.length < 2) out.push('At least 2 steps');
    }
    if (typeDef.character === 'required' && !character) out.push('Character');
    if (typeDef.product === 'required' && !product) out.push('Product image');
    return out;
  }, [typeDef, inputs, steps, character, product]);

  const canGenerate = typeDef != null && missing.length === 0;

  const handleGenerate = () => {
    if (!typeDef || !canGenerate) return;
    const built = typeDef.build({ inputs, steps, character, product, sceneCount });
    const next: SubmitVideoInput = {
      scenes: built.scenes,
      characterDescription: built.characterDescription,
      tone: built.tone,
      aspectRatio: aspect,
      title: built.title,
      durationSeconds: built.scenes.length * 8,
      dialogues: built.scenes.map((s) => s.dialogue),
    };
    if (character) {
      next.characterImageUrl = character.imageUrl;
      next.characterData = {
        name: character.name,
        description: character.description,
        image_url: character.imageUrl,
      };
    }
    if (product) {
      next.referenceImageUrl = product.imageUrl;
      next.referenceImageScene = 1;
    }
    setPayload(next);
    setPhase('generating');
  };

  // ---------------------------------------------------------------- render
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--space-surface-gradient-via, #080808)', color: 'var(--space-text-primary)', fontFamily: FONT }}>
      <style>{STYLES}</style>
      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '26px 18px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg, var(--space-brand-primary-600), var(--space-brand-primary-700))', boxShadow: '0 8px 24px rgba(124,58,237,0.4)' }}>
              <Clapperboard size={19} color="#fff" />
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>Reelio</h1>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--space-text-muted)' }}>Pick a type · fill it in · get your video</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 999, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)' }} role="tablist">
            {([
              { id: 'create' as Tab, label: 'Create', icon: Sparkles },
              { id: 'videos' as Tab, label: 'My Videos', icon: Film },
            ]).map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className="rst-tab"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '8px 15px',
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)',
                    background: active ? 'var(--space-brand-primary)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  data-testid={`tab-${t.id}`}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'videos' ? (
          <MyVideosGallery onCreate={() => setTab('create')} />
        ) : !typeDef ? (
          /* ------------------------------------------ Step 1: type picker */
          <div className="rst-fade">
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>
              What are we making?
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--space-text-secondary)' }}>
              Pick a video type — each one only asks for what it actually needs.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 12 }}>
              {VIDEO_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickType(t)}
                    className="rst-type-card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 10,
                      textAlign: 'left',
                      padding: '16px 15px',
                      borderRadius: 15,
                      border: '1px solid var(--space-border-default)',
                      background: 'var(--space-surface-panel)',
                      cursor: 'pointer',
                    }}
                    data-testid={`type-card-${t.id}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: 'var(--space-surface-accent-soft)' }}>
                      <Icon size={17} color="var(--space-text-brand)" />
                    </span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--space-text-primary)' }}>{t.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--space-text-muted)', lineHeight: 1.5 }}>{t.tagline}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--space-text-brand)' }}>{t.sceneCountLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : phase === 'generating' && payload ? (
          /* --------------------------------------- Step 3: generate/result */
          <div className="rst-fade">
            <button
              type="button"
              onClick={() => setPhase('form')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, color: 'var(--space-text-secondary)', border: '1px solid var(--space-border-default)', background: 'transparent', cursor: 'pointer' }}
              data-testid="button-back-to-form"
            >
              <ArrowLeft size={13} /> {typeDef.label}
            </button>
            <GeneratePanel
              payload={payload}
              aspectRatio={aspect}
              onEdit={() => setPhase('form')}
              onDone={backToPicker}
            />
          </div>
        ) : (
          /* --------------------------------------------- Step 2: the form */
          <div className="rst-fade" style={{ maxWidth: 640 }}>
            <button
              type="button"
              onClick={backToPicker}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, color: 'var(--space-text-secondary)', border: '1px solid var(--space-border-default)', background: 'transparent', cursor: 'pointer' }}
              data-testid="button-back-to-types"
            >
              <ArrowLeft size={13} /> All video types
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <typeDef.icon size={19} color="var(--space-text-brand)" />
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>{typeDef.label}</h2>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--space-text-secondary)' }}>
              {typeDef.tagline} <span style={{ color: 'var(--space-text-muted)' }}>({typeDef.sceneCountLabel})</span>
            </p>

            {/* Text fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {typeDef.fields.map((f) => (
                <div key={f.key}>
                  <label style={labelStyle}>
                    {f.label}
                    {!f.required && <span style={{ fontWeight: 400, color: 'var(--space-text-muted)' }}> (optional)</span>}
                  </label>
                  {f.multiline ? (
                    <textarea
                      value={inputs[f.key] || ''}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                      data-testid={`input-${f.key}`}
                    />
                  ) : (
                    <input
                      value={inputs[f.key] || ''}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={inputStyle}
                      data-testid={`input-${f.key}`}
                    />
                  )}
                  {f.hint && <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--space-text-muted)' }}>{f.hint}</p>}
                </div>
              ))}

              {/* Tutorial steps */}
              {typeDef.hasSteps && (
                <div>
                  <label style={labelStyle}>Steps (2–6 — each step becomes one ~8s scene)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ width: 24, fontSize: 12.5, fontWeight: 700, color: 'var(--space-text-brand)', textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                        <input
                          value={s}
                          onChange={(e) => setSteps((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                          placeholder={`Step ${i + 1} — e.g. ${i === 0 ? 'grind the beans medium-fine' : 'pour in slow circles'}`}
                          style={inputStyle}
                          data-testid={`input-step-${i}`}
                        />
                        {steps.length > 2 && (
                          <button
                            type="button"
                            onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`Remove step ${i + 1}`}
                            style={{ padding: 8, borderRadius: 9, cursor: 'pointer', border: '1px solid var(--space-border-default)', background: 'transparent', color: 'var(--space-text-muted)', flexShrink: 0 }}
                          >
                            <Minus size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {steps.length < 6 && (
                    <button
                      type="button"
                      onClick={() => setSteps((prev) => [...prev, ''])}
                      style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-secondary)', border: '1px dashed var(--space-border-strong)', background: 'transparent', cursor: 'pointer' }}
                      data-testid="button-add-step"
                    >
                      <Plus size={13} /> Add step
                    </button>
                  )}
                </div>
              )}

              {/* Product image */}
              {typeDef.product !== 'none' && (
                <div>
                  <p style={sectionTitle}>
                    Product image{typeDef.product === 'required' ? '' : ' (optional)'}
                  </p>
                  <ProductImagePicker value={product} onChange={setProduct} required={typeDef.product === 'required'} />
                </div>
              )}

              {/* Character */}
              {typeDef.character !== 'none' && (
                <div>
                  <p style={sectionTitle}>
                    Character{typeDef.character === 'required' ? '' : ' (optional)'}
                  </p>
                  <CharacterSetup value={character} onChange={setCharacter} required={typeDef.character === 'required'} />
                </div>
              )}

              {/* Length */}
              {typeDef.lengthSelectable !== false && (
                <div>
                  <p style={sectionTitle}>Length</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Array.from(
                      { length: typeDef.maxScenes - typeDef.minScenes + 1 },
                      (_, i) => typeDef.minScenes + i,
                    ).map((n) => {
                      const active = sceneCount === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSceneCount(n)}
                          style={{
                            display: 'inline-flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 2,
                            padding: '9px 14px',
                            borderRadius: 11,
                            fontSize: 13.5,
                            fontWeight: 700,
                            color: active ? 'var(--space-text-brand)' : 'var(--space-text-secondary)',
                            border: active ? '1px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)',
                            background: active ? 'var(--space-surface-accent-soft)' : 'transparent',
                            cursor: 'pointer',
                          }}
                          data-testid={`button-length-${n}`}
                        >
                          ~{n * 8}s
                          <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--space-text-muted)' }}>
                            {n} scene{n === 1 ? '' : 's'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--space-text-muted)' }}>
                    Each scene is ~8 seconds. Longer videos take a little more time to render.
                  </p>
                </div>
              )}

              {/* Format */}
              <div>
                <p style={sectionTitle}>Format</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['9:16', '16:9'] as const).map((a) => {
                    const active = aspect === a;
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAspect(a)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '9px 15px',
                          borderRadius: 11,
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? 'var(--space-text-brand)' : 'var(--space-text-secondary)',
                          border: active ? '1px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)',
                          background: active ? 'var(--space-surface-accent-soft)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        data-testid={`button-aspect-${a === '9:16' ? 'portrait' : 'landscape'}`}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-block',
                            width: a === '9:16' ? 9 : 16,
                            height: a === '9:16' ? 15 : 10,
                            borderRadius: 2.5,
                            border: '1.5px solid currentColor',
                          }}
                        />
                        {a === '9:16' ? 'Vertical (Reels/TikTok)' : 'Wide (YouTube)'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generate */}
              <div style={{ position: 'sticky', bottom: 0, paddingTop: 6, paddingBottom: 8, background: 'linear-gradient(180deg, transparent, var(--space-surface-gradient-via, #080808) 35%)' }}>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  style={{
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                    padding: '14px 20px',
                    borderRadius: 13,
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--space-text-on-primary)',
                    border: 'none',
                    cursor: canGenerate ? 'pointer' : 'not-allowed',
                    opacity: canGenerate ? 1 : 0.45,
                    background: 'linear-gradient(90deg, var(--space-brand-primary-600), var(--space-brand-primary-500))',
                    boxShadow: canGenerate ? '0 10px 30px rgba(124,58,237,0.4)' : 'none',
                  }}
                  data-testid="button-generate"
                >
                  <Sparkles size={17} /> Generate video
                </button>
                {!canGenerate && missing.length > 0 && (
                  <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--space-text-muted)', textAlign: 'center' }}>
                    Still needed: {missing.join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
