import { validateIngestionTaskEnvelope } from "ingestion-contracts";

import { normalizeProjectionLimit, toOperatorProjection } from "./projection";
import type {
	IngestionArtifactRef,
	IngestionTaskCloseout,
	IngestionTaskEnvelope,
	IngestionTaskOperatorProjectionList,
	IngestionTaskProjectionFilters,
	IngestionTaskRecord,
	IngestionTaskStatus,
	IngestionTaskStore,
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

export async function ensureIngestionControlPostgresSchema(client: PgQueryable): Promise<void> {
	await client.query("CREATE SCHEMA IF NOT EXISTS ingestion_control");
	await client.query(`
CREATE TABLE IF NOT EXISTS ingestion_control.tasks (
	task_id text PRIMARY KEY,
	run_id text NOT NULL,
	source_family text NOT NULL,
	source_channel text NOT NULL,
	corpus text NOT NULL,
	collection text NOT NULL,
	task_kind text NOT NULL,
	input_ref_json jsonb NOT NULL,
	output_contract text NOT NULL,
	idempotency_key text NOT NULL UNIQUE,
	lease_policy_json jsonb NOT NULL,
	retry_policy_json jsonb NOT NULL,
	created_by text NOT NULL,
	created_at timestamptz NOT NULL,
	status text NOT NULL,
	attempt_count integer NOT NULL,
	leased_by text,
	lease_expires_at timestamptz,
	updated_at timestamptz NOT NULL,
	closeout_json jsonb
)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS ingestion_tasks_claim_idx
ON ingestion_control.tasks (status, created_at, task_id)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS ingestion_tasks_run_idx
ON ingestion_control.tasks (run_id, updated_at DESC, task_id DESC)`);
	await client.query(`
CREATE INDEX IF NOT EXISTS ingestion_tasks_collection_idx
ON ingestion_control.tasks (corpus, collection, updated_at DESC, task_id DESC)`);
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

	async admitTask(task: IngestionTaskEnvelope): Promise<IngestionTaskRecord> {
		const validation = validateIngestionTaskEnvelope(task);
		if (!validation.ok) {
			throw new Error(`invalid ingestion task: ${validation.errors.join("; ")}`);
		}

		const rows = await this.#query(
			`
INSERT INTO ingestion_control.tasks (
	task_id, run_id, source_family, source_channel, corpus, collection, task_kind,
	input_ref_json, output_contract, idempotency_key, lease_policy_json, retry_policy_json,
	created_by, created_at, status, attempt_count, leased_by, lease_expires_at, updated_at,
	closeout_json
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12::jsonb,
	$13, $14::timestamptz, 'queued', 0, NULL, NULL, $15::timestamptz, NULL
)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *`,
			[
				task.task_id,
				task.run_id,
				task.source_family,
				task.source_channel,
				task.corpus,
				task.collection,
				task.task_kind,
				JSON.stringify(task.input_ref),
				task.output_contract,
				task.idempotency_key,
				JSON.stringify(task.lease_policy),
				JSON.stringify(task.retry_policy),
				task.created_by,
				task.created_at,
				this.#nowIso(),
			],
		);
		if (rows[0]) {
			return toTaskRecord(rows[0]);
		}

		const existing = await this.#query(
			"SELECT * FROM ingestion_control.tasks WHERE idempotency_key = $1 LIMIT 1",
			[task.idempotency_key],
		);
		return requirePostgresTask(existing[0], task.task_id);
	}

	async nextTask(): Promise<IngestionTaskRecord | null> {
		const rows = await this.#query(
			`
SELECT *
FROM ingestion_control.tasks
WHERE status = 'queued'
ORDER BY created_at ASC, task_id ASC
LIMIT 1`,
		);
		return rows[0] ? toTaskRecord(rows[0]) : null;
	}

	async getTask(taskId: string): Promise<IngestionTaskRecord | null> {
		const rows = await this.#query("SELECT * FROM ingestion_control.tasks WHERE task_id = $1", [
			taskId,
		]);
		return rows[0] ? toTaskRecord(rows[0]) : null;
	}

	async claimNextTask(input: { workerId: string }): Promise<IngestionTaskRecord | null> {
		return this.#transaction(async (client) => {
			const selected = await client.query(
				`
SELECT *
FROM ingestion_control.tasks
WHERE status = 'queued'
ORDER BY created_at ASC, task_id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED`,
			);
			const task = selected.rows[0] ? toTaskRecord(selected.rows[0]) : null;
			if (!task) {
				return null;
			}
			const leaseExpiresAt = new Date(
				this.#now().getTime() + task.lease_policy.lease_seconds * 1000,
			).toISOString();
			const updated = await client.query(
				`
UPDATE ingestion_control.tasks
SET status = 'running',
	attempt_count = attempt_count + 1,
	leased_by = $1,
	lease_expires_at = $2::timestamptz,
	updated_at = $3::timestamptz
WHERE task_id = $4
RETURNING *`,
				[input.workerId, leaseExpiresAt, this.#nowIso(), task.task_id],
			);
			return requirePostgresTask(updated.rows[0], task.task_id);
		});
	}

	async completeTask(input: {
		taskId: string;
		workerId: string;
		artifactRefs?: IngestionArtifactRef[];
	}): Promise<IngestionTaskRecord> {
		const task = await this.#requireLeasedTask(input.taskId, input.workerId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: input.artifactRefs ?? [],
		};
		const rows = await this.#query(
			`
UPDATE ingestion_control.tasks
SET status = 'completed',
	leased_by = NULL,
	lease_expires_at = NULL,
	updated_at = $1::timestamptz,
	closeout_json = $2::jsonb
WHERE task_id = $3
RETURNING *`,
			[this.#nowIso(), JSON.stringify(closeout), input.taskId],
		);
		return requirePostgresTask(rows[0], input.taskId);
	}

	async heartbeatTask(input: { taskId: string; workerId: string }): Promise<IngestionTaskRecord> {
		const task = await this.#requireLeasedTask(input.taskId, input.workerId);
		const leaseExpiresAt = new Date(
			this.#now().getTime() + task.lease_policy.lease_seconds * 1000,
		).toISOString();
		const rows = await this.#query(
			`
UPDATE ingestion_control.tasks
SET lease_expires_at = $1::timestamptz,
	updated_at = $2::timestamptz
WHERE task_id = $3
RETURNING *`,
			[leaseExpiresAt, this.#nowIso(), input.taskId],
		);
		return requirePostgresTask(rows[0], input.taskId);
	}

	async failTask(input: {
		taskId: string;
		workerId: string;
		errorCode: string;
		errorMessage: string;
	}): Promise<IngestionTaskRecord> {
		const task = await this.#requireLeasedTask(input.taskId, input.workerId);
		const exhausted = task.attempt_count >= task.retry_policy.max_attempts;
		const status: IngestionTaskStatus = exhausted ? "dead_lettered" : "queued";
		const closeout = exhausted
			? JSON.stringify({
					task_id: task.task_id,
					terminal_status: "dead_lettered",
					outcome_kind: "error",
					artifact_refs: [],
					error: { code: input.errorCode, message: input.errorMessage },
				} satisfies IngestionTaskCloseout)
			: null;
		const rows = await this.#query(
			`
UPDATE ingestion_control.tasks
SET status = $1,
	leased_by = NULL,
	lease_expires_at = NULL,
	updated_at = $2::timestamptz,
	closeout_json = $3::jsonb
WHERE task_id = $4
RETURNING *`,
			[status, this.#nowIso(), closeout, input.taskId],
		);
		return requirePostgresTask(rows[0], input.taskId);
	}

	async listOperatorTaskProjections(
		filters: IngestionTaskProjectionFilters,
	): Promise<IngestionTaskOperatorProjectionList> {
		const where: string[] = [];
		const params: unknown[] = [];
		if (filters.corpus) {
			params.push(filters.corpus);
			where.push(`corpus = $${params.length}`);
		}
		if (filters.collection) {
			params.push(filters.collection);
			where.push(`collection = $${params.length}`);
		}
		if (filters.runId) {
			params.push(filters.runId);
			where.push(`run_id = $${params.length}`);
		}
		if (filters.status) {
			params.push(filters.status);
			where.push(`status = $${params.length}`);
		}
		params.push(normalizeProjectionLimit(filters.limit));
		const rows = await this.#query(
			`
SELECT *
FROM ingestion_control.tasks
${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
ORDER BY updated_at DESC, task_id DESC
LIMIT $${params.length}`,
			params,
		);
		return {
			tasks: rows.map((row) => toOperatorProjection(toTaskRecord(row))),
			page: { next_cursor: null },
		};
	}

	async #requireLeasedTask(taskId: string, workerId: string): Promise<IngestionTaskRecord> {
		const task = await this.getTask(taskId);
		if (!task) {
			throw new Error(`ingestion task not found: ${taskId}`);
		}
		if (task.status !== "running" || task.leased_by !== workerId) {
			throw new Error(`ingestion task is not leased by worker: ${taskId}`);
		}
		return task;
	}

	async #query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
		const client = await this.#pool.connect();
		try {
			const result = await client.query(sql, params);
			return result.rows;
		} finally {
			client.release();
		}
	}

	async #transaction<T>(callback: (client: PgClientLike) => Promise<T>): Promise<T> {
		const client = await this.#pool.connect();
		try {
			await client.query("BEGIN");
			const result = await callback(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	#nowIso(): string {
		return this.#now().toISOString();
	}
}

