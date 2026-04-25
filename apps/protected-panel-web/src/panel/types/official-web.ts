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
