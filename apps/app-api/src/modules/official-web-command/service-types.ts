import type { OfficialWebCollectorPrincipal } from "../auth";
import type {
	OfficialWebArtifactRecord,
	OfficialWebCommandStore,
	OfficialWebFetchDisposition,
	OfficialWebRunIntent,
	OfficialWebTerminalRunStatus,
} from "./store";

export interface OfficialWebStartPayload {
	collectorVersion?: unknown;
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

export interface OfficialWebCommandService {
	finalize(input: {
		payload: OfficialWebFinalizePayload;
		principal: OfficialWebCollectorPrincipal;
		runId: string;
	}): Promise<{
		run: {
			finishedAt: string | null;
			ingestionDispatchStatus: string;
			runId: string;
			status: string;
		};
	}>;
	heartbeat(input: {
		payload: OfficialWebHeartbeatPayload;
		principal: OfficialWebCollectorPrincipal;
		runId: string;
	}): Promise<{
		run: {
			lastHeartbeatAt: string | null;
			runId: string;
			status: string;
		};
	}>;
	start(input: {
		payload: OfficialWebStartPayload;
		principal: OfficialWebCollectorPrincipal;
	}): Promise<{
		run: {
			heartbeatIntervalSeconds: number;
			runId: string;
			siteId: string;
			startedAt: string;
			status: string;
		};
	}>;
}

export interface OfficialWebCommandServiceDependencies {
	computeFinalizeFingerprint?: (payload: NormalizedFinalizePayload) => string;
	computeStartFingerprint?: (payload: NormalizedStartPayload) => string;
	generateId?: (prefix: string) => string;
	heartbeatIntervalSeconds?: number;
	now?: () => Date;
	store: OfficialWebCommandStore;
}

export interface NormalizedStartPayload {
	collectorVersion: string;
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
}
