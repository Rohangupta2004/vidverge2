/**
 * Character Generator — VidVerge dock app (id: character-generator).
 *
 * Design a reusable video character: describe them (name, appearance,
 * personality, style), optionally anchor the look with a reference photo, and
 * generate a consistent character card with an AI portrait. Saved characters
 * land in the shared `vv_characters` WorkspaceDB table (name, description,
 * style, image_url, reference_images) so SceneForge, Script-to-Video and Ads
 * Studio can reuse the same person across every scene.
 *
 * Runtime plumbing is reused from lib/reelioStudio (session-guarded
 * WorkspaceDB reads/writes via window.__workspaceDb, GCS upload, vision
 * describe, and the platform image endpoint) — nothing here talks to a
 * provider SDK directly.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Users,
  Upload,
  Loader2,
  Trash2,
  Sparkles,
  Wand2,
  RefreshCw,
  CheckCircle2,
  Image as ImageIcon,
  AlertTriangle,
  Copy,
  Film,
} from 'lucide-react';
import LB, { LB_SHIMMER_CSS } from '../../components/LightBeam';
import { EnginePicker, ImageEnginePicker, DEFAULT_IMAGE_ENGINE_ID, usePersistentEngine } from '../../components/EngineSelector';
import { generateWithRunway } from '../../lib/runwayAdapter';
import { isRunwayModel, runwayModel } from '../../lib/videoEngines';
import { pollGroupA, submitGroupA } from '../../lib/videoEngineClient';
import {
  listRows,
  insertRow,
  deleteRow,
  uploadImage,
  describeImage,
  generateImage,
  CHARACTER_VISION_PROMPT,
  PORTRAIT_NEGATIVE_PROMPT,
  STUDIO_EVENTS,
} from '../../lib/reelioStudio';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const TABLE = 'vv_characters';

interface VVCharacter {
  id: number;
  name: string;
  description: string | null;
  style: string | null;
  image_url: string | null;
  reference_images: string[] | null;
  created_at?: string;
}

const STYLE_PRESETS = [
  'Cinematic realistic',
  '3D animated',
  'Documentary',
  'Anime',
  'Paper collage',
  'Noir',
];

function splitStyleTags(style: string | null | undefined): string[] {
  return (style || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** Build the portrait prompt from the structured character brief. */
function buildPortraitPrompt(input: {
  name: string;
  appearance: string;
  personality: string;
  style: string;
  hasReference: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    `Character reference portrait of ${input.name || 'an original video character'}, framed chest-up, facing slightly off camera, soft key light, clean dark studio backdrop.`,
  );
  if (input.appearance.trim()) parts.push(`Appearance: ${input.appearance.trim()}.`);
  if (input.personality.trim())
    parts.push(`Their personality reads through the pose and expression: ${input.personality.trim()}.`);
  parts.push(
    input.style.trim()
      ? `Visual style: ${input.style.trim()}.`
      : 'Visual style: cinematic, premium video production look.',
  );
  parts.push('One single character, full head fully inside the frame, consistent recognizable design suitable for reuse across many video scenes.');
  return parts.join(' ');
}

