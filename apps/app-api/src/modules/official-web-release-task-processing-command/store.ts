import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	officialWebReleaseTaskEventProjection,
	officialWebReleaseTaskProjection,
} from "../../db/schema";
import type { OfficialWebReleaseTaskProcessingSnapshot } from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface OfficialWebReleaseTaskProcessingSnapshotWrite
	extends OfficialWebReleaseTaskProcessingSnapshot {
	taskId: string;
}

export interface OfficialWebReleaseTaskProcessingEventWrite {
	eventId: string;
	taskId: string;
	inventoryId: string;
	jobId: string;
	runId: string;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload: Record<string, unknown>;
	projectedAt: string;
}

export interface OfficialWebReleaseTaskProcessingCommandStore {
	upsertSnapshots(input: {
		events: OfficialWebReleaseTaskProcessingEventWrite[];
		snapshots: OfficialWebReleaseTaskProcessingSnapshotWrite[];
	}): Promise<void>;
}

export function createPgOfficialWebReleaseTaskProcessingCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebReleaseTaskProcessingCommandStore {
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
						.insert(officialWebReleaseTaskProjection)
						.values({
							attemptCount: snapshot.attemptCount,
							createdAt: new Date(snapshot.createdAt),
							inputSummaryJson: snapshot.inputSummary,
							inventoryId: snapshot.inventoryId,
							jobId: snapshot.jobId,
							lastErrorCode: snapshot.lastErrorCode,
							lastErrorMessage: snapshot.lastErrorMessage,
							latestStage: snapshot.latestStage,
							lifecycleStatus: snapshot.lifecycleStatus,
							maxAttempts: snapshot.maxAttempts,
							outputSummaryJson: snapshot.outputSummary,
							producerVersion: snapshot.producerVersion,
							projectedAt: new Date(snapshot.projectedAt),
							redactionVersion: snapshot.redactionVersion,
							runId: snapshot.runId,
							selectedWriteTarget: snapshot.selectedWriteTarget,
							sourceChannel: snapshot.sourceChannel,
							taskId: snapshot.taskId,
							taskType: snapshot.taskType,
							timelineJson: snapshot.timeline,
							updatedAt: new Date(snapshot.updatedAt),
						})
						.onConflictDoUpdate({
							set: {
								attemptCount: snapshot.attemptCount,
								createdAt: new Date(snapshot.createdAt),
								inputSummaryJson: snapshot.inputSummary,
								inventoryId: snapshot.inventoryId,
								jobId: snapshot.jobId,
								lastErrorCode: snapshot.lastErrorCode,
								lastErrorMessage: snapshot.lastErrorMessage,
								latestStage: snapshot.latestStage,
								lifecycleStatus: snapshot.lifecycleStatus,
								maxAttempts: snapshot.maxAttempts,
								outputSummaryJson: snapshot.outputSummary,
								producerVersion: snapshot.producerVersion,
								projectedAt: new Date(snapshot.projectedAt),
								redactionVersion: snapshot.redactionVersion,
								runId: snapshot.runId,
								selectedWriteTarget: snapshot.selectedWriteTarget,
								sourceChannel: snapshot.sourceChannel,
								taskType: snapshot.taskType,
								timelineJson: snapshot.timeline,
								updatedAt: new Date(snapshot.updatedAt),
							},
							target: officialWebReleaseTaskProjection.taskId,
						});
				}

				for (const event of input.events) {
					await tx
						.insert(officialWebReleaseTaskEventProjection)
						.values({
							eventId: event.eventId,
							inventoryId: event.inventoryId,
							jobId: event.jobId,
							occurredAt: new Date(event.occurredAt),
							payloadJson: event.payload,
							projectedAt: new Date(event.projectedAt),
							runId: event.runId,
							stage: event.stage,
							status: event.status,
							summary: event.summary,
							taskId: event.taskId,
						})
						.onConflictDoUpdate({
							set: {
								inventoryId: event.inventoryId,
								jobId: event.jobId,
								occurredAt: new Date(event.occurredAt),
								payloadJson: event.payload,
								projectedAt: new Date(event.projectedAt),
								runId: event.runId,
								stage: event.stage,
								status: event.status,
								summary: event.summary,
								taskId: event.taskId,
							},
							target: officialWebReleaseTaskEventProjection.eventId,
						});
				}
			});
		},
	};
}
