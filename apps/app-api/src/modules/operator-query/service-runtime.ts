import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRunStep,
	ExecutionControlRunStepTrajectory,
	ExecutionControlStepAttempt,
	ExecutionControlStepResult,
} from "../integration";
import { runtimeRunPhaseFromExecutionStatus } from "../runtime-run";
import {
	isAllowedTimeseriesGranularity,
	normalizeAuditListFilters,
	normalizeOptionalString,
	normalizeOverviewFilters,
	normalizeQualityBadcaseListFilters,
	normalizeRequestListFilters,
	normalizeSafetyAnomalyListFilters,
	normalizeTemporalTaskQueueListFilters,
	normalizeWorkerAutoscalerActuationListFilters,
	normalizeWorkerAutoscalerDecisionListFilters,
	normalizeWorkerAutoscalerPostureListFilters,
} from "./service-normalization";
import type {
	NormalizedOperatorOverviewFilters,
	OperatorQualityBadcaseListResult,
	OperatorQualityEvalCandidateListResult,
	OperatorQueryService,
	OperatorQueryServiceDependencies,
	OperatorRequestObservabilityRecord,
	OperatorRuntimeRunEventSummary,
	OperatorRuntimeRunSummary,
} from "./service-types";
import { inferEvalFamilyFromCauseClass } from "./store/shared";

