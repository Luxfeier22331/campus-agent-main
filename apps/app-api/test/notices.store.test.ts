// @vitest-environment node

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createPgNoticeStore } from "../src/modules/notices";

describe("pg notice store", () => {
	it("returns the source attachment identifier with detail assets", async () => {
		const dialect = new PgDialect();
		const execute = vi.fn(async (statement: SQL) => {
			const query = dialect.sqlToQuery(statement).sql;
			if (query.includes("FROM notices.notice_assets")) {
				expect(query).toContain("portal_annex_id");
				return {
					rows: [
						{
							asset_kind: "attachment",
							byte_size: "1200",
							content_sha256: "a".repeat(64),
							content_type: "application/pdf",
							ordinal: 0,
							original_name: "附件.pdf",
							portal_annex_id: "annex-1",
						},
					],
				};
			}
			return {
				rows: [
					{
						category: "campus_operations",
						content_html: "<p>正文</p>",
						external_url: null,
						is_external: false,
						notice_id: "358159",
						notice_type: 5,
						notice_type_name: "办公通知",
						organization_id: null,
						organization_name: null,
						released_at: "2026-08-11T00:00:00.000Z",
						title: "暂停开放通知",
					},
				],
			};
		});
		const store = createPgNoticeStore({
			getDb: async () => ({ execute }) as never,
		});

		await expect(store.getDetail("358159")).resolves.toMatchObject({
			assets: [{ kind: "attachment", portalAnnexId: "annex-1" }],
		});
	});

	it("excludes unavailable notices from list, detail and image queries", async () => {
		const queries: string[] = [];
		const dialect = new PgDialect();
		const execute = vi.fn(async (statement: SQL) => {
			const query = dialect.sqlToQuery(statement).sql;
			queries.push(query);
			return query.includes("count(*)") ? { rows: [{ count: "0" }] } : { rows: [] };
		});
		const store = createPgNoticeStore({
			getDb: async () => ({ execute }) as never,
		});

		await store.list({ page: 1, stream: "notices" });
		await store.getDetail("358159");
		await store.getImageAsset("358159", 0);

		const noticeTableQueries = queries.filter((query) => query.includes("notices.notices"));
		expect(noticeTableQueries.length).toBeGreaterThan(0);
		for (const query of noticeTableQueries) {
			expect(query).toContain("n.unavailable_at IS NULL");
		}
	});

	it("filters the selected stream and category in count and item queries", async () => {
		const queries: Array<{ params: unknown[]; sql: string }> = [];
		const dialect = new PgDialect();
		const execute = vi.fn(async (statement: SQL) => {
			const query = dialect.sqlToQuery(statement);
			queries.push({ params: query.params, sql: query.sql });
			return query.sql.includes("count(*)") ? { rows: [{ count: "0" }] } : { rows: [] };
		});
		const store = createPgNoticeStore({
			getDb: async () => ({ execute }) as never,
		});

		await store.list({
			category: "procurement",
			page: 1,
			stream: "notices",
		});

		const filtered = queries.filter((query) => query.sql.includes("n.category ="));
		expect(filtered).toHaveLength(2);
		for (const query of filtered) {
			expect(query.sql).toContain("n.category <> 'campus_news'");
			expect(query.params).toContain("procurement");
		}
	});

	it("matches an escaped keyword against both title and cleaned content", async () => {
		const queries: Array<{ params: unknown[]; sql: string }> = [];
		const dialect = new PgDialect();
		const execute = vi.fn(async (statement: SQL) => {
			const query = dialect.sqlToQuery(statement);
			queries.push({ params: query.params, sql: query.sql });
			return query.sql.includes("count(*)") ? { rows: [{ count: "0" }] } : { rows: [] };
		});
		const store = createPgNoticeStore({
			getDb: async () => ({ execute }) as never,
		});

		await store.list({ page: 1, q: "100%_安排", stream: "notices" });

		const filteredQueries = queries.filter((query) => query.sql.includes("ILIKE"));
		expect(filteredQueries).toHaveLength(2);
		for (const query of filteredQueries) {
			expect(query.sql).toMatch(
				/\(n\.title ILIKE \$\d+ OR COALESCE\(n\.content_text, ''\) ILIKE \$\d+\)/u,
			);
			expect(query.params.filter((value) => value === "%100\\%\\_安排%")).toHaveLength(2);
		}
	});

	it("returns only referenced organization options without merging equal names", async () => {
		const queries: string[] = [];
		const dialect = new PgDialect();
		const execute = vi.fn(async (statement: SQL) => {
			const query = dialect.sqlToQuery(statement).sql;
			queries.push(query);
			if (query.includes("count(*)")) {
				return { rows: [{ count: "0" }] };
			}
			if (query.includes("FROM notices.notice_types")) {
				return { rows: [] };
			}
			if (query.includes("FROM notices.organizations")) {
				return {
					rows: [
						{ name: "同名部门", organization_id: "org-1" },
						{ name: "同名部门", organization_id: "org-2" },
					],
				};
			}
			return { rows: [] };
		});
		const store = createPgNoticeStore({
			getDb: async () => ({ execute }) as never,
		});

		const result = await store.list({ page: 1, stream: "notices" });

		expect(result.organizations).toEqual([
			{ id: "org-1", name: "同名部门" },
			{ id: "org-2", name: "同名部门" },
		]);
		const organizationQuery = queries.find((query) => query.includes("FROM notices.organizations"));
		expect(organizationQuery).toMatch(
			/WHERE EXISTS \(\s*SELECT 1\s*FROM notices\.notices AS n\s*WHERE n\.organization_id = o\.organization_id AND n\.is_published AND n\.unavailable_at IS NULL\s*\)/u,
		);
	});
});
