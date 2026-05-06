import { createHash, randomUUID } from "node:crypto";

import { OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME } from "official-web-core/artifacts";
import type { OfficialWebPageTargetMatch } from "official-web-core";

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
const ALLOWED_ARTIFACT_TYPES: ReadonlySet<string> = new Set(
	Object.values(OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME),
);
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

function normalizeTargetMatches(
	value: unknown,
	field: string,
): OfficialWebPageTargetMatch[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array when provided.`,
			retryable: false,
			status: 422,
		});
	}

	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${field}[${index}]` },
				message: "target match must be an object.",
				retryable: false,
				status: 422,
			});
		}

		const match = item as Record<string, unknown>;
		const targetJobId = normalizeString(match.targetJobId);
		const targetId = normalizeString(match.targetId);
		const targetDeclarationVersion = normalizeString(match.targetDeclarationVersion);
		const consumerFamily = normalizeString(match.consumerFamily);
		const retentionPolicy = normalizeString(match.retentionPolicy);
		const materializationPolicy = normalizeString(match.materializationPolicy);
		const selectedWriteTarget = normalizeString(match.selectedWriteTarget);
		const reviewPolicy = normalizeString(match.reviewPolicy);
		const worksetReason = normalizeString(match.worksetReason);
		if (
			!(
				targetJobId &&
				targetId &&
				targetDeclarationVersion &&
				consumerFamily &&
				retentionPolicy &&
				materializationPolicy &&
				selectedWriteTarget &&
				reviewPolicy &&
				worksetReason
			)
		) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${field}[${index}]` },
				message:
					"targetJobId, targetId, targetDeclarationVersion, consumerFamily, retentionPolicy, materializationPolicy, selectedWriteTarget, reviewPolicy, and worksetReason are required.",
				retryable: false,
				status: 422,
			});
		}

		return {
			compositionGroup: normalizeNullableString(match.compositionGroup),
			compositionRole: normalizeNullableString(match.compositionRole),
			consumerFamily: consumerFamily as OfficialWebPageTargetMatch["consumerFamily"],
			materializationPolicy:
				materializationPolicy as OfficialWebPageTargetMatch["materializationPolicy"],
			retentionPolicy: retentionPolicy as OfficialWebPageTargetMatch["retentionPolicy"],
			reviewPolicy,
			selectedWriteTarget,
			sourcePackEntryId: normalizeNullableString(match.sourcePackEntryId),
			sourcePackId: normalizeNullableString(match.sourcePackId),
			targetCandidateId: normalizeNullableString(match.targetCandidateId),
			targetDeclarationVersion,
			targetId,
			targetJobId,
			worksetReason,
		} satisfies OfficialWebPageTargetMatch;
	});
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
			targetCandidateId: normalizeNullableString(observation.targetCandidateId),
			targetDeclarationVersion: normalizeNullableString(observation.targetDeclarationVersion),
			targetId: normalizeNullableString(observation.targetId),
			targetJobId: normalizeNullableString(observation.targetJobId),
			targetMatches: normalizeTargetMatches(
				observation.targetMatches ?? observation.target_matches,
				`pageObservations[${index}].targetMatches`,
			),
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
