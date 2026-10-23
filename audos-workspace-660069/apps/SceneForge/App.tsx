/**
 * SceneForge — rebuilt from scratch (Oct 2026, founder's handwritten spec).
 *
 * Long HeyGen avatar videos with ElevenLabs sound, then post-production:
 * Deepgram word timings → a boss agent (Claude Opus 5 → Sonnet 5 fallback)
 * plans a niche-tailored edit and creates assets (images, Veo 3.1 Fast B-roll,
 * ElevenLabs music + SFX) → an expert Remotion coder writes a unique,
 * voice-synced graphics layer → 4 × 5s draft styles, the user stars one →
 * full renders of BOTH 16:9 and a native 9:16 layout from the one shared plan.
 *
 * All one-time choices (style, niche, voice, avatar, music mood, B-roll
 * amount, transparent background) happen BEFORE generation. The pipeline is a
 * durable server job on `sceneforge-pipeline`: it continues avatar polling and
 * post-production after the tab closes; this app only refreshes persisted state.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Clapperboard, Film, Loader2, Plus, Rocket } from 'lucide-react';
import { COLORS, FONT, RADIUS } from '../../components/theme';
import CreditBalance from '../../components/CreditBalance';
import VideoHistory from '../../components/VideoHistory';
import { saveVideoToHistory } from '../../lib/videoHistory';
import {
  cancelProject,
  chooseDraft,
  createProject,
  applyEdit,
  getProject,
  listProjects,
  reviewStep,
  retryFromStep,
  startProject,
} from './lib/forgeClient';
import type { ForgeChoices, ForgeProject } from './lib/forgeTypes';
import ForgeScriptStep, { type ScriptStepValue } from './components/ForgeScriptStep';
import ForgeAvatarStep from './components/ForgeAvatarStep';
import ForgeChoicesStep from './components/ForgeChoicesStep';
import ForgeProductionBoard from './components/ForgeProductionBoard';

const TICK_MS = 6000;
const ACTIVE = ['voicing', 'avatar', 'transcribe', 'direct', 'assets', 'code', 'drafts', 'final_render', 'portrait_finish'];

type View = { kind: 'home' } | { kind: 'wizard'; step: 0 | 1 | 2 } | { kind: 'production'; projectId: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [projects, setProjects] = useState<ForgeProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  // Wizard state — everything chosen ONCE before generation.
  const [scriptValue, setScriptValue] = useState<ScriptStepValue>({ topic: '', script: '', niche: '', voiceId: '', voiceName: '' });
  const [choices, setChoices] = useState<ForgeChoices>({ brollAmount: 'light', musicMood: 'confident', style: 'modern' });
  const [targetSeconds, setTargetSeconds] = useState(120);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState('');

  // Production state.
  const [project, setProject] = useState<ForgeProject | null>(null);
  const [insufficient, setInsufficient] = useState<{ required: number; shortfall: number | null } | null>(null);
  const savedToHistory = useRef(false);

  const refreshProjects = useCallback(() => {
    listProjects()
      .then((rows) => { setProjects(rows); setProjectsLoaded(true); })
      .catch(() => setProjectsLoaded(true));
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // --- read-only persisted status refresh; the server owns every pipeline step ----
  useEffect(() => {
    if (view.kind !== 'production') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (cancelled) return;
      try {
        const current = await getProject(view.projectId);
        if (!cancelled && current) setProject(current);
      } catch (e) {
        console.warn('[SceneForge] project refresh failed:', e);
      }
      timer = setTimeout(loop, TICK_MS);
    };

    void loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [view]);

  // --- save finished videos to the shared cross-app history ----------------
  useEffect(() => {
    if (!project || project.status !== 'done' || savedToHistory.current) return;
    savedToHistory.current = true;
    if (project.final_video_url) {
      void saveVideoToHistory({ appId: 'sceneforge', title: `${project.topic} (16:9)`, videoUrl: project.final_video_url, durationSec: project.avatar_duration_sec });
    }
    if (project.portrait_video_url) {
      void saveVideoToHistory({ appId: 'sceneforge', title: `${project.topic} (9:16)`, videoUrl: project.portrait_video_url, durationSec: project.avatar_duration_sec });
    }
  }, [project]);

  const estimatedSeconds = scriptValue.script.trim()
    ? Math.max(10, Math.round(scriptValue.script.trim().split(/\s+/).length / 2.4))
    : targetSeconds;

  const begin = async () => {
    if (startBusy) return;
    setStartBusy(true);
    setStartError('');
    try {
      const fullChoices: ForgeChoices = {
        ...choices,
        voiceId: scriptValue.voiceId,
        voiceName: scriptValue.voiceName,
        niche: scriptValue.niche,
      };
      const created = await createProject({
        topic: scriptValue.topic || scriptValue.script.slice(0, 60) || 'Untitled video',
        script: scriptValue.script,
        niche: scriptValue.niche,
        style: String(fullChoices.style || 'modern'),
        target_length_sec: targetSeconds,
        choices: fullChoices,
      });
      const started = await startProject(created.id, scriptValue.script, fullChoices);
      savedToHistory.current = false;
      setProject(started);
      setInsufficient(null);
      setView({ kind: 'production', projectId: started.id });
      refreshProjects();
    } catch (e: any) {
      setStartError(String(e?.message || e));
    } finally {
      setStartBusy(false);
    }
  };

  const openProject = (p: ForgeProject) => {
    savedToHistory.current = p.status === 'done';
    setProject(p);
    setInsufficient(null);
    setView({ kind: 'production', projectId: p.id });
  };

  const stepReady = (step: number): boolean => {
    if (step === 0) return Boolean(scriptValue.script.trim() && scriptValue.voiceId);
    if (step === 1) return Boolean(choices.avatarId);
    return Boolean(choices.style);
  };

  const shellStyle: CSSProperties = {
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: FONT.body,
    minHeight: '100%',
    padding: '20px clamp(14px, 4vw, 32px) 48px',
  };

  const header = (
    <header style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <span style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', borderRadius: 10, color: COLORS.onAccent, display: 'flex', height: 36, justifyContent: 'center', width: 36 }}>
          <Film size={18} />
        </span>
        <div>
          <h1 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>SceneForge</h1>
          <p style={{ color: COLORS.muted, fontSize: 12, margin: 0 }}>Avatar video → agent-coded motion graphics · 16:9 + 9:16 from one pass</p>
        </div>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <CreditBalance variant="chrome" />
      </div>
    </header>
  );

  // ------------------------------- HOME -------------------------------------
  if (view.kind === 'home') {
    const active = projects.filter((p) => ACTIVE.indexOf(p.status) >= 0 || p.status === 'draft_pick' || p.status === 'failed');
    const finished = projects.filter((p) => p.status === 'done');
    return (
      <div style={shellStyle}>
        {header}
        <div style={{ display: 'grid', gap: 24, maxWidth: 1100 }}>
          <button
            type="button"
            onClick={() => setView({ kind: 'wizard', step: 0 })}
            style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.card, color: COLORS.onAccent, cursor: 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 16, fontWeight: 700, gap: 10, justifyContent: 'center', minHeight: 56, maxWidth: 420 }}
            data-testid="button-new-video"
          >
            <Plus size={18} /> New avatar video
          </button>

          {!projectsLoaded ? (
            <div style={{ alignItems: 'center', color: COLORS.muted, display: 'flex', fontSize: 13.5, gap: 8 }}>
              <Loader2 size={15} className="animate-spin" /> Loading your projects…
            </div>
          ) : null}

          {active.length ? (
            <section>
              <h2 style={{ color: COLORS.muted, fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, letterSpacing: '0.07em', margin: '0 0 10px', textTransform: 'uppercase' }}>In production</h2>
              <div style={{ display: 'grid', gap: 8 }}>
                {active.map((p) => (
                  <button key={p.id} type="button" onClick={() => openProject(p)} style={{ alignItems: 'center', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, color: COLORS.text, cursor: 'pointer', display: 'flex', gap: 12, minHeight: 56, padding: '10px 14px', textAlign: 'left' }} data-testid={`button-open-${p.id}`}>
                    <Loader2 size={16} color={COLORS.accent} className="animate-spin" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: FONT.heading, fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.topic}</span>
                      <span style={{ color: COLORS.muted, display: 'block', fontSize: 12.5 }}>{p.status === 'draft_pick' ? 'Waiting for you — pick an edit style' : p.stage_note || p.status}</span>
                    </span>
                    <ArrowRight size={15} color={COLORS.muted} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {finished.length ? (
            <section>
              <h2 style={{ color: COLORS.muted, fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, letterSpacing: '0.07em', margin: '0 0 10px', textTransform: 'uppercase' }}>Finished</h2>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                {finished.map((p) => (
                  <button key={p.id} type="button" onClick={() => openProject(p)} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, cursor: 'pointer', overflow: 'hidden', padding: 0, textAlign: 'left' }} data-testid={`button-open-done-${p.id}`}>
                    {p.final_video_url ? <video src={p.final_video_url} muted playsInline preload="metadata" style={{ aspectRatio: '16 / 9', background: '#000', display: 'block', width: '100%' }} /> : null}
                    <span style={{ color: COLORS.text, display: 'block', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', padding: '10px 12px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.topic}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {projectsLoaded && !projects.length ? (
            <div style={{ background: COLORS.surface, border: `1px dashed ${COLORS.border}`, borderRadius: RADIUS.card, color: COLORS.secondary, fontSize: 14, lineHeight: '22px', maxWidth: 640, padding: 20 }}>
              <Clapperboard size={18} color={COLORS.accent} style={{ marginBottom: 8 }} />
              <div style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Your first SceneForge video</div>
              Write (or generate) a script, pick a voice and an avatar, make your one-time style choices — SceneForge voices it with ElevenLabs,
              renders the HeyGen avatar, and an agent crew edits it with unique voice-synced graphics and B-roll. You get a 16:9 and a native 9:16 cut of the same video.
            </div>
          ) : null}

          <VideoHistory title="Your videos (all apps)" limit={8} />
        </div>
      </div>
    );
  }

  // ------------------------------ WIZARD ------------------------------------
  if (view.kind === 'wizard') {
    const step = view.step;
    const titles = ['Script & voice', 'Select avatar', 'One-time choices'];
    return (
      <div style={shellStyle}>
        {header}
        <div style={{ alignItems: 'center', display: 'flex', gap: 10, marginBottom: 18 }}>
          <button type="button" onClick={() => (step === 0 ? setView({ kind: 'home' }) : setView({ kind: 'wizard', step: (step - 1) as 0 | 1 | 2 }))} aria-label="Back" style={{ alignItems: 'center', background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: 999, color: COLORS.secondary, cursor: 'pointer', display: 'flex', height: 40, justifyContent: 'center', width: 40 }} data-testid="button-wizard-back">
            <ArrowLeft size={16} />
          </button>
          {titles.map((t, i) => (
            <span key={t} style={{ alignItems: 'center', color: i === step ? COLORS.accent : i < step ? COLORS.success : COLORS.muted, display: 'flex', fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, gap: 6 }}>
              <span style={{ alignItems: 'center', background: i === step ? COLORS.accentSoft : 'transparent', border: `1px solid ${i === step ? COLORS.accent : COLORS.border}`, borderRadius: 999, display: 'flex', fontSize: 11.5, height: 22, justifyContent: 'center', width: 22 }}>{i + 1}</span>
              <span style={{ display: window.innerWidth < 520 && i !== step ? 'none' : 'inline' }}>{t}</span>
            </span>
          ))}
        </div>

        {step === 0 ? <ForgeScriptStep value={scriptValue} targetSeconds={targetSeconds} onChange={setScriptValue} /> : null}
        {step === 1 ? (
          <ForgeAvatarStep avatarId={String(choices.avatarId || '')} onPick={(a) => setChoices({ ...choices, avatarId: a.id, avatarName: a.name, avatarGestures: a.gestures, avatarEmotions: a.emotions })} />
        ) : null}
        {step === 2 ? (
          <ForgeChoicesStep choices={choices} targetSeconds={targetSeconds} estimatedSeconds={estimatedSeconds} onChange={setChoices} onTargetChange={setTargetSeconds} />
        ) : null}

        {startError ? <div style={{ color: COLORS.danger, fontSize: 13.5, marginTop: 14 }}>{startError}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          {step < 2 ? (
            <button
              type="button"
              disabled={!stepReady(step)}
              onClick={() => setView({ kind: 'wizard', step: (step + 1) as 0 | 1 | 2 })}
              style={{ alignItems: 'center', background: stepReady(step) ? 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)' : COLORS.raised, border: 'none', borderRadius: RADIUS.sm, color: stepReady(step) ? COLORS.onAccent : COLORS.muted, cursor: stepReady(step) ? 'pointer' : 'not-allowed', display: 'flex', fontFamily: FONT.heading, fontSize: 15, fontWeight: 700, gap: 8, minHeight: 48, padding: '0 22px' }}
              data-testid="button-wizard-next"
            >
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={startBusy || !stepReady(0) || !stepReady(1) || !stepReady(2)}
              onClick={begin}
              style={{ alignItems: 'center', background: startBusy ? COLORS.raised : 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: startBusy ? COLORS.muted : COLORS.onAccent, cursor: startBusy ? 'wait' : 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 15, fontWeight: 700, gap: 8, minHeight: 48, padding: '0 22px' }}
              data-testid="button-generate"
            >
              {startBusy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {startBusy ? 'Starting…' : 'Generate both formats'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------- PRODUCTION ----------------------------------
  return (
    <div style={shellStyle}>
      {header}
      <button type="button" onClick={() => { setView({ kind: 'home' }); refreshProjects(); }} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: COLORS.muted, cursor: 'pointer', display: 'flex', fontFamily: FONT.body, fontSize: 13.5, gap: 6, marginBottom: 14, minHeight: 40, padding: 0 }} data-testid="button-back-home">
        <ArrowLeft size={14} /> All projects
      </button>
      {project ? (
        <ForgeProductionBoard
          project={project}
          insufficient={insufficient}
          onChooseDraft={async (v) => {
            const p = await chooseDraft(project.id, v);
            if (p) setProject(p);
          }}
          onEdit={async (changes) => {
            const p = await applyEdit(project.id, changes);
            savedToHistory.current = false;
            if (p) setProject(p);
          }}
          onRetry={async () => {
            const p = await retryFromStep(project.id);
            if (p) setProject(p);
          }}
          onStepAction={async (step, action, value) => {
            const p = await reviewStep(project.id, step, action, value);
            if (p) setProject(p);
          }}
          onCancel={async () => {
            const p = await cancelProject(project.id);
            if (p) setProject(p);
          }}
        />
      ) : (
        <div style={{ alignItems: 'center', color: COLORS.muted, display: 'flex', fontSize: 13.5, gap: 8 }}>
          <Loader2 size={15} className="animate-spin" /> Loading the project…
        </div>
      )}
    </div>
  );
}
