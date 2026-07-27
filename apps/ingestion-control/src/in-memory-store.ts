import {
	canonicalJsonString,
	encodeIngestionTaskProjectionCursor,
	matchesIngestionTaskProjectionFilters,
	normalizeIngestionTaskProjectionLimit,
	parseIngestionTaskProjectionCursor,
	toIngestionTaskOperatorProjection,
} from "ingest-core";
import type {
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionTaskStore,
	RecordIngestionTaskStartedInput,
	StoreClock,
} from "./types";

export class InMemoryIngestionTaskStore implements IngestionTaskStore {
	readonly #records = new Map<string, IngestionTaskRecord>();
	readonly #now: StoreClock;

	constructor(input: { now?: StoreClock } = {}) {
		this.#now = input.now ?? (() => new Date());
	}

	recordTaskStarted(input: RecordIngestionTaskStartedInput): IngestionTaskRecord {
		const existing = this.#records.get(input.snapshot.task.task_id);
		if (existing) {
			assertSameTask(existing, taskRecordFromStart(input, existing.created_at));
			return structuredClone(existing);
		}
		const record = taskRecordFromStart(input, this.#now().toISOString());
		this.#records.set(record.task_id, record);
		return structuredClone(record);
	}

	getTask(taskId: string): IngestionTaskRecord | null {
		const record = this.#records.get(taskId);
		return record ? structuredClone(record) : null;
	}

	completeTask(input: Parameters<IngestionTaskStore["completeTask"]>[0]): IngestionTaskRecord {
		const task = this.#requireTask(input.taskId);
		assertResultMatchesTask(task, input.result);
		if (task.status === "completed") {
			if (
				task.result_contract === input.result.output_contract &&
				canonicalJsonString(task.result_ref) === canonicalJsonString(input.result.result_ref) &&
				canonicalJsonString(task.summary) === canonicalJsonString(input.result.summary)
			) {
				return structuredClone(task);
			}
			throw new Error(`ingestion task already completed with another result: ${task.task_id}`);
		}
		assertRunning(task);
		const next: IngestionTaskRecord = {
			...task,
			status: "completed",
			updated_at: this.#now().toISOString(),
			result_ref: structuredClone(input.result.result_ref),
			result_contract: input.result.output_contract,
			summary: structuredClone(input.result.summary),
			error_code: null,
			error_message: null,
		};
		this.#records.set(next.task_id, next);
		return structuredClone(next);
	}

	failTask(input: Parameters<IngestionTaskStore["failTask"]>[0]): IngestionTaskRecord {
		return this.#recordError(input.taskId, "failed", input.errorCode, input.errorMessage);
	}

	cancelTask(input: Parameters<IngestionTaskStore["cancelTask"]>[0]): IngestionTaskRecord {
		return this.#recordError(input.taskId, "canceled", "workflow_canceled", input.reason);
	}

	listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): IngestionTaskOperatorProjectionList {
		const limit = normalizeIngestionTaskProjectionLimit(filters.limit);
		const cursor = parseIngestionTaskProjectionCursor(filters.cursor);
		const matching = [...this.#records.values()]
			.filter((task) => matchesIngestionTaskProjectionFilters(task, filters))
			.filter(
				(task) =>
					!cursor ||
					task.updated_at < cursor.updatedAt ||
					(task.updated_at === cursor.updatedAt && task.task_id < cursor.taskId),
			)
			.sort(
				(left, right) =>
					right.updated_at.localeCompare(left.updated_at) ||
					right.task_id.localeCompare(left.task_id),
			)
			.slice(0, limit + 1);
		const hasNext = matching.length > limit;
		const page = matching.slice(0, limit);
		const last = page.at(-1);
		return {
			tasks: page.map(toIngestionTaskOperatorProjection),
			page: {
				next_cursor:
					hasNext && last
						? encodeIngestionTaskProjectionCursor({
								taskId: last.task_id,
								updatedAt: last.updated_at,
							})
						: null,
			},
		};
	}

	#recordError(
		taskId: string,
		status: "failed" | "canceled",
		errorCode: string,
		errorMessage: string,
	): IngestionTaskRecord {
		const task = this.#requireTask(taskId);
		if (task.status === status && task.error_code === errorCode) {
			return structuredClone(task);
		}
		assertRunning(task);
		const next: IngestionTaskRecord = {
			...task,
			status,
			updated_at: this.#now().toISOString(),
			result_ref: null,
			result_contract: null,
			summary: null,
			error_code: errorCode.slice(0, 128),
			error_message: errorMessage.slice(0, 2000),
		};
		this.#records.set(taskId, next);
		return structuredClone(next);
	}

	#requireTask(taskId: string): IngestionTaskRecord {
		const task = this.#records.get(taskId);
		if (!task) {
			throw new Error(`ingestion task not found: ${taskId}`);
		}
		return task;
	}
}

function taskRecordFromStart(
	input: RecordIngestionTaskStartedInput,
	createdAt: string,
): IngestionTaskRecord {
	const { registry_task: registryTask, task } = input.snapshot;
	return {
		...structuredClone(task),
		executor_kind: registryTask.executor_kind,
		source_family: registryTask.source?.family ?? null,
		source_channel: registryTask.source?.channel ?? null,
		corpus: registryTask.target?.corpus ?? null,
		collection: registryTask.target?.collection ?? null,
		input_contract: registryTask.input_contract,
		output_contract: registryTask.output_contract,
		created_by: input.createdBy,
		created_at: createdAt,
		status: "running",
		updated_at: createdAt,
		workflow_id: input.workflowId,
		workflow_run_id: input.workflowRunId,
		retry_of_task_id: input.retryOfTaskId,
		result_ref: null,
		result_contract: null,
		summary: null,
		error_code: null,
		error_message: null,
	};
}

function assertSameTask(current: IngestionTaskRecord, incoming: IngestionTaskRecord): void {
	const ignored = new Set([
		"status",
		"updated_at",
		"result_ref",
		"result_contract",
		"summary",
		"error_code",
		"error_message",
	]);
	const comparable = (value: IngestionTaskRecord) =>
		Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
	if (canonicalJsonString(comparable(current)) !== canonicalJsonString(comparable(incoming))) {
		throw new Error(`ingestion task start conflicts with existing projection: ${current.task_id}`);
	}
}

function assertRunning(task: IngestionTaskRecord): void {
	if (task.status !== "running") {
		throw new Error(`ingestion task ${task.task_id} is already ${task.status}`);
	}
}

function assertResultMatchesTask(
	task: IngestionTaskRecord,
	result: Parameters<IngestionTaskStore["completeTask"]>[0]["result"],
): void {
	if (
		result.task_id !== task.task_id ||
		result.run_id !== task.run_id ||
		result.registry_task_id !== task.registry_task_id ||
		result.output_contract !== task.output_contract
	) {
		throw new Error(`ingestion result does not match task projection: ${task.task_id}`);
	}
}
