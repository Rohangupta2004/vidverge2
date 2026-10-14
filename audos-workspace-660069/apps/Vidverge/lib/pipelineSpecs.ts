/**
 * THE PIPELINES, as data.
 *
 * Cost and latency are the numbers the product promises, shown on the selector
 * before a customer spends anything. They are TARGETS, not meter readings: the
 * real spend lands on the workspace wallet per provider call, so the UI labels
 * them as estimates rather than quoting them as a bill.
 */

import type { PipelineId } from '../types';

export interface PipelineSpec {
  id: PipelineId;
  /** Short product name on the selector card. */
  title: string;
  /** One line on what it makes. */
  blurb: string;
  /** The three beats of how it works, for the card body. */
  steps: string[];
  /** Target spend per finished video, in USD. */
  costUsd: number;
  /** Target wall-clock for a finished master, in seconds. */
  slaSeconds: number;
  aspectRatio: string;
  durationSeconds: number;
  /** What the submit button says. */
  cta: string;
}

export const PIPELINE_A: PipelineSpec = {
  id: 'CODE_ENGINEERED',
  title: 'SaaS Motion Reel',
  blurb:
    'Point it at your product URL. It reads your real brand, writes the voiceover, and engineers the motion as code — kinetic type locked to the words you actually say.',
  steps: [
    'Reads your site for brand colours, logo and copy',
    'Voices the script and times every word',
    'Writes a Remotion composition and renders it',
  ],
  costUsd: 0.38,
  slaSeconds: 90,
  aspectRatio: '9:16',
  durationSeconds: 30,
  cta: 'Build the reel',
};

export const PIPELINE_B: PipelineSpec = {
  id: 'HYBRID_DOCUMENTARY',
  title: 'Vox Documentary',
  blurb:
    'Give it a topic. It writes fifteen beats, builds a torn-paper collage for each one, animates them as stop-motion, and cuts the whole thing to the narration.',
  steps: [
    'Writes 15 four-second beats, 150 words total',
    'Builds a paper-collage still for every beat',
    'Animates each still and assembles the film',
  ],
  costUsd: 1.92,
  slaSeconds: 150,
  aspectRatio: '16:9',
  durationSeconds: 60,
  cta: 'Build the documentary',
};

export const PIPELINE_C: PipelineSpec = {
  id: 'RUNWAY_MULTI_SHOT',
  title: 'Multi-Shot Ad',
  blurb:
    'Define 3\u20135 ordered scenes. Runway stitches them into one cinematic 15s ad \u2014 problem, product, solution, CTA.',
  steps: [
    'You write 3\u20135 scene prompts in order',
    'Optional hero image anchors the opening frame',
    'Runway generates and stitches the full narrative cut',
  ],
  costUsd: 0.8,
  slaSeconds: 120,
  aspectRatio: '9:16',
  durationSeconds: 15,
  cta: 'Generate the ad',
};

export const PIPELINE_SPECS: PipelineSpec[] = [PIPELINE_A, PIPELINE_B, PIPELINE_C];

export function pipelineSpec(id: PipelineId): PipelineSpec {
  switch (id) {
    case 'HYBRID_DOCUMENTARY':
      return PIPELINE_B;
    case 'RUNWAY_MULTI_SHOT':
      return PIPELINE_C;
    default:
      return PIPELINE_A;
  }
}

/** "under 90 seconds" / "under 2.5 minutes" — the SLA in words. */
export function slaLabel(spec: PipelineSpec): string {
  return spec.slaSeconds < 120
    ? `under ${spec.slaSeconds} seconds`
    : `under ${(spec.slaSeconds / 60).toFixed(1).replace(/\.0$/, '')} minutes`;
}
