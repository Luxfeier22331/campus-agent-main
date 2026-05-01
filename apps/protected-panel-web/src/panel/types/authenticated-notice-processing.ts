export interface AuthenticatedNoticeProcessingTimelineEvent {
	eventId?: string | null;
	occurredAt: string;
	payload?: Record<string, unknown>;
	stage: string;
	status: string;
	summary: string;
}

export interface RawAuthenticatedNoticeProcessingRecord {
	attemptCount: number;
	candidateKind: string | null;
	childTaskSummary: Record<string, unknown>;
	current: boolean;
	downstream: Record<string, unknown> | null;
	enqueueSource: string | null;
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
	targetSurface: string | null;
	timeline: AuthenticatedNoticeProcessingTimelineEvent[];
	title: string;
	toolReady: boolean;
}

export interface AuthenticatedNoticeProcessingRecord
	extends RawAuthenticatedNoticeProcessingRecord {}

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
	return {
		...input,
		id: input.id || input.noticeId,
	};
}
