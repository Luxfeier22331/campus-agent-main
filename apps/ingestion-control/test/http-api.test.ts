import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import {
	createIngestionControlHandler,
	createIngestionTaskRegistryCatalog,
	type IngestionTaskEnvelope,
} from "../src/index.ts";
import type { OfficialWebControlPlaneService } from "../src/official-web-control-plane-service.ts";
import type { OfficialWebExecutionStatusService } from "../src/official-web-execution-status-service.ts";
import type { OfficialWebProjectionProjector } from "../src/official-web-projection-service.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	registry_task_id: "chunk_prepare",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

const serviceTokens = {
	adminToken: "admin-token",
	appApiProjectionToken: "app-api-projection-token",
	officialWebCollectorToken: "collector-token",
	officialWebExecutionStatusToken: "execution-status-token",
	officialWebProjectionToken: "projection-token",
};

describe("ingestion-control internal HTTP API", () => {
	it("admits and exposes queue state without executor mutation routes", async () => {
		const workflowStarter = new RecordingWorkflowStarter();
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store: new InMemoryIngestionTaskStore({
				now: () => new Date("2026-06-11T00:00:00Z"),
			}),
			workflowStarter,
		});

		const admittedResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(admittedResponse.status).toBe(202);
		const admitted = await json(admittedResponse);
		expect(admitted.status).toBe("accepted");
		expect(workflowStarter.startedTaskIds).toEqual([task.task_id]);

		const fetchedResponse = await handler(
			authorizedRequest(
				`http://ingestion-control/internal/ingestion/tasks/${task.task_id}`,
				"admin",
			),
		);
		expect(fetchedResponse.status).toBeLessThan(400);
		const fetched = await json(fetchedResponse);
		expect(fetched.task_id).toBe(task.task_id);
		expect(fetched.status).toBe("accepted");
	});

	it("fails closed when task admission has no workflow starter", async () => {
		const store = new InMemoryIngestionTaskStore();
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
		});

		const response = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(503);
		expect(await json(response)).toEqual({ error: "ingestion workflow starter is required" });
		expect(store.getTask(task.task_id)).toBeNull();
	});

	it("keeps an admitted task accepted and returns 503 when workflow start outcome is ambiguous", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
			workflowStarter: {
				async startTask() {
					throw new Error("temporal unavailable");
				},
			},
		});

		const response = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(503);
		expect(await json(response)).toEqual({ error: "temporal unavailable" });
		expect(store.getTask(task.task_id)).toMatchObject({
			status: "accepted",
			closeout: null,
		});
	});

	it("does not restart running or terminal duplicate admissions", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const workflowStarter = new RecordingWorkflowStarter();
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
			workflowStarter,
		});

		const firstResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(firstResponse.status).toBe(202);
		store.markTaskRunning({ taskId: task.task_id, workflowRunId: "temporal-run-001" });

		const runningDuplicateResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(runningDuplicateResponse.status).toBe(200);
		expect((await json(runningDuplicateResponse)).status).toBe("running");
		expect(workflowStarter.startedTaskIds).toEqual([task.task_id]);

		store.completeTask({ taskId: task.task_id, artifactRefs: [] });
		const terminalDuplicateResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		expect(terminalDuplicateResponse.status).toBe(200);
		expect((await json(terminalDuplicateResponse)).status).toBe("completed");
		expect(workflowStarter.startedTaskIds).toEqual([task.task_id]);
	});

	it("retries workflow start for duplicate admissions that remain accepted", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const workflowStarter = new RecordingWorkflowStarter();
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "ingestion_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
			workflowStarter,
		});

		await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);
		const duplicateResponse = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(duplicateResponse.status).toBe(202);
		expect(workflowStarter.startedTaskIds).toEqual([task.task_id, task.task_id]);
	});

	it("does not expose executor claim, heartbeat, complete or fail mutation routes", async () => {
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			serviceTokens,
			store: new InMemoryIngestionTaskStore(),
		});

		const routes = [
			new Request("http://ingestion-control/internal/ingestion/tasks/next"),
			new Request("http://ingestion-control/internal/ingestion/tasks/claim", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/heartbeat", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a" }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/complete", {
				method: "POST",
				body: JSON.stringify({ worker_id: "worker-a", artifact_refs: [] }),
			}),
			new Request("http://ingestion-control/internal/ingestion/tasks/task-1/fail", {
				method: "POST",
				body: JSON.stringify({
					error_code: "failed",
					error_message: "failed",
					worker_id: "worker-a",
				}),
			}),
		];

		for (const request of routes) {
			const response = await handler(request);
			expect(response.status).toBe(404);
		}
	});

	it("routes official-web collector control-plane requests through ingestion-control auth", async () => {
		const service = new RecordingOfficialWebControlPlaneService();
		const handler = createIngestionControlHandler({
			officialWebCollectorToken: "collector-token",
			officialWebControlPlaneService: service,
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			serviceTokens,
			store: new InMemoryIngestionTaskStore(),
		});

		const rejected = await handler(
			new Request("http://ingestion-control/internal/ingestion/official-web/runs", {
				body: JSON.stringify({ siteId: "campus_public" }),
				headers: { authorization: "Bearer wrong-token" },
				method: "POST",
			}),
		);
		expect(rejected.status).toBe(401);
		expect(await json(rejected)).toMatchObject({
			error: {
				code: "service_credential_required",
				retryable: false,
			},
		});

		const started = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/runs",
				"collector",
				{
					body: JSON.stringify({ siteId: "campus_public" }),
					method: "POST",
				},
			),
		);
		expect(started.status).toBe(200);
		expect(await json(started)).toMatchObject({
			run: {
				runId: "owrun_test",
				siteId: "campus_public",
				status: "accepted",
			},
		});

		const resolved = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/plans:resolve",
				"collector",
				{
					body: JSON.stringify({ siteId: "campus_public" }),
					method: "POST",
				},
			),
		);
		expect(resolved.status).toBe(200);
		expect(service.calls).toEqual(["start", "resolvePlan"]);
	});

	it("routes official-web projection drain and execution status through ingestion-control auth", async () => {
		const executionStatusService = new RecordingOfficialWebExecutionStatusService();
		const projectionProjector = new RecordingOfficialWebProjectionProjector();
		const handler = createIngestionControlHandler({
			officialWebCollectorToken: "collector-token",
			officialWebExecutionStatusService: executionStatusService,
			officialWebProjectionProjector: projectionProjector,
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			serviceTokens,
			store: new InMemoryIngestionTaskStore(),
		});

		const rejected = await handler(
			new Request("http://ingestion-control/internal/ingestion/official-web/projection:drain", {
				method: "POST",
			}),
		);
		expect(rejected.status).toBe(401);

		const collectorDrain = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/projection:drain",
				"collector",
				{
					body: JSON.stringify({ limit: 5 }),
					method: "POST",
				},
			),
		);
		expect(collectorDrain.status).toBe(401);

		const drained = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/projection:drain",
				"projection",
				{
					body: JSON.stringify({ limit: 5 }),
					method: "POST",
				},
			),
		);
		expect(drained.status).toBe(200);
		expect(await json(drained)).toEqual({
			abandoned: 0,
			failed: 0,
			processed: 3,
			skipped: 0,
		});
		expect(projectionProjector.calls).toEqual([{ limit: 5 }]);

		const executionUpdated = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/runs/owrun_01HQ/ingestion-execution",
				"execution-status",
				{
					body: JSON.stringify({
						executionRef: "task_01",
						status: "running",
						updatedAt: "2026-06-11T00:00:00.000Z",
					}),
					method: "POST",
				},
			),
		);
		expect(executionUpdated.status).toBe(200);
		expect(await json(executionUpdated)).toMatchObject({
			run: {
				ingestionExecutionRef: "task_01",
				ingestionExecutionStatus: "running",
				runId: "owrun_01HQ",
			},
		});
		expect(executionStatusService.calls).toEqual([
			{
				runId: "owrun_01HQ",
				payload: {
					executionRef: "task_01",
					status: "running",
					updatedAt: "2026-06-11T00:00:00.000Z",
				},
			},
		]);

		const collectorExecutionStatus = await handler(
			authorizedRequest(
				"http://ingestion-control/internal/ingestion/official-web/runs/owrun_01HQ/ingestion-execution",
				"collector",
				{
					body: JSON.stringify({
						executionRef: "task_02",
						status: "running",
						updatedAt: "2026-06-11T00:01:00.000Z",
					}),
					method: "POST",
				},
			),
		);
		expect(collectorExecutionStatus.status).toBe(401);
	});

	it("rejects task admission before storage when registry membership is missing", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			serviceTokens,
			store,
		});

		const response = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(400);
		expect(await json(response)).toEqual({
			error:
				"task collection is not declared by ingestion registry: curriculum/curriculum/curriculum_plan",
		});
		expect(store.getTask(task.task_id)).toBeNull();
	});

	it("rejects task admission before storage when output contract mismatches the registry", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-11T00:00:00Z"),
		});
		const handler = createIngestionControlHandler({
			registryCatalog: createIngestionTaskRegistryCatalog([
				{
					schema_version: "ingestion_task_registry.v2",
					source_family: "curriculum",
					corpus: "curriculum",
					collection: "curriculum_plan",
					tasks: [
						{
							registry_task_id: "chunk_prepare",
							task_kind: "chunk_prepare",
							executor_kind: "rust_kernel",
							kernel_id: "chunk-document-units",
							input_contract: "canonical_document_units.v1",
							output_contract: "expected_chunk_set.v1",
						},
					],
				},
			]),
			serviceTokens,
			store,
		});

		const response = await handler(
			authorizedRequest("http://ingestion-control/internal/ingestion/tasks", "admin", {
				method: "POST",
				body: JSON.stringify(task),
			}),
		);

		expect(response.status).toBe(400);
		expect(await json(response)).toEqual({
			error:
				"output contract mismatch for chunk_prepare: expected expected_chunk_set.v1, got ingestion_chunk_set.v1",
		});
		expect(store.getTask(task.task_id)).toBeNull();
	});
});

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

