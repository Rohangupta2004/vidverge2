import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ImagePlus,
  Loader2,
  Megaphone,
  Upload,
  X,
} from 'lucide-react';
// workspaceDbToken lives in studioApi (lib/reelioStudio does not export it —
// importing it from there left the symbol undefined and threw on first use).
import { describeProductImage, uploadImage, workspaceDbToken } from './studioApi';
import { scopedSpaceId, studioSessionId } from '../../lib/reelioStudio';
import { finalizeProductAdInBrowser } from '../../lib/client-stitch';
import { Card, ErrorNotice, FieldLabel, PrimaryButton, T, TextArea, TextInput, TextLink } from './ui';

type Phase = 'form' | 'uploading' | 'starting' | 'animating' | 'overlaying' | 'stitching' | 'ready' | 'failed';

interface ProductAdStatus {
  success?: boolean;
  status?: string;
  stage?: string;
  progress?: number;
  job_id?: string;
  download_url?: string;
  error?: string;
  message?: string;
  needs_product_image?: boolean;
  code?: string;
  clip_urls?: string[];
  product_name?: string;
  feature_lines?: string[];
  cta?: string;
  brand_color?: string;
}

function hookHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = workspaceDbToken();
  const session = studioSessionId();
  if (token) headers['X-Workspace-DB-Token'] = token;
  if (session) headers['X-Session-Id'] = session;
  return headers;
}

