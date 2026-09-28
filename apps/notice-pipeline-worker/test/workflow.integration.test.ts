import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Context, heartbeat } from "@temporalio/activity";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

const enabled = Boolean(process.env.TEMPORAL_NAMESPACE);
function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}
describe.skipIf(!enabled)("durable refresh workflow", () => {
	it("skips unchanged embedding, cleans up, and replays completed history", async () => {
		const connection = await Connection.connect({
			address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
		});
		const native = await NativeConnection.connect({
			address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
		});
		const queue = `rag-test-${randomUUID()}`;
		const namespace = requiredEnv("TEMPORAL_NAMESPACE");
		const client = new Client({ connection, namespace });
		const workflowsPath = fileURLToPath(new URL("../src/workflows.ts", import.meta.url));
		let embeds = 0;
		let cleanups = 0;
		const worker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-artifacts",
			workflowsPath,
			activities: {
				prepareRefresh: async () => ({ unchanged: true, expectedCurrent: "existing" }),
				embedNotices: async () => {
					embeds += 1;
				},
				cleanupVersions: async () => {
					cleanups += 1;
					return { outcome: "success" };
				},
			},
		});
		try {
			await worker.runUntil(async () => {
				const handle = await client.workflow.start("noticePipelineRun", {
					workflowId: queue,
					taskQueue: "notice-artifacts",
					args: [{ mode: "refresh" }],
				});
				expect(await handle.result()).toMatchObject({
					outcome: "success",
					rag: { outcome: "skipped", collection: "existing" },
				});
				await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
			});
			expect(embeds).toBe(0);
			expect(cleanups).toBe(1);
		} finally {
			await native.close();
			await connection.close();
		}
	}, 30000);
	it("cancels embedding without publishing", async () => {
		const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const namespace = requiredEnv("TEMPORAL_NAMESPACE");
		const client = new Client({ connection, namespace });
		const queue = `rag-cancel-${randomUUID()}`;
		let started!: () => void;
		const embeddingStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		let publishes = 0;
		const worker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-artifacts",
			maxHeartbeatThrottleInterval: "1 second",
			workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
			activities: {
				prepareRefresh: async () => ({ unchanged: false, expectedCurrent: "old" }),
				embedNotices: async () => {
					started();
					const timer = setInterval(() => heartbeat(), 50);
					try {
						await Context.current().cancelled;
					} finally {
						clearInterval(timer);
					}
				},
				publishRefresh: async () => {
					publishes += 1;
				},
			},
		});
		try {
			await worker.runUntil(async () => {
				const handle = await client.workflow.start("noticePipelineRun", {
					workflowId: queue,
					taskQueue: "notice-artifacts",
					args: [{ mode: "refresh" }],
				});
				await embeddingStarted;
				await handle.cancel();
				await expect(handle.result()).rejects.toThrow();
				expect((await handle.describe()).status.name).toBe("CANCELLED");
			});
			expect(publishes).toBe(0);
		} finally {
			await native.close();
			await connection.close();
		}
	}, 30000);

	it("resumes on a replacement worker and replays changed publication", async () => {
		const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const namespace = requiredEnv("TEMPORAL_NAMESPACE");
		const client = new Client({ connection, namespace });
		const queue = `rag-restart-${randomUUID()}`;
		const workflowsPath = fileURLToPath(new URL("../src/workflows.ts", import.meta.url));
		const calls: string[] = [];
		let prepareStarted!: () => void;
		const prepared = new Promise<void>((resolve) => {
			prepareStarted = resolve;
		});
		const first = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-artifacts",
			workflowsPath,
			activities: {
				prepareRefresh: async () => {
					prepareStarted();
					await Context.current().cancelled;
				},
			},
			shutdownGraceTime: "0 seconds",
		});
		try {
			const running = first.run();
			const handle = await client.workflow.start("noticePipelineRun", {
				workflowId: queue,
				taskQueue: "notice-artifacts",
				args: [{ mode: "refresh" }],
			});
			await prepared;
			first.shutdown();
			await running;
			const second = await Worker.create({
				connection: native,
				namespace,
				taskQueue: "notice-artifacts",
				workflowsPath,
				activities: {
					prepareRefresh: async () => {
						calls.push("prepare");
						return { unchanged: false, expectedCurrent: "old" };
					},
					embedNotices: async () => {
						calls.push("embed");
						return { embeddingSet: "set" };
					},
					publishRefresh: async () => {
						calls.push("publish");
						return { outcome: "success", collection: "new" };
					},
					cleanupVersions: async () => {
						calls.push("cleanup");
						return { outcome: "success" };
					},
				},
			});
			await second.runUntil(async () => {
				expect(await handle.result()).toMatchObject({
					outcome: "success",
					rag: { collection: "new" },
				});
				await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
			});
			expect(calls).toEqual(["prepare", "embed", "publish", "cleanup"]);
		} finally {
			await native.close();
			await connection.close();
		}
	}, 60000);
});
