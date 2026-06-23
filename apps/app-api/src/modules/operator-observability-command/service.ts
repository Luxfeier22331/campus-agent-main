import { AppApiRouteError } from "../../http";
import {
	EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
	type EvalCoverageSnapshot,
	normalizeEvalCoverageSnapshot,
} from "../operator-eval-coverage";
import {
	type EvalDiagnosticBadcaseProjectionWrite,
	normalizeEvalDiagnosticBadcasesProjection,
} from "../operator-eval-diagnostic-badcases";
import {
	normalizeTemporalTaskQueueRuntimePayload,
	type TemporalTaskQueueRuntimePayload,
} from "../operator-runtime-observability";
import {
	ingestLangfuseEvalBacklinks,
	type OperatorLangfuseEvalBacklinksPayload,
} from "./langfuse-eval-backlinks";
import type {
	ExecutionAuditEventWrite,
	OperatorObservabilityCommandStore,
	QualityGradeProjectionWrite,
	TraceBacklinkProjectionWrite,
} from "./store";

const ALLOWED_GRADE_DOMAINS = new Set(["grounding", "citation", "policy", "intent"]);
const ALLOWED_GRADE_VERDICTS = new Set(["pass", "fail", "needs_review"]);
const ALLOWED_EXECUTION_AUDIT_EVENT_TYPES = new Set([
	"execution.admission_rejected",
	"execution.cancel_requested",
	"execution.cancelled",
	"execution.bridge_failed",
	"execution.timed_out",
]);
const FORBIDDEN_EXECUTION_AUDIT_FIELDS = new Set([
	"answer",
	"auth_header",
	"authorization",
	"cookie",
	"jwt",
	"prompt",
	"raw_answer",
	"raw_jwt",
	"raw_prompt",
	"retrieval_payload",
	"token",
	"transcript",
	"user_goal",
]);
const SAFE_EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

export interface OperatorQualityGradePayloadItem {
	requestId?: unknown;
	traceId?: unknown;
	gradeSource?: unknown;
	gradeDomain?: unknown;
	verdict?: unknown;
	score?: unknown;
	graderVersion?: unknown;
	sampledAt?: unknown;
	rationaleSummary?: unknown;
}

export interface OperatorTraceBacklinkPayloadItem {
	requestId?: unknown;
	traceId?: unknown;
	traceLink?: unknown;
	issueLink?: unknown;
	issueFingerprint?: unknown;
}

export interface OperatorExecutionAuditEventPayloadItem {
	bridge_duration_ms?: unknown;
	decision?: unknown;
	duration_ms?: unknown;
	event_id?: unknown;
	event_type?: unknown;
	failure_kind?: unknown;
	http_status?: unknown;
	lane?: unknown;
	occurred_at?: unknown;
	queue_wait_ms?: unknown;
	request_id?: unknown;
	requested_capability?: unknown;
	retryable?: unknown;
	trace_id?: unknown;
	[key: string]: unknown;
}

export interface OperatorQualityGradesPayload {
	grades?: unknown;
}

export interface OperatorExecutionAuditEventsPayload {
	events?: unknown;
}

export interface OperatorTraceBacklinksPayload {
	backlinks?: unknown;
}

export interface OperatorObservabilityCommandService {
	ingestEvalCoverageSnapshot(input: {
		payload: unknown;
	}): Promise<{ accepted: number; snapshotId: string }>;
	ingestEvalDiagnosticBadcases(input: {
		payload: unknown;
	}): Promise<{ accepted: number; snapshotId: string }>;
	ingestExecutionAuditEvents(input: {
		payload: OperatorExecutionAuditEventsPayload;
	}): Promise<{ accepted: number }>;
	ingestGrades(input: { payload: OperatorQualityGradesPayload }): Promise<{ accepted: number }>;
	ingestLangfuseEvalBacklinks(input: {
		payload: OperatorLangfuseEvalBacklinksPayload;
	}): Promise<{ accepted: number }>;
	ingestTraceBacklinks(input: {
		payload: OperatorTraceBacklinksPayload;
	}): Promise<{ accepted: number }>;
	ingestTemporalTaskQueueSnapshots(input: {
		payload: TemporalTaskQueueRuntimePayload;
		persistHistory?: boolean;
	}): Promise<{
		acceptedActuations: number;
		acceptedDecisions: number;
		acceptedSnapshots: number;
	}>;
}