function requirePostgresTask(
	row: Record<string, unknown> | undefined,
	taskId: string,
): IngestionTaskRecord {
	if (!row) {
		throw new Error(`ingestion task not found: ${taskId}`);
	}
	return toTaskRecord(row);
}

function toTaskRecord(row: Record<string, unknown>): IngestionTaskRecord {
	return {
		schema_version: "ingestion_task_envelope.v1",
		task_id: requiredRowString(row, "task_id"),
		run_id: requiredRowString(row, "run_id"),
		source_family: requiredRowString(row, "source_family"),
		source_channel: requiredRowString(row, "source_channel"),
		corpus: requiredRowString(row, "corpus"),
		collection: requiredRowString(row, "collection"),
		task_kind: requiredTaskKind(row.task_kind),
		input_ref: requiredArtifactRef(row.input_ref_json),
		output_contract: requiredRowString(row, "output_contract"),
		idempotency_key: requiredRowString(row, "idempotency_key"),
		lease_policy: requiredLeasePolicy(row.lease_policy_json),
		retry_policy: requiredRetryPolicy(row.retry_policy_json),
		created_by: requiredRowString(row, "created_by"),
		created_at: requiredIso(row.created_at, "created_at"),
		status: requiredStatus(row.status),
		attempt_count: requiredNumber(row, "attempt_count"),
		leased_by: nullableString(row.leased_by),
		lease_expires_at: row.lease_expires_at
			? requiredIso(row.lease_expires_at, "lease_expires_at")
			: null,
		updated_at: requiredIso(row.updated_at, "updated_at"),
		closeout: row.closeout_json ? requiredCloseout(row.closeout_json) : null,
	};
}

