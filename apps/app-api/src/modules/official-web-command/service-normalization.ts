import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type {
	NormalizedFinalizePayload,
	NormalizedHeartbeatPayload,
	NormalizedPageObservation,
	NormalizedStartPayload,
	OfficialWebFinalizePayload,
	OfficialWebHeartbeatPayload,
	OfficialWebStartPayload,
} from "./service-types";
import type {
	OfficialWebArtifactRecord,
	OfficialWebFetchDisposition,
	OfficialWebRunIntent,
	OfficialWebTerminalRunStatus,
} from "./store";

const FINALIZEABLE_TERMINAL_STATUSES = new Set<OfficialWebTerminalRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
]);
const ALLOWED_ARTIFACT_TYPES = new Set([
	"crawl_run_manifest",
	"host_summary",
	"url_results",
	"failures",
	"source_truth_bundle",
	"quality_audit",
	"page_observations",
]);
const ALLOWED_RUN_INTENTS = new Set<OfficialWebRunIntent>(["baseline", "hot", "repair"]);
const ALLOWED_FETCH_DISPOSITIONS = new Set<OfficialWebFetchDisposition>([
	"fetched",
	"not_modified",
	"deleted",
	"fetch_failed",
]);

export function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
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

function normalizeStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-empty string array.`,
			retryable: false,
			status: 422,
		});
	}

	const normalized = [
		...new Set(value.map((item) => normalizeString(item)).filter(Boolean)),
	].sort();
	if (normalized.length === 0) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-empty string array.`,
			retryable: false,
			status: 422,
		});
	}

	return normalized;
}

function normalizePositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
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

function normalizeNumericRecord(value: unknown, field: string): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an object.`,
			retryable: false,
			status: 422,
		});
	}

	const entries = Object.entries(value as Record<string, unknown>);
	const normalized: Record<string, number> = {};
	for (const [key, candidate] of entries) {
		if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${field}.${key}` },
				message: `${field}.${key} must be a non-negative number.`,
				retryable: false,
				status: 422,
			});
		}

		normalized[key] = candidate;
	}

	return normalized;
}

function normalizeArtifacts(value: unknown): OfficialWebArtifactRecord[] {
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "artifacts" },
			message: "artifacts must be an array.",
			retryable: false,
			status: 422,
		});
	}

	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `artifacts[${index}]` },
				message: "artifact must be an object.",
				retryable: false,
				status: 422,
			});
		}

		const artifact = item as Record<string, unknown>;
		const artifactType = normalizeString(artifact.artifactType);
		const objectKey = normalizeString(artifact.objectKey);
		const contentSha256 = normalizeString(artifact.contentSha256);
		if (!(artifactType && ALLOWED_ARTIFACT_TYPES.has(artifactType))) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `artifacts[${index}].artifactType` },
				message: "artifactType is not allowed.",
				retryable: false,
				status: 422,
			});
		}
		if (!(objectKey && contentSha256)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `artifacts[${index}]` },
				message: "artifactType, objectKey, and contentSha256 are required.",
				retryable: false,
				status: 422,
			});
		}

		return {
			artifactType,
			byteSize:
				typeof artifact.byteSize === "number" && Number.isInteger(artifact.byteSize)
					? artifact.byteSize
					: null,
			contentSha256,
			objectKey,
			recordCount:
				typeof artifact.recordCount === "number" && Number.isInteger(artifact.recordCount)
					? artifact.recordCount
					: null,
		} satisfies OfficialWebArtifactRecord;
	});
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizeNullableInteger(value: unknown, field: string): number | null {
	if (value == null) {
		return null;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-negative integer when provided.`,
			retryable: false,
			status: 422,
		});
	}
	return value;
}

function normalizePageObservations(value: unknown): NormalizedPageObservation[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "pageObservations" },
			message: "pageObservations must be an array.",
			retryable: false,
			status: 422,
		});
	}

	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}]` },
				message: "page observation must be an object.",
				retryable: false,
				status: 422,
			});
		}

		const observation = item as Record<string, unknown>;
		const fetchDisposition = normalizeString(
			observation.disposition ?? observation.fetchDisposition,
		) as OfficialWebFetchDisposition;
		if (!ALLOWED_FETCH_DISPOSITIONS.has(fetchDisposition)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}].disposition` },
				message: "page observation disposition is invalid.",
				retryable: false,
				status: 422,
			});
		}

		const observedAt = normalizeIsoTimestamp(
			observation.observedAt ?? observation.fetchedAt,
			`pageObservations[${index}].observedAt`,
		);
		const requestedUrl = normalizeString(observation.requestedUrl);
		const finalUrl = normalizeString(observation.finalUrl);
		const normalizedCanonicalUrl = normalizeString(observation.normalizedCanonicalUrl);
		const host = normalizeString(observation.host);
		const pageFamily = normalizeString(observation.pageFamily);
		const pageTitleNormalized = normalizeString(observation.pageTitleNormalized);
		const discoveryMethod = normalizeString(observation.discoveryMethod);
		if (
			!(
				requestedUrl &&
				finalUrl &&
				normalizedCanonicalUrl &&
				host &&
				pageFamily &&
				pageTitleNormalized &&
				discoveryMethod
			)
		) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}]` },
				message:
					"requestedUrl, finalUrl, normalizedCanonicalUrl, host, pageFamily, pageTitleNormalized, and discoveryMethod are required.",
				retryable: false,
				status: 422,
			});
		}

		return {
			contentType: normalizeNullableString(observation.contentType),
			discoveredFromUrl: normalizeNullableString(observation.discoveredFromUrl),
			discoveryMethod,
			etag: normalizeNullableString(observation.etag),
			fetchDisposition,
			finalUrl,
			host,
			httpStatus: normalizeNullableInteger(
				observation.httpStatus,
				`pageObservations[${index}].httpStatus`,
			),
			lastModified: normalizeNullableString(observation.lastModified),
			mainContentHash: normalizeNullableString(observation.mainContentHash),
			normalizedCanonicalUrl,
			observedAt,
			pageFamily,
			pageTitleNormalized,
			rawAssetId: normalizeNullableString(observation.rawAssetId),
			rawVersionId: normalizeNullableString(observation.rawVersionId),
			requestedUrl,
			responseBodyHash: normalizeNullableString(observation.responseBodyHash),
		} satisfies NormalizedPageObservation;
	});
}

