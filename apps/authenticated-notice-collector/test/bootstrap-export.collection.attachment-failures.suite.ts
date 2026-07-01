import { expect, it } from "vitest";

import { collectBootstrapBundle } from "../src/bootstrap-export.js";

export function registerBootstrapExportCollectionAttachmentFailureSuite(): void {
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
						bucket: "campus-agent-source",
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
			siteId: "example_internal_portal",
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
	it("fails closed when a required attachment download has a transient failure", async () => {
		await expect(
			collectBootstrapBundle({
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
				siteId: "example_internal_portal",
				sourceHomeUrl: "https://portal.example.edu/home",
			}),
		).rejects.toThrow("attachment_materialization_failed:notice=355600:attachment=attachment-0001");
	});
	it("records first observed 404 attachment downloads as typed terminal unavailable", async () => {
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
					noticeId: "186978",
				},
			],
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from("missing"),
					headers: () => ({}),
					json: async () => ({}),
					ok: () => false,
					status: () => 404,
					statusText: () => "Not Found",
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
								notice_annex_id: "missing",
								notice_annex_name: "missing.pdf",
							},
						],
						notice_content: "<p>正文</p>",
						notice_id: noticeId,
						notice_release_time: "2021-01-05 19:02",
						notice_title: "附件缺失通知",
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
					noticeId: 186978,
					noticeType: "6",
					noticeTypeName: "教学通知",
				},
			],
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			storage_provider: "reference_only",
			object_key: null,
			original_filename: "missing.pdf",
			last_error: "terminal_unavailable:http_404",
			ingest_status: "terminal_unavailable",
			provenance_status: "terminal_unavailable",
			terminal_reason: "http_404",
			last_http_status: 404,
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
					expect(siteId).toBe("example_internal_portal");
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
						notice_title: "甲学院2021年硕博连读博士研究生招生实施细则",
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
			siteId: "example_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		expect(downloadCalls).toBe(0);
		expect(result.stats.attachmentObjectsUploaded).toBe(0);
		expect(result.bundleRecords[0]?.attachments[0]).toMatchObject({
			storage_provider: "reference_only",
			object_key: null,
			original_filename: "missing.pdf",
			last_error: "terminal_unavailable:http_404",
			ingest_status: "terminal_unavailable",
			provenance_status: "terminal_unavailable",
			terminal_reason: "http_404",
		});
	});
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
