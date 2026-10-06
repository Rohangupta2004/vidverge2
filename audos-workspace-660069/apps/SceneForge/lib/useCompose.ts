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
import { useCallback, useEffect, useRef, useState } from 'react';
import { assetHandle, describeError, type CachedAsset } from './heygenApi';
import { agentStatus, approveStoryboard, awaitStoryboard, submitBatch, submitVideoAgent, type StoryboardScene } from './heygenAgent';
import { getSession } from './heygenSession';
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

export function useCompose(onGenerated: (result: Generated) => void) {
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
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

    setError('');
    setVideoUrl('');
    setStoryboard([]);
    setBatchState({});
    setElapsed(0);
    setPhase('submitting');

    try {
      if (scenes.length > 1) {
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

      const prompt = brief || scenes[0] || '';
      const submission = await submitVideoAgent({ prompt, files: handles }, session.storyboardReview);
      jobRef.current = submission.jobId;

      if (submission.videoUrl) {
        setVideoUrl(submission.videoUrl);
        setPhase('done');
        onGenerated({ videoUrl: submission.videoUrl, jobId: submission.jobId, prompt });
        return;
      }

      if (session.storyboardReview) {
        setPhase('storyboard');
        const plan = submission.storyboard.length ? submission.storyboard : await awaitStoryboard(submission.jobId, setElapsed);
        if (plan.length) { setStoryboard(plan); return; }
        // HeyGen went straight to rendering despite the review mode. Falling
        // through is right: showing an empty storyboard would strand the
        // customer with nothing to approve.
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

  const approve = useCallback(async (edited: StoryboardScene[], note: string) => {
    setError('');
    setElapsed(0);
    setPhase('rendering');
    try {
      await approveStoryboard(jobRef.current, edited, note);
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
  }, [follow, onGenerated]);

  return {
    phase,
    elapsed,
    error,
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
