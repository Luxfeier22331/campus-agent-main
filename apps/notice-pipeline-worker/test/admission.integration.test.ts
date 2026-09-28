import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import type { RollbackInput } from "../src/contracts.ts";
import { RAG_MAINTENANCE_WORKFLOW_ID } from "../src/identity.ts";

const enabled = Boolean(process.env.TEMPORAL_NAMESPACE);
function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}
const workflowsPath = fileURLToPath(new URL("../src/workflows.ts", import.meta.url));
const input: RollbackInput = {
	expectedCurrent: "B",
	docsEmbeddingSet: "sha256:a",
	noticeEmbeddingSet: "sha256:b",
	producer: "automatic",
	producerRunId: "original",
};

describe.skipIf(!enabled)("atomic maintenance admission", () => {
	it("excludes manual and scheduled refresh during rollback, then admits a new scheduled refresh", async () => {
		const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const namespace = requiredEnv("TEMPORAL_NAMESPACE");
		const client = new Client({ connection, namespace });
		const _queue = `rag-admission-${randomUUID()}`;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const rollbackStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		let prepares = 0;
		const activities = {
			collectNotices: async () => ({ summary: { outcome: "success" } }),
			classifyNotices: async () => ({ outcome: "success" }),
			publishNoticesStage: async () => ({ outcome: "success" }),
			rollbackIndex: async () => {
				started();
				await gate;
				return { noOp: false };
			},
			prepareRefresh: async () => {
				prepares++;
				return { unchanged: true, expectedCurrent: "A" };
			},
			cleanupVersions: async () => ({ outcome: "success" }),
		};
		const worker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-pipeline",
			workflowsPath,
			activities,
		});
		const artifactWorker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-artifacts",
			activities,
		});
		const scheduleId = `rag-admission-${randomUUID()}`;
		let schedule: Awaited<ReturnType<typeof client.schedule.create>> | undefined;
		try {
			schedule = await client.schedule.create({
				scheduleId,
				spec: { intervals: [{ every: "1 hour" }] },
				state: { paused: true },
				policies: { overlap: "SKIP" },
				action: {
					type: "startWorkflow",
					workflowType: "noticePipelineScheduled",
					taskQueue: "notice-pipeline",
				},
			});
			await artifactWorker.runUntil(() =>
				worker.runUntil(async () => {
					const rollback = await client.workflow.start("noticePipelineRollback", {
						workflowId: RAG_MAINTENANCE_WORKFLOW_ID,
						taskQueue: "notice-pipeline",
						args: [input],
						workflowIdConflictPolicy: "FAIL",
						workflowIdReusePolicy: "ALLOW_DUPLICATE",
					});
					const currentSchedule = schedule;
					if (!currentSchedule) {
						throw new Error("schedule was not created");
					}
					await rollbackStarted;
					await expect(
						client.workflow.start("noticePipelineRun", {
							workflowId: RAG_MAINTENANCE_WORKFLOW_ID,
							taskQueue: "notice-pipeline",
							workflowIdConflictPolicy: "FAIL",
						}),
					).rejects.toBeInstanceOf(WorkflowExecutionAlreadyStartedError);
					await currentSchedule.unpause();
					await currentSchedule.trigger("SKIP");
					let scheduled: { workflowId: string; firstExecutionRunId: string } | undefined;
					await expect
						.poll(async () => {
							scheduled = (await currentSchedule.describe()).info.recentActions.at(-1)?.action
								.workflow;
							return Boolean(scheduled);
						})
						.toBe(true);
					if (!scheduled) {
						throw new Error("scheduled workflow was not recorded");
					}
					expect(
						await client.workflow
							.getHandle(scheduled.workflowId, scheduled.firstExecutionRunId)
							.result(),
					).toEqual({ outcome: "skipped", reason: "already-running" });
					expect(prepares).toBe(0);
					release();
					await rollback.result();
					const next = await client.workflow.start("noticePipelineScheduled", {
						workflowId: `next-${randomUUID()}`,
						taskQueue: "notice-pipeline",
					});
					expect(await next.result()).toMatchObject({
						outcome: "success",
						rag: { outcome: "skipped", collection: "A" },
					});
					expect(prepares).toBe(1);
					await Worker.runReplayHistory({ workflowsPath }, await next.fetchHistory());
				}),
			);
		} finally {
			release();
			await schedule?.delete();
			await native.close();
			await connection.close();
		}
	}, 60000);

	it("retries rollback with identical pinned input after lost acknowledgement and replays history", async () => {
		const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const namespace = requiredEnv("TEMPORAL_NAMESPACE");
		const client = new Client({ connection, namespace });
		const queue = `rag-rollback-retry-${randomUUID()}`;
		const received: RollbackInput[] = [];
		let current = "B";
		let previous = "A";
		const worker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-artifacts",
			workflowsPath,
			activities: {
				rollbackIndex: async (args: RollbackInput) => {
					received.push(args);
					if (current === "A") {
						return { noOp: true, collection: current };
					}
					expect(args.expectedCurrent).toBe(current);
					current = "A";
					previous = "B";
					throw new Error("activation committed; acknowledgement lost");
				},
			},
		});
		try {
			await worker.runUntil(async () => {
				const handle = await client.workflow.start("noticePipelineRollback", {
					workflowId: queue,
					taskQueue: "notice-artifacts",
					args: [input],
				});
				expect(await handle.result()).toEqual({ noOp: true, collection: "A" });
				expect(received).toEqual([input, input]);
				expect({ current, previous }).toEqual({ current: "A", previous: "B" });
				await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
			});
		} finally {
			await native.close();
			await connection.close();
		}
	}, 60000);
});
