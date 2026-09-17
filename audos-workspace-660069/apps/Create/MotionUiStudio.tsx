/**
 * VidVerge — MOTION UI: the studio surface.
 *
 * The whole additive production mode, wired to motionUiStore:
 *   INPUT   — brief + drag/drop screenshot cards + options (preset, duration,
 *             aspect, style, music, avatar/AI-video toggles) + Generate Motion.
 *   PREVIEW — the live continuous preview (play/pause/scrub), the AI Edit bar,
 *             a preset/length quick-switch, the Quick Editor timeline, and the
 *             Render button.
 *   RENDER  — one continuous Remotion composition rendering to MP4.
 *   DONE    — the finished video with download, Quick Edit and start-over.
 *
 * It is fully self-contained (its own module-scope store), so it never touches
 * the existing agentic pipeline, credit logic, watcher or other modes.
 */
import { useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Film,
  ImagePlus,
  Layers,
  Loader2,
  Lock,
  LockOpen,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import MotionPreview from './motionUiPreview';
import MotionQuickEditor from './MotionQuickEditor';
import {
  MOTION_ASPECTS,
  MOTION_DURATIONS,
  MOTION_PRESETS,
  MOTION_STYLES,
  MAX_DURATION,
  MIN_DURATION,
} from './motionUiPresets';
import {
  addAssets,
  applyAiEdit,
  backToInput,
  backToPreview,
  cancelRender,
  chooseMusic,
  generatePlan,
  regeneratePlan,
  removeAsset,
  renderVideo,
  reorderAsset,
  replaceAsset,
  resetMotionUi,
  setAllowAiVideo,
  setAspect,
  setAssetType,
  setAvatarUrl,
  setBrief,
  setDuration,
  setPreset,
  setStyleWord,
  setUseAvatar,
  toggleLock,
  uploadAvatar,
  useMotionUi,
} from './motionUiStore';
import type { AssetType, MotionAsset } from './motionUiTypes';
import {
  Card,
  Chip,
  ErrorNotice,
  FONT,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  T,
  TextArea,
} from './ui';

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: 'ui_screenshot', label: 'UI screen' },
  { value: 'website', label: 'Website' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'product', label: 'Product' },
  { value: 'logo', label: 'Logo' },
  { value: 'brand', label: 'Brand' },
  { value: 'reference_video', label: 'Reference video' },
];

const MUSIC_MOODS: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'tech', label: 'Tech' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'energetic', label: 'Energetic' },
  { id: 'calm', label: 'Calm' },
];

const EDIT_SUGGESTIONS = [
  'Make the intro faster',
  'Make the camera movement more cinematic',
  'Add a headline when the second screen appears',
  'Make the UI larger',
  'Remove the last 2 seconds',
];

