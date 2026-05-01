import { AppApiRouteError } from "../../http";
import type {
	AuthenticatedNoticeProcessingCommandStore,
	AuthenticatedNoticeProcessingEventWrite,
	AuthenticatedNoticeProcessingSnapshotWrite,
} from "./store";

export interface AuthenticatedNoticeProcessingSnapshot {
	id: string;
	noticeKey: string;
	sourceChannel: string;
	sourceSurface: string;
	siteId: string;
	noticeId: string;
	title: string;
	runId: string | null;
	jobId: string | null;
	replayBatchId: string | null;
	enqueueSource: string | null;
	queueStatus: string;
	lifecycleStatus: string;
	latestStage: string;
	targetSurface: string | null;
	candidateKind: string | null;
	materializationStatus: string | null;
	releaseId: string | null;
	current: boolean;
	toolReady: boolean;
	readModelCounts: Record<string, number | string | boolean | null>;
	childTaskSummary: Record<string, unknown>;
	timeline: AuthenticatedNoticeProcessingTimelineEvent[];
	downstream: Record<string, unknown> | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	attemptCount: number;
	lastObservedAt: string;
	sourceUpdatedAt: string | null;
	projectedAt: string;
	producerVersion: string;
	redactionVersion: string;
}

export interface AuthenticatedNoticeProcessingTimelineEvent {
	eventId?: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload?: Record<string, unknown> | null;
}

export interface AuthenticatedNoticeProcessingSnapshotsPayload {
	snapshots?: unknown;
}

export interface AuthenticatedNoticeProcessingCommandService {
	ingestSnapshots(input: {
		payload: AuthenticatedNoticeProcessingSnapshotsPayload;
	}): Promise<{ accepted: number }>;
}

export interface AuthenticatedNoticeProcessingCommandServiceDependencies {
	store: AuthenticatedNoticeProcessingCommandStore;
}

const FORBIDDEN_SNAPSHOT_FIELDS = new Set([
	"attachmentBytes",
	"attachments",
	"authorization",
	"bodyText",
	"bucket",
	"bundlePath",
	"cookie",
	"credentials",
	"html",
	"key",
	"localPath",
	"manifestPath",
	"objectKey",
	"objectStoreKey",
	"ocrPayload",
	"ocrTables",
	"ocrText",
	"presignedUrl",
	"rawBody",
	"rawHtml",
	"rawStack",
	"backupPath",
	"sourceFilePath",
	"stack",
]);

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw validationError(field, `${field} is required.`);
	}
	return normalized;
}

function normalizeBoolean(value: unknown, field: string): boolean {
	if (value === true || value === false) {
		return value;
	}
	throw validationError(field, `${field} must be a boolean.`);
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		Number.isFinite(value) &&
		value >= 0
	) {
		return value;
	}
	throw validationError(field, `${field} must be a non-negative integer.`);
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}
	return timestamp.toISOString();
}

function normalizeNullableIsoTimestamp(value: unknown, field: string): string | null {
	const normalized = normalizeNullableString(value);
	if (!normalized) {
		return null;
	}
	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}
	return timestamp.toISOString();
}

function normalizeRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw validationError(field, `${field} must be an object.`);
	}
	return { ...(value as Record<string, unknown>) };
}

function normalizeNullableRecord(value: unknown, field: string): Record<string, unknown> | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeRecord(value, field);
}

function normalizeReadModelCounts(
	value: unknown,
): Record<string, number | string | boolean | null> {
	const record = normalizeRecord(value, "readModelCounts");
	const normalized: Record<string, number | string | boolean | null> = {};
	for (const [key, item] of Object.entries(record)) {
		if (
			typeof item === "number" ||
			typeof item === "string" ||
			typeof item === "boolean" ||
			item === null
		) {
			normalized[key] = item;
		}
	}
	return normalized;
}

function ensureArray<T>(value: unknown, field: string): T[] {
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	return value as T[];
}

function validationError(field: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 400,
	});
}

function findForbiddenField(value: unknown, path = ""): string | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const found = findForbiddenField(value[index], `${path}[${index}]`);
			if (found) {
				return found;
			}
		}
		return null;
	}
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_SNAPSHOT_FIELDS.has(key)) {
			return path ? `${path}.${key}` : key;
		}
		const found = findForbiddenField(item, path ? `${path}.${key}` : key);
		if (found) {
			return found;
		}
	}
	return null;
}

export function assertNoForbiddenAuthenticatedNoticeProcessingFields(payload: unknown): void {
	const field = findForbiddenField(payload);
	if (field) {
		throw validationError(field.split(".").at(-1) ?? field, `${field} is not allowed.`);
	}
}

