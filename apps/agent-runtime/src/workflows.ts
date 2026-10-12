import {
	ApplicationFailure,
	CancellationScope,
	isCancellation,
	proxyActivities,
} from "@temporalio/workflow";
import type { TaskPlan, TaskPlanStep } from "./agent-run-contract.ts";
import { planIssue } from "./operation-rules.ts";
import type {
	AgentActivities,
	AgentWorkflowInput,
	StageDecision,
	StageInput,
} from "./temporal-contract.ts";
import { AGENT_MODEL_QUEUE, AGENT_TOOL_QUEUE } from "./temporal-contract.ts";

const control = proxyActivities<AgentActivities>({
	taskQueue: AGENT_MODEL_QUEUE,
	startToCloseTimeout: "5 minutes",
	heartbeatTimeout: "30 seconds",
	retry: { initialInterval: "1 second", maximumInterval: "10 seconds" },
});
const tools = proxyActivities<AgentActivities>({
	taskQueue: AGENT_TOOL_QUEUE,
	startToCloseTimeout: "2 minutes",
	heartbeatTimeout: "30 seconds",
	retry: { maximumAttempts: 1 },
});
const recoverable = new Set([
	"model_output_invalid",
	"max_turns_exceeded",
	"tool_call_budget_exhausted",
	"run_failed",
	"provider_http_failed",
	"provider_rate_limited",
	"campus_search_failed",
	"personal_memory_recall_failed",
]);
function validatePlan(plan: TaskPlan, workflow: AgentWorkflowInput, completedIds: string[] = []) {
	const issue = planIssue(plan.steps, workflow.admission_snapshot, completedIds);
	if (issue) {
		throw ApplicationFailure.nonRetryable(issue.message, issue.code);
	}
}

