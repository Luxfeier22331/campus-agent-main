import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	authenticatedNoticeProcessingEventProjection,
	authenticatedNoticeProcessingProjection,
} from "../../db/schema";
import type { AuthenticatedNoticeProcessingSnapshot } from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface AuthenticatedNoticeProcessingSnapshotWrite
	extends AuthenticatedNoticeProcessingSnapshot {
	processingId: string;
}

export interface AuthenticatedNoticeProcessingEventWrite {
	eventId: string;
	processingId: string;
	noticeKey: string;
	noticeId: string;
	runId: string | null;
	jobId: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload: Record<string, unknown>;
	projectedAt: string;
}

export interface AuthenticatedNoticeProcessingCommandStore {
	upsertSnapshots(input: {
		events: AuthenticatedNoticeProcessingEventWrite[];
		snapshots: AuthenticatedNoticeProcessingSnapshotWrite[];
	}): Promise<void>;
}

export function createPgAuthenticatedNoticeProcessingCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): AuthenticatedNoticeProcessingCommandStore {
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
						.insert(authenticatedNoticeProcessingProjection)
						.values({
							attemptCount: snapshot.attemptCount,
							candidateKind: snapshot.candidateKind,
							childTaskSummaryJson: snapshot.childTaskSummary,
							current: snapshot.current,
							downstreamJson: snapshot.downstream,
							enqueueSource: snapshot.enqueueSource,
							jobId: snapshot.jobId,
							lastErrorCode: snapshot.lastErrorCode,
							lastErrorMessage: snapshot.lastErrorMessage,
							lastObservedAt: new Date(snapshot.lastObservedAt),
							latestStage: snapshot.latestStage,
							lifecycleStatus: snapshot.lifecycleStatus,
							materializationStatus: snapshot.materializationStatus,
							noticeId: snapshot.noticeId,
							noticeKey: snapshot.noticeKey,
							processingId: snapshot.processingId,
							producerVersion: snapshot.producerVersion,
							projectedAt: new Date(snapshot.projectedAt),
							queueStatus: snapshot.queueStatus,
							readModelCountsJson: snapshot.readModelCounts,
							redactionVersion: snapshot.redactionVersion,
							releaseId: snapshot.releaseId,
							replayBatchId: snapshot.replayBatchId,
							runId: snapshot.runId,
							siteId: snapshot.siteId,
							sourceChannel: snapshot.sourceChannel,
							sourceSurface: snapshot.sourceSurface,
							sourceUpdatedAt: snapshot.sourceUpdatedAt
								? new Date(snapshot.sourceUpdatedAt)
								: null,
							targetSurface: snapshot.targetSurface,
							timelineJson: snapshot.timeline,
							title: snapshot.title,
							toolReady: snapshot.toolReady,
						})
						.onConflictDoUpdate({
							set: {
								attemptCount: snapshot.attemptCount,
								candidateKind: snapshot.candidateKind,
								childTaskSummaryJson: snapshot.childTaskSummary,
								current: snapshot.current,
								downstreamJson: snapshot.downstream,
								enqueueSource: snapshot.enqueueSource,
								jobId: snapshot.jobId,
								lastErrorCode: snapshot.lastErrorCode,
								lastErrorMessage: snapshot.lastErrorMessage,
								lastObservedAt: new Date(snapshot.lastObservedAt),
								latestStage: snapshot.latestStage,
								lifecycleStatus: snapshot.lifecycleStatus,
								materializationStatus: snapshot.materializationStatus,
								noticeKey: snapshot.noticeKey,
								producerVersion: snapshot.producerVersion,
								projectedAt: new Date(snapshot.projectedAt),
								queueStatus: snapshot.queueStatus,
								readModelCountsJson: snapshot.readModelCounts,
								redactionVersion: snapshot.redactionVersion,
								releaseId: snapshot.releaseId,
								replayBatchId: snapshot.replayBatchId,
								runId: snapshot.runId,
								siteId: snapshot.siteId,
								sourceChannel: snapshot.sourceChannel,
								sourceSurface: snapshot.sourceSurface,
								sourceUpdatedAt: snapshot.sourceUpdatedAt
									? new Date(snapshot.sourceUpdatedAt)
									: null,
								targetSurface: snapshot.targetSurface,
								timelineJson: snapshot.timeline,
								title: snapshot.title,
								toolReady: snapshot.toolReady,
							},
							target: authenticatedNoticeProcessingProjection.processingId,
						});
				}

				for (const event of input.events) {
					await tx
						.insert(authenticatedNoticeProcessingEventProjection)
						.values({
							eventId: event.eventId,
							jobId: event.jobId,
							noticeId: event.noticeId,
							noticeKey: event.noticeKey,
							occurredAt: new Date(event.occurredAt),
							payloadJson: event.payload,
							processingId: event.processingId,
							projectedAt: new Date(event.projectedAt),
							runId: event.runId,
							stage: event.stage,
							status: event.status,
							summary: event.summary,
						})
						.onConflictDoUpdate({
							set: {
								jobId: event.jobId,
								noticeId: event.noticeId,
								noticeKey: event.noticeKey,
								occurredAt: new Date(event.occurredAt),
								payloadJson: event.payload,
								processingId: event.processingId,
								projectedAt: new Date(event.projectedAt),
								runId: event.runId,
								stage: event.stage,
								status: event.status,
								summary: event.summary,
							},
							target: authenticatedNoticeProcessingEventProjection.eventId,
						});
				}
			});
		},
	};
}

export async function deleteAuthenticatedNoticeProcessingSnapshotForTests(input: {
	env: Env;
	processingId: string;
}): Promise<void> {
	const db = await createRuntimeDbGetter(input.env)();
	await db
		.delete(authenticatedNoticeProcessingProjection)
		.where(eq(authenticatedNoticeProcessingProjection.processingId, input.processingId));
}
