import type { TaskPlanStep, WorkflowOperationResult } from "./agent-run-contract.ts";
import type { agentRunResultWire } from "./http-response.ts";
import { mapEvidence, mapTaskPlanStep } from "./http-run-contract.ts";

// The persisted Control OperationOutput is distinct from the model response:
// synthesis includes admitted materials and invalid replans have no decision.
type ResultWire = ReturnType<typeof agentRunResultWire>;
interface StepWire {
	id: string;
	objective: string;
	candidate_sources: TaskPlanStep["candidateSources"];
	depends_on: string[] | null;
}
export interface ControlOperationOutput {
	operation: WorkflowOperationResult["operation"];
	status: WorkflowOperationResult["status"];
	final_output: string;
	answer_started?: boolean;
	solve_outcome?: WorkflowOperationResult["solveOutcome"];
	plan?: { schema_version: "task_plan.v1"; goal: string; steps: StepWire[] };
	replan?: {
		schema_version: "task_replan.v3";
		decision: "continue" | "synthesize";
		reason: string;
		remaining_steps: StepWire[] | null;
	};
	remaining_facts?: string[];
	failure?: NonNullable<ResultWire["failure"]> & { stage?: string };
	evidence: ResultWire["evidence"] | null;
	source_attempts: ResultWire["source_attempts"] | null;
	usage: ResultWire["usage"];
}
export type StageResult = Pick<
	WorkflowOperationResult,
	| "operation"
	| "status"
	| "finalOutput"
	| "answerStarted"
	| "solveOutcome"
	| "plan"
	| "replan"
	| "remainingFacts"
	| "failure"
	| "evidence"
	| "sourceAttempts"
	| "usage"
>;
function stepFromControl(step: StepWire): TaskPlanStep {
	return mapTaskPlanStep({ ...step, depends_on: step.depends_on ?? [] });
}
export function stageResultFromControl(output: ControlOperationOutput): StageResult {
	return {
		operation: output.operation,
		status: output.status,
		finalOutput: output.final_output,
		answerStarted: output.answer_started === true,
		...(output.solve_outcome ? { solveOutcome: output.solve_outcome } : {}),
		...(output.plan
			? {
					plan: {
						schemaVersion: output.plan.schema_version,
						goal: output.plan.goal,
						steps: output.plan.steps.map(stepFromControl),
					},
				}
			: {}),
		...(output.replan
			? {
					replan: {
						schemaVersion: output.replan.schema_version,
						decision: output.replan.decision,
						reason: output.replan.reason,
						remainingSteps: (output.replan.remaining_steps ?? []).map(stepFromControl),
					},
				}
			: {}),
		...(output.remaining_facts ? { remainingFacts: output.remaining_facts } : {}),
		...(output.failure
			? {
					failure: {
						code: output.failure.code,
						operation: output.failure.operation,
						...(output.failure.reason ? { reason: output.failure.reason } : {}),
						...(output.failure.citation ? { citation: output.failure.citation } : {}),
						...(output.failure.stage ? { stage: output.failure.stage } : {}),
						...(output.failure.detail ? { detail: output.failure.detail } : {}),
						...(output.failure.http_status === undefined
							? {}
							: { httpStatus: output.failure.http_status }),
						...(output.failure.invocation_id ? { invocationId: output.failure.invocation_id } : {}),
					},
				}
			: {}),
		evidence: (output.evidence ?? []).map(mapEvidence),
		sourceAttempts: (output.source_attempts ?? []).map((attempt) => ({
			source: attempt.source,
			status: attempt.status,
			...(attempt.failure_code ? { failureCode: attempt.failure_code } : {}),
		})),
		usage: {
			modelRequestCount: output.usage.model_request_count,
			inputTokens: output.usage.input_tokens,
			outputTokens: output.usage.output_tokens,
			cachedInputTokens: output.usage.cached_input_tokens,
			usageObserved: output.usage.usage_observed,
		},
	};
}
