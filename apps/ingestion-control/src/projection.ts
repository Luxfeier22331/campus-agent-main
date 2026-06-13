import type {
	IngestionTaskOperatorProjection,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionTaskStatus,
} from "./types";

export function toOperatorProjection(task: IngestionTaskRecord): IngestionTaskOperatorProjection {
	return {
		schema_version: "ingestion_task_operator_projection.v1",
		task_id: task.task_id,
		run_id: task.run_id,
		source_family: task.source_family,
		source_channel: task.source_channel,
		corpus: task.corpus,
		collection: task.collection,
		task_kind: task.task_kind,
		status: task.status,
		attempt_count: task.attempt_count,
		created_at: task.created_at,
		updated_at: task.updated_at,
		lease_expires_at: task.lease_expires_at,
		terminal_status: task.closeout?.terminal_status ?? null,
		outcome_kind: task.closeout?.outcome_kind ?? null,
		artifact_count: task.closeout?.artifact_refs.length ?? 0,
		last_error_code: task.closeout?.error?.code ?? null,
		last_error_message: task.closeout?.error?.message ?? null,
	};
}

export function matchesProjectionFilters(
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

export function normalizeProjectionLimit(value: number | null | undefined): number {
	if (!(value && Number.isInteger(value)) || value < 1) {
		return 50;
	}
	return Math.min(value, 200);
}

export function parseTaskStatus(value: string | null): IngestionTaskStatus | null {
	if (!value) {
		return null;
	}
	if (
		value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "dead_lettered"
	) {
		return value;
	}
	throw new Error(`unsupported ingestion task status: ${value}`);
}
