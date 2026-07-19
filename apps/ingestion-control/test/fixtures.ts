import type { IngestionTaskExecutionSnapshot, IngestionTaskResult } from "ingestion-contracts";

export const testTaskStartMetadata = {
	createdBy: "test:operator",
	pipelineWorkflowId: null,
	retryOfTaskId: null,
} as const;

export function testSnapshot(
	overrides: Partial<IngestionTaskExecutionSnapshot["registry_task"]> = {},
): IngestionTaskExecutionSnapshot {
	return {
		schema_version: "ingestion_task_execution_snapshot.v1",
		task: {
			schema_version: "ingestion_task_envelope.v3",
			task_id: "task-curriculum-chunk-001",
			run_id: "run-curriculum-001",
			registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
			input_ref: {
				byte_size: 2,
				kind: "object_store",
				uri: "s3://campus-agent-derived/curriculum/document-units.jsonl",
				digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
			},
		},
		registry_task: {
			registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
			executor_kind: "rust_kernel",
			kernel_id: "chunk-document-units",
			input_contract: "canonical_document_units.v1",
			output_contract: "ingestion_chunk_set.v1",
			target: { corpus: "curriculum", collection: "curriculum_plan" },
			...overrides,
		},
	};
}

export function testResult(): IngestionTaskResult {
	return {
		schema_version: "ingestion_task_result.v1",
		task_id: "task-curriculum-chunk-001",
		run_id: "run-curriculum-001",
		registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
		output_contract: "ingestion_chunk_set.v1",
		result_ref: {
			byte_size: 2,
			kind: "object_store",
			uri: "s3://campus-agent-derived/results/chunks.jsonl",
			digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
		},
		summary: { chunk_count: 12 },
	};
}
