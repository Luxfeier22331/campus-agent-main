import type {
	OfficialWebPageObservationRecord,
	OfficialWebRunArtifactRef,
	OfficialWebRunArtifactType,
	OfficialWebRunIntent,
} from "./official-web-core.ts";

export type OfficialWebTriggerType = "scheduled" | "manual" | "replay";
export type OfficialWebTerminalStatus = "completed" | "completed_with_errors" | "failed";

export interface OfficialWebRunStartInput {
	siteId: string;
	schedulerRunKey: string;
	runIntent: OfficialWebRunIntent;
	triggerType: OfficialWebTriggerType;
	collectorVersion: string;
	configVersion: string;
	crawlPolicyVersion: string;
	hostSet: string[];
	seedSet: string[];
	startedAt: string;
	traceId?: string;
}

export interface OfficialWebHeartbeatInput {
	runId: string;
	sequence: number;
	observedAt: string;
	counts: {
		urlsDiscovered: number;
		urlsFetched: number;
		pagesNormalized: number;
		artifactUploads: number;
		failures: number;
	};
	traceId?: string;
}

export interface OfficialWebFinalizeInput {
	runId: string;
	terminalStatus: OfficialWebTerminalStatus;
	finishedAt: string;
	pageObservations?: OfficialWebPageObservationRecord[];
	summary: {
		urlsDiscovered: number;
		urlsFetched: number;
		pagesNormalized: number;
		rawAssetsObserved: number;
		failureCount: number;
	};
	artifacts: Array<
		Pick<OfficialWebRunArtifactRef, "contentSha256" | "objectKey" | "recordCount"> & {
			artifactType: OfficialWebRunArtifactType;
		}
	>;
	traceId?: string;
}

export interface OfficialWebControlPlaneStartResponse {
	run: {
		runId: string;
		siteId: string;
		status: string;
		startedAt: string;
		heartbeatIntervalSeconds?: number;
	};
}

export interface OfficialWebControlPlaneHeartbeatResponse {
	run: {
		runId: string;
		status: string;
		lastHeartbeatAt?: string;
	};
}

export interface OfficialWebControlPlaneFinalizeResponse {
	run: {
		runId: string;
		status: string;
		finishedAt?: string;
		ingestionDispatchStatus?: string;
	};
}

export interface OfficialWebPlannerPageCandidate {
	cadenceClass: string;
	consumerFamily: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod:
		| "seed"
		| "robots_sitemap"
		| "configured_sitemap"
		| "navigation"
		| "manual_requeue";
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
	lastFetchDisposition: "fetched" | "not_modified" | "deleted" | "fetch_failed" | "never_fetched";
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

export interface OfficialWebControlPlanePlanResponse {
	plan: {
		duePages: OfficialWebPlannerPageCandidate[];
		hostFilter: string[];
		maxPagesPerHost: number;
		maxTotalPages: number;
		resolvedAt: string;
		runIntent: OfficialWebRunIntent;
		siteId: string;
		summary: {
			duePages: number;
			listingPages: number;
			repairPages: number;
			selectedHosts: number;
			staticPages: number;
			targetJobs: number;
			worksetRows: number;
		};
	};
}

export interface OfficialWebResolvePlanInput {
	hostFilter: string[];
	maxPagesPerHost: number;
	maxTotalPages: number;
	now: string;
	runIntent: OfficialWebRunIntent;
	siteId: string;
	targetCandidateIds?: string[];
	traceId?: string;
}

export interface OfficialWebControlPlaneClient {
	startRun(input: OfficialWebRunStartInput): Promise<OfficialWebControlPlaneStartResponse>;
	sendHeartbeat(
		input: OfficialWebHeartbeatInput,
	): Promise<OfficialWebControlPlaneHeartbeatResponse>;
	finalizeRun(input: OfficialWebFinalizeInput): Promise<OfficialWebControlPlaneFinalizeResponse>;
	resolvePlan(input: OfficialWebResolvePlanInput): Promise<OfficialWebControlPlanePlanResponse>;
}
