export interface AuthenticatedNoticeRunProcessingTimelineEvent {
	eventId?: string | null;
	occurredAt: string;
	payload?: Record<string, unknown>;
	stage: string;
	status: string;
	summary: string;
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

export interface RawAuthenticatedNoticeRunProcessingRecord {
	attemptCount: number;
	childTaskSummary: Record<string, unknown>;
	collectorRunToken: string;
	downstream: Record<string, unknown>;
	enqueueSource: string | null;
	firstObservedAt: string;
	freshnessStatus: "fresh" | "stale" | "unknown";
	id: string;
	jobSummaries: AuthenticatedNoticeRunProcessingJobSummary[];
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	lastObservedAt: string;
	latestQueueStatus: string;
	latestStage: string;
	lifecycleStatus: string;
	observedAgeSeconds: number | null;
	producerVersion: string;
	projectedAt: string;
	queueJobCount: number;
	queueStatusCounts: Record<string, number>;
	redactionVersion: string;
	replayBatchId: string | null;
	runId: string;
	runKey: string;
	siteId: string;
	sourceChannel: string;
	sourceSurface: string;
	sourceTruth: Record<string, unknown>;
	staleAfterSeconds: number;
	staleReasonCode: string | null;
	timeline: AuthenticatedNoticeRunProcessingTimelineEvent[];
}

export interface AuthenticatedNoticeRunProcessingRecord
	extends RawAuthenticatedNoticeRunProcessingRecord {}

export interface RawAuthenticatedNoticeRunProcessingListResponse {
	page: {
		nextCursor: string | null;
	};
	runs: RawAuthenticatedNoticeRunProcessingRecord[];
}

export interface RawAuthenticatedNoticeRunProcessingDetailResponse {
	run: RawAuthenticatedNoticeRunProcessingRecord;
}

export function normalizeAuthenticatedNoticeRunProcessingRecord(
	input: RawAuthenticatedNoticeRunProcessingRecord,
): AuthenticatedNoticeRunProcessingRecord {
	return {
		...input,
		id: input.id || input.collectorRunToken,
	};
}
