import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { describe, it } from "vitest";

describe.skipIf(!process.env.TEMPORAL_NAMESPACE)("notice ingestion integration", () => {
	it("runs ingestion without a retrieval activity worker", async () => {
		const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
		const namespace = process.env.TEMPORAL_NAMESPACE;
		if (!namespace) {
			throw new Error("TEMPORAL_NAMESPACE is required when this test is enabled");
		}
		const client = new Client({ connection, namespace });
		const calls: string[] = [];
		const worker = await Worker.create({
			connection: native,
			namespace,
			taskQueue: "notice-pipeline",
			workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
			activities: {
				collectNotices: async () => {
					calls.push("collect");
					return { summary: { outcome: "success" } };
				},
				classifyNotices: async () => {
					calls.push("classify");
					return { outcome: "success" };
				},
				publishNoticesStage: async () => {
					calls.push("publish");
					return { outcome: "success" };
				},
			},
		});
		try {
			const observed = await worker.runUntil(async () => {
				const result = await client.workflow.execute("noticePipelineRun", {
					workflowId: `ingestion-test-${randomUUID()}`,
					taskQueue: "notice-pipeline",
					args: [{ mode: "scheduled" }],
				});
				return { result, calls: [...calls] };
			});
			assert.equal(observed.result.outcome, "success");
			assert.deepEqual(observed.calls, ["collect", "classify", "publish"]);
		} finally {
			await native.close();
			await connection.close();
		}
	});
});
