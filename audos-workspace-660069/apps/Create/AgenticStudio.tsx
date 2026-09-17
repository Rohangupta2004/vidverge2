/**
 * VidVerge — the agentic video studio (the UI).
 *
 * FOUR VIEWS, one line each:
 *   1. Brief  — the mode selector with AUTO highlighted, one brief field, and
 *               the optional uploads that CHANGE the pipeline (a screenshot
 *               routes to UI Motion, a character photo becomes the master).
 *   2. Plan   — what the director came back with: the mode it picked and why,
 *               the references it drew, and every shot, editable, before a
 *               single credit is spent.
 *   3. Board  — shot by shot, live. NOT a spinner: each shot says which engine
 *               is making it, what it is carrying over, and — when a take
 *               drifts — “Regenerating shot 7” inline, in place, while the other
 *               forty-nine shots stay exactly as they were.
 *   4. Cut    — the finished video, with the board still underneath so a single
 *               weak shot can be repaired without re-rendering the rest.
 *
 * THIS COMPONENT OWNS NO STATE THAT MATTERS. Everything lives in
 * apps/Create/agenticRunner.ts, in module scope, because the shell unmounts
 * the whole app whenever the visitor opens another one — and a five-minute
 * production must survive that. Unmounting this file stops nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clapperboard,
  Film,
  ImagePlus,
  Layers,
  Loader2,
  MonitorSmartphone,
  Pause,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  Square,
  UserRound,
  Wand2,
  X,
} from 'lucide-react';
import VideoResultHero from '../../components/VideoResultHero';
import ModeSelector from './ModeSelector';
import { uploadImage } from './studioApi';
import { decisionSummary } from './agenticRouter';
import { listProductionRows, type ProductionRow } from './agenticMemory';
import {
  adoptSavedProduction,
  continueProduction,
  cancelPause,
  getProduction,
  dropCharacterImages,
  pauseProduction,
  planProduction,
  plannedSeconds,
  productionProgress,
  regenerateFailedShots,
  regenerateShots,
  repairableShots,
  resetProduction,
  setProductionAspect,
  setProductionInputs,
  setProductionModel,
  setProductionTone,
  setRequestedMode,
  setTargetSeconds,
  shotsDone,
  shotsFailed,
  startProduction,
  stopProduction,
  updateShot,
  useProduction,
} from './agenticRunner';
import { getMode, type ShotState } from './agenticTypes';
import { TONES } from './videoTypes';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  FONT,
  GhostButton,
  ModelPicker,
  PrimaryButton,
  ProgressBar,
  SectionLabel,
  T,
  TextArea,
  TextInput,
  TextLink,
} from './ui';

const LENGTH_CHOICES = [16, 30, 60, 120, 300];

function secondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
}

// ---------------------------------------------------------------------------
// One shot on the board
// ---------------------------------------------------------------------------
const STATUS_META: Record<
  ShotState['status'],
  { label: string; color: string; background: string; spin?: boolean }
> = {
  pending: { label: 'queued', color: T.muted, background: 'rgba(148,163,184,0.12)' },
  deciding: { label: 'routing', color: T.accentFg, background: T.accentSoft, spin: true },
  submitting: { label: 'starting', color: T.accentFg, background: T.accentSoft, spin: true },
  rendering: { label: 'rendering', color: T.accentFg, background: T.accentSoft, spin: true },
  analyzing: { label: 'analysing', color: T.accentFg, background: T.accentSoft, spin: true },
  regenerating: { label: 'regenerating', color: '#fbbf24', background: 'rgba(251,191,36,0.14)', spin: true },
  done: { label: 'done', color: T.success, background: 'rgba(74,222,128,0.14)' },
  failed: { label: 'failed', color: T.danger, background: 'rgba(239,68,68,0.14)' },
  skipped: { label: 'skipped', color: T.muted, background: 'rgba(148,163,184,0.12)' },
};

const ENGINE_LABEL: Record<string, string> = {
  veo_i2v: 'Veo · image-to-video',
  veo_t2v: 'Veo · text-to-video',
  heygen: 'HeyGen',
  remotion: 'Remotion',
};

function ShotCard({
  shot,
  total,
  aspect,
  editable,
  onRegenerate,
}: {
  shot: ShotState;
  total: number;
  aspect: string;
  editable: boolean;
  onRegenerate: () => void;
}) {
  const meta = STATUS_META[shot.status] || STATUS_META.pending;
  const drifted = !!shot.continuityVerdict && !shot.continuityVerdict.passed;
  const busy = meta.spin === true;

  return (
    <Card
      className="rc-fade"
      style={{
        padding: 0,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderColor: shot.status === 'failed' ? 'rgba(239,68,68,0.36)' : drifted ? 'rgba(251,191,36,0.34)' : T.border,
      }}
      data-testid={`card-shot-${shot.index}`}
      data-status={shot.status}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: aspect === '9:16' ? '9 / 12' : '16 / 9',
          minHeight: 124,
          overflow: 'hidden',
          background: '#030812',
        }}
      >
        {shot.clipUrl ? (
          <video
            src={shot.clipUrl}
            poster={shot.bestFrameUrl || undefined}
            muted
            playsInline
            preload="metadata"
            controls
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
            aria-label={`Shot ${shot.index} clip`}
            data-testid={`video-shot-${shot.index}`}
          />
        ) : shot.bestFrameUrl ? (
          <img
            src={shot.bestFrameUrl}
            alt={`Shot ${shot.index} frame`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            className={shot.status === 'failed' ? undefined : busy ? 'rc-skeleton' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: shot.status === 'failed' ? T.danger : T.muted,
              background: shot.status === 'failed' ? 'rgba(239,68,68,0.06)' : undefined,
            }}
          >
            {shot.status === 'failed' ? <AlertTriangle size={22} /> : <Film size={21} style={{ opacity: 0.4 }} />}
          </div>
        )}
        <span
          style={{
            position: 'absolute',
            top: 9,
            left: 9,
            padding: '4px 8px',
            borderRadius: 8,
            color: '#fff',
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(5px)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Shot {shot.index}/{total}
        </span>
        {shot.engine ? (
          <span
            style={{
              position: 'absolute',
              top: 9,
              right: 9,
              padding: '4px 8px',
              borderRadius: 8,
              color: '#dbeafe',
              background: 'rgba(37,99,235,0.55)',
              backdropFilter: 'blur(5px)',
              fontSize: 10.5,
              fontWeight: 700,
            }}
            data-testid={`badge-engine-${shot.index}`}
          >
            {ENGINE_LABEL[shot.engine] || shot.engine}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 13, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ color: T.text, fontSize: 12.5, fontWeight: 700 }}>{shot.label}</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 999,
              color: meta.color,
              background: meta.background,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.35,
              textTransform: 'uppercase',
            }}
            data-testid={`badge-shot-status-${shot.index}`}
          >
            {busy ? (
              <Loader2 size={10} className="rc-spin" />
            ) : (
              <span style={{ width: 6, height: 6, borderRadius: 999, background: meta.color }} />
            )}
            {meta.label}
          </span>
        </div>

        {/* THE INLINE REGENERATION LINE. A drifted shot says so HERE, next to
            the shot it belongs to, rather than replacing the whole board with a
            restart — every other shot keeps its clip and its spend. */}
        {shot.status === 'regenerating' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 9px',
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
              color: '#fbbf24',
              background: 'rgba(251,191,36,0.10)',
              border: '1px solid rgba(251,191,36,0.28)',
            }}
            data-testid={`notice-regenerating-${shot.index}`}
          >
            <RotateCcw size={12} className="rc-spin" /> Regenerating shot {shot.index} — nothing else restarts
          </div>
        ) : null}

        <p
          style={{
            margin: 0,
            color: T.sub,
            fontSize: 12,
            lineHeight: 1.55,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={shot.prompt}
        >
          {shot.prompt}
        </p>

        {shot.dialogue ? (
          <p style={{ margin: 0, color: T.muted, fontSize: 11.5, fontStyle: 'italic', lineHeight: 1.5 }}>
            “{shot.dialogue}”
          </p>
        ) : null}

        {shot.message ? (
          <p style={{ margin: 0, color: T.accentFg, fontSize: 11.5, lineHeight: 1.5 }}>{shot.message}</p>
        ) : null}

        {/* WHY this shot looks the way it does — the router's own reason, saved
            with the shot, so a question about it has an actual answer. */}
        {shot.decision ? (
          <p
            style={{ margin: 'auto 0 0', paddingTop: 4, color: T.muted, fontSize: 11, lineHeight: 1.5 }}
            data-testid={`text-decision-${shot.index}`}
          >
            <Route size={10} style={{ verticalAlign: -1, marginRight: 5 }} />
            {decisionSummary(shot.decision)}
          </p>
        ) : null}

        {shot.continuityVerdict ? (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              color: shot.continuityVerdict.passed ? T.success : '#fbbf24',
            }}
            data-testid={`text-continuity-${shot.index}`}
          >
            {shot.continuityVerdict.passed ? <Check size={10} style={{ verticalAlign: -1 }} /> : '⚠ '}{' '}
            Continuity {Math.round(shot.continuityVerdict.score * 100)}% — {shot.continuityVerdict.reason}
          </p>
        ) : null}

        {shot.error ? (
          <div
            style={{
              padding: '8px 9px',
              borderRadius: 8,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.09)',
              fontSize: 11,
              lineHeight: 1.45,
              wordBreak: 'break-word',
            }}
            data-testid={`error-shot-${shot.index}`}
          >
            {shot.error}
          </div>
        ) : null}

        {editable && (shot.status === 'failed' || shot.status === 'done') ? (
          <TextLink
            onClick={onRegenerate}
            testId={`button-regenerate-shot-${shot.index}`}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}
          >
            <RotateCcw size={11} /> Regenerate just this shot
          </TextLink>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 1. Brief
// ---------------------------------------------------------------------------
function SetupView() {
  const production = useProduction();
  const [uploading, setUploading] = useState<'' | 'character' | 'screenshot'>('');
  const [uploadError, setUploadError] = useState('');
  const characterRef = useRef<HTMLInputElement | null>(null);
  const screenshotRef = useRef<HTMLInputElement | null>(null);
  const mode = production.requestedMode;
  const maxSeconds = getMode(mode === 'auto' ? 'long_series' : mode).maxSeconds;
  const canPlan = !!(production.inputs.brief.trim() || production.inputs.url.trim() || production.inputs.screenshotUrl);

  const upload = async (kind: 'character' | 'screenshot', file: File | null) => {
    if (!file) return;
    setUploadError('');
    setUploading(kind);
    try {
      const url = await uploadImage(file, kind === 'character' ? 'characters' : 'mockups');
      if (kind === 'character') {
        setProductionInputs({ characterPhotoUrl: url, source: 'character_photo' });
      } else {
        // A screenshot IS the routing signal: AUTO reads it and resolves to UI
        // Motion by itself, so nothing here has to nudge the selector.
        setProductionInputs({ screenshotUrl: url, source: 'screenshot' });
      }
    } catch (e: any) {
      setUploadError((e && e.message) || 'That image could not be uploaded — try another one.');
    }
    setUploading('');
  };

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 860, margin: '0 auto' }}>
      <h1
        className="rc-grad-text"
        style={{ margin: 0, fontSize: 'clamp(22px, 4.4vw, 30px)', fontWeight: 750, letterSpacing: -0.8 }}
      >
        Agentic video
      </h1>
      <p style={{ margin: '10px 0 26px', fontSize: 14.5, lineHeight: 1.65, color: T.sub, maxWidth: 620 }}>
        Tell it what you are making. A director plans the piece, then every single shot is routed to the engine that
        can actually deliver it — and the same character, product and world carry from the first shot to the last.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <ModeSelector value={mode} onChange={setRequestedMode} />

        <Card className="rc-glass" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel hint="A product page is read for you: its copy, its images and its product screens.">
              Product or page URL (optional)
            </FieldLabel>
            <TextInput
              value={production.inputs.url}
              onChange={(v) => setProductionInputs({ url: v, source: v.trim() ? 'url' : production.inputs.source })}
              placeholder="https://…"
              type="url"
              testId="input-agentic-url"
            />
          </div>
          <div>
            <FieldLabel hint="What it is about, who it is for, anything that has to be in it.">The brief</FieldLabel>
            <TextArea
              value={production.inputs.brief}
              onChange={(v) => setProductionInputs({ brief: v })}
              rows={4}
              placeholder="e.g. a 30 second ad for our study app — the problem is revising the wrong topics, the fix is our weak-topic report"
              testId="input-agentic-brief"
              expand={{ field: 'Video brief', words: 90 }}
            />
          </div>
        </Card>

        {/* THE UPLOADS THAT CHANGE THE PIPELINE, said out loud. */}
        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Optional — these change how it is made</SectionLabel>
          <input
            ref={characterRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void upload('character', e.target.files && e.target.files[0])}
          />
          <input
            ref={screenshotRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void upload('screenshot', e.target.files && e.target.files[0])}
          />
          <div className="rc-responsive-grid">
            <UploadTile
              icon={<UserRound size={15} />}
              title="Character photo"
              note="Becomes the character master and chains through every scene."
              url={production.inputs.characterPhotoUrl}
              busy={uploading === 'character'}
              onPick={() => characterRef.current && characterRef.current.click()}
              onClear={() => setProductionInputs({ characterPhotoUrl: '' })}
              testId="upload-character-photo"
            />
            <UploadTile
              icon={<MonitorSmartphone size={15} />}
              title="Product screenshot"
              note="Switches this to UI Motion — your real screen, animated."
              url={production.inputs.screenshotUrl}
              busy={uploading === 'screenshot'}
              onPick={() => screenshotRef.current && screenshotRef.current.click()}
              onClear={() => setProductionInputs({ screenshotUrl: '' })}
              testId="upload-screenshot"
            />
          </div>
          {uploadError ? (
            <div style={{ marginTop: 12 }}>
              <ErrorNotice>{uploadError}</ErrorNotice>
            </div>
          ) : null}
        </div>

        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Format</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <Chip
              selected={production.aspect === '9:16'}
              onClick={() => setProductionAspect('9:16')}
              testId="chip-agentic-vertical"
            >
              Vertical
            </Chip>
            <Chip
              selected={production.aspect === '16:9'}
              onClick={() => setProductionAspect('16:9')}
              testId="chip-agentic-wide"
            >
              Wide
            </Chip>
            <span style={{ width: 1, alignSelf: 'stretch', background: T.border, margin: '0 4px' }} />
            {LENGTH_CHOICES.filter((s) => s <= maxSeconds).map((seconds) => (
              <Chip
                key={seconds}
                selected={production.targetSeconds === seconds}
                onClick={() => setTargetSeconds(seconds)}
                testId={`chip-agentic-length-${seconds}`}
              >
                {secondsLabel(seconds)}
              </Chip>
            ))}
          </div>
          {production.requestedMode === 'ui_motion' ? (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
              UI Motion renders wide: the deterministic renderer outputs landscape only, so the aspect is fixed here.
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {TONES.map((tone) => (
              <Chip
                key={tone.id}
                selected={production.toneId === tone.id}
                onClick={() => setProductionTone(tone.id)}
                testId={`chip-agentic-tone-${tone.id}`}
              >
                {tone.label}
              </Chip>
            ))}
          </div>
        </div>

        <ModelPicker value={production.model} onChange={setProductionModel} />

        {production.error ? <ErrorNotice>{production.error}</ErrorNotice> : null}

        <PrimaryButton
          onClick={() => void planProduction()}
          disabled={!canPlan}
          full
          testId="button-plan-production"
          style={{ minHeight: 56, fontSize: 16, borderRadius: 14 }}
        >
          <Wand2 size={17} /> Plan it — nothing renders yet
        </PrimaryButton>
        <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.6 }}>
          You see the whole shot list, and every routing decision, before a single credit is spent.
        </p>
      </div>
    </div>
  );
}