function requiredRowString(row: Record<string, unknown>, field: string): string {
	const value = row[field];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`postgres ingestion task row is missing ${field}`);
	}
	return value;
}

function nullableString(value: unknown): string | null {
	if (value == null) {
		return null;
	}
	if (typeof value !== "string") {
		throw new Error("postgres ingestion task row contains invalid nullable string");
	}
	return value;
}

function requiredNumber(row: Record<string, unknown>, field: string): number {
	const value = row[field];
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`postgres ingestion task row is missing ${field}`);
	}
	return value;
}

function requiredIso(value: unknown, field: string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		return new Date(value).toISOString();
	}
	throw new Error(`postgres ingestion task row is missing ${field}`);
}

function requiredTaskKind(value: unknown): IngestionTaskEnvelope["task_kind"] {
	if (
		value === "raw_asset_ingest" ||
		value === "source_truth_materialize" ||
		value === "canonical_document_materialize" ||
		value === "document_units_validate" ||
		value === "chunk_prepare" ||
		value === "embedding_index_build" ||
		value === "release_manifest_validate" ||
		value === "alias_publish" ||
		value === "structured_projection_publish" ||
		value === "operator_projection_snapshot"
	) {
		return value;
	}
	throw new Error(`unsupported postgres ingestion task kind: ${String(value)}`);
}