function validateTimeseriesGranularity(filters: NormalizedOperatorOverviewFilters): void {
	if (!filters.granularity) {
		return;
	}

	if (!isAllowedTimeseriesGranularity(filters.window, filters.granularity)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "window and granularity combination is invalid.",
			retryable: false,
			status: 400,
		});
	}
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
	if (!principal.permissions.operator) {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function toQualityEvalCandidates(badcases: OperatorQualityBadcaseListResult) {
	return {
		candidates: badcases.badcases.map((badcase) => ({
			candidateId: `eval_candidate:${badcase.badcaseId}`,
			causeClass: badcase.causeClass,
			diagnosisStage: badcase.diagnosisStage,
			grade: badcase.grade,
			intake: {
				createdAt: badcase.openedAt,
				source: "operator_badcase" as const,
				status: "pending_review" as const,
				suggestedEvalFamily: inferEvalFamilyFromCauseClass(badcase.causeClass),
			},
			links: badcase.links,
			requestId: badcase.requestId,
			runId: badcase.runId,
			selectedTool: badcase.selectedTool,
			summary: badcase.summary,
			surface: badcase.surface,
			traceId: badcase.traceId,
		})),
		page: badcases.page,
	};
}

function emptyQualityEvalCandidates(): OperatorQualityEvalCandidateListResult {
	return {
		candidates: [],
		page: {
			nextCursor: null,
		},
	};
}

function mergeQualityEvalCandidates(
	first: OperatorQualityEvalCandidateListResult,
	second: OperatorQualityEvalCandidateListResult,
	limit: number,
): OperatorQualityEvalCandidateListResult {
	return {
		candidates: [...first.candidates, ...second.candidates]
			.sort((a, b) => Date.parse(b.intake.createdAt) - Date.parse(a.intake.createdAt))
			.slice(0, limit),
		page: {
			nextCursor: first.page.nextCursor ?? second.page.nextCursor,
		},
	};
}

const TERMINAL_RUN_EVENT_TYPES = new Set([
	"finalization.completed",
	"run.completed",
	"run.failed",
	"run.canceled",
	"run.expired",
]);

function toRuntimeRunEventSummary(event: ExecutionControlRunEvent): OperatorRuntimeRunEventSummary {
	return {
		eventType: event.eventType,
		occurredAt: event.occurredAt,
		sequence: event.sequence,
		visibility: event.visibility,
	};
}

function assertDurableRunMatchesRequest(
	request: OperatorRequestObservabilityRecord["request"],
	run: ExecutionControlRun,
): void {
	if (
		run.runId !== request.runId ||
		run.requestId !== request.requestId ||
		run.conversationId !== request.conversationId ||
		run.traceId !== request.traceId
	) {
		throw new AppApiRouteError({
			code: "durable_run_identity_drift",
			message: "Durable run identity does not match operator request projection.",
			retryable: true,
			status: 502,
		});
	}
}

function assertDurableEventMatchesRun(
	run: ExecutionControlRun,
	event: ExecutionControlRunEvent,
	lastSequence: number,
): number {
	if (event.runId !== run.runId || event.conversationId !== run.conversationId) {
		throw new AppApiRouteError({
			code: "durable_run_event_identity_drift",
			message: "Durable run event identity does not match durable run projection.",
			retryable: true,
			status: 502,
		});
	}
	if (!Number.isInteger(event.sequence) || event.sequence <= lastSequence) {
		throw new AppApiRouteError({
			code: "durable_run_event_cursor_regression",
			message: "Durable run event sequence must strictly advance.",
			retryable: true,
			status: 502,
		});
	}
	return event.sequence;
}

function summarizeStepTrajectory(trajectory: ExecutionControlRunStepTrajectory) {
	return {
		attemptCount: trajectory.attempts.length,
		resultCount: trajectory.results.length,
		steps: trajectory.steps.map((step) => {
			const attempts = trajectory.attempts.filter((attempt) => attempt.stepId === step.stepId);
			const results = trajectory.results.filter((result) => result.stepId === step.stepId);
			const latestResult = results.at(-1);
			const latestAttempt = attempts.at(-1);
			const agentSummary = agentStepSummary(latestResult?.sanitizedPayload);
			const totalInputTokens = attempts.reduce(
				(total, attempt) => total + numberOrZero(attempt.inputTokens),
				0,
			);
			const totalOutputTokens = attempts.reduce(
				(total, attempt) => total + numberOrZero(attempt.outputTokens),
				0,
			);
			const totalEstimatedCostMicrousd = attempts.reduce(
				(total, attempt) => total + numberOrZero(attempt.estimatedCostMicrousd),
				0,
			);
			return {
				attemptCount: attempts.length,
				...agentSummary,
				tool: step.tool,
				cancelOutcome: latestAttempt?.cancelOutcome || null,
				durationMs: positiveNumberOrNull(latestAttempt?.durationMs),
				estimatedCostMicrousd: totalEstimatedCostMicrousd,
				failCloseReason: latestAttempt?.failCloseReason || null,
				inputTokens: totalInputTokens,
				lateCompletionOutcome: latestAttempt?.lateCompletionOutcome || null,
				latestResultRef: latestResult?.projectionRef ?? null,
				modelName: latestAttempt?.modelName || null,
				modelProvider: latestAttempt?.modelProvider || null,
				outputTokens: totalOutputTokens,
				providerRequestRef: latestAttempt?.providerRequestRef || null,
				queueWaitMs: positiveNumberOrNull(latestAttempt?.scheduleToStartMs),
				replanReason: latestAttempt?.replanReason || null,
				resultCount: results.length,
				status: step.status,
				stepId: step.stepId,
				stepKind: step.stepKind,
				taskQueue: step.taskQueue,
				timeoutOutcome: latestAttempt?.timeoutOutcome || null,
				workerId: step.workerId,
			};
		}),
	};
}

function materializeOperatorStepTrajectory(
	run: ExecutionControlRun,
	trajectory: ExecutionControlRunStepTrajectory,
): OperatorRuntimeRunSummary["operatorStepTrajectory"] {
	return {
		conversationId: run.conversationId,
		requestId: run.requestId,
		runId: run.runId,
		schemaVersion: "operator_step_trajectory.v1",
		steps: trajectory.steps.map((step) => {
			const attempts = trajectory.attempts.filter((attempt) => attempt.stepId === step.stepId);
			const results = trajectory.results.filter((result) => result.stepId === step.stepId);
			const latestAttempt = attempts.at(-1);
			const latestResult = results.at(-1);
			const agentSummary = agentStepSummary(latestResult?.sanitizedPayload);
			return {
				attemptCount: attempts.length,
				...agentSummary,
				tool: step.tool,
				cancelOutcome: nullableAttemptString(latestAttempt, "cancelOutcome"),
				durationMs: positiveNumberOrNull(latestAttempt?.durationMs),
				estimatedCostMicrousd: attempts.reduce(
					(total, attempt) => total + numberOrZero(attempt.estimatedCostMicrousd),
					0,
				),
				failCloseReason: nullableAttemptString(latestAttempt, "failCloseReason"),
				inputTokens: attempts.reduce(
					(total, attempt) => total + numberOrZero(attempt.inputTokens),
					0,
				),
				lateCompletionOutcome: nullableAttemptString(latestAttempt, "lateCompletionOutcome"),
				latestResultRef: latestResult?.projectionRef ?? null,
				modelName: latestAttempt?.modelName || null,
				modelProvider: latestAttempt?.modelProvider || null,
				outputTokens: attempts.reduce(
					(total, attempt) => total + numberOrZero(attempt.outputTokens),
					0,
				),
				projectionRefs: projectionRefs(results),
				providerRequestRef: latestAttempt?.providerRequestRef || null,
				queueWaitMs: positiveNumberOrNull(latestAttempt?.scheduleToStartMs),
				replanReason: nullableAttemptString(latestAttempt, "replanReason"),
				resultCount: results.length,
				status: step.status,
				stepId: step.stepId,
				stepKind: step.stepKind,
				taskQueue: step.taskQueue,
				terminalReason: nullableAttemptString(latestAttempt, "terminalReason"),
				timeoutOutcome: nullableAttemptString(latestAttempt, "timeoutOutcome"),
				toolName: toolNameForStep(step, latestResult),
				toolStatus: toolStatusForStep(step, latestResult),
				workerId: step.workerId,
			};
		}),
		traceId: run.traceId,
	};
}

function projectionRefs(results: ExecutionControlStepResult[]): string[] {
	return results
		.map((result) => result.projectionRef)
		.filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
}

function nullableAttemptString(
	attempt: ExecutionControlStepAttempt | undefined,
	field: keyof Pick<
		ExecutionControlStepAttempt,
		| "cancelOutcome"
		| "failCloseReason"
		| "lateCompletionOutcome"
		| "replanReason"
		| "terminalReason"
		| "timeoutOutcome"
	>,
): string | null {
	if (!attempt) {
		return null;
	}
	const value = attempt[field];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function toolNameForStep(
	step: ExecutionControlRunStep,
	latestResult: ExecutionControlStepResult | undefined,
): string | null {
	const resultTool = stringOrNull(latestResult?.sanitizedPayload.selected_tool);
	if (resultTool) {
		return resultTool;
	}
	const stepTool = stringOrNull(step.sanitizedPayload.selected_tool);
	return stepTool ?? null;
}

function toolStatusForStep(
	step: ExecutionControlRunStep,
	latestResult: ExecutionControlStepResult | undefined,
): string | null {
	const resultStatus = stringOrNull(latestResult?.sanitizedPayload.tool_status);
	if (resultStatus) {
		return resultStatus;
	}
	const stepStatus = stringOrNull(step.sanitizedPayload.tool_status);
	return stepStatus ?? null;
}

function agentStepSummary(payload: Record<string, unknown> | undefined) {
	if (!payload) {
		return {};
	}
	const selectedTools = stringArrayValue(payload.selected_tools);
	const toolResultRefs = toolResultRefsFromPayload(payload.tool_results);
	const sdkTraceRef = stringOrNull(payload.sdk_trace_ref);
	const terminalReason = stringOrNull(payload.terminal_reason);
	if (
		selectedTools.length === 0 &&
		toolResultRefs.length === 0 &&
		sdkTraceRef === null &&
		terminalReason === null
	) {
		return {};
	}
	return {
		agentSdkTraceRef: sdkTraceRef,
		agentSelectedTools: selectedTools,
		agentTerminalReason: terminalReason,
		agentToolResultRefs: toolResultRefs,
	};
}

function toolResultRefsFromPayload(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				return "";
			}
			return stringOrNull((item as Record<string, unknown>).result_ref) ?? "";
		})
		.filter((item) => item.length > 0);
}

