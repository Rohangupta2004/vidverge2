/**
 * VidVerge Studio — product image system (Product Ad, Promo, Cinematic).
 *
 * Option A: paste a product/site URL — the registered `fetch-website-images`
 * workspace hook scrapes up to 8 real images (og:image first) and the user
 * picks one. Option B: upload an image directly. The selected image becomes
 * the video's product reference: a GPT-4-vision visual note is woven into the
 * scene prompts, and the URL travels to the hook as `reference_image_url`.
 */
import { useRef, useState } from 'react';
import { Check, Image as ImageIcon, Link2, Loader2, Upload, X } from 'lucide-react';
import { describeImage, scopedSpaceId, uploadImage } from '../../lib/reelioStudio';
import type { ProductRef } from './videoTypesConfig';
import { clampText } from './videoTypesConfig';

const PRODUCT_VISION_PROMPT =
  'Describe the product shown in this image in 1-2 sentences for a video generation prompt: ' +
  'what it is, its shape, colors, materials, and any visible branding or wordmark. ' +
  'Write it as a plain visual description. Do not mention the photo, the background, or that it is an image.';

const panel: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--space-border-default)',
  background: 'var(--space-surface-panel)',
  padding: 14,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--space-border-default)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--space-text-primary)',
  fontSize: 13.5,
  outline: 'none',
  fontFamily: 'inherit',
};

interface ScrapedImage {
  url: string;
  alt?: string;
}

export default function ProductImagePicker({
  value,
  onChange,
  required,
}: {
  value: ProductRef | null;
  onChange: (p: ProductRef | null) => void;
  required: boolean;
}) {
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [candidates, setCandidates] = useState<ScrapedImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const finish = async (imageUrl: string, source: 'url' | 'upload') => {
    // Set immediately so the form unblocks, then enrich with the vision note.
    onChange({ imageUrl, source });
    setCandidates(null);
    setDescribing(true);
    try {
      const note = clampText(await describeImage(imageUrl, PRODUCT_VISION_PROMPT), 170);
      onChange({ imageUrl, source, visualNote: note });
    } catch {
      /* non-fatal — the generic reference line is used instead */
    } finally {
      setDescribing(false);
    }
  };

  const handleScrape = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Paste your product or site URL first.');
      return;
    }
    setScraping(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/fetch-website-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: { website_url: trimmed } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !Array.isArray(data.images) || data.images.length === 0) {
        setError(data?.error || 'No usable images found on that page — try uploading one instead.');
        return;
      }
      setCandidates(data.images.slice(0, 8));
    } catch {
      setError('Could not reach that page. Check the URL or upload an image instead.');
    } finally {
      setScraping(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file, 'products');
      await finish(uploaded, 'upload');
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Try another image.');
    } finally {
      setUploading(false);
    }
  };

  // ------------------------------------------------------------------ selected
  if (value) {
    return (
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 12 }} data-testid="product-image-card">
        <img
          src={value.imageUrl}
          alt="Product"
          style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', background: '#000', flexShrink: 0 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--space-text-primary)' }}>
            Product image set
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--space-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {describing ? 'Reading the product details…' : value.visualNote || 'Used as the product reference in your scenes'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Remove product image"
          style={{ padding: 7, borderRadius: 9, cursor: 'pointer', border: '1px solid var(--space-border-default)', background: 'transparent', color: 'var(--space-text-muted)' }}
          data-testid="button-product-remove"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------ picking state
  return (
    <div>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Link2 size={15} color="var(--space-text-brand)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--space-text-primary)' }}>From your website</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleScrape();
              }
            }}
            placeholder="https://yourstore.com/product"
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            data-testid="input-product-url"
          />
          <button
            type="button"
            onClick={() => void handleScrape()}
            disabled={scraping}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 14px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--space-text-on-primary)',
              border: 'none',
              cursor: scraping ? 'wait' : 'pointer',
              opacity: scraping ? 0.7 : 1,
              background: 'var(--space-brand-primary)',
            }}
            data-testid="button-product-scrape"
          >
            {scraping ? <Loader2 size={14} className="rst-spin" /> : <ImageIcon size={14} />}
            {scraping ? 'Fetching…' : 'Fetch images'}
          </button>
        </div>

        {candidates && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--space-text-secondary)' }}>
              Pick the image to feature:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }}>
              {candidates.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => void finish(img.url, 'url')}
                  title={img.alt || 'Use this image'}
                  style={{
                    position: 'relative',
                    aspectRatio: '1 / 1',
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '1px solid var(--space-border-default)',
                    background: '#000',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  data-testid="button-product-candidate"
                >
                  <img src={img.url} alt={img.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                  <span style={{ position: 'absolute', right: 5, bottom: 5, width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}>
                    <Check size={12} color="#fff" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 0' }}>
          <span style={{ flex: 1, height: 1, background: 'var(--space-border-default)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: 'var(--space-text-muted)' }}>OR</span>
          <span style={{ flex: 1, height: 1, background: 'var(--space-border-default)' }} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            marginTop: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '9px 14px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--space-text-primary)',
            border: '1px solid var(--space-border-strong)',
            background: 'transparent',
            cursor: uploading ? 'wait' : 'pointer',
            opacity: uploading ? 0.7 : 1,
          }}
          data-testid="button-product-upload"
        >
          {uploading ? <Loader2 size={14} className="rst-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : 'Upload a product image'}
        </button>
      </div>
      {!required && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--space-text-muted)' }}>
          Optional — skip this and the scenes are generated without a product reference.
        </p>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--space-semantic-danger)' }}>{error}</p>}
    </div>
  );
}
