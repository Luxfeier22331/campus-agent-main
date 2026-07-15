import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskExecutorKind,
	IngestionTaskSummaryValue,
} from "ingestion-contracts";

export type IngestionWorkflowStatus = "running" | "completed" | "failed" | "canceled";

export type IngestionTaskRecord = IngestionTaskEnvelope & {
	executor_kind: IngestionTaskExecutorKind;
	source_family: string | null;
	source_channel: string | null;
	corpus: string | null;
	collection: string | null;
	input_contract: string;
	output_contract: string;
	created_by: string;
	created_at: string;
	status: IngestionWorkflowStatus;
	updated_at: string;
	workflow_id: string;
	workflow_run_id: string | null;
	result_ref: IngestionArtifactRef | null;
	result_contract: string | null;
	summary: Record<string, IngestionTaskSummaryValue> | null;
	error_code: string | null;
	error_message: string | null;
};

export interface IngestionTaskOperatorProjection {
	schema_version: "ingestion_task_operator_projection.v2";
	task_id: string;
	run_id: string;
	registry_task_id: string;
	executor_kind: IngestionTaskExecutorKind;
	source_family: string | null;
	source_channel: string | null;
	corpus: string | null;
	collection: string | null;
	status: IngestionWorkflowStatus;
	created_at: string;
	updated_at: string;
	result_contract: string | null;
	has_result: boolean;
	summary: Record<string, IngestionTaskSummaryValue> | null;
	last_error_code: string | null;
	last_error_message: string | null;
	workflow_id: string;
	workflow_run_id: string | null;
}

export interface IngestionTaskOperatorProjectionList {
	tasks: IngestionTaskOperatorProjection[];
	page: { next_cursor: string | null };
}

export interface IngestionTaskProjectionFilters {
	collection?: string | null;
	corpus?: string | null;
	registryTaskId?: string | null;
	runId?: string | null;
	sourceChannel?: string | null;
	sourceFamily?: string | null;
	status?: IngestionWorkflowStatus | null;
	limit?: number | null;
}

export function toIngestionTaskOperatorProjection(
	task: IngestionTaskRecord,
): IngestionTaskOperatorProjection {
	return {
		schema_version: "ingestion_task_operator_projection.v2",
		task_id: task.task_id,
		run_id: task.run_id,
		registry_task_id: task.registry_task_id,
		executor_kind: task.executor_kind,
		source_family: task.source_family,
		source_channel: task.source_channel,
		corpus: task.corpus,
		collection: task.collection,
		status: task.status,
		created_at: task.created_at,
		updated_at: task.updated_at,
		result_contract: task.result_contract,
		has_result: task.result_ref !== null,
		summary: task.summary ? { ...task.summary } : null,
		last_error_code: task.error_code,
		last_error_message: task.error_message,
		workflow_id: task.workflow_id,
		workflow_run_id: task.workflow_run_id,
	};
}

export function matchesIngestionTaskProjectionFilters(
	task: IngestionTaskRecord,
	filters: IngestionTaskProjectionFilters,
): boolean {
	return (
		(!filters.corpus || task.corpus === filters.corpus) &&
		(!filters.collection || task.collection === filters.collection) &&
		(!filters.registryTaskId || task.registry_task_id === filters.registryTaskId) &&
		(!filters.runId || task.run_id === filters.runId) &&
		(!filters.sourceChannel || task.source_channel === filters.sourceChannel) &&
		(!filters.sourceFamily || task.source_family === filters.sourceFamily) &&
		(!filters.status || task.status === filters.status)
	);
}

export function normalizeIngestionTaskProjectionLimit(value: number | null | undefined): number {
	if (!(value && Number.isInteger(value)) || value < 1) {
		return 50;
	}
	return Math.min(value, 200);
}

export function parseIngestionWorkflowStatus(value: string | null): IngestionWorkflowStatus | null {
	if (!value) {
		return null;
	}
	if (value === "running" || value === "completed" || value === "failed" || value === "canceled") {
		return value;
	}
	throw new Error(`unsupported ingestion task status: ${value}`);
}
