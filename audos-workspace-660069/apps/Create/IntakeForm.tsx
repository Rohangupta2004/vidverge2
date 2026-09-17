/**
 * Screen 2 — intake, adaptive per video type.
 *
 * Product Ad: TWO equal entry points, chosen with a toggle — neither is
 * mandatory on its own, one of them is:
 *   • Paste a link  — auto-fetches the product name / tagline / features (web
 *     search) plus real product images (fetch-website-images hook).
 *   • Upload an image — drop or pick a product/brand image; vision reads it
 *     into the same brief and it becomes the visual reference every
 *     storyboard scene and render prompt matches.
 * Both land on the same editable "Here's what we found" summary card, then
 * continue to the storyboard.
 *
 * Every other type: one topic/idea text area, plus an OPTIONAL compact
 * visual-reference dropzone — the uploaded image is read with vision
 * (same handleUpload + describeProductImage path as Product Ad) and its
 * visualReference note flows into the script and every storyboard still.
 * No brief card for these types: just the image, its thumbnail, and the
 * derived note. Then a tone pill picker (Energetic / Professional / Warm /
 * Dramatic / Playful) and a target length (Short / Medium / Long — default
 * Medium). One primary action: Next →.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Globe,
  ImageOff,
  ImagePlus,
  Link2,
  Loader2,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { AspectRatio, LengthId, VideoTypeDef } from './videoTypes';
import { LENGTHS, TONES } from './videoTypes';
import {
  describeProductImage,
  fetchWebsiteBrief,
  fetchWebsiteImages,
  uploadImage,
  type WebsiteBrief,
  type WebsiteImage,
} from './studioApi';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  GhostButton,
  IconButton,
  PrimaryButton,
  StepHeader,
  T,
  TextArea,
  TextInput,
} from './ui';

export interface IntakeResult {
  topic: string;
  toneId: string;
  lengthId: LengthId;
  aspect: AspectRatio;
  productBrief: WebsiteBrief | null;
  productImages: string[];
  /** Vision read of an uploaded image — empty when none was uploaded (and on the URL path). */
  visualReference: string;
}

/** Which of the two Product Ad entry points the user is filling in. */
type EntryMode = 'url' | 'image';

