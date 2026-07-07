import { canonicalJsonString } from "ingest-core";
import { validateIngestionTaskEnvelope } from "ingestion-contracts";

import { normalizeProjectionLimit, toOperatorProjection } from "./projection";
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
	registry_task_id text NOT NULL,
	task_kind text NOT NULL,
	input_ref_json jsonb NOT NULL,
	input_contract text NOT NULL,
	output_contract text NOT NULL,
	idempotency_key text NOT NULL UNIQUE,
	created_by text NOT NULL,
	created_at timestamptz NOT NULL,
	status text NOT NULL,
	workflow_id text NOT NULL,
	workflow_run_id text,
	updated_at timestamptz NOT NULL,
	closeout_json jsonb
)`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ADD COLUMN IF NOT EXISTS workflow_id text`);
	await client.query(`
UPDATE ingestion_control.tasks
SET workflow_id = task_id
WHERE workflow_id IS NULL`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ALTER COLUMN workflow_id SET NOT NULL`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ADD COLUMN IF NOT EXISTS workflow_run_id text`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ADD COLUMN IF NOT EXISTS registry_task_id text`);
	await client.query(`
UPDATE ingestion_control.tasks
SET registry_task_id = task_kind
WHERE registry_task_id IS NULL`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ALTER COLUMN registry_task_id SET NOT NULL`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ADD COLUMN IF NOT EXISTS input_contract text`);
	await client.query(`
UPDATE ingestion_control.tasks
SET input_contract = ''
WHERE input_contract IS NULL`);
	await client.query(`
ALTER TABLE ingestion_control.tasks
	ALTER COLUMN input_contract SET NOT NULL`);
	await client.query(`
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM ingestion_control.tasks
		WHERE status NOT IN ('accepted', 'running', 'completed', 'failed', 'canceled')
			OR (status = 'running' AND workflow_run_id IS NULL)
	) THEN
		RAISE EXCEPTION 'legacy ingestion-control task rows are unsupported after Temporal migration';
	END IF;
END $$`);
	await client.query("DROP INDEX IF EXISTS ingestion_control.ingestion_tasks_claim_idx");
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

	async admitTask(task: IngestionTaskEnvelope): Promise<IngestionTaskAdmissionResult> {
		const validation = validateIngestionTaskEnvelope(task);
		if (!validation.ok) {
			throw new Error(`invalid ingestion task: ${validation.errors.join("; ")}`);
		}

		const rows = await this.#query(
			`
