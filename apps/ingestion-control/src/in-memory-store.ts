import {
	canonicalJsonString,
	matchesIngestionTaskProjectionFilters as matchesProjectionFilters,
	normalizeIngestionTaskProjectionLimit as normalizeProjectionLimit,
	toIngestionTaskOperatorProjection as toOperatorProjection,
} from "ingest-core";
import { validateIngestionTaskEnvelope } from "ingestion-contracts";
import type {
	IngestionArtifactRef,
	IngestionTaskAdmissionResult,
	IngestionTaskCloseout,
	IngestionTaskEnvelope,
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionTaskStore,
	IngestionWorkflowStatus,
	StoreClock,
} from "./types";

export class InMemoryIngestionTaskStore implements IngestionTaskStore {
	readonly #tasks = new Map<string, IngestionTaskRecord>();
	readonly #idempotencyIndex = new Map<string, string>();
	readonly #now: StoreClock;

	constructor(input: { now?: StoreClock } = {}) {
		this.#now = input.now ?? (() => new Date());
	}

	admitTask(task: IngestionTaskEnvelope): IngestionTaskAdmissionResult {
		const validation = validateIngestionTaskEnvelope(task);
		if (!validation.ok) {
			throw new Error(`invalid ingestion task: ${validation.errors.join("; ")}`);
		}

		const existingTaskId = this.#idempotencyIndex.get(task.idempotency_key);
		if (existingTaskId) {
			const existing = this.#requireTask(existingTaskId);
			if (existing.task_id !== task.task_id) {
				throw new Error(`ingestion task idempotency key already belongs to ${existing.task_id}`);
			}
			return { created: false, record: existing };
		}

		const record: IngestionTaskRecord = {
			...task,
			status: "accepted",
			updated_at: this.#nowIso(),
			closeout: null,
			workflow_id: task.task_id,
			workflow_run_id: null,
		};
		this.#tasks.set(record.task_id, record);
		this.#idempotencyIndex.set(record.idempotency_key, record.task_id);
		return { created: true, record };
	}

	getTask(taskId: string): IngestionTaskRecord | null {
		return this.#tasks.get(taskId) ?? null;
	}

