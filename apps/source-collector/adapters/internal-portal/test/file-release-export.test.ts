import { describe, expect, it } from "vitest";

import {
	buildFileReleaseRecord,
	collectFileReleaseBundle,
	resolveFileReleaseExportFiltersFromEnv,
	resolveFileReleaseFilename,
	resolveReleasedFileContentType,
} from "../src/file-release-export.js";

describe("internal portal source collector file release export", () => {
	it("resolves file release filenames and MIME types through standard header and MIME parsing", () => {
		expect(
			resolveFileReleaseFilename({
				contentDisposition:
					"attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%E4%B8%AD%E6%96%87.docx",
				sourceFilename: null,
				sourceUrl: "https://portal.example.edu/download?id=1",
			}),
		).toBe("中文.docx");
		expect(
			resolveFileReleaseFilename({
				contentDisposition: 'attachment; filename="unsafe/path.pdf"',
				sourceFilename: null,
				sourceUrl: "https://portal.example.edu/download?id=1",
			}),
		).toBe("path.pdf");
		expect(
			resolveReleasedFileContentType({
				contentType: "application/octet-stream;charset=utf-8",
				filename: "中文.docx",
			}),
		).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
		expect(
			resolveReleasedFileContentType({
				contentType: "application/vnd.ms-excel; charset=utf-8",
				filename: "report.bin",
			}),
		).toBe("application/vnd.ms-excel");
	});

	it("builds file release bundle records from page, detail, and resolved download payloads", () => {
		const record = buildFileReleaseRecord({
			detail: {
				detImportant: 1,
				explainDept: "教务处（考试中心、教师教学发展中心）",
				filecode: "民大校发〔2026〕39号",
				filedepartment: "教务处（考试中心、教师教学发展中心）",
				filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
				filetime: "2026-03-31 13:51:11",
				filetypeid: 18,
				fileurl: "/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
				id: 646,
				important: 12,
				role: 2,
				state: 1,
				upfilename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
			},
			downloadUrl: "/comsys-prompt-portlet-web/file/sample.pdf",
			fileTypeNameById: new Map([[18, "教学管理"]]),
			item: {
				filecode: "民大校发〔2026〕39号",
				filedepartment: "教务处（考试中心、教师教学发展中心）",
				filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
				filetime: "2026-03-31 13:51:11",
				id: 646,
				typename: "教学管理",
				user_name: "张老师",
			},
			observedAt: "2026-04-12T00:30:00.000Z",
			sourceHomeUrl: "https://portal.example.edu",
		});

		expect(record).toEqual({
			file_release: {
				det_important: 1,
				enrich_attempted_at: "2026-04-12T00:30:00.000Z",
				explain_department: "教务处（考试中心、教师教学发展中心）",
				file_type_id: 18,
				file_type_name: "教学管理",
				filecode: "民大校发〔2026〕39号",
				filedepartment: "教务处（考试中心、教师教学发展中心）",
				filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
				filetime: "2026-03-31 13:51:11",
				important: 12,
				last_seen_at: "2026-04-12T00:30:00.000Z",
				original_portal_file_url:
					"/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
				publisher_user_name: "张老师",
				resolved_download_url:
					"https://portal.example.edu/comsys-prompt-portlet-web/file/sample.pdf",
				role: 2,
				source_surface: "file_release",
				upfilename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
			},
			file_release_id: 646,
			released_file: {
				bucket: null,
				byte_size: null,
				created_at: "2026-04-12T00:30:00.000Z",
				downloaded_at: null,
				etag: null,
				final_url: "https://portal.example.edu/comsys-prompt-portlet-web/file/sample.pdf",
				ingest_status: "reference_only",
				last_error: null,
				local_path: null,
				mime_type: null,
				normalized_source_url:
					"https://portal.example.edu/comsys-prompt-portlet-web/file/sample.pdf",
				object_key: null,
				origin_host: "portal.example.edu",
				origin_scope: "internal",
				origin_url_scheme: "https",
				original_filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
				provenance_status: "reference_only",
				sha256: null,
				source_url: "https://portal.example.edu/comsys-prompt-portlet-web/file/sample.pdf",
				storage_provider: "reference_only",
				updated_at: "2026-04-12T00:30:00.000Z",
				uploaded_at: null,
				version_id: null,
			},
		});
	});

	it("collects file release pages into a deduplicated export bundle and disposes the api context", async () => {
		const detailCalls: number[] = [];
		const urlCalls: number[] = [];
		let disposed = false;

		const result = await collectFileReleaseBundle({
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
			exportedAt: "2026-04-12T00:30:00.000Z",
			fetchFileReleaseDetail: async ({ fileReleaseId }) => {
				detailCalls.push(fileReleaseId);
				return {
					filecode: `民大校发〔2026〕${fileReleaseId}号`,
					filedepartment: "教务处",
					filename: `制度 ${fileReleaseId}`,
					filetime: "2026-03-31 13:51:11",
					filetypeid: 18,
					fileurl: `/comsys/20181214/webapps/comsys-prompt-portlet-web/file/${fileReleaseId}.pdf`,
					id: fileReleaseId,
					state: 1,
					upfilename: `制度-${fileReleaseId}.pdf`,
				};
			},
			fetchFileReleaseDownloadUrl: async ({ fileReleaseId }) => {
				urlCalls.push(fileReleaseId);
				return {
					state: true,
					url: `/comsys-prompt-portlet-web/file/${fileReleaseId}.pdf`,
				};
			},
			fetchFileReleaseCodeTypes: async () => ({
				data: [
					{
						id: 2,
						name: "民大校发",
						sort: 2,
					},
				],
				state: true,
			}),
			fetchFileReleaseExplainDepartments: async () => ({
				data: [
					{
						ORGANIZATION_NAME: "教务处",
					},
				],
				state: true,
			}),
			fetchFileReleasePage: async ({ currentPage }) => {
				if (currentPage === 1) {
					return {
						data: [
							{
								filecode: "民大校发〔2026〕646号",
								filedepartment: "教务处",
								filename: "制度 646",
								filetime: "2026-03-31 13:51:11",
								id: 646,
								typename: "教学管理",
								user_name: "张老师",
							},
							{
								filecode: "民大校发〔2026〕647号",
								filedepartment: "教务处",
								filename: "制度 647",
								filetime: "2026-03-31 13:56:42",
								id: 647,
								typename: "教学管理",
								user_name: "张老师",
							},
						],
						dws: [{ filedepartment: "教务处" }],
						size: 3,
						state: true,
						sync: false,
					};
				}

				return {
					data: [
						{
							filecode: "民大校发〔2026〕646号",
							filedepartment: "教务处",
							filename: "制度 646",
							filetime: "2026-03-31 13:51:11",
							id: 646,
							typename: "教学管理",
							user_name: "张老师",
						},
					],
					dws: [{ filedepartment: "教务处" }],
					size: 3,
					state: true,
					sync: false,
				};
			},
			fetchFileReleaseTypes: async () => ({
				data: [
					{
						id: 18,
						sort: 3,
						typename: "教学管理",
					},
				],
				state: true,
			}),
			maxFileReleases: 2,
			pageSize: 2,
			requestMaxRetries: 1,
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu",
		});

		expect(disposed).toBe(true);
		expect(detailCalls).toEqual([646, 647]);
		expect(urlCalls).toEqual([646, 647]);
		expect(result.stats).toEqual({
			detailFetched: 2,
			fileUrlsResolved: 2,
			fileReleasesCollected: 2,
			fileObjectsUploaded: 0,
			pagesFetched: 1,
		});
		expect(result.exportManifest.observed_departments).toEqual(["教务处"]);
		expect(result.exportManifest.observed_file_types).toEqual([
			{
				id: 18,
				sort: 3,
				typename: "教学管理",
			},
		]);
		expect(result.exportManifest.observed_file_code_types).toEqual([
			{
				id: 2,
				name: "民大校发",
				sort: 2,
			},
		]);
		expect(result.exportManifest.observed_explain_departments).toEqual(["教务处"]);
		expect(result.bundleRecords.map((item) => item.file_release_id)).toEqual([646, 647]);
	});

	it("collects only the targeted file release when a target id is provided", async () => {
		const detailCalls: number[] = [];
		const urlCalls: number[] = [];

		const result = await collectFileReleaseBundle({
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
			exportedAt: "2026-04-12T00:30:00.000Z",
			fetchFileReleaseDetail: async ({ fileReleaseId }) => {
				detailCalls.push(fileReleaseId);
				return {
					filecode: `民大校发〔2026〕${fileReleaseId}号`,
					filedepartment: "教务处",
					filename: `制度 ${fileReleaseId}`,
					filetime: "2026-03-31 13:51:11",
					filetypeid: 18,
					fileurl: `/comsys/20181214/webapps/comsys-prompt-portlet-web/file/${fileReleaseId}.pdf`,
					id: fileReleaseId,
					state: 1,
					upfilename: `制度-${fileReleaseId}.pdf`,
				};
			},
			fetchFileReleaseDownloadUrl: async ({ fileReleaseId }) => {
				urlCalls.push(fileReleaseId);
				return {
					state: true,
					url: `/comsys-prompt-portlet-web/file/${fileReleaseId}.pdf`,
				};
			},
			fetchFileReleaseCodeTypes: async () => ({
				data: [
					{
						id: 2,
						name: "民大校发",
						sort: 2,
					},
				],
				state: true,
			}),
			fetchFileReleaseExplainDepartments: async () => ({
				data: [
					{
						ORGANIZATION_NAME: "教务处",
					},
				],
				state: true,
			}),
			fetchFileReleasePage: async ({ currentPage }) => {
				if (currentPage === 1) {
					return {
						data: [
							{
								filecode: "民大校发〔2026〕646号",
								filedepartment: "教务处",
								filename: "制度 646",
								filetime: "2026-03-31 13:51:11",
								id: 646,
								typename: "教学管理",
								user_name: "张老师",
							},
							{
								filecode: "民大校发〔2026〕647号",
								filedepartment: "教务处",
								filename: "制度 647",
								filetime: "2026-03-31 13:56:42",
								id: 647,
								typename: "教学管理",
								user_name: "张老师",
							},
						],
						dws: [{ filedepartment: "教务处" }],
						size: 3,
						state: true,
						sync: false,
					};
				}

				throw new Error("unexpected extra page fetch");
			},
			fetchFileReleaseTypes: async () => ({
				data: [
					{
						id: 18,
						sort: 3,
						typename: "教学管理",
					},
				],
				state: true,
			}),
			maxFileReleases: null,
			pageSize: 10,
			requestMaxRetries: 1,
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu",
			targetFileReleaseId: 647,
		});

		expect(detailCalls).toEqual([647]);
		expect(urlCalls).toEqual([647]);
		expect(result.bundleRecords.map((item) => item.file_release_id)).toEqual([647]);
		expect(result.exportManifest.export_scope).toBe("file-release-target-647-20260412T003000Z");
		expect(result.exportManifest.filters).toEqual({
			max_file_releases: null,
			max_pages: null,
			page_size: 10,
			target_file_release_id: 647,
		});
	});

	it("fails closed when a targeted file release id is not present in the traversed export scope", async () => {
		await expect(
			collectFileReleaseBundle({
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
				exportedAt: "2026-04-12T00:30:00.000Z",
				fetchFileReleaseDetail: async () => {
					throw new Error("unexpected detail fetch");
				},
				fetchFileReleaseDownloadUrl: async () => {
					throw new Error("unexpected url fetch");
				},
				fetchFileReleaseCodeTypes: async () => ({
					data: [],
					state: true,
				}),
				fetchFileReleaseExplainDepartments: async () => ({
					data: [],
					state: true,
				}),
				fetchFileReleasePage: async () => ({
					data: [
						{
							filecode: "民大校发〔2026〕646号",
							filedepartment: "教务处",
							filename: "制度 646",
							filetime: "2026-03-31 13:51:11",
							id: 646,
							typename: "教学管理",
							user_name: "张老师",
						},
					],
					dws: [{ filedepartment: "教务处" }],
					size: 1,
					state: true,
					sync: false,
				}),
				fetchFileReleaseTypes: async () => ({
					data: [
						{
							id: 18,
							sort: 3,
							typename: "教学管理",
						},
					],
					state: true,
				}),
				maxFileReleases: null,
				pageSize: 10,
				requestMaxRetries: 0,
				siteId: "synthetic_internal_portal",
				sourceHomeUrl: "https://portal.example.edu",
				targetFileReleaseId: 351119,
			}),
		).rejects.toThrow("target file_release_id 351119 was not found in file_release export scope");
	});

	it("parses targeted file release export filters from env", () => {
		expect(
			resolveFileReleaseExportFiltersFromEnv({
				INTERNAL_PORTAL_FILE_RELEASE_MAX_ITEMS: "5",
				INTERNAL_PORTAL_FILE_RELEASE_MAX_PAGES: "2",
				INTERNAL_PORTAL_FILE_RELEASE_PAGE_SIZE: "20",
				INTERNAL_PORTAL_FILE_RELEASE_TARGET_ID: "351119",
			}),
		).toEqual({
			maxFileReleases: 5,
			maxPages: 2,
			pageSize: 20,
			targetFileReleaseId: 351119,
		});
	});

	it("materializes released files into object-backed rows when an artifact store is configured", async () => {
		const storedObjects: Array<{
			contentType: string;
			data: string;
			key: string;
			metadata: Record<string, string> | undefined;
		}> = [];

		const result = await collectFileReleaseBundle({
			attachmentArtifactStore: {
				storageProvider: "object_store",
				headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
				putObject: async ({ objectKey, data, contentType, metadata }) => {
					storedObjects.push({
						contentType,
						data: Buffer.from(data).toString("utf-8"),
						key: objectKey,
						metadata,
					});
					return {
						bucket: "campus-agent-source",
						byteSize: data.byteLength,
						contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
						etag: '"etag-1"',
						objectKey,
						versionId: null,
					};
				},
			},
			createApiContext: async () => ({
				dispose: async () => undefined,
				get: async () => ({
					body: async () => Buffer.from("hello"),
					headers: () => ({
						"content-disposition": "attachment; filename*=UTF-8''sample.pdf",
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
			exportedAt: "2026-04-12T00:30:00.000Z",
			fetchFileReleaseDetail: async ({ fileReleaseId }) => ({
				filecode: "民大校发〔2026〕39号",
				filedepartment: "教务处",
				filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
				filetime: "2026-03-31 13:51:11",
				filetypeid: 18,
				fileurl: "/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
				id: fileReleaseId,
				state: 1,
				upfilename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
			}),
			fetchFileReleaseDownloadUrl: async () => ({
				state: true,
				url: "/comsys-prompt-portlet-web/file/sample.pdf",
			}),
			fetchFileReleaseCodeTypes: async () => ({
				data: [
					{
						id: 2,
						name: "民大校发",
						sort: 2,
					},
				],
				state: true,
			}),
			fetchFileReleaseExplainDepartments: async () => ({
				data: [
					{
						ORGANIZATION_NAME: "教务处",
					},
				],
				state: true,
			}),
			fetchFileReleasePage: async () => ({
				data: [
					{
						filecode: "民大校发〔2026〕39号",
						filedepartment: "教务处",
						filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
						filetime: "2026-03-31 13:51:11",
						id: 646,
						typename: "教学管理",
						user_name: "张老师",
					},
				],
				dws: [{ filedepartment: "教务处" }],
				size: 1,
				state: true,
				sync: false,
			}),
			fetchFileReleaseTypes: async () => ({
				data: [
					{
						id: 18,
						sort: 3,
						typename: "教学管理",
					},
				],
				state: true,
			}),
			pageSize: 10,
			requestMaxRetries: 1,
			siteId: "synthetic_internal_portal",
			sourceHomeUrl: "https://portal.example.edu",
		});

		expect(result.stats.fileObjectsUploaded).toBe(1);
		expect(result.bundleRecords[0]?.released_file).toMatchObject({
			bucket: "campus-agent-source",
			byte_size: 5,
			ingest_status: "uploaded",
			mime_type: "application/pdf",
			object_key:
				"internal_portal/file-release-646/2026/sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
			original_filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
			provenance_status: "collected_internal",
			sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			storage_provider: "object_store",
		});
		expect(storedObjects).toEqual([
			{
				contentType: "application/pdf",
				data: "hello",
				key: "internal_portal/file-release-646/2026/sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/capture/中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
				metadata: {
					"content-sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
					"source-surface": "file_release",
				},
			},
		]);
	});

	it("fails closed when object-backed file release download has a transient failure", async () => {
		await expect(
			collectFileReleaseBundle({
				attachmentArtifactStore: {
					storageProvider: "object_store",
					headObject: async ({ objectKey }) => fakeArtifactHead(objectKey),
					putObject: async () => {
						throw new Error("unexpected upload");
					},
				},
				createApiContext: async () => ({
					dispose: async () => undefined,
					get: async () => ({
						body: async () => {
							throw new Error("socket closed before file body completed");
						},
						headers: () => ({
							"content-disposition": "attachment; filename*=UTF-8''sample.pdf",
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
				exportedAt: "2026-04-12T00:30:00.000Z",
				fetchFileReleaseDetail: async ({ fileReleaseId }) => ({
					filecode: "民大校发〔2026〕39号",
					filedepartment: "教务处",
					filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
					filetime: "2026-03-31 13:51:11",
					filetypeid: 18,
					fileurl: "/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
					id: fileReleaseId,
					state: 1,
					upfilename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
				}),
				fetchFileReleaseDownloadUrl: async () => ({
					state: true,
					url: "/comsys-prompt-portlet-web/file/sample.pdf",
				}),
				fetchFileReleaseCodeTypes: async () => ({ data: [], state: true }),
				fetchFileReleaseExplainDepartments: async () => ({
					data: [],
					state: true,
				}),
				fetchFileReleasePage: async () => ({
					data: [
						{
							filecode: "民大校发〔2026〕39号",
							filedepartment: "教务处",
							filename: "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
							filetime: "2026-03-31 13:51:11",
							id: 646,
							typename: "教学管理",
							user_name: "张老师",
						},
					],
					dws: [],
					size: 1,
					state: true,
					sync: false,
				}),
				fetchFileReleaseTypes: async () => ({ data: [], state: true }),
				pageSize: 10,
				requestMaxRetries: 1,
				siteId: "synthetic_internal_portal",
				sourceHomeUrl: "https://portal.example.edu",
			}),
		).rejects.toThrow("file_release_materialization_failed:file_release=646");
	});
});

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