export default function IntakeForm({
  type,
  onBack,
  onContinue,
  initialUrl,
  initialTopic,
  initialToneId,
  initialLengthId,
  initialAspect,
}: {
  type: VideoTypeDef;
  onBack: () => void;
  onContinue: (result: IntakeResult) => void;
  /**
   * A product URL pasted into the entry screen's hero input — pre-fills the
   * URL field and fetches the brief automatically, so the user lands straight
   * on the editable "Here's what we found" confirm card.
   */
  initialUrl?: string;
  /**
   * Retry hand-off (My Videos → Try again): a failed render's brief lands
   * here pre-filled so re-running it is one review + Next instead of a
   * re-type. All optional — absent values keep the normal defaults.
   */
  initialTopic?: string;
  initialToneId?: string;
  initialLengthId?: LengthId;
  initialAspect?: AspectRatio;
}) {
  const [topic, setTopic] = useState(initialTopic || '');
  const [toneId, setToneId] = useState(initialToneId || 'professional');
  const [lengthId, setLengthId] = useState<LengthId>(initialLengthId || 'medium');
  const [aspect, setAspect] = useState<AspectRatio>(initialAspect || type.defaultAspect);
  const [error, setError] = useState<string | null>(null);

  // Product Ad state — either entry point fills this in.
  const [entryMode, setEntryMode] = useState<EntryMode>('url');
  const [websiteUrl, setWebsiteUrl] = useState((initialUrl || '').trim());
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState(false);
  const [brief, setBrief] = useState<WebsiteBrief | null>(null);
  const [images, setImages] = useState<WebsiteImage[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [visualReference, setVisualReference] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrapeSeq = useRef(0);

  const hasSource = scraped || selectedImages.length > 0;
  /** Non-product types: the optional reference image's thumbnail (newest upload first). */
  const referenceThumb = selectedImages[0] || '';

  // Hero hand-off: a URL pasted on the entry screen fetches itself, so the
  // journey is paste → confirm with no second click. Runs once on mount.
  useEffect(() => {
    if (type.productIntake && (initialUrl || '').trim()) void runScrape(initialUrl || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runScrape = async (url: string) => {
    const clean = url.trim();
    if (!clean || scraping) return;
    setScraping(true);
    setError(null);
    const seq = ++scrapeSeq.current;
    const [briefRes, imagesRes] = await Promise.all([fetchWebsiteBrief(clean), fetchWebsiteImages(clean)]);
    if (seq !== scrapeSeq.current) return; // stale — URL changed mid-flight
    setScraping(false);
    setScraped(true);
    if (briefRes) setBrief(briefRes);
    else if (!brief) setBrief({ name: '', tagline: '', features: '', tone: 'confident, modern' });
    // Additive: an image the user already uploaded stays in the grid and stays selected.
    setImages((prev) => [...prev, ...imagesRes.filter((i) => !prev.some((p) => p.url === i.url))]);
    setSelectedImages((sel) => (sel.length > 0 ? sel : imagesRes.slice(0, 1).map((i) => i.url)));
    if (!briefRes && imagesRes.length === 0) {
      setError("We couldn't read that page — fill in the brief below (or upload a product image) and continue.");
    }
  };

  const toggleImage = (url: string) => {
    setSelectedImages((sel) =>
      sel.includes(url) ? sel.filter((u) => u !== url) : sel.length >= 4 ? sel : [...sel, url],
    );
  };

  /**
   * The image entry point. Accepts a drop or a file pick, uploads to durable
   * storage, then reads the first image with vision so it fills the brief the
   * same way a URL fetch does — and keeps the description as the visual
   * reference the storyboard renders against.
   */
  const handleUpload = async (files: FileList | File[] | null) => {
    const picked = Array.from(files || []).filter((f) => f.type.indexOf('image/') === 0);
    if (picked.length === 0 || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const room = Math.max(1, 4 - selectedImages.length);
      const uploaded: string[] = [];
      for (const file of picked.slice(0, room)) {
        const url = await uploadImage(file, 'products');
        uploaded.push(url);
        setImages((imgs) => [{ url, alt: file.name }, ...imgs]);
      }
      setSelectedImages((sel) => [...uploaded, ...sel].slice(0, 4));
      setUploading(false);

      const first = uploaded[0];
      if (first) {
        setReading(true);
        const read = await describeProductImage(first);
        setReading(false);
        if (read) {
          setVisualReference(read.visualReference);
          setBrief((b) => ({
            name: (b && b.name.trim()) || read.brief.name,
            tagline: (b && b.tagline.trim()) || read.brief.tagline,
            features: (b && b.features.trim()) || read.brief.features,
            tone: (b && b.tone) || read.brief.tone,
          }));
          return;
        }
      }
      setBrief((b) => b || { name: '', tagline: '', features: '', tone: 'confident, modern' });
    } catch (e: any) {
      setUploading(false);
      setReading(false);
      setError((e && e.message) || 'Upload failed — try a different image.');
    }
  };

  /** Non-product types: remove the optional reference image and its vision read. */
  const clearReference = () => {
    setImages([]);
    setSelectedImages([]);
    setVisualReference('');
    setBrief(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const validate = (): string | null => {
    if (type.productIntake) {
      if (!hasSource) return 'Start with a product link or a product image — either one works.';
      if (reading) return 'Still reading your image — one second.';
      if (!brief || !brief.name.trim()) return 'Give the product a name.';
      return null;
    }
    if (!topic.trim()) return `${type.topicLabel} — this one's required.`;
    if (uploading || reading) return 'Still reading your image — one second.';
    return null;
  };

  const handleContinue = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    onContinue({
      topic: topic.trim(),
      toneId,
      lengthId,
      aspect,
      productBrief: type.productIntake ? brief : null,
      productImages: type.productIntake ? selectedImages : [],
      // Every type: the optional reference image's vision read rides into the
      // script and the per-scene storyboard prompts (empty when none).
      visualReference,
    });
  };

  return (
    <div className="rc-fade" style={{ maxWidth: 640 }}>
      <StepHeader title={type.name} subtitle={type.blurb} onBack={onBack} backLabel="All video types" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* ---- Product Ad: two equal entry points ---- */}
        {type.productIntake ? (
          <>
            <div>
              <FieldLabel hint="Either one works — whichever you pick fills the brief in for you.">
                Where should we start?
              </FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Chip selected={entryMode === 'url'} onClick={() => setEntryMode('url')} testId="chip-entry-url">
                  <Link2 size={13} /> Paste a link
                </Chip>
                <Chip selected={entryMode === 'image'} onClick={() => setEntryMode('image')} testId="chip-entry-image">
                  <ImagePlus size={13} /> Upload an image
                </Chip>
              </div>
            </div>

            {entryMode === 'url' ? (
              <div className="rc-fade">
                <FieldLabel hint="We'll pull the product name, tagline, and real product images automatically.">
                  Product page URL
                </FieldLabel>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <TextInput
                      value={websiteUrl}
                      onChange={(v) => setWebsiteUrl(v)}
                      onEnter={() => void runScrape(websiteUrl)}
                      onBlur={() => {
                        if (websiteUrl.trim() && !scraped) void runScrape(websiteUrl);
                      }}
                      placeholder="https://yourproduct.com"
                      autoFocus
                      testId="input-product-url"
                    />
                  </div>
                  <GhostButton
                    onClick={() => void runScrape(websiteUrl)}
                    disabled={scraping || !websiteUrl.trim()}
                    testId="button-fetch-site"
                  >
                    {scraping ? <Loader2 size={14} className="rc-spin" /> : <Globe size={14} />}
                    {scraping ? 'Reading…' : 'Fetch'}
                  </GhostButton>
                </div>
              </div>
            ) : (
              <div className="rc-fade">
                <FieldLabel hint="We read it with AI and use it as the visual reference for every scene — no URL needed.">
                  Product or brand image
                </FieldLabel>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => void handleUpload(e.target.files)}
                />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current && fileRef.current.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (fileRef.current) fileRef.current.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragOver) setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleUpload(e.dataTransfer && e.dataTransfer.files);
                  }}
                  data-testid="dropzone-product-image"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '30px 20px',
                    borderRadius: 14,
                    textAlign: 'center',
                    cursor: uploading || reading ? 'progress' : 'pointer',
                    border: `1px dashed ${dragOver ? T.accentBorder : T.border}`,
                    background: dragOver ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)',
                    transition: 'border-color .15s ease, background .15s ease',
                  }}
                >
                  {uploading || reading ? (
                    <Loader2 size={20} className="rc-spin" color={T.accentFg} />
                  ) : (
                    <Upload size={20} color={T.accentFg} />
                  )}
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>
                    {uploading
                      ? 'Uploading…'
                      : reading
                        ? 'Reading your image…'
                        : 'Drop an image here, or click to choose'}
                  </span>
                  <span style={{ fontSize: 12, color: T.muted, maxWidth: 320, lineHeight: 1.5 }}>
                    {reading
                      ? 'Pulling the product name, tagline, and look straight off the picture.'
                      : 'PNG or JPG — a product shot, your packaging, or a brand image. Up to 4.'}
                  </span>
                </div>
              </div>
            )}

            {/* Editable "Here's what we found" card — the confirm step for both paths */}
            {hasSource && brief ? (
              <Card className="rc-fade" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.accentFg, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Here's what we found — edit anything
                </span>
                <div>
                  <FieldLabel>Product name</FieldLabel>
                  <TextInput value={brief.name} onChange={(v) => setBrief({ ...brief, name: v })} placeholder="Product name" testId="input-brief-name" />
                </div>
                <div>
                  <FieldLabel>Tagline</FieldLabel>
                  <TextInput value={brief.tagline} onChange={(v) => setBrief({ ...brief, tagline: v })} placeholder="One line that sells it" />
                </div>
                <div>
                  <FieldLabel>Features / what it does</FieldLabel>
                  <TextArea value={brief.features} onChange={(v) => setBrief({ ...brief, features: v })} rows={3} placeholder="The 1–3 things worth showing" />
                </div>

                {visualReference ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '10px 12px',
                      borderRadius: 10,
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: T.sub,
                      border: `1px solid ${T.accentBorder}`,
                      background: T.accentSoft,
                    }}
                    data-testid="note-visual-reference"
                  >
                    <Sparkles size={14} color={T.accentFg} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong style={{ color: T.text, fontWeight: 600 }}>Read from your image.</strong> Every
                      storyboard scene is drawn to match it — {visualReference}
                    </span>
                  </div>
                ) : null}

                {images.length > 0 ? (
                  <div>
                    <FieldLabel hint="Pick up to 4 — they become visual references for the render.">Product images</FieldLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                      {images.slice(0, 8).map((img) => {
                        const sel = selectedImages.includes(img.url);
                        return (
                          <button
                            key={img.url}
                            type="button"
                            onClick={() => toggleImage(img.url)}
                            style={{
                              position: 'relative',
                              aspectRatio: '1 / 1',
                              borderRadius: 10,
                              overflow: 'hidden',
                              padding: 0,
                              cursor: 'pointer',
                              border: sel ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
                              background: '#000',
                            }}
                          >
                            <img src={img.url} alt={img.alt || 'product'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            {sel ? (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: 5,
                                  right: 5,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 18,
                                  height: 18,
                                  borderRadius: 999,
                                  background: T.accent,
                                }}
                              >
                                <Check size={12} color="#fff" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.muted }}>
                    <ImageOff size={14} /> No usable images found — upload one above, or continue without.
                  </div>
                )}
              </Card>
            ) : null}

            {hasSource && !brief && (uploading || reading) ? (
              <Card
                className="rc-fade"
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: T.sub }}
              >
                <Loader2 size={14} className="rc-spin" /> Reading your image…
              </Card>
            ) : null}

            {hasSource ? (
              <div>
                <FieldLabel>{type.topicLabel}</FieldLabel>
                <TextArea value={topic} onChange={setTopic} placeholder={type.topicPlaceholder} rows={2} testId="input-topic" />
              </div>
            ) : null}
          </>
        ) : (
          /* ---- All other types: topic / idea + optional visual reference ---- */
          <>
            <div>
              <FieldLabel>{type.topicLabel}</FieldLabel>
              <TextArea value={topic} onChange={setTopic} placeholder={type.topicPlaceholder} rows={3} autoFocus testId="input-topic" />
            </div>

            <div>
              <FieldLabel hint="We read it with AI — its look flows into the script and every storyboard scene.">
                Add a visual reference image (optional)
              </FieldLabel>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => void handleUpload(e.target.files)}
              />
              {referenceThumb ? (
                <Card
                  className="rc-fade"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12 }}
                  data-testid="card-visual-reference"
                >
                  <img
                    src={referenceThumb}
                    alt="Visual reference"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 10,
                      objectFit: 'cover',
                      flexShrink: 0,
                      border: `1px solid ${T.border}`,
                      background: '#000',
                    }}
                    data-testid="img-visual-reference"
                  />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.55, color: T.sub }}>
                    {reading ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <Loader2 size={13} className="rc-spin" color={T.accentFg} /> Reading your image…
                      </span>
                    ) : visualReference ? (
                      <span data-testid="note-visual-reference">
                        <Sparkles size={13} color={T.accentFg} style={{ verticalAlign: -2, marginRight: 5 }} />
                        <strong style={{ color: T.text, fontWeight: 600 }}>Read from your image.</strong> Every
                        storyboard scene is drawn to match it — {visualReference}
                      </span>
                    ) : (
                      <span style={{ color: T.muted }}>
                        We couldn't read this one, so it won't shape the storyboard — try a clearer image, or
                        continue without.
                      </span>
                    )}
                  </div>
                  <IconButton label="Remove reference image" onClick={clearReference} style={{ flexShrink: 0 }}>
                    <X size={14} />
                  </IconButton>
                </Card>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current && fileRef.current.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (fileRef.current) fileRef.current.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragOver) setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleUpload(e.dataTransfer && e.dataTransfer.files);
                  }}
                  data-testid="dropzone-reference-image"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '13px 16px',
                    borderRadius: 12,
                    cursor: uploading || reading ? 'progress' : 'pointer',
                    border: `1px dashed ${dragOver ? T.accentBorder : T.border}`,
                    background: dragOver ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)',
                    transition: 'border-color .15s ease, background .15s ease',
                  }}
                >
                  {uploading || reading ? (
                    <Loader2 size={16} className="rc-spin" color={T.accentFg} style={{ flexShrink: 0 }} />
                  ) : (
                    <ImagePlus size={16} color={T.accentFg} style={{ flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5 }}>
                    {uploading ? (
                      'Uploading…'
                    ) : reading ? (
                      'Reading your image…'
                    ) : (
                      <>
                        <strong style={{ color: T.text, fontWeight: 600 }}>
                          Drop an image here, or click to choose.
                        </strong>{' '}
                        A product shot, a style frame, a location — every scene is drawn to match its look.
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* ---- Tone ---- */}
        <div>
          <FieldLabel>Tone</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TONES.map((t) => (
              <Chip key={t.id} selected={toneId === t.id} onClick={() => setToneId(t.id)} testId={`chip-tone-${t.id}`}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* ---- Target length ---- */}
        <div>
          <FieldLabel hint="Every video gets at least 3 scenes — longer videos add scenes and screen time.">
            Target length
          </FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {LENGTHS.map((l) => (
              <Chip key={l.id} selected={lengthId === l.id} onClick={() => setLengthId(l.id)} testId={`chip-length-${l.id}`}>
                {l.label} · {l.sub}
              </Chip>
            ))}
          </div>
        </div>

        {/* ---- Aspect ratio ---- */}
        <div>
          <FieldLabel>Aspect ratio</FieldLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <Chip selected={aspect === '9:16'} onClick={() => setAspect('9:16')} testId="chip-aspect-vertical">
              <RectangleVertical size={13} /> 9:16 · Vertical
            </Chip>
            <Chip selected={aspect === '16:9'} onClick={() => setAspect('16:9')} testId="chip-aspect-wide">
              <RectangleHorizontal size={13} /> 16:9 · Wide
            </Chip>
          </div>
        </div>

        {error ? <ErrorNotice>{error}</ErrorNotice> : null}

        <PrimaryButton onClick={handleContinue} full testId="button-intake-continue">
          Next →
        </PrimaryButton>
      </div>
    </div>
  );
}
