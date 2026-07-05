import { AppApiRouteError } from "../../http";
import {
	normalizeTemporalTaskQueueRuntimePayload,
	type TemporalTaskQueueRuntimePayload,
} from "../operator-runtime-observability";
import type { ExecutionAuditEventWrite, OperatorObservabilityCommandStore } from "./store";

const ALLOWED_EXECUTION_AUDIT_EVENT_TYPES = new Set([
	"execution.admission_rejected",
	"execution.cancel_requested",
	"execution.cancelled",
	"execution.activity_failed",
	"execution.timed_out",
]);
const ALLOWED_EXECUTION_AUDIT_FIELDS = new Set([
	"activity_duration_ms",
	"decision",
	"duration_ms",
	"event_id",
	"event_type",
	"failure_kind",
	"http_status",
	"occurred_at",
	"queue_wait_ms",
	"request_id",
	"requested_tool",
	"retryable",
	"task_queue",
	"trace_id",
]);
const EXECUTION_AUDIT_MAX_BATCH_SIZE = 100;
const EXECUTION_AUDIT_MAX_STRING_LENGTH = 200;

export interface OperatorExecutionAuditEventPayloadItem {
	activity_duration_ms?: unknown;
	decision?: unknown;
	duration_ms?: unknown;
	event_id?: unknown;
	event_type?: unknown;
	failure_kind?: unknown;
	http_status?: unknown;
	task_queue?: unknown;
	occurred_at?: unknown;
	queue_wait_ms?: unknown;
	request_id?: unknown;
	requested_tool?: unknown;
	retryable?: unknown;
	trace_id?: unknown;
	[key: string]: unknown;
}

export interface OperatorExecutionAuditEventsPayload {
	events?: unknown;
}

export interface OperatorObservabilityCommandService {
	ingestExecutionAuditEvents(input: {
		payload: OperatorExecutionAuditEventsPayload;
	}): Promise<{ accepted: number }>;
	ingestTemporalTaskQueueSnapshots(input: {
		payload: TemporalTaskQueueRuntimePayload;
		persistHistory?: boolean;
	}): Promise<{
		acceptedActuations: number;
		acceptedDecisions: number;
		acceptedPostures: number;
		acceptedSnapshots: number;
	}>;
}

export interface OperatorObservabilityCommandServiceDependencies {
	now?: () => Date;
	store: OperatorObservabilityCommandStore;
	telemetry?: {
		recordExecutionAuditEvent?(input: {
			activityDurationMs: number | null;
			decision: string | null;
			durationMs: number | null;
			eventType: string;
			failureKind: string | null;
			httpStatus: number | null;
			taskQueue: string | null;
			queueWaitMs: number | null;
			requestId: string;
			requestedTool: string | null;
			retryable: boolean | null;
			status: string;
			surface: string;
			traceId: string;
		}): Promise<void>;
	};
}

function validationError(field: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 422,
	});
}

function normalizeString(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw validationError(field, `${field} must be a string.`);
	}
	const normalized = value.trim();
	if (normalized.length > EXECUTION_AUDIT_MAX_STRING_LENGTH) {
		throw validationError(field, `${field} is too long.`);
	}
	return normalized;
}

function normalizeNullableString(value: unknown, field: string): string | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const normalized = normalizeString(value, field);
	return normalized || null;
}

function normalizeNullableBoolean(value: unknown, field: string): boolean | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (typeof value !== "boolean") {
		throw validationError(field, `${field} must be a boolean.`);
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
		throw validationError(field, `${field} must be a non-negative integer.`);
	}
	return value;
}

function normalizeNullableHttpStatus(value: unknown, field: string): number | null {
	const status = normalizeNullableNonNegativeInteger(value, field);
	if (status === null) {
		return null;
	}
	if (status < 100 || status > 599) {
		throw validationError(field, `${field} must be a valid HTTP status code.`);
	}
	return status;
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeString(value, field);
	if (!normalized) {
		throw validationError(field, `${field} is required.`);
	}

	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}

	return timestamp.toISOString();
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = normalizeString(value, field);
	if (!normalized) {
		throw validationError(field, `${field} is required.`);
	}

	return normalized;
}

function ensureArray<T>(value: unknown, field: string): T[] {
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	if (value.length > EXECUTION_AUDIT_MAX_BATCH_SIZE) {
		throw validationError(
			field,
			`${field} must contain at most ${EXECUTION_AUDIT_MAX_BATCH_SIZE} items.`,
		);
	}

	return value as T[];
}

