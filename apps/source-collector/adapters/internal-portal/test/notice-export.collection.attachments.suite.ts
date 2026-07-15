import { afterEach, expect, it, vi } from "vitest";

import {
	collectNoticeExportBundle,
	parseAttachmentFetchAdmissionsFromManifest,
} from "../src/notice-export.js";
import { registerNoticeExportCollectionInlineVisualsSuite } from "./notice-export.collection.inline-visuals.suite.js";

export function registerNoticeExportCollectionAttachmentsSuite(): void {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scans only enabled notice types while snapshotting the full configured policy", async () => {
		const pageCalls: string[] = [];
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
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
					capture_runtime_admission: {
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
		const result = await collectNoticeExportBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({
						key: objectKey,
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						metadata,
					});
					return {
						bucket: "campus-agent-source",
						objectKey,
						contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
						byteSize: data.byteLength,
						etag: '"etag-1"',
						versionId: null,
					};
				},
			},
			defaultInlineVisualCapture: true,
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(downloadCalls).toBe(0);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.exportManifest.capture_runtime).toEqual({
			attachment_collection_mode: "detail_api_and_html_reference_only",
			attachment_storage_mode: "reference_only",
			export_contract_version: "internal_portal_notice_export_v1",
			link_collection_mode: "html_reference_only",
			runtime_shell: "source_collector_node",
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

	it("materializes internal inline image refs when visual capture is explicitly enabled", async () => {
		const storedObjects: Array<{
			key: string;
			contentType: string;
			data: string;
			metadata: Record<string, string> | undefined;
		}> = [];
		const result = await collectNoticeExportBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({
						key: objectKey,
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						metadata,
					});
					return {
						bucket: "campus-agent-source",
						objectKey,
						contentSha256: "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
						byteSize: data.byteLength,
						etag: '"etag-image"',
						versionId: null,
					};
				},
			},
			defaultInlineVisualCapture: true,
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
						notice_content: '<p><img src="/upload/schedule.png" alt="班车时刻表"></p>',
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.stats.attachmentObjectsUploaded).toBe(1);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-agent-source",
			byte_size: 11,
			ingest_status: "uploaded",
			mime_type: "image/png",
			original_filename: "schedule.png",
			provenance_status: "collected_internal",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				key: "internal_portal/attachment-2c8648d103e3/2026/sha256/2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c/capture/schedule.png",
				contentType: "image/png",
				data: "image-bytes",
				metadata: {
					"content-sha256": "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
				},
			},
		]);
	});

	it("keeps inline image refs reference-only unless visual capture is explicitly enabled", async () => {
		let downloadCalls = 0;
		const storedObjects: unknown[] = [];
		const result = await collectNoticeExportBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({ objectKey, data, contentType, metadata });
					throw new Error("inline image should not be stored when capture is disabled");
				},
			},
			defaultInlineVisualCapture: false,
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => {
					downloadCalls += 1;
					return {
						body: async () => Buffer.from("image-bytes"),
						headers: () => ({
							"content-type": "image/png",
						}),
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					};
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
						notice_content: '<p><img src="/upload/schedule.png" alt="班车时刻表"></p>',
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(downloadCalls).toBe(0);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			ingest_status: "reference_only",
			object_key: null,
			storage_provider: "reference_only",
		});
		expect(storedObjects).toEqual([]);
	});

	it("does not store non-visual bytes from default inline visual capture", async () => {
		let downloadCalls = 0;
		const storedObjects: unknown[] = [];
		const result = await collectNoticeExportBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({ objectKey, data, contentType, metadata });
					throw new Error("non-visual inline bytes should not be stored by default capture");
				},
			},
			defaultInlineVisualCapture: true,
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => {
					downloadCalls += 1;
					return {
						body: async () => Buffer.from("%PDF-1.7"),
						headers: () => ({
							"content-type": "application/pdf",
						}),
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					};
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
						notice_content: '<p><img src="/upload/not-image.pdf" alt="伪装图片"></p>',
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
							notice_id: 355121,
							notice_title: "通知 C",
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(downloadCalls).toBe(1);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.links[0]).toMatchObject({
			content_type: "application/pdf",
			downloaded: false,
			file_size: 8,
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			ingest_status: "reference_only",
			object_key: null,
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
		const result = await collectNoticeExportBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				createOrVerifyObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({
						key: objectKey,
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						metadata,
					});
					return {
						bucket: "campus-agent-source",
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.stats.attachmentObjectsUploaded).toBe(1);
		expect(result.exportManifest.capture_runtime).toEqual({
			attachment_collection_mode: "detail_api_and_html_materialized",
			attachment_storage_mode: "object_store_write",
			export_contract_version: "internal_portal_notice_export_v1",
			link_collection_mode: "html_reference_only",
			runtime_shell: "source_collector_node",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-agent-source",
			byte_size: 5,
			ingest_status: "uploaded",
			mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			object_key:
				"internal_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/application.docx",
			original_filename: "application.docx",
			provenance_status: "collected_internal",
			sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				key: "internal_portal/attachment-2cf24dba5fb0/2026/sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/application.docx",
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				data: "hello",
				metadata: {
					"content-sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				},
			},
		]);
	});

	registerNoticeExportCollectionInlineVisualsSuite();
}

function fakeArtifactHead(objectKey: string) {
	return {
		bucket: "campus-agent-source",
		objectKey,
		contentSha256: null,
		byteSize: null,
		etag: null,
		versionId: null,
	};
}
