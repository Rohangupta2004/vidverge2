/**
 * SCREEN 4 — THE VIDEO.
 *
 * The script writes itself from the previous screen's advantages and gaps, and
 * is then fully editable — including the per-scene camera prompts, because the
 * narration and the footage are two different crafts and a founder usually wants
 * to change one without the other.
 *
 * TWO RENDERS, NOT ONE. Veo films the footage (eight seconds per scene, chained
 * so each clip continues the last, auto-stitched) and Remotion then lays the
 * graphics over the finished cut: brand lower third, the three differentiators,
 * one stat, closing CTA. The video model is explicitly told NOT to draw text,
 * because a model-drawn caption is unreliable and uneditable, whereas a Remotion
 * overlay is exact and re-renderable.
 *
 * Both renders spend the workspace wallet, so the cost is stated before the
 * button and the job ids are written to the saved comparison the moment they
 * exist — a reload adopts a render in flight instead of paying for it twice.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard, Download, Film, Image as ImageIcon, RefreshCw, Target, Upload, Wand2, X,
} from 'lucide-react';
import { uploadFile } from '../api';
import {
  Analysis, Competitor, Insights, Matrix, Profile, Scene, ScriptPlan, VideoJob,
  finishVideo, pollFinish, pollVideo, startVideo, writeScript,
} from '../store';
import { CARD_HI, INK_DEEP, LINE, LINE_HI, MONO, TEXT, TEXT_DIM, TEXT_MUTED, rgba } from '../theme';
import { Button, Field, LogStream, Meter, Notice, Panel, Pill, SectionTitle, Spinner, Stat, useAccent } from '../ui';

interface Props {
  analysis: Analysis;
  brand: Profile;
  competitors: Competitor[];
  insights: Insights | null;
  matrix: Matrix | null;
  onPatch: (patch: Partial<Analysis>) => void;
  onUseInAdsStudio: () => void;
}

const MODELS = [
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', blurb: 'Quicker and cheaper per clip. The sensible default.' },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1', blurb: 'Slower and dearer, with the most cinematic footage.' },
];

function ImageSlot({
  label, hint, url, busy, onPick, onClear,
}: {
  label: string;
  hint: string;
  url: string;
  busy: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const accent = useAccent();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 7 }}>{label}</div>
      {url ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 10, borderRadius: 13,
          background: INK_DEEP, border: `1px solid ${rgba(accent, 0.3)}`,
        }}>
          <img src={url} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 9, background: '#000' }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT_DIM, lineHeight: 1.5 }}>
            Used as the opening frame so the footage stays on-subject.
          </div>
          <Button small variant="quiet" onClick={onClear} title="Remove"><X size={13} /></Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 15px', borderRadius: 13, cursor: 'pointer',
            background: 'transparent', border: `1px dashed ${LINE_HI}`,
            color: TEXT_MUTED, fontSize: 12.6, fontFamily: 'inherit', textAlign: 'left',
          }}
        >
          {busy ? <Spinner size={14} /> : <Upload size={15} />}
          {busy ? 'Uploading\u2026' : hint}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = (e.target.files || [])[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

export default function VideoScreen({
  analysis, brand, competitors, insights, matrix, onPatch, onUseInAdsStudio,
}: Props) {
  const accent = useAccent();
  const plan = analysis.scriptPlan;
  const job = analysis.videoJob || {};

  const [writing, setWriting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState<'character' | 'mockup' | ''>('');
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [model, setModel] = useState(job.model || MODELS[0].id);
  const liveJob = useRef<VideoJob>(job);

  useEffect(() => { liveJob.current = analysis.videoJob || {}; }, [analysis.videoJob]);

  const write = useCallback(async () => {
    if (!insights) { setError('The positioning analysis has to finish before a script can be written from it.'); return; }
    setWriting(true);
    setError('');
    setLog(['Reading your advantages and the unclaimed positioning\u2026', 'Writing a 30 to 45 second script and its shot list\u2026']);
    try {
      const next = await writeScript(brand, competitors, insights, matrix);
      onPatch({ scriptPlan: next, script: next.script, status: 'scripted' });
      setLog([]);
    } catch (e: any) {
      setError(String(e?.message || e));
      setLog([]);
    } finally {
      setWriting(false);
    }
  }, [brand, competitors, insights, matrix, onPatch]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current || plan) return;
    started.current = true;
    write();
  }, [plan, write]);

  const patchPlan = (next: Partial<ScriptPlan>) => {
    if (!plan) return;
    const merged = { ...plan, ...next };
    onPatch({ scriptPlan: merged, script: merged.script });
  };

  const patchScene = (index: number, next: Partial<Scene>) => {
    if (!plan) return;
    const scenes = plan.scenes.map((scene, i) => (i === index ? { ...scene, ...next } : scene));
    patchPlan({ scenes });
  };

  const pick = async (slot: 'character' | 'mockup', file: File) => {
    setUploading(slot);
    setError('');
    try {
      const url = await uploadFile(file, 'vergeye');
      onPatch(slot === 'character' ? { characterUrl: url } : { mockupUrl: url });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setUploading('');
    }
  };

  /** Veo first, then Remotion. Each id is stored before its poll loop begins. */
  const render = async () => {
    if (!plan) return;
    setRendering(true);
    setError('');
    const lines: string[] = [];
    const say = (line: string) => { lines.push(line); setLog(lines.slice()); };

    try {
      say(`Sending ${plan.scenes.length} scenes to the video model\u2026`);
      const submitted = await startVideo(plan, {
        model,
        characterUrl: analysis.characterUrl,
        mockupUrl: analysis.mockupUrl,
      });
      const base: VideoJob = { veoJobId: submitted.jobId, veoStatus: 'processing', model: submitted.model, clips: submitted.clips };
      liveJob.current = base;
      onPatch({ videoJob: base, status: 'rendering' });
      say(`Accepted. ${submitted.clips} clips are filming; each one takes a couple of minutes.`);

      let stitched = '';
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((r) => setTimeout(r, 10000));
        const state = await pollVideo(submitted.jobId);
        const progressed: VideoJob = { ...liveJob.current, veoStatus: state.status, veoProgress: state.progress };
        liveJob.current = progressed;
        onPatch({ videoJob: progressed });
        if (state.status === 'completed' || state.status === 'partial') {
          stitched = state.videoUrl;
          say(state.status === 'partial'
            ? 'The clips rendered but stitching fell back to the first one.'
            : 'All clips rendered and stitched.');
          break;
        }
        if (state.status === 'failed') throw new Error(state.error || 'A clip could not be generated.');
        if (attempt % 3 === 0) say(`Filming\u2026 ${Math.round(state.progress)}% done.`);
      }
      if (!stitched) throw new Error('The footage did not finish in time. Its job id is saved, so Resume adopts it.');

      onPatch({ rawVideoUrl: stitched });
      say('Adding your lower thirds, the stat and the closing card\u2026');

      const finish = await finishVideo({
        videoUrl: stitched,
        durationSec: plan.durationSec || plan.scenes.length * 8,
        accent,
        brandName: brand.name,
        tagline: brand.tagline,
        overlay: plan.overlay,
        logoUrl: brand.logoUrl || '',
        mockupUrl: analysis.mockupUrl,
      });
      const withFinish: VideoJob = { ...liveJob.current, remotionOperationId: finish.operationId, remotionStatus: 'rendering' };
      liveJob.current = withFinish;
      onPatch({ videoJob: withFinish });

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((r) => setTimeout(r, 8000));
        const state = await pollFinish(finish.operationId);
        if (state.status === 'complete' && state.videoUrl) {
          onPatch({
            videoUrl: state.videoUrl,
            status: 'video',
            videoJob: { ...liveJob.current, remotionStatus: 'complete' },
          });
          say('Finished. Your video is ready.');
          return;
        }
        if (state.status === 'failed') throw new Error(state.error || 'The finishing render failed.');
      }
      throw new Error('The finishing render is still going. Reopen this comparison and press Resume to pick it up.');
    } catch (e: any) {
      const message = String(e?.message || e);
      setError(message);
      onPatch({ videoJob: { ...liveJob.current, error: message }, status: 'failed' });
    } finally {
      setRendering(false);
    }
  };

  /** Adopt a render that was already paid for when the screen is reopened. */
  const resume = async () => {
    setRendering(true);
    setError('');
    const lines: string[] = [];
    const say = (line: string) => { lines.push(line); setLog(lines.slice()); };
    try {
      if (job.remotionOperationId && job.remotionStatus !== 'complete') {
        say('Picking the finishing render back up\u2026');
        for (let attempt = 0; attempt < 90; attempt += 1) {
          const state = await pollFinish(job.remotionOperationId);
          if (state.status === 'complete' && state.videoUrl) {
            onPatch({ videoUrl: state.videoUrl, status: 'video', videoJob: { ...job, remotionStatus: 'complete' } });
            say('Finished.');
            return;
          }
          if (state.status === 'failed') throw new Error(state.error || 'The finishing render failed.');
          await new Promise((r) => setTimeout(r, 8000));
        }
        throw new Error('That render is still going. Try Resume again shortly.');
      }
      if (job.veoJobId) {
        say('Picking the footage back up\u2026');
        const state = await pollVideo(job.veoJobId);
        if (state.videoUrl) {
          onPatch({ rawVideoUrl: state.videoUrl, videoJob: { ...job, veoStatus: state.status } });
          say('Footage recovered. Press Add the graphics to finish it.');
          return;
        }
        onPatch({ videoJob: { ...job, veoStatus: state.status, veoProgress: state.progress } });
        say(`Still filming — ${Math.round(state.progress)}% done.`);
        return;
      }
      say('There is no render in flight to pick up.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setRendering(false);
    }
  };

  /** The footage exists but the overlay pass did not run or failed. */
  const finishOnly = async () => {
    if (!plan || !analysis.rawVideoUrl) return;
    setRendering(true);
    setError('');
    const lines: string[] = ['Adding your lower thirds, the stat and the closing card\u2026'];
    setLog(lines.slice());
    try {
      const finish = await finishVideo({
        videoUrl: analysis.rawVideoUrl,
        durationSec: plan.durationSec || plan.scenes.length * 8,
        accent,
        brandName: brand.name,
        tagline: brand.tagline,
        overlay: plan.overlay,
        logoUrl: brand.logoUrl || '',
        mockupUrl: analysis.mockupUrl,
      });
      onPatch({ videoJob: { ...liveJob.current, remotionOperationId: finish.operationId, remotionStatus: 'rendering' } });
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((r) => setTimeout(r, 8000));
        const state = await pollFinish(finish.operationId);
        if (state.status === 'complete' && state.videoUrl) {
          onPatch({ videoUrl: state.videoUrl, status: 'video', videoJob: { ...liveJob.current, remotionStatus: 'complete' } });
          lines.push('Finished. Your video is ready.');
          setLog(lines.slice());
          return;
        }
        if (state.status === 'failed') throw new Error(state.error || 'The finishing render failed.');
      }
      throw new Error('The finishing render is still going. Press Resume shortly.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setRendering(false);
    }
  };

  const words = (plan?.script || '').trim().split(/\s+/).filter(Boolean).length;
  const canResume = !!(job.veoJobId || job.remotionOperationId) && !analysis.videoUrl;

  if (!plan) {
    return (
      <div className="vergeye-rise">
        <SectionTitle hint="Written from your unique advantages and the positioning nobody in your set has claimed.">Your positioning video</SectionTitle>
        {error ? (
          <>
            <Notice tone="bad">{error}</Notice>
            <Button variant="primary" busy={writing} onClick={write}><RefreshCw size={14} /> Write the script</Button>
          </>
        ) : (
          <Panel style={{ padding: '54px 32px', textAlign: 'center' }}>
            <div style={{ color: accent, display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Spinner size={26} /></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Writing your script</div>
            <LogStream lines={log} busy />
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="vergeye-rise">
      <SectionTitle
        hint="Edit the narration and the shots before anything renders. Each scene is eight seconds of footage, filmed in order so one clip continues the last."
        right={(
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <Button busy={writing} disabled={rendering} onClick={write}><Wand2 size={14} /> Rewrite script</Button>
            {canResume ? <Button busy={rendering} onClick={resume}><RefreshCw size={14} /> Resume render</Button> : null}
            {!analysis.videoUrl && analysis.rawVideoUrl ? (
              <Button busy={rendering} onClick={finishOnly}><Film size={14} /> Add the graphics</Button>
            ) : null}
            <Button variant="primary" busy={rendering} disabled={writing} onClick={render}>
              <Clapperboard size={15} /> {analysis.videoUrl ? 'Render again' : 'Generate video'}
            </Button>
          </div>
        )}
      >
        Your positioning video
      </SectionTitle>

      {error ? <Notice tone="bad">{error}</Notice> : null}

      {analysis.videoUrl ? (
        <Panel style={{ padding: 18, marginBottom: 18, border: `1px solid ${rgba(accent, 0.34)}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Pill tone="good">Ready</Pill>
            <div style={{ fontSize: 12.6, color: TEXT_DIM }}>
              {plan.durationSec}s · 1920×1080 · graphics applied
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <a href={analysis.videoUrl} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                <Button variant="primary"><Download size={14} /> Download video</Button>
              </a>
              <Button onClick={onUseInAdsStudio}><Target size={14} /> Use in Ads Studio</Button>
            </div>
          </div>
          <video
            src={analysis.videoUrl}
            controls
            playsInline
            style={{ width: '100%', borderRadius: 13, background: '#000', display: 'block', maxHeight: 460 }}
          />
          {analysis.handoff?.app ? (
            <div style={{ marginTop: 12, fontSize: 11.8, color: TEXT_MUTED }}>
              Script already sent to {analysis.handoff.app}.
            </div>
          ) : null}
        </Panel>
      ) : null}

      {rendering || log.length > 0 ? (
        <Panel style={{ padding: 18, marginBottom: 18 }}>
          {typeof job.veoProgress === 'number' && job.veoStatus !== 'completed' ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.6, color: TEXT_MUTED, marginBottom: 7, fontFamily: MONO }}>
                <span>{job.veoStatus || 'processing'}</span>
                <span>{Math.round(job.veoProgress)}%</span>
              </div>
              <Meter percent={job.veoProgress} />
            </div>
          ) : null}
          <LogStream lines={log} busy={rendering} />
        </Panel>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 316px', gap: 18, alignItems: 'start' }} className="vergeye-two-col">
        <div>
          <Panel style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO }}>
                Narration
              </div>
              <div style={{ fontSize: 11.4, color: words >= 70 && words <= 125 ? accent : TEXT_MUTED, fontFamily: MONO }}>
                {words} words · {plan.durationSec}s
              </div>
            </div>
            <Field
              value={plan.script}
              rows={6}
              onChange={(script) => patchPlan({ script })}
              hint="Around 75 to 115 words reads naturally in 30 to 45 seconds."
            />

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 18 }}>
              <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO, marginBottom: 12 }}>
                Shot list · {plan.scenes.length} scenes
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {plan.scenes.map((scene, index) => (
                  <div key={index} style={{ background: INK_DEEP, border: `1px solid ${LINE}`, borderRadius: 13, padding: 15 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: rgba(accent, 0.16), color: accent,
                        fontSize: 10.5, fontWeight: 800, fontFamily: MONO,
                      }}>
                        {index + 1}
                      </span>
                      <span style={{ fontSize: 12.8, fontWeight: 700, color: TEXT }}>{scene.beat}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10.6, color: TEXT_MUTED, fontFamily: MONO }}>8s</span>
                    </div>
                    <Field
                      label="Spoken over this scene"
                      value={scene.narration}
                      rows={2}
                      onChange={(narration) => patchScene(index, { narration })}
                    />
                    <Field
                      label="What the camera sees"
                      value={scene.prompt}
                      rows={3}
                      mono
                      onChange={(prompt) => patchScene(index, { prompt })}
                      hint={index === 0 ? 'No on-screen text here — graphics are added afterwards so they stay editable.' : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div>
          <Panel style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO, marginBottom: 14 }}>
              Graphics Remotion adds
            </div>
            <Field label="Headline" value={plan.overlay.headline} onChange={(headline) => patchPlan({ overlay: { ...plan.overlay, headline } })} />
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10 }}>
              <Field label="Stat" value={plan.overlay.stat} onChange={(stat) => patchPlan({ overlay: { ...plan.overlay, stat } })} />
              <Field label="Stat label" value={plan.overlay.statLabel} onChange={(statLabel) => patchPlan({ overlay: { ...plan.overlay, statLabel } })} />
            </div>
            {[0, 1, 2].map((slot) => (
              <Field
                key={slot}
                label={`Lower third ${slot + 1}`}
                value={plan.overlay.lowerThirds[slot] || ''}
                onChange={(line) => {
                  const next = plan.overlay.lowerThirds.slice();
                  next[slot] = line;
                  patchPlan({ overlay: { ...plan.overlay, lowerThirds: next } });
                }}
              />
            ))}
            <Field label="Closing call to action" value={plan.overlay.cta} onChange={(cta) => patchPlan({ overlay: { ...plan.overlay, cta } })} />
          </Panel>

          <Panel style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO, marginBottom: 14 }}>
              Optional footage anchors
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <ImageSlot
                label="Character photo"
                hint="Upload a presenter photo"
                url={analysis.characterUrl}
                busy={uploading === 'character'}
                onPick={(file) => pick('character', file)}
                onClear={() => onPatch({ characterUrl: '' })}
              />
              <ImageSlot
                label="Product mockup"
                hint="Upload a product shot"
                url={analysis.mockupUrl}
                busy={uploading === 'mockup'}
                onPick={(file) => pick('mockup', file)}
                onClear={() => onPatch({ mockupUrl: '' })}
              />
            </div>
            <div style={{ fontSize: 11.6, color: TEXT_MUTED, marginTop: 12, lineHeight: 1.55 }}>
              Whichever you upload becomes the first frame, so the footage keeps the same subject throughout. The mockup also
              appears on the closing card.
            </div>
          </Panel>

          <Panel style={{ padding: 20 }}>
            <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO, marginBottom: 14 }}>
              Render
            </div>
            <div style={{ display: 'grid', gap: 9, marginBottom: 16 }}>
              {MODELS.map((option) => {
                const on = model === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setModel(option.id)}
                    style={{
                      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      padding: '12px 14px', borderRadius: 12,
                      background: on ? rgba(accent, 0.12) : CARD_HI,
                      border: `1px solid ${on ? rgba(accent, 0.4) : LINE}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? accent : TEXT }}>{option.label}</div>
                    <div style={{ fontSize: 11.6, color: TEXT_MUTED, marginTop: 3, lineHeight: 1.5 }}>{option.blurb}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
              <Stat label="Clips" value={plan.scenes.length} tone="accent" />
              <Stat label="Length" value={`${plan.durationSec}s`} />
            </div>
            <Notice tone="warn">
              Both passes spend the workspace wallet — {plan.scenes.length} video clips plus one finishing render. Nothing is
              charged until you press Generate video.
            </Notice>
            <Button variant="primary" full busy={rendering} disabled={writing} onClick={render}>
              <Clapperboard size={15} /> {analysis.videoUrl ? 'Render again' : 'Generate video'}
            </Button>
            {analysis.rawVideoUrl && !analysis.videoUrl ? (
              <div style={{ marginTop: 12, fontSize: 11.6, color: TEXT_MUTED, lineHeight: 1.55, display: 'flex', gap: 7 }}>
                <ImageIcon size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                The footage is already rendered and paid for. Add the graphics finishes it without filming again.
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
