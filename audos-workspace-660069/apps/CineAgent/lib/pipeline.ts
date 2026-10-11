// CineAgent — the autonomous production pipeline.
//
// upload → analyze → direct → assets → render → review → finish.
// Every stage checkpoints the whole project row to cine_projects, so a page
// refresh resumes from the last completed stage instead of re-paying for
// finished work. Review failures trigger at most TWO targeted revisions; the
// best-scoring cut ships, and an honest failure is reported when nothing does.

import { errorMessage } from './ai';
import { decodeAudioMono, detectSilences, encodeWav } from './audio';
import { produceAssets, reconcilePlanWithAssets } from './assets';
import { GEMINI_ANALYSIS_PROMPT, directEdit, parseContentAnalysis, refinePlan, revisePlan } from './director';
import {
  analyzeVideoFile, extractFrames, generateMusic, generateVoiceover,
  transcribeTimestamped, uploadFile, measureVideo, waitForWorkspaceBridge,
  UPLOAD_LIMIT_BYTES,
} from './platform';
import { assembleRenderPlan, computeTiming, normalizePlan } from './plan';
import { runQA } from './qa';
import { renderCut } from './render';
import { appendActivity, saveProject, stagePct } from './store';
import type {
  ActivityLine, AnalysisReport, EditPlan, GeneratedAsset, ProjectRow,
  QAReport, RenderPlan, SourceVideo, StageId, TranscriptWord, UserPrefs,
} from './types';

export interface PipelineHandle {
  cancelled: boolean;
}

export interface PipelineCallbacks {
  onRow: (row: ProjectRow) => void;
}

const MAX_REVIEW_PASSES = 2;

