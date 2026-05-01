import { AppApiRouteError } from "../../http";
import type {
	AuthenticatedNoticeRunProcessingCommandStore,
	AuthenticatedNoticeRunProcessingEventWrite,
	AuthenticatedNoticeRunProcessingSnapshotWrite,
} from "./store";

export interface AuthenticatedNoticeRunProcessingTimelineEvent {
	eventId?: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload?: Record<string, unknown> | null;
}

export interface AuthenticatedNoticeRunProcessingJobSummary {
	attemptCount?: number;
	jobId: string;
	lastErrorCode?: string | null;
	lastErrorMessage?: string | null;
	queueStatus: string;
	runId: string;
	selectedNoticeCount?: number;
	updatedAt?: string | null;
}

export interface AuthenticatedNoticeRunProcessingSnapshot {
	id: string;
	runKey: string;
	sourceChannel: string;
	sourceSurface: string;
	siteId: string;
	collectorRunToken: string;
	runId: string;
	replayBatchId: string | null;
	enqueueSource: string | null;
	lifecycleStatus: string;
	latestStage: string;
	latestQueueStatus: string;
	queueJobCount: number;
	queueStatusCounts: Record<string, number>;
	attemptCount: number;
	sourceTruth: Record<string, unknown>;
	childTaskSummary: Record<string, unknown>;
	downstream: Record<string, unknown>;
	jobSummaries: AuthenticatedNoticeRunProcessingJobSummary[];
	timeline: AuthenticatedNoticeRunProcessingTimelineEvent[];
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	firstObservedAt: string;
	lastObservedAt: string;
	projectedAt: string;
	producerVersion: string;
	redactionVersion: string;
}

export interface AuthenticatedNoticeRunProcessingSnapshotsPayload {
	snapshots?: unknown;
}

export interface AuthenticatedNoticeRunProcessingCommandService {
	ingestSnapshots(input: {
		payload: AuthenticatedNoticeRunProcessingSnapshotsPayload;
	}): Promise<{ accepted: number }>;
}

export interface AuthenticatedNoticeRunProcessingCommandServiceDependencies {
	store: AuthenticatedNoticeRunProcessingCommandStore;
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
	"sourceFilePath",
	"sourceObjectRefs",
	"stack",
	"artifact_path",
	"backupPath",
	"bundle_object_key",
	"manifest_object_key",
	"object_key",
	"output_refs",
	"source_object_refs",
]);

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

export function assertNoForbiddenAuthenticatedNoticeRunProcessingFields(payload: unknown): void {
	const field = findForbiddenField(payload);
	if (field) {
		throw validationError(field.split(".").at(-1) ?? field, `${field} is not allowed.`);
	}
}

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

function normalizeRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw validationError(field, `${field} must be an object.`);
	}
	return { ...(value as Record<string, unknown>) };
}

