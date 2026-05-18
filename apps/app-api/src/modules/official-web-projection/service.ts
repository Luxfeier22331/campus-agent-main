import type {
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
	OfficialWebPageChange,
	OfficialWebRunIntent,
	OfficialWebRunStatus,
} from "../official-web-command";

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
	collectorVersion: string | null;
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
	projectedAtHint?: string | null;
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
	latestCollectorVersion: string | null;
	latestConfigVersion: string | null;
	latestIngestionDispatchStatus: OfficialWebIngestionDispatchStatus | null;
	latestIngestionExecutionErrorCode: string | null;
	latestIngestionExecutionStatus: OfficialWebIngestionExecutionStatus | null;
	latestIngestionExecutionUpdatedAt: string | null;
	latestRunId: string | null;
	latestRunStatus: OfficialWebRunStatus | null;
	projectedAtHint?: string | null;
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

export interface OfficialWebProjectionProjectorStore {
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
	upsertTargetArtifactVerificationSummaries?(
		records: OfficialWebTargetArtifactVerificationSummaryWrite[],
	): Promise<void>;
	upsertRunProjection(projection: OfficialWebRunProjectionMaterialization): Promise<void>;
	upsertSiteProjection(projection: OfficialWebSiteProjectionMaterialization): Promise<void>;
}

export interface OfficialWebIngestionHandoffPayload {
	artifacts: OfficialWebArtifactSummary[];
	collectorVersion: string | null;
	configVersion: string | null;
	crawlPolicyVersion: string;
	eventId: string;
	eventType: string;
	finishedAt: string | null;
	hostSet: string[];
	pageChanges: OfficialWebPageChange[];
	pageChangeSummary: Record<string, number>;
	runId: string;
	runIntent: OfficialWebRunIntent;
	schedulerRunKey: string;
	seedSet: string[];
	siteId: string;
	sourceChannel: "official_web";
	startedAt: string;
	status: OfficialWebRunStatus;
	summary: Record<string, unknown> | null;
	triggerType: string;
}

export interface OfficialWebHandoffPublisher {
	publish(input: OfficialWebIngestionHandoffPayload): Promise<{
		dispatchRef: string;
	}>;
}

export interface OfficialWebProjectionProjector {
	drain(input?: {
		limit?: number;
	}): Promise<{ abandoned: number; failed: number; processed: number; skipped: number }>;
}

export interface OfficialWebProjectionProjectorDependencies {
	handoffPublisher?: OfficialWebHandoffPublisher;
	heartbeatTimeoutSeconds?: number;
	now?: () => Date;
	store: OfficialWebProjectionProjectorStore;
}

const DEFAULT_DRAIN_LIMIT = 50;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 180;
const MAX_PROJECTION_ATTEMPTS = 5;
const PROJECTION_RETRY_BASE_DELAY_MS = 5_000;
const PROJECTION_RETRY_MAX_DELAY_MS = 5 * 60_000;
const TERMINAL_HANDOFF_EVENT_TYPES = new Set([
	"official_web.run.completed",
	"official_web.run.completed_with_errors",
	"official_web.run.failed",
	"official_web.run.abandoned",
]);

function computeRetryDelayMs(attemptCount: number): number {
	return Math.min(
		PROJECTION_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
		PROJECTION_RETRY_MAX_DELAY_MS,
	);
}

function shouldDispatchHandoff(
	event: OfficialWebRunOutboxEvent,
	run: OfficialWebRunProjectionSource,
): boolean {
	return (
		TERMINAL_HANDOFF_EVENT_TYPES.has(event.eventType) && run.ingestionDispatchStatus === "queued"
	);
}

function withRunDispatchStatus(
	run: OfficialWebRunProjectionSource,
	input: {
		dispatchRef: string | null;
		status: OfficialWebIngestionDispatchStatus;
	},
): OfficialWebRunProjectionSource {
	return {
		...run,
		ingestionDispatchRef: input.dispatchRef,
		ingestionDispatchStatus: input.status,
	};
}

function withSiteDispatchStatus(
	site: OfficialWebSiteProjectionSource,
	runId: string,
	status: OfficialWebIngestionDispatchStatus,
): OfficialWebSiteProjectionSource {
	if (site.latestRunId !== runId) {
		return site;
	}

	return {
		...site,
		latestIngestionDispatchStatus: status,
	};
}

function toOfficialWebIngestionHandoffPayload(input: {
	event: OfficialWebRunOutboxEvent;
	run: OfficialWebRunProjectionSource;
}): OfficialWebIngestionHandoffPayload {
	return {
		artifacts: input.run.artifacts,
		collectorVersion: input.run.collectorVersion,
		configVersion: input.run.configVersion,
		crawlPolicyVersion: input.run.crawlPolicyVersion,
		eventId: input.event.eventId,
		eventType: input.event.eventType,
		finishedAt: input.run.finishedAt,
		hostSet: input.run.hostSet,
		pageChanges: Array.isArray(input.event.payload.pageChanges)
			? (input.event.payload.pageChanges as OfficialWebPageChange[])
			: [],
		pageChangeSummary:
			input.event.payload.pageChangeSummary &&
			typeof input.event.payload.pageChangeSummary === "object"
				? (input.event.payload.pageChangeSummary as Record<string, number>)
				: {
						changedPages: 0,
						deletedPages: 0,
						failedFetchPages: 0,
						newPages: 0,
						notModifiedPages: 0,
					},
		runId: input.run.runId,
		runIntent: input.run.runIntent,
		schedulerRunKey: input.run.schedulerRunKey,
		seedSet: input.run.seedSet,
		siteId: input.run.siteId,
		sourceChannel: "official_web",
		startedAt: input.run.startedAt,
		status: input.run.status,
		summary: input.run.summary,
		triggerType: input.run.triggerType,
	};
}

