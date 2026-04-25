import { expect, it } from "vitest";

import { collectBootstrapBundle } from "../src/bootstrap-export";
import type { NoticeTypeConfig } from "../src/types";

export function registerBootstrapExportCollectionSuite() {
	it("collects list/detail pages into a deduplicated bootstrap bundle and disposes the api context", async () => {
		const detailCalls: number[] = [];
		let disposed = false;
		const noticeTypes: NoticeTypeConfig[] = [
			{
				type: "5",
				name: "办公通知",
				enabled: true,
				incrementalPages: 1,
				incrementalPageSize: 2,
				backfillPages: 1,
				backfillPageSize: 20,
			},
			{
				type: "6",
				name: "教学通知",
				enabled: true,
				incrementalPages: 1,
				incrementalPageSize: 2,
				backfillPages: 1,
				backfillPageSize: 20,
			},
		];

		const result = await collectBootstrapBundle({
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
			requestBackoffBaseMs: 1,
			requestMaxRetries: 3,
			siteId: "muc_internal_portal",
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
				backfill: {
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
				backfill: {
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
		expect(result.exportManifest.collector).toEqual({
			attachment_collection_mode: "detail_api_and_html_reference_only",
			attachment_storage_mode: "reference_only",
			export_contract_version: "authenticated_notice_collector_export_v2",
			link_collection_mode: "html_reference_only",
			runtime_shell: "repo_local_node",
		});
	});

	it("collects selected historical notice ids without scanning current list pages", async () => {
		const detailCalls: Array<{ noticeId: number; noticeType: string }> = [];
		let pageCalls = 0;
		const result = await collectBootstrapBundle({
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
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			selectedNotices: [
				{
					noticeId: 187233,
					noticeType: "32",
					noticeTypeName: "学工通知",
				},
			],
			siteId: "muc_internal_portal",
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
		expect(result.exportManifest.run.items_seen).toBe(1);
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

	it("materializes internal attachments into object-backed bundle rows when an artifact store is configured", async () => {
		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				putObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({
						key: objectKey,
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						metadata,
					});
					return {
						bucket: "campus-rag-source",
						objectKey,
						contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
						byteSize: data.byteLength,
						etag: '"etag-1"',
						versionId: null,
					};
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from("hello"),
					headers: () => ({
						"content-disposition": "attachment; filename*=UTF-8''application.docx",
						"content-type":
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					}),
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
						home_url: "https://portal.example.edu/home",
						notice_annext: [
							{
								notice_annex_id: "annex-1",
								notice_annex_name: "application.docx",
							},
						],
						notice_content: "<p>正文</p>",
						notice_id: noticeId,
						notice_release_time: "2026-04-02 18:49",
					},
				},
				state: true,
			}),
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
			fetchNoticePage: async () => ({
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
					],
				},
				state: true,
			}),
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 1,
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.stats.attachmentObjectsUploaded).toBe(1);
		expect(result.exportManifest.collector).toEqual({
			attachment_collection_mode: "detail_api_and_html_materialized",
			attachment_storage_mode: "object_store_write",
			export_contract_version: "authenticated_notice_collector_export_v2",
			link_collection_mode: "html_reference_only",
			runtime_shell: "repo_local_node",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-rag-source",
			byte_size: 5,
			ingest_status: "uploaded",
			mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			object_key:
				"authenticated_notice_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/application.docx",
			original_filename: "application.docx",
			provenance_status: "collected_internal",
			sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				key: "authenticated_notice_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/application.docx",
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				data: "hello",
				metadata: {
					"content-sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				},
			},
		]);
	});

	it("prefers detail attachment names and infers MIME when download headers are mojibake and generic", async () => {
		const storedObjects: Array<{
			key: string;
			contentType: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				putObject: async ({ objectKey, contentType, metadata }) => {
					storedObjects.push({
						key: objectKey,
						contentType,
						metadata,
					});
					return {
						bucket: "campus-rag-source",
						objectKey,
						contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
						byteSize: 5,
						etag: '"etag-1"',
						versionId: null,
					};
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from("hello"),
					headers: () => ({
						"content-disposition": 'attachment;filename="çº¿ä¸éç¹å®£ä¼ æè²æ´»å¨ååä¸æ¹å¼.docx"',
						"content-type": "application/octet-stream;charset=utf-8",
					}),
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
						home_url: "https://portal.example.edu/home",
						notice_annext: [
							{
								notice_annex_id: "annex-1",
								notice_annex_name: "线上重点宣传教育活动及参与方式.docx",
							},
						],
						notice_content: "<p>正文</p>",
						notice_id: noticeId,
						notice_release_time: "2026-04-02 18:49",
					},
				},
				state: true,
			}),
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
			fetchNoticePage: async () => ({
				datas: {
					page: {
						totalCounts: 1,
					},
					tables: [
						{
							notice_id: 355491,
							notice_title: "通知 A",
							notice_type: "5",
							notice_type_name: "办公通知",
						},
					],
				},
				state: true,
			}),
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 1,
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			original_filename: "线上重点宣传教育活动及参与方式.docx",
			object_key:
				"authenticated_notice_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/线上重点宣传教育活动及参与方式.docx",
		});
		expect(storedObjects).toEqual([
			{
				key: "authenticated_notice_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/线上重点宣传教育活动及参与方式.docx",
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				metadata: {
					"content-sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				},
			},
		]);
	});

	it("keeps the batch running when a single attachment download fails", async () => {
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				putObject: async () => {
					throw new Error("unexpected upload");
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => {
						throw new Error(
							"You did not provide the number of bytes specified by the Content-Length HTTP header.",
						);
					},
					headers: () => ({
						"content-disposition": "attachment; filename*=UTF-8''broken.pdf",
						"content-type": "application/pdf",
					}),
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
						home_url: "https://portal.example.edu/home",
						notice_annext: [
							{
								notice_annex_id: "annex-1",
								notice_annex_name: "broken.pdf",
							},
						],
						notice_content: "<p>正文</p>",
						notice_id: noticeId,
						notice_release_time: "2026-04-02 18:49",
					},
				},
				state: true,
			}),
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
			fetchNoticePage: async () => ({
				datas: {
					page: {
						totalCounts: 1,
					},
					tables: [
						{
							notice_id: 355600,
							notice_title: "通知 A",
							notice_type: "5",
							notice_type_name: "办公通知",
						},
					],
				},
				state: true,
			}),
			noticeTypes: [
				{
					type: "5",
					name: "办公通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 1,
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			storage_provider: "reference_only",
			object_key: null,
			original_filename: "broken.pdf",
			last_error:
				"You did not provide the number of bytes specified by the Content-Length HTTP header.",
			ingest_status: "reference_only",
		});
		expect(result.bundleRecords[0]?.links).toEqual([]);
	});

	it("skips terminal unavailable attachment downloads from the fetch-status ledger", async () => {
		let downloadCalls = 0;
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				putObject: async () => {
					throw new Error("unexpected upload");
				},
			},
			attachmentFetchStatusStore: {
				getTerminalUnavailable: async ({ attachmentRefId, noticeId, siteId, sourceUrl }) => {
					expect(siteId).toBe("muc_internal_portal");
					expect(noticeId).toBe("186977");
					expect(attachmentRefId).toBe("attachment-0001");
					expect(sourceUrl).toBe(
						"https://portal.example.edu/comsys-portal-notice-web/download?id=missing&notice_id=186977",
					);
					return {
						fetchStatus: "terminal_unavailable",
						lastError: "downloadAttachment failed: 404 ",
						lastHttpStatus: 404,
						terminalReason: "http_404",
					};
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => {
					downloadCalls += 1;
					throw new Error("download should be skipped");
				},
				post: async () => {
					throw new Error("unexpected post");
				},
			}),
			exportedAt: "2026-04-04T01:23:45.000Z",
			fetchNoticeDetail: async ({ noticeId }) => ({
				datas: {
					notice_info: {
						home_url: "https://portal.example.edu/home",
						notice_annext: [
							{
								notice_annex_id: "missing",
								notice_annex_name: "missing.pdf",
							},
						],
						notice_content: "<p>正文</p>",
						notice_id: noticeId,
						notice_release_time: "2021-01-05 19:02",
						notice_title: "药学院2021年硕博连读博士研究生招生实施细则",
					},
				},
				state: true,
			}),
			fetchNoticeSelects: async () => ({
				datas: {
					org: [],
					type: [
						{
							notice_type_id: 6,
							notice_type_name: "教学通知",
						},
					],
				},
				state: true,
			}),
			fetchNoticePage: async () => {
				throw new Error("unexpected page fetch");
			},
			noticeTypes: [
				{
					type: "6",
					name: "教学通知",
					enabled: true,
					incrementalPages: 1,
					incrementalPageSize: 1,
					backfillPages: 1,
					backfillPageSize: 20,
				},
			],
			requestBackoffBaseMs: 1,
			requestMaxRetries: 1,
			selectedNotices: [
				{
					noticeId: 186977,
					noticeType: "6",
					noticeTypeName: "教学通知",
				},
			],
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(downloadCalls).toBe(0);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			storage_provider: "reference_only",
			object_key: null,
			original_filename: "missing.pdf",
			last_error: "terminal_unavailable:http_404",
			ingest_status: "reference_only",
		});
	});
}
