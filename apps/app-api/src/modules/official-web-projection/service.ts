import type { IngestionTaskEnvelope, IngestionTaskProjectionClient } from "../integration";
import type {
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
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

export interface OfficialWebProjectionProjector {
	drain(input?: {
		limit?: number;
	}): Promise<{ abandoned: number; failed: number; processed: number; skipped: number }>;
}

export interface OfficialWebProjectionProjectorDependencies {
	heartbeatTimeoutSeconds?: number;
	ingestionTasks?: IngestionTaskProjectionClient;
	now?: () => Date;
	sourceBucket?: string;
	store: OfficialWebProjectionProjectorStore;
}

const DEFAULT_DRAIN_LIMIT = 50;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 180;
const MAX_PROJECTION_ATTEMPTS = 5;
const PROJECTION_RETRY_BASE_DELAY_MS = 5_000;
const PROJECTION_RETRY_MAX_DELAY_MS = 5 * 60_000;
const TERMINAL_TASK_ADMISSION_EVENT_TYPES = new Set([
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

function shouldAdmitIngestionTask(
	event: OfficialWebRunOutboxEvent,
	run: OfficialWebRunProjectionSource,
): boolean {
	return (
		TERMINAL_TASK_ADMISSION_EVENT_TYPES.has(event.eventType) &&
		run.ingestionDispatchStatus === "queued"
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

function toOfficialWebSourceTruthTask(input: {
	createdAt: string;
	event: OfficialWebRunOutboxEvent;
	run: OfficialWebRunProjectionSource;
	sourceBucket: string;
}): IngestionTaskEnvelope {
	const sourceTruthBundle = input.run.artifacts.find(
		(artifact) => artifact.artifactType === "source_truth_bundle",
	);
	if (!sourceTruthBundle) {
		throw new Error("Official web source_truth_bundle artifact is required for task admission.");
	}
	const sourceBucket = input.sourceBucket.trim();
	if (!sourceBucket) {
		throw new Error("OBJECT_STORE_BUCKET_SOURCE is required for official web task admission.");
	}

	return {
		schema_version: "ingestion_task_envelope.v1",
		task_id: `task_official_web_stable_reference_source_truth_${input.run.runId}`,
		run_id: input.run.runId,
		source_family: "official_web",
		source_channel: "official_web",
		corpus: "official_web",
		collection: "stable_reference",
		task_kind: "source_truth_materialize",
		input_ref: {
			kind: "object_store",
			uri: `s3://${sourceBucket}/${sourceTruthBundle.objectKey}`,
			digest: `sha256:${sourceTruthBundle.contentSha256}`,
		},
		output_contract: "official_web_stable_reference_source_truth.v1",
		idempotency_key: `official_web/stable_reference/source_truth_materialize/${input.run.runId}/${input.event.eventId}`,
		lease_policy: {
			lease_seconds: 300,
			heartbeat_seconds: 30,
		},
		retry_policy: {
			max_attempts: 3,
		},
		created_by: "app-api:official-web-projection",
		created_at: input.createdAt,
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
	const sourceBucket = dependencies.sourceBucket?.trim() ?? "";

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

					if (shouldAdmitIngestionTask(event, run)) {
						if (!dependencies.ingestionTasks) {
							throw new Error("Ingestion control task admission is not configured.");
						}

						dispatchAttempted = true;
						const admitted = await dependencies.ingestionTasks.admitTask(
							toOfficialWebSourceTruthTask({
								createdAt: eventProjectedAt,
								event,
								run,
								sourceBucket,
							}),
						);
						await dependencies.store.updateRunDispatchStatus({
							dispatchRef: admitted.task_id,
							dispatchedAt: eventProjectedAt,
							runId: run.runId,
							status: "dispatched",
						});
						projectionRun = withRunDispatchStatus(run, {
							dispatchRef: admitted.task_id,
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
