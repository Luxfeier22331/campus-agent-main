import { describe, expect, it } from "vitest";
import type { IngestionTaskActivities } from "../src/activities.ts";
import type { IngestionTaskRecord } from "../src/index.ts";
import { runIngestionTaskWorkflowPlan } from "../src/workflows/ingestion-task-workflow.ts";

describe("ingestion task workflow plan", () => {
	it("does not turn successful execution closeout errors into task failures", async () => {
		const calls: string[] = [];
		const activities = workflowActivities(calls, {
			async executeIngestionTask() {
				calls.push("execute");
				return { status: "completed", artifactRefs: [] };
			},
			async completeIngestionTask() {
				calls.push("complete");
				throw new Error("completed closeout write lost ack");
			},
			async failIngestionTask() {
				calls.push("fail");
				return taskRecord("failed");
			},
		});

		await expect(
			runIngestionTaskWorkflowPlan({
				activities,
				taskId: "task-1",
				workflowRunId: "temporal-run-1",
			}),
		).rejects.toThrow("completed closeout write lost ack");
		expect(calls).toEqual(["mark", "execute", "complete"]);
	});

	it("records execution activity errors as workflow task failures", async () => {
		const calls: string[] = [];
		const activities = workflowActivities(calls, {
			async executeIngestionTask() {
				calls.push("execute");
				throw new Error("s3 read timeout");
			},
			async failIngestionTask(input) {
				calls.push(`fail:${input.errorCode}:${input.errorMessage}`);
				return taskRecord("failed");
			},
		});

		await expect(
			runIngestionTaskWorkflowPlan({
				activities,
				taskId: "task-1",
				workflowRunId: "temporal-run-1",
			}),
		).resolves.toMatchObject({ status: "failed" });
		expect(calls).toEqual([
			"mark",
			"execute",
			"fail:ingestion_task_activity_failed:s3 read timeout",
		]);
	});

	it("records workflow cancellation as canceled closeout", async () => {
		const calls: string[] = [];
		const activities = workflowActivities(calls, {
			async executeIngestionTask() {
				calls.push("execute");
				throw new WorkflowCancellationTestError("workflow canceled");
			},
			async cancelIngestionTask(input) {
				calls.push(`cancel:${input.reason}`);
				return taskRecord("canceled");
			},
			async failIngestionTask() {
				calls.push("fail");
				return taskRecord("failed");
			},
		});

		await expect(
			runIngestionTaskWorkflowPlan({
				activities,
				isCancellationError: (error) => error instanceof WorkflowCancellationTestError,
				runNonCancellableCleanup: (cleanup) => cleanup(),
				taskId: "task-1",
				workflowRunId: "temporal-run-1",
			}),
		).resolves.toMatchObject({ status: "canceled" });
		expect(calls).toEqual(["mark", "execute", "cancel:workflow canceled"]);
	});

	it("records cancellation during terminal closeout as canceled closeout", async () => {
		const calls: string[] = [];
		const activities = workflowActivities(calls, {
			async executeIngestionTask() {
				calls.push("execute");
				return { status: "completed", artifactRefs: [] };
			},
			async completeIngestionTask() {
				calls.push("complete");
				throw new WorkflowCancellationTestError("closeout canceled");
			},
			async cancelIngestionTask(input) {
				calls.push(`cancel:${input.reason}`);
				return taskRecord("canceled");
			},
			async failIngestionTask() {
				calls.push("fail");
				return taskRecord("failed");
			},
		});

		await expect(
			runIngestionTaskWorkflowPlan({
				activities,
				isCancellationError: (error) => error instanceof WorkflowCancellationTestError,
				runNonCancellableCleanup: (cleanup) => cleanup(),
				taskId: "task-1",
				workflowRunId: "temporal-run-1",
			}),
		).resolves.toMatchObject({ status: "canceled" });
		expect(calls).toEqual(["mark", "execute", "complete", "cancel:closeout canceled"]);
	});
});

function workflowActivities(
	calls: string[],
	overrides: Partial<IngestionTaskActivities>,
): IngestionTaskActivities {
	return {
		async markIngestionTaskRunning() {
			calls.push("mark");
			return taskRecord("running");
		},
		async executeIngestionTask() {
			return { status: "completed", artifactRefs: [] };
		},
		async completeIngestionTask() {
			return taskRecord("completed");
		},
		async failIngestionTask() {
			return taskRecord("failed");
		},
		async cancelIngestionTask() {
			return taskRecord("canceled");
		},
		...overrides,
	};
}

class WorkflowCancellationTestError extends Error {}

function taskRecord(status: IngestionTaskRecord["status"]): IngestionTaskRecord {
	return {
		schema_version: "ingestion_task_envelope.v2",
		task_id: "task-1",
		run_id: "run-1",
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
		status,
		workflow_id: "task-1",
		workflow_run_id: "temporal-run-1",
		updated_at: "2026-06-11T00:00:00.000Z",
		closeout: null,
	};
}
