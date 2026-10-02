// @vitest-environment node

import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadPublishedNoticeSources } from "../src/source.ts";

const POSTGRES_IMAGE =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

describe("published notice database source", () => {
	let container: StartedPostgreSqlContainer;
	let pool: Pool;

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase("notice_chunk_test")
			.withUsername("notice_chunk_test")
			.withPassword(randomUUID())
			.withResourcesQuota({ cpu: 1, memory: 384 * 1024 * 1024 })
			.start();
		pool = new Pool({ connectionString: container.getConnectionUri() });
		await pool.query(`
			CREATE SCHEMA notices;
			CREATE TABLE notices.notices(
				notice_id bigint PRIMARY KEY,
				title text NOT NULL,
				content_text text,
				released_at timestamptz NOT NULL,
				is_external boolean NOT NULL DEFAULT false,
				is_published boolean NOT NULL
			);
            CREATE SCHEMA ocr;
            CREATE TABLE ocr.tasks(id uuid PRIMARY KEY, input jsonb NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
            CREATE TABLE ocr.pages(task_id uuid REFERENCES ocr.tasks(id), page_index integer NOT NULL, markdown text NOT NULL);

			INSERT INTO notices.notices(notice_id, title, content_text, released_at, is_published) VALUES
				(3, '未发布', '不可消费', '2026-09-03T00:00:00Z', false),
				(2, '纯图片', NULL, '2026-09-02T00:00:00Z', true),
				(1, '已发布正文', '可消费正文', '2026-09-01T00:00:00Z', true);
		`);
	}, 120_000);

	afterAll(async () => {
		try {
			await pool?.end();
		} finally {
			await container?.stop();
		}
	}, 60_000);

	it("includes image-only notices before OCR is available", async () => {
		await expect(loadPublishedNoticeSources(pool)).resolves.toEqual([
			{
				contentText: "可消费正文",
				noticeId: "1",
				releasedAt: "2026-09-01T00:00:00.000Z",
				title: "已发布正文",
			},
			{
				contentText: "纯图片",
				noticeId: "2",
				releasedAt: "2026-09-02T00:00:00.000Z",
				title: "纯图片",
			},
		]);
	});
	it("uses available image text in image/page order while failed, pending and missing OCR never exclude notices", async () => {
		const add = async (
			notice: string,
			ordinal: number,
			status: string,
			text: string | null,
			date: string,
			attachment = false,
		) => {
			const id = randomUUID();
			await pool.query("INSERT INTO ocr.tasks VALUES ($1,$2,$3,$4)", [
				id,
				{
					kind: "source",
					noticeId: notice,
					key: `internal_portal/notices/${notice}/${attachment ? "attachments" : "images"}/${ordinal}`,
				},
				status,
				date,
			]);
			if (text !== null) await pool.query("INSERT INTO ocr.pages VALUES ($1,0,$2)", [id, text]);
			return id;
		};
		await add("1", 2, "completed", "旧识别", "2026-09-01");
		const second = await add("1", 2, "completed", "第二张", "2026-09-02");
		await pool.query("INSERT INTO ocr.pages VALUES ($1,1,'第二页')", [second]);
		await add("1", 0, "completed", "第一张 ![图](images/0-0)", "2026-09-01");
		await add("1", 1, "failed", null, "2026-09-01");
		await add("1", 2, "pending", null, "2026-09-03");
		await add("1", 3, "submitted", null, "2026-09-01");
		await add("1", 0, "completed", "附件不消费", "2026-09-01", true);
		const sources = await loadPublishedNoticeSources(pool);
		expect(sources.map((source) => source.noticeId)).toEqual(["1", "2"]);
		expect(sources[0]?.contentText).toBe("可消费正文\n\n第一张 \n\n第二张\n\n第二页");
		expect(sources[1]?.contentText).toBe("纯图片");
		await add("2", 0, "completed", "后来完成的识别", "2026-09-04");
		expect((await loadPublishedNoticeSources(pool))[1]?.contentText).toBe("后来完成的识别");
	});
});
