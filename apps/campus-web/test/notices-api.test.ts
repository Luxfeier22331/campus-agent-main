import { afterEach, describe, expect, it, vi } from "vitest";
import { getNoticeDetail, listNotices } from "../src/features/notices/api";
import { noticeQueryKeys } from "../src/features/notices/queries";

const listResponse = {
	filters: { domains: [], noticeTypes: [], organizations: [] },
	items: [],
	pagination: { page: 3, pageSize: 30, totalItems: 0, totalPages: 0 },
};

describe("notice browser API", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("forwards every list filter and includes each one in the query key", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(listResponse), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const query = {
			domain: "student_support" as const,
			from: "2026-01-01",
			is_external: false,
			notice_type: 5,
			organization_id: "org-1",
			page: 3,
			q: "奖学金",
			to: "2026-08-13",
		};

		await expect(listNotices(query)).resolves.toEqual(listResponse);
		const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://campus.test");
		expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
			domain: "student_support",
			from: "2026-01-01",
			is_external: "false",
			notice_type: "5",
			organization_id: "org-1",
			page: "3",
			q: "奖学金",
			to: "2026-08-13",
		});
		expect(noticeQueryKeys.list(query)).toEqual([
			"notices",
			"list",
			{
				domain: "student_support",
				from: "2026-01-01",
				isExternal: false,
				noticeType: 5,
				organizationId: "org-1",
				page: 3,
				q: "奖学金",
				to: "2026-08-13",
			},
		]);
	});

	it("requests and validates an internal detail", async () => {
		const detail = {
			attachments: [],
			contentHtml: "<p>正文</p>",
			domain: "campus_operations",
			externalUrl: null,
			images: [],
			isExternal: false,
			noticeId: "358159",
			noticeType: { id: 5, name: "活动报道" },
			organization: { id: "org-1", name: "保卫处" },
			releasedAt: "2026-08-11T00:00:00.000Z",
			title: "海淀校区东北门暂停开放",
		};
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(detail), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getNoticeDetail("358159")).resolves.toEqual(detail);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/notices/358159",
			expect.objectContaining({ credentials: "same-origin", method: "GET" }),
		);
	});
});
