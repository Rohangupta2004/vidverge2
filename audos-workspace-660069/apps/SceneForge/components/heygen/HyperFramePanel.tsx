// Motion graphics: HyperFrames overlays, one card at a time.
//
// Each card is an independent render of an uploaded HTML/CSS/JS bundle with
// its variables injected (lib/hyperFrameBundles + lib/heygenFrames). The zip
// is uploaded ONCE per template and reused for every card after that, so the
// tenth card costs exactly what the first did.
//
// A rendered overlay is an asset like any other, so it can be attached back
// into a later generation to build a fully composed scene — which is what the
// "Use in my next video" action does.
import { useEffect, useState } from 'react';
import { Clapperboard, Download, Plus, Sparkles } from 'lucide-react';
import { describeError } from '../../lib/heygenApi';
import { prewarmTemplates, renderFrame } from '../../lib/heygenFrames';
import { FRAME_TEMPLATES, emptyFrameVariables, frameTemplate } from '../../lib/hyperFrameBundles';
import { useHeyGenSession } from '../../lib/heygenSession';
import type { BrandKit, CardTemplateId } from '../../lib/motionEditor';
import { localJobId, recordJob, finishJob } from '../../lib/sfJobs';
import { Button, CapabilityNote, Field, Notice, Panel, Progress, Segmented } from './ui';

export interface RenderedFrame {
  id: string;
  template: CardTemplateId;
  label: string;
  clipUrl: string;
}

/** The brand the cards are drawn in: the locked HeyGen kit, else the studio's. */
function kitFromSession(primary: string, accent: string, logoUrl: string): BrandKit {
  return {
    name: 'SceneForge',
    logoUrl,
    primary: primary || '#f59e0b',
    accent: accent || '#d97706',
    contrast: '#0b1022',
    textColor: '#ffffff',
    font: 'Inter, system-ui, sans-serif',
  };
}

export default function HyperFramePanel({ step, onRendered }: { step: number; onRendered?: (frame: RenderedFrame) => void }) {
  const session = useHeyGenSession();
  const [template, setTemplate] = useState<CardTemplateId>('feature-card');
  const [variables, setVariables] = useState<Record<string, string>>(() => emptyFrameVariables('feature-card'));
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [frames, setFrames] = useState<RenderedFrame[]>([]);

  // Every template's zip is uploaded in the background the first time this panel
  // is opened, so the customer's first "Render overlay" is not also paying for an
  // upload. A failure here is silent: the upload simply happens on use.
  useEffect(() => {
    void prewarmTemplates(FRAME_TEMPLATES.map((entry) => entry.id));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const clock = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(clock);
  }, [busy]);

  function pick(next: CardTemplateId) {
    setTemplate(next);
    setVariables(emptyFrameVariables(next));
    setError('');
  }

  const definition = frameTemplate(template);
  const filled = definition.fields.some((field) => String(variables[field.key] || '').trim());

  async function render() {
    if (busy || !filled) return;
    setBusy(true);
    setElapsed(0);
    setError('');
    const jobId = localJobId('hyperframe');
    try {
      const kit = kitFromSession(
        session.brandKit?.primaryColor || '',
        session.brandKit?.secondaryColor || '',
        session.brandKit?.logoUrl || '',
      );
      await recordJob({
        videoId: jobId,
        jobType: 'hyperframe',
        metadata: { template, variables, brand_kit_id: session.brandKitId },
        aspectRatio: session.orientation === 'portrait' ? '9:16' : '16:9',
      });
      const result = await renderFrame(
        template,
        variables,
        kit,
        session.orientation === 'portrait' ? '9:16' : '16:9',
        definition.defaultDuration,
      );
      await finishJob(jobId, result.clipUrl);
      const label = String(variables[definition.fields[0].key] || definition.name).slice(0, 48);
      const frame: RenderedFrame = { id: result.renderId || jobId, template, label, clipUrl: result.clipUrl };
      setFrames((current) => [frame, ...current]);
      onRendered?.(frame);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return <Panel
    step={step}
    done={frames.length > 0}
    title="Motion graphics"
    hint="Animated overlay cards in your brand — a feature list, a stat, a CTA, a testimonial, a step sequence, a UI highlight or a comparison table. Each one renders on its own."
  >
    <CapabilityNote capability="hyperframes" label="HeyGen HyperFrames">
      SceneForge&rsquo;s own Motion Graphics Editor still builds these cards as styled plates and composites them into your
      film &mdash; only HeyGen&rsquo;s animated HTML render is unavailable here.
    </CapabilityNote>

    <div className="space-y-4">
      <Segmented
        value={template}
        onChange={pick}
        options={FRAME_TEMPLATES.map((entry) => ({ value: entry.id, label: entry.name }))}
      />
      <p className="text-xs leading-relaxed text-[var(--space-text-muted)]">{definition.blurb}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {definition.fields.map((field) => <Field key={field.key} label={field.label}>
          {field.multiline
            ? <textarea
              value={variables[field.key] || ''}
              onChange={(event) => setVariables((current) => ({ ...current, [field.key]: event.target.value }))}
              rows={3}
              disabled={busy}
              placeholder={field.placeholder}
              className="st-textarea"
            />
            : <input
              value={variables[field.key] || ''}
              onChange={(event) => setVariables((current) => ({ ...current, [field.key]: event.target.value }))}
              disabled={busy}
              placeholder={field.placeholder}
              className="st-field"
            />}
        </Field>)}
      </div>

      {session.brandKit?.primaryColor ? <p className="text-xs text-[var(--space-text-muted)]">
        Drawn in {session.brandKit.name}&rsquo;s colours, taken from your locked brand kit.
      </p> : null}

      <Button onClick={render} busy={busy} disabled={!filled}>
        <Sparkles className="h-4 w-4" />Render overlay
      </Button>

      {busy ? <Progress elapsedSec={elapsed} expectedSec={70} label="Rendering your motion graphic" /> : null}
      {error ? <Notice tone="error" title="That overlay could not be rendered">{error}</Notice> : null}

      {frames.length ? <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Your overlays</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {frames.map((frame) => <div key={frame.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
            <video src={frame.clipUrl} controls playsInline className="w-full rounded-lg bg-black" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--space-text-primary)]">{frame.label}</span>
              <a
                href={frame.clipUrl}
                download
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
              >
                <Download className="h-3 w-3" />MP4
              </a>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--space-text-muted)]">
              <Clapperboard className="h-3 w-3 shrink-0" />
              Attach this clip in the brief above to compose it into a full scene.
            </p>
          </div>)}
        </div>
      </div> : null}

      {!frames.length && !busy ? <p className="flex items-center gap-1.5 text-xs text-[var(--space-text-muted)]">
        <Plus className="h-3 w-3" />Fill in a card and render it &mdash; each overlay is reusable across every video you make.
      </p> : null}
    </div>
  </Panel>;
}
