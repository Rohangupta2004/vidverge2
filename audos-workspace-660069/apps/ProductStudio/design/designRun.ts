/**
 * DESIGN WITH AI — the run orchestrator.
 *
 * Drives the agentic pipeline stage by stage, persisting every result to the
 * design_projects row the moment it lands so a reload RESUMES instead of
 * restarting:
 *
 *   planning   — talking-head detection (Opus vision on sampled frames) +
 *                brand context + the per-timestamp visual plan
 *   generating — build every overlay graphic once to verify it renders
 *   syncing    — deterministic transcript alignment + overlap resolution
 *   checking   — agentic quality loop: composite frames → Opus inspection →
 *                fix ONLY the flagged graphics → re-verify
 *   ready
 *
 * The original video is never modified. Each stage is skipped when its
 * output already exists (resume), and the whole run is re-enterable.
 */

import {
  DesignGraphic, DesignProject, QaReport, designDb, designFrameSize, paletteFromBrand,
} from './api';
import { snapToTranscript } from './transcript';
import {
  buildVisualPlan, detectTalkingHead, qualityCheck, readBrand, regenerateGraphic,
} from './designDirector';
import { captureCompositeFrames, prepareOverlays, sampleVideoFrames } from './designExport';
import { pollVeo, submitVeo } from '../../ScriptToVideo/pipeline/veo';

export interface DesignRunHooks {
  onProject: (patch: Partial<DesignProject>) => void;
  onNote: (text: string) => void;
}

async function save(p: DesignProject, hooks: DesignRunHooks, patch: Partial<DesignProject>): Promise<DesignProject> {
  await designDb.update(p.id, patch);
  hooks.onProject(patch);
  return { ...p, ...patch } as DesignProject;
}

// ---------------------------------------------------------------------------
// Deterministic overlap resolution (sync stage)
// ---------------------------------------------------------------------------

