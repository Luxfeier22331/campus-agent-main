import type {
	OfficialWebFetchDisposition,
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
	OfficialWebPageChangeStatus,
	OfficialWebRunIntent,
	OfficialWebRunStatus,
	OfficialWebTerminalRunStatus,
} from "ingestion-contracts";

export interface OfficialWebCollectorPrincipal {
	kind: "service";
	serviceClass: "official_web_collector";
	serviceId: "source-collector/official-web";
}

export interface OfficialWebPageTargetMatch {
	compositionGroup?: string | null;
	compositionRole?: string | null;
	consumerFamily: string;
	materializationPolicy: string;
	retentionPolicy: string;
	reviewPolicy: string;
	selectedWriteTarget: string;
	sourcePackEntryId?: string | null;
	sourcePackId?: string | null;
	targetCandidateId: string | null;
	targetDeclarationVersion: string;
	targetId: string;
	targetJobId: string;
	worksetReason: string;
}

export interface OfficialWebStartPayload {
	sourceAdapterVersion?: unknown;
	configVersion?: unknown;
	crawlPolicyVersion?: unknown;
	hostSet?: unknown;
	runIntent?: unknown;
	schedulerRunKey?: unknown;
	seedSet?: unknown;
	siteId?: unknown;
	startedAt?: unknown;
	triggerType?: unknown;
}

export interface OfficialWebHeartbeatPayload {
	counts?: unknown;
	observedAt?: unknown;
	sequence?: unknown;
}

export interface OfficialWebFinalizePayload {
	artifacts?: unknown;
	finishedAt?: unknown;
	pageObservations?: unknown;
	summary?: unknown;
	terminalStatus?: unknown;
}

export interface OfficialWebPlannerResolvePayload {
	hostFilter?: unknown;
	maxPagesPerHost?: unknown;
	maxTotalPages?: unknown;
	now?: unknown;
	runIntent?: unknown;
	siteId?: unknown;
	targetCandidateIds?: unknown;
}

export interface OfficialWebArtifactRecord {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

export interface StoredOfficialWebRun {
	sourceAdapterVersion: string;
	configVersion: string;
	crawlPolicyVersion: string;
	finishedAt: string | null;
	hostSet: string[];
	ingestionDispatchRef: string | null;
	ingestionDispatchStatus: OfficialWebIngestionDispatchStatus;
	ingestionDispatchedAt: string | null;
	ingestionExecutionErrorCode: string | null;
	ingestionExecutionErrorMessage: string | null;
	ingestionExecutionRef: string | null;
	ingestionExecutionStatus: OfficialWebIngestionExecutionStatus;
	ingestionExecutionUpdatedAt: string | null;
	lastHeartbeatAt: string | null;
	latestHeartbeatSequence: number;
	runId: string;
	runIntent: OfficialWebRunIntent;
	schedulerRunKey: string;
	seedSet: string[];
	siteId: string;
	startFingerprintSha256: string;
	startedAt: string;
	status: OfficialWebRunStatus;
	summary: Record<string, unknown> | null;
	terminalErrorCode: string | null;
	terminalErrorMessage: string | null;
	terminalPayloadSha256: string | null;
	triggerType: string;
}

export interface StoredOfficialWebPageFreshnessState {
	cadenceClass: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	etag: string | null;
	host: string;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: OfficialWebFetchDisposition;
	lastHttpStatus: number | null;
	lastModified: string | null;
	lastNotModifiedAt: string | null;
	lastSeenAt: string;
	lastSuccessfulRunId: string | null;
	mainContentHash: string | null;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	responseBodyHash: string | null;
	siteId: string;
}

export interface NormalizedPageObservation {
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	etag: string | null;
	fetchDisposition: OfficialWebFetchDisposition;
	finalUrl: string;
	host: string;
	httpStatus: number | null;
	lastModified: string | null;
	mainContentHash: string | null;
	normalizedCanonicalUrl: string;
	observedAt: string;
	pageFamily: string;
	pageTitleNormalized: string;
	rawAssetId: string | null;
	rawVersionId: string | null;
	requestedUrl: string;
	responseBodyHash: string | null;
	targetCandidateId: string | null;
	targetDeclarationVersion: string | null;
	targetId: string | null;
	targetJobId: string | null;
	targetMatches: OfficialWebPageTargetMatch[];
}

export interface NormalizedStartPayload {
	sourceAdapterVersion: string;
	configVersion: string;
	crawlPolicyVersion: string;
	hostSet: string[];
	runIntent: OfficialWebRunIntent;
	schedulerRunKey: string;
	seedSet: string[];
	siteId: string;
	startedAt: string;
	triggerType: string;
}

export interface NormalizedHeartbeatPayload {
	counts: Record<string, number>;
	observedAt: string;
	sequence: number;
}

export interface NormalizedFinalizePayload {
	artifacts: OfficialWebArtifactRecord[];
	finishedAt: string;
	pageObservations: NormalizedPageObservation[];
	summary: Record<string, number>;
	terminalStatus: OfficialWebTerminalRunStatus;
}

export interface NormalizedOfficialWebPlannerFilters {
	hostFilter: string[];
	maxPagesPerHost: number;
	maxTotalPages: number;
	now: string;
	runIntent: OfficialWebRunIntent;
	siteId: string;
	targetCandidateIds: string[];
}

export type OfficialWebPlannerFetchDisposition = OfficialWebFetchDisposition | "never_fetched";

export interface OfficialWebPlannerPageCandidate {
	cadenceClass: string;
	consumerFamily: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	etag: string | null;
	fetchProfile: string;
	host: string;
	hostPolicy: {
		host: string;
		sourceHost: string;
	};
	inventoryOnly: boolean;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: OfficialWebPlannerFetchDisposition;
	lastHttpStatus: number | null;
	lastModified: string | null;
	lastNotModifiedAt: string | null;
	lastSeenAt: string;
	lastSuccessfulRunId: string | null;
	mainContentHash: string | null;
	materializationPolicy: string;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	responseBodyHash: string | null;
	retentionPolicy: string;
	reviewPolicy: string;
	selectedWriteTarget: string;
	siteId: string;
	targetCandidateId: string | null;
	targetDeclarationVersion: string;
	targetId: string;
	targetJobId: string;
	worksetReason: string;
}

export interface PersistedOfficialWebPageObservation extends NormalizedPageObservation {
	cadenceClass: string;
	changeStatus: OfficialWebPageChangeStatus;
	lastChangeReason: string;
	nextEligibleFetchAt: string;
	observationId: string;
	priorityScore: number;
	runId: string;
	runIntent: OfficialWebRunIntent;
	siteId: string;
	freshness: {
		lastChangedAt: string | null;
		lastNotModifiedAt: string | null;
		lastSuccessfulRunId: string | null;
		mainContentHash: string | null;
		responseBodyHash: string | null;
	};
}

export interface OfficialWebPageChange {
	changeStatus: OfficialWebPageChangeStatus;
	normalizedCanonicalUrl: string;
	observedAt: string;
	pageFamily: string;
	rawAssetId: string | null;
	rawVersionId: string | null;
}

export interface OfficialWebRunOutboxWrite {
	attemptCount: number;
	availableAt: string;
	eventId: string;
	eventType: string;
	lastError: string | null;
	occurredAt: string;
	payload: Record<string, unknown>;
	processedAt: string | null;
	runId: string;
}
