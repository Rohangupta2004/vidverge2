/**
 * Screen 3 — character (optional but always visible; required for
 * Testimonial / Talking Head).
 *
 * Saved characters show FIRST as selectable cards. Below them, two primary
 * action buttons are ALWAYS visible:
 *   1. Generate with AI — the character image generator. An inline panel takes
 *      a description, a style (Photorealistic / Cinematic / Animated) and how
 *      many options to draw (1–3), then generates them IN PARALLEL and shows
 *      them as a pick-one grid, because the first face out is rarely the right
 *      one. Primary path is the generate-character-image hook; studioApi falls
 *      back to POST /api/generate/image when the hook is not registered.
 *      Whatever succeeds is shown, so one slow or rejected image never costs
 *      the others. Accepting saves to the characters table and auto-selects it.
 *      A generated portrait is also the safest anchor: the video model's safety
 *      filter rejects photorealistic faces it mistakes for a celebrity, and an
 *      Animated-style portrait sidesteps that entirely.
 *   2. Upload Photo — file picker, uploads to platform storage, auto-derives
 *      a visual description (GPT-4 vision, best-effort), saves + selects.
 * "No character, skip →" is clearly available for optional types.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, Upload, User, Check } from 'lucide-react';
import type { CharacterRef } from './videoTypes';
import { clampText } from './videoTypes';
import {
  CHARACTER_VISION_PROMPT,
  describeImage,
  generateCharacterPortrait,
  listSavedCharacters,
  PORTRAIT_STYLES,
  saveCharacter,
  uploadImage,
  type PortraitStyle,
  type SavedCharacter,
} from './studioApi';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  GhostButton,
  PrimaryButton,
  StepHeader,
  T,
  TextArea,
  TextInput,
} from './ui';

export default function CharacterStep({
  required,
  onBack,
  onDone,
  onSkip,
  backLabel,
  subtitle,
  initialDescription,
}: {
  required: boolean;
  onBack: () => void;
  onDone: (character: CharacterRef) => void;
  onSkip: () => void;
  /** Overrides the default "Back" wording (Long Video says where it goes). */
  backLabel?: string;
  /** Overrides the default blurb — Long Video explains the project-wide lock. */
  subtitle?: string;
  /**
   * Pre-fills the AI panel and opens it. Video Series passes the "standard
   * player description" it found in the pasted clip list, so the user does not
   * type it a second time.
   */
  initialDescription?: string;
}) {
  const [saved, setSaved] = useState<SavedCharacter[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);

  // AI generate panel
  const [aiOpen, setAiOpen] = useState(!!(initialDescription || '').trim());
  const [desc, setDesc] = useState((initialDescription || '').trim());
  const [style, setStyle] = useState<PortraitStyle>('Photorealistic');
  const [generating, setGenerating] = useState(false);
  /** How many options to draw per run (each one is a charged generation). */
  const [count, setCount] = useState(3);
  /** Every option from the last run; portraitUrl is the one that is selected. */
  const [variants, setVariants] = useState<string[]>([]);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);

  // Upload path
  const [uploading, setUploading] = useState(false);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [uploadDesc, setUploadDesc] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await listSavedCharacters();
      if (!alive) return;
      setSaved(rows);
      setLoadingSaved(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pickSaved = (c: SavedCharacter) => {
    onDone({
      name: c.name,
      description:
        (c.description || '').trim() || `${c.name}, a consistent on-camera presenter, identical in every scene.`,
      imageUrl: c.image_url || undefined,
      source: 'saved',
    });
  };

  const handleGenerate = async () => {
    const d = desc.trim();
    if (!d) {
      setError('Describe the character first — age, look, vibe.');
      return;
    }
    setError(null);
    setGenerating(true);
    setVariants([]);
    setPortraitUrl(null);
    // Options are drawn in parallel and whatever comes back is shown, so one
    // slow or failed image never costs you the rest of the batch.
    const wanted = Math.max(1, Math.min(3, count));
    const results = await Promise.allSettled(
      Array.from({ length: wanted }, () => generateCharacterPortrait(d, style)),
    );
    const urls: string[] = [];
    let firstMessage = '';
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) urls.push(result.value);
      else if (result.status === 'rejected' && !firstMessage) {
        firstMessage = (result.reason && result.reason.message) || '';
      }
    }
    if (urls.length === 0) {
      setError(firstMessage || 'Portrait generation failed — try again.');
    } else {
      setVariants(urls);
      setPortraitUrl(urls[0]);
      setUploadUrl(null);
      if (urls.length < wanted) {
        setError(`Only ${urls.length} of ${wanted} options came back — generate again for more.`);
      }
    }
    setGenerating(false);
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage(file, 'characters');
      setUploadUrl(url);
      setPortraitUrl(null);
      setVariants([]);
      // Derive a reusable visual description so the render can keep the
      // character consistent even beyond the seed frame. Best-effort.
      try {
        const derived = await describeImage(url, CHARACTER_VISION_PROMPT);
        setUploadDesc(derived);
      } catch {
        /* the user can type one instead */
      }
    } catch (e: any) {
      setError((e && e.message) || 'Upload failed — try a different image.');
    }
    setUploading(false);
  };

  const activeImage = portraitUrl || uploadUrl;
  const activeDesc = portraitUrl ? desc.trim() : uploadDesc.trim();

  const handleConfirm = async () => {
    if (!activeImage || confirming) return;
    if (!activeDesc) {
      setError('Add a short description so every scene renders the same person.');
      return;
    }
    setConfirming(true);
    const charName = name.trim() || clampText(activeDesc, 40) || 'My character';
    // Save + auto-select: the accepted character lands in the characters
    // table (session-scoped) so it shows as a quick-pick next time.
    await saveCharacter({ name: charName, description: activeDesc, image_url: activeImage });
    setConfirming(false);
    onDone({
      name: charName,
      description: activeDesc,
      imageUrl: activeImage,
      source: portraitUrl ? 'ai' : 'upload',
    });
  };

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}> 
      <StepHeader
        title={required ? "Who's on camera?" : "Who's on camera? (optional)"}
        subtitle={
          subtitle ||
          (required
            ? 'This format needs a character — generate one with AI or upload a photo. They stay visually identical in every scene.'
            : 'Add a character to present the video, or skip straight to the storyboard.')
        }
        onBack={onBack}
        backLabel={backLabel}
      />

      {/* The skip path is visible BEFORE any character UI, so an optional step
          never reads as a required one. */}
      {!required ? (
        <div style={{ margin: '-10px 0 20px' }}>
          <GhostButton onClick={onSkip} testId="button-skip-character-top">
            Optional — skip to generate without a character
          </GhostButton>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Saved characters — quick pick first */}
        {loadingSaved ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.muted, fontSize: 13 }}>
            <Loader2 size={14} className="rc-spin" /> Loading your characters…
          </div>
        ) : saved.length > 0 ? (
          <div>
            <FieldLabel>Your saved characters</FieldLabel>
            <div className="rc-mobile-scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 12 }}> 
              {saved.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="rc-card rc-lift-hover rc-press rc-ring"
                  onClick={() => pickSaved(c)}
                  data-testid={`saved-character-${c.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 12,
                    overflow: 'hidden',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    border: `1px solid ${T.border}`,
                    background: T.card,
                  }}
                >
                  <span style={{ position: 'relative', display: 'block', aspectRatio: '1 / 1', width: '100%', background: '#000' }}>
                    {c.image_url ? (
                      <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, rgba(124,58,237,0.3), #0a0a0f)' }}>
                        <User size={20} color="rgba(255,255,255,0.6)" />
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', padding: '7px 9px', fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: T.muted }}>…or create a new one below.</p>
          </div>
        ) : null}

        {/* Two primary actions — always visible */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <PrimaryButton
            onClick={() => setAiOpen((v) => !v)}
            testId="button-generate-with-ai"
            style={aiOpen ? undefined : { background: 'linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%)' }}
          >
            <Sparkles size={15} /> Generate with AI
          </PrimaryButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void handleUpload(e.target.files && e.target.files[0])}
          />
          <GhostButton
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={uploading}
            testId="button-upload-character"
            style={{ padding: '12px 20px', fontSize: 14, fontWeight: 600 }}
          >
            {uploading ? <Loader2 size={15} className="rc-spin" /> : <Upload size={15} />}
            {uploading ? 'Uploading…' : 'Upload Photo'}
          </GhostButton>
        </div>

        {/* Inline AI panel */}
        {aiOpen ? (
          <Card className="rc-fade" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <FieldLabel>Describe your character</FieldLabel>
              <TextArea
                value={desc}
                onChange={setDesc}
                rows={3}
                autoFocus
                placeholder='Age, look, vibe — e.g. "30s woman, confident, casual, dark curly hair"'
                testId="input-character-description"
                expand={{
                  field: 'On-camera character description',
                  context:
                    'A reusable character reference for an AI video: gender presentation, approximate age, ' +
                    'skin tone, hair, notable features, wardrobe, build and how they carry themselves. ' +
                    `Portrait style: ${style}. Never name a real or famous person.`,
                  words: 70,
                }}
              />
            </div>
            <div>
              <FieldLabel hint="Photorealistic faces are sometimes rejected by the video model's safety filter, which can mistake them for a real celebrity. Animated never trips it.">
                Style
              </FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PORTRAIT_STYLES.map((s) => (
                  <Chip key={s} selected={style === s} onClick={() => setStyle(s)} testId={`chip-style-${s.toLowerCase()}`}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel hint="Each option is one image generation — three gives you a real choice of faces.">
                How many options
              </FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[1, 2, 3].map((n) => (
                  <Chip key={n} selected={count === n} onClick={() => setCount(n)} testId={`chip-portrait-count-${n}`}>
                    {n === 1 ? 'Just one' : `${n} options`}
                  </Chip>
                ))}
              </div>
            </div>
            <PrimaryButton onClick={() => void handleGenerate()} disabled={generating} full testId="button-generate-portrait">
              {generating ? <Loader2 size={14} className="rc-spin" /> : variants.length > 0 ? <RefreshCw size={14} /> : <Sparkles size={14} />}
              {generating
                ? count > 1
                  ? `Drawing ${count} options…`
                  : 'Drawing your character…'
                : variants.length > 0
                  ? `Generate ${count > 1 ? `${count} more` : 'another'}`
                  : count > 1
                    ? `Generate ${count} options`
                    : 'Generate'}
            </PrimaryButton>

            {variants.length > 0 ? (
              <div className="rc-fade">
                <FieldLabel hint="Tap one — it becomes this character's reference image in every scene.">
                  {variants.length === 1 ? 'Your character' : `Pick your favourite of ${variants.length}`}
                </FieldLabel>
                <div
                  className="rc-mobile-scroll"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(variants.length, 3)}, minmax(0, 1fr))`,
                    gap: 12,
                  }}
                >
                  {variants.map((url, i) => {
                    const chosen = portraitUrl === url;
                    return (
                      <button
                        key={`${url}_${i}`}
                        type="button"
                        onClick={() => setPortraitUrl(url)}
                        aria-label={`Use option ${i + 1}`}
                        data-testid={`portrait-option-${i + 1}`}
                        className="rc-lift-hover rc-press rc-ring"
                        style={{
                          position: 'relative',
                          padding: 0,
                          borderRadius: 14,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          background: '#000',
                          border: chosen ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                        }}
                      >
                        <img
                          src={url}
                          alt={`Option ${i + 1}`}
                          style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }}
                        />
                        {chosen ? (
                          <span
                            style={{
                              position: 'absolute',
                              top: 6,
                              right: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 20,
                              height: 20,
                              borderRadius: 999,
                              color: '#fff',
                              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                            }}
                          >
                            <Check size={12} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* Preview + accept */}
        {activeImage ? (
          <Card className="rc-fade" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="rc-mobile-stack" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <img
                src={activeImage}
                alt="Character preview"
                style={{ width: 128, height: 128, objectFit: 'cover', borderRadius: 12, border: `1px solid ${T.borderStrong}`, background: '#000' }}
                data-testid="img-character-preview"
              />
              <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <FieldLabel>Character name</FieldLabel>
                  <TextInput value={name} onChange={setName} placeholder="e.g. Maya" testId="input-character-name" />
                </div>
                {!portraitUrl ? (
                  <div>
                    <FieldLabel hint="Auto-described from your photo — edit freely.">Look & vibe</FieldLabel>
                    <TextArea
                      value={uploadDesc}
                      onChange={setUploadDesc}
                      rows={3}
                      placeholder="Describe the person so every scene matches"
                      testId="input-character-look"
                      expand={{
                        field: 'Character look and vibe',
                        context:
                          'A reusable character reference for an AI video, written so the same person renders in every shot.',
                        words: 70,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <PrimaryButton onClick={() => void handleConfirm()} disabled={confirming} full testId="button-confirm-character">
              {confirming ? <Loader2 size={14} className="rc-spin" /> : <Check size={15} />}
              Use this character →
            </PrimaryButton>
          </Card>
        ) : null}

        {error ? <ErrorNotice>{error}</ErrorNotice> : null}

        {!required ? (
          <GhostButton onClick={onSkip} full testId="button-skip-character">
            Optional — skip to generate without a character
          </GhostButton>
        ) : null}
      </div>
    </div>
  );
}
