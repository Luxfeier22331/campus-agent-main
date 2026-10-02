// @vitest-environment node

import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
				is_published boolean NOT NULL,
                source_ref text, published_source_ref text
			);
            CREATE TABLE notices.notice_assets(
                notice_id bigint REFERENCES notices.notices(notice_id), asset_kind text NOT NULL,
                ordinal integer NOT NULL, content_sha256 text NOT NULL,
                PRIMARY KEY(notice_id, asset_kind, ordinal)
            );
            CREATE SCHEMA ocr;
            CREATE TABLE ocr.tasks(id uuid PRIMARY KEY, input jsonb NOT NULL, input_sha256 text, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
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

 beforeEach(async () => {
  await pool.query("TRUNCATE ocr.pages, ocr.tasks, notices.notice_assets");
  await pool.query("UPDATE notices.notices SET source_ref=NULL, published_source_ref=NULL");
 });

 async function asset(notice: string, ordinal: number, digest: string, kind = "image") {
  await pool.query("INSERT INTO notices.notice_assets VALUES ($1,$2,$3,$4)",[notice,kind,ordinal,digest]);
 }
 async function ocr(input: Record<string, unknown>, digest: string | null, text: string, date = "2026-09-01", status = "completed") {
  const id = randomUUID();
  await pool.query("INSERT INTO ocr.tasks(id,input,input_sha256,status,created_at) VALUES ($1,$2,$3,$4,$5)",[id,input,digest,status,date]);
  await pool.query("INSERT INTO ocr.pages VALUES ($1,0,$2)",[id,text]);
  return id;
 }
 const hashedInput = (noticeId: string, digest: string, ordinal = 0) => ({
  kind:"source",noticeId,key:`internal_portal/resources/sha256/${digest}`,resource:{kind:"image",ordinal,displayOrdinal:ordinal},
 });

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
			await pool.query("INSERT INTO ocr.tasks(id,input,input_sha256,status,created_at) VALUES ($1,$2,$3,$4,$5)", [
				id,
				{
					kind: "source",
					noticeId: notice,
					key: `internal_portal/notices/${notice}/${attachment ? "attachments" : "images"}/${ordinal}`,
				},
				String(ordinal + 1).repeat(64),
				status,
				date,
			]);
			if (text !== null) await pool.query("INSERT INTO ocr.pages VALUES ($1,0,$2)", [id, text]);
			return id;
		};
		for (const ordinal of [0,1,2,3]) await asset("1",ordinal,String(ordinal+1).repeat(64));
		await asset("2",0,"1".repeat(64));
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
 it("uses published image bytes while newer source images and deleted images have OCR", async () => {
  const published = "a".repeat(64), pending = "b".repeat(64), deleted = "c".repeat(64);
  await asset("1",0,published);
  await asset("1",0,pending,"attachment");
  await pool.query("UPDATE notices.notices SET source_ref='pending',published_source_ref='published' WHERE notice_id=1");
  await ocr(hashedInput("1",published),published,"已发布图片");
  await ocr(hashedInput("1",pending),pending,"待发布图片","2026-09-03");
  await ocr(hashedInput("1",deleted),deleted,"已删除图片","2026-09-03");
  await ocr({...hashedInput("1",published),resource:{kind:"attachment",ordinal:0}},published,"附件识别","2026-09-04");
  await ocr(hashedInput("2",published),published,"其他通知","2026-09-05");
  expect((await loadPublishedNoticeSources(pool))[0]?.contentText).toBe("可消费正文\n\n已发布图片");
  await pool.query("UPDATE notices.notice_assets SET content_sha256=$1 WHERE notice_id=1 AND asset_kind='image'",[pending]);
  expect((await loadPublishedNoticeSources(pool))[0]?.contentText).toBe("可消费正文\n\n待发布图片");
  await pool.query("DELETE FROM notices.notice_assets WHERE notice_id=1 AND asset_kind='image'");
  expect((await loadPublishedNoticeSources(pool))[0]?.contentText).toBe("可消费正文");
 });

 it("uses asset order after reordering and repeats a shared image at each published position", async () => {
  const a="a".repeat(64), b="b".repeat(64);
  await asset("1",0,b); await asset("1",1,a); await asset("1",2,b);
  await ocr(hashedInput("1",a,0),a,"A");
  await ocr(hashedInput("1",b,2),b,"B old");
  const task = await ocr(hashedInput("1",b,2),b,"B page 1","2026-09-02");
  await pool.query("INSERT INTO ocr.pages VALUES ($1,1,'B page 2')",[task]);
  await ocr(hashedInput("1",b,2),b,"未完成","2026-09-03","pending");
  expect((await loadPublishedNoticeSources(pool))[0]?.contentText).toBe("可消费正文\n\nB page 1\n\nB page 2\n\nA\n\nB page 1\n\nB page 2");
 });

 it("accepts matching legacy image bytes but rejects mismatched or unknown OCR bytes", async () => {
  const digest="a".repeat(64);
  await asset("1",0,digest);
  const input={kind:"source",noticeId:"1",key:"internal_portal/notices/1/images/7"};
  await ocr(input,digest,"旧路径正确字节");
  await ocr(input,"b".repeat(64),"过时字节","2026-09-02");
  await ocr(input,null,"缺少输入摘要","2026-09-03");
  expect((await loadPublishedNoticeSources(pool))[0]?.contentText).toBe("可消费正文\n\n旧路径正确字节");
 });

});