function stringArrayValue(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrZero(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveNumberOrNull(value: number | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

async function loadRuntimeRunSummary(
	dependencies: OperatorQueryServiceDependencies,
	record: OperatorRequestObservabilityRecord,
): Promise<OperatorRuntimeRunSummary | null> {
	const runId = record.request.runId;
	if (!runId) {
		return null;
	}
	if (!dependencies.executionRuntime) {
		throw new AppApiRouteError({
			code: "execution_runtime_not_configured",
			message: "Execution runtime is required for request run observability.",
			retryable: true,
			status: 503,
		});
	}

	const run = await dependencies.executionRuntime.getRun({
		runId,
		traceId: record.request.traceId,
	});
	assertDurableRunMatchesRequest(record.request, run);
	const events = await dependencies.executionRuntime.listRunEvents({
		runId,
		traceId: record.request.traceId,
	});
	const stepTrajectory = await dependencies.executionRuntime.listRunSteps({
		runId,
		traceId: record.request.traceId,
	});

	const visibilityCounts = {
		browser: 0,
		eval: 0,
		internal: 0,
		panel: 0,
	};
	let latestEvent: OperatorRuntimeRunEventSummary | null = null;
	let terminalEvent: OperatorRuntimeRunEventSummary | null = null;
	let lastSequence = 0;
	for (const event of events) {
		lastSequence = assertDurableEventMatchesRun(run, event, lastSequence);
		if (event.visibility in visibilityCounts) {
			visibilityCounts[event.visibility as keyof typeof visibilityCounts] += 1;
		}
		const summary = toRuntimeRunEventSummary(event);
		latestEvent = summary;
		if (TERMINAL_RUN_EVENT_TYPES.has(event.eventType)) {
			terminalEvent = summary;
		}
	}

	return {
		eventSummary: {
			eventCount: events.length,
			latestEvent,
			terminalEvent,
			visibilityCounts,
		},
		run: {
			conversationId: run.conversationId,
			phase: runtimeRunPhaseFromExecutionStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			status: run.status,
			terminalReason: run.terminalReason || null,
			traceId: run.traceId,
		},
		operatorStepTrajectory: materializeOperatorStepTrajectory(run, stepTrajectory),
		stepTrajectory: summarizeStepTrajectory(stepTrajectory),
	};
}

export function buildOperatorQueryService(
	dependencies: OperatorQueryServiceDependencies,
): OperatorQueryService {
	return {
		async getById(input) {
			ensureOperatorPrincipal(input.principal);
			const requestId = normalizeOptionalString(input.requestId);
			if (!requestId) {
				throw new AppApiRouteError({
					code: "invalid_request_id",
					message: "requestId is required.",
					retryable: false,
					status: 400,
				});
			}

			const projection = await dependencies.store.getById(requestId);
			if (!projection) {
				throw new AppApiRouteError({
					code: "request_not_found",
					message: "Request projection not found.",
					retryable: false,
					status: 404,
				});
			}

			return projection;
		},

		async getObservabilityById(input) {
			ensureOperatorPrincipal(input.principal);
			const requestId = normalizeOptionalString(input.requestId);
			if (!requestId) {
				throw new AppApiRouteError({
					code: "invalid_request_id",
					message: "requestId is required.",
					retryable: false,
					status: 400,
				});
			}

			const projection = await dependencies.store.getObservabilityById(requestId);
			if (!projection) {
				throw new AppApiRouteError({
					code: "request_not_found",
					message: "Request observability not found.",
					retryable: false,
					status: 404,
				});
			}

			return {
				...projection,
				runtimeRun: await loadRuntimeRunSummary(dependencies, projection),
			};
		},

		async getAuditById(input) {
			ensureOperatorPrincipal(input.principal);
			const auditEventId = normalizeOptionalString(input.auditEventId);
			if (!auditEventId) {
				throw new AppApiRouteError({
					code: "invalid_audit_event_id",
					message: "auditEventId is required.",
					retryable: false,
					status: 400,
				});
			}

			const event = await dependencies.store.getAuditById(auditEventId);
			if (!event) {
				throw new AppApiRouteError({
					code: "audit_event_not_found",
					message: "Audit event not found.",
					retryable: false,
					status: 404,
				});
			}

			return event;
		},

		async getOverview(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getOverview(normalizeOverviewFilters(input.filters));
		},

		async getRuntimeHealth(input) {
			ensureOperatorPrincipal(input.principal);
			if (!dependencies.runtimeHealthProbe) {
				throw new AppApiRouteError({
					code: "execution_runtime_health_not_configured",
					message: "Execution runtime health probe is required for operator runtime health.",
					retryable: true,
					status: 503,
				});
			}
			return dependencies.runtimeHealthProbe();
		},

		async getQualitySummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getQualitySummary(normalizeOverviewFilters(input.filters));
		},

		async getQualityTimeseries(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeOverviewFilters(input.filters);
			validateTimeseriesGranularity(filters);
			return dependencies.store.getQualityTimeseries(filters);
		},

		async getIntentSummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getIntentSummary(normalizeOverviewFilters(input.filters));
		},

		async getIntentTimeseries(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeOverviewFilters(input.filters);
			validateTimeseriesGranularity(filters);
			return dependencies.store.getIntentTimeseries(filters);
		},

		async getSafetySummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getSafetySummary(normalizeOverviewFilters(input.filters));
		},

		async listSafetyAnomalies(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listSafetyAnomalies(
				normalizeSafetyAnomalyListFilters(input.filters),
			);
		},

		async getCostSummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getCostSummary(normalizeOverviewFilters(input.filters));
		},

		async getCostTimeseries(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeOverviewFilters(input.filters);
			validateTimeseriesGranularity(filters);
			return dependencies.store.getCostTimeseries(filters);
		},

		async list(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.list(normalizeRequestListFilters(input.filters));
		},

		async listAudit(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAudit(normalizeAuditListFilters(input.filters));
		},

		async listQualityBadcases(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listQualityBadcases(
				normalizeQualityBadcaseListFilters(input.filters),
			);
		},

		async listQualityEvalCandidates(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeQualityBadcaseListFilters(input.filters);
			const includeBadcases =
				filters.detectedBy !== "negative_feedback" && filters.status !== "pending_review";
			const includeFeedback =
				(!filters.detectedBy || filters.detectedBy === "negative_feedback") &&
				(!filters.status || filters.status === "pending_review");

			if (includeBadcases && !includeFeedback) {
				const badcases = await dependencies.store.listQualityBadcases(filters);
				return toQualityEvalCandidates(badcases);
			}
			if (!includeBadcases && includeFeedback) {
				return dependencies.store.listQualityFeedbackEvalCandidates(filters);
			}
			if (!(includeBadcases || includeFeedback)) {
				return emptyQualityEvalCandidates();
			}

			const [badcases, feedbackCandidates] = await Promise.all([
				includeBadcases
					? dependencies.store.listQualityBadcases(filters).then(toQualityEvalCandidates)
					: Promise.resolve(emptyQualityEvalCandidates()),
				includeFeedback
					? dependencies.store.listQualityFeedbackEvalCandidates(filters)
					: Promise.resolve(emptyQualityEvalCandidates()),
			]);
			return mergeQualityEvalCandidates(badcases, feedbackCandidates, filters.limit);
		},

		async listTemporalTaskQueues(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listTemporalTaskQueues(
				normalizeTemporalTaskQueueListFilters(input.filters),
			);
		},

		async listAutoscalerDecisions(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAutoscalerDecisions(
				normalizeWorkerAutoscalerDecisionListFilters(input.filters),
			);
		},

		async listAutoscalerActuations(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAutoscalerActuations(
				normalizeWorkerAutoscalerActuationListFilters(input.filters),
			);
		},

		async listAutoscalerPostures(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAutoscalerPostures(
				normalizeWorkerAutoscalerPostureListFilters(input.filters),
			);
		},
	};
}
