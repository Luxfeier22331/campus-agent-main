import type { IngestionArtifactRef, IngestionTaskEnvelope } from "ingestion-contracts";

export type IngestionWorkflowStatus = "accepted" | "running" | "completed" | "failed" | "canceled";

export interface IngestionTaskCloseout {
	task_id: string;
	terminal_status: "completed" | "failed" | "canceled";
	outcome_kind: "success" | "error";
	artifact_refs: IngestionArtifactRef[];
	error?: {
		code: string;
		message: string;
	};
}

export type IngestionTaskRecord = IngestionTaskEnvelope & {
	status: IngestionWorkflowStatus;
	updated_at: string;
	closeout: IngestionTaskCloseout | null;
	workflow_id: string;
	workflow_run_id: string | null;
};

export interface IngestionTaskOperatorProjection {
	schema_version: "ingestion_task_operator_projection.v1";
	task_id: string;
	run_id: string;
	source_family: string;
	source_channel: string;
	corpus: string;
	collection: string;
	registry_task_id: string;
	task_kind: IngestionTaskEnvelope["task_kind"];
	status: IngestionWorkflowStatus;
	created_at: string;
	updated_at: string;
	terminal_status: IngestionTaskCloseout["terminal_status"] | null;
	outcome_kind: IngestionTaskCloseout["outcome_kind"] | null;
	artifact_count: number;
	last_error_code: string | null;
	last_error_message: string | null;
	workflow_id: string;
	workflow_run_id: string | null;
}

export interface IngestionTaskOperatorProjectionList {
	tasks: IngestionTaskOperatorProjection[];
	page: {
		next_cursor: string | null;
	};
}

export interface IngestionTaskProjectionFilters {
	corpus?: string | null;
	collection?: string | null;
	runId?: string | null;
	status?: IngestionWorkflowStatus | null;
	limit?: number | null;
}

export function toIngestionTaskOperatorProjection(
	task: IngestionTaskRecord,
): IngestionTaskOperatorProjection {
	return {
		schema_version: "ingestion_task_operator_projection.v1",
		task_id: task.task_id,
		run_id: task.run_id,
		source_family: task.source_family,
		source_channel: task.source_channel,
		corpus: task.corpus,
		collection: task.collection,
		registry_task_id: task.registry_task_id,
		task_kind: task.task_kind,
		status: task.status,
		created_at: task.created_at,
		updated_at: task.updated_at,
		terminal_status: task.closeout?.terminal_status ?? null,
		outcome_kind: task.closeout?.outcome_kind ?? null,
		artifact_count: task.closeout?.artifact_refs.length ?? 0,
		last_error_code: task.closeout?.error?.code ?? null,
		last_error_message: task.closeout?.error?.message ?? null,
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
		(!filters.runId || task.run_id === filters.runId) &&
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
	if (
		value === "accepted" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "canceled"
	) {
		return value;
	}
	throw new Error(`unsupported ingestion task status: ${value}`);
}
