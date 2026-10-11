// CriticOutput — the verdict that decides whether the loop spends another render.
//
// Every field here is read by lib/iteration-manager.ts. improvement_delta is
// null on the first pass because there is nothing to compare against, and a
// null delta must never be treated as zero: that would stop the loop before
// it ever ran twice.

export type Priority = 'critical' | 'high' | 'low' | 'none';

export type StopReason = 'marginal_gain_too_low' | 'shippable' | 'fundamental_concept_issue';

export interface SceneAssessment {
  scene_id: string;
  score: number;                    // 0–1
  treatment_achieved: boolean;
  issues: string[];
  fix_priority: Priority;
}

export interface FilmLevelIssue {
  dimension: string;                // 'hook' | 'product_clarity' | 'pacing' | etc.
  finding: string;                  // frame-referenced where possible
  fix_instruction: string;          // what to change, not what's wrong
  priority: Priority;
}

export interface CriticOutput {
  overall_score: number;
  shippable: boolean;
  improvement_delta: number | null; // null on first iteration
  recommend_another_iteration: boolean;
  stop_reason: StopReason | null;

  scene_assessments: SceneAssessment[];
  film_level_issues: FilmLevelIssue[];

  what_is_working: string[];
  single_biggest_problem: string;
  director_note: string;
}

export const PRIORITIES: Priority[] = ['critical', 'high', 'low', 'none'];

export const STOP_REASONS: StopReason[] = [
  'marginal_gain_too_low', 'shippable', 'fundamental_concept_issue',
];

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0, high: 1, low: 2, none: 3,
};

/** The issues a revision pass should actually act on, most urgent first. */
export function actionableIssues(critic: CriticOutput): FilmLevelIssue[] {
  return critic.film_level_issues
    .filter((issue) => issue.priority === 'critical' || issue.priority === 'high')
    .slice()
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

/** Scenes the critic marked for a fix, worst score first. */
export function scenesNeedingWork(critic: CriticOutput): SceneAssessment[] {
  return critic.scene_assessments
    .filter((scene) => scene.fix_priority === 'critical' || scene.fix_priority === 'high')
    .slice()
    .sort((a, b) => a.score - b.score);
}