export default function App() {
  // Saved characters
  const [characters, setCharacters] = useState<VVCharacter[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Draft form
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');
  const [style, setStyle] = useState('');
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  // Portrait engine. Runway Stock Image is offered alongside the platform
  // model because it takes the same reference photo and returns a usable
  // character plate; it resolves to the marketing_stock_image recipe.
  const [imageEngine, setImageEngine] = useState<string>(DEFAULT_IMAGE_ENGINE_ID);

  // Async state
  const [uploading, setUploading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Generated preview (not yet saved)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // MOTION PORTRAIT — animate the character card into a short video clip.
  // The engine choice persists for the browser session.
  const [videoEngine, setVideoEngine] = usePersistentEngine('character-generator:video-engine', 'gen4_turbo');
  const [motionPrompt, setMotionPrompt] = useState('');
  const [animating, setAnimating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const rows = await listRows<VVCharacter>(TABLE);
    setCharacters(rows);
    setLoadingList(false);
  };

  useEffect(() => {
    void refresh();
    const onData = () => void refresh();
    window.addEventListener(STUDIO_EVENTS.dataChanged, onData);
    return () => window.removeEventListener(STUDIO_EVENTS.dataChanged, onData);
  }, []);

  const handleReferenceFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage(file, 'characters');
      setReferenceUrl(url);
      setDescribing(true);
      try {
        const desc = await describeImage(url, CHARACTER_VISION_PROMPT);
        setAppearance((prev) => prev.trim() || desc);
      } catch (e) {
        console.warn('[CharacterGenerator] auto-describe failed:', e);
      } finally {
        setDescribing(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not upload that photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!appearance.trim() && !name.trim()) {
      setError('Describe your character (or at least name them) first.');
      return;
    }
    setError(null);
    setNotice(null);
    setGenerating(true);
    try {
      const prompt = buildPortraitPrompt({
        name,
        appearance,
        personality,
        style,
        hasReference: !!referenceUrl,
      });
      if (isRunwayModel(imageEngine)) {
        const result = await generateWithRunway({
          model: imageEngine,
          prompt,
          image: referenceUrl,
          aspectRatio: '3:4',
          quality: 'high',
          outputCount: 1,
        });
        setPreviewUrl(result.mediaUrls[0]);
      } else {
        const url = await generateImage({
          prompt,
          aspectRatio: '3:4',
          quality: 'high',
          negativePrompt: PORTRAIT_NEGATIVE_PROMPT,
        });
        setPreviewUrl(url);
      }
    } catch (e: any) {
      setError(e?.message || 'Image generation failed. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Give your character a name before saving.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const description = [
        appearance.trim(),
        personality.trim() ? `Personality: ${personality.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const referenceImages = [previewUrl, referenceUrl].filter(Boolean) as string[];
      await insertRow(TABLE, {
        name: name.trim(),
        description: description || null,
        style: style.trim() || null,
        image_url: previewUrl || referenceUrl || null,
        reference_images: referenceImages.length ? referenceImages : null,
      });
      setNotice(`${name.trim()} saved — every VidVerge app can reuse them now.`);
      setName('');
      setAppearance('');
      setPersonality('');
      setStyle('');
      setReferenceUrl(null);
      setPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not save the character.');
    } finally {
      setSaving(false);
    }
  };

  const handleAnimate = async () => {
    const portrait = previewUrl || referenceUrl;
    const rw = runwayModel(videoEngine);
    if (rw && rw.inputType === 'image' && !portrait) {
      setError('Generate or upload a portrait first — this model animates an existing image.');
      return;
    }
    const prompt = (
      motionPrompt.trim()
      || `Subtle cinematic motion portrait of ${name.trim() || 'the character'}: gentle breathing, natural blinks, soft light drift across the face. Preserve the exact face, wardrobe and style — no scene change.${style.trim() ? ` Visual style: ${style.trim()}.` : ''}`
    ).slice(0, 990);
    setError(null);
    setNotice(null);
    setAnimating(true);
    setVideoUrl(null);
    try {
      if (isRunwayModel(videoEngine)) {
        const out = await generateWithRunway({
          model: videoEngine,
          prompt,
          image: portrait,
          aspectRatio: '3:4',
          duration: 5,
        });
        setVideoUrl(out.mediaUrls[0]);
      } else {
        const kickoff = await submitGroupA({
          model: videoEngine,
          prompt,
          aspectRatio: '9:16',
          duration: 6,
          imageData: portrait || undefined,
        });
        setVideoUrl(await pollGroupA(kickoff.operationId));
      }
      setNotice('Motion portrait ready — download the clip, or switch models and regenerate.');
    } catch (e: any) {
      setError(e?.message || 'The motion portrait could not be generated. Try again.');
    } finally {
      setAnimating(false);
    }
  };

  const handleReuse = (c: VVCharacter) => {
    const desc = c.description || '';
    const personalityMatch = desc.match(/Personality:\s*([\s\S]*)$/);
    setName(c.name);
    setAppearance(personalityMatch ? desc.slice(0, personalityMatch.index).trim() : desc);
    setPersonality(personalityMatch ? personalityMatch[1].trim() : '');
    setStyle(c.style || '');
    setPreviewUrl(c.image_url || null);
    setReferenceUrl(
      Array.isArray(c.reference_images)
        ? c.reference_images.find((u) => u && u !== c.image_url) || null
        : null,
    );
    setNotice(`Loaded ${c.name} — tweak anything and regenerate.`);
    setError(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    await deleteRow(TABLE, id);
    await refresh();
  };

  const toggleStyleTag = (tag: string) => {
    const tags = splitStyleTags(style);
    const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    const next = has ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag];
    setStyle(next.join(', '));
  };

  const busy = uploading || generating || saving || animating;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: LB.bg, color: LB.textPrimary, fontFamily: FONT }}>
      <style>{LB_SHIMMER_CSS}</style>
      <style>{`
        @keyframes cgSpin { to { transform: rotate(360deg); } }
        .cg-spin { animation: cgSpin .9s linear infinite; }
        .cg-btn { transition: transform .16s ease, filter .16s ease, box-shadow .25s ease; }
        .cg-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.07); }
        .cg-card { transition: transform .22s ease, border-color .22s ease; }
        .cg-card:hover { transform: translateY(-3px); border-color: rgba(245,158,11,0.45); }
        .cg-input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #fff; font-size: 13.5px; outline: none; font-family: ${FONT}; box-sizing: border-box; }
        .cg-input:focus { border-color: rgba(245,158,11,0.55); }
      `}</style>

      <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Character Generator</h1>
            <p style={{ margin: '5px 0 0', fontSize: 14, color: LB.textSecondary }}>
              Design a character once — reuse the same face, wardrobe and vibe in every VidVerge video.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Composer */}
          <div
            style={{
              flex: '1 1 420px',
              minWidth: 320,
              borderRadius: 18,
              border: '1px solid rgba(245,158,11,0.24)',
              background: 'linear-gradient(180deg, rgba(245,158,11,0.07) 0%, rgba(255,255,255,0.02) 100%)',
              padding: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Sparkles size={16} color={LB.accent} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Describe your character</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                className="cg-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Maya, Captain Rho)"
              />

              <div style={{ position: 'relative' }}>
                <textarea
                  className="cg-input"
                  value={appearance}
                  onChange={(e) => setAppearance(e.target.value)}
                  placeholder={
                    describing
                      ? 'Reading your photo to describe the character…'
                      : 'Appearance — age, hair, face, wardrobe, build (auto-filled from a reference photo)'
                  }
                  rows={4}
                  style={{ resize: 'vertical', lineHeight: 1.5 }}
                />
                {describing && (
                  <span style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 6, color: LB.accent, fontSize: 11 }}>
                    <Loader2 size={13} className="cg-spin" /> describing…
                  </span>
                )}
              </div>

              <textarea
                className="cg-input"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                placeholder="Personality — confident mentor, playful sidekick, calm narrator…"
                rows={2}
                style={{ resize: 'vertical', lineHeight: 1.5 }}
              />

              <div>
                <input
                  className="cg-input"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="Style tags (comma-separated) — or tap a preset below"
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {STYLE_PRESETS.map((preset) => {
                    const active = splitStyleTags(style).some((t) => t.toLowerCase() === preset.toLowerCase());
                    return (
                      <button
                        key={preset}
                        type="button"
                        className="cg-btn"
                        onClick={() => toggleStyleTag(preset)}
                        style={{
                          padding: '5px 11px',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: active ? '#180f02' : LB.textSecondary,
                          background: active ? LB.accentGradient : 'rgba(255,255,255,0.05)',
                          border: active ? '1px solid rgba(245,158,11,0.7)' : '1px solid rgba(255,255,255,0.12)',
                        }}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Reference photo (optional) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => void handleReferenceFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className="cg-btn"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 14,
                    border: '1px dashed rgba(255,255,255,0.22)',
                    background: referenceUrl ? '#000' : 'rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    padding: 0,
                  }}
                  title="Optional: upload a reference photo"
                >
                  {uploading ? (
                    <Loader2 size={20} className="cg-spin" color={LB.accent} />
                  ) : referenceUrl ? (
                    <img src={referenceUrl} alt="reference" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: LB.textMuted }}>
                      <Upload size={18} />
                      <span style={{ fontSize: 10, fontWeight: 600 }}>Photo</span>
                    </span>
                  )}
                </button>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: LB.textSecondary }}>
                  Optional reference photo. VidVerge reads it and pre-writes the appearance for you; it is also
                  stored with the character as a reference image.
                  {referenceUrl && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => { setReferenceUrl(null); if (fileRef.current) fileRef.current.value = ''; }}
                        style={{ background: 'none', border: 'none', color: LB.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
                      >
                        Remove photo
                      </button>
                    </>
                  )}
                </p>
              </div>

              <ImageEnginePicker
                label="Portrait engine"
                value={imageEngine}
                onChange={setImageEngine}
                disabled={busy}
                platformIds={['gemini-3.1-flash-image']}
                runwayIds={['runway_stock_image', 'gen4_image', 'gen4_image_turbo']}
              />

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f87171', fontSize: 12.5 }}>
                  <AlertTriangle size={13} /> {error}
                </div>
              )}
              {notice && !error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontSize: 12.5 }}>
                  <CheckCircle2 size={13} /> {notice}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="cg-btn"
                  onClick={() => void handleGenerate()}
                  disabled={busy}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '11px 18px',
                    borderRadius: 12,
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: '#180f02',
                    border: 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                    background: LB.accentGradient,
                    boxShadow: '0 6px 20px rgba(245,158,11,0.35)',
                  }}
                >
                  {generating ? <Loader2 size={15} className="cg-spin" /> : previewUrl ? <RefreshCw size={15} /> : <Wand2 size={15} />}
                  {generating ? 'Generating…' : previewUrl ? 'Regenerate portrait' : 'Generate character'}
                </button>
                <button
                  type="button"
                  className="cg-btn"
                  onClick={() => void handleSave()}
                  disabled={busy || (!previewUrl && !referenceUrl && !appearance.trim())}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '11px 18px',
                    borderRadius: 12,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: '#fff',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy || (!previewUrl && !referenceUrl && !appearance.trim()) ? 0.55 : 1,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(255,255,255,0.06)',
                  }}
                >
                  {saving ? <Loader2 size={15} className="cg-spin" /> : <CheckCircle2 size={15} />}
                  Save character
                </button>
              </div>

              {/* MOTION PORTRAIT — short video clip of the character */}
              <div style={{ marginTop: 6, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Film size={15} color={LB.accent} />
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Motion portrait</h3>
                  <span style={{ fontSize: 11, color: LB.textMuted }}>a short video clip of this character</span>
                </div>
                <EnginePicker
                  label="Video engine"
                  value={videoEngine}
                  onChange={setVideoEngine}
                  includeRunway
                  includeKling={false}
                  groupAIds={['gemini-omni-flash-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'sora-2']}
                  disabled={busy}
                />
                {(() => {
                  const rw = runwayModel(videoEngine);
                  const hasPortrait = Boolean(previewUrl || referenceUrl);
                  if (rw && rw.inputType === 'image' && !hasPortrait) {
                    return <div style={{ fontSize: 11.5, color: LB.textMuted, lineHeight: 1.5 }}>This model is image-to-video — generate or upload a portrait first; it becomes the seed frame.</div>;
                  }
                  return hasPortrait
                    ? <div style={{ fontSize: 11.5, color: LB.textMuted, lineHeight: 1.5 }}>The current portrait is the image input; text-capable models also read your motion prompt.</div>
                    : null;
                })()}
                <input
                  className="cg-input"
                  value={motionPrompt}
                  onChange={(e) => setMotionPrompt(e.target.value)}
                  placeholder="Motion prompt (optional) — e.g. slow smile, wind in the hair, gentle camera push-in"
                />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="cg-btn"
                    onClick={() => void handleAnimate()}
                    disabled={busy || (runwayModel(videoEngine)?.inputType === 'image' && !previewUrl && !referenceUrl)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '10px 16px',
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#180f02',
                      border: 'none',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                      background: LB.accentGradient,
                    }}
                  >
                    {animating ? <Loader2 size={15} className="cg-spin" /> : <Film size={15} />}
                    {animating ? 'Animating…' : videoUrl ? 'Regenerate motion portrait' : 'Animate portrait'}
                  </button>
                  {videoUrl ? (
                    <a
                      className="cg-btn"
                      href={videoUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)' }}
                    >
                      Download clip
                    </a>
                  ) : null}
                </div>
                {videoUrl ? (
                  <video src={videoUrl} controls playsInline style={{ width: '100%', maxHeight: 320, borderRadius: 12, background: '#000' }} />
                ) : null}
              </div>
            </div>
          </div>

          {/* Live character card preview */}
          <div style={{ flex: '0 1 340px', minWidth: 280 }}>
            <div
              style={{
                borderRadius: 18,
                border: previewUrl ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(255,255,255,0.10)',
                background: '#0a0e1a',
                overflow: 'hidden',
                boxShadow: previewUrl ? '0 18px 50px rgba(245,158,11,0.18)' : LB.shadow,
              }}
            >
              <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#000' }}>
                {generating ? (
                  <div className="lb-shimmer" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
                ) : previewUrl ? (
                  <img src={previewUrl} alt={name || 'Generated character'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: LB.textMuted, background: 'linear-gradient(160deg, rgba(245,158,11,0.08), #05070d)' }}>
                    <ImageIcon size={30} />
                    <span style={{ fontSize: 12.5, maxWidth: 200, textAlign: 'center', lineHeight: 1.5 }}>
                      Your character card preview appears here
                    </span>
                  </div>
                )}
              </div>
              <div style={{ padding: 16 }}>
                <h4 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name.trim() || 'Unnamed character'}</h4>
                {splitStyleTags(style).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                    {splitStyleTags(style).map((tag) => (
                      <span key={tag} style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: '#fcd34d', background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.3)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {(appearance.trim() || personality.trim()) && (
                  <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: LB.textSecondary, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {appearance.trim()}
                    {personality.trim() ? ` — ${personality.trim()}` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Saved characters */}
        <div style={{ marginTop: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Users size={15} color={LB.accent} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Your characters</h3>
            <span style={{ fontSize: 12, color: LB.textMuted }}>{characters.length > 0 ? `${characters.length} saved` : ''}</span>
          </div>

          {loadingList ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '26px 0', color: LB.textSecondary }}>
              <Loader2 size={18} className="cg-spin" /> <span style={{ fontSize: 14 }}>Loading your characters…</span>
            </div>
          ) : characters.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                textAlign: 'center',
                padding: '36px 20px',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.08)',
                background: '#0a0e1a',
                color: LB.textSecondary,
              }}
            >
              <Users size={26} color="rgba(255,255,255,0.65)" />
              <p style={{ margin: 0, fontSize: 14, maxWidth: 400 }}>
                No characters yet. Describe one above and hit Generate — the saved card becomes a reusable
                cast member for SceneForge, Script-to-Video and Ads Studio.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              {characters.map((c) => (
                <div
                  key={c.id}
                  className="cg-card"
                  style={{
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: '#0d1220',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#000' }}>
                    {c.image_url ? (
                      <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, rgba(245,158,11,0.10), #05070d)' }}>
                        <ImageIcon size={26} color="rgba(255,255,255,0.55)" />
                      </div>
                    )}
                  </div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</h4>
                    {splitStyleTags(c.style).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {splitStyleTags(c.style).map((tag) => (
                          <span key={tag} style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: '#fcd34d', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.28)' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.description && (
                      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: LB.textSecondary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {c.description}
                      </p>
                    )}
                    <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="cg-btn"
                        onClick={() => handleReuse(c)}
                        style={{
                          flex: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          padding: '7px 10px',
                          borderRadius: 9,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: '1px solid rgba(245,158,11,0.5)',
                          color: '#fcd34d',
                          background: 'rgba(245,158,11,0.10)',
                        }}
                      >
                        <Copy size={12} /> Reuse
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(c.id)}
                        title="Delete"
                        style={{ padding: 7, borderRadius: 9, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: LB.textMuted }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