export function normalizeStartPayload(payload: OfficialWebStartPayload): NormalizedStartPayload {
	const siteId = normalizeString(payload.siteId);
	const schedulerRunKey = normalizeString(payload.schedulerRunKey);
	const runIntent = normalizeString(payload.runIntent) as OfficialWebRunIntent;
	const triggerType = normalizeString(payload.triggerType);
	const collectorVersion = normalizeString(payload.collectorVersion);
	const configVersion = normalizeString(payload.configVersion);
	const crawlPolicyVersion = normalizeString(payload.crawlPolicyVersion);

	if (
		!(
			siteId &&
			schedulerRunKey &&
			runIntent &&
			triggerType &&
			collectorVersion &&
			configVersion &&
			crawlPolicyVersion
		)
	) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: {
				required: [
					"siteId",
					"schedulerRunKey",
					"runIntent",
					"triggerType",
					"collectorVersion",
					"configVersion",
					"crawlPolicyVersion",
				],
			},
			message: "Missing required official_web start fields.",
			retryable: false,
			status: 422,
		});
	}
	if (!ALLOWED_RUN_INTENTS.has(runIntent)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "runIntent" },
			message: "runIntent is invalid.",
			retryable: false,
			status: 422,
		});
	}

	return {
		collectorVersion,
		configVersion,
		crawlPolicyVersion,
		hostSet: normalizeStringList(payload.hostSet, "hostSet"),
		runIntent,
		schedulerRunKey,
		seedSet: normalizeStringList(payload.seedSet, "seedSet"),
		siteId,
		startedAt: normalizeIsoTimestamp(payload.startedAt, "startedAt"),
		triggerType,
	};
}

export function normalizeHeartbeatPayload(
	payload: OfficialWebHeartbeatPayload,
): NormalizedHeartbeatPayload {
	return {
		counts: normalizeNumericRecord(payload.counts, "counts"),
		observedAt: normalizeIsoTimestamp(payload.observedAt, "observedAt"),
		sequence: normalizePositiveInteger(payload.sequence, "sequence"),
	};
}

export function normalizeFinalizePayload(
	payload: OfficialWebFinalizePayload,
): NormalizedFinalizePayload {
	const terminalStatus = normalizeString(payload.terminalStatus) as OfficialWebTerminalRunStatus;
	if (!FINALIZEABLE_TERMINAL_STATUSES.has(terminalStatus)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "terminalStatus is invalid.",
			retryable: false,
			status: 422,
		});
	}

	const summary = normalizeNumericRecord(payload.summary, "summary");
	const failureCount = typeof summary.failureCount === "number" ? summary.failureCount : 0;
	if (terminalStatus === "completed" && failureCount > 0) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "completed finalize payload cannot carry failureCount > 0.",
			retryable: false,
			status: 422,
		});
	}
	if (terminalStatus === "completed_with_errors" && failureCount < 1) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "completed_with_errors requires failureCount > 0.",
			retryable: false,
			status: 422,
		});
	}

	return {
		artifacts: normalizeArtifacts(payload.artifacts ?? []),
		finishedAt: normalizeIsoTimestamp(payload.finishedAt, "finishedAt"),
		pageObservations: normalizePageObservations(payload.pageObservations),
		summary,
		terminalStatus,
	};
}