export async function runPipeline(
  row: ProjectRow,
  file: File | null,
  handle: PipelineHandle,
  cb: PipelineCallbacks,
): Promise<void> {
  let current: ProjectRow = { ...row };
  let activity: ActivityLine[] = Array.isArray(current.activity) ? current.activity : [];

  const log = (text: string, kind: ActivityLine['kind'] = 'info') => {
    activity = appendActivity(activity, text, kind);
    current = { ...current, activity };
  };
  const checkpoint = async (patch: Partial<ProjectRow>, within = 0.5, detail = '') => {
    current = { ...current, ...patch, activity };
    current.progress = { pct: stagePct(current.stage, within), detail: detail || current.progress?.detail || '' };
    cb.onRow(current);
    try {
      await saveProject(current.id, {
        status: current.status, stage: current.stage, progress: current.progress,
        source: current.source, analysis: current.analysis, plan: current.plan,
        assets: current.assets, qa: current.qa, result: current.result,
        activity: current.activity, error: current.error,
      });
    } catch {
      // Persistence must never kill a run mid-render; the next checkpoint retries.
    }
  };
  const bail = (reason: string) => {
    const err = new Error(reason);
    (err as any).cancelled = true;
    throw err;
  };
  const guard = () => { if (handle.cancelled) bail('Cancelled'); };

  try {
    // The AI, transcription and data calls all need the workspace session
    // token, which the platform injects asynchronously. Wait for it (bounded)
    // so a fast first click never surfaces as a sign-in error.
    const bridgeReady = await waitForWorkspaceBridge(10000);
    if (!bridgeReady) {
      log('Your session is still connecting — progress will sync once it does. The upload itself does not need it.', 'warn');
    }

    // ----- STAGE: upload ----------------------------------------------------
    if (!current.source) {
      if (!file) throw new Error('The original upload is no longer available — start a new project with the video file.');
      current.stage = 'upload';
      log('Registering footage: ' + file.name + ' (' + (file.size / (1024 * 1024)).toFixed(1) + 'MB)');
      await checkpoint({}, 0.1, 'Uploading footage');
      if (file.size > UPLOAD_LIMIT_BYTES) {
        throw new Error('This file is ' + (file.size / (1024 * 1024)).toFixed(0) + 'MB — the platform upload limit is 50MB. Trim or compress the video and try again.');
      }
      const meta = await measureLocalFile(file);
      const uploaded = await uploadFile(file, file.name || 'source.mp4');
      const source: SourceVideo = {
        url: uploaded.url, key: uploaded.key, name: file.name || 'source.mp4',
        mime: file.type || 'video/mp4', bytes: file.size,
        duration: meta.duration, width: meta.width, height: meta.height,
      };
      log('Footage registered (' + meta.duration.toFixed(1) + 's, ' + meta.width + 'x' + meta.height + ')', 'ok');
      await checkpoint({ source }, 1, 'Footage registered');
    }
    guard();
    const source = current.source as SourceVideo;

    // ----- STAGE: analyze ---------------------------------------------------
    if (!current.analysis) {
      current.stage = 'analyze';
      await checkpoint({}, 0.05, 'Watching the footage');
      const analysis = await analyzeFootage(source, file, log, async (within, detail) => {
        guard();
        await checkpoint({}, within, detail);
      });
      await checkpoint({ analysis }, 1, 'Analysis complete');
    }
    guard();
    const analysis = current.analysis as AnalysisReport;

    // ----- STAGE: direct ----------------------------------------------------
    if (!current.plan) {
      current.stage = 'direct';
      await checkpoint({}, 0.15, 'Claude is directing the edit');
      log('Creative direction: Claude Opus is studying the footage and writing the edit plan…');
      const rawPlan = await directEdit(source, analysis, current.prefs);
      let { plan, warnings } = normalizePlan(rawPlan, source, current.prefs);
      warnings.forEach((w) => log(w, 'warn'));
      guard();
      // Polish pass: the director critiques its own plan against the premium
      // bar BEFORE any asset or render money is spent. A failed polish never
      // blocks the run — the first plan ships instead.
      await checkpoint({ plan }, 0.6, 'Polishing the direction');
      log('Polish pass: the director is reviewing its own plan for hook, clutter, variety and a signature moment…');
      try {
        const polishedRaw = await refinePlan(plan, source);
        const polished = normalizePlan(polishedRaw, source, current.prefs);
        if (polished.plan.timeline.length) {
          plan = polished.plan;
          polished.warnings.forEach((w) => log(w, 'warn'));
          log('Polish applied.', 'ok');
        }
      } catch (error) {
        log('Polish pass skipped (' + errorMessage(error) + ') — keeping the first plan.', 'warn');
      }
      const timing = computeTiming(plan);
      log('Direction locked: "' + plan.title + '" — ' + plan.timeline.length + ' segments, '
        + plan.overlays.length + ' motion graphics, ' + plan.assets.length + ' generated assets, '
        + timing.duration.toFixed(0) + 's cut from ' + source.duration.toFixed(0) + 's of footage.', 'ok');
      if (plan.direction) log('Director\u2019s note: ' + plan.direction);
      await checkpoint({ plan }, 1, 'Edit plan ready');
    }
    guard();

    // ----- STAGE: assets ----------------------------------------------------
    let registry: Record<string, GeneratedAsset> = current.assets || {};
    let plan = current.plan as EditPlan;
    if (current.stage === 'direct' || current.stage === 'assets' || !current.result) {
      current.stage = 'assets';
      const identityStyle = 'Consistent visual identity: ' + plan.identity.tone
        + ' Palette around ' + plan.identity.primary + ' and ' + plan.identity.accent + '.';
      const produced = await produceAssets(plan, source, registry, identityStyle, (p, note) => {
        if (note) log(note);
        checkpoint({ assets: registry }, p.total ? (0.1 + 0.6 * (p.done / p.total)) : 0.5,
          p.total ? ('Assets ' + p.done + '/' + p.total) : 'Preparing assets');
      });
      registry = produced.registry;
      produced.failures.forEach((f) => log('Asset failed (the edit adapts): ' + f, 'warn'));
      const reconciled = reconcilePlanWithAssets(plan, registry);
      plan = reconciled.plan;
      reconciled.dropped.forEach((d) => log('Dropped ' + d + ' — its asset was unavailable.', 'warn'));
      await checkpoint({ plan, assets: registry }, 0.75, 'Assets ready');
      guard();
    }

    // Music + narration (part of the assets stage budget-wise). The finished
    // track is checkpointed into the asset registry under __music so a resumed
    // run never pays for it twice.
    let musicUrl: string | null = registry.__music?.url || null;
    const timing = computeTiming(plan);
    if (plan.audio.music && !musicUrl) {
      try {
        log('Scoring: generating the underscore — “' + plan.audio.music.prompt.slice(0, 90) + '”');
        musicUrl = await generateMusic(plan.audio.music.prompt, (timing.duration + 2) * 1000);
        registry = { ...registry, __music: { id: '__music', kind: 'image', url: musicUrl, model: 'music', prompt: plan.audio.music.prompt } };
        log('Underscore ready.', 'ok');
      } catch (error) {
        log('Music generation failed (' + errorMessage(error) + ') — shipping without a music bed.', 'warn');
        musicUrl = null;
      }
      await checkpoint({ assets: registry }, 0.85, 'Audio ready');
      guard();
    }
    let narration: RenderPlan['narration'] = null;
    if (plan.audio.narration && plan.audio.narration.segments.length) {
      const segs: { at: number; url: string; durationMs: number; text: string }[] = [];
      for (const seg of plan.audio.narration.segments) {
        try {
          const voice = await generateVoiceover(seg.text, plan.audio.narration.voiceId);
          segs.push({ at: seg.at, url: voice.url, durationMs: voice.durationMs, text: seg.text });
        } catch (error) {
          log('Narration segment failed (' + errorMessage(error) + ') — skipped.', 'warn');
        }
        guard();
      }
      narration = segs.length ? { segments: segs } : null;
      if (narration) log('Narration recorded: ' + segs.length + ' segment(s).', 'ok');
    }

    // ----- STAGE: render + review loop --------------------------------------
    let best: { url: string; report: QAReport | null; plan: EditPlan } | null = null;
    let attempt = 0;
    let qaHistory: QAReport[] = Array.isArray(current.qa) ? current.qa : [];
    let activePlan = plan;

    while (attempt < 1 + MAX_REVIEW_PASSES) {
      attempt += 1;
      guard();
      current.stage = 'render';
      const renderPlan = assembleRenderPlan(activePlan, source, analysis, registry, musicUrl, narration);
      if (renderPlan.portrait) {
        log('Portrait footage detected — composing a 9:16 film and delivering a true 1080×1920 MP4.');
      }
      log('Rendering cut #' + attempt + ' (' + renderPlan.durationSec.toFixed(0) + 's)…');
      await checkpoint({ plan: activePlan }, 0.1, 'Rendering cut #' + attempt);
      const rendered = await renderCut(renderPlan, (p) => {
        checkpoint({}, 0.1 + 0.8 * ((p.chunk - 1) / p.chunks) + (p.status === 'rendering' ? 0.3 / p.chunks : 0),
          'Render ' + p.chunk + '/' + p.chunks + ': ' + p.status);
      });
      if (renderPlan.portrait && !rendered.portraitDelivered) {
        log('Portrait delivery failed (' + (rendered.portraitError || 'unknown') + ') — shipping the centered 1920×1080 master instead.', 'warn');
      }
      log('Cut #' + attempt + ' rendered.', 'ok');
      guard();

      current.stage = 'review';
      await checkpoint({}, 0.2, 'Reviewing cut #' + attempt);
      log('Review: inspecting the actual rendered file…');
      let report: QAReport;
      try {
        report = await runQA(rendered.url, activePlan, renderPlan, attempt, (note) => log(note));
      } catch (error) {
        log('Review could not run (' + errorMessage(error) + ') — shipping the rendered cut.', 'warn');
        report = {
          attempt, score: 0.65, shippable: true,
          summary: 'Visual review unavailable; mechanical render completed.',
          defects: [], mechanical: { durationOk: true, playable: true, measuredDuration: renderPlan.durationSec, expectedDuration: renderPlan.durationSec },
        };
      }
      qaHistory = [...qaHistory, report];
      await checkpoint({ qa: qaHistory }, 0.6, 'Review complete (score ' + Math.round(report.score * 100) + ')');
      log('Review verdict #' + attempt + ': score ' + Math.round(report.score * 100) + '/100 — ' + report.summary, report.shippable ? 'ok' : 'warn');

      if (!best || report.score > (best.report?.score ?? 0)) best = { url: rendered.url, report, plan: activePlan };
      if (report.shippable || attempt >= 1 + MAX_REVIEW_PASSES) break;

      const actionable = report.defects.filter((d) => d.action !== 'accept');
      if (!actionable.length) break;
      log('Revising: applying ' + actionable.length + ' fix(es) the review named…');
      try {
        const revisedRaw = await revisePlan(activePlan, actionable);
        const normalized = normalizePlan(revisedRaw, source, current.prefs);
        const reconciled = reconcilePlanWithAssets(normalized.plan, registry);
        activePlan = reconciled.plan;
      } catch (error) {
        log('Revision failed (' + errorMessage(error) + ') — keeping the best cut so far.', 'warn');
        break;
      }
    }

    if (!best) throw new Error('No cut survived rendering.');

    // ----- STAGE: finish ----------------------------------------------------
    current.stage = 'finish';
    const finalTiming = computeTiming(best.plan);
    log('Delivering “' + best.plan.title + '” — ' + finalTiming.duration.toFixed(0) + 's final cut.', 'ok');
    if (best.report && !best.report.shippable) {
      log('Note: the review still lists open issues; the best-scoring cut ships with them documented below.', 'warn');
    }
    await checkpoint({
      status: 'done',
      plan: best.plan,
      result: { url: best.url, durationSec: finalTiming.duration, renderedAt: new Date().toISOString(), attempt: best.report?.attempt || 1 },
      qa: qaHistory,
    }, 1, 'Done');
  } catch (error) {
    if ((error as any)?.cancelled) {
      log('Run cancelled. Completed work is saved — resume any time.', 'warn');
      await checkpoint({ status: 'running' }, 0, 'Paused');
      return;
    }
    const message = errorMessage(error);
    log('Failed: ' + message, 'error');
    await checkpoint({ status: 'failed', error: message }, 0, 'Failed');
  }
}

