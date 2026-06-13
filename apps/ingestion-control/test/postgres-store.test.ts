import { describe, expect, it } from "vitest";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
	type IngestionTaskEnvelope,
} from "../src/index.ts";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_curriculum_chunk_001",
	run_id: "run_curriculum_20260611",
	source_family: "curriculum",
	source_channel: "curriculum_plan",
	corpus: "curriculum",
	collection: "curriculum_plan",
	task_kind: "chunk_prepare",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-rag-derived/curriculum/curriculum_plan/document-units.jsonl",
	},
	output_contract: "ingestion_chunk_set.v1",
	idempotency_key: "curriculum/curriculum_plan/chunk_prepare/document-units-v1",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 3,
	},
	created_by: "operator",
	created_at: "2026-06-11T00:00:00Z",
};

describe("PostgresIngestionTaskStore", () => {
	it("ensures the ingestion_control task schema explicitly", async () => {
		const client = new RecordingPgClient();

		await ensureIngestionControlPostgresSchema(client);

		expect(client.sql.join("\n")).toContain("CREATE SCHEMA IF NOT EXISTS ingestion_control");
		expect(client.sql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS ingestion_control.tasks");
		expect(client.sql.join("\n")).toContain("CREATE INDEX IF NOT EXISTS ingestion_tasks_claim_idx");
	});

	it("claims the next task with row locking and a durable lease update", async () => {
		const client = new RecordingPgClient([
			{ rows: [postgresRow({ ...task, status: "queued", attempt_count: 0 })] },
			{ rows: [postgresRow({ ...task, status: "running", attempt_count: 1 })] },
		]);
		const store = createPostgresIngestionTaskStore({
			pool: new SingleClientPool(client),
			now: () => new Date("2026-06-11T00:00:00Z"),
		});

		const claimed = await store.claimNextTask({ workerId: "worker-a" });

		expect(claimed?.status).toBe("running");
		expect(claimed?.attempt_count).toBe(1);
		expect(client.sql[1]).toContain("FOR UPDATE SKIP LOCKED");
		expect(client.sql[2]).toContain("UPDATE ingestion_control.tasks");
		expect(client.params[2]).toContain("worker-a");
		expect(client.calls.map((call) => call.kind)).toEqual([
			"connect",
			"query",
			"query",
			"query",
			"query",
			"release",
		]);
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
		if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/iu.test(sql)) {
			return { rows: [] };
		}
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
		attempt_count: number;
		status: "queued" | "running";
	},
): Record<string, unknown> {
	return {
		task_id: input.task_id,
		run_id: input.run_id,
		source_family: input.source_family,
		source_channel: input.source_channel,
		corpus: input.corpus,
		collection: input.collection,
		task_kind: input.task_kind,
		input_ref_json: input.input_ref,
		output_contract: input.output_contract,
		idempotency_key: input.idempotency_key,
		lease_policy_json: input.lease_policy,
		retry_policy_json: input.retry_policy,
		created_by: input.created_by,
		created_at: new Date(input.created_at),
		status: input.status,
		attempt_count: input.attempt_count,
		leased_by: input.status === "running" ? "worker-a" : null,
		lease_expires_at: input.status === "running" ? new Date("2026-06-11T00:05:00Z") : null,
		updated_at: new Date("2026-06-11T00:00:00Z"),
		closeout_json: null,
	};
}
