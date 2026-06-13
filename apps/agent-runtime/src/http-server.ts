import { z } from "zod";
import type { PrimaryAgentRuntime } from "./primary-agent.ts";

const runRequestSchema = z.object({
	run_id: z.string().min(1),
	conversation_id: z.string().min(1),
	turn_id: z.string().min(1),
	trace_id: z.string().min(1),
	input: z.string().min(1),
	visible_capabilities: z.array(z.string().min(1)).default([]),
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
			const result = await options.runtime.run({
				runId: parsed.run_id,
				conversationId: parsed.conversation_id,
				turnId: parsed.turn_id,
				traceId: parsed.trace_id,
				input: parsed.input,
				visibleCapabilities: parsed.visible_capabilities,
				memoryProjectionRefs: parsed.memory_projection_refs,
			});
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
