/**
 * SPORTS & EVENTS — the Track A multi-scene sports mode's surface.
 *
 * Pure projection of apps/Create/sportsRunner.ts (module scope, so the run
 * survives every tab switch — see the note there). The visitor pastes a
 * multi-scene script; the pipeline then runs four visible steps — Parsing
 * scenes → Generating character → Expanding prompts → Producing videos — with
 * clear labels at the top instead of a bare spinner.
 *
 * CHARACTER LOCK: a collapsible "Set character reference →" card under the
 * script input (collapsed by default) offers auto-generate-from-script, a
 * manual description, and the photo upload; once locked, a compact
 * "Character locked" card with the thumbnail, a two-line description and a
 * Regenerate button sits above the scene list, and the SAME lock image is the
 * identity reference on every scene's render.
 *
 * SCENE CARDS are compact — number, truncated title, one status chip
 * (Queued / Generating / Done ✓ / Failed ✗), a two-line preview of the
 * expanded prompt with a show/hide toggle, and a small video + Download once
 * done. Regenerate is hidden unless the card is hovered or the scene failed.
 */
import { useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  MonitorPlay,
  RotateCcw,
  Smartphone,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import { uploadImage } from './studioApi';
import { useFrameChain } from './frameChain';
import {
  MAX_SPORTS_SCENES,
  generateCharacterLockFromScript,
  regenerateCharacterLock,
  regenerateSportsScene,
  resetSports,
  setCharacterLockDescription,
  setSportsAspect,
  setSportsCharacterImage,
  setSportsScript,
  startSportsRun,
  useSports,
  type SportsPhase,
  type SportsScene,
} from './sportsRunner';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  GhostButton,
  PrimaryButton,
  ProgressBar,
  SectionLabel,
  StepHeader,
  T,
  TextArea,
} from './ui';

const SPORTS_CSS = `
.sp-regen { opacity: 0; transition: opacity .15s ease; }
.sp-scene-card:hover .sp-regen, .sp-regen[data-always='true'] { opacity: 1; }
@media (hover: none) { .sp-regen { opacity: 1; } }
`;

const twoLineClamp: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

// ---------------------------------------------------------------------------
// The 4-step progress rail — clear labels, never a raw spinner alone.
// ---------------------------------------------------------------------------
const RUN_STEPS = ['Parsing scenes', 'Generating character', 'Expanding prompts', 'Producing videos'] as const;

function stepIndexFor(phase: SportsPhase): number {
  switch (phase) {
    case 'parsing':
      return 0;
    case 'character':
      return 1;
    case 'expanding':
      return 2;
    case 'running':
      return 3;
    case 'done':
      return 4;
    default:
      return -1;
  }
}

function RunSteps({ phase }: { phase: SportsPhase }) {
  const current = stepIndexFor(phase);
  if (current < 0) return null;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}
      data-testid="steps-sports-run"
      aria-label={current >= RUN_STEPS.length ? 'All steps complete' : `${RUN_STEPS[current]} (${current + 1}/${RUN_STEPS.length})`}
    >
      {RUN_STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: active ? '#fff' : done ? T.success : T.muted,
                border: active ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
                background: active ? T.accentSoft : 'transparent',
              }}
              data-testid={`step-sports-${i + 1}`}
            >
              {done ? <Check size={11} /> : active ? <Loader2 size={11} className="rc-spin" /> : null}
              {label} ({i + 1}/{RUN_STEPS.length})
            </span>
            {i < RUN_STEPS.length - 1 ? <span style={{ color: T.muted, fontSize: 11 }}>→</span> : null}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene status chip: Queued / Generating / Done ✓ / Failed ✗
// ---------------------------------------------------------------------------
function statusChip(scene: SportsScene): { label: string; color: string; bg: string; spin: boolean } {
  switch (scene.phase) {
    case 'complete':
      return { label: 'Done ✓', color: T.success, bg: 'rgba(74,222,128,0.12)', spin: false };
    case 'failed':
      return { label: 'Failed ✗', color: T.danger, bg: 'rgba(239,68,68,0.12)', spin: false };
    case 'pending':
      return { label: 'Queued', color: T.muted, bg: 'rgba(148,163,184,0.12)', spin: false };
    case 'expanding':
      return { label: 'Expanding…', color: T.accentFg, bg: T.accentSoft, spin: true };
    default:
      return { label: 'Generating', color: T.accentFg, bg: T.accentSoft, spin: true };
  }
}

