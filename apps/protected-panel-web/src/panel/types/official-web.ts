export interface RawOfficialWebArtifactRecord {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

export type OfficialWebArtifactRecord = RawOfficialWebArtifactRecord;

export interface RawOfficialWebRunRecord {
	artifacts: RawOfficialWebArtifactRecord[];
	collectorVersion: string | null;
	configVersion: string | null;
	failureCount: number;
	finishedAt: string | null;
	ingestionDispatchRef: string | null;
	ingestionDispatchStatus: string;
	ingestionExecutionErrorCode: string | null;
	ingestionExecutionErrorMessage: string | null;
	ingestionExecutionRef: string | null;
	ingestionExecutionStatus: string;
	ingestionExecutionUpdatedAt: string | null;
	lastHeartbeatAt: string | null;
	projectedAt: string;
	runId: string;
	runIntent: "baseline" | "hot" | "repair";
	siteId: string;
	startedAt: string;
	status: string;
	summary: Record<string, unknown> | null;
}

export interface RawOfficialWebPageChangeRecord {
	changeStatus: string;
	fetchDisposition: string;
	host: string;
	httpStatus: number | null;
	id: string;
	lastChangeReason: string;
	normalizedCanonicalUrl: string;
	observedAt: string;
	pageFamily: string;
	pageTitleNormalized: string;
	rawAssetId: string | null;
	rawVersionId: string | null;
	runId: string;
}

export interface OfficialWebPageChangeRecord extends RawOfficialWebPageChangeRecord {}

export interface RawOfficialWebSiteFreshnessSummary {
	changedLast24h: number;
	deletedPages: number;
	duePages: number;
	failedFetchPages: number;
	hotPages: number;
	repairPages: number;
	totalPages: number;
}

export interface OfficialWebSiteFreshnessSummary extends RawOfficialWebSiteFreshnessSummary {}

export interface RawOfficialWebFreshnessPageRecord {
	cadenceClass: string;
	host: string;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: string;
	lastHttpStatus: number | null;
	lastSeenAt: string;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	siteId: string;
}

export interface OfficialWebFreshnessPageRecord extends RawOfficialWebFreshnessPageRecord {}

export interface RawOfficialWebSiteFreshnessBacklog {
	deletedPages: RawOfficialWebFreshnessPageRecord[];
	duePages: RawOfficialWebFreshnessPageRecord[];
	failedFetchPages: RawOfficialWebFreshnessPageRecord[];
	hotPages: RawOfficialWebFreshnessPageRecord[];
}

export interface OfficialWebSiteFreshnessBacklog {
	deletedPages: OfficialWebFreshnessPageRecord[];
	duePages: OfficialWebFreshnessPageRecord[];
	failedFetchPages: OfficialWebFreshnessPageRecord[];
	hotPages: OfficialWebFreshnessPageRecord[];
}

export interface OfficialWebRunRecord extends RawOfficialWebRunRecord {
	id: string;
	pageChangeSummary?: Record<string, number>;
	pageChanges?: OfficialWebPageChangeRecord[];
}

export interface RawOfficialWebTargetJobArtifactVerificationSummary {
	canonicalVerification: boolean;
	objectVerificationId: string | null;
	sourceHandoffId: string | null;
	status: string;
	updatedAt: string;
}

export interface RawOfficialWebTargetJobRecord {
	artifactVerificationSummary: RawOfficialWebTargetJobArtifactVerificationSummary | null;
	attemptCount: number;
	candidateCount: number;
	consumerFamily: string;
	createdAt: string;
	declarationVersion: string;
	id: string;
	idempotencyKey?: string;
	inventoryOnly: boolean;
	latestRunId: string | null;
	materializationPolicy: string;
	ownerSurface: string;
	requiredEvidence: string[];
	retentionPolicy: string;
	reviewPolicy: string;
	selectedWriteTarget: string;
	siteId: string;
	sourceHosts: string[];
	status: string;
	targetId: string;
	titleHints: string[];
	updatedAt: string;
	urlHints: string[];
}

export type OfficialWebTargetInventoryReviewState =
	| "candidate"
	| "previewed"
	| "blocked_fields"
	| "blocked_lineage"
	| "blocked_source"
	| "inventory_only"
	| "ready_for_selected_write"
	| "excluded";

export type OfficialWebTargetInventoryFieldStatus =
	| "ambiguous"
	| "missing"
	| "not_applicable"
	| "present"
	| "source_not_provided";

export interface RawOfficialWebTargetInventoryPreviewEvidence {
	appApiRunId: string;
	currentTruthImportWasNull: boolean;
	ingestionStatus: string;
	inventoryId: string;
	promotionDecision: string;
	rawAssetId: string;
	rawVersionId: string;
	sourceObjectKeys: string[];
	targetAttemptId: string;
	targetJobId: string;
}

export interface RawOfficialWebTargetInventoryRecord {
	admissionTargetId: string;
	consumerFamily: string;
	fieldStatus: Record<string, OfficialWebTargetInventoryFieldStatus>;
	id: string;
	inventoryId: string;
	ownerSurface: string;
	optionalEvidence: string[];
	optionalFields: string[];
	previewEvidence: RawOfficialWebTargetInventoryPreviewEvidence | null;
	releaseBlockers: string[];
	requiredEvidence: string[];
	requiredFields: string[];
	reviewState: OfficialWebTargetInventoryReviewState;
	selectedWriteTarget: string;
	sourceUrls: string[];
	targetLabel: string;
}

export interface OfficialWebTargetInventoryRecord extends RawOfficialWebTargetInventoryRecord {}

export interface RawOfficialWebTargetInventoryListResponse {
	entries: RawOfficialWebTargetInventoryRecord[];
	page: {
		nextCursor: string | null;
	};
	summary: {
		countsByReviewState: Partial<Record<OfficialWebTargetInventoryReviewState, number>>;
		inventoryVersion: string;
		siteId: string;
	};
}

export interface RawOfficialWebTargetJobCandidateRecord {
	candidateId: string;
	createdAt: string;
	eligibilityReason: string;
	normalizedCandidateUrl: string;
	priorityScore: number;
	sourceHost: string;
	status: string;
	titleHint: string | null;
	updatedAt: string;
	urlHint: string | null;
}

export interface RawOfficialWebTargetPageAttemptRecord {
	artifactCaptured: boolean;
	attemptId: string;
	attemptStatus: string;
	attemptedAt: string;
	candidateId: string | null;
	completedAt: string | null;
	httpStatus: number | null;
	normalizedCanonicalUrl: string;
	runId: string | null;
}

export interface RawOfficialWebTargetArtifactVerificationDetail
	extends RawOfficialWebTargetJobArtifactVerificationSummary {
	runId: string | null;
	summary: Record<string, unknown>;
	summaryId: string;
}

export interface RawOfficialWebTargetJobDetailRecord {
	artifactVerificationSummaries: RawOfficialWebTargetArtifactVerificationDetail[];
	attempts: RawOfficialWebTargetPageAttemptRecord[];
	candidates: RawOfficialWebTargetJobCandidateRecord[];
	job: RawOfficialWebTargetJobRecord;
}

export interface OfficialWebTargetJobRecord extends RawOfficialWebTargetJobRecord {
	artifactVerificationSummaries?: RawOfficialWebTargetArtifactVerificationDetail[];
	attempts?: RawOfficialWebTargetPageAttemptRecord[];
	candidates?: RawOfficialWebTargetJobCandidateRecord[];
	job?: RawOfficialWebTargetJobRecord;
}

export interface OfficialWebReleaseTaskTimelineEvent {
	eventId?: string | null;
	occurredAt: string;
	payload?: Record<string, unknown>;
	stage: string;
	status: string;
	summary: string;
}

export interface RawOfficialWebReleaseTaskRecord {
	attemptCount: number;
	createdAt: string;
	freshnessStatus: "fresh" | "stale" | "unknown";
	id: string;
	inputSummary: Record<string, unknown>;
	inventoryId: string;
	jobId: string;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	latestStage: string;
	lifecycleStatus: string;
	maxAttempts: number;
	observedAgeSeconds: number | null;
	outputSummary: Record<string, unknown>;
	producerVersion: string;
	projectedAt: string;
	redactionVersion: string;
	runId: string;
	schemaVersion: string;
	selectedWriteTarget: string | null;
	sourceChannel: string;
	staleAfterSeconds: number;
	staleReasonCode: string | null;
	taskId: string;
	taskType: string;
	timeline: OfficialWebReleaseTaskTimelineEvent[];
	updatedAt: string;
}

export interface OfficialWebReleaseTaskRecord extends RawOfficialWebReleaseTaskRecord {}

export interface RawOfficialWebReleaseTaskListResponse {
	page: {
		nextCursor: string | null;
	};
	tasks: RawOfficialWebReleaseTaskRecord[];
}

export interface RawOfficialWebReleaseTaskDetailResponse {
	task: RawOfficialWebReleaseTaskRecord;
}

export interface RawOfficialWebTargetJobListResponse {
	jobs: RawOfficialWebTargetJobRecord[];
	page: {
		nextCursor: string | null;
	};
}

export interface RawOfficialWebTargetJobDetailResponse {
	targetJob: RawOfficialWebTargetJobDetailRecord;
}

export interface RawOfficialWebRunListResponse {
	page: {
		nextCursor: string | null;
	};
	runs: RawOfficialWebRunRecord[];
}

export interface RawOfficialWebRunDetailRecord {
	pageChangeSummary: Record<string, number>;
	pageChanges: RawOfficialWebPageChangeRecord[];
	run: RawOfficialWebRunRecord;
}

export interface RawOfficialWebRunDetailResponse {
	run: RawOfficialWebRunDetailRecord;
}

export interface RawOfficialWebSiteRecord {
	displayName: string;
	hostRoots: string[];
	lastFailureAt: string | null;
	lastSuccessAt: string | null;
	latestCollectorVersion: string | null;
	latestConfigVersion: string | null;
	latestIngestionDispatchStatus: string | null;
	latestIngestionExecutionErrorCode: string | null;
	latestIngestionExecutionStatus: string | null;
	latestIngestionExecutionUpdatedAt: string | null;
	latestRunId: string | null;
	latestRunStatus: string | null;
	projectedAt: string;
	siteId: string;
}

export interface OfficialWebSiteRecord extends RawOfficialWebSiteRecord {
	id: string;
	freshnessBacklog?: OfficialWebSiteFreshnessBacklog;
	freshnessSummary?: OfficialWebSiteFreshnessSummary;
	recentPageChanges?: OfficialWebPageChangeRecord[];
	recentRuns?: OfficialWebRunRecord[];
}

export interface RawOfficialWebSiteListResponse {
	sites: RawOfficialWebSiteRecord[];
}

export interface RawOfficialWebSiteDetailResponse {
	freshnessBacklog: RawOfficialWebSiteFreshnessBacklog;
	freshnessSummary: RawOfficialWebSiteFreshnessSummary;
	recentPageChanges: RawOfficialWebPageChangeRecord[];
	recentRuns: RawOfficialWebRunRecord[];
	site: RawOfficialWebSiteRecord;
}

export function normalizeOfficialWebPageChangeRecord(
	input: RawOfficialWebPageChangeRecord,
): OfficialWebPageChangeRecord {
	return {
		...input,
	};
}

export function normalizeOfficialWebFreshnessPageRecord(
	input: RawOfficialWebFreshnessPageRecord,
): OfficialWebFreshnessPageRecord {
	return {
		...input,
	};
}

export function normalizeOfficialWebSiteFreshnessBacklog(
	input: RawOfficialWebSiteFreshnessBacklog,
): OfficialWebSiteFreshnessBacklog {
	return {
		deletedPages: input.deletedPages.map(normalizeOfficialWebFreshnessPageRecord),
		duePages: input.duePages.map(normalizeOfficialWebFreshnessPageRecord),
		failedFetchPages: input.failedFetchPages.map(normalizeOfficialWebFreshnessPageRecord),
		hotPages: input.hotPages.map(normalizeOfficialWebFreshnessPageRecord),
	};
}

export function normalizeOfficialWebRunRecord(
	input: RawOfficialWebRunRecord,
): OfficialWebRunRecord {
	return {
		...input,
		id: input.runId,
	};
}

export function normalizeOfficialWebTargetJobRecord(
	input: RawOfficialWebTargetJobRecord,
): OfficialWebTargetJobRecord {
	return {
		...input,
		id: input.id,
	};
}

export function normalizeOfficialWebTargetInventoryRecord(
	input: RawOfficialWebTargetInventoryRecord,
): OfficialWebTargetInventoryRecord {
	return {
		...input,
		id: input.id || input.inventoryId,
	};
}

export function normalizeOfficialWebReleaseTaskRecord(
	input: RawOfficialWebReleaseTaskRecord,
): OfficialWebReleaseTaskRecord {
	return {
		...input,
		id: input.id || input.taskId,
	};
}

export function normalizeOfficialWebSiteRecord(
	input: RawOfficialWebSiteRecord,
): OfficialWebSiteRecord {
	return {
		...input,
		id: input.siteId,
	};
}

export function normalizeOfficialWebSiteDetailRecord(
	input: RawOfficialWebSiteDetailResponse,
): OfficialWebSiteRecord {
	return {
		...normalizeOfficialWebSiteRecord(input.site),
		freshnessBacklog: normalizeOfficialWebSiteFreshnessBacklog(input.freshnessBacklog),
		freshnessSummary: input.freshnessSummary,
		recentPageChanges: input.recentPageChanges.map(normalizeOfficialWebPageChangeRecord),
		recentRuns: input.recentRuns.map(normalizeOfficialWebRunRecord),
	};
}

export function normalizeOfficialWebRunDetailRecord(
	input: RawOfficialWebRunDetailRecord,
): OfficialWebRunRecord {
	return {
		...normalizeOfficialWebRunRecord(input.run),
		pageChangeSummary: input.pageChangeSummary,
		pageChanges: input.pageChanges.map(normalizeOfficialWebPageChangeRecord),
	};
}

export function normalizeOfficialWebTargetJobDetailRecord(
	input: RawOfficialWebTargetJobDetailRecord,
): OfficialWebTargetJobRecord {
	return {
		...normalizeOfficialWebTargetJobRecord(input.job),
		artifactVerificationSummaries: input.artifactVerificationSummaries,
		attempts: input.attempts,
		candidates: input.candidates,
		job: input.job,
	};
}
