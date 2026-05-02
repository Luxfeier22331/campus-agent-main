import { AppApiRouteError } from "../../http";
import type {
	OfficialWebReleaseTaskProcessingCommandStore,
	OfficialWebReleaseTaskProcessingEventWrite,
	OfficialWebReleaseTaskProcessingSnapshotWrite,
} from "./store";

export interface OfficialWebReleaseTaskProcessingTimelineEvent {
	eventId?: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload?: Record<string, unknown> | null;
}

export interface OfficialWebReleaseTaskProcessingSnapshot {
	id: string;
	schemaVersion: string;
	taskId: string;
	taskType: string;
	sourceChannel: string;
	inventoryId: string;
	jobId: string;
	runId: string;
	selectedWriteTarget: string | null;
	lifecycleStatus: string;
	latestStage: string;
	attemptCount: number;
	maxAttempts: number;
	inputSummary: Record<string, unknown>;
	outputSummary: Record<string, unknown>;
	timeline: OfficialWebReleaseTaskProcessingTimelineEvent[];
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	createdAt: string;
	updatedAt: string;
	projectedAt: string;
	producerVersion: string;
	redactionVersion: string;
}

export interface OfficialWebReleaseTaskProcessingSnapshotsPayload {
	snapshots?: unknown;
}

export interface OfficialWebReleaseTaskProcessingCommandService {
	ingestSnapshots(input: {
		payload: OfficialWebReleaseTaskProcessingSnapshotsPayload;
	}): Promise<{ accepted: number }>;
}

export interface OfficialWebReleaseTaskProcessingCommandServiceDependencies {
	store: OfficialWebReleaseTaskProcessingCommandStore;
}

const FORBIDDEN_SNAPSHOT_FIELDS = new Set([
	"artifactObjectKey",
	"artifact_object_key",
	"authorization",
	"bodyText",
	"bucket",
	"bundleObjectKey",
	"bundlePath",
	"bundle_object_key",
	"bundle_path",
	"contentBlocksObjectKey",
	"cookie",
	"credentials",
	"html",
	"inputRef",
	"input_ref",
	"key",
	"localPath",
	"manifestObjectKey",
	"objectKey",
	"objectStoreKey",
	"object_key",
	"outputRef",
	"output_ref",
	"pageManifestObjectKey",
	"presignedUrl",
	"rawBody",
	"rawHtml",
	"rawStack",
	"sourceFilePath",
	"sourceObjectRefs",
	"sourceObjectKeys",
	"source_object_refs",
	"source_object_keys",
	"stack",
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

export function assertNoForbiddenOfficialWebReleaseTaskProcessingFields(payload: unknown): void {
	const field = findForbiddenField(payload);
	if (field) {
		throw validationError(field.split(".").at(-1) ?? field, `${field} is not allowed.`);
	}
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw validationError(field, `${field} is required.`);
	}
	return normalized;
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
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

function ensureArray<T>(value: unknown, field: string): T[] {
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	return value as T[];
}

function normalizeTimelineEvent(
	value: unknown,
	index: number,
): OfficialWebReleaseTaskProcessingTimelineEvent {
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
		...(payload === null ? {} : { payload }),
	};
}

export function normalizeOfficialWebReleaseTaskProcessingSnapshot(
	value: unknown,
): OfficialWebReleaseTaskProcessingSnapshot {
	assertNoForbiddenOfficialWebReleaseTaskProcessingFields(value);
	const record = normalizeRecord(value, "snapshot");
	const taskId = normalizeRequiredString(record.taskId ?? record.id, "taskId");
	return {
		id: normalizeRequiredString(record.id ?? taskId, "id"),
		schemaVersion: normalizeRequiredString(record.schemaVersion, "schemaVersion"),
		taskId,
		taskType: normalizeRequiredString(record.taskType, "taskType"),
		sourceChannel: normalizeRequiredString(record.sourceChannel, "sourceChannel"),
		inventoryId: normalizeRequiredString(record.inventoryId, "inventoryId"),
		jobId: normalizeRequiredString(record.jobId, "jobId"),
		runId: normalizeRequiredString(record.runId, "runId"),
		selectedWriteTarget: normalizeNullableString(record.selectedWriteTarget),
		lifecycleStatus: normalizeRequiredString(record.lifecycleStatus, "lifecycleStatus"),
		latestStage: normalizeRequiredString(record.latestStage, "latestStage"),
		attemptCount: normalizeNonNegativeInteger(record.attemptCount, "attemptCount"),
		maxAttempts: normalizeNonNegativeInteger(record.maxAttempts, "maxAttempts"),
		inputSummary: normalizeRecord(record.inputSummary, "inputSummary"),
		outputSummary: normalizeRecord(record.outputSummary, "outputSummary"),
		timeline: ensureArray<unknown>(record.timeline, "timeline").map(normalizeTimelineEvent),
		lastErrorCode: normalizeNullableString(record.lastErrorCode),
		lastErrorMessage: normalizeNullableString(record.lastErrorMessage),
		createdAt: normalizeIsoTimestamp(record.createdAt, "createdAt"),
		updatedAt: normalizeIsoTimestamp(record.updatedAt, "updatedAt"),
		projectedAt: normalizeIsoTimestamp(record.projectedAt, "projectedAt"),
		producerVersion: normalizeRequiredString(record.producerVersion, "producerVersion"),
		redactionVersion: normalizeRequiredString(record.redactionVersion, "redactionVersion"),
	};
}

function toEventWrites(
	snapshot: OfficialWebReleaseTaskProcessingSnapshot,
): OfficialWebReleaseTaskProcessingEventWrite[] {
	return snapshot.timeline.map((event, index) => ({
		eventId:
			event.eventId ??
			`${snapshot.taskId}:${event.stage}:${event.status}:${event.occurredAt}:${index}`,
		inventoryId: snapshot.inventoryId,
		jobId: snapshot.jobId,
		occurredAt: event.occurredAt,
		payload: event.payload ?? {},
		projectedAt: snapshot.projectedAt,
		runId: snapshot.runId,
		stage: event.stage,
		status: event.status,
		summary: event.summary,
		taskId: snapshot.taskId,
	}));
}

function toSnapshotWrite(
	snapshot: OfficialWebReleaseTaskProcessingSnapshot,
): OfficialWebReleaseTaskProcessingSnapshotWrite {
	return {
		...snapshot,
		taskId: snapshot.taskId,
	};
}

export function buildOfficialWebReleaseTaskProcessingCommandService(
	dependencies: OfficialWebReleaseTaskProcessingCommandServiceDependencies,
): OfficialWebReleaseTaskProcessingCommandService {
	return {
		async ingestSnapshots(input) {
			assertNoForbiddenOfficialWebReleaseTaskProcessingFields(input.payload);
			const snapshots = ensureArray<unknown>(input.payload.snapshots, "snapshots").map(
				normalizeOfficialWebReleaseTaskProcessingSnapshot,
			);
			await dependencies.store.upsertSnapshots({
				events: snapshots.flatMap(toEventWrites),
				snapshots: snapshots.map(toSnapshotWrite),
			});
			return { accepted: snapshots.length };
		},
	};
}
