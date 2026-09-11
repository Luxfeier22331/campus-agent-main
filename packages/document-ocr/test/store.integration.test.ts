import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createOcrTaskStore, OCR_MODEL, OCR_OPTIONS, withOcrLock } from "../src/index.ts";

process.loadEnvFile(new URL("../../../jobs/document-ocr/.env.local", import.meta.url));
if (process.env.DEPLOYMENT_ENVIRONMENT !== "local") {
	throw new Error("OCR integration tests require local dev:init");
}
const pool = new Pool({ connectionString: process.env.NOTICES_DATABASE_URL, max: 3 });
const store = createOcrTaskStore(pool);
const ids: string[] = [];
const config = {
	baseUrl: "https://paddle.example",
	apiKey: "test-only",
	updatedAt: "2026-01-01T00:00:00.123456Z",
	model: OCR_MODEL,
	options: OCR_OPTIONS,
};
beforeAll(async () => {
	await pool.query("select 1 from ocr.tasks limit 1");
});
afterAll(async () => {
	if (ids.length > 0) {
		await pool.query("delete from ocr.tasks where id=any($1::uuid[])", [ids]);
	}
	await pool.end();
});
it("deduplicates simultaneous creation and does not rebill on credential/model config changes", async () => {
	const input = {
		kind: "uploaded" as const,
		key: `ocr/test/${randomUUID()}`,
		contentType: "image/png",
	};
	const tasks = await Promise.all([
		store.create(input, config),
		store.create(
			{ contentType: input.contentType, key: input.key, kind: input.kind },
			{ ...config, apiKey: "rotated", updatedAt: "2026-02-01T00:00:00Z" },
		),
	]);
	for (const task of tasks) {
		ids.push(task.id);
	}
	expect(tasks[0]?.id).toBe(tasks[1]?.id);
	expect(tasks[0]?.target).not.toHaveProperty("apiKey");
	const rerun = await store.create(input, config, true);
	ids.push(rerun.id);
	expect(rerun.id).not.toBe(tasks[0]?.id);
});
it("preserves microsecond config identity and state through PostgreSQL", async () => {
	const task = await store.create({ kind: "validation" }, config);
	ids.push(task.id);
	expect(task.configUpdatedAt).toBe(config.updatedAt);
	task.status = "submitted";
	task.providerJobId = "stored-provider-job";
	await store.save(task);
	expect(await store.get(task.id)).toMatchObject({
		status: "submitted",
		providerJobId: "stored-provider-job",
	});
});
it("stores OCR pages transactionally and exposes a computed page count", async () => {
	const task = await store.create({ kind: "validation" }, config);
	ids.push(task.id);
	task.status = "completed";
	await store.saveResult(
		task,
		[{ index: 0, markdown: "<table><tr><td>CAMPUS</td></tr></table>", images: [] }],
		{
			rawKey: `ocr/tasks/${task.id}/result.jsonl`,
			missingImages: [],
		},
	);
	expect(await store.getPages(task.id)).toEqual([
		{ index: 0, markdown: "<table><tr><td>CAMPUS</td></tr></table>", images: [] },
	]);
	expect(await store.get(task.id)).toMatchObject({ status: "completed", pageCount: 1 });
});
it("excludes simultaneous manual and scheduled runners and releases the lock", async () => {
	const first = await withOcrLock(pool, async () => {
		expect(await withOcrLock(pool, async () => "second")).toBeNull();
		return "first";
	});
	expect(first).toBe("first");
	expect(await withOcrLock(pool, async () => "next")).toBe("next");
});
it("grants Ops task reads/writes but no schema creation", async () => {
	const result = await pool.query(`select
  has_schema_privilege('ops_web','ocr','CREATE') as ddl,
  has_table_privilege('ops_web','ocr.tasks','SELECT') as read,
  has_table_privilege('ops_web','ocr.tasks','INSERT') as create,
  has_table_privilege('ops_web','ocr.tasks','UPDATE') as update`);
	expect(result.rows[0]).toEqual({ ddl: false, read: true, create: true, update: true });
});
