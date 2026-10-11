// The generation state machine behind ComposePanel.
//
// Split out of the panel because the ORDER of operations here is the real
// logic and it is worth reading on its own: submit, optionally pause on a
// storyboard, write a durable job row, then follow the job to a URL via the
// webhook-fed row with a direct HeyGen read as the guarantee.
//
// Multi-scene briefs go out through the batch endpoint as ONE request rather
// than N, which is both faster and far less likely to trip HeyGen's rate
// limit. Each scene still gets its own row so the per-scene tracker is real.
//
// THE VOICE DECIDES THE SHAPE OF THE APPROVAL. On the default ElevenLabs
// pipeline an approved storyboard has something a brief never does: the exact
// lines each scene speaks. So approval narrates them and hands HeyGen the
// finished tracks, which is the only way the avatar's lips are driven by the
// voice the customer auditioned. Whether the Video Agent will TAKE a track is
// not documented, so the first voiced scene asks — once — and the answer is kept
// in the capability registry (lib/heygenAgent). When the answer is no, the suite
// renders each scene through the audio-driven avatar endpoint and SAYS SO; it
// never quietly lets HeyGen read the script in its own voice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { assetHandle, describeError, registerAudioAsset, type CachedAsset } from './heygenApi';
import {
  AgentAudioUnsupported,
  agentStatus,
  approveStoryboard,
  awaitStoryboard,
  renderStoryboardWithAudio,
  submitBatch,
  submitVideoAgent,
  videoAgentAudioRuledOut,
  type AgentVoiceSource,
  type StoryboardScene,
} from './heygenAgent';
import { getSession } from './heygenSession';
import { PRESENTER_VOICE_SETTINGS, speakSegments } from './elevenLabs';
import { resolveNarrationVoiceId, voicePipeline } from './voicePipeline';
import { localJobId, recordJob, trackJob } from './sfJobs';

export type ComposePhase = 'idle' | 'submitting' | 'storyboard' | 'rendering' | 'done';

export interface Generated {
  videoUrl: string;
  jobId: string;
  prompt: string;
}

export interface ComposeInput {
  brief: string;
  /** One entry per extra scene; empty strings are ignored. */
  scenePrompts: string[];
  files: CachedAsset[];
}

/** The spoken line for one storyboard scene, with its own narration track. */
function sceneLine(scene: StoryboardScene): string {
  return String(scene.script || scene.description || '').trim();
}

