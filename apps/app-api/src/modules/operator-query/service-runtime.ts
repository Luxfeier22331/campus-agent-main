import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRunStepTrajectory,
} from "../integration";
import { runtimeRunPhaseFromSupervisorStatus } from "../runtime-run";
import {
	isAllowedTimeseriesGranularity,
	normalizeAuditListFilters,
	normalizeOptionalString,
	normalizeOverviewFilters,
	normalizeQualityBadcaseListFilters,
	normalizeRequestListFilters,
	normalizeSafetyAnomalyListFilters,
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
			selectedTarget: badcase.selectedTarget,
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
	third: OperatorQualityEvalCandidateListResult,
	limit: number,
): OperatorQualityEvalCandidateListResult {
	return {
		candidates: [...first.candidates, ...second.candidates, ...third.candidates]
			.sort((a, b) => Date.parse(b.intake.createdAt) - Date.parse(a.intake.createdAt))
			.slice(0, limit),
		page: {
			nextCursor: first.page.nextCursor ?? second.page.nextCursor ?? third.page.nextCursor,
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

function toRuntimeRunEventSummary(
	event: ExecutionControlRunEvent,
): OperatorRuntimeRunEventSummary {
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
			return {
				attemptCount: attempts.length,
				capability: step.capability,
				latestResultRef: latestResult?.projectionRef ?? null,
				resultCount: results.length,
				status: step.status,
				stepId: step.stepId,
				stepKind: step.stepKind,
				taskQueue: step.taskQueue,
				workerId: step.workerId,
			};
		}),
	};
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
			phase: runtimeRunPhaseFromSupervisorStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			status: run.status,
			terminalReason: run.terminalReason || null,
			traceId: run.traceId,
		},
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

		async getEvalCoverage(input) {
			ensureOperatorPrincipal(input.principal);
			const snapshot = await dependencies.store.getEvalCoverage();
			if (!snapshot) {
				throw new AppApiRouteError({
					code: "eval_coverage_snapshot_not_found",
					message: "Eval coverage snapshot not found.",
					retryable: false,
					status: 404,
				});
			}
			return snapshot;
		},

		async getOverview(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getOverview(normalizeOverviewFilters(input.filters));
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
				filters.detectedBy !== "negative_feedback" &&
				filters.detectedBy !== "ragas_diagnostic" &&
				filters.status !== "pending_review";
			const includeFeedback =
				(!filters.detectedBy || filters.detectedBy === "negative_feedback") &&
				(!filters.status || filters.status === "pending_review");
			const includeRagasDiagnostic =
				(!filters.detectedBy || filters.detectedBy === "ragas_diagnostic") &&
				(!filters.status || filters.status === "pending_review");

			if (includeBadcases && !includeFeedback && !includeRagasDiagnostic) {
				const badcases = await dependencies.store.listQualityBadcases(filters);
				return toQualityEvalCandidates(badcases);
			}
			if (!includeBadcases && includeFeedback && !includeRagasDiagnostic) {
				return dependencies.store.listQualityFeedbackEvalCandidates(filters);
			}
			if (!(includeBadcases || includeFeedback) && includeRagasDiagnostic) {
				return dependencies.store.listEvalDiagnosticCandidates(filters);
			}
			if (!(includeBadcases || includeFeedback || includeRagasDiagnostic)) {
				return emptyQualityEvalCandidates();
			}

			const [badcases, feedbackCandidates, ragasDiagnosticCandidates] = await Promise.all([
				includeBadcases
					? dependencies.store.listQualityBadcases(filters).then(toQualityEvalCandidates)
					: Promise.resolve(emptyQualityEvalCandidates()),
				includeFeedback
					? dependencies.store.listQualityFeedbackEvalCandidates(filters)
					: Promise.resolve(emptyQualityEvalCandidates()),
				includeRagasDiagnostic
					? dependencies.store.listEvalDiagnosticCandidates(filters)
					: Promise.resolve(emptyQualityEvalCandidates()),
			]);
			return mergeQualityEvalCandidates(
				badcases,
				feedbackCandidates,
				ragasDiagnosticCandidates,
				filters.limit,
			);
		},
	};
}
