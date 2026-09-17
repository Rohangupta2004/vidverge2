/**
 * Controls panel — the right-hand zone of the full-screen editor.
 * Per-scene controls (headline, caption, duration, scene image + re-generate)
 * autosave live with an 800ms debounce (flushed on blur) through the
 * trackb-project safe mutation contract; video-level settings (brand colours
 * as hex pickers, music, volume, image sources) and the history panels
 * (activity + recoverable versions) live below in collapsible sections.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, Coins, History, ImagePlus, Loader2, Lock,
  Music2, Palette, RefreshCw, ScrollText, Sparkles, Volume2, X,
} from 'lucide-react';
import {
  STATE_EXPLAIN,
  type TrackBConfig, type TrackBProjectRow, type TrackBScene,
} from '../../lib/trackB/api';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10,
  border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5, outline: 'none',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 };

function CostChip({ cost }: { cost: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: S.brand, padding: '2px 7px', borderRadius: 999, background: 'var(--space-brand-primary-50)', border: '1px solid var(--space-brand-primary-100)' }}>
      <Coins size={10} /> {cost} credit{cost === 1 ? '' : 's'} / change
    </span>
  );
}

/** Text control that autosaves 800ms after typing stops and flushes on blur. */
function DebouncedText({ value, maxLength, multiline = false, placeholder, allowEmpty = false, disabled = false, testId, onSave }: {
  value: string;
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  testId?: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  const savedRef = useRef(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setV(value); savedRef.current = value; setSaving(false); }, [value]);

  useEffect(() => {
    if (v === savedRef.current) { setSaving(false); return; }
    if (!allowEmpty && !v.trim()) return; // never autosave an invalid empty value
    setSaving(true);
    const t = window.setTimeout(() => { savedRef.current = v; setSaving(false); onSave(v); }, 800);
    return () => window.clearTimeout(t);
  }, [v, allowEmpty, onSave]);

  const flush = () => {
    if (v === savedRef.current) return;
    if (!allowEmpty && !v.trim()) { setV(savedRef.current); return; }
    savedRef.current = v;
    setSaving(false);
    onSave(v);
  };

  const shared = {
    value: v,
    maxLength,
    placeholder,
    disabled,
    onBlur: flush,
    'data-testid': testId,
  } as const;
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(e) => setV(e.currentTarget.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 64, fontFamily: 'inherit', lineHeight: 1.5 }} />
      ) : (
        <input {...shared} onChange={(e) => setV(e.currentTarget.value)} style={inputStyle} />
      )}
      {saving ? <span aria-hidden="true" style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: '#fbbf24' }} title="Autosaving…" /> : null}
    </span>
  );
}

function Section({ icon, title, right, defaultOpen = false, children, testId }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.panel, overflow: 'hidden' }} data-testid={testId}>
      <button type="button" onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 13px', border: 'none', background: 'transparent', color: S.text, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, textAlign: 'left' }}>
        {open ? <ChevronDown size={13} color="var(--space-text-muted)" /> : <ChevronRight size={13} color="var(--space-text-muted)" />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1 }}>{icon} {title}</span>
        {right}
      </button>
      {open ? <div style={{ padding: '2px 13px 13px' }}>{children}</div> : null}
    </div>
  );
}

