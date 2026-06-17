import { z } from "zod";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";

const providerConfigSchema = z.object({
	profile_id: z.string().min(1).optional(),
	revision: z.number().int().nonnegative().optional(),
	provider: z.string().min(1),
	transport: z.literal("responses"),
	base_url: z.string().min(1).optional(),
	model: z.string().min(1),
	api_key: z.string().min(1),
	timeout_ms: z.number().int().positive().optional(),
});

const memoryContextSchema = z.object({
	context_block: z.string().min(1),
	memory_ref: z.string().min(1),
	provider: z.string().min(1).optional(),
	retrieval_mode: z.string().min(1).optional(),
	schema_version: z.literal("memory_recall_result_v1"),
	selected_memory_chars: z.number().int().nonnegative(),
	selected_memory_count: z.number().int().nonnegative(),
});

const runRequestSchema = z.object({
	run_id: z.string().min(1),
	conversation_id: z.string().min(1),
	turn_id: z.string().min(1),
	trace_id: z.string().min(1),
	input: z.string().min(1),
	visible_capabilities: z.array(z.string().min(1)).default([]),
	provider_config: providerConfigSchema,
	memory_context: memoryContextSchema.optional(),
	memory_projection_refs: z.array(z.string().min(1)).optional(),
});

export interface AgentRuntimeHandlerOptions {
	sharedSecret: string;
	runtime: PrimaryAgentRuntime;
}

export type AgentRuntimeHandler = (request: Request) => Promise<Response>;

export function createAgentRuntimeHandler(
	options: AgentRuntimeHandlerOptions,
): AgentRuntimeHandler {
	return async (request) => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/readyz") {
			return jsonResponse(200, { status: "ok" });
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
					error: {
						code: "invalid_request",
						message: error instanceof Error ? error.message : "Invalid request body.",
					},
				});
			}
			let result: PrimaryAgentRunResult;
			try {
				result = await options.runtime.run({
					runId: parsed.run_id,
					conversationId: parsed.conversation_id,
					turnId: parsed.turn_id,
					traceId: parsed.trace_id,
					input: parsed.input,
					visibleCapabilities: parsed.visible_capabilities,
					providerConfig: {
						profileId: parsed.provider_config.profile_id,
						revision: parsed.provider_config.revision,
						provider: parsed.provider_config.provider,
						transport: parsed.provider_config.transport,
						baseUrl: parsed.provider_config.base_url,
						model: parsed.provider_config.model,
						apiKey: parsed.provider_config.api_key,
						timeoutMs: parsed.provider_config.timeout_ms,
					},
					memoryContext: parsed.memory_context
						? {
								contextBlock: parsed.memory_context.context_block,
								memoryRef: parsed.memory_context.memory_ref,
								provider: parsed.memory_context.provider,
								retrievalMode: parsed.memory_context.retrieval_mode,
								schemaVersion: parsed.memory_context.schema_version,
								selectedMemoryChars: parsed.memory_context.selected_memory_chars,
								selectedMemoryCount: parsed.memory_context.selected_memory_count,
							}
						: undefined,
					memoryProjectionRefs: parsed.memory_projection_refs,
					signal: request.signal,
				});
			} catch (error) {
				return jsonResponse(500, {
					error: {
						code: "agent_runtime_failed",
						message: errorMessage(error),
					},
				});
			}
			return jsonResponse(200, {
				status: result.status,
				run_id: result.runId,
				final_output: result.finalOutput,
				provider_response_id: result.providerResponseId,
				sdk_trace_ref: result.sdkTraceRef,
				selected_tools: result.selectedTools,
				tool_results: result.toolResults.map((toolResult) => ({
					status: toolResult.status,
					tool_name: toolResult.toolName,
					capability: toolResult.capability,
					payload_kind: toolResult.payloadKind,
					arguments_json: toolResult.argumentsJson ?? {},
					result: toolResult.result,
					result_ref: toolResult.resultRef,
					fail_close_reason: toolResult.failCloseReason,
				})),
				terminal_reason: result.terminalReason,
				usage: {
					input_tokens: result.usage.inputTokens,
					output_tokens: result.usage.outputTokens,
					cached_input_tokens: result.usage.cachedInputTokens ?? 0,
					estimated_cost_micro_usd: result.usage.estimatedCostMicroUsd ?? 0,
				},
			});
		}
		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	};
}

function authorized(request: Request, sharedSecret: string): boolean {
	if (sharedSecret.trim() === "") {
		return false;
	}
	const header = request.headers.get("authorization") ?? "";
	return header === `Bearer ${sharedSecret}`;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
