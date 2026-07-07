import { describe, expect, it } from "vitest";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
	type IngestionTaskEnvelope,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v2",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	registry_task_id: "chunk_prepare",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	input_contract: "canonical_document_units.v1",
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

describe("PostgresIngestionTaskStore", () => {
	it("ensures the ingestion_control task schema without self-built lease columns", async () => {
		const client = new RecordingPgClient();

		await ensureIngestionControlPostgresSchema(client);

		const sql = client.sql.join("\n");
		expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS ingestion_control");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS ingestion_control.tasks");
		expect(sql).toContain("workflow_id text NOT NULL");
		expect(sql).toContain("workflow_run_id text");
		expect(sql).not.toContain("lease_policy_json");
		expect(sql).not.toContain("retry_policy_json");
		expect(sql).not.toContain("attempt_count");
		expect(sql).not.toContain("leased_by");
		expect(sql).not.toContain("lease_expires_at");
	});

	it("migrates existing develop-era task tables to workflow identity columns", async () => {
		const empty = { rows: [] };
		const client = new RecordingPgClient([
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
			empty,
		]);

		await ensureIngestionControlPostgresSchema(client);

		const sql = client.sql.join("\n");
		expect(sql).toContain("ADD COLUMN IF NOT EXISTS workflow_id text");
		expect(sql).toContain("SET workflow_id = task_id");
		expect(sql).toContain("ALTER COLUMN workflow_id SET NOT NULL");
		expect(sql).not.toContain("information_schema.columns");
		expect(sql).not.toContain("ALTER COLUMN lease_policy_json DROP NOT NULL");
		expect(sql).not.toContain("ALTER COLUMN retry_policy_json DROP NOT NULL");
		expect(sql).not.toContain("ALTER COLUMN attempt_count DROP NOT NULL");
		expect(sql).toContain("DROP INDEX IF EXISTS ingestion_control.ingestion_tasks_claim_idx");
		expect(sql).toContain("legacy ingestion-control task rows are unsupported");
		expect(sql).toContain(
			"status NOT IN ('accepted', 'running', 'completed', 'failed', 'canceled')",
		);
		expect(sql).toContain("status = 'running' AND workflow_run_id IS NULL");
	});

	it("admits accepted tasks and returns existing idempotent records", async () => {
		const client = new RecordingPgClient([
			{ rows: [postgresRow(task)] },
			{ rows: [] },
			{ rows: [postgresRow(task)] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		const admitted = await store.admitTask(task);
		const duplicate = await store.admitTask(task);

		expect(admitted.created).toBe(true);
		expect(admitted.record).toMatchObject({
			status: "accepted",
			task_id: task.task_id,
			workflow_id: task.task_id,
			workflow_run_id: null,
		});
		expect(duplicate.created).toBe(false);
		expect(duplicate.record.task_id).toBe(task.task_id);
		expect(client.sql[0]).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
		expect(client.sql[2]).toContain("SELECT * FROM ingestion_control.tasks WHERE idempotency_key");
	});

	it("marks running and records workflow run id", async () => {
		const client = new RecordingPgClient([
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: "temporal-run-1" })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		const running = await store.markTaskRunning({
			taskId: task.task_id,
			workflowRunId: "temporal-run-1",
		});

		expect(running.status).toBe("running");
		expect(running.workflow_run_id).toBe("temporal-run-1");
		expect(client.sql[0]).toContain("SET status = 'running'");
	});

	it("rejects new running transitions without workflow run id", async () => {
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(new RecordingPgClient()),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		await expect(store.markTaskRunning({ taskId: task.task_id })).rejects.toThrow(
			"workflow run id is required",
		);
	});

	it("writes completed and failed terminal closeout", async () => {
		const completedCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
		};
		const failedCloseout = {
			task_id: task.task_id,
			terminal_status: "failed",
			outcome_kind: "error",
			artifact_refs: [],
			error: { code: "failed", message: "failed" },
		};
		const client = new RecordingPgClient([
			{ rows: [postgresRow(task)] },
			{ rows: [postgresRow({ ...task, status: "completed", closeout_json: completedCloseout })] },
			{ rows: [postgresRow(task)] },
			{ rows: [postgresRow({ ...task, status: "failed", closeout_json: failedCloseout })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		const completed = await store.completeTask({
			taskId: task.task_id,
			artifactRefs: [{ kind: "object_store", uri: "s3://bucket/chunks.jsonl" }],
		});
		const failed = await store.failTask({
			taskId: task.task_id,
			errorCode: "failed",
			errorMessage: "failed",
		});

		expect(completed.status).toBe("completed");
		expect(completed.closeout?.artifact_refs).toHaveLength(1);
		expect(failed.status).toBe("failed");
		expect(failed.closeout?.error?.code).toBe("failed");
		expect(client.sql.filter((sql) => sql.includes("closeout_json =")).length).toBe(2);
	});

	it("constrains workflow state transitions in update statements", async () => {
		const completedCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: [],
		};
		const failedCloseout = {
			task_id: task.task_id,
			terminal_status: "failed",
			outcome_kind: "error",
			artifact_refs: [],
			error: { code: "workflow_start_failed", message: "temporal unavailable" },
		};
		const client = new RecordingPgClient([
			{ rows: [postgresRow({ ...task, status: "running" })] },
			{ rows: [postgresRow(task)] },
			{ rows: [postgresRow({ ...task, status: "completed", closeout_json: completedCloseout })] },
			{ rows: [postgresRow(task)] },
			{ rows: [postgresRow({ ...task, status: "failed", closeout_json: failedCloseout })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		await store.markTaskRunning({ taskId: task.task_id, workflowRunId: "temporal-run-1" });
		await store.completeTask({ taskId: task.task_id, artifactRefs: [] });
		await store.failTask({
			taskId: task.task_id,
			errorCode: "workflow_start_failed",
			errorMessage: "temporal unavailable",
		});

		const sql = client.sql.join("\n");
		expect(sql).toContain("WHERE task_id = $3 AND status = 'accepted'");
		expect(sql).toContain("WHERE task_id = $3 AND status = 'running'");
		expect(sql).toContain(
			"WHERE task_id = $3 AND (status = 'running' OR (status = 'accepted' AND $4 = 'workflow_start_failed'))",
		);
	});

	it("returns existing postgres records for same-target retry replays", async () => {
		const completedCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: [],
		};
		const client = new RecordingPgClient([
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: "temporal-run-1" })] },
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: "temporal-run-1" })] },
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "completed", closeout_json: completedCloseout })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		const running = await store.markTaskRunning({
			taskId: task.task_id,
			workflowRunId: "temporal-run-1",
		});
		const completed = await store.completeTask({ taskId: task.task_id, artifactRefs: [] });

		expect(running.status).toBe("running");
		expect(completed.status).toBe("completed");
		expect(completed.closeout).toEqual(completedCloseout);
	});

	it("rejects postgres running replay when workflow run id targets a different run", async () => {
		const client = new RecordingPgClient([
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: "temporal-run-1" })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		await expect(
			store.markTaskRunning({
				taskId: task.task_id,
				workflowRunId: "temporal-run-2",
			}),
		).rejects.toThrow("ingestion task workflow run id mismatch");
	});

	it("rejects postgres running replay when workflow run id backfill loses a race", async () => {
		const client = new RecordingPgClient([
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: null })] },
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "running", workflow_run_id: "temporal-run-2" })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		await expect(
			store.markTaskRunning({
				taskId: task.task_id,
				workflowRunId: "temporal-run-1",
			}),
		).rejects.toThrow("ingestion task workflow run id mismatch");
		expect(
			client.sql.filter((sql) => sql.includes("SELECT * FROM ingestion_control.tasks")),
		).toHaveLength(2);
	});

	it("rejects postgres terminal overwrite attempts when constrained updates affect no rows", async () => {
		const completedCloseout = {
			task_id: task.task_id,
			terminal_status: "completed",
			outcome_kind: "success",
			artifact_refs: [],
		};
		const client = new RecordingPgClient([
			{ rows: [postgresRow({ ...task, status: "completed", closeout_json: completedCloseout })] },
			{ rows: [] },
			{ rows: [postgresRow({ ...task, status: "completed", closeout_json: completedCloseout })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		await expect(
			store.failTask({
				taskId: task.task_id,
				errorCode: "late_failure",
				errorMessage: "late failure",
			}),
		).rejects.toThrow("terminal ingestion task cannot transition");
	});
});

interface QueryResult {
	rows: Record<string, unknown>[];
}

class RecordingPgClient {
	readonly calls: { kind: "connect" | "query" | "release"; sql?: string }[] = [];
	readonly params: unknown[][] = [];
	readonly sql: string[] = [];
	readonly #results: QueryResult[];

	constructor(results: QueryResult[] = []) {
		this.#results = [...results];
	}

	async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
		this.calls.push({ kind: "query", sql });
		this.sql.push(sql);
		this.params.push(params);
		return this.#results.shift() ?? { rows: [] };
	}

	release(): void {
		this.calls.push({ kind: "release" });
	}

	connect(): void {
		this.calls.push({ kind: "connect" });
	}
}

class SingleClientPool {
	readonly client: RecordingPgClient;

	constructor(client: RecordingPgClient) {
		this.client = client;
	}

	async connect(): Promise<RecordingPgClient> {
		this.client.connect();
		return this.client;
	}
}

function postgresRow(
	input: IngestionTaskEnvelope & {
		status?: "accepted" | "running" | "completed" | "failed" | "canceled";
		workflow_run_id?: string | null;
		closeout_json?: unknown;
	},
): Record<string, unknown> {
	return {
		task_id: input.task_id,
		run_id: input.run_id,
		source_family: input.source_family,
		source_channel: input.source_channel,
		corpus: input.corpus,
		collection: input.collection,
		registry_task_id: input.registry_task_id,
		task_kind: input.task_kind,
		input_ref_json: input.input_ref,
		input_contract: input.input_contract,
		output_contract: input.output_contract,
		idempotency_key: input.idempotency_key,
		created_by: input.created_by,
		created_at: new Date(input.created_at),
		status: input.status ?? "accepted",
		workflow_id: input.task_id,
		workflow_run_id: input.workflow_run_id ?? null,
		updated_at: new Date("2026-06-11T00:00:00Z"),
		closeout_json: input.closeout_json ?? null,
	};
}
