/**
 * MockupManager — VidVerge "App Mockups".
 *
 * Generate a realistic phone/desktop UI screenshot of a product screen with the
 * AI image pipeline, then reuse it across videos: a mockup the visitor picks is
 * woven into the phone-in-hand beat so the character is seen holding/using that
 * exact screen. Rows live in the `mockups` WorkspaceDB table (visitor-scoped).
 *
 * STRICTLY OPT-IN (Aug 15 2026): generating a mockup no longer selects it, and a
 * pick lasts for the visit it was made in rather than for ever. Both used to be
 * true, and between them they put a phone showing an app screen into the opening
 * shot of every later video — renders nobody had asked a mockup for. “Use this”
 * attaches a generated or saved mockup; uploading is itself an explicit opt-in
 * and attaches that upload immediately. Both routes keep chat and render aligned.
 *
 * Rendered as the "Mockups" dock app and inside the in-chat studio overlay.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Smartphone,
  Monitor,
  Loader2,
  Trash2,
  CheckCircle2,
  Wand2,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import { uploadImage } from '../apps/Create/studioApi';
import {
  Mockup,
  MOCKUP_NEGATIVE_PROMPT,
  buildMockupPrompt,
  deleteRow,
  generateImage,
  getSelectedMockupId,
  insertRow,
  listRows,
  setGenerationOptions,
  setSelectedMockupId,
  STUDIO_EVENTS,
  writeFailureNotice,
} from '../lib/reelioStudio';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function MockupManager({ compact = false }: { compact?: boolean }) {
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(getSelectedMockupId());

  const [appName, setAppName] = useState('');
  const [screen, setScreen] = useState('');
  const [platform, setPlatform] = useState<'phone' | 'desktop'>('phone');
  const [style, setStyle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The mockup this visit just made — highlighted, deliberately not selected. */
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const abortRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const rows = await listRows<Mockup>('mockups');
    setMockups(rows);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    const onData = () => void refresh();
    const onSel = () => setSelectedId(getSelectedMockupId());
    window.addEventListener(STUDIO_EVENTS.dataChanged, onData);
    window.addEventListener(STUDIO_EVENTS.selectionChanged, onSel);
    return () => {
      window.removeEventListener(STUDIO_EVENTS.dataChanged, onData);
      window.removeEventListener(STUDIO_EVENTS.selectionChanged, onSel);
    };
  }, []);

  const handleUpload = async (file: File | null) => {
    if (!file || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const imageUrl = await uploadImage(file, 'mockups');
      const fallbackName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Product mockup';
      const name = appName.trim() || fallbackName;
      const screenName = screen.trim() || 'Uploaded product mockup';
      const row = await insertRow('mockups', {
        name,
        screen: screenName,
        platform,
        image_url: imageUrl,
        prompt: 'Uploaded by the customer as a product mockup reference.',
      });
      await refresh();
      if (row?.id) {
        setSelectedId(row.id);
        setSelectedMockupId(row.id);
        setGenerationOptions({
          mockupEnabled: true,
          mockupId: row.id,
          mockupName: name,
          mockupImageUrl: imageUrl,
        });
      }
      setJustAdded(null);
    } catch (e: any) {
      setError(writeFailureNotice(e, 'This mockup', e?.message || 'Could not upload that mockup.'));
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!appName.trim()) {
      setError('Enter the app or product name.');
      return;
    }
    if (!screen.trim()) {
      setError('Describe the screen you want (e.g. home screen, checkout).');
      return;
    }
    setError(null);
    setGenerating(true);
    abortRef.current = false;
    try {
      const prompt = buildMockupPrompt({
        appName: appName.trim(),
        screen: screen.trim(),
        platform,
        style: style.trim() || undefined,
      });
      const url = await generateImage({
        prompt,
        aspectRatio: platform === 'desktop' ? '16:9' : '9:16',
        quality: 'high',
        // A mockup IS a UI screen full of text — the default negative list's
        // 'text' and phone terms would fight the medium, so the mockup-safe
        // subset (safety + watermark/blur/exposure artifacts) is sent instead.
        negativePrompt: MOCKUP_NEGATIVE_PROMPT,
      });
      if (abortRef.current) return;
      const row = await insertRow('mockups', {
        name: appName.trim(),
        screen: screen.trim(),
        platform,
        image_url: url,
        prompt,
      });
      setScreen('');
      await refresh();
      // NOT SELECTED ON PURPOSE: generating a mockup used to select it, and that
      // pick then rode along into every later video as a phone shot nobody had
      // asked for. It lands in the gallery; "Use this" puts it in a video.
      if (row?.id) setJustAdded(row.id);
    } catch (e: any) {
      // A guarded table refuses a write from a visitor with no verified session;
      // that refusal is explained in plain language rather than shown raw.
      setError(writeFailureNotice(e, 'This mockup', e?.message || 'Could not generate that mockup.'));
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Picking a mockup IS the opt-in: it switches the composer's mockup option on
   * and names the screen, so the chat, the studio and the render all agree.
   * Un-picking switches the option back off, which is what keeps the beat out of
   * the next video.
   */
  const handleSelect = (id: number) => {
    const next = selectedId === id ? null : id;
    setSelectedId(next);
    setSelectedMockupId(next);
    const row = next ? mockups.find((m) => m.id === next) : null;
    setGenerationOptions(
      row
        ? {
            mockupEnabled: true,
            mockupId: row.id,
            mockupName: row.name,
            mockupImageUrl: row.image_url || '',
          }
        : { mockupEnabled: false },
    );
  };

  const handleDelete = async (id: number) => {
    await deleteRow('mockups', id);
    if (selectedId === id) {
      setSelectedMockupId(null);
      setGenerationOptions({ mockupEnabled: false });
    }
    await refresh();
  };

  const pad = compact ? 16 : 24;

  return (
    <div style={{ fontFamily: FONT, color: '#fff' }}>
      <style>{`
        @keyframes msSpin { to { transform: rotate(360deg); } }
        .ms-spin { animation: msSpin .9s linear infinite; }
        .ms-btn { transition: transform .16s ease, filter .16s ease; }
        .ms-btn:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .ms-card { transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
        .ms-card:hover { transform: translateY(-3px); border-color: rgba(45,212,191,0.5); }
      `}</style>

      {/* Generator */}
      <div
        style={{
          borderRadius: 18,
          border: '1px solid rgba(45,212,191,0.24)',
          background: 'linear-gradient(180deg, rgba(13,148,136,0.10) 0%, rgba(255,255,255,0.02) 100%)',
          padding: pad,
          marginBottom: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Wand2 size={16} color="#5eead4" />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Generate an app mockup</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="App / product name or description"
            style={inputStyle}
          />
          <input
            value={screen}
            onChange={(e) => setScreen(e.target.value)}
            placeholder="Screen to show (e.g. home screen, checkout page, dashboard)"
            style={inputStyle}
          />
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="Style (optional) — e.g. dark mode, playful, fintech, glassy"
            style={inputStyle}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(event) => void handleUpload(event.target.files && event.target.files[0])}
            />
            <div style={{ display: 'inline-flex', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
              {(['phone', 'desktop'] as const).map((p) => {
                const on = platform === p;
                const Icon = p === 'phone' ? Smartphone : Monitor;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: 'none',
                      color: on ? '#0a0a0a' : '#9ca3af',
                      background: on ? '#5eead4' : 'transparent',
                      textTransform: 'capitalize',
                    }}
                  >
                    <Icon size={14} /> {p}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="ms-btn"
              onClick={() => uploadRef.current && uploadRef.current.click()}
              disabled={uploading || generating}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '10px 16px',
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 600,
                color: '#dbeafe',
                border: '1px solid rgba(96,165,250,0.34)',
                cursor: uploading || generating ? 'not-allowed' : 'pointer',
                opacity: uploading || generating ? 0.7 : 1,
                background: 'rgba(37,99,235,0.10)',
              }}
              data-testid="button-upload-mockup"
            >
              {uploading ? <Loader2 size={15} className="ms-spin" /> : <Upload size={15} />}
              {uploading ? 'Uploading…' : 'Upload mockup'}
            </button>

            <button
              type="button"
              className="ms-btn"
              onClick={() => void handleGenerate()}
              disabled={generating || uploading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '10px 18px',
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 600,
                color: '#fff',
                border: 'none',
                cursor: generating || uploading ? 'not-allowed' : 'pointer',
                opacity: generating || uploading ? 0.7 : 1,
                background: 'linear-gradient(90deg, #0d9488 0%, #1d4ed8 100%)',
                boxShadow: '0 6px 20px rgba(13,148,136,0.35)',
              }}
            >
              {generating ? <Loader2 size={15} className="ms-spin" /> : <Wand2 size={15} />}
              {generating ? 'Generating…' : 'Generate mockup'}
            </button>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f87171', fontSize: 12.5 }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          {generating && (
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
              Rendering a realistic {platform} screen — this takes ~15–30 seconds.
            </p>
          )}
          {!generating && justAdded !== null && selectedId !== justAdded && (
            <p style={{ margin: 0, fontSize: 12, color: '#5eead4' }}>
              Saved to your mockups. Tap “Use this” on it when you want it in a video — nothing is
              added to a render until you do.
            </p>
          )}
        </div>
      </div>

      {/* Gallery */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 0', color: '#9ca3af' }}>
          <Loader2 size={18} className="ms-spin" /> <span style={{ fontSize: 14 }}>Loading your mockups…</span>
        </div>
      ) : mockups.length === 0 ? (
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
            background: '#0b0b0f',
            color: '#9ca3af',
          }}
        >
          <Smartphone size={26} color="rgba(255,255,255,0.7)" />
          <p style={{ margin: 0, fontSize: 14, maxWidth: 380 }}>
            No mockups yet. Upload your product screen or describe one above to generate a realistic app UI —
            the character will be shown holding or using it.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact
              ? 'repeat(auto-fill, minmax(140px, 1fr))'
              : 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 16,
          }}
        >
          {mockups.map((m) => {
            const isSel = selectedId === m.id;
            const isDesktop = m.platform === 'desktop';
            return (
              <div
                key={m.id}
                className="ms-card"
                style={{
                  borderRadius: 16,
                  border: isSel ? '1px solid #2dd4bf' : '1px solid rgba(255,255,255,0.10)',
                  background: '#101014',
                  overflow: 'hidden',
                  boxShadow: isSel ? '0 0 0 1px #2dd4bf, 0 14px 40px rgba(45,212,191,0.28)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ position: 'relative', aspectRatio: isDesktop ? '16 / 10' : '9 / 16', background: '#000' }}>
                  {m.image_url ? (
                    <img src={m.image_url} alt={m.screen || m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #0d9488, #0a0a0f)' }}>
                      {isDesktop ? <Monitor size={24} color="rgba(255,255,255,0.6)" /> : <Smartphone size={24} color="rgba(255,255,255,0.6)" />}
                    </div>
                  )}
                  {isSel && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: '#0a0a0a',
                        background: 'rgba(45,212,191,0.95)',
                      }}
                    >
                      <CheckCircle2 size={11} /> In use
                    </span>
                  )}
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}
                  </h4>
                  {m.screen && (
                    <p style={{ margin: 0, fontSize: 11.5, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.screen}
                    </p>
                  )}
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4 }}>
                    <button
                      type="button"
                      className="ms-btn"
                      onClick={() => handleSelect(m.id)}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: isSel ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(45,212,191,0.5)',
                        color: isSel ? '#d1d5db' : '#5eead4',
                        background: isSel ? 'rgba(255,255,255,0.05)' : 'rgba(45,212,191,0.12)',
                      }}
                    >
                      {isSel ? 'Selected' : 'Use this'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(m.id)}
                      title="Delete"
                      style={{ padding: 7, borderRadius: 9, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontSize: 13.5,
  outline: 'none',
  fontFamily: FONT,
  boxSizing: 'border-box',
};

export default MockupManager;
