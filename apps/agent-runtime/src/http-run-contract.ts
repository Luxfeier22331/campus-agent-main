import {
	type AgentRunRequest,
	agentRunRequestWireSchema,
	type WorkflowEvidence as WireEvidence,
	type WorkflowCompletedStep,
	type WorkflowTaskPlan,
	type WorkflowTaskPlanStep,
} from "campus-contracts/agent-runtime-control";
import { CitationDiagnosticSchema } from "campus-contracts/citation-diagnostic";
import { z } from "zod";

export type { AgentRunRequest } from "campus-contracts/agent-runtime-control";

import type {
	AgentConversationContext,
	CompletedTaskStep,
	ExecuteStepWorkflowOperationInput,
	PromptProviderRuntimeConfig,
	ReplanWorkflowOperationInput,
	SolveWorkflowOperationInput,
	SynthesizeWorkflowOperationInput,
	TaskPlan,
	TaskPlanStep,
	WorkflowEvidence,
	WorkflowOperationInput,
	WorkflowSource,
} from "./agent-run-contract.ts";
import type { ToolContractFingerprint } from "./tool-catalog.ts";

export const agentRunRequestSchema = agentRunRequestWireSchema.superRefine((value, context) => {
	const goal = value.operation_input.goal;
	if ([...goal].length > value.limits.current_input_char_limit) {
		context.addIssue({
			code: "custom",
			message: "operation_input.goal exceeds limits.current_input_char_limit",
			path: ["operation_input", "goal"],
		});
	}
	if (
		value.operation === "solve" &&
		value.operation_input.max_steps > value.limits.max_plan_steps
	) {
		context.addIssue({
			code: "custom",
			message: "operation_input.max_steps exceeds limits.max_plan_steps",
			path: ["operation_input", "max_steps"],
		});
	}
	if (
		value.operation === "synthesize" &&
		value.operation_input.mode === "recovery" &&
		(value.operation_input.evidence.length === 0 || !value.operation_input.recovery_reason)
	) {
		context.addIssue({
			code: "custom",
			message: "recovery synthesis requires evidence and a failure reason",
			path: ["operation_input"],
		});
	}
});

function mapToolContractFingerprint(
	fingerprint: AgentRunRequest["expected_tool_contract_fingerprint"],
): ToolContractFingerprint {
	return {
		functionSchemaSha256: fingerprint.function_schema_sha256,
		schemaVersion: fingerprint.schema_version,
		toolsSha256: fingerprint.tools_sha256,
	};
}

export function runtimeInputFromAgentRunRequest(
	parsed: AgentRunRequest,
	providerConfig: PromptProviderRuntimeConfig,
	signal: AbortSignal,
): WorkflowOperationInput {
	const base = {
		...(parsed.model_answer_transport
			? { modelAnswerTransport: parsed.model_answer_transport }
			: {}),
		deadlineAt: parsed.deadline_at,
		priorEvidence: parsed.prior_evidence.map(mapEvidence),
		priorSourceAttempts: parsed.prior_source_attempts.map((attempt) => ({
			source: attempt.source,
			status: attempt.status,
			...(attempt.failure_code ? { failureCode: attempt.failure_code } : {}),
		})),
		activityAttempt: parsed.activity_attempt,
		conversationId: parsed.conversation_id,
		expectedToolContractFingerprint: mapToolContractFingerprint(
			parsed.expected_tool_contract_fingerprint,
		),
		limits: {
			agentDeadlineMs: parsed.limits.agent_deadline_ms,
			contextCharLimit: parsed.limits.context_char_limit,
			currentInputCharLimit: parsed.limits.current_input_char_limit,
			maxOutputTokens: parsed.limits.max_output_tokens,
			maxFunctionToolCalls: parsed.limits.max_function_tool_calls,
			maxTurns: parsed.limits.max_turns,
		},
		providerConfig,
		requestId: parsed.request_id,
		signal,
		visibleFunctionToolNames: [...parsed.visible_function_tool_names],
		...(parsed.conversation_context
			? { conversationContext: mapConversationContext(parsed.conversation_context) }
			: {}),
	};
	if (parsed.operation === "solve") {
		return {
			...base,
			operation: "solve",
			operationInput: {
				goal: parsed.operation_input.goal,
				maxSteps: parsed.operation_input.max_steps,
			},
		} satisfies SolveWorkflowOperationInput;
	}
	if (parsed.operation === "execute_step") {
		return {
			...base,
			operation: "execute_step",
			operationInput: {
				completedSteps: parsed.operation_input.completed_steps.map(mapCompletedStep),
				citationStart: parsed.operation_input.citation_start,
				goal: parsed.operation_input.goal,
				plan: mapTaskPlan(parsed.operation_input.plan),
				step: mapTaskPlanStep(parsed.operation_input.step),
			},
		} satisfies ExecuteStepWorkflowOperationInput;
	}
	if (parsed.operation === "replan") {
		return {
			...base,
			operation: "replan",
			operationInput: {
				completedSteps: parsed.operation_input.completed_steps.map(mapCompletedStep),
				goal: parsed.operation_input.goal,
				maxRemainingSteps: parsed.operation_input.max_remaining_steps,
				plan: mapTaskPlan(parsed.operation_input.plan),
				remainingSteps: parsed.operation_input.remaining_steps.map(mapTaskPlanStep),
			},
		} satisfies ReplanWorkflowOperationInput;
	}
	return {
		...base,
		operation: "synthesize",
		operationInput: {
			evidence: parsed.operation_input.evidence.map(mapEvidence),
			goal: parsed.operation_input.goal,
			mode: parsed.operation_input.mode,
			remainingFacts: parsed.operation_input.remaining_facts,
			sourceAttempts: parsed.operation_input.source_attempts.map((attempt) => ({
				source: attempt.source,
				status: attempt.status,
				...(attempt.failure_code ? { failureCode: attempt.failure_code } : {}),
			})),
			...(parsed.operation_input.recovery_reason
				? { recoveryReason: parsed.operation_input.recovery_reason }
				: {}),
		},
	} satisfies SynthesizeWorkflowOperationInput;
}

