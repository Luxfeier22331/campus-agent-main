import { expect, it } from "vitest";

import { collectBootstrapBundle } from "../src/bootstrap-export.js";

export function registerBootstrapExportCollectionValidationSuite(): void {
	it("rejects selected collection mode before creating an api context when notice ids are missing", async () => {
		let apiContextCreated = false;

		await expect(
			collectBootstrapBundle({
				collectionMode: "selected",
				createApiContext: async () => {
					apiContextCreated = true;
					return {
						dispose: async () => undefined,
						get: async () => ({
							body: async () => Buffer.from(""),
							json: async () => ({}),
							ok: () => true,
							status: () => 200,
							statusText: () => "OK",
						}),
						post: async () => {
							throw new Error("unexpected post");
						},
					};
				},
				exportedAt: "2026-04-04T01:23:45.000Z",
				noticeTypes: [
					{
						type: "5",
						name: "办公通知",
						enabled: true,
						incrementalPages: 1,
						incrementalPageSize: 20,
						backfillPages: 1,
						backfillPageSize: 20,
					},
				],
				requestBackoffBaseMs: 1,
				requestMaxRetries: 1,
				siteId: "muc_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
			}),
		).rejects.toThrow("selected_notice_ids_required");

		expect(apiContextCreated).toBe(false);
	});
	it("rejects incremental runs without enabled notice types before creating an api context", async () => {
		let apiContextCreated = false;

		await expect(
			collectBootstrapBundle({
				collectionMode: "incremental",
				createApiContext: async () => {
					apiContextCreated = true;
					return {
						dispose: async () => undefined,
						get: async () => ({
							body: async () => Buffer.from(""),
							json: async () => ({}),
							ok: () => true,
							status: () => 200,
							statusText: () => "OK",
						}),
						post: async () => {
							throw new Error("unexpected post");
						},
					};
				},
				exportedAt: "2026-04-04T01:23:45.000Z",
				noticeTypes: [
					{
						type: "5",
						name: "办公通知",
						enabled: false,
						incrementalPages: 1,
						incrementalPageSize: 20,
						backfillPages: 1,
						backfillPageSize: 20,
					},
				],
				requestBackoffBaseMs: 1,
				requestMaxRetries: 1,
				siteId: "muc_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
			}),
		).rejects.toThrow("enabled_notice_types_required");

		expect(apiContextCreated).toBe(false);
	});
	it("uses backfill page budgets when collection mode is backfill", async () => {
		const pageCalls: Array<{ currentPage: number; noticeType: string; pageSize: number }> = [];
		const detailCalls: number[] = [];
		const result = await collectBootstrapBundle({
			collectionMode: "backfill",
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from(""),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				}),
				post: async () => {
					throw new Error("unexpected post");
				},
			}),
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => {
				detailCalls.push(noticeId);
				return {
					datas: {
						notice_info: {
							notice_content: `<p>${noticeId}</p>`,
							notice_id: noticeId,
							notice_release_time: "2026-04-02 18:49",
							notice_title: `回填通知 ${noticeId}`,
						},
					},
					state: true,
				};
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
			fetchNoticePage: async ({ currentPage, noticeType, pageSize }) => {
				pageCalls.push({ currentPage, noticeType, pageSize });
				return {
					datas: {
						page: {
							totalCounts: 2,
						},
						tables: [
							{
								notice_id: 355000 + currentPage,
								notice_title: `回填通知 ${currentPage}`,
								notice_type: noticeType,
								notice_type_name: "办公通知",
							},
						],
					},
					state: true,
				};
			},
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 1,
					backfillPages: 2,
					backfillPageSize: 50,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(pageCalls).toEqual([
			{ currentPage: 1, noticeType: "5", pageSize: 50 },
			{ currentPage: 2, noticeType: "5", pageSize: 50 },
		]);
		expect(detailCalls).toEqual([355001, 355002]);
		expect(result.stats.pagesFetched).toBe(2);
		expect(result.exportManifest.filters.collection_mode).toBe("backfill");
		expect(result.exportManifest.run.mode).toBe("backfill");
	});

	it("allows historical backfill to extend beyond per-type page budgets up to a runtime max", async () => {
		const pageCalls: number[] = [];
		const detailCalls: number[] = [];
		const result = await collectBootstrapBundle({
			backfillMaxPagesPerType: 3,
			collectionMode: "backfill",
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from(""),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				}),
				post: async () => {
					throw new Error("unexpected post");
				},
			}),
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => {
				detailCalls.push(noticeId);
				return {
					datas: {
						notice_info: {
							notice_content: `<p>${noticeId}</p>`,
							notice_id: noticeId,
							notice_release_time: "2026-04-02 18:49",
							notice_title: `历史通知 ${noticeId}`,
						},
					},
					state: true,
				};
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
			fetchNoticePage: async ({ currentPage }) => {
				pageCalls.push(currentPage);
				return {
					datas: {
						page: {
							totalCounts: 3,
						},
						tables: [
							{
								notice_id: 356000 + currentPage,
								notice_title: `历史通知 ${currentPage}`,
								notice_type: "5",
								notice_type_name: "办公通知",
							},
						],
					},
					state: true,
				};
			},
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 20,
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(pageCalls).toEqual([1, 2, 3]);
		expect(detailCalls).toEqual([356001, 356002, 356003]);
		expect(result.exportManifest.run_admission).toMatchObject({
			expected_page_count: 3,
			page_budget: [
				{
					notice_type: "5",
					page_size: 20,
					pages: 3,
				},
			],
		});
	});

	it("fails closed when a full-scope backfill exhausts the page budget before the source surface ends", async () => {
		await expect(
			collectBootstrapBundle({
				collectionMode: "backfill",
				createApiContext: async () => ({
					dispose: async () => undefined,
					get: async () => ({
						body: async () => Buffer.from(""),
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					}),
					post: async () => {
						throw new Error("unexpected post");
					},
				}),
				exportedAt: "2026-04-04T01:23:45.000Z",
				fetchNoticeDetail: async ({ noticeId }) => ({
					datas: {
						notice_info: {
							notice_content: `<p>${noticeId}</p>`,
							notice_id: noticeId,
							notice_release_time: "2026-04-02 18:49",
							notice_title: `历史通知 ${noticeId}`,
						},
					},
					state: true,
				}),
				fetchNoticeSelects: async () => ({
					datas: {
						org: [],
						type: [
							{
								notice_type_id: 9982,
								notice_type_name: "常用下载",
							},
						],
					},
					state: true,
				}),
				fetchNoticePage: async ({ currentPage }) => ({
					datas: {
						page: {
							totalCounts: 3,
						},
						tables: [
							{
								notice_id: 355650 + currentPage,
								notice_title: `历史通知 ${currentPage}`,
								notice_type: "9982",
								notice_type_name: "常用下载",
							},
						],
					},
					state: true,
				}),
				noticeTypes: [
					{
						type: "9982",
						name: "常用下载",
						enabled: true,
						incrementalPages: 1,
						incrementalPageSize: 20,
						backfillPages: 1,
						backfillPageSize: 20,
					},
				],
				requestBackoffBaseMs: 1,
				requestMaxRetries: 1,
				siteId: "muc_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
			}),
		).rejects.toThrow("page_budget_exhausted");
	});
}
