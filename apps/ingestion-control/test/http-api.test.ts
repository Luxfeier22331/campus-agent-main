import { createIngestionTaskRegistryCatalog } from "ingest-core";
import { describe, expect, it } from "vitest";
import { createIngestionControlHandler } from "../src/http";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import {
	IngestionWorkflowIdentityConflictError,
	type IngestionWorkflowStarter,
} from "../src/temporal-client";
import { testSnapshot } from "./fixtures";

const tokens = { adminToken: "admin-token", appApiProjectionToken: "projection-token" };

describe("ingestion-control HTTP", () => {
	it("starts Temporal before any PostgreSQL projection exists", async () => {
		const store = new InMemoryIngestionTaskStore();
		const starter = new RecordingStarter();
		const handler = handlerFor(store, starter);
		const response = await handler(taskRequest());
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({
			schema_version: "ingestion_workflow_start.v1",
			status: "accepted",
		});
		expect(starter.snapshots).toEqual([testSnapshot()]);
		expect(store.getTask(testSnapshot().task.task_id)).toBeNull();
	});

	it("does not create an orphan projection when Temporal start fails", async () => {
		const store = new InMemoryIngestionTaskStore();
		const handler = handlerFor(store, {
			async startTask() {
				throw new Error("Temporal unavailable");
			},
		});
		const response = await handler(taskRequest());
		expect(response.status).toBe(503);
		expect(store.getTask(testSnapshot().task.task_id)).toBeNull();
	});

	it("returns the existing projection for an already-started workflow", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.recordTaskStarted({
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		const handler = handlerFor(store, {
			async startTask() {
				return {
					alreadyStarted: true,
					workflowId: "ingestion/task-curriculum-chunk-001",
					workflowRunId: null,
					workflowStatus: "RUNNING",
				};
			},
		});
		const response = await handler(taskRequest());
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: "running" });
	});

	it("rejects a reused task id with a different frozen request", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.recordTaskStarted({
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		const handler = handlerFor(store, {
			async startTask(snapshot) {
				throw new IngestionWorkflowIdentityConflictError(
					`ingestion/${snapshot.task.task_id}`,
					snapshot.task.task_id,
				);
			},
		});

		const request = testSnapshot().task;
		const response = await handler(
			new Request("http://ingestion-control/internal/ingestion/tasks", {
				method: "POST",
				headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
				body: JSON.stringify({ ...request, run_id: "different-run" }),
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "ingestion_task_conflict",
			task_id: request.task_id,
			workflow_id: "ingestion/task-curriculum-chunk-001",
		});
	});

	it("reports a closed duplicate without a task projection as a conflict", async () => {
		const store = new InMemoryIngestionTaskStore();
		const handler = handlerFor(store, {
			async startTask() {
				return {
					alreadyStarted: true,
					workflowId: "ingestion/task-curriculum-chunk-001",
					workflowRunId: "temporal-run-failed",
					workflowStatus: "FAILED",
				};
			},
		});

		const response = await handler(taskRequest());

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: "ingestion_projection_missing",
			temporal_status: "FAILED",
		});
	});

	it("fails readiness when a runtime dependency is unavailable", async () => {
		const handler = createIngestionControlHandler({
			readinessCheck: async () => {
				throw new Error("database unavailable");
			},
			registryCatalog: createIngestionTaskRegistryCatalog([
				{ schema_version: "ingestion_task_registry.v3", tasks: [testSnapshot().registry_task] },
			]),
			store: new InMemoryIngestionTaskStore(),
		});

		const response = await handler(new Request("http://ingestion-control/readyz"));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ status: "unavailable" });
	});
});

class RecordingStarter implements IngestionWorkflowStarter {
	readonly snapshots: unknown[] = [];
	async startTask(snapshot: Parameters<IngestionWorkflowStarter["startTask"]>[0]) {
		this.snapshots.push(snapshot);
		return {
			alreadyStarted: false,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
			workflowStatus: "RUNNING" as const,
		};
	}
}

function handlerFor(store: InMemoryIngestionTaskStore, workflowStarter: IngestionWorkflowStarter) {
	return createIngestionControlHandler({
		store,
		workflowStarter,
		serviceTokens: tokens,
		registryCatalog: createIngestionTaskRegistryCatalog([
			{ schema_version: "ingestion_task_registry.v3", tasks: [testSnapshot().registry_task] },
		]),
	});
}

function taskRequest(): Request {
	return new Request("http://ingestion-control/internal/ingestion/tasks", {
		method: "POST",
		headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
		body: JSON.stringify(testSnapshot().task),
	});
}
