import {
	canonicalJsonString,
	encodeIngestionTaskProjectionCursor,
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

export interface PgQueryable {
	query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PgClientLike extends PgQueryable {
	release(): void;
}

export interface PgPoolLike {
	connect(): Promise<PgClientLike>;
}

const REQUIRED_TASK_COLUMNS = [
	"task_id",
	"run_id",
	"registry_task_id",
	"executor_kind",
	"source_family",
	"source_channel",
	"corpus",
	"collection",
	"input_ref_json",
	"input_contract",
	"output_contract",
	"created_by",
	"created_at",
	"status",
	"workflow_id",
	"workflow_run_id",
	"pipeline_workflow_id",
	"retry_of_task_id",
	"updated_at",
	"result_ref_json",
	"result_contract",
	"summary_json",
	"error_code",
	"error_message",
] as const;

const REQUIRED_OFFICIAL_WEB_FRESHNESS_COLUMNS = [
	"site_id",
	"normalized_canonical_url",
	"host",
	"page_family",
	"page_title_normalized",
	"discovery_method",
	"discovered_from_url",
	"last_fetch_disposition",
	"last_http_status",
	"content_type",
	"etag",
	"last_modified",
	"response_body_hash",
	"main_content_hash",
	"last_seen_at",
	"last_changed_at",
	"last_not_modified_at",
	"cadence_class",
	"priority_score",
	"next_eligible_fetch_at",
	"last_successful_run_id",
	"last_change_reason",
	"created_at",
	"updated_at",
] as const;

const REQUIRED_OFFICIAL_WEB_SEED_STATE_COLUMNS = [
	"site_id",
	"configured_seed_url",
	"normalized_canonical_url",
	"last_observed_run_id",
	"last_seen_at",
	"created_at",
	"updated_at",
] as const;

const REQUIRED_OFFLINE_RELEASE_STREAM_COLUMNS = [
	"stream_id",
	"source_channel",
	"source_surface",
	"corpus",
	"collection",
	"current_release_id",
	"checkpoint_json",
	"version",
	"created_at",
	"updated_at",
	"last_check_at",
	"last_check_mode",
	"last_check_outcome",
	"last_check_error_code",
	"last_reconcile_at",
	"last_published_at",
	"last_added_count",
	"last_updated_count",
	"last_withdrawn_count",
] as const;

const REQUIRED_OFFLINE_RELEASE_COLUMNS = [
	"release_id",
	"stream_id",
	"previous_release_id",
	"run_id",
	"workflow_id",
	"workflow_run_id",
	"manifest_ref_json",
	"item_count",
	"committed_at",
] as const;

const REQUIRED_MIGRATION_COLUMNS = ["migration_id", "content_sha256", "applied_at"] as const;

export async function assertIngestionControlPostgresSchema(client: PgQueryable): Promise<void> {
	const migrationResult = await client.query(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'ingestion_control' AND table_name = 'schema_migrations'`,
	);
	const migrationColumns = new Set(
		migrationResult.rows.map((row) => requiredString(row.column_name, "column_name")),
	);
	const missingMigrationColumns = REQUIRED_MIGRATION_COLUMNS.filter(
		(column) => !migrationColumns.has(column),
	);
	if (missingMigrationColumns.length > 0) {
		throw new Error(
			`ingestion-control migration journal is not ready; missing columns: ${missingMigrationColumns.join(", ")}`,
		);
	}
	const result = await client.query(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'ingestion_control' AND table_name = 'tasks'`,
	);
	const columns = new Set(result.rows.map((row) => requiredString(row.column_name, "column_name")));
	const missing = REQUIRED_TASK_COLUMNS.filter((column) => !columns.has(column));
	if (missing.length > 0) {
		throw new Error(
			`ingestion-control database schema is not migrated; missing columns: ${missing.join(", ")}`,
		);
	}
	for (const retired of ["closeout_json", "idempotency_key", "task_kind"]) {
		if (columns.has(retired)) {
			throw new Error(`ingestion-control database still contains retired column: ${retired}`);
		}
	}
	const freshnessResult = await client.query(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'ingestion_control'
		   AND table_name = 'official_web_url_freshness'`,
	);
	const freshnessColumns = new Set(
		freshnessResult.rows.map((row) => requiredString(row.column_name, "column_name")),
	);
	const missingFreshness = REQUIRED_OFFICIAL_WEB_FRESHNESS_COLUMNS.filter(
		(column) => !freshnessColumns.has(column),
	);
	if (missingFreshness.length > 0) {
		throw new Error(
			`ingestion-control database schema is not migrated; missing official-web freshness columns: ${missingFreshness.join(", ")}`,
		);
	}
	const seedStateResult = await client.query(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'ingestion_control'
		   AND table_name = 'official_web_seed_state'`,
	);
	const seedStateColumns = new Set(
		seedStateResult.rows.map((row) => requiredString(row.column_name, "column_name")),
	);
	const missingSeedState = REQUIRED_OFFICIAL_WEB_SEED_STATE_COLUMNS.filter(
		(column) => !seedStateColumns.has(column),
	);
	if (missingSeedState.length > 0) {
		throw new Error(
			`ingestion-control database schema is not migrated; missing official-web seed state columns: ${missingSeedState.join(", ")}`,
		);
	}
	await assertTableColumns(
		client,
		"offline_release_streams",
		REQUIRED_OFFLINE_RELEASE_STREAM_COLUMNS,
	);
	await assertTableColumns(client, "offline_releases", REQUIRED_OFFLINE_RELEASE_COLUMNS);
}

async function assertTableColumns(
	client: PgQueryable,
	tableName: string,
	requiredColumns: readonly string[],
): Promise<void> {
	const result = await client.query(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'ingestion_control' AND table_name = $1`,
		[tableName],
	);
	const columns = new Set(result.rows.map((row) => requiredString(row.column_name, "column_name")));
	const missing = requiredColumns.filter((column) => !columns.has(column));
	if (missing.length > 0) {
		throw new Error(
			`ingestion-control database schema is not migrated; missing ${tableName} columns: ${missing.join(", ")}`,
		);
	}
}

export function createPostgresIngestionTaskStore(input: {
	pool: PgPoolLike;
	now?: StoreClock;
}): IngestionTaskStore {
	return new PostgresIngestionTaskStore(input);
}

class PostgresIngestionTaskStore implements IngestionTaskStore {
	readonly #pool: PgPoolLike;
	readonly #now: StoreClock;

	constructor(input: { pool: PgPoolLike; now?: StoreClock }) {
		this.#pool = input.pool;
		this.#now = input.now ?? (() => new Date());
	}

	async recordTaskStarted(input: RecordIngestionTaskStartedInput): Promise<IngestionTaskRecord> {
		const task = input.snapshot.task;
		const registryTask = input.snapshot.registry_task;
		const now = this.#now().toISOString();
		const rows = await this.#query(
			`INSERT INTO ingestion_control.tasks (
				task_id, run_id, registry_task_id, executor_kind, source_family, source_channel,
				corpus, collection, input_ref_json, input_contract, output_contract, created_by, created_at,
				status, workflow_id, workflow_run_id, pipeline_workflow_id, retry_of_task_id,
				updated_at, result_ref_json, result_contract,
				summary_json, error_code, error_message
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::timestamptz,
				'running', $14, $15, $16, $17, $18::timestamptz, NULL, NULL, NULL, NULL, NULL
			)
			ON CONFLICT (task_id) DO NOTHING
			RETURNING *`,
			[
				task.task_id,
				task.run_id,
				task.registry_task_id,
				registryTask.executor_kind,
				registryTask.source?.family ?? null,
				registryTask.source?.channel ?? null,
				registryTask.target?.corpus ?? null,
				registryTask.target?.collection ?? null,
				JSON.stringify(task.input_ref),
				registryTask.input_contract,
				registryTask.output_contract,
				input.createdBy,
				now,
				input.workflowId,
				input.workflowRunId,
				input.pipelineWorkflowId,
				input.retryOfTaskId,
				now,
			],
		);
		if (rows[0]) {
			return toTaskRecord(rows[0]);
		}
		const existing = await this.getTask(task.task_id);
		if (!existing) {
			throw new Error(`ingestion task insert lost without projection: ${task.task_id}`);
		}
		assertCompatibleStart(existing, input);
		return existing;
	}

	async getTask(taskId: string): Promise<IngestionTaskRecord | null> {
		const rows = await this.#query("SELECT * FROM ingestion_control.tasks WHERE task_id = $1", [
			taskId,
		]);
		return rows[0] ? toTaskRecord(rows[0]) : null;
	}

	async completeTask(
		input: Parameters<IngestionTaskStore["completeTask"]>[0],
	): Promise<IngestionTaskRecord> {
		const current = await this.#requireTask(input.taskId);
		assertResultMatchesTask(current, input.result);
		const rows = await this.#query(
			`UPDATE ingestion_control.tasks
			 SET status = 'completed', updated_at = $1::timestamptz,
			     result_ref_json = $2::jsonb, result_contract = $3, summary_json = $4::jsonb,
			     error_code = NULL, error_message = NULL
			 WHERE task_id = $5 AND status = 'running'
			 RETURNING *`,
			[
				this.#now().toISOString(),
				JSON.stringify(input.result.result_ref),
				input.result.output_contract,
				JSON.stringify(input.result.summary),
				input.taskId,
			],
		);
		if (rows[0]) {
			return toTaskRecord(rows[0]);
		}
		const existing = await this.#requireTask(input.taskId);
		if (
			existing.status === "completed" &&
			existing.result_contract === input.result.output_contract &&
			canonicalJsonString(existing.result_ref) === canonicalJsonString(input.result.result_ref) &&
			canonicalJsonString(existing.summary) === canonicalJsonString(input.result.summary)
		) {
			return existing;
		}
		throw new Error(`ingestion task cannot be completed from ${existing.status}: ${input.taskId}`);
	}

	async failTask(
		input: Parameters<IngestionTaskStore["failTask"]>[0],
	): Promise<IngestionTaskRecord> {
		return this.#recordError(input.taskId, "failed", input.errorCode, input.errorMessage);
	}

	async cancelTask(
		input: Parameters<IngestionTaskStore["cancelTask"]>[0],
	): Promise<IngestionTaskRecord> {
		return this.#recordError(input.taskId, "canceled", "workflow_canceled", input.reason);
	}

	async listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): Promise<IngestionTaskOperatorProjectionList> {
		const where: string[] = [];
		const params: unknown[] = [];
		for (const [column, value] of [
			["corpus", filters.corpus],
			["collection", filters.collection],
			["registry_task_id", filters.registryTaskId],
			["run_id", filters.runId],
			["source_channel", filters.sourceChannel],
			["source_family", filters.sourceFamily],
			["status", filters.status],
		] as const) {
			if (value) {
				params.push(value);
				where.push(`${column} = $${params.length}`);
			}
		}
		const cursor = parseIngestionTaskProjectionCursor(filters.cursor);
		if (cursor) {
			params.push(cursor.updatedAt, cursor.taskId);
			where.push(`(updated_at, task_id) < ($${params.length - 1}::timestamptz, $${params.length})`);
		}
		const limit = normalizeIngestionTaskProjectionLimit(filters.limit);
		params.push(limit + 1);
		const rows = await this.#query(
			`SELECT * FROM ingestion_control.tasks
			 ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
			 ORDER BY updated_at DESC, task_id DESC LIMIT $${params.length}`,
			params,
		);
		const hasNext = rows.length > limit;
		const page = rows.slice(0, limit).map(toTaskRecord);
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

	async #recordError(
		taskId: string,
		status: "failed" | "canceled",
		errorCode: string,
		errorMessage: string,
	): Promise<IngestionTaskRecord> {
		const rows = await this.#query(
			`UPDATE ingestion_control.tasks
			 SET status = $1, updated_at = $2::timestamptz, result_ref_json = NULL,
			     result_contract = NULL, summary_json = NULL, error_code = $3, error_message = $4
			 WHERE task_id = $5 AND status = 'running'
			 RETURNING *`,
			[
				status,
				this.#now().toISOString(),
				errorCode.slice(0, 128),
				errorMessage.slice(0, 2000),
				taskId,
			],
		);
		if (rows[0]) {
			return toTaskRecord(rows[0]);
		}
		const existing = await this.#requireTask(taskId);
		if (existing.status === status && existing.error_code === errorCode.slice(0, 128)) {
			return existing;
		}
		throw new Error(`ingestion task cannot be marked ${status} from ${existing.status}: ${taskId}`);
	}

	async #requireTask(taskId: string): Promise<IngestionTaskRecord> {
		const task = await this.getTask(taskId);
		if (!task) {
			throw new Error(`ingestion task not found: ${taskId}`);
		}
		return task;
	}

	async #query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
		const client = await this.#pool.connect();
		try {
			return (await client.query(sql, params)).rows;
		} finally {
			client.release();
		}
	}
}

function toTaskRecord(row: Record<string, unknown>): IngestionTaskRecord {
	return {
		schema_version: "ingestion_task_envelope.v3",
		task_id: requiredString(row.task_id, "task_id"),
		run_id: requiredString(row.run_id, "run_id"),
		registry_task_id: requiredString(row.registry_task_id, "registry_task_id"),
		input_ref: requiredObject(
			row.input_ref_json,
			"input_ref_json",
		) as unknown as IngestionTaskRecord["input_ref"],
		executor_kind: requiredExecutorKind(row.executor_kind),
		source_family: optionalString(row.source_family),
		source_channel: optionalString(row.source_channel),
		corpus: optionalString(row.corpus),
		collection: optionalString(row.collection),
		input_contract: requiredString(row.input_contract, "input_contract"),
		output_contract: requiredString(row.output_contract, "output_contract"),
		created_by: requiredString(row.created_by, "created_by"),
		created_at: requiredTimestamp(row.created_at, "created_at"),
		status: requiredStatus(row.status),
		updated_at: requiredTimestamp(row.updated_at, "updated_at"),
		workflow_id: requiredString(row.workflow_id, "workflow_id"),
		workflow_run_id: optionalString(row.workflow_run_id),
		pipeline_workflow_id: optionalString(row.pipeline_workflow_id),
		retry_of_task_id: optionalString(row.retry_of_task_id),
		result_ref:
			row.result_ref_json == null
				? null
				: (requiredObject(
						row.result_ref_json,
						"result_ref_json",
					) as unknown as IngestionTaskRecord["result_ref"]),
		result_contract: optionalString(row.result_contract),
		summary:
			row.summary_json == null
				? null
				: (requiredObject(row.summary_json, "summary_json") as IngestionTaskRecord["summary"]),
		error_code: optionalString(row.error_code),
		error_message: optionalString(row.error_message),
	};
}

function assertCompatibleStart(
	current: IngestionTaskRecord,
	input: RecordIngestionTaskStartedInput,
): void {
	const task = input.snapshot.task;
	const registry = input.snapshot.registry_task;
	if (
		current.run_id !== task.run_id ||
		current.registry_task_id !== task.registry_task_id ||
		current.workflow_id !== input.workflowId ||
		current.workflow_run_id !== input.workflowRunId ||
		current.created_by !== input.createdBy ||
		current.pipeline_workflow_id !== input.pipelineWorkflowId ||
		current.retry_of_task_id !== input.retryOfTaskId ||
		current.executor_kind !== registry.executor_kind ||
		canonicalJsonString(current.input_ref) !== canonicalJsonString(task.input_ref)
	) {
		throw new Error(`ingestion task start conflicts with existing projection: ${task.task_id}`);
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

function requiredExecutorKind(value: unknown): IngestionTaskRecord["executor_kind"] {
	if (value === "rust_kernel" || value === "source_collector" || value === "typescript_kernel") {
		return value;
	}
	throw new Error(`executor_kind is invalid: ${String(value)}`);
}

function requiredStatus(value: unknown): IngestionTaskRecord["status"] {
	if (value === "running" || value === "completed" || value === "failed" || value === "canceled") {
		return value;
	}
	throw new Error(`status is invalid: ${String(value)}`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is required`);
	}
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredTimestamp(value: unknown, label: string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return requiredString(value, label);
}