async function callProductAdHook(name: string, body: Record<string, unknown>): Promise<ProductAdStatus> {
  // Hook execution does not consistently expose custom request headers to the
  // sandbox. Send the already-injected workspace credential in the request
  // body as well; the hook accepts this documented fallback and still forwards
  // it only to wallet-authenticated platform generation endpoints.
  const token = workspaceDbToken();
  const session = studioSessionId();
  const payload: Record<string, unknown> = { ...body };
  if (token) payload.workspace_db_token = token;
  if (session && !payload.session_id) payload.session_id = session;
  const response = await fetch(`/api/hooks/execute/${scopedSpaceId()}/${name}`, {
    method: 'POST',
    headers: hookHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`The Product Ad service returned HTTP ${response.status}.`);
  if (!response.ok && !data.needs_product_image) {
    throw new Error(data.error || `The Product Ad service returned HTTP ${response.status}.`);
  }
  return data;
}

function stageLabel(phase: Phase): string {
  if (phase === 'starting') return 'Preparing product scenes…';
  if (phase === 'animating') return 'Adding subtle motion…';
  if (phase === 'overlaying') return 'Burning in product copy…';
  if (phase === 'stitching') return 'Assembling the final MP4…';
  return 'Building your Product Ad…';
}

export default function ProductAd({ onExit }: { onExit: () => void }) {
  const [productUrl, setProductUrl] = useState('');
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [productName, setProductName] = useState('');
  const [brief, setBrief] = useState('');
  const [features, setFeatures] = useState('');
  const [cta, setCta] = useState('Learn more');
  const [sceneCount, setSceneCount] = useState(3);
  const [phase, setPhase] = useState<Phase>('form');
  const [jobId, setJobId] = useState('');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');
  const [urlError, setUrlError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const clientFinalizeRef = useRef<string | null>(null);

  const busy = ['uploading', 'starting', 'animating', 'overlaying', 'stitching'].includes(phase);
  const productImageUrl = productImageUrls[0] || '';
  const canStart = !!productUrl.trim() || (productImageUrls.length > 0 && !!brief.trim());

  // A Product Ad may be started by Verger from chat. Opening this mode adopts
  // the visitor's newest unfinished side-pipeline job so the browser can run
  // the exact ffmpeg overlay fallback when the server renderer is unavailable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = (window as any).__workspaceDb;
        if (!client || jobId) return;
        const result = await client
          .from('video_jobs')
          .eq('brief_type', 'product_ad_image_to_video')
          .orderBy('created_at', 'desc')
          .limit(1)
          .get();
        const row = result?.data?.[0];
        if (cancelled || !row || row.status !== 'processing') return;
        const payload = row.veo_payload && typeof row.veo_payload === 'object' ? row.veo_payload : {};
        setJobId(String(row.job_id));
        setProductName(String(payload.productName || ''));
        setFeatures(Array.isArray(payload.features) ? payload.features.join('\n') : '');
        setCta(String(payload.cta || 'Learn more'));
        setProgress(Number(payload.progress) || 5);
        setNotice('Resuming your unfinished Product Ad…');
        setPhase(payload.stage === 'client_finalize' ? 'overlaying' : payload.stage === 'overlaying' ? 'overlaying' : 'animating');
      } catch {
        // A missing/unauthenticated DB session simply leaves the blank form.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!jobId || !['animating', 'overlaying', 'stitching'].includes(phase)) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status = await callProductAdHook('check-product-ad-status', { job_id: jobId });
        if (cancelled) return;
        setProgress(Math.max(0, Math.min(100, Number(status.progress) || 0)));
        if (
          status.stage === 'client_finalize' &&
          status.clip_urls &&
          status.clip_urls.length >= 2 &&
          clientFinalizeRef.current !== jobId
        ) {
          clientFinalizeRef.current = jobId;
          setPhase('overlaying');
          setNotice('Burning exact product copy into each scene…');
          try {
            const workspaceUuid = (window as any).__workspaceDb?.workspaceId || null;
            const finalUrl = await finalizeProductAdInBrowser({
              clipUrls: status.clip_urls,
              productName: status.product_name || productName || 'Product',
              featureLines: status.feature_lines || features.split(/[\n;,|]+/).map((line) => line.trim()).filter(Boolean),
              cta: status.cta || cta || 'Learn more',
              brandColor: status.brand_color || '#2563eb',
              workspaceUuid,
              jobId,
              onStage: (stage) => {
                setPhase(stage === 'stitching' ? 'stitching' : 'overlaying');
                setNotice(stage === 'uploading' ? 'Uploading the finished MP4…' : stage === 'stitching' ? 'Joining the finished scenes…' : 'Burning exact product copy into each scene…');
              },
            });
            const attached = await callProductAdHook('check-product-ad-status', {
              job_id: jobId,
              attach_video_url: finalUrl,
            });
            if (!attached.success || attached.stage !== 'ready') throw new Error(attached.error || 'The finished Product Ad could not be attached.');
            if (cancelled) return;
            setDownloadUrl(attached.download_url || finalUrl);
            setProgress(100);
            setPhase('ready');
            setNotice('Product Ad complete — motion, burned-in copy, and final delivery are ready.');
          } catch (caught) {
            if (cancelled) return;
            setError(caught instanceof Error ? caught.message : 'The final Product Ad overlay could not be completed.');
            setPhase('failed');
          }
          return;
        }
        if (status.stage === 'ready' || status.status === 'completed') {
          setDownloadUrl(status.download_url || '');
          setPhase('ready');
          setNotice('Product Ad complete — motion, burned-in copy, and final delivery are ready.');
          return;
        }
        if (status.stage === 'failed' || status.status === 'failed' || status.success === false) {
          setError(status.error || 'The Product Ad could not be completed.');
          setPhase('failed');
          return;
        }
        if (status.stage === 'overlaying') setPhase('overlaying');
        else if (status.stage === 'stitching') setPhase('stitching');
        else setPhase('animating');
        setNotice(status.message || 'The render is still moving through the pipeline.');
        timer = window.setTimeout(poll, 3000);
      } catch (caught) {
        if (cancelled) return;
        setNotice(caught instanceof Error ? caught.message : 'Status is temporarily unavailable; retrying…');
        timer = window.setTimeout(poll, 6000);
      }
    };

    timer = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId]);

  const handleImages = async (files: File[]) => {
    const selected = files
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, Math.max(0, 10 - productImageUrls.length));
    if (selected.length === 0) return;
    setError('');
    setPhase('uploading');
    try {
      const uploaded = await Promise.all(selected.map((file) => uploadImage(file, 'product-ads')));
      setProductImageUrls((current) => [...current, ...uploaded].slice(0, 10));
      const read = await describeProductImage(uploaded[0]);
      if (read) {
        if (!productName.trim() && read.brief.name) setProductName(read.brief.name);
        if (!brief.trim()) setBrief([read.brief.tagline, read.brief.features, read.visualReference].filter(Boolean).join('\n'));
        if (!features.trim() && read.brief.features) setFeatures(read.brief.features);
      }
      setNotice(`${uploaded.length} reference image${uploaded.length === 1 ? '' : 's'} added.`);
      setPhase('form');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Those product references could not be uploaded.');
      setPhase('form');
    }
  };

  const start = async () => {
    if (busy) return;
    if (!canStart) {
      setUrlError('Paste a valid product URL, or upload an image and add a brief.');
      return;
    }
    if (productUrl.trim()) {
      try {
        const parsed = new URL(productUrl.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error('invalid');
      } catch {
        setUrlError('Enter a valid URL, including https://');
        return;
      }
    }
    setUrlError('');
    setError('');
    setNotice('');
    setDownloadUrl('');
    clientFinalizeRef.current = null;
    setProgress(2);
    setPhase('starting');
    try {
      const brandColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--space-brand-primary-600')
        .trim();
      const started = await callProductAdHook('generate-product-ad', {
        product_url: productUrl.trim() || undefined,
        product_image_url: productImageUrl || undefined,
        product_image_urls: productImageUrls,
        reference_images: productImageUrls,
        product_name: productName.trim() || undefined,
        brief: brief.trim(),
        key_features: features,
        cta: cta.trim() || 'Learn more',
        scene_count: sceneCount,
        aspect_ratio: '16:9',
        brand_color: brandColor,
        title: `${productName.trim() || 'Product'} — Product Ad`,
      });
      if (started.needs_product_image) {
        setPhase('form');
        setError(started.error || 'Upload a product image to continue.');
        setNotice(started.code === 'host_not_allowed'
          ? 'APIFY_API_KEY cannot call api.apify.com yet. A manual image works immediately.'
          : 'Live page capture is not configured, so this ad needs a manual product image.');
        return;
      }
      if (!started.success || !started.job_id) {
        throw new Error(started.error || 'The Product Ad could not be started.');
      }
      setJobId(started.job_id);
      setProgress(Math.max(5, Number(started.progress) || 5));
      setNotice(started.message || 'Product scenes are being animated.');
      setPhase('animating');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Product Ad could not be started.');
      setPhase('failed');
    }
  };

  const reset = () => {
    setJobId('');
    setProgress(0);
    setDownloadUrl('');
    clientFinalizeRef.current = null;
    setError('');
    setUrlError('');
    setNotice('');
    setPhase('form');
  };

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
      <TextLink onClick={onExit} testId="button-exit-product-ad" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
        <ArrowLeft size={13} /> Back to the studio
      </TextLink>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: T.accentFg, background: T.accentSoft, border: `1px solid ${T.accentBorder}` }}>
          <Megaphone size={20} />
        </span>
        <div>
          <h1 style={{ margin: 0, color: T.text, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 700, letterSpacing: -0.6 }}>Product Ad</h1>
          <p style={{ margin: '3px 0 0', color: T.sub, fontSize: 13 }}>A separate image-to-video pipeline — product stills, subtle motion, readable copy.</p>
        </div>
      </div>

      {phase === 'form' || phase === 'uploading' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}>
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FieldLabel hint="Optional. If a workspace APIFY_API_KEY is available, VidVerge reads the page and captures product imagery.">Product URL</FieldLabel>
              <div className="rc-field-action" style={{ position: 'relative' }}>
                <TextInput
                  value={productUrl}
                  onChange={(value) => {
                    setProductUrl(value);
                    if (urlError) setUrlError('');
                  }}
                  onEnter={() => void start()}
                  autoFocus
                  invalid={!!urlError}
                  placeholder="Paste your product or website URL…"
                  testId="input-product-ad-url"
                />
                {productUrl ? (
                  <button
                    type="button"
                    className="rc-iconbtn rc-ring"
                    onClick={() => {
                      setProductUrl('');
                      setUrlError('');
                    }}
                    aria-label="Clear product URL"
                    style={{ position: 'absolute', right: 4, top: 2, width: 44, height: 44, border: 0, background: 'transparent', color: T.muted, cursor: 'pointer' }}
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>
              {urlError ? <p role="alert" style={{ margin: '7px 0 0', color: T.danger, fontSize: 13, lineHeight: 1.5 }}>{urlError}</p> : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ height: 1, flex: 1, background: T.border }} />
              <span style={{ color: T.muted, fontSize: 11, fontWeight: 700 }}>OR</span>
              <span style={{ height: 1, flex: 1, background: T.border }} />
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onClick={(event) => { event.currentTarget.value = ''; }}
              onChange={(event) => void handleImages(Array.from(event.target.files || []))}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={phase === 'uploading'}
              data-testid="button-product-ad-upload"
              className="rc-interactive-row rc-press rc-ring"
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: 14, borderRadius: 14, border: `1px dashed ${productImageUrl ? T.success : T.borderStrong}`, background: T.panel, color: T.text, cursor: phase === 'uploading' ? 'wait' : 'pointer', textAlign: 'left' }}
            >
              {phase === 'uploading' ? <Loader2 className="rc-spin" size={20} color={T.accentFg} /> : productImageUrl ? <CheckCircle2 size={20} color={T.success} /> : <ImagePlus size={20} color={T.accentFg} />}
              <span>
                <strong style={{ display: 'block', fontSize: 13.5 }}>{phase === 'uploading' ? 'Uploading references…' : productImageUrls.length ? `${productImageUrls.length} reference${productImageUrls.length === 1 ? '' : 's'} ready` : 'Upload product references'}</strong>
                <span style={{ display: 'block', marginTop: 2, color: T.muted, fontSize: 11.5 }}>Select up to 10 product shots, brand assets, UI screens, or inspiration images.</span>
              </span>
            </button>

            {productImageUrls.length > 0 ? (
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }} data-testid="strip-product-ad-references">
                {productImageUrls.map((url, index) => (
                  <div key={url} style={{ position: 'relative', width: 72, height: 72, flex: '0 0 72px' }}>
                    <img src={url} alt={`Product reference ${index + 1}`} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', borderRadius: 12, border: `1px solid ${T.border}` }} />
                    <button
                      type="button"
                      onClick={() => setProductImageUrls((current) => current.filter((item) => item !== url))}
                      aria-label={`Remove product reference ${index + 1}`}
                      className="rc-iconbtn rc-ring"
                      style={{ position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 999, border: 0, background: 'rgba(0,0,0,0.72)', color: '#fff', cursor: 'pointer' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <FieldLabel>Product name</FieldLabel>
              <TextInput value={productName} onChange={setProductName} placeholder="e.g. Northwind Coffee" testId="input-product-ad-name" />
            </div>
            <div>
              <FieldLabel hint="Describe the product, visual world, and audience. With no URL, this drives one generated still per scene.">Brief</FieldLabel>
              <TextArea value={brief} onChange={setBrief} rows={4} placeholder="A premium cold-brew subscription for busy creatives, photographed in a warm modern studio…" testId="input-product-ad-brief" />
            </div>
            <div>
              <FieldLabel hint="Two or three short lines, separated by commas or new lines.">Key feature lines</FieldLabel>
              <TextArea value={features} onChange={setFeatures} rows={3} placeholder={'Roasted weekly\nDelivered cold\nCancel anytime'} testId="input-product-ad-features" />
            </div>
            <div>
              <FieldLabel>Call to action</FieldLabel>
              <TextInput value={cta} onChange={setCta} placeholder="Shop now" testId="input-product-ad-cta" />
            </div>
            <div>
              <FieldLabel>Scenes</FieldLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {[3, 4, 5].map((count) => (
                  <button key={count} type="button" className="rc-ghost rc-press rc-ring" onClick={() => setSceneCount(count)} data-testid={`button-product-ad-scenes-${count}`} style={{ minWidth: 52, minHeight: 44, padding: '9px 14px', borderRadius: 12, border: `1px solid ${sceneCount === count ? T.accent : T.border}`, background: sceneCount === count ? T.accentSoft : 'transparent', color: sceneCount === count ? T.accentFg : T.sub, cursor: 'pointer', fontWeight: 700 }}>
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {notice ? <p style={{ margin: 0, color: T.sub, fontSize: 12.5 }}>{notice}</p> : null}
          {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          <PrimaryButton onClick={() => void start()} disabled={busy} full testId="button-start-product-ad" style={{ minHeight: 56, padding: '15px 22px', fontSize: 16 }}>
            <Upload size={16} /> Create Product Ad
          </PrimaryButton>
          <p style={{ margin: 0, textAlign: 'center', color: T.muted, fontSize: 11.5, lineHeight: 1.55 }}>
            Uses Kling 2.1 Master when available, then the first available non-Omni image-to-video model. Product Ads are rendered wide so every burned-in line stays crisp and readable.
          </p>
        </div>
      ) : phase === 'ready' ? (
        <Card className="rc-result-enter rc-glass" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: T.success }}><CheckCircle2 size={19} /><strong>Your Product Ad is ready</strong></div>
          {downloadUrl ? <video src={downloadUrl} controls playsInline style={{ width: '100%', marginTop: 16, borderRadius: 13, background: '#000', aspectRatio: '16 / 9' }} data-testid="product-ad-player" /> : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {downloadUrl ? <a href={downloadUrl} download target="_blank" rel="noopener noreferrer" className="rc-btn rc-ring rc-press" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: '10px 16px', borderRadius: 12, color: '#fff', background: T.accent, textDecoration: 'none', fontSize: 14, fontWeight: 700 }}><Download size={14} /> Download MP4</a> : null}
            <TextLink onClick={reset} testId="button-another-product-ad">Make another Product Ad</TextLink>
          </div>
        </Card>
      ) : (
        <Card style={{ marginTop: 24 }}>
          {phase === 'failed' ? (
            <>
              <ErrorNotice>{error || 'The Product Ad did not complete.'}</ErrorNotice>
              <div style={{ marginTop: 14 }}><TextLink onClick={reset} testId="button-retry-product-ad">Edit inputs and try again</TextLink></div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Loader2 className="rc-spin" size={19} color={T.accentFg} /><strong style={{ color: T.text }}>{stageLabel(phase)}</strong></div>
              <div style={{ height: 7, borderRadius: 99, overflow: 'hidden', background: T.panelHover, marginTop: 16 }}><div style={{ height: '100%', width: `${Math.max(4, progress)}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.accentFg})`, transition: 'width .5s ease' }} /></div>
              <p style={{ margin: '10px 0 0', color: T.sub, fontSize: 12.5 }}>{notice || 'This continues through motion, overlays, and stitching.'}</p>
              {jobId ? <p style={{ margin: '8px 0 0', color: T.muted, fontSize: 10.5 }}>Job {jobId}</p> : null}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
