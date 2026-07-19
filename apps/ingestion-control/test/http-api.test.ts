import { createIngestionTaskRegistryCatalog } from "ingest-core";
import { describe, expect, it } from "vitest";
import { createIngestionControlHandler } from "../src/http";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store";
import {
	IngestionWorkflowIdentityConflictError,
	type IngestionWorkflowStarter,
} from "../src/temporal-client";
import { testSnapshot, testTaskStartMetadata } from "./fixtures";

const tokens = {
	adminToken: "admin-token",
	opsToken: "ops-token",
};

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
			...testTaskStartMetadata,
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
			...testTaskStartMetadata,
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

	it("exposes and immediately validates through the fixed portal auth maintenance schedule", async () => {
		const status = maintenanceStatus("PAUSED");
		const starter = new RecordingStarter();
		starter.maintenanceStatus = status;
		const handler = handlerFor(new InMemoryIngestionTaskStore(), starter);

		const read = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/internal-portal-auth-maintenance",
				{ headers: { authorization: "Bearer ops-token" } },
			),
		);
		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ scheduleState: "PAUSED" });

		const validation = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/internal-portal-auth-maintenance/validate",
				{
					method: "POST",
					headers: {
						authorization: "Bearer ops-token",
						"x-operator-id": "ops@example.edu",
					},
				},
			),
		);
		expect(validation.status).toBe(202);
		expect(starter.validationCount).toBe(1);
	});

	it("starts exact file release IDs and forwards the operator identity", async () => {
		const starter = new RecordingStarter();
		const handler = handlerFor(new InMemoryIngestionTaskStore(), starter);
		const response = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/internal-portal/file-releases",
				{
					body: JSON.stringify({ file_release_ids: [646, 647], request_id: "batch-001" }),
					headers: {
						authorization: "Bearer ops-token",
						"content-type": "application/json",
						"x-operator-id": "ops@example.edu",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(202);
		expect(starter.fileReleaseStarts).toEqual([
			{ createdBy: "ops@example.edu", fileReleaseId: 646, requestId: "batch-001:646" },
			{ createdBy: "ops@example.edu", fileReleaseId: 647, requestId: "batch-001:647" },
		]);
	});

	it("rejects the retired notice reconcile limit", async () => {
		const starter = new RecordingStarter();
		const handler = handlerFor(new InMemoryIngestionTaskStore(), starter);
		const response = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/internal-portal/notice-publication/reconcile",
				{
					body: JSON.stringify({ max_notices: 100, request_id: "reconcile-001" }),
					headers: {
						authorization: "Bearer ops-token",
						"content-type": "application/json",
						"x-operator-id": "ops@example.edu",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(400);
		expect(starter.noticeReconcileStarts).toHaveLength(0);
	});

	it("decodes task IDs for operator detail and retry routes", async () => {
		const store = new InMemoryIngestionTaskStore();
		const snapshot = testSnapshot();
		snapshot.task.task_id = "task:encoded:001";
		snapshot.task.run_id = "run:encoded:001";
		store.recordTaskStarted({
			...testTaskStartMetadata,
			snapshot,
			workflowId: "ingestion/task:encoded:001",
			workflowRunId: "temporal-run-encoded-001",
		});
		store.failTask({
			errorCode: "collector_failed",
			errorMessage: "provider unavailable",
			taskId: snapshot.task.task_id,
		});
		const starter = new RecordingStarter();
		const handler = handlerFor(store, starter);

		const detail = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/tasks/task%3Aencoded%3A001",
				{ headers: { authorization: "Bearer ops-token" } },
			),
		);
		const retry = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/tasks/task%3Aencoded%3A001/retry",
				{
					headers: {
						authorization: "Bearer ops-token",
						"x-operator-id": "ops@example.edu",
					},
					method: "POST",
				},
			),
		);

		expect(detail.status).toBe(200);
		await expect(detail.json()).resolves.toMatchObject({ task_id: "task:encoded:001" });
		expect(retry.status).toBe(202);
		await expect(retry.json()).resolves.toMatchObject({ retry_of_task_id: "task:encoded:001" });
	});

	it("refuses standalone retry for a failed publication child task", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.recordTaskStarted({
			...testTaskStartMetadata,
			pipelineWorkflowId: "ingestion/internal-portal-notice/run-001",
			snapshot: testSnapshot(),
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
		});
		store.failTask({
			errorCode: "collector_failed",
			errorMessage: "provider unavailable",
			taskId: testSnapshot().task.task_id,
		});
		const starter = new RecordingStarter();
		const handler = handlerFor(store, starter);

		const response = await handler(
			new Request(
				`http://ingestion-control/internal/ingestion/operations/tasks/${testSnapshot().task.task_id}/retry`,
				{
					headers: {
						authorization: "Bearer ops-token",
						"x-operator-id": "ops@example.edu",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "ingestion_pipeline_task_retry_unsupported",
		});
		expect(starter.snapshots).toHaveLength(0);
	});

	it("rejects portal auth operations without the dedicated ops token", async () => {
		const handler = handlerFor(new InMemoryIngestionTaskStore(), new RecordingStarter());
		const response = await handler(
			new Request(
				"http://ingestion-control/internal/ingestion/operations/internal-portal-auth-maintenance",
			),
		);

		expect(response.status).toBe(401);
	});
});

class RecordingStarter implements IngestionWorkflowStarter {
	readonly fileReleaseStarts: Array<{
		createdBy: string;
		fileReleaseId: number;
		requestId: string;
	}> = [];
	readonly noticeReconcileStarts: Array<{
		createdBy: string;
		requestId: string;
	}> = [];
	maintenanceStatus = maintenanceStatus("ACTIVE");
	validationCount = 0;
	readonly snapshots: unknown[] = [];
	async getInternalPortalAuthMaintenanceStatus() {
		return this.maintenanceStatus;
	}
	async validateInternalPortalAuthentication() {
		this.validationCount += 1;
		this.maintenanceStatus = maintenanceStatus("ACTIVE");
		return this.maintenanceStatus;
	}
	async startInternalPortalFileRelease(input: {
		createdBy: string;
		fileReleaseId: number;
		requestId: string;
	}) {
		this.fileReleaseStarts.push(input);
		return {
			alreadyStarted: false,
			workflowId: `ingestion/file/${input.requestId}`,
			workflowRunId: "run-file",
			workflowStatus: "RUNNING" as const,
		};
	}
	async startInternalPortalNoticeReconcile(input: { createdBy: string; requestId: string }) {
		this.noticeReconcileStarts.push(input);
		return {
			alreadyStarted: false,
			workflowId: `ingestion/notice/${input.requestId}`,
			workflowRunId: "run-notice",
			workflowStatus: "RUNNING" as const,
		};
	}
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

function maintenanceStatus(scheduleState: "ACTIVE" | "PAUSED") {
	return {
		errorCode: null,
		lastAttemptAt: "2026-07-16T00:00:00.000Z",
		lastOutcome: "SUCCESS" as const,
		lastSuccessAt: "2026-07-16T00:00:03.000Z",
		nextRunAt: "2026-07-16T00:30:00.000Z",
		noticeProbeSucceeded: true,
		portalSessionEstablished: true,
		scheduleState,
		serviceTicketIssued: true,
		workflowId: "ingestion/internal-portal-auth-maintenance-2026-07-16T00:00:00Z",
		workflowRunId: "run-001",
	};
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