export default function ControlsPanel({
  row, config, scene, sceneIndex, sceneCount, busy, versions,
  onCommit, onRegenScene, onRestoreVersion,
  uploadingShots, onUploadShots, onRemoveShot, onToggleAi,
  composingScore, onComposeScore, customTrackUrl, onCustomTrackUrlChange, onAddCustomTrack,
}: {
  row: TrackBProjectRow;
  config: TrackBConfig | null;
  scene: TrackBScene | null;
  sceneIndex: number;
  sceneCount: number;
  busy: boolean;
  versions: { id: number; version: number; scene_id: string | null; reason: string; created_at: string }[];
  onCommit: (operation: string, value: unknown, sceneId?: string) => void;
  onRegenScene: (sceneId: string, imageOnly: boolean) => void;
  onRestoreVersion: (versionId: number, version: number) => void;
  uploadingShots: boolean;
  onUploadShots: (files: FileList | null) => void;
  onRemoveShot: (url: string) => void;
  onToggleAi: (on: boolean) => void;
  composingScore: boolean;
  onComposeScore: () => void;
  customTrackUrl: string;
  onCustomTrackUrlChange: (v: string) => void;
  onAddCustomTrack: () => void;
}) {
  const project = row.project;
  const tiers = config?.credits?.tiers;
  const tokens = project?.brand?.tokens ?? {};
  const tokenNames = Object.keys(tokens);
  const sceneEditable = scene?.state === 'EDITABLE';
  const sceneImage = scene ? (scene.image_url ?? scene.generated_image_url ?? (scene.asset_refs ?? []).find((u) => /^https:\/\//.test(u)) ?? null) : null;
  // A degenerate timing range (min === max) means the planner locked this
  // scene's length to the narration beat — an adjustable slider would be a
  // control that cannot move, so it renders as plain text instead.
  const durationLocked = !!scene?.timing_range && Math.abs(scene.timing_range.max_s - scene.timing_range.min_s) < 0.05;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} data-testid="controls-panel">
      {/* ---- per-scene controls ---- */}
      <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.panel, padding: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800 }}>Scene {sceneCount ? `${sceneIndex + 1} of ${sceneCount}` : ''}</h3>
          {tiers ? <CostChip cost={tiers.text_edit?.default ?? 1} /> : null}
        </div>

        {!scene ? (
          <p style={{ margin: 0, fontSize: 12.5, color: S.muted }}>Select a scene in the timeline once the plan exists.</p>
        ) : !sceneEditable ? (
          <div style={{ fontSize: 12.5, color: S.sub, lineHeight: 1.55 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: scene.state === 'ERROR' ? S.danger : scene.state === 'REGENERATING' ? '#fbbf24' : '#94a3b8' }}>
              {scene.state === 'ERROR' ? <AlertTriangle size={10} /> : scene.state === 'REGENERATING' ? <Loader2 size={10} className="rc-spin" /> : <Lock size={10} />} {scene.state}
            </span>
            <p style={{ margin: '8px 0 0' }}>{STATE_EXPLAIN[scene.state as keyof typeof STATE_EXPLAIN]}</p>
            {scene.state === 'ERROR' && tiers ? (
              <button type="button" onClick={() => onRegenScene(scene.id, false)} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--space-brand-primary-200)', background: 'var(--space-brand-primary-50)', color: S.brand, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }} data-testid="button-retry-regen">
                <RefreshCw size={13} /> Retry regeneration ({tiers.scene_regeneration?.default ?? 20} credits)
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span style={labelStyle}>Headline</span>
              <DebouncedText
                key={`h-${scene.id}-${row.version}`}
                value={scene.headline ?? ''}
                maxLength={120}
                disabled={busy}
                testId="input-headline"
                onSave={(v) => onCommit('set_headline', v, scene.id)}
              />
            </div>
            <div>
              <span style={labelStyle}>Caption</span>
              <DebouncedText
                key={`c-${scene.id}-${row.version}`}
                value={scene.caption ?? ''}
                maxLength={200}
                multiline
                allowEmpty
                disabled={busy}
                testId="input-caption"
                onSave={(v) => onCommit('set_caption', v, scene.id)}
              />
            </div>
            <div>
              <span style={labelStyle}>Duration · {scene.duration_s}s</span>
              {durationLocked ? (
                <p style={{ margin: 0, fontSize: 11.5, color: S.muted, lineHeight: 1.5 }} data-testid="duration-locked">
                  This scene runs exactly {scene.duration_s}s — its length is locked to the narration beat, so there is nothing to adjust.
                </p>
              ) : (
                <>
                  <input
                    key={`d-${scene.id}-${row.version}`}
                    type="range"
                    min={scene.timing_range?.min_s ?? config?.scene_duration_bounds_s?.min ?? 1.5}
                    max={scene.timing_range?.max_s ?? config?.scene_duration_bounds_s?.max ?? 20}
                    step={0.1}
                    defaultValue={scene.duration_s}
                    onMouseUp={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v !== scene.duration_s) onCommit('set_duration', v, scene.id); }}
                    onTouchEnd={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v !== scene.duration_s) onCommit('set_duration', v, scene.id); }}
                    style={{ width: '100%' }}
                    data-testid="input-duration"
                  />
                  {scene.timing_range ? (
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, color: S.muted }}>Adjustable between {scene.timing_range.min_s}s and {scene.timing_range.max_s}s.</p>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <span style={labelStyle}>Scene image</span>
              {sceneImage ? (
                <img src={sceneImage} alt="Current scene visual" style={{ display: 'block', width: '100%', minHeight: 120, maxHeight: 240, objectFit: 'contain', background: '#05070f', borderRadius: 10, border: `1px solid ${S.border}`, marginBottom: 8 }} data-testid="controls-scene-image" />
              ) : (
                <span aria-hidden="true" style={{ display: 'block', width: '100%', height: 64, borderRadius: 10, marginBottom: 8, background: `linear-gradient(135deg, ${tokens.primary ?? 'var(--space-brand-primary-600)'}, ${tokens.accent ?? 'var(--space-brand-primary-400)'})` }} />
              )}
              {tiers ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button type="button" onClick={() => onRegenScene(scene.id, true)} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-regen-image">
                    <ImagePlus size={12} /> Re-generate image · {tiers.scene_regeneration?.default ?? 20} credits
                  </button>
                  <button type="button" onClick={() => onRegenScene(scene.id, false)} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--space-brand-primary-200)', background: 'var(--space-brand-primary-50)', color: S.brand, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-regenerate">
                    <Sparkles size={12} /> Regenerate whole scene · {tiers.scene_regeneration?.default ?? 20} credits
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* ---- video-level settings ---- */}
      <Section icon={<Palette size={12} />} title="Video settings" defaultOpen right={tiers ? <CostChip cost={tiers.colour_edit?.default ?? 1} /> : undefined} testId="section-video-settings">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tokenNames.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: S.muted }}>Brand colours are captured from your product during planning; the pickers unlock then.</p>
          ) : (
            <div>
              <span style={labelStyle}>Brand colours</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {tokenNames.map((t) => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, cursor: 'pointer' }} title={`${t}: ${tokens[t]}`}>
                    <input
                      key={`hex-${t}-${row.version}`}
                      type="color"
                      defaultValue={/^#[0-9a-fA-F]{6}$/.test(tokens[t] ?? '') ? tokens[t] : '#3B82F6'}
                      onBlur={(e) => { const v = e.currentTarget.value; if (v && v.toLowerCase() !== String(tokens[t] ?? '').toLowerCase()) onCommit(`set_brand_hex_${t}`, v); }}
                      style={{ width: 30, height: 26, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                      data-testid={`picker-${t}`}
                      aria-label={`${t} colour`}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: S.sub, textTransform: 'capitalize' }}>{t}</span>
                  </label>
                ))}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 10.5, color: S.muted }}>Extracted from your product page — colour changes apply on the next render.</p>
            </div>
          )}

          {project.checklist?.brand_kit ? (
            <div>
              <span style={labelStyle}>Brand kit</span>
              <div style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, fontSize: 11.5, color: S.sub, lineHeight: 1.6 }} data-testid="brand-kit-info">
                {project.checklist.brand_kit.typography?.font_stack ? (
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={project.checklist.brand_kit.typography.font_stack}>
                    <strong style={{ color: S.text }}>Type:</strong> {project.checklist.brand_kit.typography.style || project.checklist.brand_kit.typography.font_stack}
                  </span>
                ) : null}
                {project.checklist.brand_kit.tone_of_voice ? (
                  <span style={{ display: 'block' }}><strong style={{ color: S.text }}>Voice:</strong> {project.checklist.brand_kit.tone_of_voice}</span>
                ) : null}
                <span style={{ display: 'block', color: S.muted }}>Extracted from your page and confirmed before generation — the film's single colour + type source.</span>
              </div>
            </div>
          ) : null}

          <div>
            <span style={labelStyle}><Music2 size={10} style={{ verticalAlign: '-1px' }} /> Music</span>
            {(project.frozen_audio ?? []).length === 0 ? (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: S.muted }}>No tracks yet — compose one from your script below, or paste a URL.</p>
            ) : (
              <select
                key={`m-${row.version}`}
                defaultValue={project.music?.track ?? ''}
                onChange={(e) => { if (e.currentTarget.value && e.currentTarget.value !== (project.music?.track ?? '')) onCommit('set_music_track', e.currentTarget.value); }}
                style={{ ...inputStyle, cursor: 'pointer', marginBottom: 8 }}
                data-testid="select-music"
              >
                <option value="" disabled>Choose a track…</option>
                {(project.frozen_audio ?? []).map((a) => <option key={a.id} value={a.id}>{a.label ?? a.id}</option>)}
              </select>
            )}
            <button
              type="button"
              disabled={busy || composingScore || sceneCount === 0}
              onClick={onComposeScore}
              style={{ display: 'inline-flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--space-brand-primary-200)', background: 'var(--space-brand-primary-50)', color: S.brand, cursor: 'pointer', fontSize: 12, fontWeight: 700, marginBottom: 6, boxSizing: 'border-box' }}
              data-testid="button-compose-score"
            >
              {composingScore ? <Loader2 size={12} className="rc-spin" /> : <Sparkles size={12} />}
              {composingScore ? 'Composing your score… (~30s)' : 'Compose a score from this script'}
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={customTrackUrl}
                onChange={(e) => onCustomTrackUrlChange(e.currentTarget.value)}
                placeholder="…or paste an https .mp3 URL"
                style={{ ...inputStyle, fontSize: 12 }}
                data-testid="input-custom-track"
              />
              <button type="button" onClick={onAddCustomTrack} disabled={busy || !customTrackUrl.trim()} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-add-track">
                Add
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={labelStyle}><Volume2 size={10} style={{ verticalAlign: '-1px' }} /> Volume · {Math.round((project.music?.volume ?? 0.7) * 100)}%</span>
              <input key={`mv-${row.version}`} type="range" min={0} max={1} step={0.05} defaultValue={project.music?.volume ?? 0.7}
                onMouseUp={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v !== project.music?.volume) onCommit('set_music_volume', v); }}
                onTouchEnd={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v !== project.music?.volume) onCommit('set_music_volume', v); }}
                style={{ width: '100%' }} data-testid="input-volume" />
            </div>
          </div>

          <div>
            <span style={labelStyle}>Scene image sources</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }} data-testid="button-upload-screenshots">
                {uploadingShots ? <Loader2 size={12} className="rc-spin" /> : <ImagePlus size={12} />}
                {uploadingShots ? 'Uploading…' : 'Upload screenshots'}
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { onUploadShots(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid="input-screenshots" />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.sub, cursor: 'pointer' }} data-testid="toggle-ai-images">
                <input type="checkbox" checked={row.ai_image_enabled === true} onChange={(e) => onToggleAi(e.currentTarget.checked)} />
                AI images
              </label>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 10.5, color: S.muted, lineHeight: 1.5 }}>
              Priority: your uploads → your site's real screenshot → AI only if the toggle is on → brand-colour tile.
            </p>
            {(row.user_screenshots ?? []).length ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {(row.user_screenshots ?? []).map((u) => (
                  <span key={u} style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={u} alt="Uploaded screenshot" style={{ width: 52, height: 38, objectFit: 'cover', borderRadius: 7, border: `1px solid ${S.border}` }} />
                    <button type="button" aria-label="Remove screenshot" onClick={() => onRemoveShot(u)}
                      style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, padding: 0, borderRadius: 999, border: 'none', background: S.danger, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {/* ---- history ---- */}
      <Section icon={<ScrollText size={12} />} title="Activity" testId="section-activity">
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {(row.activity_log ?? []).slice().reverse().map((e, i) => (
            <div key={i} style={{ padding: '7px 0', borderTop: i ? `1px solid ${S.border}` : 'none', fontSize: 12, color: S.sub }}>
              <span style={{ fontWeight: 700, color: e.actor === 'agent' ? S.brand : e.actor === 'system' ? S.muted : S.text }}>{e.actor}</span>
              {' · '}{e.intent || e.detail || e.action}
              <span style={{ color: S.muted }}> · v{e.version ?? '—'} · {new Date(e.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<History size={12} />} title="Versions" testId="section-versions">
        {versions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: S.muted }}>Snapshots appear before every scene regeneration or reorder, and periodically as you edit.</p>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {versions.map((v) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${S.border}`, fontSize: 12, color: S.sub }}>
                <span style={{ flex: 1, minWidth: 0 }}>v{v.version} · {v.reason}{v.scene_id ? ` (${v.scene_id})` : ''} · {new Date(v.created_at).toLocaleString()}</span>
                <button type="button" onClick={() => onRestoreVersion(v.id, v.version)} style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 11, fontWeight: 600 }} data-testid={`button-restore-${v.id}`}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