function requiredStatus(value: unknown): IngestionTaskStatus {
	if (
		value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "dead_lettered"
	) {
		return value;
	}
	throw new Error(`unsupported postgres ingestion task status: ${String(value)}`);
}

function requiredArtifactRef(value: unknown): IngestionArtifactRef {
	if (!isRecord(value)) {
		throw new Error("postgres ingestion task row is missing input_ref_json");
	}
	return {
		kind: value.kind as IngestionArtifactRef["kind"],
		uri: requiredString(value, "uri"),
		digest: typeof value.digest === "string" ? value.digest : undefined,
	};
}

function requiredLeasePolicy(value: unknown): IngestionTaskEnvelope["lease_policy"] {
	if (!isRecord(value)) {
		throw new Error("postgres ingestion task row is missing lease_policy_json");
	}
	if (!(Number.isInteger(value.lease_seconds) && Number.isInteger(value.heartbeat_seconds))) {
		throw new Error("postgres ingestion task row has invalid lease_policy_json");
	}
	return {
		lease_seconds: Number(value.lease_seconds),
		heartbeat_seconds: Number(value.heartbeat_seconds),
	};
}

function requiredRetryPolicy(value: unknown): IngestionTaskEnvelope["retry_policy"] {
	if (!(isRecord(value) && Number.isInteger(value.max_attempts))) {
		throw new Error("postgres ingestion task row has invalid retry_policy_json");
	}
	return { max_attempts: Number(value.max_attempts) };
}

function requiredCloseout(value: unknown): IngestionTaskCloseout {
	if (!isRecord(value)) {
		throw new Error("postgres ingestion task row has invalid closeout_json");
	}
	const terminalStatus = requiredStatus(value.terminal_status);
	const outcomeKind = requiredString(value, "outcome_kind");
	if (
		terminalStatus !== "completed" &&
		terminalStatus !== "failed" &&
		terminalStatus !== "dead_lettered"
	) {
		throw new Error(`unsupported closeout terminal status: ${terminalStatus}`);
	}
	if (outcomeKind !== "success" && outcomeKind !== "error") {
		throw new Error(`unsupported closeout outcome kind: ${outcomeKind}`);
	}
	return {
		task_id: requiredString(value, "task_id"),
		terminal_status: terminalStatus,
		outcome_kind: outcomeKind,
		artifact_refs: normalizeArtifactRefs(value.artifact_refs),
		error: isRecord(value.error)
			? {
					code: requiredString(value.error, "code"),
					message: requiredString(value.error, "message"),
				}
			: undefined,
	};
}

function normalizeArtifactRefs(value: unknown): IngestionArtifactRef[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error("artifact_refs must be an array");
	}
	return value.map((item): IngestionArtifactRef => {
		if (!isRecord(item)) {
			throw new Error("artifact_refs entries must be objects");
		}
		return {
			kind: item.kind as IngestionArtifactRef["kind"],
			uri: requiredString(item, "uri"),
			digest: typeof item.digest === "string" ? item.digest : undefined,
		};
	});
}

function requiredString(body: Record<string, unknown>, field: string): string {
	const value = body[field];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} is required`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