INSERT INTO ingestion_control.tasks (
	task_id, run_id, source_family, source_channel, corpus, collection, registry_task_id,
	task_kind, input_ref_json, input_contract, output_contract, idempotency_key, created_by,
	created_at, status, workflow_id, workflow_run_id, updated_at, closeout_json
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::timestamptz,
	'accepted', $15, NULL, $16::timestamptz, NULL
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
				task.registry_task_id,
				task.task_kind,
				JSON.stringify(task.input_ref),
				task.input_contract,
				task.output_contract,
				task.idempotency_key,
				task.created_by,
				task.created_at,
				task.task_id,
				this.#nowIso(),
			],
		);
		if (rows[0]) {
			return { created: true, record: toTaskRecord(rows[0]) };
		}

		const existing = await this.#query(
			"SELECT * FROM ingestion_control.tasks WHERE idempotency_key = $1 LIMIT 1",
			[task.idempotency_key],
		);
		const record = requirePostgresTask(existing[0], task.task_id);
		if (record.task_id !== task.task_id) {
			throw new Error(`ingestion task idempotency key already belongs to ${record.task_id}`);
		}
		return { created: false, record };
	}

	async getTask(taskId: string): Promise<IngestionTaskRecord | null> {
		const rows = await this.#query("SELECT * FROM ingestion_control.tasks WHERE task_id = $1", [
			taskId,
		]);
		return rows[0] ? toTaskRecord(rows[0]) : null;
	}

	async markTaskRunning(input: {
		taskId: string;
		workflowRunId?: string | null;
	}): Promise<IngestionTaskRecord> {
		const workflowRunId = normalizeWorkflowRunId(input.workflowRunId);
		if (!workflowRunId) {
			throw new Error(
				`workflow run id is required to mark ingestion task running: ${input.taskId}`,
			);
		}
		const rows = await this.#query(
			`
	UPDATE ingestion_control.tasks
	SET status = 'running',
		workflow_run_id = $1,
		updated_at = $2::timestamptz
	WHERE task_id = $3 AND status = 'accepted'
	RETURNING *`,
			[workflowRunId, this.#nowIso(), input.taskId],
		);
		if (!rows[0]) {
			return this.#existingRunningOrThrow(input.taskId, workflowRunId);
		}
		return toTaskRecord(rows[0]);
	}

	async completeTask(input: {
		taskId: string;
		artifactRefs?: IngestionArtifactRef[];
	}): Promise<IngestionTaskRecord> {
		const task = await this.#requireTask(input.taskId);
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
	updated_at = $1::timestamptz,
	closeout_json = $2::jsonb
WHERE task_id = $3 AND status = 'running'
RETURNING *`,
			[this.#nowIso(), JSON.stringify(closeout), input.taskId],
		);
		if (!rows[0]) {
			return this.#existingTerminalOrThrow(input.taskId, closeout, null);
		}
		return toTaskRecord(rows[0]);
	}

	async failTask(input: {
		taskId: string;
		errorCode: string;
		errorMessage: string;
	}): Promise<IngestionTaskRecord> {
		const task = await this.#requireTask(input.taskId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "failed",
			outcome_kind: "error",
			artifact_refs: [],
			error: { code: input.errorCode, message: input.errorMessage },
		};
		const rows = await this.#query(
			`
UPDATE ingestion_control.tasks
SET status = 'failed',
	updated_at = $1::timestamptz,
	closeout_json = $2::jsonb
WHERE task_id = $3 AND (status = 'running' OR (status = 'accepted' AND $4 = 'workflow_start_failed'))
RETURNING *`,
			[this.#nowIso(), JSON.stringify(closeout), input.taskId, input.errorCode],
		);
		if (!rows[0]) {
			return this.#existingTerminalOrThrow(input.taskId, closeout, input.errorCode);
		}
		return toTaskRecord(rows[0]);
	}

	async cancelTask(input: { taskId: string; reason: string }): Promise<IngestionTaskRecord> {
		const task = await this.#requireTask(input.taskId);
		const closeout: IngestionTaskCloseout = {
			task_id: task.task_id,
			terminal_status: "canceled",
			outcome_kind: "error",
			artifact_refs: [],
			error: { code: "workflow_canceled", message: input.reason },
		};
		const rows = await this.#query(
			`
UPDATE ingestion_control.tasks
SET status = 'canceled',
	updated_at = $1::timestamptz,
	closeout_json = $2::jsonb
WHERE task_id = $3 AND status = 'running'
RETURNING *`,
			[this.#nowIso(), JSON.stringify(closeout), input.taskId],
		);
		if (!rows[0]) {
			return this.#existingTerminalOrThrow(input.taskId, closeout, "workflow_canceled");
		}
		return toTaskRecord(rows[0]);
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

	async #requireTask(taskId: string): Promise<IngestionTaskRecord> {
		const task = await this.getTask(taskId);
		if (!task) {
			throw new Error(`ingestion task not found: ${taskId}`);
		}
		return task;
	}

	async #existingRunningOrThrow(
		taskId: string,
		incomingWorkflowRunId: string | null,
	): Promise<IngestionTaskRecord> {
		const task = await this.#requireTask(taskId);
		if (task.status === "running") {
			assertCompatibleWorkflowRunId(task, incomingWorkflowRunId);
			if (!task.workflow_run_id && incomingWorkflowRunId) {
				const rows = await this.#query(
					`
UPDATE ingestion_control.tasks
SET workflow_run_id = $1,
	updated_at = $2::timestamptz
WHERE task_id = $3 AND status = 'running' AND workflow_run_id IS NULL
RETURNING *`,
					[incomingWorkflowRunId, this.#nowIso(), taskId],
				);
				if (rows[0]) {
					return toTaskRecord(rows[0]);
				}
				const current = await this.#requireTask(taskId);
				assertCompatibleWorkflowRunId(current, incomingWorkflowRunId);
				return current;
			}
			return task;
		}
		throwTransitionError(task, "running");
	}

	async #existingTerminalOrThrow(
		taskId: string,
		closeout: IngestionTaskCloseout,
		errorCode: string | null,
	): Promise<IngestionTaskRecord> {
		const task = await this.#requireTask(taskId);
		if (isIdempotentTerminalTransition(task, closeout, errorCode)) {
			return task;
		}
		throwTransitionError(task, closeout.terminal_status);
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

	#nowIso(): string {
		return this.#now().toISOString();
	}
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

function throwTransitionError(
	task: IngestionTaskRecord,
	nextStatus: IngestionWorkflowStatus,
): never {
	if (isTerminalStatus(task.status)) {
		throw new Error(`terminal ingestion task cannot transition: ${task.task_id}`);
	}
	throw new Error(
		`invalid ingestion task state transition: ${task.task_id} ${task.status} -> ${nextStatus}`,
	);
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
		schema_version: "ingestion_task_envelope.v2",
		task_id: requiredRowString(row, "task_id"),
		run_id: requiredRowString(row, "run_id"),
		source_family: requiredRowString(row, "source_family"),
		source_channel: requiredRowString(row, "source_channel"),
		corpus: requiredRowString(row, "corpus"),
		collection: requiredRowString(row, "collection"),
		registry_task_id: requiredRowString(row, "registry_task_id"),
		task_kind: requiredTaskKind(row.task_kind),
		input_ref: requiredArtifactRef(row.input_ref_json),
		input_contract: requiredRowString(row, "input_contract"),
		output_contract: requiredRowString(row, "output_contract"),
		idempotency_key: requiredRowString(row, "idempotency_key"),
		created_by: requiredRowString(row, "created_by"),
		created_at: requiredIso(row.created_at, "created_at"),
		status: requiredStatus(row.status),
		updated_at: requiredIso(row.updated_at, "updated_at"),
		closeout: row.closeout_json ? requiredCloseout(row.closeout_json) : null,
		workflow_id: requiredRowString(row, "workflow_id"),
		workflow_run_id: nullableString(row.workflow_run_id),
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
		value === "source_truth_materialize" ||
		value === "document_units_validate" ||
		value === "chunk_prepare" ||
		value === "release_manifest_validate"
	) {
		return value;
	}
	throw new Error(`unsupported postgres ingestion task kind: ${String(value)}`);
}

function requiredStatus(value: unknown): IngestionWorkflowStatus {
	if (
		value === "accepted" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "canceled"
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

function requiredCloseout(value: unknown): IngestionTaskCloseout {
	if (!isRecord(value)) {
		throw new Error("postgres ingestion task row has invalid closeout_json");
	}
	const terminalStatus = requiredCloseoutTerminalStatus(value.terminal_status);
	const outcomeKind = requiredString(value, "outcome_kind");
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

function requiredCloseoutTerminalStatus(value: unknown): IngestionTaskCloseout["terminal_status"] {
	if (value === "completed" || value === "failed" || value === "canceled") {
		return value;
	}
	throw new Error(`unsupported closeout terminal status: ${String(value)}`);
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
