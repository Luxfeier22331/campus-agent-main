import type {
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
	OfficialWebRunIntent,
	OfficialWebRunStatus,
} from "ingestion-contracts";

export interface OfficialWebArtifactSummary {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

export interface OfficialWebRunOutboxEvent {
	attemptCount: number;
	availableAt: string;
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	processedAt: string | null;
	runId: string;
}

export interface OfficialWebRunProjectionSource {
	artifacts: OfficialWebArtifactSummary[];
	sourceAdapterVersion: string | null;
	configVersion: string | null;
	crawlPolicyVersion: string;
	failureCount: number;
	finishedAt: string | null;
	hostSet: string[];
	ingestionDispatchRef: string | null;
	ingestionDispatchStatus: OfficialWebIngestionDispatchStatus;
	ingestionExecutionErrorCode: string | null;
	ingestionExecutionErrorMessage: string | null;
	ingestionExecutionRef: string | null;
	ingestionExecutionStatus: OfficialWebIngestionExecutionStatus;
	ingestionExecutionUpdatedAt: string | null;
	lastHeartbeatAt: string | null;
	runId: string;
	runIntent: OfficialWebRunIntent;
	schedulerRunKey: string;
	seedSet: string[];
	siteId: string;
	startedAt: string;
	status: OfficialWebRunStatus;
	summary: Record<string, unknown> | null;
	triggerType: string;
}

export interface OfficialWebSiteProjectionSource {
	displayName: string;
	hostRoots: string[];
	lastFailureAt: string | null;
	lastSuccessAt: string | null;
	latestSourceAdapterVersion: string | null;
	latestConfigVersion: string | null;
	latestIngestionDispatchStatus: OfficialWebIngestionDispatchStatus | null;
	latestIngestionExecutionErrorCode: string | null;
	latestIngestionExecutionStatus: OfficialWebIngestionExecutionStatus | null;
	latestIngestionExecutionUpdatedAt: string | null;
	latestRunId: string | null;
	latestRunStatus: OfficialWebRunStatus | null;
	siteId: string;
}

export interface OfficialWebRunProjectionMaterialization extends OfficialWebRunProjectionSource {
	projectedAt: string;
}

export interface OfficialWebSiteProjectionMaterialization extends OfficialWebSiteProjectionSource {
	projectedAt: string;
}

export interface OfficialWebTargetArtifactVerificationSummaryWrite {
	canonicalVerification: boolean;
	jobId: string;
	objectVerificationId: string | null;
	runId: string;
	sourceHandoffId: string | null;
	status: string;
	summary: Record<string, unknown>;
	summaryId: string;
	updatedAt: string;
}

export interface OfficialWebProjectionStore {
	getRunProjectionSource(runId: string): Promise<OfficialWebRunProjectionSource | null>;
	getSiteProjectionSource(siteId: string): Promise<OfficialWebSiteProjectionSource | null>;
	listPendingEvents(limit: number, now: Date): Promise<OfficialWebRunOutboxEvent[]>;
	markEventFailed(input: {
		attemptCount: number;
		availableAt: string;
		eventId: string;
		lastError: string;
		processedAt: string | null;
	}): Promise<void>;
	markEventProcessed(input: { eventId: string; processedAt: string }): Promise<void>;
	markTimedOutRunsAsAbandoned(input: {
		heartbeatTimeoutSeconds: number;
		now: string;
	}): Promise<number>;
	updateRunDispatchStatus(input: {
		dispatchedAt: string;
		dispatchRef: string | null;
		runId: string;
		status: OfficialWebIngestionDispatchStatus;
	}): Promise<void>;
	updateRunExecutionStatus(input: {
		errorCode: string | null;
		errorMessage: string | null;
		executionRef: string | null;
		runId: string;
		status: OfficialWebIngestionExecutionStatus;
		updatedAt: string;
	}): Promise<boolean>;
	upsertRunProjection(projection: OfficialWebRunProjectionMaterialization): Promise<void>;
	upsertSiteProjection(projection: OfficialWebSiteProjectionMaterialization): Promise<void>;
	upsertTargetArtifactVerificationSummaries(
		records: OfficialWebTargetArtifactVerificationSummaryWrite[],
	): Promise<void>;
}
