/**
 * VidVerge Create — LONG SERIES mode: the screens.
 *
 * Four of them, one line each:
 *   1. Brief   — what the series is, how many episodes, and the MODEL. The
 *                model picker is here and it is never chosen for the visitor:
 *                whatever they pick renders every clip of every episode.
 *   2. Cast    — the character, locked for the whole run (shared CharacterStep).
 *   3. Plan    — the episode outlines, editable, with the world/look/arc the
 *                series carries forward. Nothing renders until this is confirmed.
 *   4. Build   — the live view: every episode with its status, its clip-by-clip
 *                progress (clip 2/4), the finished episode player, and Pause /
 *                Continue / Stop / Steer while it runs.
 *
 * WHERE THE STATE LIVES: not here. apps/Create/seriesRunner.ts owns the run and
 * its loop in module scope, so switching app, opening the chat or reloading the
 * page cannot stop a forty-render series. This file only ever reads that store
 * and calls into it — which is why every screen below is derived from
 * `run.phase` rather than from local step state.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clapperboard,
  Compass,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Users,
} from 'lucide-react';
import CharacterStep from './CharacterStep';
import { DownloadVideoButton } from '../../components/VideoResultHero';
import {
  CLIPS_PER_EPISODE,
  continuityLabel,
  EPISODE_COUNT_CHOICES,
  episodeSeconds,
  listSeriesRows,
  MAX_EPISODES,
  type EpisodeSeriesRow,
} from './episodeApi';
import {
  backToBrief,
  backToPlan,
  cancelPause,
  clearSteer,
  clipsDone,
  continueSeries,
  dropCharacterPhoto,
  episodesDone,
  pauseSeries,
  planSeriesRun,
  plannedRunSeconds,
  replanEpisode,
  resetSeries,
  retryEpisode,
  runProgress,
  setSeriesCharacter,
  setSeriesInputs,
  startSeries,
  steerNext,
  stopSeries,
  updateEpisodeOutline,
  useSeriesRun,
  type ClipState,
  type EpisodeState,
  type SeriesRunState,
} from './seriesRunner';
import { modelHasSound, shortModelLabel, TONES, type AspectRatio } from './videoTypes';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  GhostButton,
  ModelPicker,
  PrimaryButton,
  ProgressBar,
  SectionLabel,
  StepHeader,
  T,
  TextArea,
  TextInput,
  TextLink,
} from './ui';

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function runtimeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} min`;
}

// ---------------------------------------------------------------------------
// Small pieces of the live view
// ---------------------------------------------------------------------------
function Pill({
  tone,
  children,
  spin,
  testId,
}: {
  tone: 'idle' | 'busy' | 'good' | 'bad';
  children: ReactNode;
  spin?: boolean;
  testId?: string;
}) {
  const color =
    tone === 'good' ? T.success : tone === 'bad' ? T.danger : tone === 'busy' ? T.accentFg : T.muted;
  const border =
    tone === 'good'
      ? 'rgba(74,222,128,0.32)'
      : tone === 'bad'
        ? 'rgba(239,68,68,0.3)'
        : tone === 'busy'
          ? T.accentBorder
          : T.border;
  const background =
    tone === 'good'
      ? 'rgba(74,222,128,0.08)'
      : tone === 'bad'
        ? 'rgba(239,68,68,0.07)'
        : tone === 'busy'
          ? T.accentSoft
          : 'transparent';
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color,
        border: `1px solid ${border}`,
        background,
      }}
    >
      {spin ? <Loader2 size={10} className="rc-spin" /> : null}
      {children}
    </span>
  );
}

function EpisodePill({ ep }: { ep: EpisodeState }) {
  switch (ep.status) {
    case 'done':
      return (
        <Pill tone="good" testId={`pill-episode-${ep.index}`}>
          <Check size={10} /> Done
        </Pill>
      );
    case 'failed':
      return (
        <Pill tone="bad" testId={`pill-episode-${ep.index}`}>
          Stopped
        </Pill>
      );
    case 'planning':
      return (
        <Pill tone="busy" spin testId={`pill-episode-${ep.index}`}>
          Writing it
        </Pill>
      );
    case 'rendering':
      return (
        <Pill tone="busy" spin testId={`pill-episode-${ep.index}`}>
          Clip {Math.min(CLIPS_PER_EPISODE, clipsDone(ep) + 1)}/{CLIPS_PER_EPISODE}
        </Pill>
      );
    case 'stitching':
      return (
        <Pill tone="busy" spin testId={`pill-episode-${ep.index}`}>
          Joining the cut
        </Pill>
      );
    default:
      return (
        <Pill tone="idle" testId={`pill-episode-${ep.index}`}>
          Queued
        </Pill>
      );
  }
}

/** Four dots: the whole point of a 4-clip assembly, at a glance. */
function ClipDots({ ep }: { ep: EpisodeState }) {
  const slots = Array.from({ length: CLIPS_PER_EPISODE }, (_, i) => i + 1);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      aria-label={`${clipsDone(ep)} of ${CLIPS_PER_EPISODE} clips rendered`}
      data-testid={`dots-episode-${ep.index}`}
    >
      {slots.map((slot) => {
        const clip = ep.clips.find((c) => c.index === slot);
        const status = clip ? clip.status : 'pending';
        const busy = status === 'rendering' || status === 'submitting';
        return (
          <span
            key={slot}
            className={busy ? 'rc-pulse' : undefined}
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background:
                status === 'done'
                  ? T.success
                  : status === 'failed'
                    ? T.danger
                    : busy
                      ? T.accentFg
                      : 'rgba(255,255,255,0.16)',
            }}
          />
        );
      })}
    </span>
  );
}