function SceneCard({ scene, total, aspect }: { scene: SportsScene; total: number; aspect: string }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const chip = statusChip(scene);
  const working = scene.phase !== 'pending' && scene.phase !== 'complete' && scene.phase !== 'failed';
  const failed = scene.phase === 'failed';
  return (
    <Card
      className="rc-fade sp-scene-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderColor: failed ? 'rgba(239,68,68,0.36)' : T.border,
      }}
      data-testid={`card-sports-scene-${scene.index + 1}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 8,
            flexShrink: 0,
            fontSize: 11.5,
            fontWeight: 700,
            color: T.accentFg,
            background: T.accentSoft,
          }}
        >
          {scene.index + 1}
        </span>
        <strong
          style={{
            flex: 1,
            minWidth: 0,
            color: T.text,
            fontSize: 13.5,
            fontWeight: 650,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={scene.title || scene.description}
        >
          {scene.title || scene.description || `Scene ${scene.index + 1} of ${total}`}
        </strong>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 999,
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            color: chip.color,
            background: chip.bg,
          }}
          data-testid={`badge-sports-scene-${scene.index + 1}`}
        >
          {chip.spin ? <Loader2 size={11} className="rc-spin" /> : null}
          {chip.label}
        </span>
      </div>

      {/* The expanded director's prompt — what is actually being sent — as a
          two-line preview with a show/hide toggle. */}
      {scene.expandedPrompt ? (
        <div>
          <p
            style={{
              margin: 0,
              color: T.sub,
              fontSize: 12,
              lineHeight: 1.5,
              ...(showPrompt ? {} : twoLineClamp),
            }}
            data-testid={`text-sports-prompt-${scene.index + 1}`}
          >
            {scene.expandedPrompt}
          </p>
          <button
            type="button"
            className="rc-quiet rc-ring"
            onClick={() => setShowPrompt((open) => !open)}
            style={{ minHeight: 28, padding: '2px 0', fontSize: 11.5, color: T.accentFg }}
            data-testid={`button-toggle-prompt-${scene.index + 1}`}
          >
            {showPrompt ? 'Hide full prompt' : 'Show full prompt'}
          </button>
        </div>
      ) : (
        <p style={{ margin: 0, color: T.sub, fontSize: 12, lineHeight: 1.5, ...twoLineClamp }}>
          {scene.description || scene.action}
        </p>
      )}

      {scene.videoUrl ? (
        // The player renders at the exact aspect the video was generated in
        // (16:9 landscape by default) so there is no letterboxing or stretch.
        <video
          src={scene.videoUrl}
          controls
          muted
          playsInline
          preload="metadata"
          poster={scene.lastFrameUrl || scene.startFrameUrl || undefined}
          style={{
            width: aspect === '9:16' ? 'auto' : '100%',
            maxHeight: aspect === '9:16' ? 420 : undefined,
            maxWidth: '100%',
            aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9',
            margin: aspect === '9:16' ? '0 auto' : undefined,
            display: 'block',
            borderRadius: 12,
            border: `1px solid ${T.borderStrong}`,
            background: '#000',
            objectFit: 'contain',
          }}
          data-testid={`video-sports-scene-${scene.index + 1}`}
        />
      ) : null}

      {working ? (
        <div>
          <ProgressBar value={scene.progress} stopped={failed} testId={`progress-sports-scene-${scene.index + 1}`} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
            <span style={{ color: T.muted, fontSize: 11.5 }}>{scene.message}</span>
            <span style={{ color: T.muted, fontSize: 11.5 }}>{Math.round(scene.progress * 100)}%</span>
          </div>
        </div>
      ) : null}

      {scene.error ? (
        <ErrorNotice>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ flex: 1 }}>{scene.error}</span>
          <GhostButton
            onClick={() => void regenerateSportsScene(scene.index)}
            style={{ minHeight: 34, padding: '6px 12px', fontSize: 12.5, color: T.danger, borderColor: 'rgba(239,68,68,0.4)', flexShrink: 0 }}
            testId={`button-retry-sports-scene-${scene.index + 1}`}
          >
            <RotateCcw size={12} /> Retry scene
          </GhostButton>
        </ErrorNotice>
      ) : null}

      {scene.phase === 'complete' && scene.videoUrl ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={scene.videoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="rc-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: T.sub, textDecoration: 'none', border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.03)' }}
            data-testid={`link-download-sports-scene-${scene.index + 1}`}
          >
            <Download size={13} /> Download
          </a>
          {/* Regenerate stays out of the way: visible on hover (or touch). */}
          <span className="sp-regen" data-always={failed ? 'true' : 'false'}>
            <GhostButton
              onClick={() => void regenerateSportsScene(scene.index)}
              style={{ padding: '7px 12px', fontSize: 12.5, minHeight: 34 }}
              testId={`button-regenerate-sports-scene-${scene.index + 1}`}
            >
              <RotateCcw size={12} /> Regenerate
            </GhostButton>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The slim "reference passed →" connector between consecutive scene cards.
 * When a COMPLETED scene produced no durable last frame (a CORS-tainted video
 * host, a failed frame upload), the break in the chain is said out loud in
 * amber — the next scene fell back to the character reference — instead of
 * leaving the connector on the waiting copy forever.
 */
function ChainConnector({ from }: { from: SportsScene }) {
  const passed = !!from.lastFrameUrl;
  const broken = !passed && from.phase === 'complete';
  const color = passed ? T.accentFg : broken ? '#fbbf24' : T.muted;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 18px' }}
      data-testid={`connector-sports-${from.index + 1}`}
    >
      {broken ? <AlertTriangle size={13} color={color} /> : <ArrowDown size={13} color={color} />}
      {passed && from.lastFrameUrl ? (
        <img
          src={from.lastFrameUrl}
          alt={`Reference frame from scene ${from.index + 1}`}
          style={{ width: 26, height: 26, borderRadius: 7, objectFit: 'cover', border: `1px solid ${T.accentBorder}`, background: '#000' }}
        />
      ) : null}
      <span style={{ fontSize: 11, fontWeight: 600, color }}>
        {passed
          ? 'reference passed → next scene'
          : broken
            ? 'reference frame unavailable — the next scene used the character reference instead'
            : 'reference passes on when this scene lands'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------
export default function SportsEvents() {
  const sports = useSports();
  const chain = useFrameChain();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [manualDescription, setManualDescription] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const total = sports.scenes.length;
  const doneCount = sports.scenes.filter((scene) => scene.phase === 'complete').length;
  const allDone = total > 0 && doneCount === total;
  const busy = sports.running;
  const lock = sports.characterLock;
  const usingAnchor = !lock && !sports.characterImageUrl && chain.seriesActive && chain.seriesAnchor;

  const handleUpload = async (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadImage(file, 'characters');
      setSportsCharacterImage(url);
    } catch (e: any) {
      setUploadError((e && e.message) || 'That image could not be uploaded — try another one.');
    }
    setUploading(false);
  };

  /** Sequential per-scene downloads — one click, every finished MP4. */
  const downloadAll = () => {
    sports.scenes
      .filter((scene) => scene.videoUrl)
      .forEach((scene, i) => {
        window.setTimeout(() => {
          const a = document.createElement('a');
          a.href = scene.videoUrl;
          a.download = `scene-${scene.index + 1}.mp4`;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 400);
      });
  };

  const generateLabel = busy
    ? sports.phase === 'parsing'
      ? 'Parsing your script into scenes…'
      : sports.phase === 'character'
        ? 'Locking your character…'
        : sports.phase === 'expanding'
          ? 'Expanding scene prompts…'
          : `Producing videos — ${doneCount} of ${total} done`
    : total > 0
      ? 'Run it again'
      : 'Generate the series';

  const lockCard = lock ? (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: `1px solid ${T.accentBorder}`, background: T.accentSoft }}
      data-testid="card-sports-character-lock"
    >
      {lock.imageUrl ? (
        <img
          src={lock.imageUrl}
          alt="Locked character reference"
          style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: `1px solid ${T.accentBorder}`, background: '#000', flexShrink: 0 }}
        />
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 10, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <UserRound size={20} color={T.accentFg} />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 750, letterSpacing: 0.3, color: T.accentFg }}>
          Character locked {lock.imageUrl ? '' : '(text-only reference)'}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: T.sub, ...twoLineClamp }}>
          {lock.description}
        </span>
      </span>
      <GhostButton
        onClick={() => void regenerateCharacterLock()}
        disabled={busy || sports.lockBusy}
        style={{ minHeight: 34, padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
        testId="button-regenerate-character"
      >
        {sports.lockBusy ? <Loader2 size={12} className="rc-spin" /> : <RotateCcw size={12} />} Regenerate character
      </GhostButton>
    </div>
  ) : null;

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 860, margin: '0 auto', minWidth: 0 }}>
      <style>{SPORTS_CSS}</style>
      <StepHeader
        title="Sports & Events"
        subtitle="Paste a multi-scene script — a match, a training arc, a race day. We lock one character, expand every scene into a director-grade prompt, and render each scene as its own clip with the same character from first whistle to final frame."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Card className="rc-glass" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* HERO INPUT — the script is the product; everything else is quiet. */}
          <div>
            <FieldLabel hint={`One paragraph or beat per scene — up to ${MAX_SPORTS_SCENES} scenes are rendered.`}>
              Your script
            </FieldLabel>
            <TextArea
              value={sports.script}
              onChange={setSportsScript}
              rows={8}
              placeholder={'Describe your video or paste a full script...\n\nScene 1: She laces up in the empty locker room…\nScene 2: First sprint of the final — she breaks away…\nScene 3: The finish line, arms up, crowd on its feet…'}
              testId="input-sports-script"
            />
          </div>

          {/* CHARACTER LOCK — collapsed by default, one quiet CTA. */}
          <div style={{ border: `1px solid ${lock ? T.accentBorder : T.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setCharacterOpen((open) => !open)}
              className="rc-interactive-row rc-ring"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                minHeight: 46,
                padding: '10px 14px',
                border: 0,
                background: 'transparent',
                color: lock ? T.accentFg : T.sub,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              aria-expanded={characterOpen}
              data-testid="button-toggle-character-lock"
            >
              {characterOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <UserRound size={14} />
              <span style={{ flex: 1 }}>
                {lock ? 'Character locked — view or change the reference' : 'Set character reference →'}
              </span>
              {lock && lock.imageUrl && !characterOpen ? (
                <img
                  src={lock.imageUrl}
                  alt="Locked character"
                  style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover', background: '#000' }}
                />
              ) : null}
            </button>
            {characterOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 14px 14px', borderTop: `1px solid ${T.border}` }}>
                <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: T.muted }}>
                  One character carries through every scene. Generate the reference from your script, write it
                  yourself, or upload a photo — whichever is set when you generate is locked for the whole series.
                </p>
                {lockCard}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <GhostButton
                    onClick={() => void generateCharacterLockFromScript()}
                    disabled={busy || sports.lockBusy || !sports.script.trim()}
                    testId="button-generate-character-lock"
                  >
                    {sports.lockBusy ? <Loader2 size={14} className="rc-spin" /> : <Trophy size={14} />}
                    {sports.lockBusy ? 'Locking the character…' : 'Auto-generate from script'}
                  </GhostButton>
                  <GhostButton onClick={() => !uploading && fileRef.current?.click()} testId="button-sports-upload-character">
                    {uploading ? <Loader2 size={14} className="rc-spin" /> : <ImagePlus size={14} />}
                    {uploading ? 'Uploading…' : sports.characterImageUrl ? 'Swap photo' : 'Upload a character photo'}
                  </GhostButton>
                  {sports.characterImageUrl ? (
                    <GhostButton onClick={() => setSportsCharacterImage('')} testId="button-sports-remove-character">
                      <X size={13} /> Remove photo
                    </GhostButton>
                  ) : null}
                </div>
                <div>
                  <TextArea
                    value={manualDescription}
                    onChange={setManualDescription}
                    rows={3}
                    placeholder="Or describe the character yourself — age, build, hair, jersey number and colors, footwear…"
                    testId="input-manual-character"
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    <GhostButton
                      onClick={() => {
                        setCharacterLockDescription(manualDescription);
                        setManualDescription('');
                      }}
                      disabled={!manualDescription.trim() || busy || sports.lockBusy}
                      style={{ minHeight: 36, padding: '7px 13px', fontSize: 12.5 }}
                      testId="button-lock-manual-description"
                    >
                      <Check size={13} /> Lock this description
                    </GhostButton>
                  </div>
                </div>
                {usingAnchor && chain.seriesAnchor ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, border: `1px solid ${T.accentBorder}`, background: T.accentSoft }} data-testid="note-sports-series-anchor">
                    <img
                      src={chain.seriesAnchor.url}
                      alt="Series anchor frame"
                      style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', background: '#000' }}
                    />
                    <span style={{ fontSize: 12, color: T.sub, lineHeight: 1.45 }}>
                      <strong style={{ color: T.accentFg, fontWeight: 700 }}>Series anchor active</strong> — your last
                      video's character carries in automatically unless you lock a different one here.
                    </span>
                  </div>
                ) : null}
                {sports.characterImageUrl && !lock ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={sports.characterImageUrl}
                      alt="Uploaded character reference"
                      style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: `1px solid ${T.accentBorder}`, background: '#000' }}
                    />
                    <span style={{ fontSize: 12, color: T.sub }}>This photo becomes the lock when the series runs.</span>
                  </div>
                ) : null}
                {sports.lockError ? (
                  <p role="alert" style={{ margin: 0, color: T.danger, fontSize: 12.5 }}>{sports.lockError}</p>
                ) : null}
                {uploadError ? (
                  <p role="alert" style={{ margin: 0, color: T.danger, fontSize: 12.5 }}>{uploadError}</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) => void handleUpload(event.target.files && event.target.files[0])}
          />

          {/* VIDEO ORIENTATION — horizontal (16:9) is the default for every
              sports video; vertical is an explicit opt-in. Always visible so
              basketball scripts never silently render portrait again. */}
          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Video Orientation</SectionLabel>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} role="radiogroup" aria-label="Video orientation">
              <Chip selected={sports.aspect === '16:9'} onClick={() => setSportsAspect('16:9')} testId="chip-sports-wide">
                <MonitorPlay size={13} /> Horizontal (landscape)
              </Chip>
              <Chip selected={sports.aspect === '9:16'} onClick={() => setSportsAspect('9:16')} testId="chip-sports-vertical">
                <Smartphone size={13} /> Vertical (portrait)
              </Chip>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 11.5, lineHeight: 1.5, color: T.muted }}>
              Horizontal 16:9 is the default for sports videos. Pick vertical only if this series is for Reels/TikTok.
            </p>
          </div>

          {sports.error ? <ErrorNotice>{sports.error}</ErrorNotice> : null}

          <PrimaryButton
            onClick={() => void startSportsRun()}
            disabled={busy || !sports.script.trim()}
            full
            testId="button-sports-generate"
            style={{ minHeight: 54 }}
          >
            {busy ? <Loader2 size={16} className="rc-spin" /> : <Trophy size={16} />}
            {generateLabel}
          </PrimaryButton>
          {total > 0 && !busy ? (
            <GhostButton onClick={resetSports} testId="button-sports-reset" style={{ alignSelf: 'center', padding: '7px 14px', fontSize: 12.5 }}>
              Clear results
            </GhostButton>
          ) : null}
        </Card>

        {busy || total > 0 ? <RunSteps phase={sports.phase} /> : null}

        {/* The locked character — always visible above the scene list. */}
        {lock && total > 0 ? lockCard : null}

        {total > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="list-sports-scenes">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <SectionLabel>
                {allDone ? 'Every scene is in' : `Scenes — ${doneCount} of ${total} complete`}
              </SectionLabel>
              {allDone ? (
                <PrimaryButton onClick={downloadAll} testId="button-sports-download-all" style={{ minHeight: 44, padding: '10px 18px', fontSize: 14 }}>
                  <Download size={14} /> Download All Scenes
                </PrimaryButton>
              ) : null}
            </div>
            {sports.scenes.map((scene, i) => (
              <div key={scene.index} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SceneCard scene={scene} total={total} aspect={sports.aspect} />
                {i < total - 1 ? <ChainConnector from={scene} /> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