function mapConversationContext(
	value: NonNullable<AgentRunRequest["conversation_context"]>,
): AgentConversationContext {
	return {
		schemaVersion: value.schema_version,
		recentTurns: value.recent_turns.map((turn) => ({
			...(turn.message_id ? { messageId: turn.message_id } : {}),
			content: turn.content,
			role: turn.role,
		})),
		...(value.session_state
			? {
					sessionState: {
						confirmedSlots: value.session_state.confirmed_slots.map((slot) => ({
							confirmed: slot.confirmed,
							name: slot.name,
							value: slot.value,
						})),
					},
				}
			: {}),
	};
}

function mapTaskPlan(value: WorkflowTaskPlan): TaskPlan {
	return {
		goal: value.goal,
		schemaVersion: value.schema_version,
		steps: value.steps.map(mapTaskPlanStep),
	};
}

export function mapTaskPlanStep(value: WorkflowTaskPlanStep): TaskPlanStep {
	return {
		candidateSources: [...value.candidate_sources] as WorkflowSource[],
		dependsOn: [...value.depends_on],
		id: value.id,
		objective: value.objective,
	};
}

export function mapEvidence(value: WireEvidence): WorkflowEvidence {
	const result: WorkflowEvidence = {
		excerpt: value.excerpt,
		...(value.source_link ? { sourceLink: value.source_link } : {}),
		id: value.id,
		schemaVersion: value.schema_version,
		source: value.source,
		title: value.title,
	};
	const optionalFields: [keyof WorkflowEvidence, string | number | undefined][] = [
		["citationIndex", value.citation_index],
		["url", value.url],
		["resultRef", value.result_ref],
		["documentId", value.document_id],
		["noticeId", value.notice_id],
		["releasedAt", value.released_at],
		["citationHref", value.citation_href],
		["sectionRef", value.section_ref],
		["sectionTitle", value.section_title],
		["versionId", value.version_id],
		["versionSlug", value.version_slug],
	];
	for (const [key, fieldValue] of optionalFields) {
		if (fieldValue !== undefined) {
			(result as unknown as Record<string, unknown>)[key] = fieldValue;
		}
	}
	if (value.root_unit_ids !== undefined) {
		result.rootUnitIds = [...value.root_unit_ids];
	}
	return result;
}

function mapCompletedStep(value: WorkflowCompletedStep): CompletedTaskStep {
	const { citation, http_status, invocation_id, ...failure } = value.failure ?? {};
	return {
		remainingFacts: value.remaining_facts,
		...(value.failure
			? {
					failure: {
						...failure,
						code: value.failure.code,
						operation: value.failure.operation,
						...(citation === undefined
							? {}
							: { citation: CitationDiagnosticSchema.parse(citation) }),
						...(http_status === undefined ? {} : { httpStatus: http_status }),
						...(invocation_id === undefined ? {} : { invocationId: invocation_id }),
					},
				}
			: {}),
		evidence: value.evidence.map(mapEvidence),
		executionIndex: value.execution_index,
		sourceAttempts: value.source_attempts.map((attempt) => ({
			...(attempt.failure_code ? { failureCode: attempt.failure_code } : {}),
			source: attempt.source,
			status: attempt.status,
		})),
		step: mapTaskPlanStep(value.step),
		summary: value.summary,
	};
}

export function agentRunRequestValidationError(error: unknown) {
	const contextBudgetExceeded =
		error instanceof z.ZodError &&
		error.issues.some((issue) => issue.code === "custom" && issue.path.includes("goal"));
	return {
		code: contextBudgetExceeded ? "context_budget_exceeded" : "invalid_request",
		message: contextBudgetExceeded
			? "The workflow runtime context exceeded its configured budget."
			: "The workflow runtime request is invalid.",
		retryable: false,
	};
}
