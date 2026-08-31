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
				is_published boolean NOT NULL
			);
			INSERT INTO notices.notices(notice_id, title, content_text, is_published) VALUES
				(3, '未发布', '不可消费', false),
				(2, '纯图片', NULL, true),
				(1, '已发布正文', '可消费正文', true);
		`);
	}, 120_000);

	afterAll(async () => {
		try {
			await pool?.end();
		} finally {
			await container?.stop();
		}
	}, 60_000);

	it("selects only published notices with stored text", async () => {
		await expect(loadPublishedNoticeSources(pool)).resolves.toEqual([
			{ contentText: "可消费正文", noticeId: "1", title: "已发布正文" },
		]);
	});
});