export function toOfficialWebRunProjectionMaterialization(input: {
	execution: OfficialWebRunProjectionSource;
	projectedAt: string;
}): OfficialWebRunProjectionMaterialization {
	return {
		...input.execution,
		projectedAt: input.projectedAt,
	};
}

export function toOfficialWebSiteProjectionMaterialization(input: {
	execution: OfficialWebSiteProjectionSource;
	projectedAt: string;
}): OfficialWebSiteProjectionMaterialization {
	return {
		...input.execution,
		projectedAt: input.projectedAt,
	};
}

export function buildOfficialWebProjectionProjector(
	dependencies: OfficialWebProjectionProjectorDependencies,
): OfficialWebProjectionProjector {
	const heartbeatTimeoutSeconds =
		dependencies.heartbeatTimeoutSeconds ?? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;
	const now = dependencies.now ?? (() => new Date());

	return {
		async drain(input) {
			const limit = input?.limit && input.limit > 0 ? Math.floor(input.limit) : DEFAULT_DRAIN_LIMIT;
			const projectedAt = now().toISOString();
			const abandoned = await dependencies.store.markTimedOutRunsAsAbandoned({
				heartbeatTimeoutSeconds,
				now: projectedAt,
			});
			const events = await dependencies.store.listPendingEvents(limit, now());
			let processed = 0;
			let failed = 0;
			const skipped = 0;

			for (const event of events) {
				const eventProjectedAt = now().toISOString();
				let run: OfficialWebRunProjectionSource | null = null;
				let site: OfficialWebSiteProjectionSource | null = null;
				let projectionRun: OfficialWebRunProjectionSource | null = null;
				let projectionSite: OfficialWebSiteProjectionSource | null = null;
				let dispatchAttempted = false;
				let dispatchSucceeded = false;

				try {
					run = await dependencies.store.getRunProjectionSource(event.runId);
					if (!run) {
						throw new Error(`Missing official_web crawl run source for ${event.runId}.`);
					}

					site = await dependencies.store.getSiteProjectionSource(run.siteId);
					if (!site) {
						throw new Error(`Missing official_web site source for ${run.siteId}.`);
					}
					projectionRun = run;
					projectionSite = site;

					if (shouldDispatchHandoff(event, run)) {
						if (!dependencies.handoffPublisher) {
							throw new Error("Official web handoff publisher is not configured.");
						}

						dispatchAttempted = true;
						const handoff = await dependencies.handoffPublisher.publish(
							toOfficialWebIngestionHandoffPayload({
								event,
								run,
							}),
						);
						await dependencies.store.updateRunDispatchStatus({
							dispatchRef: handoff.dispatchRef,
							dispatchedAt: eventProjectedAt,
							runId: run.runId,
							status: "dispatched",
						});
						projectionRun = withRunDispatchStatus(run, {
							dispatchRef: handoff.dispatchRef,
							status: "dispatched",
						});
						projectionSite = withSiteDispatchStatus(site, run.runId, "dispatched");
						dispatchSucceeded = true;
					}

					await dependencies.store.upsertRunProjection(
						toOfficialWebRunProjectionMaterialization({
							execution: projectionRun,
							projectedAt: eventProjectedAt,
						}),
					);
					await dependencies.store.upsertSiteProjection(
						toOfficialWebSiteProjectionMaterialization({
							execution: projectionSite,
							projectedAt: eventProjectedAt,
						}),
					);
					await dependencies.store.markEventProcessed({
						eventId: event.eventId,
						processedAt: eventProjectedAt,
					});
					processed += 1;
				} catch (error) {
					const nextAttemptCount = event.attemptCount + 1;
					const terminalFailure = nextAttemptCount >= MAX_PROJECTION_ATTEMPTS;
					if (run && site) {
						if (dispatchAttempted && !dispatchSucceeded && terminalFailure) {
							await dependencies.store.updateRunDispatchStatus({
								dispatchRef: null,
								dispatchedAt: eventProjectedAt,
								runId: run.runId,
								status: "ingestion_failed",
							});
							projectionRun = withRunDispatchStatus(run, {
								dispatchRef: null,
								status: "ingestion_failed",
							});
							projectionSite = withSiteDispatchStatus(site, run.runId, "ingestion_failed");
						}

						if (projectionRun && projectionSite) {
							await dependencies.store.upsertRunProjection(
								toOfficialWebRunProjectionMaterialization({
									execution: projectionRun,
									projectedAt: eventProjectedAt,
								}),
							);
							await dependencies.store.upsertSiteProjection(
								toOfficialWebSiteProjectionMaterialization({
									execution: projectionSite,
									projectedAt: eventProjectedAt,
								}),
							);
						}
					}
					await dependencies.store.markEventFailed({
						attemptCount: nextAttemptCount,
						availableAt: terminalFailure
							? eventProjectedAt
							: new Date(now().valueOf() + computeRetryDelayMs(nextAttemptCount)).toISOString(),
						eventId: event.eventId,
						lastError:
							error instanceof Error
								? error.message
								: "Unexpected official_web projection materialization failure.",
						processedAt: terminalFailure ? eventProjectedAt : null,
					});
					failed += 1;
				}
			}

			return {
				abandoned,
				failed,
				processed,
				skipped,
			};
		},
	};
}
