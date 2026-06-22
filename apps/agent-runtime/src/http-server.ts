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

const finalModelContextSchema = z.object({
	schema_version: z.literal("final_model_context.v1"),
	current_user_message: z.string().min(1),
	recent_turns: z
		.array(
			z.object({
				message_id: z.string().min(1).optional(),
				role: z.enum(["assistant", "user"]),
				content: z.string().optional(),
				summary: z.string().optional(),
			}),
		)
		.default([]),
	previous_answer_summary: z.string().optional(),
	previous_evidence: z
		.array(
			z.object({
				access_scope: z.string().min(1),
				content_hash: z.string().min(1),
				document_id: z.string().min(1).optional(),
				evidence_id: z.string().min(1),
				section_title: z.string().min(1).optional(),
				snapshot_id: z.string().min(1).optional(),
				snippet: z.string().optional(),
				source_id: z.string().min(1),
				title: z.string().optional(),
				version_id: z.string().min(1).optional(),
			}),
		)
		.default([]),
	previous_capability_results: z
		.array(
			z.object({
				capability: z.string().min(1),
				content_hash: z.string().min(1),
				projection_ref: z.string().min(1),
				request_id: z.string().min(1),
				result_kind: z.string().min(1),
				run_id: z.string().min(1),
				status: z.string().min(1),
				summary: z.string().optional(),
			}),
		)
		.default([]),
	usage_summary: z.object({
		memory_recall_state: z.enum(["completed", "skipped"]),
		model_visible_item_count: z.number().int().nonnegative(),
		runtime_only_item_count: z.number().int().nonnegative(),
		token_estimate: z.number().int().nonnegative(),
		truncation_reason: z.string().min(1).optional(),
	}),
});

const runRequestSchema = z.object({
	run_id: z.string().min(1),
	conversation_id: z.string().min(1),
	turn_id: z.string().min(1),
	trace_id: z.string().min(1),
	input: z.string().min(1),
	visible_capabilities: z.array(z.string().min(1)).default([]),
	provider_config: providerConfigSchema,
	final_model_context: finalModelContextSchema.optional(),
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
					finalModelContext: parsed.final_model_context
						? {
								schemaVersion: parsed.final_model_context.schema_version,
								currentUserMessage: parsed.final_model_context.current_user_message,
								recentTurns: parsed.final_model_context.recent_turns.map((turn) => ({
									messageId: turn.message_id,
									role: turn.role,
									content: turn.content,
									summary: turn.summary,
								})),
								previousAnswerSummary: parsed.final_model_context.previous_answer_summary,
								previousEvidence: parsed.final_model_context.previous_evidence.map((evidence) => ({
									accessScope: evidence.access_scope,
									contentHash: evidence.content_hash,
									documentId: evidence.document_id,
									evidenceId: evidence.evidence_id,
									sectionTitle: evidence.section_title,
									snapshotId: evidence.snapshot_id,
									snippet: evidence.snippet,
									sourceId: evidence.source_id,
									title: evidence.title,
									versionId: evidence.version_id,
								})),
								previousCapabilityResults:
									parsed.final_model_context.previous_capability_results.map((result) => ({
										capability: result.capability,
										contentHash: result.content_hash,
										projectionRef: result.projection_ref,
										requestId: result.request_id,
										resultKind: result.result_kind,
										runId: result.run_id,
										status: result.status,
										summary: result.summary,
									})),
								usageSummary: {
									memoryRecallState: parsed.final_model_context.usage_summary.memory_recall_state,
									modelVisibleItemCount:
										parsed.final_model_context.usage_summary.model_visible_item_count,
									runtimeOnlyItemCount:
										parsed.final_model_context.usage_summary.runtime_only_item_count,
									tokenEstimate: parsed.final_model_context.usage_summary.token_estimate,
									truncationReason: parsed.final_model_context.usage_summary.truncation_reason,
								},
							}
						: undefined,
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
				model_name: result.modelName,
				model_provider: result.modelProvider,
				terminal_envelope: terminalEnvelopeWire(result.terminalEnvelope),
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

function terminalEnvelopeWire(envelope: PrimaryAgentRunResult["terminalEnvelope"]) {
	if (envelope === undefined) {
		return;
	}
	return {
		kind: envelope.kind,
		answer_text: envelope.answerText,
		follow_up_question: envelope.followUpQuestion,
		reason: envelope.reason,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
