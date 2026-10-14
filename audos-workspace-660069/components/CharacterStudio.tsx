/**
 * CharacterManager — VidVerge "My Characters".
 *
 * Upload a reference image (face photo or illustration), name the character,
 * and Reel derives a reusable visual description from the image so the same
 * character stays consistent across a video's scenes. Rows live in the
 * `characters` WorkspaceDB table (visitor-scoped by session). One character can
 * be marked as the active pick for the next video.
 *
 * Rendered both as the standalone "My Characters" dock app and inside the
 * in-chat studio overlay, so it takes a `compact` flag to tighten spacing.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Users,
  Upload,
  Trash2,
  CheckCircle2,
  Sparkles,
  Star,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import {
  Character,
  CHARACTER_VISION_PROMPT,
  deleteRow,
  describeImage,
  getDefaultCharacterId,
  getSelectedCharacterId,
  insertRow,
  listRows,
  setDefaultCharacterId,
  setGenerationOptions,
  setSelectedCharacterId,
  STUDIO_EVENTS,
  uploadImage,
  writeFailureNotice,
} from '../lib/reelioStudio';
import VergeLoader from './VergeLoader';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function CharacterManager({ compact = false }: { compact?: boolean }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(getSelectedCharacterId());
  const [defaultId, setDefaultId] = useState<number | null>(getDefaultCharacterId());

  // Draft (new character) state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState('');
  const [environment, setEnvironment] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const rows = await listRows<Character>('characters');
    setCharacters(rows);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    const onData = () => void refresh();
    const onSel = () => {
      setSelectedId(getSelectedCharacterId());
      setDefaultId(getDefaultCharacterId());
    };
    window.addEventListener(STUDIO_EVENTS.dataChanged, onData);
    window.addEventListener(STUDIO_EVENTS.selectionChanged, onSel);
    return () => {
      window.removeEventListener(STUDIO_EVENTS.dataChanged, onData);
      window.removeEventListener(STUDIO_EVENTS.selectionChanged, onSel);
    };
  }, []);

  const resetDraft = () => {
    setName('');
    setDescription('');
    setStyle('');
    setEnvironment('');
    setImageUrl(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage(file, 'characters');
      setImageUrl(url);
      // Auto-derive a description from the image so the user rarely has to type.
      setDescribing(true);
      try {
        const desc = await describeImage(url, CHARACTER_VISION_PROMPT);
        setDescription((prev) => prev || desc);
      } catch (e) {
        // Non-fatal — the user can still write the description themselves.
        console.warn('[Characters] auto-describe failed:', e);
      } finally {
        setDescribing(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not upload that image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Give your character a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = await insertRow('characters', {
        name: name.trim(),
        image_url: imageUrl,
        description: description.trim() || null,
        style: style.trim() || null,
        environment: environment.trim() || null,
      });
      resetDraft();
      await refresh();
      if (row?.id) {
        setSelectedId(row.id);
        setDefaultId(row.id);
        setSelectedCharacterId(row.id);
        setDefaultCharacterId(row.id);
        setGenerationOptions({
          characterEnabled: true,
          characterId: row.id,
          characterName: row.name || name.trim(),
          characterImageUrl: row.image_url || imageUrl || '',
          characterDescription: row.description || description.trim(),
        });
      }
    } catch (e: any) {
      // A guarded table refuses a write from a visitor with no verified session;
      // that refusal is explained in plain language rather than shown raw.
      setError(writeFailureNotice(e, 'This character', e?.message || 'Could not save the character.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (id: number) => {
    const next = selectedId === id ? null : id;
    setSelectedId(next);
    setSelectedCharacterId(next);
    const character = next == null ? null : characters.find((item) => item.id === next) || null;
    setGenerationOptions(
      character
        ? {
            characterEnabled: true,
            characterId: character.id,
            characterName: character.name,
            characterImageUrl: character.image_url || '',
            characterDescription: character.description || '',
          }
        : { characterEnabled: false },
    );
  };

  const handleDelete = async (id: number) => {
    await deleteRow('characters', id);
    if (selectedId === id) setSelectedCharacterId(null);
    if (defaultId === id) setDefaultCharacterId(null);
    await refresh();
  };

  const handleSetDefault = (id: number) => {
    const next = defaultId === id ? null : id;
    setDefaultId(next);
    setDefaultCharacterId(next);
    if (next != null) {
      const character = characters.find((item) => item.id === next);
      if (character) {
        setSelectedId(next);
        setSelectedCharacterId(next);
        setGenerationOptions({
          characterEnabled: true,
          characterId: character.id,
          characterName: character.name,
          characterImageUrl: character.image_url || '',
          characterDescription: character.description || '',
        });
      }
    }
  };

  const pad = compact ? 16 : 24;

  return (
    <div style={{ fontFamily: FONT, color: 'var(--space-text-primary, #F5E9C8)' }}>
      <style>{`
        .cs-btn { transition: transform .16s ease, box-shadow .25s ease, filter .16s ease; }
        .cs-btn:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .cs-card { transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
        .cs-card:hover { transform: translateY(-3px); border-color: rgba(212,146,10,0.45); }
      `}</style>

      {/* New character composer */}
      <div
        style={{
          borderRadius: 18,
          border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
          background: 'linear-gradient(180deg, rgba(212,146,10,0.14) 0%, rgba(212,146,10,0.05) 100%)',
          padding: pad,
          marginBottom: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Sparkles size={16} color="var(--space-brand-highlight, #F0B429)" />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Add a character</h3>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* Upload / preview */}
          <div style={{ flex: '0 0 auto' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              className="cs-btn"
              onClick={() => fileRef.current?.click()}
              style={{
                width: 128,
                height: 128,
                borderRadius: 16,
                border: '1px dashed var(--space-border-strong, rgba(255,255,255,0.18))',
                background: imageUrl ? '#000' : 'rgba(184,120,8,0.06)',
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                padding: 0,
              }}
              title="Upload a reference image"
            >
              {uploading ? (
                <VergeLoader size={96} label="Uploading your image" />
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt="reference"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--space-text-muted, #9E8B55)' }}>
                  <Upload size={22} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Upload image</span>
                </div>
              )}
            </button>
          </div>

          {/* Fields */}
          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Character name (e.g. Maya)"
              style={inputStyle}
            />
            <div style={{ position: 'relative' }}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  describing
                    ? 'Reading the image to describe your character…'
                    : 'Appearance & vibe (auto-filled from the image — edit as you like)'
                }
                rows={compact ? 3 : 4}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
              {describing && (
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--space-brand-highlight, #F0B429)', fontSize: 11 }}>
                  <VergeLoader size={40} label="Reading your image" /> describing…
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="Style (e.g. 3D animated, cartoon, realistic)"
                style={{ ...inputStyle, flex: '1 1 160px', minWidth: 150 }}
              />
              <input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="Environment (e.g. basketball court, studio)"
                style={{ ...inputStyle, flex: '1 1 160px', minWidth: 150 }}
              />
            </div>
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--space-semantic-danger, #f87171)', fontSize: 12.5 }}>
                <AlertTriangle size={13} /> {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="cs-btn"
                onClick={() => void handleSave()}
                disabled={saving || uploading}
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
                  cursor: saving || uploading ? 'not-allowed' : 'pointer',
                  opacity: saving || uploading ? 0.6 : 1,
                  background: 'linear-gradient(135deg, var(--space-brand-primary, #D4920A) 0%, var(--space-brand-highlight, #F0B429) 100%)',
                  boxShadow: '0 0 24px rgba(212,146,10,0.28)',
                }}
              >
                {saving ? <VergeLoader size={30} tone="amber" label="Saving your character" /> : <CheckCircle2 size={15} />}
                Save character
              </button>
              {(name || description || imageUrl) && (
                <button
                  type="button"
                  onClick={resetDraft}
                  style={ghostBtnStyle}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Saved characters */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
          <VergeLoader size={120} caption="Loading your characters" />
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
            border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
            background: 'var(--space-surface-card, #15120A)',
            color: 'var(--space-text-muted, #9E8B55)',
          }}
        >
          <Users size={26} color="var(--space-text-muted, #9E8B55)" />
          <p style={{ margin: 0, fontSize: 14, maxWidth: 360 }}>
            No characters yet. Upload a face photo or illustration above and Verger will keep that
            character looking like the same person in every shot.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact
              ? 'repeat(auto-fill, minmax(150px, 1fr))'
              : 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          {characters.map((c) => {
            const isSel = selectedId === c.id;
            const isDefault = defaultId === c.id;
            return (
              <div
                key={c.id}
                className="cs-card"
                style={{
                  borderRadius: 16,
                  border: isSel ? '1px solid var(--space-brand-primary, #D4920A)' : '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
                  background: 'var(--space-surface-card, #15120A)',
                  overflow: 'hidden',
                  boxShadow: isSel ? '0 0 0 1px var(--space-brand-primary, #D4920A), 0 0 24px rgba(212,146,10,0.28)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#000' }}>
                  {c.image_url ? (
                    <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--space-brand-primary, #D4920A), var(--space-brand-highlight, #F0B429))' }}>
                      <ImageIcon size={26} color="rgba(255,255,255,0.6)" />
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
                        color: '#FFFFFF',
                        background: 'rgba(212,146,10,0.92)',
                      }}
                    >
                      <CheckCircle2 size={11} /> In use
                    </span>
                  )}
                  {isDefault && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: '#FFFFFF',
                        background: 'rgba(184,120,8,0.95)',
                      }}
                    >
                      <Star size={11} /> Video default
                    </span>
                  )}
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </h4>
                  {c.description && (
                    <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: 'var(--space-text-muted, #9E8B55)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.description}
                    </p>
                  )}
                  {(c.style || c.environment) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {c.style && (
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: 'var(--space-brand-highlight, #F0B429)', background: 'rgba(212,146,10,0.12)', border: '1px solid rgba(212,146,10,0.3)' }}>
                          {c.style}
                        </span>
                      )}
                      {c.environment && (
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: '#166534', background: 'rgba(22,101,52,0.10)', border: '1px solid rgba(22,101,52,0.26)' }}>
                          {c.environment}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="cs-btn"
                      onClick={() => handleSelect(c.id)}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        borderRadius: 9,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: isSel ? '1px solid rgba(184,120,8,0.36)' : '1px solid rgba(212,146,10,0.45)',
                        color: isSel ? 'var(--space-text-secondary, #9E8B55)' : '#F0B429',
                        background: isSel ? 'rgba(184,120,8,0.06)' : 'rgba(212,146,10,0.12)',
                      }}
                    >
                      {isSel ? 'Selected' : 'Use this'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(c.id)}
                      title="Delete"
                      style={{ padding: 7, borderRadius: 9, cursor: 'pointer', border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))', background: 'transparent', color: 'var(--space-text-muted, #9E8B55)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="cs-btn"
                    onClick={() => handleSetDefault(c.id)}
                    title="The Videos app pre-selects this character in its picker"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '7px 10px',
                      borderRadius: 9,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: isDefault ? '1px solid rgba(212,146,10,0.45)' : '1px solid rgba(184,120,8,0.14)',
                      color: isDefault ? '#F0B429' : '#9E8B55',
                      background: isDefault ? 'rgba(212,146,10,0.10)' : 'transparent',
                    }}
                  >
                    <Star size={12} />
                    {isDefault ? 'Default for videos' : 'Set as default for videos'}
                  </button>
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
  border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
  background: 'var(--space-surface-input, #18150A)',
  color: 'var(--space-text-primary, #F5E9C8)',
  fontSize: 13.5,
  outline: 'none',
  fontFamily: FONT,
  boxSizing: 'border-box',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--space-text-muted, #9E8B55)',
  border: '1px solid var(--space-border-default, rgba(255,255,255,0.07))',
  background: 'transparent',
  cursor: 'pointer',
};

export default CharacterManager;
