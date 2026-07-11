import { OfficialWebControlPlaneError } from "./official-web-control-plane-errors";
import type {
	NormalizedFinalizePayload,
	NormalizedHeartbeatPayload,
	NormalizedOfficialWebPlannerFilters,
	NormalizedPageObservation,
	NormalizedStartPayload,
	OfficialWebArtifactRecord,
	OfficialWebFinalizePayload,
	OfficialWebHeartbeatPayload,
	OfficialWebPageTargetMatch,
	OfficialWebPlannerPageCandidate,
	OfficialWebPlannerResolvePayload,
	OfficialWebStartPayload,
} from "./official-web-control-plane-types";
import type {
	OfficialWebFetchDisposition,
	OfficialWebRunIntent,
	OfficialWebTerminalRunStatus,
} from "./official-web-lifecycle";

const FINALIZEABLE_TERMINAL_STATUSES = new Set<OfficialWebTerminalRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
]);
const ALLOWED_RUN_INTENTS = new Set<OfficialWebRunIntent>(["baseline", "hot", "repair"]);
const ALLOWED_FETCH_DISPOSITIONS = new Set<OfficialWebFetchDisposition>([
	"fetched",
	"not_modified",
	"deleted",
	"fetch_failed",
]);
const ALLOWED_ARTIFACT_TYPES = new Set([
	"crawl_run_manifest",
	"host_summary",
	"url_results",
	"failures",
	"source_truth_bundle",
	"quality_audit",
	"page_observations",
	"dynamic_shell_discovery_audit",
]);
const CANONICAL_CONSUMER_FAMILIES = new Set([
	"academic_calendar_candidate",
	"stable_reference_candidate",
	"regulation_candidate",
	"student_regulation_candidate",
	"notice_news_candidate",
]);

export function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeStartPayload(payload: OfficialWebStartPayload): NormalizedStartPayload {
	const siteId = normalizeString(payload.siteId);
	const schedulerRunKey = normalizeString(payload.schedulerRunKey);
	const runIntent = normalizeString(payload.runIntent) as OfficialWebRunIntent;
	const triggerType = normalizeString(payload.triggerType);
	const sourceAdapterVersion = normalizeString(payload.sourceAdapterVersion);
	const configVersion = normalizeString(payload.configVersion);
	const crawlPolicyVersion = normalizeString(payload.crawlPolicyVersion);
	if (
		!(
			siteId &&
			schedulerRunKey &&
			runIntent &&
			triggerType &&
			sourceAdapterVersion &&
			configVersion &&
			crawlPolicyVersion
		)
	) {
		throw routeError({
			code: "validation_failed",
			details: {
				required: [
					"siteId",
					"schedulerRunKey",
					"runIntent",
					"triggerType",
					"sourceAdapterVersion",
					"configVersion",
					"crawlPolicyVersion",
				],
			},
			message: "Missing required official_web start fields.",
			status: 422,
		});
	}
	if (!ALLOWED_RUN_INTENTS.has(runIntent)) {
		throw routeError({
			code: "validation_failed",
			details: { field: "runIntent" },
			message: "runIntent is invalid.",
			status: 422,
		});
	}
	return {
		sourceAdapterVersion,
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
		throw routeError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "terminalStatus is invalid.",
			status: 422,
		});
	}
	const summary = normalizeNumericRecord(payload.summary, "summary");
	const failureCount = typeof summary.failureCount === "number" ? summary.failureCount : 0;
	if (terminalStatus === "completed" && failureCount > 0) {
		throw routeError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "completed finalize payload cannot carry failureCount > 0.",
			status: 422,
		});
	}
	if (terminalStatus === "completed_with_errors" && failureCount < 1) {
		throw routeError({
			code: "validation_failed",
			details: { field: "terminalStatus" },
			message: "completed_with_errors requires failureCount > 0.",
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

export function normalizeResolvePayload(
	payload: OfficialWebPlannerResolvePayload,
): NormalizedOfficialWebPlannerFilters {
	const siteId = normalizeString(payload.siteId);
	const runIntent = normalizeString(payload.runIntent) as OfficialWebRunIntent;
	if (!(siteId && runIntent && ALLOWED_RUN_INTENTS.has(runIntent))) {
		throw routeError({
			code: "validation_failed",
			details: { field: "siteId|runIntent" },
			message: "siteId and a valid runIntent are required.",
			status: 422,
		});
	}
	return {
		hostFilter: normalizeHostFilter(payload.hostFilter),
		maxPagesPerHost: normalizeStrictPositiveInteger(payload.maxPagesPerHost, "maxPagesPerHost"),
		maxTotalPages: normalizeStrictPositiveInteger(payload.maxTotalPages, "maxTotalPages"),
		now: payload.now == null ? new Date().toISOString() : normalizeIsoTimestamp(payload.now, "now"),
		runIntent,
		siteId,
		targetCandidateIds: normalizeStringListOptional(
			payload.targetCandidateIds,
			"targetCandidateIds",
		),
	};
}

export function assertCanonicalWorkset(pages: OfficialWebPlannerPageCandidate[]): void {
	for (const page of pages) {
		if (!CANONICAL_CONSUMER_FAMILIES.has(page.consumerFamily)) {
			throw routeError({
				code: "invalid_workset",
				details: {
					consumerFamily: page.consumerFamily,
					targetId: page.targetId,
					targetJobId: page.targetJobId,
				},
				message: "Official web target workset contains a non-canonical consumer family.",
				status: 500,
			});
		}
	}
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} is required.`,
			status: 422,
		});
	}
	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			status: 422,
		});
	}
	return timestamp.toISOString();
}

function normalizeStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-empty string array.`,
			status: 422,
		});
	}
	const normalized = [
		...new Set(value.map((item) => normalizeString(item)).filter(Boolean)),
	].sort();
	if (normalized.length === 0) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-empty string array.`,
			status: 422,
		});
	}
	return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizePositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-negative integer.`,
			status: 422,
		});
	}
	return value;
}

function normalizeStrictPositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || Math.floor(value) < 1) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a positive integer.`,
			status: 422,
		});
	}
	return Math.floor(value);
}

function normalizeNumericRecord(value: unknown, field: string): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an object.`,
			status: 422,
		});
	}
	const normalized: Record<string, number> = {};
	for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
		if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
			throw routeError({
				code: "validation_failed",
				details: { field: `${field}.${key}` },
				message: `${field}.${key} must be a non-negative number.`,
				status: 422,
			});
		}
		normalized[key] = candidate;
	}
	return normalized;
}

function normalizeNullableInteger(value: unknown, field: string): number | null {
	if (value == null) {
		return null;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-negative integer when provided.`,
			status: 422,
		});
	}
	return value;
}

function normalizeArtifacts(value: unknown): OfficialWebArtifactRecord[] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field: "artifacts" },
			message: "artifacts must be an array.",
			status: 422,
		});
	}
	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `artifacts[${index}]` },
				message: "artifact must be an object.",
				status: 422,
			});
		}
		const artifact = item as Record<string, unknown>;
		const artifactType = normalizeString(artifact.artifactType);
		const objectKey = normalizeString(artifact.objectKey);
		const contentSha256 = normalizeString(artifact.contentSha256);
		if (!(artifactType && ALLOWED_ARTIFACT_TYPES.has(artifactType))) {
			throw routeError({
				code: "validation_failed",
				details: { field: `artifacts[${index}].artifactType` },
				message: "artifactType is not allowed.",
				status: 422,
			});
		}
		if (!(objectKey && contentSha256)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `artifacts[${index}]` },
				message: "artifactType, objectKey, and contentSha256 are required.",
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
		};
	});
}

function normalizeTargetMatches(value: unknown, field: string): OfficialWebPageTargetMatch[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array when provided.`,
			status: 422,
		});
	}
	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `${field}[${index}]` },
				message: "target match must be an object.",
				status: 422,
			});
		}
		const match = item as Record<string, unknown>;
		const required = [
			"targetJobId",
			"targetId",
			"targetDeclarationVersion",
			"consumerFamily",
			"retentionPolicy",
			"materializationPolicy",
			"selectedWriteTarget",
			"reviewPolicy",
			"worksetReason",
		].map((key) => [key, normalizeString(match[key])] as const);
		if (required.some(([, normalized]) => !normalized)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `${field}[${index}]` },
				message:
					"targetJobId, targetId, targetDeclarationVersion, consumerFamily, retentionPolicy, materializationPolicy, selectedWriteTarget, reviewPolicy, and worksetReason are required.",
				status: 422,
			});
		}
		const values = Object.fromEntries(required);
		return {
			compositionGroup: normalizeOptionalString(match.compositionGroup),
			compositionRole: normalizeOptionalString(match.compositionRole),
			consumerFamily: values.consumerFamily,
			materializationPolicy: values.materializationPolicy,
			retentionPolicy: values.retentionPolicy,
			reviewPolicy: values.reviewPolicy,
			selectedWriteTarget: values.selectedWriteTarget,
			sourcePackEntryId: normalizeOptionalString(match.sourcePackEntryId),
			sourcePackId: normalizeOptionalString(match.sourcePackId),
			targetCandidateId: normalizeOptionalString(match.targetCandidateId),
			targetDeclarationVersion: values.targetDeclarationVersion,
			targetId: values.targetId,
			targetJobId: values.targetJobId,
			worksetReason: values.worksetReason,
		};
	});
}

