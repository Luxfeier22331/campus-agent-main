import { describe, expect, it, vi } from "vitest";

import {
	buildFileReleasePageRequest,
	buildFileReleaseTypesRequest,
	runFileReleaseCrawleeCollection,
} from "../src/file-release-crawlee-runner.js";

describe("authenticated notice file-release Crawlee runner", () => {
	it("builds stable file-release Crawlee request identities", () => {
		expect(buildFileReleaseTypesRequest({ siteId: "synthetic_internal_portal" })).toMatchObject({
			label: "types",
			method: "POST",
			uniqueKey: "file_release_types:synthetic_internal_portal",
			url: "https://collector.local/authenticated-notice/file-release/types",
			userData: { type: "types" },
		});
		expect(
			buildFileReleasePageRequest({
				currentPage: 2,
				pageSize: 20,
				siteId: "synthetic_internal_portal",
			}),
		).toMatchObject({
			label: "page",
			method: "POST",
			uniqueKey: "file_release_page:synthetic_internal_portal:2:20",
			url: "https://collector.local/authenticated-notice/file-release/page",
			userData: {
				currentPage: 2,
				pageSize: 20,
				type: "page",
			},
		});
	});

	it("walks type, page, detail, and download-url requests through the Crawlee graph", async () => {
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
			siteId: "synthetic_internal_portal",
			targetFileReleaseId: null,
		});

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
