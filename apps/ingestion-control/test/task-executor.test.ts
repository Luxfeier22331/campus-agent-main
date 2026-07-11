import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import type { IngestionTaskEnvelope, IngestionTaskRegistry } from "../src/index.ts";
import * as IngestionControl from "../src/index.ts";
import { RustKernelRegistry, TsTaskHandlerRegistry } from "../src/task-executor";
import { createDefaultTsTaskHandlerRegistry } from "../src/ts-task-handlers";
import { runDeclaredTaskForTest } from "./test-support.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_stable_reference_source_truth_001",
	run_id: "run_official_web_20260612",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-source/official_web/stable_reference/run-001/source-truth-bundle.json",
	},
	input_contract: "official_web_source_truth_bundle.v1",
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/run-001",
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
	registry_task_id: "document_units_validate",
	task_kind: "document_units_validate",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-derived/regulations/student_rules/document-units.jsonl",
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
};

const officialWebRegistry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	tasks: [
		{
			registry_task_id: "source_truth_materialize",
			task_kind: "source_truth_materialize",
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
		},
	],
};

const studentRulesRegistry: IngestionTaskRegistry = {
	schema_version: "ingestion_task_registry.v2",
	source_family: "regulations",
	corpus: "regulations",
	collection: "student_rules",
	tasks: [
		{
			registry_task_id: "document_units_validate",
			task_kind: "document_units_validate",
			executor_kind: "rust_kernel",
			kernel_id: "validate-document-units",
			input_contract: "canonical_document_units.v1",
			output_contract: "document_units_validation_report.v1",
		},
	],
};

describe("ingestion-control declared task runner", () => {
	it("does not expose a non-registry task execution seam", () => {
		expect("runClaimedTaskOnce" in IngestionControl).toBe(false);
	});

	it("dispatches TS tasks through the declared registry runner kind", async () => {
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
				registryTaskId: "source_truth_materialize",
			},
			async (record) => ({
				artifactRefs: [
					{
						kind: "object_store",
						uri: `s3://campus-agent-source/${record.corpus}/${record.collection}/${record.task_kind}.json`,
					},
				],
			}),
		);

		const result = await runDeclaredTaskForTest({
			store,
			registry: officialWebRegistry,
			tsHandlers: handlers,
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "object_store",
				uri: "s3://campus-agent-source/official_web/stable_reference/source_truth_materialize.json",
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
				registryTaskId: "source_truth_materialize",
			},
			async (record) => ({
				artifactRefs: [
					{
						kind: "object_store",
						uri: `s3://campus-agent-source/${record.corpus}/${record.collection}/${record.task_kind}.json`,
					},
				],
			}),
		);

		const result = await runDeclaredTaskForTest({
			store,
			registry: officialWebRegistry,
			tsHandlers: handlers,
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
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
					kind: "object_store",
					uri: `s3://campus-agent-source/${record.corpus}/${record.collection}/${record.task_kind}.json`,
				},
			],
		}));

		const result = await runDeclaredTaskForTest({
			store,
			registry: studentRulesRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels,
			taskId: rustTask.task_id,
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "object_store",
				uri: "s3://campus-agent-source/regulations/student_rules/document_units_validate.json",
			},
		]);
	});

	it("fails closed when a declared Rust kernel is missing", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(rustTask);

		const result = await runDeclaredTaskForTest({
			store,
			registry: studentRulesRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			taskId: rustTask.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("rust_kernel_not_registered");
	});

	it("fails closed when a task is not declared by the registry", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		const undeclaredTask: IngestionTaskEnvelope = {
			...task,
			task_id: "task_stable_reference_chunk_prepare_001",
			registry_task_id: "chunk_prepare",
			task_kind: "chunk_prepare",
			input_contract: "canonical_document_units.v1",
			output_contract: "ingestion_chunk_set.v1",
			idempotency_key: "official_web/stable_reference/chunk_prepare/release-001",
		};
		store.admitTask(undeclaredTask);

		const result = await runDeclaredTaskForTest({
			store,
			registry: officialWebRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			taskId: undeclaredTask.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("registry_task_not_declared");
	});

	it("fails closed instead of completing unimplemented default TS lifecycle tasks", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask(task);

		const result = await runDeclaredTaskForTest({
			store,
			registry: officialWebRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("failed");
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

		const result = await runDeclaredTaskForTest({
			store,
			registry: officialWebRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			taskId: task.task_id,
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("registry_task_contract_mismatch");
		expect(result.task?.closeout?.error?.message).toContain("contract mismatch");
	});

	it("rejects non-object-store task input at admission", () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		expect(() =>
			store.admitTask({
				...task,
				input_ref: {
					kind: "inline",
					uri: "not-an-object-store-artifact",
				},
			} as unknown as typeof task),
		).toThrow("input_ref.kind is not supported: inline");
	});
});