export interface OperatorObservabilityCommandServiceDependencies {
	now?: () => Date;
	store: OperatorObservabilityCommandStore;
	telemetry?: {
		recordExecutionAuditEvent?(input: {
			bridgeDurationMs: number | null;
			decision: string | null;
			durationMs: number | null;
			eventType: string;
			failureKind: string | null;
			httpStatus: number | null;
			lane: string | null;
			queueWaitMs: number | null;
			requestId: string;
			requestedCapability: string | null;
			retryable: boolean | null;
			status: string;
			surface: string;
			traceId: string;
		}): Promise<void>;
		recordQualitySampledGrade(input: {
			collection: string | null;
			gradeDomain: "grounding" | "citation" | "policy" | "intent";
			gradeId: string;
			gradeSource: string;
			graderVersion: string;
			modelName: string | null;
			principalType: string;
			rationaleSummary: string | null;
			requestId: string;
			requestStartedAt: string;
			requestedCapability: string | null;
			requestedScopeSummary: string | null;
			sampledAt: string;
			scoreMilli: number | null;
			selectedCapability: string | null;
			surface: string;
			traceId: string;
			verdict: "pass" | "fail" | "needs_review";
		}): Promise<void>;
	};
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizeNullableSafeExternalLink(value: unknown, field: string): string | null {
	const normalized = normalizeNullableString(value);
	if (!normalized) {
		return null;
	}

	try {
		const parsed = new URL(normalized);
		if (SAFE_EXTERNAL_LINK_PROTOCOLS.has(parsed.protocol)) {
			return parsed.toString();
		}
	} catch {
		// Fall through to a uniform validation error.
	}

	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} must be an http(s) URL.`,
		retryable: false,
		status: 422,
	});
}

function normalizeNullableBoolean(value: unknown, field: string): boolean | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (typeof value !== "boolean") {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a boolean.`,
			retryable: false,
			status: 422,
		});
	}
	return value;
}

function normalizeNullableNonNegativeInteger(value: unknown, field: string): number | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		!Number.isFinite(value) ||
		value < 0
	) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-negative integer.`,
			retryable: false,
			status: 422,
		});
	}
	return value;
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} is required.`,
			retryable: false,
			status: 422,
		});
	}

	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			retryable: false,
			status: 422,
		});
	}

	return timestamp.toISOString();
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} is required.`,
			retryable: false,
			status: 422,
		});
	}

	return normalized;
}

function normalizeScore(
	value: unknown,
	field: string,
): {
	score: number | null;
	scoreMilli: number | null;
} {
	if (value === null || value === undefined || value === "") {
		return { score: null, scoreMilli: null };
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a number between 0 and 1.`,
			retryable: false,
			status: 422,
		});
	}

	return {
		score: value,
		scoreMilli: Math.round(value * 1000),
	};
}

function ensureArray<T>(value: unknown, field: string): T[] {
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array.`,
			retryable: false,
			status: 422,
		});
	}

	return value as T[];
}

function normalizeGradeDomain(
	value: unknown,
	field: string,
): "grounding" | "citation" | "policy" | "intent" {
	const normalized = normalizeRequiredString(value, field);
	if (!ALLOWED_GRADE_DOMAINS.has(normalized)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be one of grounding, citation, policy, intent.`,
			retryable: false,
			status: 422,
		});
	}

	return normalized as "grounding" | "citation" | "policy" | "intent";
}

function normalizeGradeVerdict(value: unknown, field: string): "pass" | "fail" | "needs_review" {
	const normalized = normalizeRequiredString(value, field);
	if (!ALLOWED_GRADE_VERDICTS.has(normalized)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be one of pass, fail, needs_review.`,
			retryable: false,
			status: 422,
		});
	}

	return normalized as "pass" | "fail" | "needs_review";
}

function buildGradeId(input: {
	requestId: string;
	gradeSource: string;
	gradeDomain: string;
}): string {
	return `${input.requestId}:${input.gradeSource}:${input.gradeDomain}`;
}

function normalizeExecutionAuditEventType(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	if (!ALLOWED_EXECUTION_AUDIT_EVENT_TYPES.has(normalized)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an allowed execution audit event type.`,
			retryable: false,
			status: 422,
		});
	}
	return normalized;
}