function failureCode(error: unknown): string {
	let cause = error;
	while (cause instanceof Error) {
		if (cause instanceof ApplicationFailure) {
			return cause.type ?? "workflow_failed";
		}
		cause = cause.cause;
	}
	return "workflow_failed";
}
function recoveryPath(
	completed: { step: TaskPlanStep; decision: StageDecision }[],
	remaining: TaskPlanStep[],
	workflow: AgentWorkflowInput,
) {
	const done = new Set(completed.map((s) => s.step.id));
	if (remaining.some((s) => s.dependsOn.every((id) => done.has(id)))) {
		return true;
	}
	const available = new Set<string>([
		...workflow.admission_snapshot.agent_capabilities.visible_function_tool_names,
		...(workflow.admission_snapshot.agent_capabilities.hosted_web_search ? ["web_search"] : []),
	]);
	for (const { step, decision } of completed) {
		if (decision.status === "failed") {
			for (const source of step.candidateSources) {
				available.delete(source);
			}
		}
		for (const a of decision.sourceAttempts) {
			if (a.status === "failed" || a.status === "no_match") {
				available.delete(a.source);
			}
		}
	}
	return available.size > 0;
}
function deadline(workflow: AgentWorkflowInput) {
	if (Date.now() >= Date.parse(workflow.deadline_at)) {
		throw ApplicationFailure.nonRetryable("Agent deadline expired", "agent_deadline_exceeded");
	}
}
async function stage(input: StageInput): Promise<StageDecision> {
	deadline(input.workflow);
	const { ref: stageRef } = await control.prepareStage(input);
	let stateRef: string | undefined;
	for (
		let turn = 0;
		turn < input.workflow.admission_snapshot.agent_budget.max_model_turns;
		turn++
	) {
		deadline(input.workflow);
		const result = await control.modelTurn({
			requestId: input.workflow.request_id,
			stageRef,
			...(stateRef ? { stateRef } : {}),
			turn,
		});
		if (result.done) {
			return control.completeStage({
				requestId: input.workflow.request_id,
				stageRef,
				turnRef: result.ref,
			});
		}
		const toolRefs: string[] = [];
		// Ordered campus search keeps citations and exclusion deterministic; results
		// from other tools join in the same model-call order.
		for (const call of result.calls) {
			deadline(input.workflow);
			try {
				const out = await tools.executeTool({
					requestId: input.workflow.request_id,
					stageRef,
					turnRef: result.ref,
					index: call.index,
					priorToolRefs: toolRefs,
				});
				toolRefs.push(out.ref);
			} catch (error) {
				if (isCancellation(error) || !recoverable.has(failureCode(error))) {
					throw error;
				}
				const partial =
					toolRefs.length > 0
						? (
								await control.completeTurn({
									requestId: input.workflow.request_id,
									stageRef,
									turnRef: result.ref,
									toolRefs,
								})
							).ref
						: result.ref;
				return control.completeStage({
					requestId: input.workflow.request_id,
					stageRef,
					turnRef: partial,
					failureCode: failureCode(error),
				});
			}
		}
		stateRef = (
			await control.completeTurn({
				requestId: input.workflow.request_id,
				stageRef,
				turnRef: result.ref,
				toolRefs,
			})
		).ref;
	}
	return control.completeStage({
		requestId: input.workflow.request_id,
		stageRef,
		turnRef: stateRef!,
		failureCode: "max_turns_exceeded",
	});
}
export async function AgentWorkflow(workflow: AgentWorkflowInput): Promise<void> {
	let activeStage = "solve.initial";
	async function runStage(input: StageInput): Promise<StageDecision> {
		activeStage = input.key;
		return stage(input);
	}
	async function finalizeAnswer(ref: string): Promise<void> {
		activeStage = "finalization.write";
		await control.finalizeAnswer({ workflow, ref });
	}
	try {
		const solve = await runStage({
			workflow,
			key: "solve.initial",
			operation: "solve",
			completedRefs: [],
			citationStart: 1,
		});
		if (solve.status === "completed" && solve.solveOutcome === "answer") {
			await finalizeAnswer(solve.ref);
			return;
		}
		if (solve.status === "failed") {
			if (!solve.evidenceCount) {
				throw ApplicationFailure.nonRetryable(
					"Solve failed without materials",
					solve.failureCode ?? "workflow_solve_failed",
				);
			}
			const recovered = await runStage({
				workflow,
				key: "answer.synthesize",
				operation: "synthesize",
				completedRefs: [],
				solveRef: solve.ref,
				citationStart: solve.nextCitation,
				mode: "recovery",
				recoveryReason: solve.failureCode ?? "workflow_solve_failed",
				bufferAnswer: solve.answerStarted,
			});
			if (recovered.status !== "completed") {
				throw ApplicationFailure.nonRetryable(
					"Recovery synthesis failed",
					recovered.failureCode ?? "answer_synthesis_failed",
				);
			}
			await finalizeAnswer(recovered.ref);
			return;
		}
		if (!solve.plan) {
			throw ApplicationFailure.nonRetryable("Solve returned no plan", "workflow_solve_invalid");
		}
		let plan = solve.plan;
		validatePlan(plan, workflow);
		let remaining = [...plan.steps];
		const completed: { step: TaskPlanStep; decision: StageDecision }[] = [];
		let citation = solve.nextCitation;
		let replans = 0;
		while (remaining.length > 0) {
			deadline(workflow);
			const done = new Set(completed.map((s) => s.step.id));
			const index = remaining.findIndex((s) => s.dependsOn.every((id) => done.has(id)));
			if (index < 0) {
				throw ApplicationFailure.nonRetryable("No ready plan step", "workflow_dependency_cycle");
			}
			const step = remaining[index]!;
			const result = await runStage({
				workflow,
				key: `task.step.${step.id}`,
				operation: "execute_step",
				plan,
				step,
				completedRefs: completed.map((s) => s.decision.ref),
				solveRef: solve.ref,
				citationStart: citation,
			});
			if (result.status === "failed" && !recoverable.has(result.failureCode ?? "")) {
				throw ApplicationFailure.nonRetryable(
					"Step failed",
					result.failureCode ?? "workflow_step_failed",
				);
			}
			completed.push({ step, decision: result });
			citation = result.nextCitation;
			remaining.splice(index, 1);
			const needsRecovery =
				result.status === "failed" ||
				result.remainingFacts.length > 0 ||
				(result.evidenceCount === 0 &&
					result.sourceAttempts.some((a) => a.status === "failed" || a.status === "no_match"));
			const budget = workflow.admission_snapshot.agent_budget;
			if (
				needsRecovery &&
				replans < budget.max_replans &&
				completed.length < budget.max_plan_steps &&
				recoveryPath(completed, remaining, workflow)
			) {
				replans++;
				const decision = await runStage({
					workflow,
					key: `solve.replan.${replans}`,
					operation: "replan",
					plan,
					completedRefs: completed.map((s) => s.decision.ref),
					solveRef: solve.ref,
					citationStart: citation,
					remaining,
					replanIndex: replans,
				});
				if (decision.status === "failed") {
					if (!recoverable.has(decision.failureCode ?? "")) {
						throw ApplicationFailure.nonRetryable(
							"Replan failed",
							decision.failureCode ?? "workflow_replan_failed",
						);
					}
					continue;
				}
				if (!decision.replan) {
					throw ApplicationFailure.nonRetryable(
						"Missing replan decision",
						"workflow_replan_invalid",
					);
				}
				if (decision.replan.decision === "synthesize") {
					remaining = [];
				} else {
					remaining = decision.replan.remainingSteps;
					validatePlan(
						{ ...plan, steps: remaining },
						workflow,
						completed.map((s) => s.step.id),
					);
					plan = { ...plan, steps: [...completed.map((s) => s.step), ...remaining] };
				}
			}
		}
		if (
			solve.evidenceCount === 0 &&
			!completed.some((s) => s.decision.evidenceCount > 0 || s.decision.sourceSucceeded)
		) {
			throw ApplicationFailure.nonRetryable("No usable materials", "workflow_evidence_unavailable");
		}
		const answer = await runStage({
			workflow,
			key: "answer.synthesize",
			operation: "synthesize",
			plan,
			completedRefs: completed.map((s) => s.decision.ref),
			solveRef: solve.ref,
			citationStart: citation,
			mode: "planned",
		});
		if (answer.status !== "completed") {
			throw ApplicationFailure.nonRetryable(
				"Synthesis failed",
				answer.failureCode ?? "answer_synthesis_failed",
			);
		}
		await finalizeAnswer(answer.ref);
	} catch (error) {
		const canceled = isCancellation(error);
		const code = failureCode(error);
		await CancellationScope.nonCancellable(() =>
			control.finalizeFailure({ workflow, stage: activeStage, code, canceled }),
		);
		if (!canceled) {
			throw error;
		}
	}
}
