import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OcrTask, OcrTaskStore } from "./types.ts";

export function createOcrTaskStore(db: Pick<Pool, "query"> | PoolClient): OcrTaskStore {
	const projection = `id, input, input_sha256 as "inputSha256", target,
 to_char(config_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "configUpdatedAt", status, provider_job_id as "providerJobId",
 progress, error, result, created_at::text as "createdAt", updated_at::text as "updatedAt"`;
	async function select(sql: string, values: unknown[] = []): Promise<OcrTask[]> {
		const result = await db.query(`select ${projection} from ocr.tasks ${sql}`, values);
		return result.rows as OcrTask[];
	}
	return {
		async get(id) {
			return (await select("where id=$1", [id]))[0] ?? null;
		},
		list: (limit = 100) => select("order by created_at desc limit $1", [limit]),
		runnable: () =>
			select("where status in ('pending','submitting','submitted') order by created_at"),
		async create(input, config, rerun = false) {
			const now = new Date().toISOString();
			const task: OcrTask = {
				id: randomUUID(),
				input,
				inputSha256: null,
				target: { baseUrl: config.baseUrl, model: config.model, options: config.options },
				configUpdatedAt: config.updatedAt,
				status: "pending",
				providerJobId: null,
				progress: null,
				error: null,
				result: null,
				createdAt: now,
				updatedAt: now,
			};
			// Config rotation is deliberately absent: completed inputs aren't re-billed.
			const dedupKey =
				input.kind === "validation" || rerun ? task.id : `${input.kind}:${input.key}`;
			const inserted = await db.query(
				`insert into ocr.tasks(id,dedup_key,input,target,config_updated_at) values($1,$2,$3,$4,$5) on conflict(dedup_key) do nothing returning ${projection}`,
				[task.id, dedupKey, input, task.target, config.updatedAt],
			);
			if (inserted.rows[0]) {
				return inserted.rows[0] as OcrTask;
			}
			const existing = await select("where dedup_key=$1", [dedupKey]);
			if (!existing[0]) {
				throw new Error("OCR task disappeared");
			}
			return existing[0];
		},
		async save(task) {
			task.updatedAt = new Date().toISOString();
			await db.query(
				"update ocr.tasks set input_sha256=$2,status=$3,provider_job_id=$4,progress=$5,error=$6,result=$7,updated_at=now() where id=$1",
				[
					task.id,
					task.inputSha256,
					task.status,
					task.providerJobId,
					task.progress,
					task.error,
					task.result,
				],
			);
		},
	};
}
export async function withOcrLock<T>(
	pool: Pool,
	run: (store: OcrTaskStore) => Promise<T>,
): Promise<T | null> {
	const connection = await pool.connect();
	let locked = false;
	try {
		const result = await connection.query("select pg_try_advisory_lock(1868788338) as locked");
		locked = result.rows[0]?.locked === true;
		return locked ? await run(createOcrTaskStore(connection)) : null;
	} finally {
		if (locked) {
			await connection.query("select pg_advisory_unlock(1868788338)");
		}
		connection.release();
	}
}
