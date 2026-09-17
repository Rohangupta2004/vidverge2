/**
 * VidVerge Studio — character system.
 *
 * Two paths, side by side: AI-generate a portrait from a text description
 * (POST /api/generate/image via lib/reelioStudio.generateImage) or upload a
 * face photo (POST /api/upload/file). Either way the confirmed character is a
 * { name, description, imageUrl } the generate flow passes to the hook as
 * `character_data` + `character_description` + `character_image_url`, which
 * keeps the same face across every scene.
 */
import { useRef, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, Upload, UserRound, X, Check } from 'lucide-react';
import {
  CHARACTER_VISION_PROMPT,
  describeImage,
  generateImage,
  uploadImage,
} from '../../lib/reelioStudio';
import type { CharacterRef } from './videoTypesConfig';
import { clampText } from './videoTypesConfig';

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

function portraitPrompt(description: string): string {
  return (
    `Portrait photo of a person for an on-camera video role: ${description.trim()}. ` +
    'Photorealistic, professional lighting, clean neutral background, face clearly visible, ' +
    'sharp focus, shown from the shoulders up, looking at the camera.'
  );
}

export default function CharacterSetup({
  value,
  onChange,
  required,
}: {
  value: CharacterRef | null;
  onChange: (c: CharacterRef | null) => void;
  required: boolean;
}) {
  const [mode, setMode] = useState<'ai' | 'upload' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generating' | 'uploading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Description derived from an uploaded photo (GPT-4 vision), kept separate
  // so the AI-path textarea is never overwritten.
  const uploadDescRef = useRef<string>('');

  const reset = () => {
    setMode(null);
    setPreview(null);
    setBusy(null);
    setError(null);
  };

  const handleGenerate = async () => {
    const desc = description.trim();
    if (desc.length < 8) {
      setError('Describe the character in a few words first.');
      return;
    }
    setBusy('generating');
    setError(null);
    try {
      const url = await generateImage({ prompt: portraitPrompt(desc), aspectRatio: '1:1', quality: 'high' });
      setPreview(url);
    } catch (e: any) {
      setError(e?.message || 'Could not generate the portrait. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file (a clear face photo works best).');
      return;
    }
    setMode('upload');
    setBusy('uploading');
    setError(null);
    try {
      const url = await uploadImage(file, 'characters');
      setPreview(url);
      // Derive a reusable visual description so the same person can be held
      // consistent across scenes. Non-fatal: a generic line still works.
      try {
        uploadDescRef.current = clampText(await describeImage(url, CHARACTER_VISION_PROMPT), 340);
      } catch {
        uploadDescRef.current =
          'The person shown in the provided reference photo — same face, hair, and presence in every scene.';
      }
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Try another image.');
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const confirm = () => {
    if (!preview) return;
    const finalName = name.trim() || 'The presenter';
    const finalDesc =
      mode === 'upload'
        ? uploadDescRef.current
        : clampText(description, 340);
    onChange({ name: finalName, description: finalDesc, imageUrl: preview, source: mode === 'upload' ? 'upload' : 'ai' });
    reset();
  };

  // ------------------------------------------------------------------ set state
  if (value) {
    return (
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 12 }} data-testid="character-card">
        {value.imageUrl ? (
          <img
            src={value.imageUrl}
            alt={value.name}
            style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <span style={{ width: 52, height: 52, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--space-surface-accent-soft)', flexShrink: 0 }}>
            <UserRound size={22} color="var(--space-text-brand)" />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--space-text-primary)' }}>{value.name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--space-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value.source === 'ai' ? 'AI-generated' : 'Uploaded photo'} · kept identical in every scene
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Remove character"
          style={{ padding: 7, borderRadius: 9, cursor: 'pointer', border: '1px solid var(--space-border-default)', background: 'transparent', color: 'var(--space-text-muted)' }}
          data-testid="button-character-remove"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- preview state
  if (preview) {
    return (
      <div style={panel}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <img src={preview} alt="Character preview" style={{ width: 108, height: 108, borderRadius: 14, objectFit: 'cover' }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', marginBottom: 6 }}>
              Name (optional)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maya"
              style={inputStyle}
              data-testid="input-character-name"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={confirm}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--space-text-on-primary)', border: 'none', cursor: 'pointer', background: 'var(--space-brand-primary)' }}
                data-testid="button-character-confirm"
              >
                <Check size={14} /> Use this character
              </button>
              {mode === 'ai' && (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={busy === 'generating'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--space-text-secondary)', border: '1px solid var(--space-border-default)', background: 'transparent', cursor: 'pointer' }}
                >
                  {busy === 'generating' ? <Loader2 size={14} className="rst-spin" /> : <RefreshCw size={14} />} Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--space-text-muted)', border: '1px solid var(--space-border-default)', background: 'transparent', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        {error && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--space-semantic-danger)' }}>{error}</p>}
      </div>
    );
  }

  // -------------------------------------------------------------- choose state
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {/* AI generate */}
        <div
          style={{
            ...panel,
            borderColor: mode === 'ai' ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={15} color="var(--space-text-brand)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--space-text-primary)' }}>AI Generate</span>
          </div>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setMode('ai');
            }}
            onFocus={() => setMode('ai')}
            placeholder="Describe your character — e.g. woman in her 30s, curly dark hair, warm smile, mustard sweater"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 66 }}
            data-testid="input-character-description"
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={busy === 'generating'}
            style={{
              marginTop: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 14px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--space-text-on-primary)',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy === 'generating' ? 0.7 : 1,
              background: 'var(--space-brand-primary)',
            }}
            data-testid="button-character-generate"
          >
            {busy === 'generating' ? <Loader2 size={14} className="rst-spin" /> : <Sparkles size={14} />}
            {busy === 'generating' ? 'Generating… (~30s)' : 'Generate portrait'}
          </button>
        </div>

        {/* Upload */}
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Upload size={15} color="var(--space-text-brand)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--space-text-primary)' }}>Upload a photo</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--space-text-muted)', lineHeight: 1.5 }}>
            A clear face photo works best — the video keeps the same person in every scene.
          </p>
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
            disabled={busy === 'uploading'}
            style={{
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
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy === 'uploading' ? 0.7 : 1,
            }}
            data-testid="button-character-upload"
          >
            {busy === 'uploading' ? <Loader2 size={14} className="rst-spin" /> : <Upload size={14} />}
            {busy === 'uploading' ? 'Uploading…' : 'Choose photo'}
          </button>
        </div>
      </div>
      {!required && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--space-text-muted)' }}>
          Optional — skip this and the video runs without an on-camera character.
        </p>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--space-semantic-danger)' }}>{error}</p>}
    </div>
  );
}