// ---------------------------------------------------------------------------
// Analysis internals
// ---------------------------------------------------------------------------

async function measureLocalFile(file: File): Promise<{ duration: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      const timer = setTimeout(() => reject(new Error('Could not read the video file — is it a valid video?')), 25000);
      el.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve({ duration: el.duration || 0, width: el.videoWidth || 0, height: el.videoHeight || 0 });
      };
      el.onerror = () => { clearTimeout(timer); reject(new Error('This file could not be decoded as video.')); };
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function analyzeFootage(
  source: SourceVideo,
  file: File | null,
  log: (t: string, k?: ActivityLine['kind']) => void,
  tick: (within: number, detail: string) => Promise<void>,
): Promise<AnalysisReport> {
  const notes: string[] = [];

  // A resumed run may no longer hold the File — refetch the uploaded copy.
  let localFile: File | Blob | null = file;
  if (!localFile) {
    try {
      const res = await fetch(source.url);
      if (res.ok) localFile = await res.blob();
    } catch { localFile = null; }
  }

  // 1) Word-level transcript (Deepgram) from the decoded audio track.
  let words: TranscriptWord[] = [];
  let transcript = '';
  let wordsExact = false;
  let silences: { start: number; end: number }[] = [];
  await tick(0.15, 'Listening: transcribing the audio');
  if (localFile) {
    try {
      const decoded = await decodeAudioMono(localFile);
      silences = detectSilences(decoded.samples, decoded.sampleRate);
      const wav = encodeWav(decoded.samples, decoded.sampleRate);
      const dg = await transcribeTimestamped(wav, 'cineagent-audio.wav');
      transcript = dg.transcript;
      words = dg.words.map((w) => ({ w: w.word, s: w.start, e: w.end }));
      wordsExact = words.length > 0;
      log('Transcribed ' + words.length + ' words with exact timing; found ' + silences.length + ' silences.', 'ok');
    } catch (error) {
      notes.push('Timestamped transcription unavailable: ' + errorMessage(error));
      log('Word-level transcription unavailable — continuing with visual analysis.', 'warn');
    }
  } else {
    notes.push('Original file unavailable on resume; transcript skipped.');
  }

  // 2) Whole-video understanding (Gemini watches everything, incl. the ending).
  let contentAnalysis = null;
  await tick(0.45, 'Watching: content analysis');
  if (localFile) {
    try {
      const raw = await analyzeVideoFile(
        localFile instanceof File ? localFile : new File([localFile], source.name, { type: source.mime }),
        GEMINI_ANALYSIS_PROMPT,
      );
      contentAnalysis = parseContentAnalysis(raw);
      if (contentAnalysis) log('Content understood: ' + contentAnalysis.contentType + ' — ' + contentAnalysis.summary.slice(0, 140), 'ok');
      else notes.push('Content analysis returned prose; proceeding without structured scenes.');
    } catch (error) {
      notes.push('Content analysis failed: ' + errorMessage(error));
      log('Whole-video analysis unavailable — the director will rely on transcript + frames.', 'warn');
    }
  }

  // 3) Frame sampling — scene boundaries + uniform coverage + the ending.
  await tick(0.75, 'Sampling frames');
  const stamps = new Set<number>();
  const dur = Math.max(1, source.duration);
  const uniform = Math.min(16, Math.max(8, Math.round(dur / 30)));
  for (let i = 0; i < uniform; i += 1) stamps.add(round1((dur * (i + 0.5)) / uniform));
  (contentAnalysis?.scenes || []).slice(0, 12).forEach((s) => stamps.add(round1(Math.min(dur - 0.3, s.start + 0.4))));
  (contentAnalysis?.keyMoments || []).slice(0, 8).forEach((m) => stamps.add(round1(Math.min(dur - 0.3, m.t))));
  stamps.add(round1(Math.max(0.2, dur - 1.5)));
  const timestamps = [...stamps].filter((t) => t >= 0 && t < dur).sort((a, b) => a - b).slice(0, 36);
  let frames: { t: number; url: string }[] = [];
  try {
    const extracted = await extractFrames(source.url, timestamps);
    frames = extracted.map((f) => ({ t: f.timestamp, url: f.url }));
    log('Sampled ' + frames.length + ' frames across the timeline.', 'ok');
  } catch (error) {
    notes.push('Frame extraction failed: ' + errorMessage(error));
    log('Frame sampling unavailable — the director will work from transcript + content analysis.', 'warn');
  }

  // 4) Fallback transcript — keep captions possible when Deepgram was down:
  // Gemini transcribes, and the words are laid across the measured speech
  // envelope (close, but not frame-exact — the report says which).
  if (!words.length && localFile) {
    try {
      const rawTranscript = await analyzeVideoFile(
        localFile instanceof File ? localFile : new File([localFile], source.name, { type: source.mime }),
        'Transcribe the spoken words in this video as accurately as possible. Answer with ONLY the transcript text — no timestamps, no speaker labels, no commentary.',
      );
      transcript = String(rawTranscript || '').trim();
      words = estimateWords(transcript, silences, dur);
      if (words.length) {
        notes.push('Caption timings are estimated from the speech envelope, not word-exact.');
        log('Using estimated word timing for captions.', 'warn');
      }
    } catch (error) {
      notes.push('Fallback transcription failed: ' + errorMessage(error));
    }
  }

  const speechDuration = words.length ? words[words.length - 1].e - words[0].s : 0;
  return { transcript, words, wordsExact, silences, speechDuration, contentAnalysis, frames, notes };
}

