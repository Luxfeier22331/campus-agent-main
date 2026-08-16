import { propagateAttributes } from "@langfuse/tracing";
import { z } from "zod";
import {
	agentRunResultWire,
	agentRunStreamResponse,
	authorized,
	jsonResponse,
} from "./http-response.ts";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";
import { bindAsyncIterableToActiveContext } from "./telemetry.ts";
import type { ToolRuntimeFingerprint } from "./tool-catalog.ts";

const providerConfigSchema = z.object({
	provider: z.string().min(1),
	transport: z.enum(["responses", "chat_completions"]),
	base_url: z.string().min(1).optional(),
	model: z.string().min(1),
	api_key: z.string().min(1),
});

const toolRuntimeFingerprintSchema = z
	.object({
		combined_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
		function_schema_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
		function_schema_version: z.string().min(1),
		runtime_release: z.string().min(1),
		schema_version: z.literal("tool_runtime_fingerprint.v2"),
		tools_registry_version: z.string().min(1),
		tools_schema_version: z.string().min(1),
		tools_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	})
	.strict();

const campusDocsEvidenceSchema = z
	.object({
		evidence_ref: z.string().regex(/^evidence:\/\/[0-9a-f]{64}$/),
		document_title: z.string().trim().min(1),
		section_title: z.string().trim().min(1),
		text: z.string().trim().min(1),
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

const runRequestSchema = z
	.object({
		activity_attempt: z.number().int().positive(),
		user_id: z.string().min(1),
		run_id: z.string().min(1),
		request_id: z.string().min(1),
		conversation_id: z.string().min(1),
		turn_id: z.string().min(1),
		trace_id: z.string().min(1),
		input: z.string().min(1),
		visible_tool_names: z.array(z.string().min(1)).default([]),
		campus_docs_evidence: z.array(campusDocsEvidenceSchema).max(8),
		expected_tool_runtime_fingerprint: toolRuntimeFingerprintSchema,
		provider_config: providerConfigSchema,
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

function mapToolRuntimeFingerprint(
	fingerprint: z.infer<typeof toolRuntimeFingerprintSchema>,
): ToolRuntimeFingerprint {
	return {
		combinedSha256: fingerprint.combined_sha256,
		functionSchemaSha256: fingerprint.function_schema_sha256,
		functionSchemaVersion:
			fingerprint.function_schema_version as ToolRuntimeFingerprint["functionSchemaVersion"],
		runtimeRelease: fingerprint.runtime_release,
		schemaVersion: fingerprint.schema_version,
		toolsRegistryVersion: fingerprint.tools_registry_version,
		toolsSchemaVersion:
			fingerprint.tools_schema_version as ToolRuntimeFingerprint["toolsSchemaVersion"],
		toolsSha256: fingerprint.tools_sha256,
	};
}

export interface AgentRuntimeHandlerOptions {
	onStreamError?: (error: unknown) => void;
	sharedSecret: string;
	runtime: PrimaryAgentRuntime;
}

export type AgentRuntimeHandler = (request: Request) => Promise<Response>;

export function createAgentRuntimeHandler(
	options: AgentRuntimeHandlerOptions,
): AgentRuntimeHandler {
	return async (request) => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, { status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/readyz") {
			return options.sharedSecret
				? jsonResponse(200, { status: "ready" })
				: jsonResponse(503, {
						error: {
							code: "dependency_not_ready",
							message: "Agent runtime authorization is not configured.",
						},
					});
		}
		if (request.method === "GET" && url.pathname === "/internal/readyz") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			return jsonResponse(200, { status: "ready" });
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-runs") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			let parsed: z.infer<typeof runRequestSchema>;
			try {
				parsed = runRequestSchema.parse(await request.json());
			} catch (error) {
				return jsonResponse(400, {
					error: requestValidationError(error),
				});
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			let result: PrimaryAgentRunResult;
			try {
				result = await withAgentTraceAttributes(parsed, () =>
					options.runtime.run(runtimeInputFromParsedRunRequest(parsed, signals.signal)),
				);
			} catch (error) {
				return jsonResponse(500, {
					error: agentRuntimeErrorPayload(error, { deadlineSignal: signals.deadlineSignal }),
				});
			}
			return jsonResponse(200, agentRunResultWire(result));
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-runs/stream") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			let parsed: z.infer<typeof runRequestSchema>;
			try {
				parsed = runRequestSchema.parse(await request.json());
			} catch (error) {
				return jsonResponse(400, {
					error: requestValidationError(error),
				});
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			return withAgentTraceAttributes(parsed, () =>
				agentRunStreamResponse(
					bindAsyncIterableToActiveContext(
						options.runtime.stream(runtimeInputFromParsedRunRequest(parsed, signals.signal)),
					),
					{
						deadlineSignal: signals.deadlineSignal,
						...(options.onStreamError ? { onError: options.onStreamError } : {}),
					},
				),
			);
		}
		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	};
}

function withAgentTraceAttributes<T>(
	parsed: z.infer<typeof runRequestSchema>,
	callback: () => T,
): T {
	return propagateAttributes(
		{
			asBaggage: false,
			metadata: {
				request_id: parsed.request_id,
				run_id: parsed.run_id,
				trace_id: parsed.trace_id,
				turn_id: parsed.turn_id,
			},
			sessionId: parsed.conversation_id,
			tags: ["surface:agent-runtime"],
			traceName: "online-answer",
			userId: parsed.user_id,
		},
		callback,
	);
}

function runtimeInputFromParsedRunRequest(
	parsed: z.infer<typeof runRequestSchema>,
	signal: AbortSignal,
): Parameters<PrimaryAgentRuntime["run"]>[0] {
	return {
		activityAttempt: parsed.activity_attempt,
		campusDocsEvidence: parsed.campus_docs_evidence.map((item) => ({
			documentTitle: item.document_title,
			evidenceRef: item.evidence_ref,
			sectionTitle: item.section_title,
			text: item.text,
		})),
		runId: parsed.run_id,
		requestId: parsed.request_id,
		conversationId: parsed.conversation_id,
		turnId: parsed.turn_id,
		traceId: parsed.trace_id,
		input: parsed.input,
		visibleToolNames: parsed.visible_tool_names,
		expectedToolRuntimeFingerprint: mapToolRuntimeFingerprint(
			parsed.expected_tool_runtime_fingerprint,
		),
		providerConfig: {
			provider: parsed.provider_config.provider,
			transport: parsed.provider_config.transport,
			...(parsed.provider_config.base_url ? { baseUrl: parsed.provider_config.base_url } : {}),
			model: parsed.provider_config.model,
			apiKey: parsed.provider_config.api_key,
		},
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

function requestValidationError(error: unknown) {
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

function runtimeSignals(parent: AbortSignal, deadlineMs: number) {
	const deadlineSignal = AbortSignal.timeout(deadlineMs);
	return {
		deadlineSignal,
		signal: AbortSignal.any([parent, deadlineSignal]),
	};
}
