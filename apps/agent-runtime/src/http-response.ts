import { createHash, timingSafeEqual } from "node:crypto";
import type {
	TaskPlan,
	TaskReplan,
	WorkflowEvidence,
	WorkflowOperationResult,
	WorkflowOperationStreamEvent,
} from "./agent-run-contract.ts";
import { encodeOperationPayload } from "./operation-payload.ts";
import { waitForRuntimeWork } from "./runtime-cancellation.ts";
import { type AgentRuntimeErrorPayload, agentRuntimeErrorPayload } from "./runtime-errors.ts";

export function agentRunStreamResponse(
	events: AsyncIterable<WorkflowOperationStreamEvent>,
	options: {
		deadlineSignal?: AbortSignal;
		signal?: AbortSignal;
		onClose?: () => void;
		onCancel?: () => void;
		operation?: string;
		onError?: (error: unknown, failure: AgentRuntimeErrorPayload) => void;
		runtimeRelease: string;
	},
): Response {
	const iterator = events[Symbol.asyncIterator]();
	const stopped = new AbortController();
	const signal = AbortSignal.any([
		stopped.signal,
		...(options.signal ? [options.signal] : []),
		...(options.deadlineSignal ? [options.deadlineSignal] : []),
	]);
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
			let provisionalDeltaSent = false;
			try {
				for (;;) {
					const item = await waitForRuntimeWork(signal, () => iterator.next());
					if (cancelled) {
						return;
					}
					if (item.done) {
						exhausted = true;
						throw new Error("Agent runtime stream ended without a terminal event.");
					}
					const event = item.value;
					if (event.event === "retrieval_status") {
						controller.enqueue(
							encodeSseEvent("retrieval_status", {
								schema_version: "workflow_runtime_retrieval_status.v1",
								source: event.data.source,
								status: event.data.status,
								occurred_at: event.data.occurredAt,
							}),
						);
						continue;
					}
					if (event.event === "solve_decision") {
						controller.enqueue(
							encodeSseEvent("solve_decision", {
								schema_version: "workflow_runtime_solve_decision.v1",
								outcome: event.data.outcome,
							}),
						);
						continue;
					}
					if (event.event === "answer_delta") {
						provisionalDeltaSent = true;
						controller.enqueue(
							encodeSseEvent("answer_delta", {
								schema_version: "workflow_runtime_answer_delta.v2",
								delta: event.data.delta,
								provisional: true,
							}),
						);
						continue;
					}
					const terminal = encodeSseEvent(
						event.event,
						agentRunResultWire(event.data, options.runtimeRelease),
					);
					if (event.event === "failed" && provisionalDeltaSent) {
						controller.enqueue(
							encodeSseEvent("answer_invalidated", {
								schema_version: "workflow_runtime_answer_invalidation.v1",
								reason: "terminal_result_unavailable",
							}),
						);
					}
					controller.enqueue(terminal);
					return;
				}
			} catch (error) {
				if (cancelled) {
					return;
				}
				const failure = agentRuntimeErrorPayload(error, {
					...(options.deadlineSignal ? { deadlineSignal: options.deadlineSignal } : {}),
					...(options.operation ? { operation: options.operation } : {}),
				});
				try {
					options.onError?.(error, failure);
				} catch {
					// Diagnostics must not prevent the terminal error event.
				}
				if (!cancelled) {
					if (provisionalDeltaSent) {
						controller.enqueue(
							encodeSseEvent("answer_invalidated", {
								schema_version: "workflow_runtime_answer_invalidation.v1",
								reason: "terminal_result_unavailable",
							}),
						);
					}
					controller.enqueue(
						encodeSseEvent("error", {
							...failure,
							runtime_release: options.runtimeRelease,
						}),
					);
				}
			} finally {
				options.onClose?.();
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
			stopped.abort();
			options.onCancel?.();
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

export function agentRunResultWire(result: WorkflowOperationResult, runtimeRelease: string) {
	const isSynthesis = result.operation === "synthesize";
	const payload = {
		...(result.webEvidence && result.webEvidence.length > 0
			? {
					web_evidence: result.webEvidence.map((item) => ({
						title: item.title,
						...(item.sourceLink ? { source_link: item.sourceLink } : {}),
						url: item.url,
						excerpt: item.excerpt,
						start_index: item.startIndex,
						end_index: item.endIndex,
					})),
				}
			: {}),
		...(result.webSearchDiagnostic ? { web_search_diagnostic: result.webSearchDiagnostic } : {}),
		...(result.modelOutputDiagnostic
			? { model_output_diagnostic: result.modelOutputDiagnostic }
			: {}),
		...(result.failure
			? {
					failure: {
						code: result.failure.code,
						...(result.failure.reason ? { reason: result.failure.reason } : {}),
						...(result.failure.citation ? { citation: result.failure.citation } : {}),
						operation: result.failure.operation,
						...(result.failure.detail ? { detail: result.failure.detail } : {}),
						...(result.failure.httpStatus === undefined
							? {}
							: { http_status: result.failure.httpStatus }),
						...(result.failure.invocationId ? { invocation_id: result.failure.invocationId } : {}),
					},
				}
			: {}),
		...(result.answerStarted ? { answer_started: true } : {}),
		operation: result.operation,
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
		...(result.solveOutcome === undefined ? {} : { solve_outcome: result.solveOutcome }),
		...(result.plan ? { plan: structuredOutputWire(result.plan) } : {}),
		...(result.replan ? { replan: structuredOutputWire(result.replan) } : {}),
		...(result.remainingFacts ? { remaining_facts: result.remainingFacts } : {}),
		...(isSynthesis
			? {}
			: {
					evidence: result.evidence.map(evidenceWire),
					source_attempts: result.sourceAttempts.map((attempt) => ({
						source: attempt.source,
						status: attempt.status,
						...(attempt.failureCode ? { failure_code: attempt.failureCode } : {}),
					})),
				}),
		model_name: result.modelName,
		model_provider: result.modelProvider,
		provider_response_id: result.providerResponseId,
		stage_timing: result.stageTiming,
		tool_results: result.toolResults.map((toolResult) => ({
			duration_ms: toolResult.durationMs,
			invocation_id: toolResult.invocationId,
			status: toolResult.status,
			tool_name: toolResult.toolName,
			arguments_json: toolResult.argumentsJson,
			result: toolResult.result,
			...(toolResult.startedAt ? { started_at: toolResult.startedAt } : {}),
			...(toolResult.completedAt ? { completed_at: toolResult.completedAt } : {}),
			...(toolResult.failure
				? {
						failure: {
							code: toolResult.failure.code,
							...(toolResult.failure.reason ? { reason: toolResult.failure.reason } : {}),
							...(toolResult.failure.citation ? { citation: toolResult.failure.citation } : {}),
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
	return payload;
}

function structuredOutputWire(value: TaskPlan | TaskReplan): Record<string, unknown> {
	if (value.schemaVersion === "task_plan.v1") {
		return {
			goal: value.goal,
			schema_version: value.schemaVersion,
			steps: value.steps.map(taskPlanStepWire),
		};
	}
	return {
		decision: value.decision,
		reason: value.reason,
		remaining_steps: value.remainingSteps.map(taskPlanStepWire),
		schema_version: value.schemaVersion,
	};
}

function taskPlanStepWire(step: TaskPlan["steps"][number]) {
	return {
		candidate_sources: step.candidateSources,
		depends_on: step.dependsOn,
		id: step.id,
		objective: step.objective,
	};
}

function evidenceWire(evidence: WorkflowEvidence) {
	return {
		excerpt: evidence.excerpt,
		id: evidence.id,
		schema_version: evidence.schemaVersion,
		source: evidence.source,
		title: evidence.title,
		...(evidence.sourceLink ? { source_link: evidence.sourceLink } : {}),
		...(evidence.citationIndex === undefined ? {} : { citation_index: evidence.citationIndex }),
		...(evidence.url === undefined ? {} : { url: evidence.url }),
		...(evidence.resultRef === undefined ? {} : { result_ref: evidence.resultRef }),
		...(evidence.documentId === undefined ? {} : { document_id: evidence.documentId }),
		...(evidence.noticeId === undefined ? {} : { notice_id: evidence.noticeId }),
		...(evidence.releasedAt === undefined ? {} : { released_at: evidence.releasedAt }),
		...(evidence.citationHref === undefined ? {} : { citation_href: evidence.citationHref }),
		...(evidence.sectionRef === undefined ? {} : { section_ref: evidence.sectionRef }),
		...(evidence.sectionTitle === undefined ? {} : { section_title: evidence.sectionTitle }),
		...(evidence.rootUnitIds === undefined ? {} : { root_unit_ids: evidence.rootUnitIds }),
		...(evidence.versionId === undefined ? {} : { version_id: evidence.versionId }),
		...(evidence.versionSlug === undefined ? {} : { version_slug: evidence.versionSlug }),
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
	return new Response(encodeOperationPayload(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function errorMessage(error: unknown): string {
	return agentRuntimeErrorPayload(error).message;
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${encodeOperationPayload(data)}\n\n`);
}
