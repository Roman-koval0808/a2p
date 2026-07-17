/**
 * Canonical execution modes / lanes for the pipeline, and normalization of the
 * non-canonical modes that may appear on Action Library rows.
 *
 * Single source of truth shared by the orchestrator (mode resolution), the
 * action-queue engine (lane assignment) and the execution engine (eligibility),
 * so the set can't drift between them.
 */

export type ExecutionMode = 'approval_required' | 'automatic' | 'manual' | 'observe_only';

export const KNOWN_EXECUTION_MODES: readonly string[] = [
	'approval_required',
	'automatic',
	'manual',
	'observe_only'
];

/**
 * Aliases map non-executable library modes onto a real lane.
 * `automatic_immediate` (e.g. ACT-A2P-004 emergency dispatch) means "fire
 * automatically, highest urgency"; there is no separate deferral pipeline, so it
 * resolves to the `automatic` lane. Without this, the emergency dispatch action
 * fell through eligibility as `unknown_execution_mode` and never executed.
 */
const EXECUTION_MODE_ALIASES: Record<string, string> = {
	automatic_immediate: 'automatic'
};

export function normalizeExecutionMode(mode: string | null | undefined): string {
	if (!mode) return 'approval_required';
	return EXECUTION_MODE_ALIASES[mode] ?? mode;
}