function normalizeTimelineEvent(
	value: unknown,
	index: number,
): AuthenticatedNoticeProcessingTimelineEvent {
	const record = normalizeRecord(value, `timeline[${index}]`);
	const payload = normalizeNullableRecord(record.payload, `timeline[${index}].payload`);
	return {
		eventId: normalizeNullableString(record.eventId),
		stage: normalizeRequiredString(record.stage, `timeline[${index}].stage`),
		status: normalizeRequiredString(record.status, `timeline[${index}].status`),
		occurredAt: normalizeIsoTimestamp(record.occurredAt, `timeline[${index}].occurredAt`),
		summary: normalizeRequiredString(record.summary, `timeline[${index}].summary`),
		...(payload ? { payload } : {}),
	};
}

export function normalizeAuthenticatedNoticeProcessingSnapshot(
	value: unknown,
): AuthenticatedNoticeProcessingSnapshot {
	assertNoForbiddenAuthenticatedNoticeProcessingFields(value);
	const record = normalizeRecord(value, "snapshot");
	const timeline = ensureArray<unknown>(record.timeline, "timeline").map(normalizeTimelineEvent);
	const projectedAt = normalizeIsoTimestamp(record.projectedAt, "projectedAt");
	return {
		id: normalizeRequiredString(record.id, "id"),
		noticeKey: normalizeRequiredString(record.noticeKey, "noticeKey"),
		sourceChannel: normalizeRequiredString(record.sourceChannel, "sourceChannel"),
		sourceSurface: normalizeRequiredString(record.sourceSurface, "sourceSurface"),
		siteId: normalizeRequiredString(record.siteId, "siteId"),
		noticeId: normalizeRequiredString(record.noticeId, "noticeId"),
		title: normalizeRequiredString(record.title, "title"),
		runId: normalizeNullableString(record.runId),
		jobId: normalizeNullableString(record.jobId),
		replayBatchId: normalizeNullableString(record.replayBatchId),
		enqueueSource: normalizeNullableString(record.enqueueSource),
		queueStatus: normalizeRequiredString(record.queueStatus, "queueStatus"),
		lifecycleStatus: normalizeRequiredString(record.lifecycleStatus, "lifecycleStatus"),
		latestStage: normalizeRequiredString(record.latestStage, "latestStage"),
		targetSurface: normalizeNullableString(record.targetSurface),
		candidateKind: normalizeNullableString(record.candidateKind),
		materializationStatus: normalizeNullableString(record.materializationStatus),
		releaseId: normalizeNullableString(record.releaseId),
		current: normalizeBoolean(record.current, "current"),
		toolReady: normalizeBoolean(record.toolReady, "toolReady"),
		readModelCounts: normalizeReadModelCounts(record.readModelCounts),
		childTaskSummary: normalizeRecord(record.childTaskSummary, "childTaskSummary"),
		timeline,
		downstream: normalizeNullableRecord(record.downstream, "downstream"),
		lastErrorCode: normalizeNullableString(record.lastErrorCode),
		lastErrorMessage: normalizeNullableString(record.lastErrorMessage),
		attemptCount: normalizeNonNegativeInteger(record.attemptCount, "attemptCount"),
		lastObservedAt: normalizeIsoTimestamp(record.lastObservedAt, "lastObservedAt"),
		sourceUpdatedAt: normalizeNullableIsoTimestamp(record.sourceUpdatedAt, "sourceUpdatedAt"),
		projectedAt,
		producerVersion: normalizeRequiredString(record.producerVersion, "producerVersion"),
		redactionVersion: normalizeRequiredString(record.redactionVersion, "redactionVersion"),
	};
}

function toEventWrites(
	snapshot: AuthenticatedNoticeProcessingSnapshot,
): AuthenticatedNoticeProcessingEventWrite[] {
	return snapshot.timeline.map((event, index) => ({
		eventId:
			event.eventId ?? `${snapshot.id}:${event.stage}:${event.status}:${event.occurredAt}:${index}`,
		processingId: snapshot.id,
		noticeKey: snapshot.noticeKey,
		noticeId: snapshot.noticeId,
		runId: snapshot.runId,
		jobId: snapshot.jobId,
		stage: event.stage,
		status: event.status,
		occurredAt: event.occurredAt,
		summary: event.summary,
		payload: event.payload ?? {},
		projectedAt: snapshot.projectedAt,
	}));
}

function toSnapshotWrite(
	snapshot: AuthenticatedNoticeProcessingSnapshot,
): AuthenticatedNoticeProcessingSnapshotWrite {
	return {
		...snapshot,
		processingId: snapshot.id,
	};
}

export function buildAuthenticatedNoticeProcessingCommandService(
	dependencies: AuthenticatedNoticeProcessingCommandServiceDependencies,
): AuthenticatedNoticeProcessingCommandService {
	return {
		async ingestSnapshots(input) {
			assertNoForbiddenAuthenticatedNoticeProcessingFields(input.payload);
			const snapshots = ensureArray<unknown>(input.payload.snapshots, "snapshots").map(
				normalizeAuthenticatedNoticeProcessingSnapshot,
			);
			await dependencies.store.upsertSnapshots({
				events: snapshots.flatMap(toEventWrites),
				snapshots: snapshots.map(toSnapshotWrite),
			});
			return { accepted: snapshots.length };
		},
	};
}
