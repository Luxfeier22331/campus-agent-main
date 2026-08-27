import { z } from "zod";
import type { PrimaryAgentRunInput, PromptProviderRuntimeConfig } from "./agent-run-contract.ts";
import type { ToolContractFingerprint } from "./tool-catalog.ts";

const toolContractFingerprintSchema = z
	.object({
		function_schema_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
		schema_version: z.literal("tool_contract_fingerprint.v1"),
		tools_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	})
	.strict();

const conversationContextSchema = z.object({
	schema_version: z.literal("agent_conversation_context.v1"),
	recent_turns: z
		.array(
			z.object({
				message_id: z.string().min(1).optional(),
				role: z.enum(["assistant", "user"]),
				content: z.string().min(1),
			}),
		)
		.default([]),
	session_state: z
		.object({
			confirmed_slots: z
				.array(
					z.object({
						confirmed: z.boolean(),
						name: z.string().min(1),
						value: z.string().min(1),
					}),
				)
				.default([]),
		})
		.optional(),
});

const runtimeLimitsSchema = z
	.object({
		agent_deadline_ms: z.number().int().positive(),
		context_char_limit: z.number().int().positive(),
		current_input_char_limit: z.number().int().positive(),
		max_output_tokens: z.number().int().positive(),
		max_tool_calls: z.number().int().nonnegative(),
		max_turns: z.number().int().positive(),
	})
	.strict();

export const agentRunRequestSchema = z
	.object({
		activity_attempt: z.number().int().positive(),
		user_id: z.string().min(1),
		request_id: z.string().min(1),
		conversation_id: z.string().min(1),
		input: z.string().min(1),
		visible_tool_names: z.array(z.string().min(1)).default([]),
		expected_tool_contract_fingerprint: toolContractFingerprintSchema,
		expected_model_target_sha256: z.string().regex(/^[0-9a-f]{64}$/),
		limits: runtimeLimitsSchema,
		conversation_context: conversationContextSchema.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if ([...value.input].length > value.limits.current_input_char_limit) {
			context.addIssue({
				code: "custom",
				message: "input exceeds limits.current_input_char_limit",
				path: ["input"],
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
): PrimaryAgentRunInput {
	return {
		activityAttempt: parsed.activity_attempt,
		requestId: parsed.request_id,
		conversationId: parsed.conversation_id,
		input: parsed.input,
		visibleToolNames: parsed.visible_tool_names,
		expectedToolContractFingerprint: mapToolContractFingerprint(
			parsed.expected_tool_contract_fingerprint,
		),
		providerConfig,
		limits: {
			agentDeadlineMs: parsed.limits.agent_deadline_ms,
			contextCharLimit: parsed.limits.context_char_limit,
			currentInputCharLimit: parsed.limits.current_input_char_limit,
			maxOutputTokens: parsed.limits.max_output_tokens,
			maxToolCalls: parsed.limits.max_tool_calls,
			maxTurns: parsed.limits.max_turns,
		},
		...(parsed.conversation_context
			? {
					conversationContext: {
						schemaVersion: parsed.conversation_context.schema_version,
						recentTurns: parsed.conversation_context.recent_turns.map((turn) => ({
							...(turn.message_id ? { messageId: turn.message_id } : {}),
							role: turn.role,
							content: turn.content,
						})),
						...(parsed.conversation_context.session_state
							? {
									sessionState: {
										confirmedSlots: parsed.conversation_context.session_state.confirmed_slots.map(
											(slot) => ({
												confirmed: slot.confirmed,
												name: slot.name,
												value: slot.value,
											}),
										),
									},
								}
							: {}),
					},
				}
			: {}),
		signal,
	};
}

export function agentRunRequestValidationError(error: unknown) {
	const contextBudgetExceeded =
		error instanceof z.ZodError &&
		error.issues.some((issue) => issue.code === "custom" && issue.path[0] === "input");
	return {
		code: contextBudgetExceeded ? "context_budget_exceeded" : "invalid_request",
		message: contextBudgetExceeded
			? "The agent runtime context exceeded its configured budget."
			: "The agent runtime request is invalid.",
		retryable: false,
	};
}