	markTaskRunning(input: { taskId: string; workflowRunId?: string | null }): IngestionTaskRecord {
		const task = this.#requireTask(input.taskId);
		const workflowRunId = normalizeWorkflowRunId(input.workflowRunId);
		if (task.status === "running") {
			assertCompatibleWorkflowRunId(task, workflowRunId);
			if (!task.workflow_run_id && workflowRunId) {
				const updated: IngestionTaskRecord = {
					...task,
					updated_at: this.#nowIso(),
					workflow_run_id: workflowRunId,
				};
				this.#tasks.set(task.task_id, updated);
				return updated;
			}
			return task;
		}
		assertCanTransition(task, "running", null);
		if (!workflowRunId) {
			throw new Error(
				`workflow run id is required to mark ingestion task running: ${input.taskId}`,
			);
		}
		const updated: IngestionTaskRecord = {
			...task,
			status: "running",
			updated_at: this.#nowIso(),
			workflow_run_id: workflowRunId,
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	completeTask(input: {
		taskId: string;
		artifactRefs?: IngestionArtifactRef[];
	}): IngestionTaskRecord {
		const task = this.#requireTask(input.taskId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: input.artifactRefs ?? [],
		};
		if (isIdempotentTerminalTransition(task, closeout, null)) {
			return task;
		}
		assertCanTransition(task, "completed", null);
		const updated: IngestionTaskRecord = {
			...task,
			status: "completed",
			updated_at: this.#nowIso(),
			closeout,
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	failTask(input: {
		taskId: string;
		errorCode: string;
		errorMessage: string;
	}): IngestionTaskRecord {
		const task = this.#requireTask(input.taskId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "failed",
			outcome_kind: "error",
			artifact_refs: [],
			error: {
				code: input.errorCode,
				message: input.errorMessage,
			},
		};
		if (isIdempotentTerminalTransition(task, closeout, input.errorCode)) {
			return task;
		}
		assertCanTransition(task, "failed", input.errorCode);
		const updated: IngestionTaskRecord = {
			...task,
			status: "failed",
			updated_at: this.#nowIso(),
			closeout,
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	cancelTask(input: { taskId: string; reason: string }): IngestionTaskRecord {
		const task = this.#requireTask(input.taskId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "canceled",
			outcome_kind: "error",
			artifact_refs: [],
			error: {
				code: "workflow_canceled",
				message: input.reason,
			},
		};
		if (isIdempotentTerminalTransition(task, closeout, "workflow_canceled")) {
			return task;
		}
		assertCanTransition(task, "canceled", null);
		const updated: IngestionTaskRecord = {
			...task,
			status: "canceled",
			updated_at: this.#nowIso(),
			closeout,
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): IngestionTaskOperatorProjectionList {
		const limit = normalizeProjectionLimit(filters.limit);
		const tasks = Array.from(this.#tasks.values())
			.filter((task) => matchesProjectionFilters(task, filters))
			.sort((left, right) => {
				const byUpdated = right.updated_at.localeCompare(left.updated_at);
				return byUpdated === 0 ? right.task_id.localeCompare(left.task_id) : byUpdated;
			})
			.slice(0, limit)
			.map(toOperatorProjection);
		return {
			tasks,
			page: {
				next_cursor: null,
			},
		};
	}

	#requireTask(taskId: string): IngestionTaskRecord {
		const task = this.#tasks.get(taskId);
		if (!task) {
			throw new Error(`ingestion task not found: ${taskId}`);
		}
		return task;
	}

	#nowIso(): string {
		return this.#now().toISOString();
	}
}

function assertCanTransition(
	task: IngestionTaskRecord,
	nextStatus: IngestionWorkflowStatus,
	errorCode: string | null,
): void {
	if (isTerminalStatus(task.status)) {
		throw new Error(`terminal ingestion task cannot transition: ${task.task_id}`);
	}
	if (task.status === "accepted" && nextStatus === "running") {
		return;
	}
	if (
		task.status === "accepted" &&
		nextStatus === "failed" &&
		errorCode === "workflow_start_failed"
	) {
		return;
	}
	if (
		task.status === "running" &&
		(nextStatus === "completed" || nextStatus === "failed" || nextStatus === "canceled")
	) {
		return;
	}
	throw new Error(
		`invalid ingestion task state transition: ${task.task_id} ${task.status} -> ${nextStatus}`,
	);
}

function isIdempotentTerminalTransition(
	task: IngestionTaskRecord,
	nextCloseout: IngestionTaskCloseout,
	errorCode: string | null,
): boolean {
	if (!isTerminalStatus(task.status)) {
		return false;
	}
	const currentCloseout = task.closeout;
	if (!currentCloseout || currentCloseout.terminal_status !== nextCloseout.terminal_status) {
		return false;
	}
	if (currentCloseout.terminal_status === "failed") {
		return currentCloseout.error?.code === errorCode;
	}
	if (currentCloseout.terminal_status === "canceled") {
		return currentCloseout.error?.code === "workflow_canceled";
	}
	return canonicalJsonString(currentCloseout) === canonicalJsonString(nextCloseout);
}

function isTerminalStatus(status: IngestionWorkflowStatus): boolean {
	return status === "completed" || status === "failed" || status === "canceled";
}

function normalizeWorkflowRunId(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function assertCompatibleWorkflowRunId(
	task: IngestionTaskRecord,
	incomingWorkflowRunId: string | null,
): void {
	if (!(incomingWorkflowRunId && task.workflow_run_id)) {
		return;
	}
	if (task.workflow_run_id !== incomingWorkflowRunId) {
		throw new Error(
			`ingestion task workflow run id mismatch: ${task.task_id} has ${task.workflow_run_id}, got ${incomingWorkflowRunId}`,
		);
	}
}
