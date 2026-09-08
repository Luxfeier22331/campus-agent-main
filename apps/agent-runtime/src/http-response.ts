import { createHash, timingSafeEqual } from "node:crypto";
import type {
	CompletedTaskStep,
	TaskPlan,
	TaskReplan,
	WorkflowEvidence,
	WorkflowOperationResult,
	WorkflowOperationStreamEvent,
} from "./agent-run-contract.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";

export function agentRunStreamResponse(
	events: AsyncIterable<WorkflowOperationStreamEvent>,
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
						controller.enqueue(
							encodeSseEvent("answer_delta", {
								schema_version: "workflow_runtime_answer_delta.v1",
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

export function agentRunResultWire(result: WorkflowOperationResult, runtimeRelease: string) {
	return {
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
		...(result.answerMode ? { answer_mode: result.answerMode } : {}),
		...(result.solveOutcome === undefined ? {} : { solve_outcome: result.solveOutcome }),
		...(result.structuredOutput === undefined
			? {}
			: { structured_output: structuredOutputWire(result.structuredOutput) }),
		...(result.completedStep === undefined
			? {}
			: { completed_step: completedStepWire(result.completedStep) }),
		evidence: result.evidence.map(evidenceWire),
		source_attempts: result.sourceAttempts.map((attempt) => ({
			source: attempt.source,
			status: attempt.status,
			...(attempt.failureCode ? { failure_code: attempt.failureCode } : {}),
		})),
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
		web_citations: result.webCitations.map((citation) => ({
			end_index: citation.endIndex,
			start_index: citation.startIndex,
			title: citation.title,
			url: citation.url,
		})),
		web_search_used: result.webSearchUsed,
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

function completedStepWire(step: CompletedTaskStep) {
	return {
		evidence: step.evidence.map(evidenceWire),
		execution_index: step.executionIndex,
		source_attempts: step.sourceAttempts.map((attempt) => ({
			source: attempt.source,
			status: attempt.status,
			...(attempt.failureCode ? { failure_code: attempt.failureCode } : {}),
		})),
		step: taskPlanStepWire(step.step),
		summary: step.summary,
		remaining_facts: step.remainingFacts,
		...(step.failure
			? { failure: { code: step.failure.code, operation: step.failure.operation } }
			: {}),
	};
}

function evidenceWire(evidence: WorkflowEvidence) {
	return {
		excerpt: evidence.excerpt,
		id: evidence.id,
		schema_version: evidence.schemaVersion,
		source: evidence.source,
		title: evidence.title,
		...(evidence.citationIndex === undefined ? {} : { citation_index: evidence.citationIndex }),
		...(evidence.url === undefined ? {} : { url: evidence.url }),
		...(evidence.resultRef === undefined ? {} : { result_ref: evidence.resultRef }),
		...(evidence.documentId === undefined ? {} : { document_id: evidence.documentId }),
		...(evidence.noticeId === undefined ? {} : { notice_id: evidence.noticeId }),
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
