import { validateIngestionTaskEnvelope } from "ingestion-contracts";

import {
	matchesProjectionFilters,
	normalizeProjectionLimit,
	toOperatorProjection,
} from "./projection";
import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionTaskStatus,
	IngestionTaskStore,
	StoreClock,
} from "./types";

export class InMemoryIngestionTaskStore implements IngestionTaskStore {
	readonly #tasks = new Map<string, IngestionTaskRecord>();
	readonly #idempotencyIndex = new Map<string, string>();
	readonly #now: StoreClock;

	constructor(input: { now?: StoreClock } = {}) {
		this.#now = input.now ?? (() => new Date());
	}

	admitTask(task: IngestionTaskEnvelope): IngestionTaskRecord {
		const validation = validateIngestionTaskEnvelope(task);
		if (!validation.ok) {
			throw new Error(`invalid ingestion task: ${validation.errors.join("; ")}`);
		}

		const existingTaskId = this.#idempotencyIndex.get(task.idempotency_key);
		if (existingTaskId) {
			return this.#requireTask(existingTaskId);
		}

		const record: IngestionTaskRecord = {
			...task,
			status: "queued",
			attempt_count: 0,
			leased_by: null,
			lease_expires_at: null,
			updated_at: this.#nowIso(),
			closeout: null,
		};
		this.#tasks.set(record.task_id, record);
		this.#idempotencyIndex.set(record.idempotency_key, record.task_id);
		return record;
	}

	nextTask(): IngestionTaskRecord | null {
		for (const task of this.#tasks.values()) {
			if (task.status === "queued") {
				return task;
			}
		}
		return null;
	}

	getTask(taskId: string): IngestionTaskRecord | null {
		return this.#tasks.get(taskId) ?? null;
	}

	claimNextTask(input: { workerId: string }): IngestionTaskRecord | null {
		const task = this.nextTask();
		if (!task) {
			return null;
		}
		const updated: IngestionTaskRecord = {
			...task,
			status: "running",
			attempt_count: task.attempt_count + 1,
			leased_by: input.workerId,
			lease_expires_at: new Date(
				this.#now().getTime() + task.lease_policy.lease_seconds * 1000,
			).toISOString(),
			updated_at: this.#nowIso(),
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	completeTask(input: {
		taskId: string;
		workerId: string;
		artifactRefs?: IngestionArtifactRef[];
	}): IngestionTaskRecord {
		const task = this.#requireLeasedTask(input.taskId, input.workerId);
		const updated: IngestionTaskRecord = {
			...task,
			status: "completed",
			leased_by: null,
			lease_expires_at: null,
			updated_at: this.#nowIso(),
			closeout: {
				task_id: task.task_id,
				terminal_status: "completed",
				outcome_kind: "success",
				artifact_refs: input.artifactRefs ?? [],
			},
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	heartbeatTask(input: { taskId: string; workerId: string }): IngestionTaskRecord {
		const task = this.#requireLeasedTask(input.taskId, input.workerId);
		const updated: IngestionTaskRecord = {
			...task,
			lease_expires_at: new Date(
				this.#now().getTime() + task.lease_policy.lease_seconds * 1000,
			).toISOString(),
			updated_at: this.#nowIso(),
		};
		this.#tasks.set(task.task_id, updated);
		return updated;
	}

	failTask(input: {
		taskId: string;
		workerId: string;
		errorCode: string;
		errorMessage: string;
	}): IngestionTaskRecord {
		const task = this.#requireLeasedTask(input.taskId, input.workerId);
		const exhausted = task.attempt_count >= task.retry_policy.max_attempts;
		const status: IngestionTaskStatus = exhausted ? "dead_lettered" : "queued";
		const updated: IngestionTaskRecord = {
			...task,
			status,
			leased_by: null,
			lease_expires_at: null,
			updated_at: this.#nowIso(),
			closeout: exhausted
				? {
						task_id: task.task_id,
						terminal_status: "dead_lettered",
						outcome_kind: "error",
						artifact_refs: [],
						error: {
							code: input.errorCode,
							message: input.errorMessage,
						},
					}
				: null,
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

	#requireLeasedTask(taskId: string, workerId: string): IngestionTaskRecord {
		const task = this.#requireTask(taskId);
		if (task.status !== "running" || task.leased_by !== workerId) {
			throw new Error(`ingestion task is not leased by worker: ${taskId}`);
		}
		return task;
	}

	#nowIso(): string {
		return this.#now().toISOString();
	}
}
