// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createPgNoticeStore } from "../src/server/notice-store";

describe("PostgreSQL notice store", () => {
	it("aggregates counts by search and category while paginating the requested state", async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce({
				rows: [
					{
						all_count: "4",
						needs_classification: "1",
						needs_publication: "2",
						published: "1",
					},
				],
			})
			.mockResolvedValueOnce({
				rows: [
					{
						category: "campus_news",
						external_url: null,
						is_external: false,
						is_published: false,
						notice_id: "42",
						notice_type: 5,
						notice_type_name: "办公通知",
						organization_id: "org-1",
						organization_name: "教务处",
						released_at: new Date("2026-08-23T10:00:00.000Z"),
						title: "测试通知",
					},
				],
			});
		const store = createPgNoticeStore({ getDb: createRuntimeDatabase });

		await expect(
			store.list({
				category: "campus_news",
				page: 2,
				q: "42",
				state: "needs_publication",
			}),
		).resolves.toEqual({
			counts: { all: 4, needsClassification: 1, needsPublication: 2, published: 1 },
			items: [
				{
					category: "campus_news",
					externalUrl: null,
					isExternal: false,
					noticeId: 42,
					noticeType: { id: 5, name: "办公通知" },
					organization: { id: "org-1", name: "教务处" },
					releasedAt: "2026-08-23T10:00:00.000Z",
					state: "needs_publication",
					title: "测试通知",
				},
			],
			page: 2,
			totalItems: 2,
			totalPages: 1,
		});

		const countSql = normalizeSql(String(query.mock.calls[0]?.[0]));
		expect(countSql).toContain(
			"from notices.notices as n where (n.title ilike $1 or n.notice_id::text = $2) and n.category = $3",
		);
		expect(query.mock.calls[0]?.[1]).toEqual(["%42%", "42", "campus_news"]);

		const listSql = normalizeSql(String(query.mock.calls[1]?.[0]));
		expect(listSql).toContain(
			"where (n.title ilike $1 or n.notice_id::text = $2) and n.category = $3 and n.category is not null and not n.is_published",
		);
		expect(query.mock.calls[1]?.[1]).toEqual(["%42%", "42", "campus_news", 30, 30]);
	});
});

function normalizeSql(sql: string): string {
	return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