export function resolveOverlaps(graphics: DesignGraphic[], videoDuration: number): DesignGraphic[] {
  const sorted = [...graphics].sort((a, b) => a.start - b.start);
  const out: DesignGraphic[] = [];
  for (const g of sorted) {
    const next = { ...g };
    // A lower_third may overlap ONE other graphic; everything else is exclusive.
    const clashes = out.filter((o) =>
      o.enabled && next.enabled
      && !(o.position === 'lower_third' || next.position === 'lower_third')
      && next.start < o.end && o.start < next.end);
    for (const prev of clashes) {
      if (prev.end - 0.15 - prev.start >= 1.6 && next.start > prev.start + 1.2) {
        prev.end = Math.round((next.start - 0.15) * 100) / 100; // trim the earlier one
      } else {
        next.start = Math.round((prev.end + 0.15) * 100) / 100; // push this one later
        next.end = Math.max(next.end, next.start + 2);
      }
    }
    next.start = Math.max(0, Math.min(next.start, Math.max(0, videoDuration - 1.4)));
    next.end = Math.min(videoDuration, Math.max(next.end, next.start + 1.2));
    out.push(next);
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Omni footage cutaways (use_omni cues — real video, generated once per cue)
// ---------------------------------------------------------------------------

/** Generate the missing Omni footage clips (broll cues). One at a time, each
 * persisted the moment it lands; a failed cue is disabled with its reason and
 * never sinks the run — it stays regenerable from the editor. */
async function generateOmniClips(project: DesignProject, hooks: DesignRunHooks): Promise<DesignProject> {
  let p = { ...project };
  const targets = (p.graphics || []).filter((g) => g.enabled && g.use_omni && !g.clip_url);
  if (!targets.length) return p;
  const aspect = (Number(p.video_w) || 16) >= (Number(p.video_h) || 9) ? '16:9' : '9:16';
  hooks.onNote(`Generating ${targets.length} real-footage cutaway(s) — only the moments that genuinely need actual video…`);
  for (const g of targets) {
    const prompt = String(g.omni_prompt || g.visual_concept || g.narration_ref || '').trim();
    try {
      if (!prompt) throw new Error('The cue has no footage prompt.');
      const { operationId } = await submitVeo({ prompt, aspect, durationS: Math.min(8, Math.max(4, g.end - g.start)) });
      const url = await pollVeo(operationId);
      const graphics = (p.graphics || []).map((x) => (x.id === g.id ? { ...x, clip_url: url, clip_error: null } : x));
      p = await save(p, hooks, { graphics });
      hooks.onNote(`Footage ready for “${(g.visual_concept || g.narration_ref || 'cutaway').slice(0, 60)}”.`);
    } catch (e: any) {
      const message = String(e?.message || e).slice(0, 240);
      const graphics = (p.graphics || []).map((x) => (x.id === g.id ? { ...x, enabled: false, clip_error: message } : x));
      p = await save(p, hooks, { graphics });
      hooks.onNote(`The footage for “${(g.visual_concept || g.narration_ref || 'a cutaway').slice(0, 60)}” failed (${message}) — that cue is disabled; regenerate it from the editor.`);
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runDesign(project: DesignProject, hooks: DesignRunHooks, directive?: string | null): Promise<void> {
  let p = { ...project };
  const say = hooks.onNote;
  if (!p.video_url) throw new Error('This project has no uploaded video.');
  if (!p.transcript || !p.transcript.segments?.length) throw new Error('This project has no transcript yet — generate or import one first.');
  const duration = Number(p.video_duration_s) || Math.max(...p.transcript.segments.map((s) => s.end), 10);

  try {
    // ---------------- planning: head + brand + visual plan ----------------
    const needPlan = directive != null || !p.plan || !(p.graphics || []).length;
    if (needPlan) {
      p = await save(p, hooks, { status: 'planning', stage_note: 'Generating Visual Plan…', error: null });

      if (!p.head) {
        say('Studying the footage to find the talking head…');
        try {
          const frames = await sampleVideoFrames(p.video_url, duration, 3);
          const head = await detectTalkingHead(frames);
          p = await save(p, hooks, { head });
          say(`Talking head: ${head.position}${head.notes ? ` — ${head.notes}` : ''}`);
        } catch (e: any) {
          say(`Head detection skipped (${String(e?.message || e).slice(0, 100)}) — using safe defaults.`);
          p = await save(p, hooks, { head: { position: 'right', box: null, confidence: 0, notes: 'default' } });
        }
      }

      if (!p.brand && p.product_url) {
        const { brand, screenshotUrl } = await readBrand(p.product_url, say);
        const assets = [...(p.assets || [])];
        if (screenshotUrl && !assets.some((a) => a.url === screenshotUrl)) assets.push({ url: screenshotUrl, shows: 'Product website screenshot (mobile capture)' });
        if (brand) p = await save(p, hooks, { brand, assets });
        else if (assets.length !== (p.assets || []).length) p = await save(p, hooks, { assets });
      }

      say(directive ? `Redesigning the visual plan — ${directive}` : 'The visual director is reading the transcript and designing per-timestamp graphics…');
      const { plan, graphics } = await buildVisualPlan({
        segments: p.transcript.segments,
        videoDuration: duration,
        brand: p.brand,
        head: p.head,
        style: p.style || 'auto_brand',
        density: p.density || 'balanced',
        layoutPref: p.layout_pref || 'auto',
        assets: p.assets || [],
        directive: directive || null,
        keepGraphics: directive ? p.graphics : null,
      });
      p = await save(p, hooks, { plan, graphics });
      say(`Visual plan ready — ${graphics.length} graphics across ${Math.round(duration)}s.`);
    }

    // ---------------- generating: verify every graphic builds ----------------
    p = await save(p, hooks, { status: 'generating', stage_note: 'Creating Graphics…' });
    {
      // Real-footage cutaways first (only cues the director marked use_omni).
      p = await generateOmniClips(p, hooks);
      const { W, H } = designFrameSize(p);
      const palette = p.plan?.palette || paletteFromBrand(p.brand);
      const built = await prepareOverlays(p.graphics || [], W, H, palette, p.head);
      const broken = (p.graphics || []).filter((g) => g.enabled && !g.use_omni && !built.some((b) => b.g.id === g.id));
      if (broken.length) {
        say(`${broken.length} graphic(s) could not be built and were disabled.`);
        const graphics = (p.graphics || []).map((g) => broken.some((b) => b.id === g.id) ? { ...g, enabled: false } : g);
        p = await save(p, hooks, { graphics });
      }
      built.forEach((b) => { try { b.built.timeline.kill(); } catch { /* released */ } });
      say(`${built.length} motion graphics created (GSAP + SVG overlays).`);
    }

    // ---------------- syncing: transcript alignment + overlaps ----------------
    p = await save(p, hooks, { status: 'syncing', stage_note: 'Syncing to Transcript…' });
    {
      const snapped = (p.graphics || []).map((g) => {
        const { start, end } = snapToTranscript(g.start, g.end, g.narration_ref, p.transcript!, duration);
        return { ...g, start, end };
      });
      const resolved = resolveOverlaps(snapped, duration);
      p = await save(p, hooks, { graphics: resolved });
      say('Every graphic is aligned to the exact words it supports.');
    }

    // ---------------- checking: agentic quality loop ----------------
    p = await save(p, hooks, { status: 'checking', stage_note: 'Quality Check…' });
    {
      const palette = p.plan?.palette || paletteFromBrand(p.brand);
      say('Compositing preview frames for inspection…');
      let frames: Awaited<ReturnType<typeof captureCompositeFrames>> = [];
      try { frames = await captureCompositeFrames(p, p.graphics || [], p.head, palette, null, 4); }
      catch (e: any) { say(`Frame capture unavailable (${String(e?.message || e).slice(0, 100)}) — the design ships on trust.`); }

      const verdict = await qualityCheck(frames, p.plan, p.head);
      say(verdict.summary || (verdict.pass ? 'Quality check passed.' : `Quality check flagged ${verdict.issues.length} graphic(s).`));

      const issues = [...verdict.issues];
      if (issues.length) {
        let graphics = [...(p.graphics || [])];
        for (const issue of issues) {
          const idx = graphics.findIndex((g) => g.id === issue.graphic_id);
          if (idx < 0) continue;
          say(`Fixing “${graphics[idx].visual_concept || graphics[idx].treatment}” — ${issue.issue}`);
          try {
            const fixed = await regenerateGraphic(graphics[idx], {
              plan: p.plan, head: p.head, brand: p.brand, assets: p.assets || [],
              videoDuration: duration, segments: p.transcript!.segments,
            }, issue.fix_hint || issue.issue);
            graphics[idx] = fixed;
            issue.fixed = true;
          } catch (e: any) {
            say(`The fix for that graphic failed (${String(e?.message || e).slice(0, 100)}) — it ships as-is; you can regenerate it from the timeline.`);
          }
        }
        graphics = resolveOverlaps(graphics, duration);
        p = await save(p, hooks, { graphics });
        // A fixed cue may have become (or stayed) a footage cutaway — the
        // redesign cleared its clip, so generate whatever is missing now.
        p = await generateOmniClips(p, hooks);
      }

      const qa: QaReport = { pass: verdict.pass || issues.every((i) => i.fixed), checked_at: new Date().toISOString(), issues, summary: verdict.summary };
      p = await save(p, hooks, { qa });
    }

    p = await save(p, hooks, { status: 'ready', stage_note: 'Preview Ready — open the timeline to edit any graphic.' });
    say('Preview ready.');
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 500);
    await designDb.update(p.id, { status: 'error', error: message }).catch(() => undefined);
    hooks.onProject({ status: 'error', error: message });
    throw e;
  }
}

/** Standalone quality re-check from the editor (no regeneration round). */
export async function recheckQuality(project: DesignProject, hooks: DesignRunHooks): Promise<QaReport> {
  const palette = project.plan?.palette || paletteFromBrand(project.brand);
  hooks.onNote('Compositing fresh frames for inspection…');
  const frames = await captureCompositeFrames(project, project.graphics || [], project.head, palette, null, 4);
  const verdict = await qualityCheck(frames, project.plan, project.head);
  const qa: QaReport = { pass: verdict.pass, checked_at: new Date().toISOString(), issues: verdict.issues, summary: verdict.summary };
  await designDb.update(project.id, { qa });
  hooks.onProject({ qa });
  hooks.onNote(verdict.summary || (verdict.pass ? 'Quality check passed.' : `Flagged ${verdict.issues.length} graphic(s).`));
  return qa;
}