function AssetCard({ asset }: { asset: MotionAsset }) {
  const replaceRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        border: `1px solid ${asset.locked ? T.accentBorder : T.border}`,
        background: 'rgba(255,255,255,0.03)',
      }}
      data-testid={`asset-card-${asset.id}`}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: '#0b1220' }}>
        {asset.type === 'reference_video' ? (
          <video src={asset.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <img src={asset.url} alt={asset.filename} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        )}
        {!asset.analyzed ? (
          <span style={{ position: 'absolute', left: 8, top: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.6)' }}>
            <Loader2 size={11} className="rc-spin" /> Reading…
          </span>
        ) : null}
        <div style={{ position: 'absolute', right: 6, top: 6, display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => toggleLock(asset.id)}
            title={asset.locked ? 'Unlock (AI edits may move it)' : 'Lock (AI edits never move it)'}
            aria-label={asset.locked ? 'Unlock asset' : 'Lock asset'}
            style={iconBadge(asset.locked)}
            data-testid={`asset-lock-${asset.id}`}
          >
            {asset.locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button type="button" onClick={() => removeAsset(asset.id)} title="Remove" aria-label="Remove asset" style={iconBadge(false)} data-testid={`asset-remove-${asset.id}`}>
            <X size={12} />
          </button>
        </div>
      </div>
      <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.filename}>
          {asset.filename}
        </span>
        {asset.role ? <span style={{ fontSize: 10.5, color: T.accentFg }}>{asset.role}</span> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={asset.type}
            onChange={(e) => setAssetType(asset.id, e.target.value as AssetType)}
            aria-label="Asset type"
            style={{ flex: 1, minWidth: 0, padding: '5px 6px', borderRadius: 7, border: `1px solid ${T.border}`, background: '#101014', color: T.sub, fontSize: 11, fontFamily: FONT, cursor: 'pointer' }}
            data-testid={`asset-type-${asset.id}`}
          >
            {ASSET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => replaceRef.current?.click()} title="Replace" aria-label="Replace asset" style={{ ...iconBadge(false), position: 'static', width: 26, height: 26 }}>
            <RefreshCw size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => reorderAsset(asset.id, -1)} aria-label="Move earlier" style={reorderBtn}>←</button>
          <button type="button" onClick={() => reorderAsset(asset.id, 1)} aria-label="Move later" style={reorderBtn}>→</button>
        </div>
      </div>
      <input
        ref={replaceRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) void replaceAsset(asset.id, f);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

function iconBadge(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 8,
    border: `1px solid ${active ? T.accentBorder : 'rgba(255,255,255,0.16)'}`,
    background: active ? T.accentSoft : 'rgba(0,0,0,0.55)',
    color: active ? T.accentFg : '#fff',
    cursor: 'pointer',
  };
}

const reorderBtn: CSSProperties = {
  flex: 1,
  padding: '4px 0',
  borderRadius: 7,
  border: `1px solid ${T.border}`,
  background: 'rgba(255,255,255,0.04)',
  color: T.sub,
  fontSize: 12,
  cursor: 'pointer',
};

export default function MotionUiStudio({ onExit }: { onExit: () => void }) {
  const s = useMotionUi();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const presenterRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [customDuration, setCustomDuration] = useState('');
  const [editText, setEditText] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);

  const screens = s.assets.filter((a) => a.type !== 'reference_video');
  const canGenerate = screens.length > 0 && !s.uploading && !s.generating;

  const onFiles = (files: File[]) => {
    void addAssets(files);
  };

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onExit}
        className="rc-ghost rc-ring"
        data-testid="motionui-exit"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, fontSize: 12.5, color: T.muted, border: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer', fontFamily: FONT }}
      >
        <ArrowLeft size={13} /> Studio
      </button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', background: T.accentSoft, border: `1px solid ${T.accentBorder}` }}>
          <MonitorSmartphone size={16} color={T.accentFg} />
        </span>
        <span style={{ fontSize: 17, fontWeight: 750, letterSpacing: -0.3, color: T.text }}>Motion UI</span>
      </span>
      <span style={{ fontSize: 11.5, color: T.muted }}>Continuous product-launch motion from your real screens</span>
    </div>
  );

  // ---- INPUT ----
  if (s.phase === 'input') {
    return (
      <div>
        {header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 900 }}>
          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Product / project description</SectionLabel>
            <TextArea
              value={s.brief}
              onChange={setBrief}
              placeholder="What are we launching? e.g. Acme — a real-time analytics workspace for product teams. Confident, modern, blue."
              rows={3}
              testId="motionui-brief"
              expand={{ field: 'Product description', words: 60, label: 'Expand with AI' }}
            />
          </div>

          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Upload UI / product screenshots + optional reference video</SectionLabel>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFiles(Array.from(e.dataTransfer.files || []));
              }}
              className={dragOver ? 'rc-drag-over' : ''}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '28px 20px',
                borderRadius: 14,
                border: `1.5px dashed ${dragOver ? T.accentFg : T.borderStrong}`,
                background: dragOver ? T.accentSoft : 'rgba(255,255,255,0.02)',
                cursor: 'pointer',
                textAlign: 'center',
              }}
              onClick={() => fileRef.current?.click()}
              data-testid="motionui-dropzone"
            >
              {s.uploading ? <Loader2 size={22} className="rc-spin" color={T.accentFg} /> : <Upload size={22} color={T.accentFg} />}
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Drag & drop, or browse</span>
              <span style={{ fontSize: 12, color: T.muted }}>Screens, product images and logos — plus a style-only MP4/MOV/WebM reference — up to 12 files</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                onFiles(Array.from(e.target.files || []));
                e.currentTarget.value = '';
              }}
            />

            {s.assets.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))', gap: 12, marginTop: 14 }}>
                {s.assets.map((a) => (
                  <AssetCard key={a.id} asset={a} />
                ))}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 120, borderRadius: 14, border: `1.5px dashed ${T.borderStrong}`, background: 'rgba(255,255,255,0.02)', color: T.accentFg, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600 }}
                  data-testid="motionui-add-another"
                >
                  <ImagePlus size={20} /> Add another asset
                </button>
              </div>
            ) : null}
          </div>

          {/* Options */}
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <SectionLabel style={{ marginBottom: 10 }}>Motion preset</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))', gap: 10 }}>
                {MOTION_PRESETS.map((p) => {
                  const sel = s.presetId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPreset(p.id)}
                      data-testid={`motionui-preset-${p.id}`}
                      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: FONT, color: T.text, border: sel ? `1px solid ${T.accentFg}` : `1px solid ${T.border}`, background: sel ? T.accentSoft : 'rgba(255,255,255,0.02)' }}
                    >
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{p.name}</span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, lineHeight: 1.45, color: T.muted }}>{p.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              <div>
                <SectionLabel style={{ marginBottom: 8 }}>Duration</SectionLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {MOTION_DURATIONS.map((d) => (
                    <Chip key={d.id} selected={s.duration === d.seconds} onClick={() => { setDuration(d.seconds); setCustomDuration(''); }} testId={`motionui-dur-${d.id}`}>
                      {d.label}
                    </Chip>
                  ))}
                  <input
                    type="number"
                    min={MIN_DURATION}
                    max={MAX_DURATION}
                    value={customDuration}
                    placeholder="Custom"
                    onChange={(e) => {
                      setCustomDuration(e.target.value);
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= MIN_DURATION) setDuration(n);
                    }}
                    aria-label="Custom duration in seconds"
                    data-testid="motionui-dur-custom"
                    style={{ width: 78, padding: '9px 11px', borderRadius: 999, border: `1px solid ${T.border}`, background: 'transparent', color: T.text, fontSize: 13, fontFamily: FONT }}
                  />
                </div>
              </div>
              <div>
                <SectionLabel style={{ marginBottom: 8 }}>Aspect ratio</SectionLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {MOTION_ASPECTS.map((a) => (
                    <Chip key={a.id} selected={s.aspect === a.id} onClick={() => setAspect(a.id)} testId={`motionui-aspect-${a.id}`}>
                      {a.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              <div>
                <SectionLabel style={{ marginBottom: 8 }}>Visual style</SectionLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Chip selected={!s.styleWord} onClick={() => setStyleWord('')}>Auto</Chip>
                  {MOTION_STYLES.map((w) => (
                    <Chip key={w} selected={s.styleWord === w} onClick={() => setStyleWord(w)}>
                      {w}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel style={{ marginBottom: 8 }}>Music {s.musicBusy ? <Loader2 size={11} className="rc-spin" style={{ verticalAlign: 'middle' }} /> : null}</SectionLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {MUSIC_MOODS.map((m) => (
                    <Chip key={m.id} selected={s.music === m.id} onClick={() => void chooseMusic(m.id)} testId={`motionui-music-${m.id}`}>
                      {m.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={toggleRow}>
                <input type="checkbox" checked={s.allowAiVideo} onChange={(e) => setAllowAiVideo(e.target.checked)} data-testid="motionui-allow-aivideo" />
                <span>Allow AI video shots where they genuinely help (optional)</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={toggleRow}>
                  <input type="checkbox" checked={s.useAvatar} onChange={(e) => setUseAvatar(e.target.checked)} data-testid="motionui-use-avatar" />
                  <span>Include an avatar / presenter intro or outro (optional)</span>
                </label>
                {s.useAvatar ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 23, flexWrap: 'wrap' }}>
                    {s.avatarUrl ? (
                      <img src={s.avatarUrl} alt="Presenter reference" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 10, border: `1px solid ${T.border}` }} />
                    ) : null}
                    <GhostButton onClick={() => presenterRef.current?.click()} style={{ padding: '6px 10px', fontSize: 11.5 }}>
                      <Upload size={12} /> {s.avatarUrl ? 'Replace presenter image' : 'Add presenter image'}
                    </GhostButton>
                    {s.avatarUrl ? (
                      <button type="button" onClick={() => setAvatarUrl('')} style={{ ...iconBadge(false), position: 'static' }} aria-label="Remove presenter image">
                        <X size={12} />
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: T.muted }}>Optional — Omni can create a presenter without one.</span>
                    )}
                    <input
                      ref={presenterRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0];
                        if (file) void uploadAvatar(file);
                        e.currentTarget.value = '';
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          {s.error ? <ErrorNotice><span>{s.error}</span></ErrorNotice> : null}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <PrimaryButton onClick={() => void generatePlan()} disabled={!canGenerate} testId="motionui-generate">
              {s.generating ? <Loader2 size={17} className="rc-spin" /> : <Wand2 size={17} />}
              {s.generating ? 'Planning…' : 'Generate Motion'}
            </PrimaryButton>
            {screens.length === 0 ? <span style={{ fontSize: 12.5, color: T.muted }}>Add at least one screenshot to begin.</span> : null}
          </div>
        </div>
      </div>
    );
  }

  // ---- GENERATING ----
  if (s.phase === 'generating') {
    return (
      <div>
        {header}
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <MotionPreview plan={s.plan} assets={s.assets} stage={s.stage || 'Working…'} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 18, color: T.sub }}>
            <Loader2 size={16} className="rc-spin" color={T.accentFg} />
            <span style={{ fontSize: 13.5 }}>{s.stage || 'Analyzing assets → Planning motion → Building composition'}</span>
          </div>
        </div>
      </div>
    );
  }

  // ---- RENDERING ----
  if (s.phase === 'rendering') {
    return (
      <div>
        {header}
        <div style={{ maxWidth: 640, margin: '40px auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Loader2 size={28} className="rc-spin" color={T.accentFg} />
          <strong style={{ fontSize: 18, color: T.text }}>Rendering your motion video</strong>
          <span style={{ fontSize: 13.5, color: T.sub, lineHeight: 1.6, maxWidth: 460 }}>
            {s.job?.message || 'Rendering the continuous composition…'} It keeps going even if you switch tabs.
          </span>
          <GhostButton onClick={cancelRender} testId="motionui-cancel-render">Cancel</GhostButton>
        </div>
      </div>
    );
  }

  // ---- DONE ----
  if (s.phase === 'done' && s.job?.videoUrl) {
    return (
      <div>
        {header}
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <video
            src={s.job.videoUrl}
            controls
            autoPlay
            loop
            playsInline
            style={{ width: '100%', borderRadius: 16, background: '#000', border: `1px solid ${T.border}` }}
            data-testid="motionui-final-video"
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <a href={s.job.videoUrl} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <PrimaryButton testId="motionui-download"><Film size={16} /> Download video</PrimaryButton>
            </a>
            <GhostButton onClick={backToPreview} testId="motionui-quick-edit"><Pencil size={15} /> Quick edit</GhostButton>
            <GhostButton onClick={resetMotionUi} testId="motionui-new"><RotateCcw size={15} /> New motion video</GhostButton>
          </div>
        </div>
      </div>
    );
  }

  // ---- PREVIEW (default when a plan exists) ----
  return (
    <div>
      {header}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, maxWidth: 1000, margin: '0 auto' }}>
        {s.plan ? (
          <MotionPreview plan={s.plan} assets={s.assets} onApproxTime={setPreviewTime} />
        ) : null}

        {s.job?.phase === 'failed' && s.job.error ? <ErrorNotice><span>{s.job.error}</span></ErrorNotice> : null}
        {s.error ? <ErrorNotice><span>{s.error}</span></ErrorNotice> : null}

        {s.issues.length > 0 ? (
          <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            <span style={{ color: T.accentFg, fontWeight: 600 }}>Auto-fixed:</span>{' '}
            {s.issues.slice(0, 4).map((i) => i.message).join(' ')}
          </div>
        ) : null}

        {/* AI Edit bar */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionLabel>Edit with AI — describe a change</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editText.trim() && !s.editing) {
                  void applyAiEdit(editText);
                  setEditText('');
                }
              }}
              placeholder="e.g. Make the intro faster, add a headline on the dashboard…"
              data-testid="motionui-edit-input"
              style={{ flex: 1, minWidth: 220, padding: '11px 13px', borderRadius: 11, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.04)', color: T.text, fontSize: 14, fontFamily: FONT }}
            />
            <PrimaryButton
              onClick={() => {
                if (editText.trim()) {
                  void applyAiEdit(editText);
                  setEditText('');
                }
              }}
              disabled={s.editing || !editText.trim()}
              testId="motionui-edit-apply"
              style={{ minHeight: 44 }}
            >
              {s.editing ? <Loader2 size={15} className="rc-spin" /> : <Sparkles size={15} />} Apply
            </PrimaryButton>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {EDIT_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => void applyAiEdit(sug)}
                disabled={s.editing}
                style={{ padding: '5px 10px', borderRadius: 999, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.03)', color: T.sub, fontSize: 11.5, fontFamily: FONT, cursor: s.editing ? 'wait' : 'pointer' }}
              >
                {sug}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: T.muted }}>Locked screens are never moved by AI edits.</span>
        </Card>

        {/* Quick controls */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <GhostButton onClick={regeneratePlan} testId="motionui-regenerate">
            {s.generating ? <Loader2 size={15} className="rc-spin" /> : <RefreshCw size={15} />} Regenerate
          </GhostButton>
          <GhostButton onClick={() => setShowEditor((v) => !v)} testId="motionui-toggle-editor">
            <Layers size={15} /> {showEditor ? 'Hide' : 'Quick'} editor
          </GhostButton>
          <span style={{ flex: 1 }} />
          <GhostButton onClick={backToInput} testId="motionui-back-input"><ArrowLeft size={14} /> Inputs</GhostButton>
          <PrimaryButton onClick={() => void renderVideo()} testId="motionui-render"><Film size={16} /> Render video</PrimaryButton>
        </div>

        {showEditor && s.plan ? (
          <Card>
            <MotionQuickEditor plan={s.plan} assets={s.assets} playhead={previewTime} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

const toggleRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  fontSize: 12.5,
  color: T.sub,
  cursor: 'pointer',
  fontFamily: FONT,
};
