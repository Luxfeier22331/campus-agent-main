import { describe, expect, it, vi } from "vitest";
import {
	buildIngestionExecutorRuntimeConfig,
	runIngestionExecutorIteration,
	runIngestionExecutorLoop,
} from "../src/executor-runtime.ts";
import {
	createIngestionTaskRegistryCatalog,
	type IngestionTaskEnvelope,
	type IngestionTaskRecord,
	InMemoryIngestionTaskStore,
	RustKernelRegistry,
	TsTaskHandlerRegistry,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-rag-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	lease_policy: {
		heartbeat_seconds: 1,
		lease_seconds: 30,
	},
	retry_policy: {
		max_attempts: 1,
	},
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

const catalog = createIngestionTaskRegistryCatalog([
	{
		schema_version: "ingestion_task_registry.v1",
		source_family: "curriculum",
		corpus: "curriculum",
		collection: "curriculum_plan",
		tasks: [
			{
				task_kind: "chunk_prepare",
				executor_kind: "ts_control",
				input_contract: "canonical_document_units.v1",
				output_contract: "ingestion_chunk_set.v1",
				can_publish_alias: false,
			},
		],
	},
]);

describe("ingestion-control executor runtime", () => {
	it("normalizes executor config with safe defaults", () => {
		expect(
			buildIngestionExecutorRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: "postgresql://postgres:postgres@localhost/campus_agent",
				INGESTION_TASK_REGISTRY_ROOT: "configs/ingestion",
			}),
		).toMatchObject({
			databaseUrl: "postgresql://postgres:postgres@localhost/campus_agent",
			pollIntervalMs: 5000,
			registryRoot: "configs/ingestion",
		});
	});

	it("runs one queued task through the registry-aware TS handler", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		const handlers = new TsTaskHandlerRegistry();
		handlers.register(
			{
				sourceFamily: "curriculum",
				corpus: "curriculum",
				collection: "curriculum_plan",
				taskKind: "chunk_prepare",
			},
			async () => ({
				artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
			}),
		);

		const result = await runIngestionExecutorIteration({
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: handlers,
			workerId: "executor-a",
		});

		expect(result.status).toBe("completed");
		expect(store.getTask(task.task_id)?.closeout?.artifact_refs).toEqual([
			{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" },
		]);
	});

	it("fails closed when a registry-declared handler is missing", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);

		const result = await runIngestionExecutorIteration({
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
			workerId: "executor-a",
		});

		expect(result.status).toBe("failed");
		expect(store.getTask(task.task_id)?.closeout?.error?.code).toBe("ts_handler_not_registered");
	});

	it("heartbeats while a claimed task is running", async () => {
		let now = new Date("2026-06-11T00:00:00Z");
		const store = new InMemoryIngestionTaskStore({ now: () => now });
		store.admitTask(task);
		const handlers = new TsTaskHandlerRegistry();
		let releaseHandler: (() => void) | undefined;
		handlers.register(
			{
				sourceFamily: "curriculum",
				corpus: "curriculum",
				collection: "curriculum_plan",
				taskKind: "chunk_prepare",
			},
			async () => {
				await new Promise<void>((resolve) => {
					releaseHandler = resolve;
				});
				return {
					artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
				};
			},
		);

		const running = runIngestionExecutorIteration({
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: handlers,
			workerId: "executor-a",
		});
		await vi.waitUntil(() => typeof releaseHandler === "function");
		const firstLease = store.getTask(task.task_id)?.lease_expires_at;
		now = new Date("2026-06-11T00:00:10Z");
		await new Promise((resolve) => setTimeout(resolve, 1100));
		const renewedLease = store.getTask(task.task_id)?.lease_expires_at;
		releaseHandler?.();
		await running;

		expect(renewedLease).not.toBe(firstLease);
		expect(new Date(renewedLease ?? "").getTime()).toBeGreaterThan(
			new Date(firstLease ?? "").getTime(),
		);
	});

	it("fails the claimed task when heartbeat renewal fails before handler closeout", async () => {
		const store = new HeartbeatRejectingStore();
		store.admitTask(task);
		const handlers = new TsTaskHandlerRegistry();
		let releaseHandler: (() => void) | undefined;
		handlers.register(
			{
				sourceFamily: "curriculum",
				corpus: "curriculum",
				collection: "curriculum_plan",
				taskKind: "chunk_prepare",
			},
			async () => {
				await new Promise<void>((resolve) => {
					releaseHandler = resolve;
				});
				return {
					artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
				};
			},
		);

		const running = runIngestionExecutorIteration({
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: handlers,
			workerId: "executor-a",
		});
		await new Promise((resolve) => setTimeout(resolve, 1100));
		expect(store.heartbeatAttempts).toBeGreaterThan(0);
		releaseHandler?.();
		const result = await running;

		expect(result.status).toBe("failed");
		expect(store.getTask(task.task_id)?.closeout?.error?.code).toBe("heartbeat_failed");
	});

	it("returns idle after sweeping when no queued task exists", async () => {
		const store = new InMemoryIngestionTaskStore();

		const result = await runIngestionExecutorIteration({
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
			workerId: "executor-a",
		});

		expect(result).toEqual({
			status: "idle",
			sweep: { deadLettered: 0, requeued: 0 },
		});
	});

	it("stops claiming new work after the stop signal", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		const stop = new AbortController();
		stop.abort();
		const sleep = vi.fn(async () => undefined);

		await runIngestionExecutorLoop({
			pollIntervalMs: 1,
			registryCatalog: catalog,
			rustKernels: new RustKernelRegistry(),
			sleep,
			stopSignal: stop.signal,
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
			workerId: "executor-a",
		});

		expect(store.getTask(task.task_id)?.status).toBe("queued");
		expect(sleep).not.toHaveBeenCalled();
	});
});

class HeartbeatRejectingStore extends InMemoryIngestionTaskStore {
	heartbeatAttempts = 0;

	override heartbeatTask(_input: { taskId: string; workerId: string }): IngestionTaskRecord {
		this.heartbeatAttempts += 1;
		throw new Error("heartbeat write failed");
	}
}
