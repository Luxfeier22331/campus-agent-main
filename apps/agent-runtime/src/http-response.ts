import { createHash, timingSafeEqual } from "node:crypto";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./agent-run-contract.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";

export function agentRunStreamResponse(
	events: ReturnType<PrimaryAgentRuntime["stream"]>,
	options: {
		deadlineSignal?: AbortSignal;
		onError?: (error: unknown) => void;
		runtimeRelease: string;
	},
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
								schema_version: "agent_runtime_answer_delta.v3",
								delta: event.data.delta,
							}),
						);
						continue;
					}
					controller.enqueue(
						encodeSseEvent("completed", agentRunResultWire(event.data, options.runtimeRelease)),
					);
					return;
				}
			} catch (error) {
				options.onError?.(error);
				if (!cancelled) {
					controller.enqueue(
						encodeSseEvent("error", {
							...agentRuntimeErrorPayload(
								error,
								options.deadlineSignal ? { deadlineSignal: options.deadlineSignal } : {},
							),
							runtime_release: options.runtimeRelease,
						}),
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

export function agentRunResultWire(result: PrimaryAgentRunResult, runtimeRelease: string) {
	return {
		status: result.status,
		request_id: result.requestId,
		runtime_release: runtimeRelease,
		context_usage: {
			context_chars: result.contextUsage.contextChars,
			current_input_chars: result.contextUsage.currentInputChars,
			model_visible_item_count: result.contextUsage.modelVisibleItemCount,
			...(result.contextUsage.truncationSummary
				? {
						truncation_summary: {
							context_chars_after: result.contextUsage.truncationSummary.contextCharsAfter,
							context_chars_before: result.contextUsage.truncationSummary.contextCharsBefore,
							dropped_category_counts: result.contextUsage.truncationSummary.droppedCategoryCounts,
							model_visible_after_count:
								result.contextUsage.truncationSummary.modelVisibleAfterCount,
							model_visible_before_count:
								result.contextUsage.truncationSummary.modelVisibleBeforeCount,
							policy_version: result.contextUsage.truncationSummary.policyVersion,
							reason: result.contextUsage.truncationSummary.reason,
							schema_version: result.contextUsage.truncationSummary.schemaVersion,
						},
					}
				: {}),
		},
		final_output: result.finalOutput,
		model_name: result.modelName,
		model_provider: result.modelProvider,
		prompt_trace: {
			schema_version: result.promptTrace.schemaVersion,
			prompt_id: result.promptTrace.promptId,
			prompt_template_sha256: result.promptTrace.promptTemplateSha256,
			rendered_prompt_sha256: result.promptTrace.renderedPromptSha256,
		},
		provider_response_id: result.providerResponseId,
		stage_timing: result.stageTiming,
		tool_results: result.toolResults.map((toolResult) => ({
			duration_ms: toolResult.durationMs,
			invocation_id: toolResult.invocationId,
			status: toolResult.status,
			tool_name: toolResult.toolName,
			arguments_json: toolResult.argumentsJson,
			result: toolResult.result,
			...(toolResult.failure
				? {
						failure: {
							code: toolResult.failure.code,
							operation: toolResult.failure.operation,
							...(toolResult.failure.detail ? { detail: toolResult.failure.detail } : {}),
							...(toolResult.failure.httpStatus === undefined
								? {}
								: { http_status: toolResult.failure.httpStatus }),
							...(toolResult.failure.invocationId
								? { invocation_id: toolResult.failure.invocationId }
								: {}),
						},
					}
				: {}),
		})),
		tool_contract_fingerprint: {
			schema_version: result.toolContractFingerprint.schemaVersion,
			tools_sha256: result.toolContractFingerprint.toolsSha256,
			function_schema_sha256: result.toolContractFingerprint.functionSchemaSha256,
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
	if (sharedSecret === "") {
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
	return agentRuntimeErrorPayload(error).message;
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
