import { describe, expect, it } from "vitest";
import {
	createIngestionTaskActivities,
	createIngestionTaskRegistryCatalog,
	type IngestionTaskEnvelope,
	InMemoryIngestionTaskStore,
} from "../src/index.ts";
import type { OfficialWebExecutionStatusPayload } from "../src/official-web-execution-status-service";
import { RustKernelRegistry, TsTaskHandlerRegistry } from "../src/task-executor";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_notice_source_truth_001",
	run_id: "run_notice_001",
	source_family: "authenticated_notice",
	source_channel: "internal_portal",
	corpus: "campus_notices",
	collection: "internal_notice",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-source/internal_portal/runs/run_notice_001/capture-release.json",
	},
	input_contract: "authenticated_notice_capture_release.v1",
	output_contract: "authenticated_notice_source_truth.v1",
	idempotency_key: "campus_notices/internal_notice/source_truth_materialize/run_notice_001",
	created_by: "operator",
	created_at: "2026-07-01T00:00:00Z",
};

const officialWebTask: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_official_web_stable_reference_source_truth_001",
	run_id: "owrun_001",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	registry_task_id: "source_truth_materialize",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-source/official_web/site/runs/owrun_001/source-truth-bundle.json",
	},
	input_contract: "official_web_source_truth_bundle.v1",
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/owrun_001",
	created_by: "ingestion-control:official-web-projection",
	created_at: "2026-07-01T00:00:00Z",
};

describe("ingestion task activities", () => {
	it("throws runtime handler failures so Temporal activity retry can run", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		const tsHandlers = new TsTaskHandlerRegistry();
		tsHandlers.register(
			{
				sourceFamily: task.source_family,
				corpus: task.corpus,
				collection: task.collection,
				registryTaskId: task.registry_task_id,
			},
			async () => {
				throw new Error("s3 read timeout");
			},
		);

		const activities = createIngestionTaskActivities({
			registryCatalog: createIngestionTaskRegistryCatalog([registry()]),
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers,
		});

		await expect(activities.executeIngestionTask({ taskId: task.task_id })).rejects.toThrow(
			"s3 read timeout",
		);
	});

	it("returns terminal failure for deterministic registry execution errors", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		const activities = createIngestionTaskActivities({
			registryCatalog: createIngestionTaskRegistryCatalog([registry()]),
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
		});

		await expect(activities.executeIngestionTask({ taskId: task.task_id })).resolves.toEqual({
			status: "failed",
			errorCode: "ts_handler_not_registered",
			errorMessage:
				"TS task handler not registered: authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
		});
	});

	it("returns terminal failure for registry admission drift during execution", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		const activities = createIngestionTaskActivities({
			registryCatalog: createIngestionTaskRegistryCatalog([]),
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
		});

		await expect(activities.executeIngestionTask({ taskId: task.task_id })).resolves.toEqual({
			status: "failed",
			errorCode: "registry_admission_failed",
			errorMessage:
				"task collection is not declared by ingestion registry: authenticated_notice/campus_notices/internal_notice",
		});
	});

	it("records cancellation through the task store", async () => {
		const store = new InMemoryIngestionTaskStore();
		store.admitTask(task);
		store.markTaskRunning({ taskId: task.task_id, workflowRunId: "temporal-run-1" });
		const activities = createIngestionTaskActivities({
			registryCatalog: createIngestionTaskRegistryCatalog([registry()]),
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
		});

		await expect(
			activities.cancelIngestionTask({
				taskId: task.task_id,
				reason: "workflow canceled",
			}),
		).resolves.toMatchObject({
			status: "canceled",
			closeout: {
				terminal_status: "canceled",
				error: { code: "workflow_canceled", message: "workflow canceled" },
			},
		});
	});

	it("updates official-web execution status during source-truth materialization lifecycle", async () => {
		const updates: Array<{ payload: OfficialWebExecutionStatusPayload; runId: string }> = [];
		const store = new InMemoryIngestionTaskStore({
			now: () => new Date("2026-07-01T00:00:00.000Z"),
		});
		store.admitTask(officialWebTask);
		const activities = createIngestionTaskActivities({
			officialWebExecutionStatusService: {
				async updateRunExecutionStatus(input) {
					updates.push(input);
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
				},
			},
			registryCatalog: createIngestionTaskRegistryCatalog([officialWebRegistry()]),
			rustKernels: new RustKernelRegistry(),
			store,
			tsHandlers: new TsTaskHandlerRegistry(),
		});

		await activities.markIngestionTaskRunning({
			taskId: officialWebTask.task_id,
			workflowRunId: "temporal-run-1",
		});
		await activities.failIngestionTask({
			errorCode: "materialize_failed",
			errorMessage: "materialization failed",
			taskId: officialWebTask.task_id,
		});

		expect(updates).toEqual([
			{
				runId: "owrun_001",
				payload: {
					executionRef: officialWebTask.task_id,
					status: "running",
					updatedAt: "2026-07-01T00:00:00.000Z",
				},
			},
			{
				runId: "owrun_001",
				payload: {
					errorCode: "materialize_failed",
					errorMessage: "materialization failed",
					executionRef: officialWebTask.task_id,
					status: "failed",
					updatedAt: "2026-07-01T00:00:00.000Z",
				},
			},
		]);
	});
});

function registry() {
	return {
		schema_version: "ingestion_task_registry.v2" as const,
		source_family: "authenticated_notice",
		corpus: "campus_notices",
		collection: "internal_notice",
		tasks: [
			{
				registry_task_id: "source_truth_materialize",
				task_kind: "source_truth_materialize" as const,
				executor_kind: "ts_control" as const,
				input_contract: "authenticated_notice_capture_release.v1",
				output_contract: "authenticated_notice_source_truth.v1",
			},
		],
	};
}

function officialWebRegistry() {
	return {
		schema_version: "ingestion_task_registry.v2" as const,
		source_family: "official_web",
		corpus: "official_web",
		collection: "stable_reference",
		tasks: [
			{
				registry_task_id: "source_truth_materialize",
				task_kind: "source_truth_materialize" as const,
				executor_kind: "ts_control" as const,
				input_contract: "official_web_source_truth_bundle.v1",
				output_contract: "official_web_stable_reference_source_truth.v1",
			},
		],
	};
}
