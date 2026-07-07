import { describe, expect, it, vi } from "vitest";

import {
	buildNoticeDetailRequest,
	buildNoticeListPageRequest,
	buildNoticeSelectsRequest,
	runNoticeCrawleeCollection,
} from "../src/notice-crawlee-runner.js";
import type { NoticeTypeConfig } from "../src/types.js";

const noticeTypes: NoticeTypeConfig[] = [
	{
		type: "5",
		name: "办公通知",
		enabled: true,
		incrementalPages: 2,
		incrementalPageSize: 2,
		backfillPages: 3,
		backfillPageSize: 20,
	},
];

describe("notice Crawlee runner", () => {
	it("builds stable POST request identities for selects, list pages, and details", () => {
		expect(buildNoticeSelectsRequest({ siteId: "synthetic_internal_portal" })).toMatchObject({
			label: "selects",
			method: "POST",
			uniqueKey: "selects:synthetic_internal_portal",
			url: "https://collector.local/authenticated-notice/selects",
		});
		expect(
			buildNoticeListPageRequest({
				currentPage: 2,
				noticeType: "5",
				pageSize: 20,
				siteId: "synthetic_internal_portal",
			}),
		).toMatchObject({
			label: "list_page",
			method: "POST",
			uniqueKey: "list_page:synthetic_internal_portal:5:2:20",
			url: "https://collector.local/authenticated-notice/list-page",
			userData: {
				currentPage: 2,
				noticeType: "5",
				pageSize: 20,
				type: "list_page",
			},
		});
		expect(
			buildNoticeDetailRequest({
				noticeId: 355119,
				noticeType: "5",
				siteId: "synthetic_internal_portal",
			}),
		).toMatchObject({
			label: "detail",
			method: "POST",
			uniqueKey: "detail:synthetic_internal_portal:355119",
			url: "https://collector.local/authenticated-notice/detail",
			userData: {
				noticeId: 355119,
				noticeType: "5",
				type: "detail",
			},
		});
	});

	it("collects selected notices through the Crawlee runner without list pages", async () => {
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) => ({
			datas: {
				notice_info: {
					notice_content: `<p>${noticeId}</p>`,
					notice_id: noticeId,
					notice_release_time: "2026-04-02 18:49",
					notice_title: `通知 ${noticeId}`,
				},
			},
			state: true,
		}));
		const fetchNoticePage = vi.fn(async () => {
			throw new Error("unexpected list page fetch");
		});
		const result = await runNoticeCrawleeCollection({
			collectionMode: "selected",
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail,
			fetchNoticePage,
			fetchNoticeSelects: async () => ({
				datas: {
					org: [],
					type: [
						{
							notice_type_id: 5,
							notice_type_name: "办公通知",
						},
					],
				},
				state: true,
			}),
			fullScopeRequested: false,
			backfillMaxPagesPerType: null,
			maxNotices: null,
			noticeTypes,
			requestMaxRetries: 1,
			selectedNotices: [{ noticeId: 355119, noticeType: "5", noticeTypeName: "办公通知" }],
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(fetchNoticeDetail).toHaveBeenCalledOnce();
		expect(fetchNoticeDetail).toHaveBeenCalledWith(
			expect.objectContaining({ noticeId: 355119, noticeType: "5" }),
		);
		expect(fetchNoticePage).not.toHaveBeenCalled();
		expect(result.bundleRecords).toHaveLength(1);
		expect(result.stats).toEqual({
			detailFetched: 1,
			itemsSeen: 1,
			pageBudgetExhausted: false,
			pagesFetched: 0,
		});
	});

	it("enqueues detail requests from list pages and deduplicates repeated notices", async () => {
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) => ({
			datas: {
				notice_info: {
					notice_content: `<p>${noticeId}</p>`,
					notice_id: noticeId,
					notice_release_time: "2026-04-02 18:49",
					notice_title: `通知 ${noticeId}`,
				},
			},
			state: true,
		}));
		const fetchNoticePage = vi.fn(async ({ currentPage, noticeType }) => ({
			datas: {
				page: { totalCounts: 1 },
				tables: [
					{
						notice_id: 355119,
						notice_title: `通知 ${currentPage}`,
						notice_type: noticeType,
						notice_type_name: "办公通知",
					},
					{
						notice_id: 355119,
						notice_title: `重复通知 ${currentPage}`,
						notice_type: noticeType,
						notice_type_name: "办公通知",
					},
				],
			},
			state: true,
		}));
		const result = await runNoticeCrawleeCollection({
			collectionMode: "incremental",
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail,
			fetchNoticePage,
			fetchNoticeSelects: async () => ({
				datas: {
					org: [],
					type: [{ notice_type_id: 5, notice_type_name: "办公通知" }],
				},
				state: true,
			}),
			fullScopeRequested: false,
			backfillMaxPagesPerType: null,
			maxNotices: null,
			noticeTypes,
			requestMaxRetries: 1,
			selectedNotices: [],
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(fetchNoticePage).toHaveBeenCalledOnce();
		expect(fetchNoticeDetail).toHaveBeenCalledOnce();
		expect(result.bundleRecords).toHaveLength(1);
		expect(result.stats.itemsSeen).toBe(2);
		expect(result.stats.pagesFetched).toBe(1);
	});
});
