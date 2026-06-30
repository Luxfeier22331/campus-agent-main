import { describe, expect, it, vi } from "vitest";

import {
	buildFileReleasePageRequest,
	buildFileReleaseTypesRequest,
	runFileReleaseCrawleeCollection,
} from "../src/file-release-crawlee-runner.js";

describe("authenticated notice file-release Crawlee runner", () => {
	it("builds stable file-release Crawlee request identities", () => {
		expect(buildFileReleaseTypesRequest({ siteId: "muc_internal_portal" })).toMatchObject({
			label: "types",
			method: "POST",
			uniqueKey: "file_release_types:muc_internal_portal",
			url: "https://collector.local/authenticated-notice/file-release/types",
			userData: { type: "types" },
		});
		expect(
			buildFileReleasePageRequest({
				currentPage: 2,
				pageSize: 20,
				siteId: "muc_internal_portal",
			}),
		).toMatchObject({
			label: "page",
			method: "POST",
			uniqueKey: "file_release_page:muc_internal_portal:2:20",
			url: "https://collector.local/authenticated-notice/file-release/page",
			userData: {
				currentPage: 2,
				pageSize: 20,
				type: "page",
			},
		});
	});

	it("walks type, page, detail, and download-url requests through the Crawlee graph", async () => {
		const handledKeys: string[] = [];
		const fetchFileReleaseTypes = vi.fn(async () => ({
			state: true,
			data: [{ id: 7, typename: "制度文件", sort: 1 }],
		}));
		const fetchFileReleaseCodeTypes = vi.fn(async () => ({
			state: true,
			data: [{ id: 8, name: "校发", sort: 2 }],
		}));
		const fetchFileReleaseExplainDepartments = vi.fn(async () => ({
			state: true,
			data: [{ ORGANIZATION_NAME: "教务处" }],
		}));
		const fetchFileReleasePage = vi.fn(async () => ({
			state: true,
			size: 2,
			dws: [{ filedepartment: "教务处" }],
			data: [
				{
					id: 646,
					filename: "制度-646",
					filedepartment: "教务处",
					typename: "制度文件",
				},
				{
					id: 646,
					filename: "制度-646-重复",
					filedepartment: "教务处",
					typename: "制度文件",
				},
			],
		}));
		const fetchFileReleaseDetail = vi.fn(async ({ fileReleaseId }) => ({
			id: fileReleaseId,
			filename: `制度-${fileReleaseId}`,
			filedepartment: "教务处",
			filetypeid: 7,
			upfilename: `制度-${fileReleaseId}.pdf`,
		}));
		const fetchFileReleaseDownloadUrl = vi.fn(async ({ fileReleaseId }) => ({
			state: true,
			url: `https://portal.example.edu/file/${fileReleaseId}.pdf`,
		}));

		const result = await runFileReleaseCrawleeCollection({
			apiContext: {
				get: async () => {
					throw new Error("unexpected get");
				},
				post: async () => {
					throw new Error("unexpected post");
				},
			},
			crawlerFactory: ({ maxRequestRetries, requestHandler }) => ({
				run: async (requests) => {
					expect(maxRequestRetries).toBe(2);
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
								userData: request.userData,
							},
						});
						index += 1;
					}
				},
			}),
			exportedAt: "2026-04-27T08:00:00.000Z",
			fetchFileReleaseCodeTypes,
			fetchFileReleaseDetail,
			fetchFileReleaseDownloadUrl,
			fetchFileReleaseExplainDepartments,
			fetchFileReleasePage,
			fetchFileReleaseTypes,
			maxFileReleases: null,
			maxPages: 1,
			pageSize: 20,
			requestMaxRetries: 2,
			siteId: "muc_internal_portal",
			targetFileReleaseId: null,
		});

		expect(handledKeys).toEqual([
			"file_release_types:muc_internal_portal",
			"file_release_page:muc_internal_portal:1:20",
			"file_release_detail:muc_internal_portal:646",
			"file_release_download_url:muc_internal_portal:646",
		]);
		expect(fetchFileReleaseTypes).toHaveBeenCalledTimes(1);
		expect(fetchFileReleaseCodeTypes).toHaveBeenCalledTimes(1);
		expect(fetchFileReleaseExplainDepartments).toHaveBeenCalledTimes(1);
		expect(fetchFileReleasePage).toHaveBeenCalledWith(
			expect.objectContaining({ currentPage: 1, pageSize: 20 }),
		);
		expect(fetchFileReleaseDetail).toHaveBeenCalledWith(
			expect.objectContaining({ fileReleaseId: 646 }),
		);
		expect(fetchFileReleaseDownloadUrl).toHaveBeenCalledWith(
			expect.objectContaining({ fileReleaseId: 646 }),
		);
		expect(result).toMatchObject({
			observedDepartments: ["教务处"],
			observedExplainDepartments: ["教务处"],
			observedFileCodeTypes: [{ id: 8, name: "校发", sort: 2 }],
			observedFileTypes: [{ id: 7, typename: "制度文件", sort: 1 }],
			stats: {
				detailFetched: 1,
				fileUrlsResolved: 1,
				itemsSeen: 2,
				pagesFetched: 1,
			},
		});
		expect(result.collectedReleases).toEqual([
			expect.objectContaining({
				downloadUrl: "https://portal.example.edu/file/646.pdf",
				fileReleaseId: 646,
			}),
		]);
	});
});
