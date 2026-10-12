import type {
	TaskPlanStep,
	WorkflowOperationInput,
	WorkflowOperationResult,
} from "./agent-run-contract.ts";
import type { AgentWorkflowInput } from "./temporal-contract.ts";

type Admission = AgentWorkflowInput["admission_snapshot"];
export function planIssue(
	steps: TaskPlanStep[],
	admission: Admission,
	completedIds: string[] = [],
): { code: string; message: string } | undefined {
	const invalid = (message: string) => ({ code: "workflow_plan_invalid", message });
	if (steps.length + completedIds.length > admission.agent_budget.max_plan_steps) {
		return invalid("Plan exceeds admitted steps");
	}
	const ids = new Set([...completedIds, ...steps.map((s) => s.id)]);
	if (ids.size !== completedIds.length + steps.length) {
		return invalid("Duplicate plan step");
	}
	const available = new Set<string>([
		...admission.agent_capabilities.visible_function_tool_names,
		...(admission.agent_capabilities.hosted_web_search ? ["web_search"] : []),
	]);
	const done = new Set(completedIds);
	for (const step of steps) {
		if (
			!(/^step\.[a-z0-9][a-z0-9_-]{0,63}$/.test(step.id) && step.objective.trim()) ||
			step.candidateSources.length === 0 ||
			step.candidateSources.length > 3 ||
			new Set(step.candidateSources).size !== step.candidateSources.length ||
			step.candidateSources.some((s) => !available.has(s)) ||
			step.dependsOn.some((id) => !ids.has(id))
		) {
			return invalid("Invalid plan source or dependency");
		}
	}
	while (done.size < ids.size) {
		const ready = steps.filter((s) => !done.has(s.id) && s.dependsOn.every((id) => done.has(id)));
		if (ready.length === 0) {
			return { code: "workflow_dependency_cycle", message: "Plan dependency cycle" };
		}
		for (const step of ready) {
			done.add(step.id);
		}
	}
	return undefined;
}

// The Runtime owns the outcome consumed by Workflow and submitted for projection.
// Model-output rejection preserves usage and retrieved evidence.
export function normalizeStageResult(
	input: WorkflowOperationInput,
	result: WorkflowOperationResult,
	admission: Admission,
): WorkflowOperationResult {
	let output = result;
	if (input.operation === "synthesize") {
		output = {
			...output,
			evidence: input.operationInput.evidence,
			sourceAttempts: input.operationInput.sourceAttempts,
		};
	}
	const sourceIssue = outputSourceIssue(input, output, admission);
	if (sourceIssue) {
		return {
			...rejected(output, input.operation, sourceIssue),
			evidence: [],
			sourceAttempts: [],
			toolResults: [],
			failure: {
				code: "workflow_operation_result_invalid",
				operation: `workflow.${input.operation}`,
				detail: sourceIssue,
			},
		};
	}
	if (output.status === "failed") {
		return output;
	}
	let detail: string | undefined;
	if (output.operation === "solve") {
		if (output.solveOutcome === "plan") {
			if (output.plan?.steps.length) {
				detail = planIssue(output.plan.steps, admission)?.message;
			} else {
				detail = "Solver plan is missing";
			}
		} else if (output.solveOutcome !== "answer" || !output.finalOutput.trim()) {
			detail = "Solver answer is missing";
		}
	}
	if (input.operation === "replan") {
		const replan = output.replan;
		if (
			replan?.schemaVersion !== "task_replan.v3" ||
			!["continue", "synthesize"].includes(replan.decision) ||
			(replan.decision === "continue"
				? replan.remainingSteps.length === 0
				: replan.remainingSteps.length > 0)
		) {
			detail = "Invalid replanning decision";
		} else {
			const completed = input.operationInput.completedSteps.map((s) => s.step.id);
			detail = planIssue(replan.remainingSteps, admission, completed)?.message;
			// Replanning has always admitted only ordered dependencies on completed or earlier steps.
			const known = new Set(completed);
			for (const step of replan.remainingSteps) {
				if (step.dependsOn.some((id) => !known.has(id))) {
					detail ??= "Remaining step depends on unknown or later step";
				}
				known.add(step.id);
			}
		}
	}
	if (
		(input.operation === "execute_step" || input.operation === "synthesize") &&
		!output.finalOutput.trim()
	) {
		detail = "Text operation result is empty";
	}
	if (!detail) {
		return output;
	}
	return rejected(output, input.operation, detail);
}

function rejected(
	output: WorkflowOperationResult,
	operation: string,
	detail: string,
): WorkflowOperationResult {
	const { replan: _replan, ...preserved } = output;
	return {
		...preserved,
		status: "failed",
		terminalReason: "agent_runtime_failed",
		failure: { code: "model_output_invalid", operation: `workflow.${operation}`, detail },
	};
}

function outputSourceIssue(
	input: WorkflowOperationInput,
	output: WorkflowOperationResult,
	admission: Admission,
): string | undefined {
	if (
		output.status !== "failed" &&
		output.toolResults.some((t) => t.status === "failed" && !toolFailureRecoverable(t.failure))
	) {
		return "Tool failure is not a recoverable source failure";
	}
	if (input.operation === "replan") {
		return output.toolResults.length > 0 ||
			output.evidence.length > 0 ||
			output.sourceAttempts.length > 0
			? "Replanner returned source output"
			: undefined;
	}
	if (input.operation === "synthesize") {
		return output.toolResults.length > 0 ? "Synthesizer returned retrieval output" : undefined;
	}
	const sources = new Set<string>(
		input.operation === "execute_step"
			? input.operationInput.step.candidateSources
			: [
					...admission.agent_capabilities.visible_function_tool_names,
					...(admission.agent_capabilities.hosted_web_search ? ["web_search"] : []),
				],
	);
	if (
		output.toolResults.some(
			(t) =>
				!(
					["campus_search", "personal_memory_recall"].includes(t.toolName) &&
					sources.has(t.toolName)
				),
		) ||
		output.evidence.some((e) => !sources.has(e.source)) ||
		output.sourceAttempts.some(
			(a) =>
				!(
					sources.has(a.source) && ["matched", "no_match", "completed", "failed"].includes(a.status)
				),
		)
	) {
		return "Operation returned an unadmitted source or invalid source status";
	}
	return undefined;
}

const sourceUnavailable = new Set([
	"campus_search_timeout",
	"campus_search_network_failed",
	"campus_search_unavailable",
	"campus_search_rate_limited",
	"campus_search_validation_failed",
	"campus_search_index_failed",
	"campus_search_embedding_failed",
	"campus_search_retrieval_failed",
	"campus_search_retrieval_timeout",
	"campus_search_rerank_failed",
	"campus_search_rerank_timeout",
	"campus_search_selection_failed",
	"campus_search_unknown_failed",
	"campus_search_deadline_exceeded",
	"transient_internal_query_failed",
	"personal_memory_recall_failed",
	"personal_memory_recall_timeout",
	"personal_memory_recall_network_failed",
	"source_unavailable_for_request",
	"retrieval_budget_exhausted",
]);
function toolFailureRecoverable(
	failure: WorkflowOperationResult["toolResults"][number]["failure"],
): boolean {
	if (!failure) {
		return false;
	}
	return (
		sourceUnavailable.has(failure.code) ||
		(failure.code === "tool_handler_failed" &&
			(failure.httpStatus === 429 ||
				(failure.httpStatus !== undefined &&
					failure.httpStatus >= 500 &&
					failure.httpStatus < 600)))
	);
}