function ClipRow({ clip }: { clip: ClipState }) {
  const busy = clip.status === 'rendering' || clip.status === 'submitting';
  return (
    <div
      data-testid={`clip-row-${clip.index}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '9px 0',
        borderTop: `1px solid ${T.border}`,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          marginTop: 1,
          width: 42,
          fontSize: 11,
          fontWeight: 700,
          color: T.muted,
        }}
      >
        {clip.index}/{CLIPS_PER_EPISODE}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{clip.label}</span>
          {clip.status === 'done' ? (
            <Pill tone="good">
              <Check size={10} /> Rendered
            </Pill>
          ) : clip.status === 'failed' ? (
            <Pill tone="bad">Failed</Pill>
          ) : busy ? (
            <Pill tone="busy" spin>
              {clip.status === 'submitting' ? 'Starting' : 'Rendering'}
            </Pill>
          ) : null}
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontSize: 12,
            lineHeight: 1.5,
            color: clip.error ? T.danger : T.muted,
          }}
        >
          {clip.error || clip.message || clip.prompt}
        </span>
        {clip.dialogue ? (
          <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: T.sub }}>
            “{clip.dialogue}”
          </span>
        ) : null}
      </span>
      {clip.url ? (
        <a
          href={clip.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: T.accentFg }}
          data-testid={`link-clip-${clip.index}`}
        >
          Watch clip
        </a>
      ) : null}
    </div>
  );
}

function EpisodeCard({
  ep,
  current,
  seriesTitle,
  clipSeconds,
  canEdit,
  showPhotoEscape,
}: {
  ep: EpisodeState;
  current: boolean;
  seriesTitle: string;
  clipSeconds: number;
  canEdit: boolean;
  showPhotoEscape: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || current || ep.status === 'failed';
  const done = clipsDone(ep);

  return (
    <Card
      className="rc-reveal"
      style={{
        ['--rc-i' as any]: Math.min(6, ep.index),
        padding: 15,
        borderColor: current ? T.accentBorder : T.border,
        background: current ? T.accentSoft : T.panel,
      }}
      data-testid={`card-episode-${ep.index}`}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            color: ep.status === 'done' ? '#fff' : T.sub,
            background:
              ep.status === 'done'
                ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                : 'rgba(255,255,255,0.06)',
          }}
        >
          {ep.index}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: T.text }}>{ep.title}</span>
            <EpisodePill ep={ep} />
            <ClipDots ep={ep} />
            <span style={{ fontSize: 11.5, color: T.muted }}>
              {done}/{CLIPS_PER_EPISODE} clips · {clipSeconds * CLIPS_PER_EPISODE}s
            </span>
          </div>
          {ep.logline ? (
            <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.55, color: T.sub }}>
              {ep.logline}
            </p>
          ) : null}
          {ep.steer ? (
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: T.accentFg,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 5,
              }}
            >
              <Compass size={12} style={{ flexShrink: 0, marginTop: 2 }} /> You steered this one:{' '}
              {ep.steer}
            </p>
          ) : null}
        </div>
        {ep.clips.length > 0 && !current && ep.status !== 'failed' ? (
          <TextLink onClick={() => setOpen((v) => !v)} testId={`link-toggle-episode-${ep.index}`}>
            {open ? 'Hide' : 'Clips'}
          </TextLink>
        ) : null}
      </div>

      {expanded && ep.clips.length > 0 ? (
        <div style={{ marginTop: 11 }}>
          {ep.clips
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((clip) => (
              <ClipRow key={clip.index} clip={clip} />
            ))}
        </div>
      ) : null}

      {ep.status === 'failed' && ep.error ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <ErrorNotice>{ep.error}</ErrorNotice>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <GhostButton
              onClick={() => {
                retryEpisode(ep.index);
                continueSeries();
              }}
              testId={`button-retry-episode-${ep.index}`}
            >
              <RotateCcw size={13} /> Retry this episode
            </GhostButton>
            {canEdit ? (
              <GhostButton
                onClick={() => {
                  replanEpisode(ep.index);
                  continueSeries();
                }}
                testId={`button-rewrite-episode-${ep.index}`}
              >
                <Sparkles size={13} /> Rewrite it and try again
              </GhostButton>
            ) : null}
            {showPhotoEscape ? (
              <GhostButton
                onClick={() => {
                  dropCharacterPhoto();
                  continueSeries();
                }}
                testId="button-drop-character-photo"
              >
                Carry on without the photo
              </GhostButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {ep.status === 'done' && ep.videoUrl ? (
        <div className="rc-fade" style={{ marginTop: 13 }}>
          <div
            style={{
              width: '100%',
              borderRadius: 12,
              overflow: 'hidden',
              border: `1px solid ${T.borderStrong}`,
              background: '#000',
            }}
          >
            <video
              src={ep.videoUrl}
              controls
              muted
              playsInline
              preload="metadata"
              style={{
                display: 'block',
                width: '100%',
                maxHeight: 320,
                objectFit: 'contain',
                background: '#000',
              }}
              data-testid={`player-episode-${ep.index}`}
            />
          </div>
          <div style={{ marginTop: 9 }}>
            <DownloadVideoButton
              src={ep.videoUrl}
              title={`${seriesTitle} episode ${ep.index} ${ep.title}`}
              label={`Download episode ${ep.index}`}
              style={{ padding: '12px 18px', fontSize: 14, borderRadius: 11 }}
              testId={`button-download-episode-${ep.index}`}
            />
          </div>
        </div>
      ) : null}

      {ep.status === 'done' && !ep.videoUrl ? (
        <p style={{ margin: '11px 0 0', fontSize: 12, lineHeight: 1.55, color: T.muted }}>
          All {CLIPS_PER_EPISODE} clips rendered, but they couldn’t be joined into one file in this
          browser — grab them individually above and the episode is still complete.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Series this visitor has built before. The live run store only ever holds ONE
 * series, so without this a finished run's episode downloads disappear from
 * this screen the moment the next one is started — they are still in My Videos,
 * but as twenty individual clips rather than the episodes they were joined into.
 */
function PastSeries() {
  const [rows, setRows] = useState<EpisodeSeriesRow[]>([]);

  useEffect(() => {
    let alive = true;
    void listSeriesRows().then((found) => {
      if (alive) setRows(found);
    });
    return () => {
      alive = false;
    };
  }, []);

  const withEpisodes = rows
    .map((row) => ({
      row,
      episodes: (Array.isArray(row.episodes_json) ? row.episodes_json : []).filter(
        (ep: any) => ep && typeof ep.videoUrl === 'string' && /^https?:\/\//.test(ep.videoUrl),
      ),
    }))
    .filter((entry) => entry.episodes.length > 0);
  if (withEpisodes.length === 0) return null;

  return (
    <div style={{ marginTop: 40, paddingTop: 22, borderTop: `1px solid ${T.border}` }}>
      <SectionLabel style={{ marginBottom: 10 }}>Series you’ve built</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {withEpisodes.map((entry) => (
          <Card key={entry.row.id} style={{ padding: 13 }} data-testid={`past-series-${entry.row.id}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                {entry.row.title || 'Untitled series'}
              </span>
              <span style={{ fontSize: 11.5, color: T.muted }}>
                {entry.episodes.length} episode{entry.episodes.length === 1 ? '' : 's'}
                {entry.row.model ? ` · ${shortModelLabel(entry.row.model)}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {entry.episodes.map((ep: any) => (
                <a
                  key={ep.index}
                  href={ep.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11.5, fontWeight: 600, color: T.accentFg }}
                  data-testid={`past-episode-${entry.row.id}-${ep.index}`}
                >
                  EP {ep.index}
                </a>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — the brief
// ---------------------------------------------------------------------------
function BriefScreen({
  run,
  onCast,
  onExit,
}: {
  run: SeriesRunState;
  onCast: () => void;
  onExit?: () => void;
}) {
  const perEpisode = episodeSeconds(run.model);
  const total = perEpisode * run.episodeCount;
  const ready = run.brief.trim().length > 0;

  return (
    <div className="rc-fade" style={{ maxWidth: 640 }}>
      <StepHeader
        title="Build a series"
        subtitle={`Every episode is a ${CLIPS_PER_EPISODE}-clip assembly — four shots rendered on the model you pick, chained together and joined into one episode. The character and the look carry across the whole run.`}
        onBack={onExit}
        backLabel="Back to the studio"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <FieldLabel hint="One brief for the whole series — who it follows and what happens over the episodes.">
            What is the series?
          </FieldLabel>
          <TextArea
            value={run.brief}
            onChange={(brief) => setSeriesInputs({ brief })}
            rows={4}
            autoFocus
            placeholder="e.g. A rookie barista learning the craft — each episode she takes on one harder drink in the same tiny corner cafe"
            testId="input-series-brief"
            expand={{
              field: 'Video series brief',
              context:
                'A short-form episodic video series with one recurring character. Describe the premise, the world it is set in and what changes over the episodes.',
              words: 90,
            }}
          />
        </div>

        <div>
          <FieldLabel hint="Left blank, the planner names it for you.">Series name (optional)</FieldLabel>
          <TextInput
            value={run.title}
            onChange={(title) => setSeriesInputs({ title })}
            placeholder="e.g. The Corner Cafe"
            testId="input-series-title"
          />
        </div>

        <div>
          <FieldLabel hint="Episodes render one after another, on their own. You can pause, steer or stop between any two.">
            How many episodes?
          </FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {EPISODE_COUNT_CHOICES.map((count) => (
              <Chip
                key={count}
                selected={run.episodeCount === count}
                onClick={() => setSeriesInputs({ episodeCount: count })}
                testId={`chip-episodes-${count}`}
              >
                {count === 1 ? 'Just one' : `${count} episodes`}
              </Chip>
            ))}
            <input
              type="number"
              min={1}
              max={MAX_EPISODES}
              value={run.episodeCount}
              onChange={(e) => setSeriesInputs({ episodeCount: Number(e.target.value) })}
              aria-label="Number of episodes"
              data-testid="input-episode-count"
              style={{
                width: 68,
                padding: '8px 10px',
                borderRadius: 999,
                border: `1px solid ${T.border}`,
                background: 'rgba(255,255,255,0.03)',
                color: T.text,
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <p style={{ margin: '9px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
            {run.episodeCount} × {CLIPS_PER_EPISODE} clips = {run.episodeCount * CLIPS_PER_EPISODE}{' '}
            renders, about {perEpisode}s per episode and {runtimeLabel(total)} of finished video.
          </p>
        </div>

        {/* One model only (Google Omni Flash) — the retired picker below still
            corrects a stale saved id, and the line under it says what renders. */}
        <Card style={{ padding: 15 }}>
          <ModelPicker value={run.model} onChange={(model) => setSeriesInputs({ model })} />
          <p style={{ margin: '11px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
            {shortModelLabel(run.model)} renders every clip of every episode —{' '}
            {modelHasSound(run.model)
              ? 'it speaks on camera, with music and ambience'
              : 'picture only, no soundtrack'}
            . {continuityLabel(run.model)}
          </p>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <FieldLabel>Shape</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['9:16', '16:9'] as AspectRatio[]).map((aspect) => (
                <Chip
                  key={aspect}
                  selected={run.aspect === aspect}
                  onClick={() => setSeriesInputs({ aspect })}
                  testId={`chip-series-aspect-${aspect === '9:16' ? 'vertical' : 'wide'}`}
                >
                  {aspect === '9:16' ? 'Vertical' : 'Wide'}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>Tone</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TONES.map((tone) => (
                <Chip
                  key={tone.id}
                  selected={run.toneId === tone.id}
                  onClick={() => setSeriesInputs({ toneId: tone.id })}
                  testId={`chip-series-tone-${tone.id}`}
                >
                  {tone.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {run.lock ? (
          <Card style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13 }}>
            {run.lock.portraitUrl ? (
              <img
                src={run.lock.portraitUrl}
                alt={run.lock.name}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  objectFit: 'cover',
                  border: `1px solid ${T.border}`,
                }}
              />
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                <Users size={17} color={T.muted} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>
                {run.lock.name}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: T.muted }}>
                Locked for every episode
              </span>
            </span>
            <TextLink onClick={onCast} testId="link-change-series-character">
              Change
            </TextLink>
          </Card>
        ) : null}

        {run.error ? <ErrorNotice>{run.error}</ErrorNotice> : null}

        <PrimaryButton
          onClick={run.lock ? () => void planSeriesRun() : onCast}
          disabled={!ready}
          full
          testId="button-series-next"
        >
          {run.lock ? (
            <>
              <Sparkles size={15} /> Plan the {run.episodeCount} episodes
            </>
          ) : (
            <>
              <Users size={15} /> Cast the character →
            </>
          )}
        </PrimaryButton>
      </div>

      <PastSeries />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — the plan
// ---------------------------------------------------------------------------
function PlanScreen({ run, onBack }: { run: SeriesRunState; onBack: () => void }) {
  const perEpisode = episodeSeconds(run.model);
  return (
    <div className="rc-fade">
      <StepHeader
        title={run.title || 'Your series'}
        subtitle={`${run.episodes.length} episodes, ${CLIPS_PER_EPISODE} clips each — ${run.episodes.length * CLIPS_PER_EPISODE} renders in all. Edit anything here; nothing is generated until you start the run.`}
        onBack={onBack}
        backLabel="Back to the brief"
      />

      {run.planFallback ? (
        <div style={{ marginBottom: 16 }}>
          <Pill tone="idle">The planner couldn’t be reached — these are template beats, edit freely</Pill>
        </div>
      ) : null}

      {run.style.world || run.style.look || run.style.arc ? (
        <Card style={{ marginBottom: 16, padding: 15 }}>
          <SectionLabel style={{ marginBottom: 8 }}>Carried across every episode</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5, lineHeight: 1.55 }}>
            <span style={{ color: T.sub }}>
              <strong style={{ color: T.text }}>Character</strong> —{' '}
              {run.lock ? run.lock.name : 'not set'}. The same description and reference travel with
              every one of the {run.episodes.length * CLIPS_PER_EPISODE} clips.
            </span>
            {run.style.world ? (
              <span style={{ color: T.sub }}>
                <strong style={{ color: T.text }}>World</strong> — {run.style.world}
              </span>
            ) : null}
            {run.style.look ? (
              <span style={{ color: T.sub }}>
                <strong style={{ color: T.text }}>Look</strong> — {run.style.look}
              </span>
            ) : null}
            {run.style.arc ? (
              <span style={{ color: T.sub }}>
                <strong style={{ color: T.text }}>Arc</strong> — {run.style.arc}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {run.episodes.map((ep) => (
          <Card
            key={ep.index}
            className="rc-reveal"
            style={{ ['--rc-i' as any]: Math.min(6, ep.index), padding: 15 }}
            data-testid={`plan-episode-${ep.index}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>EP {ep.index}</span>
              <span style={{ fontSize: 11.5, color: T.muted }}>
                {CLIPS_PER_EPISODE} clips · about {perEpisode}s
              </span>
            </div>
            <TextInput
              value={ep.title}
              onChange={(title) => updateEpisodeOutline(ep.index, { title })}
              placeholder="Episode title"
              testId={`input-episode-title-${ep.index}`}
            />
            <div style={{ height: 9 }} />
            <TextArea
              value={ep.logline}
              onChange={(logline) => updateEpisodeOutline(ep.index, { logline })}
              rows={2}
              placeholder="What happens in this episode"
              testId={`input-episode-logline-${ep.index}`}
              expand={{
                field: 'Episode outline',
                context:
                  'One episode of a short-form video series with a recurring character. Describe what happens in this episode only.',
                words: 55,
              }}
            />
          </Card>
        ))}
      </div>

      {run.error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorNotice>{run.error}</ErrorNotice>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <PrimaryButton onClick={() => void startSeries()} full testId="button-start-series">
          <Play size={15} /> Start the series — {run.episodes.length * CLIPS_PER_EPISODE} clips
        </PrimaryButton>
        <p style={{ margin: '10px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.6, textAlign: 'center' }}>
          Episode 1 starts immediately and the rest follow on their own. You can pause between
          episodes, steer the next one, or stop at any point — everything finished is kept.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — the live build view
// ---------------------------------------------------------------------------
function BuildScreen({ run }: { run: SeriesRunState }) {
  const [elapsed, setElapsed] = useState(0);
  const [steer, setSteer] = useState(run.nextSteer);
  const [steerOpen, setSteerOpen] = useState(false);

  const active = run.phase === 'running';

  useEffect(() => {
    if (!active || !run.startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - run.startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, run.startedAt]);

  const done = episodesDone(run);
  const total = run.episodes.length;
  const current = run.episodes.find((ep) => ep.index === run.cursor);
  const finished = run.phase === 'done';
  const failedEpisode = run.episodes.find((ep) => ep.status === 'failed');
  const photoEscape =
    !!failedEpisode && !!run.lock && !!run.lock.portraitUrl && !run.photoDropped;

  return (
    <div className="rc-fade">
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: T.text }}>
            {run.title || 'Your series'}
          </h1>
          <span style={{ fontSize: 12, color: T.muted }}>
            {done}/{total} episodes
            {active ? ` · ${clock(elapsed)}` : ''}
          </span>
        </div>
        <p style={{ margin: '7px 0 14px', fontSize: 13, lineHeight: 1.6, color: T.sub }}>
          {finished
            ? `All ${total} episodes are done — ${runtimeLabel(plannedRunSeconds(run))} of finished video, every one on ${shortModelLabel(run.model)}.`
            : active
              ? current
                ? `Building episode ${current.index} of ${total}: ${current.title}.`
                : `Working through ${total} episodes on ${shortModelLabel(run.model)}.`
              : run.resumable
                ? `This series was still running when the page closed — ${done} of ${total} episodes are done and nothing is lost. Press Continue and it carries on from here.`
                : `Paused after ${done} of ${total} episodes. Nothing finished is lost — press Continue and it picks up from here.`}
        </p>
        <ProgressBar value={runProgress(run)} stopped={!active} testId="bar-series-progress" />
        <p style={{ margin: '9px 0 0', fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
          {continuityLabel(run.model)}
        </p>
      </div>

      {run.notice ? (
        <div style={{ marginBottom: 14 }}>
          <Pill tone="busy" testId="pill-series-notice">
            {run.notice}
          </Pill>
        </div>
      ) : null}

      {run.pauseRequested ? (
        <Card style={{ marginBottom: 14, padding: 13, borderColor: T.accentBorder, background: T.accentSoft }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Loader2 size={14} className="rc-spin" color={T.accentFg} />
            <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: T.text }}>
              Pausing — the episode being built now will finish and be joined first, so nothing
              already paid for is thrown away.
            </span>
            <TextLink onClick={cancelPause} testId="link-cancel-pause">
              Keep going instead
            </TextLink>
          </div>
        </Card>
      ) : null}

      {run.error ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorNotice>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{run.error}</span>
          </ErrorNotice>
        </div>
      ) : null}

      {run.saveNotice ? (
        <p style={{ margin: '0 0 14px', fontSize: 12, lineHeight: 1.55, color: T.muted }}>
          {run.saveNotice}
        </p>
      ) : null}

      {/* Controls — the visitor is never a spectator here. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {active ? (
          <>
            {!run.pauseRequested ? (
              <GhostButton onClick={pauseSeries} testId="button-pause-series">
                <Pause size={13} /> Pause after this episode
              </GhostButton>
            ) : null}
            <GhostButton onClick={stopSeries} testId="button-stop-series">
              <Square size={12} /> Stop now
            </GhostButton>
          </>
        ) : finished ? null : (
          <PrimaryButton onClick={continueSeries} testId="button-continue-series">
            <Play size={14} /> Continue the series
          </PrimaryButton>
        )}
        {!active ? (
          <GhostButton onClick={() => setSteerOpen((v) => !v)} testId="button-toggle-steer">
            <Compass size={13} /> Steer the next episode
          </GhostButton>
        ) : (
          <GhostButton onClick={() => setSteerOpen((v) => !v)} testId="button-toggle-steer">
            <Compass size={13} /> {run.nextSteer ? 'Steer queued ✓' : 'Steer the next episode'}
          </GhostButton>
        )}
        {!active ? (
          <GhostButton onClick={backToPlan} testId="button-back-to-plan">
            <ArrowLeft size={13} /> Edit the plan
          </GhostButton>
        ) : null}
        {finished ? (
          <GhostButton onClick={resetSeries} testId="button-new-series">
            <Clapperboard size={13} /> Start a new series
          </GhostButton>
        ) : null}
      </div>

      {steerOpen ? (
        <Card className="rc-fade" style={{ marginBottom: 16, padding: 15 }}>
          <FieldLabel hint="Applied to the NEXT episode the planner writes — episodes already rendered are untouched.">
            Where should the series go from here?
          </FieldLabel>
          <TextArea
            value={steer}
            onChange={setSteer}
            rows={2}
            placeholder="e.g. move it outside, bring in a rival, make the next one funnier"
            testId="input-series-steer"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <PrimaryButton
              onClick={() => {
                steerNext(steer);
                setSteerOpen(false);
              }}
              disabled={!steer.trim()}
              testId="button-save-steer"
            >
              <Check size={14} /> Use this for the next episode
            </PrimaryButton>
            {run.nextSteer ? (
              <GhostButton
                onClick={() => {
                  setSteer('');
                  clearSteer();
                }}
                testId="button-clear-steer"
              >
                Clear it
              </GhostButton>
            ) : null}
          </div>
        </Card>
      ) : null}

      <SectionLabel style={{ marginBottom: 10 }}>
        Episodes — {CLIPS_PER_EPISODE} clips each
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {run.episodes.map((ep) => (
          <EpisodeCard
            key={ep.index}
            ep={ep}
            current={active && run.cursor === ep.index}
            seriesTitle={run.title || 'series'}
            clipSeconds={run.clipSeconds}
            canEdit={!active}
            showPhotoEscape={photoEscape && failedEpisode?.index === ep.index}
          />
        ))}
      </div>

      {active ? (
        <p style={{ margin: '18px 0 0', fontSize: 12, lineHeight: 1.6, color: T.muted }}>
          <Film size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
          You can leave this screen — the run keeps going and you’ll find it exactly here when you
          come back. Keep the TAB open though: each episode’s four clips are joined into its single
          file right here in your browser. Every clip also lands in My Videos on its own, so nothing
          is ever lost.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mode itself
// ---------------------------------------------------------------------------
/**
 * NO `onBusyChange` HERE, deliberately — unlike Long Video and Video Series.
 *
 * Those two report "busy" while they render, which makes the studio hide its
 * "Back to the studio" link so nobody wanders off mid-run: their state lives in
 * the component, so leaving really would lose it. A series is the opposite. Its
 * state and its loop live in apps/Create/seriesRunner.ts, in module scope, so
 * unmounting this screen stops precisely nothing — and a run is FORTY renders
 * long, which is far too long to lock someone inside one screen. So the exit
 * stays, and the build view says plainly that the run continues without it.
 */
export default function EpisodeSeries({ onExit }: { onExit?: () => void }) {
  const run = useSeriesRun();
  const [casting, setCasting] = useState(false);

  if (casting) {
    return (
      <CharacterStep
        required
        backLabel="Back to the brief"
        subtitle="This character is locked for the entire series: the same description and the same reference image travel with every clip of every episode, which is what keeps them identical from episode 1 to the last."
        onBack={() => setCasting(false)}
        onSkip={() => setCasting(false)}
        onDone={(character) => {
          setSeriesCharacter(character);
          setCasting(false);
          void planSeriesRun();
        }}
      />
    );
  }

  if (run.phase === 'planning') {
    return (
      <div
        className="rc-fade"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '70px 0',
          textAlign: 'center',
        }}
      >
        <Loader2 size={22} className="rc-spin" color={T.accentFg} />
        <p style={{ margin: 0, fontSize: 14, color: T.text }}>
          Planning {run.episodeCount} episodes…
        </p>
        <p style={{ margin: 0, maxWidth: 380, fontSize: 12.5, lineHeight: 1.6, color: T.muted }}>
          Working out the world, the look and what happens in each one. Nothing is rendered yet —
          you approve the plan first.
        </p>
      </div>
    );
  }

  if (run.phase === 'plan') {
    return <PlanScreen run={run} onBack={backToBrief} />;
  }

  if (run.phase === 'running' || run.phase === 'paused' || run.phase === 'done') {
    return <BuildScreen run={run} />;
  }

  return <BriefScreen run={run} onCast={() => setCasting(true)} onExit={onExit} />;
}
