import { afterEach, expect, it, vi } from "vitest";

import {
	collectBootstrapBundle,
	parseAttachmentFetchAdmissionsFromManifest,
} from "../src/bootstrap-export";

export function registerBootstrapExportCollectionAttachmentsSuite(): void {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scans only enabled notice types while snapshotting the full configured policy", async () => {
		const pageCalls: string[] = [];
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
			fetchNoticeSelects: async () => ({
				datas: {
					org: [],
					type: [
						{
							notice_type_id: 5,
							notice_type_name: "办公通知",
						},
						{
							notice_type_id: 10,
							notice_type_name: "就业信息",
						},
					],
				},
				state: true,
			}),
			fetchNoticePage: async ({ noticeType }) => {
				pageCalls.push(noticeType);
				return {
					datas: {
						page: {
							totalCounts: 1,
						},
						tables: [
							{
								notice_id: 355119,
								notice_title: "通知 A",
								notice_type: noticeType,
								notice_type_name: noticeType === "5" ? "办公通知" : "就业信息",
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
				{
					type: "10",
					name: "就业信息",
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
		});

		expect(pageCalls).toEqual(["5"]);
		expect(result.exportManifest.filters.notice_types).toEqual(["5"]);
		expect(result.exportManifest.notice_type_policy).toEqual([
			{
				backfill: {
					page_size: 20,
					pages: 1,
				},
				enabled: true,
				incremental: {
					page_size: 20,
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
				enabled: false,
				incremental: {
					page_size: 20,
					pages: 1,
				},
				name: "就业信息",
				type: "10",
			},
		]);
	});
	it("parses attachment fetch request manifests into collector admissions", () => {
		const admissions = parseAttachmentFetchAdmissionsFromManifest({
			requests: [
				{
					attachment_capture_policy: "metadata_only",
					attachment_ref_id: "attachment-0001",
					notice_id: "355929",
				},
				{
					collector_admission: {
						attachmentCapturePolicy: "fetch_to_quarantine",
						attachmentRefId: "attachment-0002",
						noticeId: "355867",
					},
				},
				{
					attachment_capture_policy: "fetch_required_for_source_truth",
					attachment_ref_id: "attachment-0003",
					notice_id: "646",
				},
			],
		});

		expect(admissions).toEqual([
			{
				attachmentCapturePolicy: "fetch_to_quarantine",
				attachmentRefId: "attachment-0002",
				noticeId: "355867",
			},
			{
				attachmentCapturePolicy: "fetch_required_for_source_truth",
				attachmentRefId: "attachment-0003",
				noticeId: "646",
			},
		]);
	});
	it("keeps internal attachments reference-only by default even when an artifact store is configured", async () => {
		let downloadCalls = 0;
		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
					body: async () => {
						downloadCalls += 1;
						return Buffer.from("hello");
					},
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

		expect(downloadCalls).toBe(0);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.exportManifest.collector).toEqual({
			attachment_collection_mode: "detail_api_and_html_reference_only",
			attachment_storage_mode: "reference_only",
			export_contract_version: "authenticated_notice_collector_export_v2",
			link_collection_mode: "html_reference_only",
			runtime_shell: "repo_local_node",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: null,
			byte_size: null,
			ingest_status: "reference_only",
			mime_type: null,
			object_key: null,
			original_filename: "application.docx",
			provenance_status: "reference_only",
			sha256: null,
			storage_provider: "reference_only",
		});
		expect(storedObjects).toEqual([]);
	});

	it("materializes admitted internal attachments into object-backed bundle rows", async () => {
		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_required_for_admitted_owner",
					attachmentRefId: "attachment-0001",
					noticeId: "355119",
				},
			],
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

	it("materializes responsive inline image refs into object-backed bundle rows", async () => {
		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
						contentSha256: "d87f7e0c1f261e2237e6f9f43e927d2d00f455e387f8a0b0165ee25c526fe6d3",
						byteSize: data.byteLength,
						etag: '"etag-image"',
						versionId: null,
					};
				},
			},
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_to_quarantine",
					attachmentRefId: "attachment-0001",
					noticeId: "355120",
				},
			],
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from("image-bytes"),
					headers: () => ({
						"content-type": "application/octet-stream",
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
						notice_content: '<picture><source srcset="/upload/source.webp 1x"></picture>',
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
							notice_id: 355120,
							notice_title: "通知 B",
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
		expect(result.bundleRecords[0]?.links[0]).toMatchObject({
			content_kind: "inline_image",
			content_type: "image/webp",
			downloaded: true,
			final_url: "https://portal.example.edu/upload/source.webp",
		});
		expect(result.bundleRecords[0]?.notice_attachments[0]).toMatchObject({
			resource_role: "inline_image",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-rag-source",
			byte_size: 11,
			ingest_status: "uploaded",
			mime_type: "image/webp",
			original_filename: "source.webp",
			provenance_status: "collected_internal",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				key: "authenticated_notice_portal/attachment-2c8648d103e3/2026/sha256/2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c/capture/source.webp",
				contentType: "image/webp",
				data: "image-bytes",
				metadata: {
					"content-sha256": "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
				},
			},
		]);
	});

	it("keeps external inline image refs reference-only by default", async () => {
		const externalFetch = vi.fn(async () => {
			throw new Error("external fetch should not be called without admission");
		});
		vi.stubGlobal("fetch", externalFetch);

		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
						contentSha256: "a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d",
						byteSize: data.byteLength,
						etag: '"etag-external-image"',
						versionId: null,
					};
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => {
					throw new Error("portal API context must not fetch external inline images");
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
						notice_content: [
							'<img alt="论文截图" data-src="https://mmbiz.qpic.cn/mmbiz_jpg/VSYicAPlaX6z95r71Jfu4l5vJAfQcSmvQ/640?wx_fmt=jpeg&amp;from=appmsg">',
							'<img alt="其他外链图" src="https://cdn.example.org/image.jpg">',
						].join(""),
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
							notice_type_id: 9980,
							notice_type_name: "综合新闻",
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
							notice_id: 351117,
							notice_title: "通知 C",
							notice_type: "9980",
							notice_type_name: "综合新闻",
						},
					],
				},
				state: true,
			}),
			noticeTypes: [
				{
					type: "9980",
					name: "综合新闻",
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

		expect(externalFetch).not.toHaveBeenCalled();
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.exportManifest.collector).toMatchObject({
			attachment_collection_mode: "detail_api_and_html_reference_only",
			attachment_storage_mode: "reference_only",
		});
		expect(result.bundleRecords[0]?.links).toHaveLength(2);
		expect(result.bundleRecords[0]?.attachments).toHaveLength(2);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			ingest_status: "reference_only",
			object_key: null,
			origin_host: "mmbiz.qpic.cn",
			origin_scope: "external",
			storage_provider: "reference_only",
		});
		expect(storedObjects).toEqual([]);
	});

	it("materializes admitted allowlisted external inline image refs without using the portal API context", async () => {
		const externalFetch = vi.fn(
			async () =>
				new Response(Buffer.from("wechat-image"), {
					headers: {
						"content-type": "image/jpeg; charset=binary",
					},
					status: 200,
					statusText: "OK",
				}),
		);
		vi.stubGlobal("fetch", externalFetch);

		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectBootstrapBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
						contentSha256: "a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d",
						byteSize: data.byteLength,
						etag: '"etag-external-image"',
						versionId: null,
					};
				},
			},
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_to_quarantine",
					attachmentRefId: "attachment-0001",
					noticeId: "351117",
				},
			],
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => {
					throw new Error("portal API context must not fetch external inline images");
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
						notice_content: [
							'<img alt="论文截图" data-src="https://mmbiz.qpic.cn/mmbiz_jpg/VSYicAPlaX6z95r71Jfu4l5vJAfQcSmvQ/640?wx_fmt=jpeg&amp;from=appmsg">',
							'<img alt="其他外链图" src="https://cdn.example.org/image.jpg">',
						].join(""),
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
							notice_type_id: 9980,
							notice_type_name: "综合新闻",
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
							notice_id: 351117,
							notice_title: "通知 C",
							notice_type: "9980",
							notice_type_name: "综合新闻",
						},
					],
				},
				state: true,
			}),
			noticeTypes: [
				{
					type: "9980",
					name: "综合新闻",
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

		expect(externalFetch).toHaveBeenCalledTimes(1);
		expect(externalFetch).toHaveBeenCalledWith(
			"https://mmbiz.qpic.cn/mmbiz_jpg/VSYicAPlaX6z95r71Jfu4l5vJAfQcSmvQ/640?wx_fmt=jpeg&from=appmsg",
			expect.objectContaining({
				redirect: "follow",
			}),
		);
		expect(result.stats.attachmentObjectsUploaded).toBe(1);
		expect(result.bundleRecords[0]?.links).toHaveLength(2);
		expect(result.bundleRecords[0]?.links[0]).toMatchObject({
			content_kind: "inline_image",
			content_type: "image/jpeg",
			downloaded: true,
			file_size: 12,
			link_host: "mmbiz.qpic.cn",
			link_scope: "external",
		});
		expect(result.bundleRecords[0]?.links[1]).toMatchObject({
			content_kind: "inline_image",
			content_type: null,
			downloaded: false,
			link_host: "cdn.example.org",
			link_scope: "external",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-rag-source",
			byte_size: 12,
			ingest_status: "uploaded",
			mime_type: "image/jpeg",
			object_key:
				"authenticated_notice_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
			origin_host: "mmbiz.qpic.cn",
			origin_scope: "external",
			original_filename: "论文截图.jpg",
			provenance_status: "collected_internal",
			storage_provider: "object_store",
		});
		expect(result.bundleRecords[0]?.attachments[1]).toMatchObject({
			ingest_status: "reference_only",
			object_key: null,
			origin_host: "cdn.example.org",
			origin_scope: "external",
			storage_provider: "reference_only",
		});
		expect(storedObjects).toEqual([
			{
				key: "authenticated_notice_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
				contentType: "image/jpeg",
				data: "wechat-image",
				metadata: {
					"content-sha256": "a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d",
					"origin-host": "mmbiz.qpic.cn",
					"origin-scope": "external",
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
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
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
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_required_for_admitted_owner",
					attachmentRefId: "attachment-0001",
					noticeId: "355491",
				},
			],
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
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				putObject: async () => {
					throw new Error("unexpected upload");
				},
			},
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_to_quarantine",
					attachmentRefId: "attachment-0001",
					noticeId: "355600",
				},
			],
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
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				putObject: async () => {
					throw new Error("unexpected upload");
				},
			},
			attachmentFetchAdmissions: [
				{
					attachmentCapturePolicy: "fetch_required_for_source_truth",
					attachmentRefId: "attachment-0001",
					noticeId: "186977",
				},
			],
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

function fakeArtifactHead(objectKey: string) {
	return {
		bucket: "campus-rag-source",
		objectKey,
		contentSha256: null,
		byteSize: null,
		etag: null,
		versionId: null,
	};
}
