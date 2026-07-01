import { describe, expect, it } from "vitest";

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
		expect(buildNoticeSelectsRequest({ siteId: "example_internal_portal" })).toMatchObject({
			label: "selects",
			method: "POST",
			uniqueKey: "selects:example_internal_portal",
			url: "https://collector.local/authenticated-notice/selects",
		});
		expect(
			buildNoticeListPageRequest({
				currentPage: 2,
				noticeType: "5",
				pageSize: 20,
				siteId: "example_internal_portal",
			}),
		).toMatchObject({
			label: "list_page",
			method: "POST",
			uniqueKey: "list_page:example_internal_portal:5:2:20",
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
				siteId: "example_internal_portal",
			}),
		).toMatchObject({
			label: "detail",
			method: "POST",
			uniqueKey: "detail:example_internal_portal:355119:5",
			url: "https://collector.local/authenticated-notice/detail",
			userData: {
				noticeId: 355119,
				noticeType: "5",
				type: "detail",
			},
		});
	});

	it("collects selected notices through the Crawlee runner without list pages", async () => {
		const handledLabels: string[] = [];
		const result = await runNoticeCrawleeCollection({
			collectionMode: "selected",
			crawlerFactory: ({ requestHandler }) => ({
				async run(requests) {
					for (const request of requests) {
						handledLabels.push(String(request.label));
						await requestHandler({
							addRequests: async () => undefined,
							request: {
								label: request.label,
								userData: request.userData,
							},
						});
					}
					return { requestsFinished: requests.length };
				},
			}),
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						notice_content: `<p>${noticeId}</p>`,
						notice_id: noticeId,
						notice_release_time: "2026-04-02 18:49",
						notice_title: `通知 ${noticeId}`,
					},
				},
				state: true,
			}),
			fetchNoticePage: async () => {
				throw new Error("unexpected list page fetch");
			},
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
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(handledLabels).toEqual(["selects", "detail"]);
		expect(result.bundleRecords).toHaveLength(1);
		expect(result.stats).toEqual({
			detailFetched: 1,
			itemsSeen: 1,
			pageBudgetExhausted: false,
			pagesFetched: 0,
		});
	});

	it("enqueues detail requests from list pages and deduplicates repeated notices", async () => {
		const handledKeys: string[] = [];
		const result = await runNoticeCrawleeCollection({
			collectionMode: "incremental",
			crawlerFactory: ({ requestHandler }) => ({
				async run(requests) {
					const queue = [...requests];
					const seen = new Set(queue.map((request) => request.uniqueKey));
					let index = 0;
					while (index < queue.length) {
						const request = queue[index];
						handledKeys.push(request.uniqueKey ?? String(request.label));
						await requestHandler({
							addRequests: async (nextRequests) => {
								for (const nextRequest of nextRequests) {
									if (nextRequest.uniqueKey && seen.has(nextRequest.uniqueKey)) {
										continue;
									}
									if (nextRequest.uniqueKey) {
										seen.add(nextRequest.uniqueKey);
									}
									queue.push(nextRequest);
								}
							},
							request: {
								label: request.label,
								userData: request.userData,
							},
						});
						index += 1;
					}
					return { requestsFinished: queue.length };
				},
			}),
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						notice_content: `<p>${noticeId}</p>`,
						notice_id: noticeId,
						notice_release_time: "2026-04-02 18:49",
						notice_title: `通知 ${noticeId}`,
					},
				},
				state: true,
			}),
			fetchNoticePage: async ({ currentPage, noticeType }) => ({
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
			}),
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
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(handledKeys).toContain("list_page:example_internal_portal:5:1:2");
		expect(
			handledKeys.filter((key) => key === "detail:example_internal_portal:355119:5"),
		).toHaveLength(1);
		expect(result.bundleRecords).toHaveLength(1);
		expect(result.stats.itemsSeen).toBe(2);
		expect(result.stats.pagesFetched).toBe(1);
	});
});
