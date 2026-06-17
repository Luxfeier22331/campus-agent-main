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
	task_id: "task_student_rules_alias_publish_001",
	run_id: "run_student_rules_20260612",
	source_family: "regulations",
	source_channel: "student_rules",
	corpus: "regulations",
	collection: "student_rules",
	task_kind: "alias_publish",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-rag-derived/regulations/student_rules/release-manifest.json",
	},
	output_contract: "ingestion_alias_publish_closeout.v1",
	idempotency_key: "regulations/student_rules/alias_publish/release-001",
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
	task_kind: "document_units_validate",
	output_contract: "document_units_validation_report.v1",
	idempotency_key: "regulations/student_rules/document_units_validate/release-001",
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
		{
			task_kind: "alias_publish",
			executor_kind: "ts_control",
			input_contract: "ingestion_release_manifest.v1",
			output_contract: "ingestion_alias_publish_closeout.v1",
			can_publish_alias: true,
		},
	],
};

type DefaultTsTaskKind =
	| "source_truth_materialize"
	| "canonical_document_materialize"
	| "structured_projection_publish"
	| "operator_projection_snapshot"
	| "alias_publish";

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
		handlers.register("alias_publish", async (record) => ({
			artifactRefs: [
				{
					kind: "inline",
					uri: `ts-control://${record.corpus}/${record.collection}/${record.task_kind}`,
				},
			],
		}));

		const result = await runRegistryTaskOnce({
			store,
			registry: studentRulesRegistry,
			tsHandlers: handlers,
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("completed");
		expect(result.task?.closeout?.artifact_refs).toEqual([
			{
				kind: "inline",
				uri: "ts-control://regulations/student_rules/alias_publish",
			},
		]);
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
			task_id: "task_student_rules_embedding_index_build_001",
			task_kind: "embedding_index_build",
			output_contract: "embedding_index_build_closeout.v1",
			idempotency_key: "regulations/student_rules/embedding_index_build/release-001",
		});

		const result = await runRegistryTaskOnce({
			store,
			registry: studentRulesRegistry,
			tsHandlers: new TsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.status).toBe("dead_lettered");
		expect(result.task?.closeout?.error?.code).toBe("registry_task_not_declared");
	});

	it("runs default TS control handlers for registry-declared lifecycle task kinds", async () => {
		const taskKinds = [
			"source_truth_materialize",
			"canonical_document_materialize",
			"structured_projection_publish",
			"operator_projection_snapshot",
			"alias_publish",
		] as const;
		for (const taskKind of taskKinds) {
			const store = new InMemoryIngestionTaskStore({
				now: () => new Date("2026-06-12T00:00:00Z"),
			});
			store.admitTask({
				...task,
				task_id: `task_student_rules_${taskKind}_001`,
				task_kind: taskKind,
				output_contract: defaultOutputContractForTaskKind(taskKind),
				idempotency_key: `regulations/student_rules/${taskKind}/release-001`,
			});

			const result = await runRegistryTaskOnce({
				store,
				registry: defaultRegistryForTaskKind(taskKind),
				tsHandlers: createDefaultTsTaskHandlerRegistry(),
				rustKernels: new RustKernelRegistry(),
				workerId: "registry-executor-a",
			});

			expect(result.status).toBe("completed");
			expect(result.task?.closeout?.artifact_refs).toEqual([
				{
					kind: "inline",
					uri:
						`ingestion-control://${task.source_family}/${task.source_channel}/${task.corpus}/${task.collection}` +
						`/runs/${task.run_id}/tasks/task_student_rules_${taskKind}_001` +
						`/closeout/${defaultCloseoutArtifactKindForTaskKind(taskKind)}` +
						`/contracts/${defaultOutputContractForTaskKind(taskKind)}`,
				},
			]);
		}
	});

	it("fails closed when a default TS handler receives an unsupported output contract", async () => {
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-06-12T00:00:00Z"),
		});
		store.admitTask({
			...task,
			task_kind: "alias_publish",
			output_contract: "wrong_alias_publish_closeout.v1",
		});

		const result = await runRegistryTaskOnce({
			store,
			registry: studentRulesRegistry,
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
			registry: studentRulesRegistry,
			tsHandlers: createDefaultTsTaskHandlerRegistry(),
			rustKernels: new RustKernelRegistry(),
			workerId: "registry-executor-a",
		});

		expect(result.status).toBe("failed");
		expect(result.task?.closeout?.error?.code).toBe("task_executor_failed");
		expect(result.task?.closeout?.error?.message).toContain("input_ref must be object_store");
	});
});

function defaultRegistryForTaskKind(taskKind: DefaultTsTaskKind): IngestionTaskRegistry {
	return {
		...studentRulesRegistry,
		tasks: [
			{
				task_kind: taskKind,
				executor_kind: "ts_control",
				input_contract: defaultInputContractForTaskKind(taskKind),
				output_contract: defaultOutputContractForTaskKind(taskKind),
				can_publish_alias: taskKind === "alias_publish",
			},
		],
	};
}

function defaultInputContractForTaskKind(taskKind: DefaultTsTaskKind): string {
	return {
		alias_publish: "ingestion_release_manifest.v1",
		canonical_document_materialize: "student_rules_source_truth.v1",
		operator_projection_snapshot: "student_rules_source_truth.v1",
		source_truth_materialize: "student_rules_raw_asset.v1",
		structured_projection_publish: "student_rules_source_projections.v1",
	}[taskKind] as string;
}

function defaultOutputContractForTaskKind(taskKind: DefaultTsTaskKind): string {
	return {
		alias_publish: "ingestion_alias_publish_closeout.v1",
		canonical_document_materialize: "canonical_document_artifacts.v1",
		operator_projection_snapshot: "student_rules_operator_projection.v1",
		source_truth_materialize: "student_rules_source_truth.v1",
		structured_projection_publish: "structured_projection_publish_closeout.v1",
	}[taskKind] as string;
}

function defaultCloseoutArtifactKindForTaskKind(taskKind: DefaultTsTaskKind): string {
	return {
		alias_publish: "alias_publish_closeout",
		canonical_document_materialize: "canonical_document_materialization_closeout",
		operator_projection_snapshot: "operator_projection_snapshot_closeout",
		source_truth_materialize: "source_truth_materialization_closeout",
		structured_projection_publish: "structured_projection_publish_closeout",
	}[taskKind] as string;
}