function UploadTile({
  icon,
  title,
  note,
  url,
  busy,
  onPick,
  onClear,
  testId,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  url: string;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
  testId: string;
}) {
  return (
    <Card
      className="rc-lift-hover"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13 }}
      data-testid={testId}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 42,
          height: 42,
          borderRadius: 11,
          flexShrink: 0,
          overflow: 'hidden',
          color: url ? T.accentFg : T.muted,
          border: `1px solid ${url ? T.accentBorder : T.border}`,
          background: url ? T.accentSoft : 'rgba(255,255,255,0.03)',
        }}
      >
        {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>{title}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, lineHeight: 1.5, color: T.muted }}>{note}</span>
      </span>
      {url ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${title.toLowerCase()}`}
          className="rc-iconbtn"
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            border: `1px solid ${T.border}`,
            background: 'transparent',
            color: T.muted,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={13} />
        </button>
      ) : (
        <GhostButton onClick={onPick} disabled={busy} style={{ flexShrink: 0, minHeight: 40 }}>
          {busy ? <Loader2 size={13} className="rc-spin" /> : <ImagePlus size={13} />}
          {busy ? 'Reading…' : 'Add'}
        </GhostButton>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. Planning / plan
// ---------------------------------------------------------------------------
function PlanningView() {
  const production = useProduction();
  const line =
    production.assembly ||
    (production.phase === 'routing'
      ? 'Reading what you gave us and choosing the mode…'
      : 'The director is planning your shots…');
  return (
    <div
      className="rc-glass rc-fade"
      style={{
        width: '100%',
        maxWidth: 620,
        margin: 'clamp(24px, 8vh, 72px) auto 0',
        padding: 'clamp(24px, 5vw, 40px)',
        borderRadius: 16,
        textAlign: 'center',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 52,
          height: 52,
          borderRadius: 16,
          color: T.accentFg,
          border: `1px solid ${T.accentBorder}`,
          background: T.accentSoft,
        }}
      >
        <Loader2 size={23} className="rc-spin" />
      </span>
      <h1 style={{ margin: '16px 0 8px', color: T.text, fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 700 }}>
        Planning your video
      </h1>
      <p style={{ margin: '0 auto', maxWidth: 440, color: T.sub, fontSize: 14, lineHeight: 1.6 }}>{line}</p>
      <p style={{ margin: '18px auto 0', maxWidth: 440, color: T.muted, fontSize: 12, lineHeight: 1.6 }}>
        Still free — the director, the shot planner and the reference images all run before anything renders.
      </p>
    </div>
  );
}

function PlanView() {
  const production = useProduction();
  const plan = production.plan;
  if (!plan) return <PlanningView />;
  const modeDef = getMode(production.mode);
  const total = plannedSeconds(production);
  const references = [
    ...production.memory.characterMasters.map((m) => ({
      kind: 'Character',
      label: m.name,
      url: m.fullBodyReference || m.faceReference,
    })),
    ...production.memory.environments.map((e) => ({ kind: 'World', label: e.label, url: e.referenceUrl })),
    ...production.memory.objects.map((o) => ({ kind: 'Prop', label: o.label, url: o.referenceUrl })),
    ...production.memory.uiStates.map((s) => ({ kind: 'Screen', label: s.label, url: s.imageUrl })),
  ].filter((r) => !!r.url);

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <TextLink
          onClick={() => resetProduction()}
          testId="button-agentic-restart-brief"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={13} /> Start over
        </TextLink>
      </div>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '5px 12px',
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 700,
          color: T.accentFg,
          border: `1px solid ${T.accentBorder}`,
          background: T.accentSoft,
        }}
        data-testid="badge-resolved-mode"
      >
        <Sparkles size={12} /> {modeDef.label} · {modeDef.engine}
      </span>
      <h1
        style={{
          margin: '12px 0 8px',
          color: T.text,
          fontSize: 'clamp(21px, 4vw, 28px)',
          fontWeight: 750,
          letterSpacing: -0.7,
        }}
      >
        {production.title || plan.title}
      </h1>
      {production.modeReason ? (
        <p style={{ margin: '0 0 6px', color: T.sub, fontSize: 13.5, lineHeight: 1.6, maxWidth: 640 }}>
          {production.modeReason}
        </p>
      ) : null}
      <p style={{ margin: 0, color: T.muted, fontSize: 12.5, lineHeight: 1.6 }}>
        {production.shots.length} shots · about {secondsLabel(total)} · {production.aspect} ·{' '}
        {plan.chapters.length > 1 ? `${plan.chapters.length} chapters` : 'one continuous world'}
      </p>

      {production.notice ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            margin: '18px 0 0',
            padding: '11px 13px',
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: T.sub,
            border: `1px solid ${T.accentBorder}`,
            background: T.accentSoft,
          }}
          data-testid="notice-plan"
        >
          <Sparkles size={14} color={T.accentFg} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{production.notice}</span>
        </div>
      ) : null}

      {references.length > 0 ? (
        <div style={{ marginTop: 26 }}>
          <SectionLabel style={{ marginBottom: 10 }}>
            Locked references — every shot points at these, not at the shot before it
          </SectionLabel>
          <div className="rc-mobile-scroll" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {references.map((ref) => (
              <div key={`${ref.kind}-${ref.label}-${ref.url}`} style={{ width: 132 }}>
                <img
                  src={ref.url}
                  alt={ref.label}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    objectFit: 'cover',
                    borderRadius: 12,
                    border: `1px solid ${T.border}`,
                    background: '#000',
                    display: 'block',
                  }}
                />
                <span style={{ display: 'block', marginTop: 6, fontSize: 11, fontWeight: 700, color: T.accentFg }}>
                  {ref.kind}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: T.sub }}>{ref.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>The shot list — edit anything before you run it</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {production.shots.map((shot) => (
            <Card key={shot.index} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  }}
                >
                  {shot.index}
                </span>
                <input
                  value={shot.label}
                  onChange={(e) => updateShot(shot.index, { label: e.target.value })}
                  aria-label={`Shot ${shot.index} beat name`}
                  className="rc-input rc-ring"
                  style={{
                    width: 132,
                    minHeight: 36,
                    padding: '6px 10px',
                    borderRadius: 9,
                    border: `1px solid ${T.border}`,
                    background: 'rgba(255,255,255,0.035)',
                    color: T.text,
                    fontSize: 12.5,
                    fontWeight: 700,
                    fontFamily: FONT,
                    outline: 'none',
                  }}
                  data-testid={`input-shot-label-${shot.index}`}
                />
                <span style={{ fontSize: 11.5, color: T.muted }}>
                  {shot.seconds}s · chapter {shot.chapterIndex}
                </span>
              </div>
              <TextArea
                value={shot.prompt}
                onChange={(v) => updateShot(shot.index, { prompt: v })}
                rows={2}
                placeholder="What is on screen"
                testId={`input-shot-prompt-${shot.index}`}
              />
              <TextInput
                value={shot.dialogue}
                onChange={(v) => updateShot(shot.index, { dialogue: v })}
                placeholder="What is said over it (optional)"
                testId={`input-shot-dialogue-${shot.index}`}
              />
            </Card>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 26 }}>
        <PrimaryButton
          onClick={() => void startProduction()}
          full
          testId="button-run-production"
          style={{ minHeight: 56, fontSize: 16, borderRadius: 14 }}
        >
          <Play size={17} /> Generate {production.shots.length} shots · about {secondsLabel(total)}
        </PrimaryButton>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
          <TextLink onClick={() => void planProduction()} testId="button-replan">
            Re-plan with a different take
          </TextLink>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.6 }}>
          Shots render one at a time so each can continue the last. You can leave this screen — the run keeps going,
          and every finished shot is saved as it lands.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 + 4. The board, live and after the cut
// ---------------------------------------------------------------------------
function BoardView() {
  const production = useProduction();
  const [, tick] = useState(0);
  const done = shotsDone(production);
  const failed = shotsFailed(production);
  const total = production.shots.length;
  const running = production.phase === 'running' || production.phase === 'assembling';
  const repairable = repairableShots(production);
  const hasCharacterImage = production.memory.characterMasters.some(
    (m) => !!(m.faceReference || m.fullBodyReference),
  );

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsed = production.startedAt ? Math.max(0, Math.floor((Date.now() - production.startedAt) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const inFlight = production.shots.find((shot) => shot.index === production.cursor);

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
      {production.finalVideoUrl ? (
        <div className="rc-result-enter" style={{ marginBottom: 32 }}>
          <VideoResultHero
            src={production.finalVideoUrl}
            aspect={production.aspect}
            title={production.title || 'Your video'}
            badge={`${getMode(production.mode).label} · ${total} shots`}
            note={production.assembly}
            stickyActions
            surface={T.bg}
            playerTestId="video-agentic-final"
            downloadTestId="link-download-agentic"
            actions={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <GhostButton onClick={resetProduction} testId="button-agentic-new" style={{ flex: '1 1 150px' }}>
                  <Clapperboard size={14} /> Make another
                </GhostButton>
                {repairable.length > 0 ? (
                  <GhostButton
                    onClick={regenerateFailedShots}
                    testId="button-repair-shots"
                    style={{ flex: '1 1 190px' }}
                  >
                    <RotateCcw size={14} /> Repair {repairable.length} shot{repairable.length === 1 ? '' : 's'}
                  </GhostButton>
                ) : null}
              </div>
            }
          />
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              color: production.finalVideoUrl ? T.success : failed > 0 ? T.danger : T.accentFg,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: 0.55,
              textTransform: 'uppercase',
            }}
          >
            {production.finalVideoUrl ? <Check size={13} /> : <Layers size={13} />}
            {production.finalVideoUrl
              ? 'Final cut complete'
              : production.phase === 'assembling'
                ? 'Cutting it together'
                : production.phase === 'paused'
                  ? 'Paused'
                  : 'Production floor'}
          </span>
          <h1
            style={{
              margin: '7px 0 6px',
              color: T.text,
              fontSize: 'clamp(21px, 4vw, 28px)',
              fontWeight: 750,
              letterSpacing: -0.65,
            }}
          >
            {production.title || 'Your production'}
          </h1>
          <p style={{ margin: 0, color: T.muted, fontSize: 13, lineHeight: 1.55 }}>
            {getMode(production.mode).label} · {done} of {total} shots
            {running ? ` · ${elapsedLabel} elapsed` : ''}
            {inFlight && running ? ` · on shot ${inFlight.index}` : ''}
          </p>
        </div>

        <div className="rc-mobile-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {production.phase === 'running' && !production.pauseRequested ? (
            <GhostButton onClick={pauseProduction} testId="button-pause-production">
              <Pause size={13} /> Pause after this shot
            </GhostButton>
          ) : null}
          {production.pauseRequested ? (
            <GhostButton onClick={cancelPause} testId="button-cancel-pause">
              Keep going
            </GhostButton>
          ) : null}
          {production.phase === 'running' ? (
            <GhostButton onClick={stopProduction} testId="button-stop-production">
              <Square size={12} /> Stop
            </GhostButton>
          ) : null}
          {(production.phase === 'paused' || production.resumable) && done < total ? (
            <PrimaryButton
              onClick={() => void continueProduction()}
              testId="button-continue-production"
              style={{ minHeight: 44, fontSize: 14 }}
            >
              <Play size={14} /> {production.resumable ? 'Continue this run' : 'Carry on'}
            </PrimaryButton>
          ) : null}
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <ProgressBar
          value={production.finalVideoUrl ? 1 : productionProgress(production)}
          stopped={production.phase === 'paused'}
          testId="progress-agentic"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7 }}>
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            {done} rendered · {Math.max(0, total - done - failed)} to go
          </span>
          <span style={{ color: failed ? T.danger : T.muted, fontSize: 11.5 }}>
            {failed ? `${failed} failed` : `${Math.round(productionProgress(production) * 100)}%`}
          </span>
        </div>
      </div>

      {production.pauseRequested ? (
        <div style={{ marginBottom: 18 }}>
          <Card style={{ padding: '11px 14px', borderColor: T.accentBorder, background: T.accentSoft }}>
            <span style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>
              Pausing after this shot — a half-rendered shot is real spend, so it is finished rather than thrown away.
            </span>
          </Card>
        </div>
      ) : null}

      {production.notice ? (
        <div style={{ marginBottom: 18 }}>
          <Card style={{ padding: '11px 14px', borderColor: T.accentBorder, background: T.accentSoft }}>
            <span style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>{production.notice}</span>
          </Card>
        </div>
      ) : null}

      {production.saveNotice ? (
        <div style={{ marginBottom: 18 }}>
          <Card style={{ padding: '11px 14px' }}>
            <span style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>{production.saveNotice}</span>
          </Card>
        </div>
      ) : null}

      {production.error ? (
        <div style={{ marginBottom: 18 }}>
          <ErrorNotice>
            <span style={{ flex: 1 }}>{production.error}</span>
          </ErrorNotice>
        </div>
      ) : null}

      {/* PARTIAL REGENERATION, offered plainly: repair the few, keep the many. */}
      {repairable.length > 0 && production.phase !== 'running' ? (
        <Card
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
            borderColor: 'rgba(251,191,36,0.32)',
            background: 'rgba(251,191,36,0.055)',
          }}
          data-testid="card-repair"
        >
          <div style={{ flex: '1 1 300px' }}>
            <strong style={{ display: 'block', color: T.text, fontSize: 14, marginBottom: 5 }}>
              {repairable.length} shot{repairable.length === 1 ? '' : 's'} need{repairable.length === 1 ? 's' : ''}{' '}
              another go
            </strong>
            <span style={{ color: T.sub, fontSize: 12.5, lineHeight: 1.55 }}>
              Shot{repairable.length === 1 ? '' : 's'} {repairable.map((s) => s.index).join(', ')}. Only these are
              re-rendered — the other {Math.max(0, total - repairable.length)} keep the clips you have already paid
              for, and continuity is re-checked around the repair afterwards.
            </span>
          </div>
          <div className="rc-mobile-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PrimaryButton onClick={regenerateFailedShots} testId="button-repair-all" style={{ minHeight: 44, fontSize: 14 }}>
              <RotateCcw size={14} /> Regenerate {repairable.length === 1 ? 'it' : 'them'}
            </PrimaryButton>
            {hasCharacterImage ? (
              <GhostButton onClick={dropCharacterImages} testId="button-drop-character-image">
                Carry on without the photo
              </GhostButton>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 216px), 1fr))',
          gap: 14,
          alignItems: 'stretch',
        }}
        data-testid="grid-shot-board"
      >
        {production.shots.map((shot) => (
          <ShotCard
            key={shot.index}
            shot={shot}
            total={total}
            aspect={production.aspect}
            editable={production.phase !== 'running'}
            onRegenerate={() => regenerateShots([shot.index])}
          />
        ))}
      </div>

      {production.phase === 'done' || production.phase === 'paused' ? (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap', marginTop: 26 }}>
          <TextLink onClick={resetProduction} testId="button-agentic-start-over">
            Start a new production
          </TextLink>
          <TextLink
            onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'videos' } }))}
            testId="link-agentic-library"
          >
            My videos
          </TextLink>
        </div>
      ) : (
        <p style={{ margin: '20px 0 0', color: T.muted, fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
          You can leave this screen while it runs. Every finished shot is saved as it lands, so nothing already
          rendered is ever rendered twice.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat → studio handoff
// ---------------------------------------------------------------------------
function ChatHandoffOffer() {
  const [row, setRow] = useState<ProductionRow | null>(null);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Never replace work already open in the module-level runner.
      const current = getProduction();
      if (current.phase !== 'setup' || current.rowId) return;
      const rows = await listProductionRows();
      if (cancelled) return;
      const now = Date.now();
      const candidate = rows.find((item) => {
        const createdAt = item.created_at ? Date.parse(item.created_at) : NaN;
        const recent = Number.isFinite(createdAt) && now - createdAt >= -5 * 60 * 1000 && now - createdAt <= 24 * 60 * 60 * 1000;
        const shots = Array.isArray(item.shots_json) ? item.shots_json : [];
        return item.status === 'planning' && Number(item.shots_total || 0) === 0 && shots.length === 0 && recent;
      });
      if (candidate) setRow(candidate);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!row) return null;

  const plan = async () => {
    setPlanning(true);
    adoptSavedProduction(row);
    setRow(null);
    await planProduction();
    setPlanning(false);
  };

  return (
    <Card
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 22,
        borderColor: T.accentBorder,
        background: T.accentSoft,
      }}
      data-testid="card-chat-production-handoff"
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.accentFg, fontSize: 11.5, fontWeight: 750 }}>
          <Sparkles size={13} /> Verger has your brief ready
        </span>
        <p style={{ margin: '7px 0 0', color: T.sub, fontSize: 13, lineHeight: 1.55 }}>
          {row.brief || row.title || 'Your agentic production'}
        </p>
        <p style={{ margin: '5px 0 0', color: T.muted, fontSize: 11.5, lineHeight: 1.5 }}>
          Planning is still free. You will review and confirm every shot before anything renders.
        </p>
      </div>
      <div className="rc-mobile-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={() => void plan()} disabled={planning} testId="button-plan-chat-production">
          {planning ? <Loader2 size={14} className="rc-spin" /> : <Wand2 size={14} />}
          {planning ? 'Planning…' : 'Plan this brief'}
        </PrimaryButton>
        <GhostButton onClick={() => setRow(null)} disabled={planning} testId="button-dismiss-chat-production">
          Not now
        </GhostButton>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The router over the four views
// ---------------------------------------------------------------------------
export default function AgenticStudio({ onExit }: { onExit?: () => void }) {
  const production = useProduction();

  return (
    <div style={{ width: '100%' }}>
      <ChatHandoffOffer />
      {onExit && production.phase !== 'running' ? (
        <div style={{ marginBottom: 18 }}>
          <TextLink
            onClick={onExit}
            testId="link-agentic-exit"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowLeft size={13} /> Back to the studio
          </TextLink>
        </div>
      ) : null}

      {production.phase === 'setup' ? (
        <SetupView />
      ) : production.phase === 'routing' || production.phase === 'planning' ? (
        <PlanningView />
      ) : production.phase === 'plan' ? (
        <PlanView />
      ) : (
        <BoardView />
      )}
    </div>
  );
}