function normalizePageObservations(value: unknown): NormalizedPageObservation[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field: "pageObservations" },
			message: "pageObservations must be an array.",
			status: 422,
		});
	}
	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}]` },
				message: "page observation must be an object.",
				status: 422,
			});
		}
		const observation = item as Record<string, unknown>;
		const fetchDisposition = normalizeString(
			observation.disposition ?? observation.fetchDisposition,
		) as OfficialWebFetchDisposition;
		if (!ALLOWED_FETCH_DISPOSITIONS.has(fetchDisposition)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}].disposition` },
				message: "page observation disposition is invalid.",
				status: 422,
			});
		}
		const observedAt = normalizeIsoTimestamp(
			observation.observedAt ?? observation.fetchedAt,
			`pageObservations[${index}].observedAt`,
		);
		const required = [
			"requestedUrl",
			"finalUrl",
			"normalizedCanonicalUrl",
			"host",
			"pageFamily",
			"pageTitleNormalized",
			"discoveryMethod",
		].map((key) => [key, normalizeString(observation[key])] as const);
		if (required.some(([, normalized]) => !normalized)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `pageObservations[${index}]` },
				message:
					"requestedUrl, finalUrl, normalizedCanonicalUrl, host, pageFamily, pageTitleNormalized, and discoveryMethod are required.",
				status: 422,
			});
		}
		const values = Object.fromEntries(required);
		return {
			contentType: normalizeOptionalString(observation.contentType),
			discoveredFromUrl: normalizeOptionalString(observation.discoveredFromUrl),
			discoveryMethod: values.discoveryMethod,
			etag: normalizeOptionalString(observation.etag),
			fetchDisposition,
			finalUrl: values.finalUrl,
			host: values.host,
			httpStatus: normalizeNullableInteger(
				observation.httpStatus,
				`pageObservations[${index}].httpStatus`,
			),
			lastModified: normalizeOptionalString(observation.lastModified),
			mainContentHash: normalizeOptionalString(observation.mainContentHash),
			normalizedCanonicalUrl: values.normalizedCanonicalUrl,
			observedAt,
			pageFamily: values.pageFamily,
			pageTitleNormalized: values.pageTitleNormalized,
			rawAssetId: normalizeOptionalString(observation.rawAssetId),
			rawVersionId: normalizeOptionalString(observation.rawVersionId),
			requestedUrl: values.requestedUrl,
			responseBodyHash: normalizeOptionalString(observation.responseBodyHash),
			targetCandidateId: normalizeOptionalString(observation.targetCandidateId),
			targetDeclarationVersion: normalizeOptionalString(observation.targetDeclarationVersion),
			targetId: normalizeOptionalString(observation.targetId),
			targetJobId: normalizeOptionalString(observation.targetJobId),
			targetMatches: normalizeTargetMatches(
				observation.targetMatches ?? observation.target_matches,
				`pageObservations[${index}].targetMatches`,
			),
		};
	});
}

function normalizeHostFilter(value: unknown): string[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field: "hostFilter" },
			message: "hostFilter must be an array of host strings.",
			status: 422,
		});
	}
	return [
		...new Set(
			value.map((item, index) => {
				const normalized = normalizeString(item);
				if (!normalized) {
					throw routeError({
						code: "validation_failed",
						details: { field: `hostFilter[${index}]` },
						message: "hostFilter entries must be non-empty host strings.",
						status: 422,
					});
				}
				return normalized.toLowerCase();
			}),
		),
	];
}

function normalizeStringListOptional(value: unknown, field: string): string[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array of non-empty strings.`,
			status: 422,
		});
	}
	return [
		...new Set(
			value.map((item, index) => {
				const normalized = normalizeString(item);
				if (!normalized) {
					throw routeError({
						code: "validation_failed",
						details: { field: `${field}[${index}]` },
						message: `${field} entries must be non-empty strings.`,
						status: 422,
					});
				}
				return normalized;
			}),
		),
	];
}

function routeError(input: { code: string; details?: unknown; message: string; status: number }) {
	return new OfficialWebControlPlaneError({
		...input,
		retryable: input.status >= 500,
	});
}
