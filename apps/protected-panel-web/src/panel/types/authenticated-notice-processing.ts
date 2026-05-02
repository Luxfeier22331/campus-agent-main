export interface AuthenticatedNoticeProcessingTimelineEvent {
	eventId?: string | null;
	occurredAt: string;
	payload?: Record<string, unknown>;
	stage: string;
	status: string;
	summary: string;
}

export interface AuthenticatedNoticeRagReleaseStatus {
	documentSiteStatus?: string;
	ragIndexStatus?: string;
	ragPreparationStatus?: string;
	ragServingStatus?: string;
	ragVerificationStatus?: string;
}

export interface RawAuthenticatedNoticeProcessingRecord {
	attemptCount: number;
	candidateKind: string | null;
	childTaskSummary: Record<string, unknown>;
	current: boolean;
	downstream: Record<string, unknown> | null;
	enqueueSource: string | null;
	freshnessStatus: "fresh" | "stale" | "unknown";
	id: string;
	jobId: string | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	lastObservedAt: string;
	latestStage: string;
	lifecycleStatus: string;
	materializationStatus: string | null;
	noticeId: string;
	noticeKey: string;
	producerVersion: string;
	projectedAt: string;
	queueStatus: string;
	readModelCounts: Record<string, number | string | boolean | null>;
	redactionVersion: string;
	releaseId: string | null;
	replayBatchId: string | null;
	runId: string | null;
	siteId: string;
	sourceChannel: string;
	sourceSurface: string;
	sourceUpdatedAt: string | null;
	observedAgeSeconds: number | null;
	staleAfterSeconds: number;
	staleReasonCode: string | null;
	targetSurface: string | null;
	timeline: AuthenticatedNoticeProcessingTimelineEvent[];
	title: string;
	toolReady: boolean;
}

export interface AuthenticatedNoticeProcessingRecord
	extends RawAuthenticatedNoticeProcessingRecord {
	ragReleaseStatus: AuthenticatedNoticeRagReleaseStatus | null;
}

export interface RawAuthenticatedNoticeProcessingListResponse {
	notices: RawAuthenticatedNoticeProcessingRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawAuthenticatedNoticeProcessingDetailResponse {
	notice: RawAuthenticatedNoticeProcessingRecord;
}

export function normalizeAuthenticatedNoticeProcessingRecord(
	input: RawAuthenticatedNoticeProcessingRecord,
): AuthenticatedNoticeProcessingRecord {
	const ragReleaseStatus = readRagReleaseStatus(input.downstream);
	return {
		...input,
		id: input.id || input.noticeId,
		ragReleaseStatus,
	};
}

function readRagReleaseStatus(
	downstream: Record<string, unknown> | null,
): AuthenticatedNoticeRagReleaseStatus | null {
	const value = downstream?.ragReleaseStatus;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	return {
		documentSiteStatus: readOptionalString(record.documentSiteStatus),
		ragIndexStatus: readOptionalString(record.ragIndexStatus),
		ragPreparationStatus: readOptionalString(record.ragPreparationStatus),
		ragServingStatus: readOptionalString(record.ragServingStatus),
		ragVerificationStatus: readOptionalString(record.ragVerificationStatus),
	};
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
