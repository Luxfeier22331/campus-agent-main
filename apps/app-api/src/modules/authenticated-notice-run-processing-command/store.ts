import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	authenticatedNoticeRunProcessingEventProjection,
	authenticatedNoticeRunProcessingProjection,
} from "../../db/schema";
import type { AuthenticatedNoticeRunProcessingSnapshot } from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface AuthenticatedNoticeRunProcessingSnapshotWrite
	extends AuthenticatedNoticeRunProcessingSnapshot {
	runProcessingId: string;
}

export interface AuthenticatedNoticeRunProcessingEventWrite {
	sourceRunToken: string;
	eventId: string;
	jobId: string | null;
	occurredAt: string;
	payload: Record<string, unknown>;
	projectedAt: string;
	runId: string;
	runKey: string;
	runProcessingId: string;
	stage: string;
	status: string;
	summary: string;
}

export interface AuthenticatedNoticeRunProcessingCommandStore {
	upsertSnapshots(input: {
		events: AuthenticatedNoticeRunProcessingEventWrite[];
		snapshots: AuthenticatedNoticeRunProcessingSnapshotWrite[];
	}): Promise<void>;
}

export function createPgAuthenticatedNoticeRunProcessingCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): AuthenticatedNoticeRunProcessingCommandStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async upsertSnapshots(input) {
			if (input.snapshots.length === 0) {
				return;
			}
			const db = await getDb();
			await db.transaction(async (tx) => {
				for (const snapshot of input.snapshots) {
					await tx
						.insert(authenticatedNoticeRunProcessingProjection)
						.values({
							attemptCount: snapshot.attemptCount,
							childTaskSummaryJson: snapshot.childTaskSummary,
							sourceRunToken: snapshot.sourceRunToken,
							downstreamJson: snapshot.downstream,
							enqueueSource: snapshot.enqueueSource,
							firstObservedAt: new Date(snapshot.firstObservedAt),
							jobSummariesJson: snapshot.jobSummaries,
							lastErrorCode: snapshot.lastErrorCode,
							lastErrorMessage: snapshot.lastErrorMessage,
							lastObservedAt: new Date(snapshot.lastObservedAt),
							latestQueueStatus: snapshot.latestQueueStatus,
							latestStage: snapshot.latestStage,
							lifecycleStatus: snapshot.lifecycleStatus,
							producerVersion: snapshot.producerVersion,
							projectedAt: new Date(snapshot.projectedAt),
							queueJobCount: snapshot.queueJobCount,
							queueStatusCountsJson: snapshot.queueStatusCounts,
							redactionVersion: snapshot.redactionVersion,
							replayBatchId: snapshot.replayBatchId,
							runId: snapshot.runId,
							runKey: snapshot.runKey,
							runProcessingId: snapshot.runProcessingId,
							siteId: snapshot.siteId,
							sourceChannel: snapshot.sourceChannel,
							sourceSurface: snapshot.sourceSurface,
							sourceTruthJson: snapshot.sourceTruth,
							timelineJson: snapshot.timeline,
						})
						.onConflictDoUpdate({
							set: {
								attemptCount: snapshot.attemptCount,
								childTaskSummaryJson: snapshot.childTaskSummary,
								sourceRunToken: snapshot.sourceRunToken,
								downstreamJson: snapshot.downstream,
								enqueueSource: snapshot.enqueueSource,
								firstObservedAt: new Date(snapshot.firstObservedAt),
								jobSummariesJson: snapshot.jobSummaries,
								lastErrorCode: snapshot.lastErrorCode,
								lastErrorMessage: snapshot.lastErrorMessage,
								lastObservedAt: new Date(snapshot.lastObservedAt),
								latestQueueStatus: snapshot.latestQueueStatus,
								latestStage: snapshot.latestStage,
								lifecycleStatus: snapshot.lifecycleStatus,
								producerVersion: snapshot.producerVersion,
								projectedAt: new Date(snapshot.projectedAt),
								queueJobCount: snapshot.queueJobCount,
								queueStatusCountsJson: snapshot.queueStatusCounts,
								redactionVersion: snapshot.redactionVersion,
								replayBatchId: snapshot.replayBatchId,
								runId: snapshot.runId,
								runKey: snapshot.runKey,
								siteId: snapshot.siteId,
								sourceChannel: snapshot.sourceChannel,
								sourceSurface: snapshot.sourceSurface,
								sourceTruthJson: snapshot.sourceTruth,
								timelineJson: snapshot.timeline,
							},
							target: authenticatedNoticeRunProcessingProjection.runProcessingId,
						});
				}

				for (const event of input.events) {
					await tx
						.insert(authenticatedNoticeRunProcessingEventProjection)
						.values({
							sourceRunToken: event.sourceRunToken,
							eventId: event.eventId,
							jobId: event.jobId,
							occurredAt: new Date(event.occurredAt),
							payloadJson: event.payload,
							projectedAt: new Date(event.projectedAt),
							runId: event.runId,
							runKey: event.runKey,
							runProcessingId: event.runProcessingId,
							stage: event.stage,
							status: event.status,
							summary: event.summary,
						})
						.onConflictDoUpdate({
							set: {
								sourceRunToken: event.sourceRunToken,
								jobId: event.jobId,
								occurredAt: new Date(event.occurredAt),
								payloadJson: event.payload,
								projectedAt: new Date(event.projectedAt),
								runId: event.runId,
								runKey: event.runKey,
								runProcessingId: event.runProcessingId,
								stage: event.stage,
								status: event.status,
								summary: event.summary,
							},
							target: authenticatedNoticeRunProcessingEventProjection.eventId,
						});
				}
			});
		},
	};
}
