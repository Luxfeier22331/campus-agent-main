import { expect, it, vi } from "vitest";

import type { ExternalVisualFetcher } from "../src/attachment-crawlee-runner.js";
import { collectNoticeExportBundle } from "../src/notice-export.js";

export function registerNoticeExportCollectionInlineVisualsSuite(): void {
	it("materializes responsive inline image refs into object-backed bundle rows", async () => {
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
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
			bucket: "campus-agent-source",
			byte_size: 11,
			ingest_status: "uploaded",
			mime_type: "image/webp",
			original_filename: "source.webp",
			provenance_status: "collected_internal",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				key: "internal_portal/attachment-2c8648d103e3/2026/sha256/2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c/capture/source.webp",
				contentType: "image/webp",
				data: "image-bytes",
				metadata: {
					"content-sha256": "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
				},
			},
		]);
	});

	it("materializes allowlisted external inline image refs when visual capture is explicitly enabled", async () => {
		const sendRequest = vi.fn(async (input: { responseType: "buffer"; url: string }) => ({
			body: Buffer.from(input.url.includes("mmbiz.qpic.cn") ? "wechat-image" : "other"),
			headers: {
				"content-type": "image/jpeg; charset=binary",
			},
			statusCode: 200,
		}));

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
						contentSha256: "a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d",
						byteSize: data.byteLength,
						etag: '"etag-external-image"',
						versionId: null,
					};
				},
			},
			externalVisualFetcher: createExternalVisualFetcher(sendRequest),
			defaultInlineVisualCapture: true,
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(sendRequest).toHaveBeenCalledTimes(1);
		expect(sendRequest).toHaveBeenCalledWith({
			responseType: "buffer",
			url: "https://mmbiz.qpic.cn/mmbiz_jpg/VSYicAPlaX6z95r71Jfu4l5vJAfQcSmvQ/640?wx_fmt=jpeg&from=appmsg",
		});
		expect(result.stats.attachmentObjectsUploaded).toBe(1);
		expect(result.exportManifest.capture_runtime).toMatchObject({
			attachment_collection_mode: "detail_api_and_html_materialized",
			attachment_storage_mode: "object_store_write",
		});
		expect(result.bundleRecords[0]?.links).toHaveLength(2);
		expect(result.bundleRecords[0]?.attachments).toHaveLength(2);
		expect(result.bundleRecords[0]?.links[0]).toMatchObject({
			content_kind: "inline_image",
			content_type: "image/jpeg",
			downloaded: true,
			file_size: 12,
			link_host: "mmbiz.qpic.cn",
			link_scope: "external",
		});
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			bucket: "campus-agent-source",
			byte_size: 12,
			ingest_status: "uploaded",
			mime_type: "image/jpeg",
			object_key:
				"internal_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
			origin_host: "mmbiz.qpic.cn",
			origin_scope: "external",
			storage_provider: "object_store",
		});
		expect(result.bundleRecords[0]?.links[1]).toMatchObject({
			content_kind: "inline_image",
			content_type: null,
			downloaded: false,
			link_host: "cdn.example.org",
			link_scope: "external",
		});
		expect(storedObjects).toEqual([
			{
				key: "internal_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
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

	it("materializes admitted allowlisted external inline image refs without using the portal API context", async () => {
		const sendRequest = vi.fn(async () => ({
			body: Buffer.from("wechat-image"),
			headers: {
				"content-type": "image/jpeg; charset=binary",
			},
			statusCode: 200,
		}));

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
						contentSha256: "a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d",
						byteSize: data.byteLength,
						etag: '"etag-external-image"',
						versionId: null,
					};
				},
			},
			externalVisualFetcher: createExternalVisualFetcher(sendRequest),
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
			requestMaxRetries: 1,
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(sendRequest).toHaveBeenCalledTimes(1);
		expect(sendRequest).toHaveBeenCalledWith({
			responseType: "buffer",
			url: "https://mmbiz.qpic.cn/mmbiz_jpg/VSYicAPlaX6z95r71Jfu4l5vJAfQcSmvQ/640?wx_fmt=jpeg&from=appmsg",
		});
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
			bucket: "campus-agent-source",
			byte_size: 12,
			ingest_status: "uploaded",
			mime_type: "image/jpeg",
			object_key:
				"internal_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
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
				key: "internal_portal/external-visual/mmbiz.qpic.cn/2026/sha256/a367921267a37b7c0916ab322ee72b9a9f15197d86dc4d648425b3f8f44ece5d/capture/论文截图.jpg",
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
}

function createExternalVisualFetcher(
	sendRequest: (input: { responseType: "buffer"; url: string }) => Promise<{
		body: Buffer;
		headers: Record<string, string>;
		statusCode: number;
	}>,
): ExternalVisualFetcher {
	return async ({ attachmentUrl }) => {
		const response = await sendRequest({ responseType: "buffer", url: attachmentUrl });
		return {
			body: response.body,
			contentDisposition: response.headers["content-disposition"] ?? null,
			contentType: response.headers["content-type"] ?? null,
			etag: response.headers.etag ?? null,
			statusCode: response.statusCode,
		};
	};
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