function assertNoForbiddenExecutionAuditFields(
	item: OperatorExecutionAuditEventPayloadItem,
	prefix: string,
) {
	for (const key of Object.keys(item)) {
		if (FORBIDDEN_EXECUTION_AUDIT_FIELDS.has(key.toLowerCase())) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${prefix}.${key}` },
				message: `${prefix}.${key} is forbidden in execution audit events.`,
				retryable: false,
				status: 422,
			});
		}
	}
}

export function buildOperatorObservabilityCommandService(
	dependencies: OperatorObservabilityCommandServiceDependencies,
): OperatorObservabilityCommandService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async ingestEvalCoverageSnapshot(input) {
			const snapshot: EvalCoverageSnapshot = normalizeEvalCoverageSnapshot(input.payload);
			await dependencies.store.upsertEvalCoverageSnapshot({
				snapshot: {
					generatedAt: snapshot.generatedAt,
					payload: snapshot,
					schemaVersion: EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION,
					snapshotId: snapshot.snapshotId,
					sourceGitHead: snapshot.sourceGitHead,
				},
			});
			return { accepted: 1, snapshotId: snapshot.snapshotId };
		},

		async ingestEvalDiagnosticBadcases(input) {
			const projection = normalizeEvalDiagnosticBadcasesProjection(input.payload);
			const projectedAt = now().toISOString();
			const badcases: EvalDiagnosticBadcaseProjectionWrite[] = projection.badcases.map(
				(badcase) => ({
					answerShape: badcase.answerShape,
					badcaseId: badcase.badcaseId,
					caseId: badcase.caseId,
					causeClass: badcase.causeClass,
					evalRunId: projection.evalRunId,
					expectedDocIds: badcase.expectedDocIds,
					failureStage: badcase.failureStage,
					generatedAt: projection.generatedAt,
					metricFailureReason: badcase.metricFailureReason,
					metricName: badcase.metricName,
					presentationKind: badcase.presentationKind,
					projectedAt,
					queryPreview: badcase.queryPreview,
					retrievedContextIds: badcase.retrievedContextIds,
					retrievedDocIds: badcase.retrievedDocIds,
					scoreMilli: Math.round(badcase.score * 1000),
					snapshotId: projection.snapshotId,
					sourceGitHead: projection.sourceGitHead,
					sourceReportSchema: projection.sourceReportSchema,
					supportingChunkIds: badcase.supportingChunkIds,
					supportingDocIds: badcase.supportingDocIds,
					surfaceKey: badcase.surfaceKey,
					thresholdMilli: Math.round(badcase.threshold * 1000),
					trajectoryAttribution: badcase.trajectoryAttribution,
				}),
			);
			await dependencies.store.upsertEvalDiagnosticBadcases({
				badcases,
				snapshotId: projection.snapshotId,
			});
			return { accepted: badcases.length, snapshotId: projection.snapshotId };
		},

		async ingestExecutionAuditEvents(input) {
			const events = ensureArray<OperatorExecutionAuditEventPayloadItem>(
				input.payload.events,
				"events",
			);
			const writes: ExecutionAuditEventWrite[] = [];
			const telemetryEvents: Array<{
				bridgeDurationMs: number | null;
				decision: string | null;
				durationMs: number | null;
				eventType: string;
				failureKind: string | null;
				httpStatus: number | null;
				lane: string | null;
				queueWaitMs: number | null;
				requestId: string;
				requestedCapability: string | null;
				retryable: boolean | null;
				status: string;
				surface: string;
				traceId: string;
			}> = [];

			for (let index = 0; index < events.length; index += 1) {
				const item = events[index] ?? {};
				const prefix = `events[${index}]`;
				assertNoForbiddenExecutionAuditFields(item, prefix);
				const eventId = normalizeRequiredString(item.event_id, `${prefix}.event_id`);
				const requestId = normalizeRequiredString(item.request_id, `${prefix}.request_id`);
				const traceId = normalizeRequiredString(item.trace_id, `${prefix}.trace_id`);
				const eventType = normalizeExecutionAuditEventType(item.event_type, `${prefix}.event_type`);
				const occurredAt = normalizeIsoTimestamp(item.occurred_at, `${prefix}.occurred_at`);
				const bridgeDurationMs = normalizeNullableNonNegativeInteger(
					item.bridge_duration_ms,
					`${prefix}.bridge_duration_ms`,
				);
				const durationMs = normalizeNullableNonNegativeInteger(
					item.duration_ms,
					`${prefix}.duration_ms`,
				);
				const httpStatus = normalizeNullableNonNegativeInteger(
					item.http_status,
					`${prefix}.http_status`,
				);
				const queueWaitMs = normalizeNullableNonNegativeInteger(
					item.queue_wait_ms,
					`${prefix}.queue_wait_ms`,
				);
				const retryable = normalizeNullableBoolean(item.retryable, `${prefix}.retryable`);
				const decision = normalizeNullableString(item.decision);
				const failureKind = normalizeNullableString(item.failure_kind);
				const lane = normalizeNullableString(item.lane);
				const requestedCapability = normalizeNullableString(item.requested_capability);

				const seed = await dependencies.store.getRequestObservabilitySeed(requestId);
				if (!seed) {
					throw new AppApiRouteError({
						code: "request_not_found",
						details: { requestId },
						message: "Request observability seed not found.",
						retryable: false,
						status: 404,
					});
				}
				if (seed.traceId !== traceId) {
					throw new AppApiRouteError({
						code: "validation_failed",
						details: { field: `${prefix}.trace_id`, requestId },
						message: `${prefix}.trace_id must match the request-scoped traceId.`,
						retryable: false,
						status: 422,
					});
				}

				const payload = {
					bridgeDurationMs,
					decision,
					durationMs,
					failureKind,
					httpStatus,
					lane,
					queueWaitMs,
					requestedCapability,
					retryable,
					traceId,
				};
				writes.push({
					availableAt: occurredAt,
					eventId,
					eventType,
					occurredAt,
					payload,
					requestId,
				});
				telemetryEvents.push({
					...payload,
					eventType,
					requestId,
					status: eventType === "execution.admission_rejected" ? "rejected" : "error",
					surface: seed.surface,
				});
			}

			await dependencies.store.enqueueExecutionAuditEvents({ events: writes });
			for (const event of telemetryEvents) {
				await dependencies.telemetry?.recordExecutionAuditEvent?.(event);
			}
			return { accepted: writes.length };
		},

		async ingestGrades(input) {
			const grades = ensureArray<OperatorQualityGradePayloadItem>(input.payload.grades, "grades");
			const writes: QualityGradeProjectionWrite[] = [];

			for (let index = 0; index < grades.length; index += 1) {
				const item = grades[index] ?? {};
				const prefix = `grades[${index}]`;
				const requestId = normalizeRequiredString(item.requestId, `${prefix}.requestId`);
				const traceId = normalizeRequiredString(item.traceId, `${prefix}.traceId`);
				const gradeSource = normalizeRequiredString(item.gradeSource, `${prefix}.gradeSource`);
				const gradeDomain = normalizeGradeDomain(item.gradeDomain, `${prefix}.gradeDomain`);
				const verdict = normalizeGradeVerdict(item.verdict, `${prefix}.verdict`);
				const graderVersion = normalizeRequiredString(
					item.graderVersion,
					`${prefix}.graderVersion`,
				);
				const sampledAt = normalizeIsoTimestamp(item.sampledAt, `${prefix}.sampledAt`);
				const rationaleSummary = normalizeNullableString(item.rationaleSummary);
				const score = normalizeScore(item.score, `${prefix}.score`);

				const seed = await dependencies.store.getRequestObservabilitySeed(requestId);
				if (!seed) {
					throw new AppApiRouteError({
						code: "request_not_found",
						details: { requestId },
						message: "Request observability seed not found.",
						retryable: false,
						status: 404,
					});
				}
				if (seed.traceId !== traceId) {
					throw new AppApiRouteError({
						code: "validation_failed",
						details: { field: `${prefix}.traceId`, requestId },
						message: `${prefix}.traceId must match the request-scoped traceId.`,
						retryable: false,
						status: 422,
					});
				}

				writes.push({
					collection: seed.collection,
					gradeDomain,
					gradeId: buildGradeId({ gradeDomain, gradeSource, requestId }),
					gradeSource,
					graderVersion,
					modelName: seed.modelName,
					principalType: seed.principalType,
					projectedAt: now().toISOString(),
					rationaleSummary,
					requestId,
					requestStartedAt: seed.requestStartedAt,
					requestedCapability: seed.requestedCapability,
					requestedScopeSummary: seed.requestedScopeSummary,
					sampledAt,
					scoreMilli: score.scoreMilli,
					selectedCapability: seed.selectedCapability,
					surface: seed.surface,
					traceId,
					verdict,
				});
			}

			await dependencies.store.upsertQualityGrades({ grades: writes });
			for (const grade of writes) {
				await dependencies.telemetry?.recordQualitySampledGrade({
					collection: grade.collection,
					gradeDomain: grade.gradeDomain,
					gradeId: grade.gradeId,
					gradeSource: grade.gradeSource,
					graderVersion: grade.graderVersion,
					modelName: grade.modelName,
					principalType: grade.principalType,
					rationaleSummary: grade.rationaleSummary,
					requestId: grade.requestId,
					requestStartedAt: grade.requestStartedAt,
					requestedCapability: grade.requestedCapability,
					requestedScopeSummary: grade.requestedScopeSummary,
					sampledAt: grade.sampledAt,
					scoreMilli: grade.scoreMilli,
					selectedCapability: grade.selectedCapability,
					surface: grade.surface,
					traceId: grade.traceId,
					verdict: grade.verdict,
				});
			}
			return { accepted: writes.length };
		},

		async ingestLangfuseEvalBacklinks(input) {
			return ingestLangfuseEvalBacklinks({
				now,
				payload: input.payload,
				store: dependencies.store,
			});
		},

		async ingestTraceBacklinks(input) {
			const backlinks = ensureArray<OperatorTraceBacklinkPayloadItem>(
				input.payload.backlinks,
				"backlinks",
			);
			const writes: TraceBacklinkProjectionWrite[] = [];

			for (let index = 0; index < backlinks.length; index += 1) {
				const item = backlinks[index] ?? {};
				const prefix = `backlinks[${index}]`;
				const requestId = normalizeRequiredString(item.requestId, `${prefix}.requestId`);
				const traceId = normalizeRequiredString(item.traceId, `${prefix}.traceId`);
				const seed = await dependencies.store.getRequestObservabilitySeed(requestId);
				if (!seed) {
					throw new AppApiRouteError({
						code: "request_not_found",
						details: { requestId },
						message: "Request observability seed not found.",
						retryable: false,
						status: 404,
					});
				}
				if (seed.traceId !== traceId) {
					throw new AppApiRouteError({
						code: "validation_failed",
						details: { field: `${prefix}.traceId`, requestId },
						message: `${prefix}.traceId must match the request-scoped traceId.`,
						retryable: false,
						status: 422,
					});
				}

				writes.push({
					issueFingerprint: normalizeNullableString(item.issueFingerprint),
					issueLink: normalizeNullableSafeExternalLink(item.issueLink, `${prefix}.issueLink`),
					projectedAt: now().toISOString(),
					requestId,
					traceId,
					traceLink: normalizeNullableSafeExternalLink(item.traceLink, `${prefix}.traceLink`),
				});
			}

			await dependencies.store.upsertTraceBacklinks({ backlinks: writes });
			return { accepted: writes.length };
		},

		async ingestTemporalTaskQueueSnapshots(input) {
			const projections = normalizeTemporalTaskQueueRuntimePayload(input.payload, {
				projectedAt: now().toISOString(),
			});
			await dependencies.store.upsertTemporalTaskQueueRuntime({
				...projections,
				persistHistory: input.persistHistory === true,
			});
			return {
				acceptedActuations: projections.actuations.length,
				acceptedDecisions: projections.decisions.length,
				acceptedSnapshots: projections.snapshots.length,
			};
		},
	};
}
