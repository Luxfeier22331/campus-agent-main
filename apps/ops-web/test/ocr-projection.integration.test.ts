import { randomUUID } from "node:crypto";
import { createOcrTaskStore, OCR_MODEL, OCR_OPTIONS } from "@campus-agent/document-ocr";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { projectOcrResource } from "../src/server/ocr-projection";
import type {} from "./ops-web-postgres.global-setup";

const ids: string[] = [];
let pool: Pool;
beforeAll(() => {
	pool = new Pool({ connectionString: inject("opsWebPostgres").managementConnectionString });
});
afterAll(async () => {
	await pool.query("delete from ocr.tasks where id=any($1::uuid[])", [ids]);
	await pool.end();
});
it("groups before limiting tasks and preserves older successful results per notice", async () => {
	const store = createOcrTaskStore(pool);
	const key = `internal_portal/resources/sha256/${randomUUID()}`;
	const input = {
		kind: "source" as const,
		key,
		noticeId: "1",
		contentType: "image/png",
		resource: { kind: "image" as const, ordinal: 0, displayOrdinal: 0 },
	};
	const config = {
		baseUrl: "https://paddle.example",
		apiKey: "test-only",
		model: OCR_MODEL,
		options: OCR_OPTIONS,
		updatedAt: "2026-01-01T00:00:00Z",
	};
	const success = await store.create(input, config);
	ids.push(success.id);
	success.status = "completed";
	await store.saveResult(success, [{ index: 0, markdown: "original text", images: [] }], {
		rawKey: "result",
		missingImages: [],
	});
	for (let i = 0; i < 105; i++) {
		const failed = await store.create(input, config, true);
		ids.push(failed.id);
		failed.status = "failed";
		await store.save(failed);
	}
	const other = await store.create({ ...input, noticeId: "2" }, config);
	ids.push(other.id);
	expect((await store.list()).map((task) => task.id)).not.toContain(success.id);
	const images = await store.listRecentResources();
	expect(images.map((task) => task.id)).toContain(success.id);
	const first = images.filter(
		(task) => task.input.kind === "source" && task.input.noticeId === "1",
	);
	expect(first).toHaveLength(106);
	expect(
		projectOcrResource(
			{ sourceKey: key, kind: "image", ordinal: 0, displayOrdinal: 0, label: "图片1" },
			first,
		).selectedResultId,
	).toBe(success.id);
	expect(
		images.filter((task) => task.input.kind === "source" && task.input.noticeId === "2"),
	).toHaveLength(1);
	expect(await store.getPages(success.id)).toEqual([
		{ index: 0, markdown: "original text", images: [] },
	]);
});
