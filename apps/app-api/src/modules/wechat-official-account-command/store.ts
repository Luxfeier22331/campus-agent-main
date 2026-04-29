import { and, desc, eq, inArray } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	wechatOfficialAccountCaptureRuns,
	wechatOfficialAccountRunArtifacts,
	wechatOfficialAccountRunHeartbeats,
} from "../../db/schema";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export type WeChatOfficialAccountRunStatus =
	| "accepted"
	| "running"
	| "completed"
	| "completed_with_errors"
	| "failed"
	| "abandoned";

export type WeChatOfficialAccountTerminalRunStatus =
	| "completed"
	| "completed_with_errors"
	| "failed";

export interface WeChatOfficialAccountArtifactRecord {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

export interface StoredWeChatOfficialAccountRun {
	accountName: string;
	accountSlug: string;
	collectorVersion: string;
	finishedAt: string | null;
	lastHeartbeatAt: string | null;
	latestHeartbeatSequence: number;
	provider: "feedwe";
	providerBaseUrl: string;
	requestSummary: Record<string, unknown>;
	runId: string;
	schedulerRunKey: string;
	sourceChannel: "wechat_official_account";
	startFingerprintSha256: string;
	startedAt: string;
	status: WeChatOfficialAccountRunStatus;
	summary: Record<string, unknown> | null;
	terminalErrorCode: string | null;
	terminalErrorMessage: string | null;
	terminalPayloadSha256: string | null;
	triggerType: string;
}

export interface WeChatOfficialAccountRunListItem {
	accountName: string;
	accountSlug: string;
	artifactCount: number;
	finishedAt: string | null;
	provider: "feedwe";
	runId: string;
	sourceChannel: "wechat_official_account";
	startedAt: string;
	status: WeChatOfficialAccountRunStatus;
	summary: Record<string, unknown> | null;
}

export interface WeChatOfficialAccountHeartbeatWrite {
	counts: Record<string, number>;
	createdAt: string;
	heartbeatId: string;
	observedAt: string;
	runId: string;
	sequence: number;
}

export interface AcceptWeChatOfficialAccountRunWrite {
	run: StoredWeChatOfficialAccountRun;
}

export interface AppendWeChatOfficialAccountHeartbeatWrite {
	heartbeat: WeChatOfficialAccountHeartbeatWrite;
	run: StoredWeChatOfficialAccountRun;
}

export interface FinalizeWeChatOfficialAccountRunWrite {
	artifacts: WeChatOfficialAccountArtifactRecord[];
	run: StoredWeChatOfficialAccountRun;
}

export interface WeChatOfficialAccountCommandStore {
	acceptRun(input: AcceptWeChatOfficialAccountRunWrite): Promise<StoredWeChatOfficialAccountRun>;
	appendHeartbeat(
		input: AppendWeChatOfficialAccountHeartbeatWrite,
	): Promise<StoredWeChatOfficialAccountRun>;
	finalizeRun(
		input: FinalizeWeChatOfficialAccountRunWrite,
	): Promise<StoredWeChatOfficialAccountRun>;
	getRunById(runId: string): Promise<StoredWeChatOfficialAccountRun | null>;
	getRunArtifacts(runId: string): Promise<WeChatOfficialAccountArtifactRecord[]>;
	getRunBySchedulerKey(
		provider: "feedwe",
		accountSlug: string,
		schedulerRunKey: string,
	): Promise<StoredWeChatOfficialAccountRun | null>;
	listRuns(input: { limit: number }): Promise<WeChatOfficialAccountRunListItem[]>;
}

function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function toStoredRun(
	row: typeof wechatOfficialAccountCaptureRuns.$inferSelect,
): StoredWeChatOfficialAccountRun {
	return {
		accountName: row.accountName,
		accountSlug: row.accountSlug,
		collectorVersion: row.collectorVersion,
		finishedAt: toIsoString(row.finishedAt),
		lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
		latestHeartbeatSequence: row.latestHeartbeatSequence,
		provider: "feedwe",
		providerBaseUrl: row.providerBaseUrl,
		requestSummary: row.requestSummaryJson,
		runId: row.runId,
		schedulerRunKey: row.schedulerRunKey,
		sourceChannel: "wechat_official_account",
		startFingerprintSha256: row.startFingerprintSha256,
		startedAt: row.startedAt.toISOString(),
		status: row.status as WeChatOfficialAccountRunStatus,
		summary: row.summaryJson ?? null,
		terminalErrorCode: row.terminalErrorCode ?? null,
		terminalErrorMessage: row.terminalErrorMessage ?? null,
		terminalPayloadSha256: row.terminalPayloadSha256 ?? null,
		triggerType: row.triggerType,
	};
}

function toRunListItem(
	row: StoredWeChatOfficialAccountRun,
	artifactCount: number,
): WeChatOfficialAccountRunListItem {
	return {
		accountName: row.accountName,
		accountSlug: row.accountSlug,
		artifactCount,
		finishedAt: row.finishedAt,
		provider: row.provider,
		runId: row.runId,
		sourceChannel: row.sourceChannel,
		startedAt: row.startedAt,
		status: row.status,
		summary: row.summary,
	};
}

function toArtifactRecord(
	row: typeof wechatOfficialAccountRunArtifacts.$inferSelect,
): WeChatOfficialAccountArtifactRecord {
	return {
		artifactType: row.artifactType,
		byteSize: row.byteSize,
		contentSha256: row.contentSha256,
		objectKey: row.objectKey,
		recordCount: row.recordCount,
	};
}

export function createPgWeChatOfficialAccountCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): WeChatOfficialAccountCommandStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async acceptRun(input) {
			const db = await getDb();
			await db.insert(wechatOfficialAccountCaptureRuns).values({
				accountName: input.run.accountName,
				accountSlug: input.run.accountSlug,
				collectorVersion: input.run.collectorVersion,
				createdAt: new Date(input.run.startedAt),
				finishedAt: null,
				lastHeartbeatAt: null,
				latestHeartbeatSequence: input.run.latestHeartbeatSequence,
				provider: input.run.provider,
				providerBaseUrl: input.run.providerBaseUrl,
				requestSummaryJson: input.run.requestSummary,
				runId: input.run.runId,
				schedulerRunKey: input.run.schedulerRunKey,
				sourceChannel: input.run.sourceChannel,
				startFingerprintSha256: input.run.startFingerprintSha256,
				startedAt: new Date(input.run.startedAt),
				status: input.run.status,
				summaryJson: input.run.summary,
				terminalErrorCode: null,
				terminalErrorMessage: null,
				terminalPayloadSha256: null,
				triggerType: input.run.triggerType,
				updatedAt: new Date(input.run.startedAt),
			});

			return input.run;
		},

		async appendHeartbeat(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx.insert(wechatOfficialAccountRunHeartbeats).values({
					countsJson: input.heartbeat.counts,
					createdAt: new Date(input.heartbeat.createdAt),
					heartbeatId: input.heartbeat.heartbeatId,
					observedAt: new Date(input.heartbeat.observedAt),
					runId: input.heartbeat.runId,
					sequence: input.heartbeat.sequence,
				});

				await tx
					.update(wechatOfficialAccountCaptureRuns)
					.set({
						lastHeartbeatAt: new Date(input.run.lastHeartbeatAt ?? input.heartbeat.observedAt),
						latestHeartbeatSequence: input.run.latestHeartbeatSequence,
						status: input.run.status,
						summaryJson: input.run.summary,
						updatedAt: new Date(input.heartbeat.createdAt),
					})
					.where(eq(wechatOfficialAccountCaptureRuns.runId, input.run.runId));
			});

			return input.run;
		},

		async finalizeRun(input) {
			const writeTimestamp = new Date(input.run.finishedAt ?? new Date().toISOString());
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.update(wechatOfficialAccountCaptureRuns)
					.set({
						finishedAt: input.run.finishedAt ? new Date(input.run.finishedAt) : null,
						status: input.run.status,
						summaryJson: input.run.summary,
						terminalErrorCode: input.run.terminalErrorCode,
						terminalErrorMessage: input.run.terminalErrorMessage,
						terminalPayloadSha256: input.run.terminalPayloadSha256,
						updatedAt: writeTimestamp,
					})
					.where(eq(wechatOfficialAccountCaptureRuns.runId, input.run.runId));

				if (input.artifacts.length > 0) {
					await tx.insert(wechatOfficialAccountRunArtifacts).values(
						input.artifacts.map((artifact, index) => ({
							artifactId: `${input.run.runId}_artifact_${index + 1}`,
							artifactType: artifact.artifactType,
							byteSize: artifact.byteSize,
							contentSha256: artifact.contentSha256,
							createdAt: writeTimestamp,
							objectKey: artifact.objectKey,
							recordCount: artifact.recordCount,
							runId: input.run.runId,
						})),
					);
				}
			});

			return input.run;
		},

		async getRunById(runId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(wechatOfficialAccountCaptureRuns)
				.where(eq(wechatOfficialAccountCaptureRuns.runId, runId))
				.limit(1);

			return rows[0] ? toStoredRun(rows[0]) : null;
		},

		async getRunArtifacts(runId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(wechatOfficialAccountRunArtifacts)
				.where(eq(wechatOfficialAccountRunArtifacts.runId, runId));
			return rows.map(toArtifactRecord);
		},

		async getRunBySchedulerKey(provider, accountSlug, schedulerRunKey) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(wechatOfficialAccountCaptureRuns)
				.where(
					and(
						eq(wechatOfficialAccountCaptureRuns.provider, provider),
						eq(wechatOfficialAccountCaptureRuns.accountSlug, accountSlug),
						eq(wechatOfficialAccountCaptureRuns.schedulerRunKey, schedulerRunKey),
					),
				)
				.limit(1);

			return rows[0] ? toStoredRun(rows[0]) : null;
		},

		async listRuns(input) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(wechatOfficialAccountCaptureRuns)
				.orderBy(desc(wechatOfficialAccountCaptureRuns.startedAt))
				.limit(input.limit);

			const runIds = rows.map((row) => row.runId);
			const artifactCounts = new Map<string, number>();
			if (runIds.length > 0) {
				const artifacts = await db
					.select({
						runId: wechatOfficialAccountRunArtifacts.runId,
					})
					.from(wechatOfficialAccountRunArtifacts)
					.where(inArray(wechatOfficialAccountRunArtifacts.runId, runIds));
				for (const artifact of artifacts) {
					artifactCounts.set(artifact.runId, (artifactCounts.get(artifact.runId) ?? 0) + 1);
				}
			}

			return rows.map((row) => toRunListItem(toStoredRun(row), artifactCounts.get(row.runId) ?? 0));
		},
	};
}