export function useCompose(onGenerated: (result: Generated) => void) {
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  /**
   * A plain-language explanation of HOW the film was made when it was not made
   * the usual way — the Video Agent refusing a voice track, a scene that could
   * not render. Not an error: the film shipped, and the customer deserves to
   * know why it took the route it did.
   */
  const [note, setNote] = useState('');
  const [storyboard, setStoryboard] = useState<StoryboardScene[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  /** Per-scene batch state: '' in flight, 'done', or an error message. */
  const [batchState, setBatchState] = useState<Record<string, string>>({});
  const jobRef = useRef('');
  const inputRef = useRef<ComposeInput>({ brief: '', scenePrompts: [], files: [] });

  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return;
    const clock = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(clock);
  }, [phase]);

  const reset = useCallback(() => {
    setPhase('idle');
    setElapsed(0);
    setError('');
    setNote('');
    setStoryboard([]);
    setVideoUrl('');
    setBatchState({});
    jobRef.current = '';
  }, []);

  /** Bank the submission, then follow it to a finished URL. */
  const follow = useCallback(async (jobId: string, label: string, prompt: string, batchId?: string, sceneIndex?: number): Promise<string> => {
    const session = getSession();
    const input = inputRef.current;
    await recordJob({
      videoId: jobId,
      jobType: 'video_agent',
      batchId,
      script: prompt,
      avatarId: session.avatarId,
      avatarName: session.avatarName,
      voiceId: session.voiceId,
      voiceName: session.voiceName,
      aspectRatio: session.orientation === 'portrait' ? '9:16' : '16:9',
      metadata: {
        prompt,
        ...(sceneIndex ? { scene_index: sceneIndex } : {}),
        orientation: session.orientation,
        brand_kit_id: session.brandKitId,
        brand_glossary_id: session.brandGlossaryId,
        storyboard_review: session.storyboardReview,
        transparent_background: session.transparentBackground,
        cinematic: session.cinematicMode,
        files: input.files.map(assetHandle),
      },
    });
    const tracked = await trackJob(jobId, {
      label,
      onTick: (seconds) => setElapsed(seconds),
      // trackJob reads the webhook-fed row first; this single direct read is
      // what guarantees the job finishes even when no callback can arrive.
      direct: () => agentStatus(jobId),
    });
    return tracked.videoUrl;
  }, []);

  const generate = useCallback(async (input: ComposeInput) => {
    inputRef.current = input;
    const session = getSession();
    const handles = input.files.map(assetHandle);
    const scenes = input.scenePrompts.map((prompt) => prompt.trim()).filter(Boolean);
    const brief = input.brief.trim();
    // A good-voice film needs scene lines before it can be narrated. Planning
    // first is therefore mandatory on the ElevenLabs pipeline, even when the
    // optional review toggle is off; otherwise this button would still send a
    // one-shot Video Agent request that speaks with HeyGen TTS.
    const voicedStoryboard = voicePipeline() === 'elevenlabs_heygen';

    setError('');
    setVideoUrl('');
    setStoryboard([]);
    setBatchState({});
    setElapsed(0);
    setPhase('submitting');

    try {
      if (scenes.length > 1 && !voicedStoryboard) {
        const localBatch = localJobId('batch');
        const submission = await submitBatch(
          scenes.map((prompt, index) => ({ key: `scene-${index + 1}`, prompt, files: handles })),
          session.storyboardReview,
        );
        const ids = submission.jobIds.filter(Boolean);
        if (!ids.length) throw new Error('HeyGen accepted the batch but returned no scene ids to track.');
        const batchId = submission.batchId || localBatch;
        setPhase('rendering');
        setBatchState(Object.fromEntries(ids.map((_, index) => [`Scene ${index + 1}`, ''])));

        const urls = await Promise.all(ids.map(async (id, index) => {
          const label = `Scene ${index + 1}`;
          try {
            const url = await follow(id, label, scenes[index] || '', batchId, index + 1);
            setBatchState((current) => ({ ...current, [label]: 'done' }));
            return url;
          } catch (e) {
            // One failed scene must not lose the scenes that DID render, so
            // the failure is recorded against that scene and the rest stand.
            setBatchState((current) => ({ ...current, [label]: describeError(e) }));
            return '';
          }
        }));

        const first = urls.find(Boolean) || '';
        if (!first) throw new Error('None of the scenes in this batch finished successfully.');
        setVideoUrl(first);
        setPhase('done');
        onGenerated({ videoUrl: first, jobId: ids[0], prompt: brief || scenes[0] });
        return;
      }

      const prompt = brief || (scenes.length > 1
        ? `Create exactly these scenes:\n${scenes.map((scene, index) => `${index + 1}. ${scene}`).join('\n')}`
        : scenes[0] || '');
      const reviewStoryboard = session.storyboardReview || voicedStoryboard;
      const submission = await submitVideoAgent({ prompt, files: handles }, reviewStoryboard);
      jobRef.current = submission.jobId;

      if (submission.videoUrl) {
        if (voicedStoryboard) {
          throw new Error('HeyGen rendered immediately without returning scene lines, so SceneForge stopped rather than deliver a film spoken with HeyGen text-to-speech.');
        }
        setVideoUrl(submission.videoUrl);
        setPhase('done');
        onGenerated({ videoUrl: submission.videoUrl, jobId: submission.jobId, prompt });
        return;
      }

      if (reviewStoryboard) {
        setPhase('storyboard');
        const plan = submission.storyboard.length ? submission.storyboard : await awaitStoryboard(submission.jobId, setElapsed);
        if (plan.length) { setStoryboard(plan); return; }
        // On the ElevenLabs pipeline, continuing here would silently publish a
        // film spoken by HeyGen TTS. Stop honestly instead; a customer can opt
        // into the debug `heygen_tts` switch if that is what they want.
        if (voicedStoryboard) {
          throw new Error('HeyGen started rendering without returning scene lines, so SceneForge stopped rather than substitute HeyGen text-to-speech for the selected ElevenLabs voice.');
        }
        // Explicit HeyGen-TTS mode may continue when the endpoint ignores the
        // optional review pause.
      }

      setPhase('rendering');
      const url = await follow(submission.jobId, 'Your video', prompt);
      setVideoUrl(url);
      setPhase('done');
      onGenerated({ videoUrl: url, jobId: submission.jobId, prompt });
    } catch (e) {
      setError(describeError(e));
      setPhase('idle');
    }
  }, [follow, onGenerated]);

  /**
   * Render an approved storyboard with ElevenLabs on the lips.
   *
   * Returns false only when the shared switch explicitly selects HeyGen TTS.
   * Missing lines or a missing ElevenLabs voice are errors on the ElevenLabs
   * pipeline — silently approving the same board with HeyGen TTS is forbidden.
   *
   * THE PROBE. Scene 1 is narrated and submitted to the Video Agent carrying its
   * own track. That submission is both the real render of scene 1 AND the answer
   * to "does this account's Video Agent accept an audio voice source?" — asked on
   * a scene the customer actually wants rather than on a throwaway brief, so the
   * question never costs a credit of its own. A refusal of the FIELD happens
   * before any render starts, which is why falling through loses nothing.
   */
  const renderVoicedStoryboard = useCallback(async (edited: StoryboardScene[]): Promise<boolean> => {
    if (voicePipeline() !== 'elevenlabs_heygen') return false;
    const scenes = edited.filter((scene) => sceneLine(scene));
    if (!scenes.length) throw new Error('Add a spoken line or description to at least one storyboard scene before rendering.');
    const voiceId = await resolveNarrationVoiceId().catch(() => '');
    if (!voiceId) throw new Error('No ElevenLabs voice is available for this workspace, so SceneForge stopped rather than substitute HeyGen text-to-speech.');

    const session = getSession();
    const aspectRatio = session.orientation === 'portrait' ? '9:16' : '16:9';
    const handles = inputRef.current.files.map(assetHandle);
    const brief = inputRef.current.brief.trim();

    const narrate = async (lines: string[]): Promise<AgentVoiceSource[]> => {
      const spoken = await speakSegments(lines, voiceId, PRESENTER_VOICE_SETTINGS);
      return Promise.all(spoken.segments.map(async (segment) => ({
        audioUrl: segment.audioUrl,
        // Best effort: an account with an asset registry gets a real id, the
        // rest send the public URL. Both bypass HeyGen's TTS.
        audioAssetId: await registerAudioAsset(segment.audioUrl, 'audio/mpeg'),
      })));
    };

    if (!videoAgentAudioRuledOut()) {
      try {
        setBatchState(Object.fromEntries(scenes.map((_, index) => [`Scene ${index + 1}`, ''])));
        const [lead] = await narrate([sceneLine(scenes[0])]);
        const first = await submitVideoAgent({ prompt: sceneLine(scenes[0]) || brief, files: handles, voice: lead }, false);
        const urls: string[] = [];
        const leadUrl = first.videoUrl || await follow(first.jobId, 'Scene 1', sceneLine(scenes[0]), undefined, 1);
        setBatchState((current) => ({ ...current, 'Scene 1': 'done' }));
        urls.push(leadUrl);

        const rest = scenes.slice(1);
        if (rest.length) {
          const voices = await narrate(rest.map(sceneLine));
          const batch = await submitBatch(
            rest.map((scene, index) => ({ key: `scene-${index + 2}`, prompt: sceneLine(scene), files: handles, voice: voices[index] })),
            false,
          );
          const ids = batch.jobIds.filter(Boolean);
          const batchId = batch.batchId || localJobId('batch');
          const settled = await Promise.all(ids.map(async (id, index) => {
            const label = `Scene ${index + 2}`;
            try {
              const url = await follow(id, label, sceneLine(rest[index]), batchId, index + 2);
              setBatchState((current) => ({ ...current, [label]: 'done' }));
              return url;
            } catch (e) {
              setBatchState((current) => ({ ...current, [label]: describeError(e) }));
              return '';
            }
          }));
          urls.push(...settled.filter(Boolean));
        }

        setVideoUrl(urls[0] || '');
        setPhase('done');
        onGenerated({ videoUrl: urls[0] || '', jobId: first.jobId, prompt: brief || sceneLine(scenes[0]) });
        return true;
      } catch (e) {
        // Only the voice FIELD being refused falls through; a real failure is the
        // caller's problem to report.
        if (!(e instanceof AgentAudioUnsupported)) throw e;
      }
    }

    // The Video Agent will not carry a voice track on this account. Each scene
    // is lip-synced on its own instead, and the reason is surfaced rather than
    // swallowed.
    setBatchState(Object.fromEntries(scenes.map((_, index) => [`Scene ${index + 1}`, ''])));
    const rendered = await renderStoryboardWithAudio(scenes, {
      voiceId,
      aspectRatio,
      onStage: (message) => setNote(message),
    });
    rendered.clips.forEach((_, index) => setBatchState((current) => ({ ...current, [`Scene ${index + 1}`]: 'done' })));
    rendered.failed.forEach((entry, index) => setBatchState((current) => ({ ...current, [`Scene ${rendered.clips.length + index + 1}`]: entry.reason })));
    setNote(rendered.note);
    if (!rendered.clips.length) throw new Error(`None of the scenes rendered. ${rendered.note}`);
    setVideoUrl(rendered.clips[0].videoUrl);
    setPhase('done');
    onGenerated({ videoUrl: rendered.clips[0].videoUrl, jobId: jobRef.current, prompt: brief });
    return true;
  }, [follow, onGenerated]);

  const approve = useCallback(async (edited: StoryboardScene[], approvalNote: string) => {
    setError('');
    setNote('');
    setElapsed(0);
    setPhase('rendering');
    try {
      if (await renderVoicedStoryboard(edited)) return;
      await approveStoryboard(jobRef.current, edited, approvalNote);
      const url = await follow(jobRef.current, 'Your video', inputRef.current.brief.trim());
      setVideoUrl(url);
      setPhase('done');
      onGenerated({ videoUrl: url, jobId: jobRef.current, prompt: inputRef.current.brief.trim() });
    } catch (e) {
      setError(describeError(e));
      // Back to the storyboard, not to idle: the plan is still valid and the
      // customer should be able to retry the approval without re-planning.
      setPhase('storyboard');
    }
  }, [follow, onGenerated, renderVoicedStoryboard]);

  return {
    phase,
    elapsed,
    error,
    note,
    storyboard,
    setStoryboard,
    videoUrl,
    batchState,
    generate,
    approve,
    reset,
    busy: phase === 'submitting' || phase === 'rendering',
  };
}
