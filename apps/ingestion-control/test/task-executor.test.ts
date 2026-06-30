import { describe, expect, it } from "vitest";
import * as IngestionControl from "../src/index.ts";
import {
	createDefaultTsTaskHandlerRegistry,
	type IngestionTaskEnvelope,
	type IngestionTaskRegistry,
	InMemoryIngestionTaskStore,
	RustKernelRegistry,
	runRegistryTaskOnce,
	TsTaskHandlerRegistry,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_stable_reference_source_truth_001",
	run_id: "run_official_web_20260612",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-source/official_web/stable_reference/run-001/handoff.json",
	},
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/run-001",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 1,
	},
	created_by: "operator",
	created_at: "2026-06-12T00:00:00Z",
};

const rustTask: IngestionTaskEnvelope = {
	...task,
	task_id: "task_student_rules_document_units_validate_001",
	source_family: "regulations",
	source_channel: "student_rules",
	corpus: "regulations",
	collection: "student_rules",
	task_kind: "document_units_validate",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-rag-derived/regulations/student_rules/document-units.jsonl",
	},
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
};

const officialWebRegistry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v1",
	source_family: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	tasks: [
		{
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "official_web_source_handoff.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
			can_publish_alias: false,
		},
	],
};

const studentRulesRegistry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v1",
	source_family: "regulations",
	corpus: "regulations",
	collection: "student_rules",
	tasks: [
		{
			task_kind: "document_units_validate",
			executor_kind: "rust_kernel",
			kernel_id: "validate-document-units",
			input_contract: "canonical_document_units.v1",
			output_contract: "document_units_validation_report.v1",
			can_publish_alias: false,
		},
	],
};

describe("ingestion-control TS task executor", () => {
	it("does not expose a non-registry task execution seam", () => {
		expect("runClaimedTaskOnce" in IngestionControl).toBe(false);
	});

	it("dispatches TS tasks through the declared registry executor kind", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(task);
		const handlers = new TsTaskHandlerRegistry();
		handlers.register(
			{
				sourceFamily: "official_web",
				corpus: "official_web",
				collection: "stable_reference",
				taskKind: "source_truth_materialize",
			},
			async (record) => ({
				artifactRefs: [
					{
						kind: "inline",
						uri: `ts-control://${record.corpus}/${record.collection}/${record.task_kind}`,
					},
				],
			}),
		);

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: handlers,
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "inline",
				uri: "ts-control://official_web/stable_reference/source_truth_materialize",
			},
		]);
	});

	it("fails closed when no handler is registered for the task collection", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(task);
		const handlers = new TsTaskHandlerRegistry();
		handlers.register(
			{
				sourceFamily: "official_web",
				corpus: "official_web",
				collection: "fresh_news",
				taskKind: "source_truth_materialize",
			},
			async (record) => ({
				artifactRefs: [
					{
						kind: "inline",
						uri: `ts-control://${record.corpus}/${record.collection}/${record.task_kind}`,
					},
				],
			}),
		);

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: handlers,
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ts_handler_not_registered");
		expect(result.task?.closeout?.error?.message).toContain(
			"official_web/official_web/stable_reference/source_truth_materialize",
		);
	});

	it("dispatches Rust tasks through the declared kernel id", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(rustTask);
		const rustKernels = new RustKernelRegistry();
		rustKernels.register("validate-document-units", async (record) => ({
			artifactRefs: [
				{
					kind: "inline",
					uri: `rust-kernel://${record.corpus}/${record.collection}/${record.task_kind}`,
				},
			],
		}));

		const result = await runRegistryTaskOnce({
			store,
			registry: studentRulesRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels,
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "inline",
				uri: "rust-kernel://regulations/student_rules/document_units_validate",
			},
		]);
	});

	it("fails closed when a declared Rust kernel is missing", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(rustTask);

		const result = await runRegistryTaskOnce({
			store,
			registry: studentRulesRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("dead_lettered");
		expect(result.task?.closeout?.error?.code).toBe("rust_kernel_not_registered");
	});

	it("fails closed when a claimed task is not declared by the registry", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask({
			...task,
			task_id: "task_stable_reference_chunk_prepare_001",
			task_kind: "chunk_prepare",
			output_contract: "ingestion_chunk_set.v1",
			idempotency_key: "official_web/stable_reference/chunk_prepare/release-001",
		});

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("dead_lettered");
		expect(result.task?.closeout?.error?.code).toBe("registry_task_not_declared");
	});

	it("fails closed instead of completing unimplemented default TS lifecycle tasks", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(task);

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("dead_lettered");
		expect(result.task?.closeout?.error?.code).toBe("ts_handler_not_registered");
		expect(result.task?.closeout?.error?.message).toContain(
			"official_web/official_web/stable_reference/source_truth_materialize",
		);
	});

	it("fails closed when a default TS handler receives an unsupported output contract", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask({
			...task,
			output_contract: "wrong_source_truth.v1",
		});

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("registry_task_contract_mismatch");
		expect(result.task?.closeout?.error?.message).toContain("output contract mismatch");
	});

	it("fails closed when a default TS handler receives an invalid input ref", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask({
			...task,
			input_ref: {
				kind: "inline",
				uri: "not-an-object-store-artifact",
			},
		});

		const result = await runRegistryTaskOnce({
			store,
			registry: officialWebRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("ts_handler_not_registered");
		expect(result.task?.closeout?.error?.message).toContain(
			"official_web/official_web/stable_reference/source_truth_materialize",
		);
	});
});