function ensureExecutionAuditEventItem(
	value: unknown,
	field: string,
): OperatorExecutionAuditEventPayloadItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw validationError(field, `${field} must be an object.`);
	}
	return value as OperatorExecutionAuditEventPayloadItem;
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

function executionAuditTelemetryStatus(eventType: string): string {
	if (eventType === "execution.admission_rejected") {
		return "rejected";
	}
	if (eventType === "execution.cancel_requested") {
		return "accepted";
	}
	if (eventType === "execution.cancelled") {
		return "cancelled";
	}
	return "error";
}

function assertAllowedExecutionAuditFields(
	item: OperatorExecutionAuditEventPayloadItem,
	prefix: string,
) {
	for (const key of Object.keys(item)) {
		if (!ALLOWED_EXECUTION_AUDIT_FIELDS.has(key)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${prefix}.${key}` },
				message: `${prefix}.${key} is not allowed in execution audit events.`,
				retryable: false,
				status: 422,
			});
		}
	}
}

function assertExecutionAuditEventIdMatches(input: {
	eventId: string;
	eventType: string;
	prefix: string;
	requestId: string;
}) {
	const expected = `execution-control:${input.requestId}:${input.eventType}`;
	if (input.eventId !== expected) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: `${input.prefix}.event_id` },
			message: `${input.prefix}.event_id must match request_id and event_type.`,
			retryable: false,
			status: 422,
		});
	}
}

export function buildOperatorObservabilityCommandService(
	dependencies: OperatorObservabilityCommandServiceDependencies,
): OperatorObservabilityCommandService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async ingestExecutionAuditEvents(input) {
			const events = ensureArray<OperatorExecutionAuditEventPayloadItem>(
				input.payload.events,
				"events",
			);
			const writes: ExecutionAuditEventWrite[] = [];
			const telemetryEvents: Array<{
				activityDurationMs: number | null;
				decision: string | null;
				durationMs: number | null;
				eventType: string;
				failureKind: string | null;
				httpStatus: number | null;
				taskQueue: string | null;
				queueWaitMs: number | null;
				requestId: string;
				requestedTool: string | null;
				retryable: boolean | null;
				status: string;
				surface: string;
				traceId: string;
			}> = [];

			for (let index = 0; index < events.length; index += 1) {
				const prefix = `events[${index}]`;
				const item = ensureExecutionAuditEventItem(events[index], prefix);
				assertAllowedExecutionAuditFields(item, prefix);
				const eventId = normalizeRequiredString(item.event_id, `${prefix}.event_id`);
				const requestId = normalizeRequiredString(item.request_id, `${prefix}.request_id`);
				const traceId = normalizeRequiredString(item.trace_id, `${prefix}.trace_id`);
				const eventType = normalizeExecutionAuditEventType(item.event_type, `${prefix}.event_type`);
				assertExecutionAuditEventIdMatches({ eventId, eventType, prefix, requestId });
				const occurredAt = normalizeIsoTimestamp(item.occurred_at, `${prefix}.occurred_at`);
				const activityDurationMs = normalizeNullableNonNegativeInteger(
					item.activity_duration_ms,
					`${prefix}.activity_duration_ms`,
				);
				const durationMs = normalizeNullableNonNegativeInteger(
					item.duration_ms,
					`${prefix}.duration_ms`,
				);
				const httpStatus = normalizeNullableHttpStatus(item.http_status, `${prefix}.http_status`);
				const queueWaitMs = normalizeNullableNonNegativeInteger(
					item.queue_wait_ms,
					`${prefix}.queue_wait_ms`,
				);
				const retryable = normalizeNullableBoolean(item.retryable, `${prefix}.retryable`);
				const decision = normalizeNullableString(item.decision, `${prefix}.decision`);
				const failureKind = normalizeNullableString(item.failure_kind, `${prefix}.failure_kind`);
				const taskQueue = normalizeNullableString(item.task_queue, `${prefix}.task_queue`);
				const requestedTool = normalizeNullableString(
					item.requested_tool,
					`${prefix}.requested_tool`,
				);

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
					activityDurationMs,
					decision,
					durationMs,
					failureKind,
					httpStatus,
					taskQueue,
					queueWaitMs,
					requestedTool,
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
					status: executionAuditTelemetryStatus(eventType),
					surface: seed.surface,
				});
			}

			await dependencies.store.enqueueExecutionAuditEvents({ events: writes });
			for (const event of telemetryEvents) {
				await dependencies.telemetry?.recordExecutionAuditEvent?.(event);
			}
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
				acceptedPostures: projections.postures.length,
				acceptedSnapshots: projections.snapshots.length,
			};
		},
	};
}