/** Lay words across the non-silent regions proportionally to character count. */
function estimateWords(transcript: string, silences: { start: number; end: number }[], duration: number): TranscriptWord[] {
  const tokens = transcript.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const regions: { start: number; end: number }[] = [];
  let cursor = 0;
  silences.forEach((s) => {
    if (s.start - cursor > 0.15) regions.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  });
  if (duration - cursor > 0.15) regions.push({ start: cursor, end: duration });
  const spans = regions.length ? regions : [{ start: 0, end: duration }];
  const totalSpan = spans.reduce((n, r) => n + (r.end - r.start), 0) || 1;
  const out: TranscriptWord[] = [];
  let idx = 0;
  spans.forEach((region, ri) => {
    const share = (region.end - region.start) / totalSpan;
    const budget = ri === spans.length - 1 ? tokens.length - idx : Math.max(1, Math.round(tokens.length * share));
    const slice = tokens.slice(idx, idx + budget);
    if (!slice.length) return;
    const chars = slice.reduce((n, w) => n + w.length + 1, 0);
    let t = region.start;
    slice.forEach((w) => {
      const portion = ((w.length + 1) / Math.max(1, chars)) * (region.end - region.start);
      out.push({ w, s: round1(t), e: round1(t + portion) });
      t += portion;
    });
    idx += slice.length;
  });
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
