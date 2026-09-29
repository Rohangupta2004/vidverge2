// Product Videos — the script check.
//
// Nothing here costs anything: the whole point of this screen is that the
// customer reads and edits what the video will SAY, and which logo it will
// carry, before a single image, voice line or render is paid for. Only
// “Generate this video” starts the pipeline.

import { useMemo, type CSSProperties } from 'react';
import { ArrowLeft, Check, Globe, Loader2, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import type { LogoCandidate, StoryScript } from '../lib/pipeline';

interface ScriptReviewProps {
  script: StoryScript;
  problem: string;
  productName: string;
  source: { url: string; title: string; siteName: string; description: string } | null;
  logos: LogoCandidate[];
  logoUrl: string | null;
  accent: string;
  regenerating: boolean;
  starting: boolean;
  onChange: (script: StoryScript) => void;
  onPickLogo: (url: string | null) => void;
  onRegenerate: () => void;
  onApprove: () => void;
  onBack: () => void;
}

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'rgba(240,240,240,0.45)',
  marginBottom: 6,
};

const CARD: CSSProperties = {
  padding: 16,
  borderRadius: 14,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
};

export default function ScriptReview({
  script,
  problem,
  productName,
  source,
  logos,
  logoUrl,
  accent,
  regenerating,
  starting,
  onChange,
  onPickLogo,
  onRegenerate,
  onApprove,
  onBack,
}: ScriptReviewProps) {
  const spokenWords = useMemo(
    () => script.scenes.reduce((total, scene) => total + String(scene.narration || '').split(/\s+/).filter(Boolean).length, 0),
    [script],
  );
  // Narration is read at roughly 2.6 words a second and every scene is at
  // least four seconds long, which is what the server uses to time the cut.
  const estimatedSeconds = Math.max(script.scenes.length * 4, Math.round(spokenWords / 2.6));
  const busy = regenerating || starting;

  const updateScene = (index: number, patch: Partial<StoryScript['scenes'][number]>) => {
    const scenes = script.scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene));
    onChange({ ...script, scenes });
  };

  return (
    <div className="pv-rise" style={{ maxWidth: 780 }}>
      <button
        onClick={onBack}
        disabled={busy}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18, background: 'none', border: 'none', color: 'rgba(240,240,240,0.55)', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}
      >
        <ArrowLeft size={14} /> Back to the brief
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Sparkles size={18} color="#F5B936" />
        <span style={{ fontSize: 18, fontWeight: 800, color: '#F0F0F0', letterSpacing: '-0.02em' }}>Check the script</span>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'rgba(240,240,240,0.55)', lineHeight: 1.55 }}>
        This is what your reel will say. Edit any line you like — nothing is generated and nothing is charged until you
        press Generate. Roughly {estimatedSeconds}s across {script.scenes.length} scenes.
      </p>

      {source && (
        <div style={{ ...CARD, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Globe size={14} color="#F5B936" />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#F0F0F0' }}>Read from {source.url}</span>
          </div>
          {problem && (
            <div style={{ fontSize: 12.5, color: 'rgba(240,240,240,0.7)', lineHeight: 1.55 }}>
              <strong style={{ color: '#F5B936' }}>The problem it found:</strong> {problem}
            </div>
          )}
        </div>
      )}

      <div style={{ ...CARD, marginBottom: 14 }}>
        <label style={LABEL}>Your logo in the video</label>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(240,240,240,0.5)', lineHeight: 1.5 }}>
          Taken from your own website. Pick “No logo” and the video carries none — this studio never puts its own mark on
          your film.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {logos.map((candidate) => {
            const selected = logoUrl === candidate.url;
            return (
              <button
                key={candidate.url}
                onClick={() => onPickLogo(candidate.url)}
                disabled={busy}
                title={candidate.why}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  borderRadius: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: selected ? 'rgba(245,185,54,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selected ? 'rgba(245,185,54,0.6)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                <img
                  src={candidate.url}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'contain', background: 'rgba(0,0,0,0.35)', borderRadius: 8 }}
                />
                <span style={{ fontSize: 11.5, color: 'rgba(240,240,240,0.7)', maxWidth: 170, textAlign: 'left' }}>{candidate.why}</span>
                {selected && <Check size={14} color="#F5B936" />}
              </button>
            );
          })}
          <button
            onClick={() => onPickLogo(null)}
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 14px',
              borderRadius: 12,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 700,
              color: logoUrl === null ? '#F5B936' : 'rgba(240,240,240,0.6)',
              background: logoUrl === null ? 'rgba(245,185,54,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${logoUrl === null ? 'rgba(245,185,54,0.6)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <X size={13} /> No logo
          </button>
          {logos.length === 0 && (
            <span style={{ fontSize: 12, color: 'rgba(240,240,240,0.45)', alignSelf: 'center' }}>
              No logo found on that page — the video will run without one.
            </span>
          )}
        </div>
        {accent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: 'rgba(240,240,240,0.55)' }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: accent, border: '1px solid rgba(255,255,255,0.2)' }} />
            Subtitles will use your brand colour {accent}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={LABEL}>Video title</label>
          <input
            className="pv-input"
            value={script.title}
            disabled={busy}
            onChange={(event) => onChange({ ...script, title: event.target.value })}
            placeholder={productName || 'Video title'}
          />
        </div>

        {script.scenes.map((scene, index) => (
          <div key={scene.id || index} style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span
                style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 800, color: '#1A1205', background: '#F5B936' }}
              >
                {index + 1}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(240,240,240,0.75)' }}>Scene {index + 1}</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={LABEL}>Spoken line</label>
                <textarea
                  className="pv-input"
                  rows={2}
                  value={scene.narration}
                  disabled={busy}
                  onChange={(event) => updateScene(index, { narration: event.target.value })}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={LABEL}>On-screen words</label>
                <input
                  className="pv-input"
                  value={scene.subtitle}
                  disabled={busy}
                  onChange={(event) => updateScene(index, { subtitle: event.target.value })}
                />
              </div>
              {scene.background && (
                <div style={{ fontSize: 11.5, color: 'rgba(240,240,240,0.4)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'rgba(240,240,240,0.55)' }}>Shot:</strong> {scene.background.slice(0, 180)}
                  {scene.background.length > 180 ? '…' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="pv-btn"
          onClick={onApprove}
          disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '15px 22px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', boxShadow: '0 14px 40px rgba(245,185,54,0.3)' }}
        >
          {starting ? <Loader2 size={17} className="pv-spin" /> : <Wand2 size={17} />}
          {starting ? 'Starting…' : 'Generate this video'}
        </button>
        <button
          className="pv-btn"
          onClick={onRegenerate}
          disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#F5B936', background: 'rgba(245,185,54,0.08)', border: '1px solid rgba(245,185,54,0.35)' }}
        >
          {regenerating ? <Loader2 size={15} className="pv-spin" /> : <RefreshCw size={15} />}
          {regenerating ? 'Rewriting…' : 'Write me a different script'}
        </button>
      </div>
    </div>
  );
}
