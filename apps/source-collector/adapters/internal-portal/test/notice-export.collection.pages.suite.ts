import { expect, it } from "vitest";

import { collectNoticeExportBundle } from "../src/notice-export.js";
import type { NoticeTypeConfig } from "../src/types.js";

export function registerNoticeExportCollectionPagesSuite(): void {
	it("collects list/detail pages into a deduplicated notice export bundle and disposes the api context", async () => {
		const detailCalls: number[] = [];
		let disposed = false;
		const noticeTypes: NoticeTypeConfig[] = [
			{
				type: "5",
				name: "办公通知",
				enabled: true,
				incrementalPages: 1,
				incrementalPageSize: 2,
				reconcilePages: 1,
				reconcilePageSize: 20,
			},
			{
				type: "6",
				name: "教学通知",
				enabled: true,
				incrementalPages: 1,
				incrementalPageSize: 2,
				reconcilePages: 1,
				reconcilePageSize: 20,
			},
		];

		const result = await collectNoticeExportBundle({
			createApiContext: async () => ({
				dispose: async () => {
					disposed = true;
				},
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
							notice_link: `https://portal.example.edu/notice/${noticeId}`,
							notice_link_state: 0,
							notice_release_time: "2026-04-02 18:49",
							notice_source: 1,
							notice_state: 1,
							notice_stick: 0,
						},
					},
					state: true,
				};
			},
			fetchNoticeSelects: async () => ({
				datas: {
					org: [
						{
							organization_id: "00011",
							organization_name: "教务处（考试中心、教师教学发展中心）",
						},
					],
					type: [
						{
							notice_type_id: 5,
							notice_type_name: "办公通知",
						},
						{
							notice_type_id: 6,
							notice_type_name: "教学通知",
						},
					],
				},
				state: true,
			}),
			fetchNoticePage: async ({ noticeType }) => {
				if (noticeType === "5") {
					return {
						datas: {
							page: {
								totalCounts: 1,
							},
							tables: [
								{
									notice_id: 355119,
									notice_title: "通知 A",
									notice_type: "5",
									notice_type_name: "办公通知",
								},
								{
									notice_id: 355120,
									notice_title: "通知 B",
									notice_type: "5",
									notice_type_name: "办公通知",
								},
							],
						},
						state: true,
					};
				}

				return {
					datas: {
						page: {
							totalCounts: 1,
						},
						tables: [
							{
								notice_id: 355119,
								notice_title: "通知 A",
								notice_type: "6",
								notice_type_name: "教学通知",
							},
						],
					},
					state: true,
				};
			},
			noticeTypes,
			requestMaxRetries: 3,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(detailCalls).toEqual([355119, 355120]);
		expect(disposed).toBe(true);
		expect(result.stats).toEqual({
			attachmentObjectsUploaded: 0,
			detailFetched: 2,
			noticesCollected: 2,
			pagesFetched: 2,
		});
		expect(result.bundleRecords).toHaveLength(2);
		expect(result.bundleRecords[0]?.notice.categories).toEqual([
			{
				category_first_seen_at: "2026-04-04T01:23:45.000Z",
				category_last_run_id: null,
				category_last_seen_at: "2026-04-04T01:23:45.000Z",
				notice_id: 355119,
				notice_type: "5",
				notice_type_name: "办公通知",
			},
			{
				category_first_seen_at: "2026-04-04T01:23:45.000Z",
				category_last_run_id: null,
				category_last_seen_at: "2026-04-04T01:23:45.000Z",
				notice_id: 355119,
				notice_type: "6",
				notice_type_name: "教学通知",
			},
		]);
		expect(result.exportManifest.run.items_seen).toBe(3);
		expect(result.exportManifest.run.items_inserted).toBe(2);
		expect(result.exportManifest.notice_type_policy).toEqual([
			{
				reconcile: {
					page_size: 20,
					pages: 1,
				},
				enabled: true,
				incremental: {
					page_size: 2,
					pages: 1,
				},
				name: "办公通知",
				type: "5",
			},
			{
				reconcile: {
					page_size: 20,
					pages: 1,
				},
				enabled: true,
				incremental: {
					page_size: 2,
					pages: 1,
				},
				name: "教学通知",
				type: "6",
			},
		]);
		expect(result.exportManifest.observed_notice_types).toEqual([
			{
				notice_type_id: 5,
				notice_type_name: "办公通知",
			},
			{
				notice_type_id: 6,
				notice_type_name: "教学通知",
			},
		]);
		expect(result.exportManifest.observed_organizations).toEqual([
			{
				organization_id: "00011",
				organization_name: "教务处（考试中心、教师教学发展中心）",
			},
		]);
		expect(result.exportManifest.capture_runtime).toEqual({
			attachment_collection_mode: "detail_api_and_html_reference_only",
			attachment_storage_mode: "reference_only",
			export_contract_version: "internal_portal_notice_export_v1",
			link_collection_mode: "html_reference_only",
			runtime_shell: "source_collector_node",
		});
		expect(result.exportManifest.run_admission).toMatchObject({
			accepted: true,
			collection_mode: "incremental",
			notice_type_ids: ["5", "6"],
			selected_notice_ids: [],
			expected_page_count: 2,
			page_budget: [
				{
					notice_type: "5",
					notice_type_name: "办公通知",
					page_size: 2,
					pages: 1,
				},
				{
					notice_type: "6",
					notice_type_name: "教学通知",
					page_size: 2,
					pages: 1,
				},
			],
			rejection_reasons: [],
		});
	});
	it("collects selected historical notice ids without scanning current list pages", async () => {
		const detailCalls: Array<{ noticeId: number; noticeType: string }> = [];
		let pageCalls = 0;
		const result = await collectNoticeExportBundle({
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
			fetchNoticeDetail: async ({ noticeId, noticeType }) => {
				detailCalls.push({ noticeId, noticeType });
				return {
					datas: {
						notice_info: {
							notice_content: `<p>${noticeId} 正文</p>`,
							notice_id: noticeId,
							notice_release_time: "2021-02-28 16:09",
							notice_title: "历史制度通知",
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
			fetchNoticePage: async () => {
				pageCalls += 1;
				return { datas: { page: { totalCounts: 0 }, tables: [] }, state: true };
			},
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 20,
					reconcilePages: 1,
					reconcilePageSize: 20,
				},
			],
			requestMaxRetries: 1,
			selectedNotices: [
				{
					noticeId: 187233,
					noticeType: "32",
					noticeTypeName: "学工通知",
				},
			],
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(pageCalls).toBe(0);
		expect(detailCalls).toEqual([{ noticeId: 187233, noticeType: "32" }]);
		expect(result.stats).toEqual({
			attachmentObjectsUploaded: 0,
			detailFetched: 1,
			noticesCollected: 1,
			pagesFetched: 0,
		});
		expect(result.bundleRecords[0]?.notice).toMatchObject({
			notice_id: 187233,
			notice_title: "历史制度通知",
			categories: [
				{
					notice_id: 187233,
					notice_type: "32",
					notice_type_name: "学工通知",
				},
			],
		});
		expect(result.exportManifest.filters).toMatchObject({
			max_notices: null,
			notice_types: ["32"],
			selected_notice_ids: ["187233"],
		});
		expect(result.exportManifest.run_admission).toMatchObject({
			accepted: true,
			collection_mode: "selected",
			notice_type_ids: ["32"],
			selected_notice_ids: ["187233"],
			expected_page_count: 0,
			page_budget: [],
			rejection_reasons: [],
		});
		expect(result.exportManifest.run.items_seen).toBe(1);
	});

	it("marks a bounded reconcile that covers every fetched page as full-scope completed", async () => {
		const result = await collectNoticeExportBundle({
			collectionMode: "reconcile",
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
						notice_content: `<p>${noticeId} 正文</p>`,
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
			fetchNoticePage: async () => ({
				datas: {
					page: {
						totalCounts: 1,
					},
					tables: [
						{
							notice_id: 355650,
							notice_title: "常用下载通知",
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
					reconcilePages: 2,
					reconcilePageSize: 20,
				},
			],
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.exportManifest.source_surface).toBe("notice");
		expect(result.exportManifest.full_scope_requested).toBe(true);
		expect(result.exportManifest.full_scope_completed).toBe(true);
		expect(result.exportManifest.page_budget_exhausted).toBe(false);
	});
}