function authorizedRequest(
	url: string,
	principal: "admin" | "app-api" | "collector" | "execution-status" | "projection",
	init: RequestInit = {},
): Request {
	return new Request(url, {
		...init,
		headers: {
			...(init.headers as Record<string, string> | undefined),
			authorization: `Bearer ${tokenForPrincipal(principal)}`,
		},
	});
}

function tokenForPrincipal(
	principal: "admin" | "app-api" | "collector" | "execution-status" | "projection",
): string {
	switch (principal) {
		case "admin":
			return serviceTokens.adminToken;
		case "app-api":
			return serviceTokens.appApiProjectionToken;
		case "collector":
			return serviceTokens.officialWebCollectorToken;
		case "execution-status":
			return serviceTokens.officialWebExecutionStatusToken;
		case "projection":
			return serviceTokens.officialWebProjectionToken;
		default:
			return assertNeverPrincipal(principal);
	}
}

function assertNeverPrincipal(value: never): never {
	throw new Error(`Unsupported test principal: ${String(value)}`);
}

class RecordingWorkflowStarter {
	readonly startedTaskIds: string[] = [];

	async startTask(task: {
		task_id: string;
	}): Promise<{ workflowId: string; workflowRunId: string }> {
		this.startedTaskIds.push(task.task_id);
		return {
			workflowId: task.task_id,
			workflowRunId: "temporal-run-001",
		};
	}
}

