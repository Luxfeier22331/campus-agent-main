import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";

export function agentRunStreamResponse(
	events: ReturnType<PrimaryAgentRuntime["stream"]>,
): Response {
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of events) {
					if (event.event === "answer_delta") {
						controller.enqueue(
							encodeSseEvent("answer_delta", {
								schema_version: "agent_runtime_answer_delta.v1",
								accumulated_text: event.data.accumulatedText,
								chunk_index: event.data.chunkIndex,
								delta: event.data.delta,
							}),
						);
						continue;
					}
					controller.enqueue(encodeSseEvent("completed", agentRunResultWire(event.data)));
				}
			} catch (error) {
				controller.enqueue(
					encodeSseEvent("error", {
						code: "agent_runtime_failed",
						message: errorMessage(error),
					}),
				);
			} finally {
				controller.close();
			}
		},
	});
	return new Response(stream, {
		headers: {
			"cache-control": "no-store",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		},
		status: 200,
	});
}

export function agentRunResultWire(result: PrimaryAgentRunResult) {
	return {
		status: result.status,
		run_id: result.runId,
		final_output: result.finalOutput,
		model_name: result.modelName,
		model_provider: result.modelProvider,
		prompt_trace: {
			schema_version: result.promptTrace.schemaVersion,
			prompt_id: result.promptTrace.promptId,
			prompt_template_sha256: result.promptTrace.promptTemplateSha256,
			rendered_prompt_sha256: result.promptTrace.renderedPromptSha256,
		},
		terminal_envelope: terminalEnvelopeWire(result.terminalEnvelope),
		provider_response_id: result.providerResponseId,
		sdk_trace_ref: result.sdkTraceRef,
		debug_trace_refs: debugTraceRefsWire(result.debugTraceRefs),
		selected_tools: result.selectedTools,
		stage_timing: result.stageTiming,
		tool_results: result.toolResults.map((toolResult) => ({
			status: toolResult.status,
			tool_name: toolResult.toolName,
			payload_kind: toolResult.payloadKind,
			arguments_json: toolResult.argumentsJson ?? {},
			result: toolResult.result,
			result_ref: toolResult.resultRef,
			fail_close_reason: toolResult.failCloseReason,
		})),
		tool_runtime_fingerprint: {
			schema_version: result.toolRuntimeFingerprint.schemaVersion,
			tools_schema_version: result.toolRuntimeFingerprint.toolsSchemaVersion,
			tools_registry_version: result.toolRuntimeFingerprint.toolsRegistryVersion,
			tools_sha256: result.toolRuntimeFingerprint.toolsSha256,
			function_schema_version: result.toolRuntimeFingerprint.functionSchemaVersion,
			function_schema_sha256: result.toolRuntimeFingerprint.functionSchemaSha256,
			workflow_artifact_schema_version: result.toolRuntimeFingerprint.workflowArtifactSchemaVersion,
			workflow_artifact_registry_version:
				result.toolRuntimeFingerprint.workflowArtifactRegistryVersion,
			workflow_artifact_sha256: result.toolRuntimeFingerprint.workflowArtifactSha256,
			combined_sha256: result.toolRuntimeFingerprint.combinedSha256,
		},
		terminal_reason: result.terminalReason,
		usage: {
			input_tokens: result.usage.inputTokens,
			output_tokens: result.usage.outputTokens,
			cached_input_tokens: result.usage.cachedInputTokens ?? 0,
			estimated_cost_micro_usd: result.usage.estimatedCostMicroUsd ?? 0,
		},
	};
}

export function authorized(request: Request, sharedSecret: string): boolean {
	if (sharedSecret.trim() === "") {
		return false;
	}
	const header = request.headers.get("authorization") ?? "";
	return header === `Bearer ${sharedSecret}`;
}

export function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function debugTraceRefsWire(refs: PrimaryAgentRunResult["debugTraceRefs"] | undefined) {
	if (!refs) {
		return [];
	}
	return refs.map((ref) => ({
		sink: ref.sink,
		trace_id: ref.traceId,
		trace_ref: ref.traceRef,
		url: ref.url,
	}));
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
		evidence_refs: envelope.evidenceRefs,
		resolved_scope: envelope.resolvedScope,
		session_update: envelope.sessionUpdate
			? {
					upsert_slots: envelope.sessionUpdate.upsertSlots.map((slot) => ({
						confirmed: slot.confirmed,
						name: slot.name,
						value: slot.value,
					})),
				}
			: undefined,
	};
}