function normalizeNumberRecord(value: unknown, field: string): Record<string, number> {
	const record = normalizeRecord(value, field);
	const normalized: Record<string, number> = {};
	for (const [key, item] of Object.entries(record)) {
		if (typeof item === "number" && Number.isFinite(item)) {
			normalized[key] = Math.max(0, Math.floor(item));
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

function normalizeTimelineEvent(
	value: unknown,
	index: number,
): AuthenticatedNoticeRunProcessingTimelineEvent {
	const record = normalizeRecord(value, `timeline[${index}]`);
	const payload =
		record.payload === null || record.payload === undefined
			? null
			: normalizeRecord(record.payload, `timeline[${index}].payload`);
	return {
		eventId: normalizeNullableString(record.eventId),
		stage: normalizeRequiredString(record.stage, `timeline[${index}].stage`),
		status: normalizeRequiredString(record.status, `timeline[${index}].status`),
		occurredAt: normalizeIsoTimestamp(record.occurredAt, `timeline[${index}].occurredAt`),
		summary: normalizeRequiredString(record.summary, `timeline[${index}].summary`),
		...(payload ? { payload } : {}),
	};
}

function normalizeJobSummary(
	value: unknown,
	index: number,
): AuthenticatedNoticeRunProcessingJobSummary {
	const record = normalizeRecord(value, `jobSummaries[${index}]`);
	const attemptCount =
		record.attemptCount === undefined
			? undefined
			: normalizeNonNegativeInteger(record.attemptCount, `jobSummaries[${index}].attemptCount`);
	const selectedNoticeCount =
		record.selectedNoticeCount === undefined
			? undefined
			: normalizeNonNegativeInteger(
					record.selectedNoticeCount,
					`jobSummaries[${index}].selectedNoticeCount`,
				);
	return {
		...(attemptCount === undefined ? {} : { attemptCount }),
		jobId: normalizeRequiredString(record.jobId, `jobSummaries[${index}].jobId`),
		lastErrorCode: normalizeNullableString(record.lastErrorCode),
		lastErrorMessage: normalizeNullableString(record.lastErrorMessage),
		queueStatus: normalizeRequiredString(record.queueStatus, `jobSummaries[${index}].queueStatus`),
		runId: normalizeRequiredString(record.runId, `jobSummaries[${index}].runId`),
		...(selectedNoticeCount === undefined ? {} : { selectedNoticeCount }),
		updatedAt: normalizeNullableString(record.updatedAt),
	};
}

export function normalizeAuthenticatedNoticeRunProcessingSnapshot(
	value: unknown,
): AuthenticatedNoticeRunProcessingSnapshot {
	assertNoForbiddenAuthenticatedNoticeRunProcessingFields(value);
	const record = normalizeRecord(value, "snapshot");
	const timeline = ensureArray<unknown>(record.timeline, "timeline").map(normalizeTimelineEvent);
	return {
		id: normalizeRequiredString(record.id, "id"),
		runKey: normalizeRequiredString(record.runKey, "runKey"),
		sourceChannel: normalizeRequiredString(record.sourceChannel, "sourceChannel"),
		sourceSurface: normalizeRequiredString(record.sourceSurface, "sourceSurface"),
		siteId: normalizeRequiredString(record.siteId, "siteId"),
		collectorRunToken: normalizeRequiredString(record.collectorRunToken, "collectorRunToken"),
		runId: normalizeRequiredString(record.runId, "runId"),
		replayBatchId: normalizeNullableString(record.replayBatchId),
		enqueueSource: normalizeNullableString(record.enqueueSource),
		lifecycleStatus: normalizeRequiredString(record.lifecycleStatus, "lifecycleStatus"),
		latestStage: normalizeRequiredString(record.latestStage, "latestStage"),
		latestQueueStatus: normalizeRequiredString(record.latestQueueStatus, "latestQueueStatus"),
		queueJobCount: normalizeNonNegativeInteger(record.queueJobCount, "queueJobCount"),
		queueStatusCounts: normalizeNumberRecord(record.queueStatusCounts, "queueStatusCounts"),
		attemptCount: normalizeNonNegativeInteger(record.attemptCount, "attemptCount"),
		sourceTruth: normalizeRecord(record.sourceTruth, "sourceTruth"),
		childTaskSummary: normalizeRecord(record.childTaskSummary, "childTaskSummary"),
		downstream: normalizeRecord(record.downstream, "downstream"),
		jobSummaries: ensureArray<unknown>(record.jobSummaries, "jobSummaries").map(
			normalizeJobSummary,
		),
		timeline,
		lastErrorCode: normalizeNullableString(record.lastErrorCode),
		lastErrorMessage: normalizeNullableString(record.lastErrorMessage),
		firstObservedAt: normalizeIsoTimestamp(record.firstObservedAt, "firstObservedAt"),
		lastObservedAt: normalizeIsoTimestamp(record.lastObservedAt, "lastObservedAt"),
		projectedAt: normalizeIsoTimestamp(record.projectedAt, "projectedAt"),
		producerVersion: normalizeRequiredString(record.producerVersion, "producerVersion"),
		redactionVersion: normalizeRequiredString(record.redactionVersion, "redactionVersion"),
	};
}

function toEventWrites(
	snapshot: AuthenticatedNoticeRunProcessingSnapshot,
): AuthenticatedNoticeRunProcessingEventWrite[] {
	return snapshot.timeline.map((event, index) => ({
		collectorRunToken: snapshot.collectorRunToken,
		eventId:
			event.eventId ?? `${snapshot.id}:${event.stage}:${event.status}:${event.occurredAt}:${index}`,
		jobId: null,
		occurredAt: event.occurredAt,
		payload: event.payload ?? {},
		projectedAt: snapshot.projectedAt,
		runId: snapshot.runId,
		runKey: snapshot.runKey,
		runProcessingId: snapshot.id,
		stage: event.stage,
		status: event.status,
		summary: event.summary,
	}));
}

function toSnapshotWrite(
	snapshot: AuthenticatedNoticeRunProcessingSnapshot,
): AuthenticatedNoticeRunProcessingSnapshotWrite {
	return {
		...snapshot,
		runProcessingId: snapshot.id,
	};
}

export function buildAuthenticatedNoticeRunProcessingCommandService(
	dependencies: AuthenticatedNoticeRunProcessingCommandServiceDependencies,
): AuthenticatedNoticeRunProcessingCommandService {
	return {
		async ingestSnapshots(input) {
			assertNoForbiddenAuthenticatedNoticeRunProcessingFields(input.payload);
			const snapshots = ensureArray<unknown>(input.payload.snapshots, "snapshots").map(
				normalizeAuthenticatedNoticeRunProcessingSnapshot,
			);
			await dependencies.store.upsertSnapshots({
				events: snapshots.flatMap(toEventWrites),
				snapshots: snapshots.map(toSnapshotWrite),
			});
			return { accepted: snapshots.length };
		},
	};
}
