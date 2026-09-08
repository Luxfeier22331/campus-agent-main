import { z } from "zod";
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

const toolContractFingerprintSchema = z
	.object({
		function_schema_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
		schema_version: z.literal("tool_contract_fingerprint.v1"),
		tools_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
	})
	.strict();

const conversationContextSchema = z
	.object({
		schema_version: z.literal("agent_conversation_context.v1"),
		recent_turns: z
			.array(
				z
					.object({
						message_id: z.string().min(1).optional(),
						role: z.enum(["assistant", "user"]),
						content: z.string().min(1),
					})
					.strict(),
			)
			.default([]),
		session_state: z
			.object({
				confirmed_slots: z
					.array(
						z
							.object({
								confirmed: z.boolean(),
								name: z.string().min(1),
								value: z.string().min(1),
							})
							.strict(),
					)
					.default([]),
			})
			.strict()
			.optional(),
	})
	.strict();

const runtimeLimitsSchema = z
	.object({
		agent_deadline_ms: z.number().int().positive(),
		context_char_limit: z.number().int().positive(),
		current_input_char_limit: z.number().int().positive(),
		max_output_tokens: z.number().int().positive(),
		max_function_tool_calls: z.number().int().nonnegative(),
		max_turns: z.number().int().positive(),
		max_plan_steps: z.number().int().positive(),
		max_replans: z.number().int().nonnegative(),
	})
	.strict();

const sourceSchema = z.enum(["campus_search", "web_search", "personal_memory_recall"]);

const taskPlanStepSchema = z
	.object({
		id: z.string().min(1),
		objective: z.string().min(1),
		candidate_sources: z.array(sourceSchema),
		depends_on: z.array(z.string().min(1)),
	})
	.strict();

const taskPlanSchema = z
	.object({
		schema_version: z.literal("task_plan.v1"),
		goal: z.string().min(1),
		steps: z.array(taskPlanStepSchema).min(1),
	})
	.strict();

const sourceAttemptSchema = z
	.object({
		source: sourceSchema,
		status: z.enum(["matched", "no_match", "completed", "failed"]),
		failure_code: z.string().min(1).optional(),
	})
	.strict();

const evidenceSchema = z
	.object({
		schema_version: z.literal("workflow_evidence.v1"),
		id: z.string().min(1),
		source: sourceSchema,
		title: z.string().min(1),
		excerpt: z.string().min(1),
		citation_index: z.number().int().positive().optional(),
		url: z.string().url().optional(),
		result_ref: z.string().min(1).optional(),
		document_id: z.string().min(1).optional(),
		notice_id: z.string().min(1).optional(),
		citation_href: z.string().min(1).optional(),
		section_ref: z.string().min(1).optional(),
		section_title: z.string().min(1).optional(),
		root_unit_ids: z.array(z.string().min(1)).min(1).optional(),
		version_id: z.string().min(1).optional(),
		version_slug: z.string().min(1).optional(),
	})
	.strict();

const stepFailureSchema = z
	.object({ code: z.string().min(1), operation: z.string().min(1) })
	.strict();

const completedStepSchema = z
	.object({
		step: taskPlanStepSchema,
		execution_index: z.number().int().positive(),
		summary: z.string().min(1),
		remaining_facts: z.array(z.string().trim().min(1).max(1_000)).max(32),
		failure: stepFailureSchema.optional(),
		evidence: z.array(evidenceSchema),
		source_attempts: z.array(sourceAttemptSchema),
	})
	.strict();

const commonRequestShape = {
	activity_attempt: z.number().int().positive(),
	user_id: z.string().min(1),
	request_id: z.string().min(1),
	conversation_id: z.string().min(1),
	visible_function_tool_names: z.array(z.string().min(1)).default([]),
	expected_tool_contract_fingerprint: toolContractFingerprintSchema,
	expected_model_target_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
	limits: runtimeLimitsSchema,
	conversation_context: conversationContextSchema.optional(),
};

const solveRequestSchema = z
	.object({
		...commonRequestShape,
		operation: z.literal("solve"),
		operation_input: z
			.object({ goal: z.string().min(1), max_steps: z.number().int().positive() })
			.strict(),
	})
	.strict();

const executeStepRequestSchema = z
	.object({
		...commonRequestShape,
		operation: z.literal("execute_step"),
		operation_input: z
			.object({
				goal: z.string().min(1),
				plan: taskPlanSchema,
				step: taskPlanStepSchema,
				completed_steps: z.array(completedStepSchema),
				citation_start: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();

const replanRequestSchema = z
	.object({
		...commonRequestShape,
		operation: z.literal("replan"),
		operation_input: z
			.object({
				goal: z.string().min(1),
				plan: taskPlanSchema,
				completed_steps: z.array(completedStepSchema),
				remaining_steps: z.array(taskPlanStepSchema),
				max_remaining_steps: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();

const synthesizeRequestSchema = z
	.object({
		...commonRequestShape,
		operation: z.literal("synthesize"),
		operation_input: z
			.object({
				answer_mode: z.enum(["grounded", "insufficient"]),
				goal: z.string().min(1),
				plan: taskPlanSchema,
				completed_steps: z.array(completedStepSchema),
				evidence: z.array(evidenceSchema),
			})
			.strict(),
	})
	.strict();

export const agentRunRequestSchema = z
	.discriminatedUnion("operation", [
		solveRequestSchema,
		executeStepRequestSchema,
		replanRequestSchema,
		synthesizeRequestSchema,
	])
	.superRefine((value, context) => {
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
	});

export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

function mapToolContractFingerprint(
	fingerprint: z.infer<typeof toolContractFingerprintSchema>,
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
			answerMode: parsed.operation_input.answer_mode,
			completedSteps: parsed.operation_input.completed_steps.map(mapCompletedStep),
			evidence: parsed.operation_input.evidence.map(mapEvidence),
			goal: parsed.operation_input.goal,
			plan: mapTaskPlan(parsed.operation_input.plan),
		},
	} satisfies SynthesizeWorkflowOperationInput;
}

function mapConversationContext(
	value: z.infer<typeof conversationContextSchema>,
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

function mapTaskPlan(value: z.infer<typeof taskPlanSchema>): TaskPlan {
	return {
		goal: value.goal,
		schemaVersion: value.schema_version,
		steps: value.steps.map(mapTaskPlanStep),
	};
}

function mapTaskPlanStep(value: z.infer<typeof taskPlanStepSchema>): TaskPlanStep {
	return {
		candidateSources: [...value.candidate_sources] as WorkflowSource[],
		dependsOn: [...value.depends_on],
		id: value.id,
		objective: value.objective,
	};
}

function mapEvidence(value: z.infer<typeof evidenceSchema>): WorkflowEvidence {
	const result: WorkflowEvidence = {
		excerpt: value.excerpt,
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

function mapCompletedStep(value: z.infer<typeof completedStepSchema>): CompletedTaskStep {
	return {
		remainingFacts: value.remaining_facts,
		...(value.failure ? { failure: value.failure } : {}),
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
