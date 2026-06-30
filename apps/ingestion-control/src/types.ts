export type IngestionTaskStatus = "queued" | "running" | "completed" | "failed" | "dead_lettered";

export interface IngestionArtifactRef {
	kind: "object_store" | "local_file" | "postgres_row" | "inline";
	uri: string;
	digest?: string;
}

export interface IngestionTaskEnvelope {
	schema_version: "ingestion_task_envelope.v1";
	task_id: string;
	run_id: string;
	source_family: string;
	source_channel: string;
	corpus: string;
	collection: string;
	task_kind:
		| "source_truth_materialize"
		| "document_units_validate"
		| "chunk_prepare"
		| "release_manifest_validate";
	input_ref: IngestionArtifactRef;
	output_contract: string;
	idempotency_key: string;
	lease_policy: {
		lease_seconds: number;
		heartbeat_seconds: number;
	};
	retry_policy: {
		max_attempts: number;
	};
	created_by: string;
	created_at: string;
}

export interface IngestionTaskCloseout {
	task_id: string;
	terminal_status: "completed" | "failed" | "dead_lettered";
	outcome_kind: "success" | "error";
	artifact_refs: IngestionArtifactRef[];
	error?: {
		code: string;
		message: string;
	};
}

export type IngestionTaskRecord = IngestionTaskEnvelope & {
	status: IngestionTaskStatus;
	attempt_count: number;
	leased_by: string | null;
	lease_expires_at: string | null;
	updated_at: string;
	closeout: IngestionTaskCloseout | null;
};

export interface IngestionTaskOperatorProjection {
	schema_version: "ingestion_task_operator_projection.v1";
	task_id: string;
	run_id: string;
	source_family: string;
	source_channel: string;
	corpus: string;
	collection: string;
	task_kind: IngestionTaskEnvelope["task_kind"];
	status: IngestionTaskStatus;
	attempt_count: number;
	created_at: string;
	updated_at: string;
	lease_expires_at: string | null;
	terminal_status: IngestionTaskCloseout["terminal_status"] | null;
	outcome_kind: IngestionTaskCloseout["outcome_kind"] | null;
	artifact_count: number;
	last_error_code: string | null;
	last_error_message: string | null;
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
	status?: IngestionTaskStatus | null;
	limit?: number | null;
}

export type StoreClock = () => Date;
export type MaybePromise<T> = T | Promise<T>;

export interface IngestionTaskStore {
	admitTask(task: IngestionTaskEnvelope): MaybePromise<IngestionTaskRecord>;
	nextTask(): MaybePromise<IngestionTaskRecord | null>;
	getTask(taskId: string): MaybePromise<IngestionTaskRecord | null>;
	claimNextTask(input: { workerId: string }): MaybePromise<IngestionTaskRecord | null>;
	completeTask(input: {
		taskId: string;
		workerId: string;
		artifactRefs?: IngestionArtifactRef[];
	}): MaybePromise<IngestionTaskRecord>;
	heartbeatTask(input: { taskId: string; workerId: string }): MaybePromise<IngestionTaskRecord>;
	failTask(input: {
		taskId: string;
		workerId: string;
		errorCode: string;
		errorMessage: string;
	}): MaybePromise<IngestionTaskRecord>;
	listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): MaybePromise<IngestionTaskOperatorProjectionList>;
}

export interface IngestionTaskRegistryTask {
	task_kind: IngestionTaskEnvelope["task_kind"];
	executor_kind: "rust_kernel" | "ts_control";
	kernel_id?: string;
	input_contract: string;
	output_contract: string;
	can_publish_alias: boolean;
}

export interface IngestionTaskRegistry {
	schema_version: "ingestion_task_registry.v1";
	source_family: string;
	corpus: string;
	collection: string;
	tasks: IngestionTaskRegistryTask[];
}
