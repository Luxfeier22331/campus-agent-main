import { describe, expect, it, vi } from "vitest";
import { PortalSourceDeferredError } from "../src/api.js";
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
		reconcilePages: 3,
		reconcilePageSize: 20,
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
			reconcileMaxPagesPerType: null,
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

	it("fails the collection when a request exhausts its retries", async () => {
		await expect(
			runNoticeCrawleeCollection({
				collectionMode: "selected",
				exportedAt: "2026-04-04T01:23:45.000Z",
				fetchNoticeDetail: async () => {
					throw new PortalSourceDeferredError("getNotice failed: 503 Service Unavailable");
				},
				fetchNoticePage: async () => {
					throw new Error("unexpected list page fetch");
				},
				fetchNoticeSelects: async () => ({ state: true }),
				fullScopeRequested: false,
				reconcileMaxPagesPerType: null,
				maxNotices: null,
				noticeTypes,
				requestMaxRetries: 0,
				selectedNotices: [{ noticeId: 355119, noticeType: "5" }],
				siteId: "synthetic_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
			}),
		).rejects.toMatchObject({ code: "internal_portal_source_deferred" });
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
			reconcileMaxPagesPerType: null,
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

	it("finds the previous head and captures the configured overlap page", async () => {
		const pages: number[] = [];
		const idsByPage: Record<number, number[]> = {
			1: [110, 109],
			2: [101, 100],
			3: [99, 98],
			4: [97, 96],
		};
		const result = await runNoticeCrawleeCollection({
			reconcileMaxPagesPerType: 4,
			checkpoints: [{ last_released_notice_id: 100, notice_type: "5" }],
			collectionMode: "incremental",
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						notice_content: String(noticeId),
						notice_id: noticeId,
						notice_title: `通知 ${noticeId}`,
					},
				},
				state: true,
			}),
			fetchNoticePage: async ({ currentPage, noticeType }) => {
				pages.push(currentPage);
				return {
					datas: {
						page: { totalCounts: 4 },
						tables: (idsByPage[currentPage] ?? []).map((noticeId) => ({
							notice_id: noticeId,
							notice_title: `通知 ${noticeId}`,
							notice_type: noticeType,
						})),
					},
					state: true,
				};
			},
			fetchNoticeSelects: async () => ({ datas: { org: [], type: [] }, state: true }),
			fullScopeRequested: false,
			maxNotices: null,
			noticeTypes,
			overlapPages: 1,
			requestMaxRetries: 1,
			selectedNotices: [],
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(pages).toEqual([1, 2, 3]);
		expect(result.checkpointGaps).toEqual([]);
		expect(result.nextCheckpoints).toEqual([{ last_released_notice_id: 110, notice_type: "5" }]);
	});

	it("reports a checkpoint gap without advancing the stored head", async () => {
		const result = await runNoticeCrawleeCollection({
			reconcileMaxPagesPerType: 2,
			checkpoints: [{ last_released_notice_id: 50, notice_type: "5" }],
			collectionMode: "incremental",
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						notice_content: String(noticeId),
						notice_id: noticeId,
						notice_title: `通知 ${noticeId}`,
					},
				},
				state: true,
			}),
			fetchNoticePage: async ({ currentPage, noticeType }) => ({
				datas: {
					page: { totalCounts: 3 },
					tables: [{ notice_id: 100 - currentPage, notice_title: "通知", notice_type: noticeType }],
				},
				state: true,
			}),
			fetchNoticeSelects: async () => ({ datas: { org: [], type: [] }, state: true }),
			fullScopeRequested: false,
			maxNotices: null,
			noticeTypes,
			overlapPages: 1,
			requestMaxRetries: 1,
			selectedNotices: [],
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.checkpointGaps).toEqual([{ last_released_notice_id: 50, notice_type: "5" }]);
	});

	it("reports a checkpoint gap when the overlap page exceeds the page budget", async () => {
		const pages: number[] = [];
		const result = await runNoticeCrawleeCollection({
			reconcileMaxPagesPerType: 2,
			checkpoints: [{ last_released_notice_id: 100, notice_type: "5" }],
			collectionMode: "incremental",
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						notice_content: String(noticeId),
						notice_id: noticeId,
						notice_title: `通知 ${noticeId}`,
					},
				},
				state: true,
			}),
			fetchNoticePage: async ({ currentPage, noticeType }) => {
				pages.push(currentPage);
				return {
					datas: {
						page: { totalCounts: 3 },
						tables: [
							{
								notice_id: currentPage === 2 ? 100 : 110,
								notice_title: "通知",
								notice_type: noticeType,
							},
						],
					},
					state: true,
				};
			},
			fetchNoticeSelects: async () => ({ datas: { org: [], type: [] }, state: true }),
			fullScopeRequested: false,
			maxNotices: null,
			noticeTypes,
			overlapPages: 1,
			requestMaxRetries: 1,
			selectedNotices: [],
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(pages).toEqual([1, 2]);
		expect(result.checkpointGaps).toEqual([{ last_released_notice_id: 100, notice_type: "5" }]);
	});
});