class RecordingOfficialWebControlPlaneService implements OfficialWebControlPlaneService {
	readonly calls: string[] = [];

	async finalize() {
		this.calls.push("finalize");
		return {
			run: {
				finishedAt: "2026-06-11T00:00:00.000Z",
				ingestionDispatchStatus: "queued",
				runId: "owrun_test",
				status: "completed",
			},
		};
	}

	async heartbeat() {
		this.calls.push("heartbeat");
		return {
			run: {
				lastHeartbeatAt: "2026-06-11T00:00:00.000Z",
				runId: "owrun_test",
				status: "running",
			},
		};
	}

	async resolvePlan(): ReturnType<OfficialWebControlPlaneService["resolvePlan"]> {
		this.calls.push("resolvePlan");
		return {
			plan: {
				duePages: [],
				hostFilter: [],
				maxPagesPerHost: 0,
				maxTotalPages: 0,
				resolvedAt: "2026-06-11T00:00:00.000Z",
				runIntent: "baseline",
				siteId: "campus_public",
				summary: {
					duePages: 0,
					listingPages: 0,
					repairPages: 0,
					selectedHosts: 0,
					staticPages: 0,
					targetJobs: 0,
					worksetRows: 0,
				},
			},
		};
	}

	async start() {
		this.calls.push("start");
		return {
			run: {
				heartbeatIntervalSeconds: 60,
				runId: "owrun_test",
				siteId: "campus_public",
				startedAt: "2026-06-11T00:00:00.000Z",
				status: "accepted",
			},
		};
	}
}

class RecordingOfficialWebProjectionProjector implements OfficialWebProjectionProjector {
	readonly calls: Array<{ limit?: number }> = [];

	async drain(input?: { limit?: number }) {
		this.calls.push(input ?? {});
		return {
			abandoned: 0,
			failed: 0,
			processed: 3,
			skipped: 0,
		};
	}
}

class RecordingOfficialWebExecutionStatusService implements OfficialWebExecutionStatusService {
	readonly calls: Array<{ payload: Record<string, unknown>; runId: string }> = [];

	async updateRunExecutionStatus(input: { payload: Record<string, unknown>; runId: string }) {
		this.calls.push(input);
		return {
			run: {
				ingestionExecutionErrorCode: null,
				ingestionExecutionErrorMessage: null,
				ingestionExecutionRef: String(input.payload.executionRef),
				ingestionExecutionStatus: input.payload.status as "running",
				ingestionExecutionUpdatedAt: String(input.payload.updatedAt),
				runId: input.runId,
			},
		};
	}
}
