// Storyboard review: the plan, before the money.
//
// HeyGen has planned the film and stopped. Nothing has been rendered yet, so
// this is the cheapest possible moment to change the film — which is exactly
// why the scene text is EDITABLE here rather than merely displayed. The edits
// are sent back with the approval, so what the customer rewrote is what gets
// rendered.
import { useState } from 'react';
import { Check, GripVertical } from 'lucide-react';
import type { StoryboardScene } from '../../lib/heygenAgent';
import { Button, Field, Notice } from './ui';

export default function StoryboardReview(props: {
  scenes: StoryboardScene[];
  busy: boolean;
  onChange: (scenes: StoryboardScene[]) => void;
  onApprove: (scenes: StoryboardScene[], note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  function edit(id: string, patch: Partial<StoryboardScene>) {
    setTouched(true);
    props.onChange(props.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene));
  }

  const total = props.scenes.reduce((sum, scene) => sum + (scene.durationSec || 0), 0);

  return <div className="rounded-xl border border-[color-mix(in_srgb,#C8920A_34%,transparent)] bg-[color-mix(in_srgb,#C8920A_7%,transparent)] p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold text-[var(--space-text-primary)]">
        HeyGen&rsquo;s plan &mdash; {props.scenes.length} scene{props.scenes.length === 1 ? '' : 's'}
        {total ? ` \u00b7 about ${Math.round(total)}s` : ''}
      </h3>
      <span className="ml-auto rounded-full bg-[var(--space-surface-panel)] px-2.5 py-1 text-[11px] font-medium text-[var(--space-text-muted)]">
        Nothing rendered yet
      </span>
    </div>
    <p className="mt-1.5 text-xs leading-relaxed text-[var(--space-text-muted)]">
      Read it, change anything you want, then approve. Editing here costs nothing &mdash; changing your mind after the render does.
    </p>

    <div className="mt-4 space-y-3">
      {props.scenes.map((scene, index) => <div key={scene.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3">
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-[var(--space-text-muted)]" />
          <input
            value={scene.title}
            onChange={(event) => edit(scene.id, { title: event.target.value })}
            disabled={props.busy}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--space-text-primary)] outline-none"
            aria-label={`Scene ${index + 1} title`}
          />
          {scene.durationSec ? <span className="shrink-0 text-[11px] text-[var(--space-text-muted)]">{Math.round(scene.durationSec)}s</span> : null}
        </div>
        <div className="mt-2 grid gap-2">
          <Field label="What you see">
            <textarea
              value={scene.description}
              onChange={(event) => edit(scene.id, { description: event.target.value })}
              rows={2}
              disabled={props.busy}
              className="st-field resize-y"
            />
          </Field>
          {/* The spoken line is only offered when HeyGen separated it from the
              visual; inventing an empty script box on a plan that has none
              would invite the customer to write into nothing. */}
          {scene.script ? <Field label="What they say">
            <textarea
              value={scene.script}
              onChange={(event) => edit(scene.id, { script: event.target.value })}
              rows={2}
              disabled={props.busy}
              className="st-field resize-y"
            />
          </Field> : null}
        </div>
      </div>)}
    </div>

    <div className="mt-4 space-y-3">
      <Field label="Anything else for HeyGen?" hint="Optional. For example: keep scene 2 shorter, and make the close warmer.">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={props.busy}
          placeholder="Approved \u2014 render this storyboard"
          className="st-field"
        />
      </Field>
      {touched ? <Notice tone="info" title="Your edits will be rendered">
        The scene text above is sent back with your approval, so HeyGen renders your version rather than its original plan.
      </Notice> : null}
      <Button onClick={() => props.onApprove(props.scenes, note)} busy={props.busy}>
        <Check className="h-4 w-4" />Approve &amp; render
      </Button>
    </div>
  </div>;
}
