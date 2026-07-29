import { createHash, timingSafeEqual } from "node:crypto";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";

export function agentRunStreamResponse(
	events: ReturnType<PrimaryAgentRuntime["stream"]>,
	options: { deadlineSignal?: AbortSignal } = {},
): Response {
	const iterator = events[Symbol.asyncIterator]();
	let cancelled = false;
	let iteratorReturnStarted = false;
	const returnIterator = () => {
		if (iteratorReturnStarted) {
			return;
		}
		iteratorReturnStarted = true;
		try {
			const returned = iterator.return?.();
			if (returned) {
				void Promise.resolve(returned).catch(() => undefined);
			}
		} catch {
			// The downstream transport is already gone; iterator cleanup is best effort.
		}
	};
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let exhausted = false;
			try {
				for (;;) {
					const item = await iterator.next();
					if (cancelled) {
						return;
					}
					if (item.done) {
						exhausted = true;
						throw new Error("Agent runtime stream ended without a terminal event.");
					}
					const event = item.value;
					if (event.event === "answer_delta") {
						controller.enqueue(
							encodeSseEvent("answer_delta", {
								schema_version: "agent_runtime_answer_delta.v2",
								chunk_index: event.data.chunkIndex,
								delta: event.data.delta,
							}),
						);
						continue;
					}
					controller.enqueue(encodeSseEvent("completed", agentRunResultWire(event.data)));
					return;
				}
			} catch (error) {
				if (!cancelled) {
					controller.enqueue(
						encodeSseEvent(
							"error",
							agentRuntimeErrorPayload(error, { deadlineSignal: options.deadlineSignal }),
						),
					);
				}
			} finally {
				if (!exhausted) {
					returnIterator();
				}
				if (!cancelled) {
					controller.close();
				}
			}
		},
		cancel() {
			cancelled = true;
			returnIterator();
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
		stage_timing: result.stageTiming,
		tool_results: result.toolResults.map((toolResult) => ({
			duration_ms: toolResult.durationMs,
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
			runtime_release: result.toolRuntimeFingerprint.runtimeRelease,
			workflow_artifact_schema_version: result.toolRuntimeFingerprint.workflowArtifactSchemaVersion,
			workflow_artifact_registry_version:
				result.toolRuntimeFingerprint.workflowArtifactRegistryVersion,
			workflow_artifact_sha256: result.toolRuntimeFingerprint.workflowArtifactSha256,
			combined_sha256: result.toolRuntimeFingerprint.combinedSha256,
		},
		terminal_reason: result.terminalReason,
		usage: {
			model_request_count: result.usage.modelRequestCount,
			input_tokens: result.usage.inputTokens,
			output_tokens: result.usage.outputTokens,
			cached_input_tokens: result.usage.cachedInputTokens ?? 0,
			usage_observed: result.usage.usageObserved,
		},
	};
}

export function authorized(request: Request, sharedSecret: string): boolean {
	return authorizedBearerValue(request.headers.get("authorization") ?? "", sharedSecret);
}

export function authorizedBearerValue(headerValue: string, sharedSecret: string): boolean {
	if (sharedSecret.trim() === "") {
		return false;
	}
	const actual = createHash("sha256").update(headerValue, "utf8").digest();
	const expected = createHash("sha256").update(`Bearer ${sharedSecret}`, "utf8").digest();
	return timingSafeEqual(actual, expected);
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
	};
}
