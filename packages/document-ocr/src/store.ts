import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OcrPage, OcrTask, OcrTaskStore } from "./types.ts";

export function createOcrTaskStore(db: Pool | PoolClient): OcrTaskStore {
	const projection = `id, input, input_sha256 as "inputSha256", target,
 to_char(config_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "configUpdatedAt", status, provider_job_id as "providerJobId",
 progress, error, result, (select count(*)::int from ocr.pages p where p.task_id=ocr.tasks.id) as "pageCount", created_at::text as "createdAt", updated_at::text as "updatedAt"`;
	async function select(sql: string, values: unknown[] = []): Promise<OcrTask[]> {
		const result = await db.query(`select ${projection} from ocr.tasks ${sql}`, values);
		return result.rows as OcrTask[];
	}
	return {
		async get(id) {
			return (await select("where id=$1", [id]))[0] ?? null;
		},
		list: (limit = 100) => select("order by created_at desc limit $1", [limit]),
		listRecentImages: () =>
			select(`where input->>'kind'='source' and (input->>'noticeId', input->>'key') in (
          select input->>'noticeId', input->>'key' from ocr.tasks
          where input->>'kind'='source' and (input->'resource'->>'kind'='image' or input->>'contentType' like 'image/%' or input->>'key' like 'internal_portal/notices/%/images/%')
          group by input->>'noticeId', input->>'key'
          order by max(created_at) desc, input->>'noticeId', input->>'key' limit 100
        ) order by created_at desc, id desc`),
		listNotice: (noticeId) =>
			select(
				"where input->>'kind'='source' and input->>'noticeId'=$1 order by created_at desc, id desc",
				[noticeId],
			),
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
				pageCount: 0,
				createdAt: now,
				updatedAt: now,
			};
			// Config rotation is deliberately absent: completed inputs aren't re-billed.
			const dedupKey =
				input.kind === "validation" || rerun
					? task.id
					: input.kind === "source" && input.key.startsWith("internal_portal/resources/sha256/")
						? `source:${input.noticeId}:${input.key}`
						: `${input.kind}:${input.key}`;
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
				"update ocr.tasks set input_sha256=$2,status=$3,provider_job_id=$4,progress=$5,error=$6,updated_at=now() where id=$1",
				[task.id, task.inputSha256, task.status, task.providerJobId, task.progress, task.error],
			);
		},
		async getPages(taskId) {
			const result = await db.query(
				"select page_index as index, markdown, images from ocr.pages where task_id=$1 order by page_index",
				[taskId],
			);
			return result.rows as OcrPage[];
		},
		async saveResult(task, pages, result) {
			if (pages.length === 0 || pages.some((page, index) => page.index !== index)) {
				throw new Error("OCR result pages must be nonempty and ordered from zero");
			}
			const client = "release" in db ? db : await db.connect();
			try {
				await client.query("begin");
				await client.query("delete from ocr.pages where task_id=$1", [task.id]);
				for (const page of pages) {
					await client.query(
						`insert into ocr.pages(task_id,page_index,markdown,images)
						 values($1,$2,$3,$4)`,
						[task.id, page.index, page.markdown, page.images],
					);
				}
				await client.query(
					"update ocr.tasks set result=$2, status=$3, error=$4, input_sha256=$5, provider_job_id=$6, progress=$7, updated_at=now() where id=$1",
					[
						task.id,
						result,
						task.status,
						task.error,
						task.inputSha256,
						task.providerJobId,
						task.progress,
					],
				);
				await client.query("commit");
				task.result = result;
				task.pageCount = pages.length;
				task.updatedAt = new Date().toISOString();
			} catch (error) {
				await client.query("rollback");
				throw error;
			} finally {
				if (client !== db) {
					client.release();
				}
			}
		},
	};
}
export async function withOcrLock<T>(
	pool: Pool,
	run: (store: OcrTaskStore, client: PoolClient) => Promise<T>,
): Promise<T | null> {
	const connection = await pool.connect();
	let locked = false;
	try {
		const result = await connection.query("select pg_try_advisory_lock(1868788338) as locked");
		locked = result.rows[0]?.locked === true;
		return locked ? await run(createOcrTaskStore(connection), connection) : null;
	} finally {
		if (locked) {
			await connection.query("select pg_advisory_unlock(1868788338)");
		}
		connection.release();
	}
}
