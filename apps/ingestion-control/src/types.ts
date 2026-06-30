import type {
	IngestionArtifactRef as SharedIngestionArtifactRef,
	IngestionTaskEnvelope as SharedIngestionTaskEnvelope,
} from "ingestion-contracts";

export type IngestionTaskStatus = "queued" | "running" | "completed" | "failed" | "dead_lettered";

export interface IngestionTaskCloseout {
	task_id: string;
	terminal_status: "completed" | "failed" | "dead_lettered";
	outcome_kind: "success" | "error";
	artifact_refs: SharedIngestionArtifactRef[];
	error?: {
		code: string;
		message: string;
	};
}

export type IngestionTaskRecord = SharedIngestionTaskEnvelope & {
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
	task_kind: SharedIngestionTaskEnvelope["task_kind"];
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

export interface ExpiredLeaseSweepResult {
	deadLettered: number;
	requeued: number;
}

export interface IngestionTaskStore {
	admitTask(task: SharedIngestionTaskEnvelope): MaybePromise<IngestionTaskRecord>;
	nextTask(): MaybePromise<IngestionTaskRecord | null>;
	getTask(taskId: string): MaybePromise<IngestionTaskRecord | null>;
	claimNextTask(input: { workerId: string }): MaybePromise<IngestionTaskRecord | null>;
	completeTask(input: {
		taskId: string;
		workerId: string;
		artifactRefs?: SharedIngestionArtifactRef[];
	}): MaybePromise<IngestionTaskRecord>;
	heartbeatTask(input: { taskId: string; workerId: string }): MaybePromise<IngestionTaskRecord>;
	failTask(input: {
		taskId: string;
		workerId: string;
		errorCode: string;
		errorMessage: string;
	}): MaybePromise<IngestionTaskRecord>;
	sweepExpiredLeases(): MaybePromise<ExpiredLeaseSweepResult>;
	listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): MaybePromise<IngestionTaskOperatorProjectionList>;
}

export type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "ingestion-contracts";
