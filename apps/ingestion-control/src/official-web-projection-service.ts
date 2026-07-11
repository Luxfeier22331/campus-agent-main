import type { IngestionTaskRegistryCatalog } from "ingest-core";
import type { IngestionTaskEnvelope } from "ingestion-contracts";
import type {
	OfficialWebProjectionStore,
	OfficialWebRunOutboxEvent,
	OfficialWebRunProjectionMaterialization,
	OfficialWebRunProjectionSource,
	OfficialWebSiteProjectionMaterialization,
	OfficialWebSiteProjectionSource,
} from "./official-web-projection-types";
import type { IngestionWorkflowStarter } from "./temporal-client";
import type { IngestionTaskStore } from "./types";

export interface OfficialWebProjectionProjector {
	drain(input?: {
		limit?: number;
	}): Promise<{ abandoned: number; failed: number; processed: number; skipped: number }>;
}

export interface OfficialWebProjectionProjectorDependencies {
	heartbeatTimeoutSeconds?: number;
	now?: () => Date;
	registryCatalog?: IngestionTaskRegistryCatalog;
	sourceBucket?: string;
	store: OfficialWebProjectionStore;
	taskStore?: IngestionTaskStore;
	workflowStarter?: IngestionWorkflowStarter;
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
const OFFICIAL_WEB_INGESTION_COLLECTIONS = new Set(["fresh_news", "stable_reference"]);

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
		status: OfficialWebRunProjectionSource["ingestionDispatchStatus"];
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
	status: NonNullable<OfficialWebSiteProjectionSource["latestIngestionDispatchStatus"]>,
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
	const collection = resolveOfficialWebTaskCollection(input.event);
	const outputContract = `official_web_${collection}_source_truth.v1`;

	return {
		schema_version: "ingestion_task_envelope.v2",
		task_id: `task_official_web_${collection}_source_truth_${input.run.runId}`,
		run_id: input.run.runId,
		source_family: "official_web",
		source_channel: "official_web",
		corpus: "official_web",
		collection,
		registry_task_id: "source_truth_materialize",
		task_kind: "source_truth_materialize",
		input_ref: {
			kind: "object_store",
			uri: `s3://${sourceBucket}/${sourceTruthBundle.objectKey}`,
			digest: `sha256:${sourceTruthBundle.contentSha256}`,
		},
		input_contract: "official_web_source_truth_bundle.v1",
		output_contract: outputContract,
		idempotency_key: `official_web/${collection}/source_truth_materialize/${input.run.runId}/${input.event.eventId}`,
		created_by: "ingestion-control:official-web-projection",
		created_at: input.createdAt,
	};
}

function resolveOfficialWebTaskCollection(event: OfficialWebRunOutboxEvent): string {
	const selectedTargets = new Set<string>();
	for (const selectedWriteTarget of selectedWriteTargetsFromValue(event.payload)) {
		const collection = parseOfficialWebSelectedWriteTarget(selectedWriteTarget);
		if (collection) {
			selectedTargets.add(collection);
		}
	}
	if (selectedTargets.size === 1) {
		const [collection] = selectedTargets;
		return collection;
	}
	if (selectedTargets.size > 1) {
		throw new Error(
			`Official web terminal event maps to multiple ingestion collections: ${[...selectedTargets].sort().join(", ")}.`,
		);
	}
	throw new Error(
		"Official web terminal event requires an explicit official_web selected_write_target for task admission.",
	);
}

function selectedWriteTargetsFromValue(value: unknown): string[] {
	const targets: string[] = [];
	if (!value || typeof value !== "object") {
		return targets;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			targets.push(...selectedWriteTargetsFromValue(item));
		}
		return targets;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["selectedWriteTarget", "selected_write_target"]) {
		const selectedWriteTarget = record[key];
		if (typeof selectedWriteTarget === "string" && selectedWriteTarget.trim()) {
			targets.push(selectedWriteTarget.trim());
		}
	}
	const targetMatches = record.targetMatches ?? record.target_matches;
	if (Array.isArray(targetMatches)) {
		for (const match of targetMatches) {
			targets.push(...selectedWriteTargetsFromValue(match));
		}
	}
	const pageChanges = record.pageChanges ?? record.page_changes;
	if (Array.isArray(pageChanges)) {
		for (const pageChange of pageChanges) {
			targets.push(...selectedWriteTargetsFromValue(pageChange));
		}
	}
	return targets;
}

function parseOfficialWebSelectedWriteTarget(value: string): string | null {
	const match = value.trim().match(/^official_web\/([^/]+)$/u);
	if (!match) {
		return null;
	}
	const collection = match[1];
	if (!OFFICIAL_WEB_INGESTION_COLLECTIONS.has(collection)) {
		throw new Error(`Official web selected_write_target is not supported: ${value}.`);
	}
	return collection;
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

async function admitOfficialWebTask(input: {
	registryCatalog?: IngestionTaskRegistryCatalog;
	task: IngestionTaskEnvelope;
	taskStore?: IngestionTaskStore;
	workflowStarter?: IngestionWorkflowStarter;
}) {
	if (!(input.taskStore && input.workflowStarter && input.registryCatalog)) {
		throw new Error("Ingestion control task admission is not configured.");
	}
	input.registryCatalog.requireTask(input.task);
	const admission = await input.taskStore.admitTask(input.task);
	const admitted = admission.record;
	if (!admission.created && admitted.status !== "accepted") {
		return admitted;
	}
	await input.workflowStarter.startTask(admitted);
	return admitted;
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
						dispatchAttempted = true;
						const admitted = await admitOfficialWebTask({
							registryCatalog: dependencies.registryCatalog,
							task: toOfficialWebSourceTruthTask({
								createdAt: eventProjectedAt,
								event,
								run,
								sourceBucket,
							}),
							taskStore: dependencies.taskStore,
							workflowStarter: dependencies.workflowStarter,
						});
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
