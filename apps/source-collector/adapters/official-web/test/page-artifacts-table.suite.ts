import { expect, it } from "vitest";

import {
	buildContentSiteArtifactsForTest,
	SAMPLE_DISCLOSURE_TABLE_PAGE_HTML,
	SAMPLE_GALLERY_TABLE_PAGE_HTML,
} from "./page-artifacts-test-support";

export function registerPageArtifactsTableSuite() {
	it("keeps disclosure-style data tables as main content when they are not listing tables", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_015",
			requestedUrl: "https://www.example.edu/xxgk.htm",
			finalUrl: "https://www.example.edu/xxgk.htm",
			responseBody: SAMPLE_DISCLOSURE_TABLE_PAGE_HTML,
			fetchedAt: "2026-03-29T09:02:00.000Z",
		});

		const tableBlock = pageArtifacts.contentBlocks.find(
			(item) =>
				item.blockRole === "table" &&
				(item.textNormalized ?? "").includes("招生政策") &&
				(item.textNormalized ?? "").includes("学位授予办法"),
		);

		expect(tableBlock?.isMainContent).toBe(true);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("data_table_page");
		expect(pageArtifacts.providerExtraction.pageSignals.listingTableCount).toBe(0);
	}, 15_000);

	it("demotes gallery-style layout tables while keeping image-card links as main content", () => {
		const pageArtifacts = buildContentSiteArtifactsForTest({
			crawlRunId: "owrun_test_016",
			requestedUrl: "https://www.example.edu/gallery.htm",
			finalUrl: "https://www.example.edu/gallery.htm",
			responseBody: SAMPLE_GALLERY_TABLE_PAGE_HTML,
			fetchedAt: "2026-03-29T09:03:00.000Z",
		});

		const mainTables = pageArtifacts.contentBlocks.filter(
			(item) => item.blockRole === "table" && item.isMainContent,
		);
		const contentLinks = pageArtifacts.contentBlocks.filter(
			(item) => item.blockRole === "link" && item.isMainContent,
		);

		expect(mainTables).toHaveLength(0);
		expect(pageArtifacts.pageManifest.pageFamily).toBe("gallery_page");
		expect(pageArtifacts.providerExtraction.pageSignals.galleryTableCount).toBeGreaterThanOrEqual(
			1,
		);
		expect(contentLinks.map((item) => item.textNormalized)).toEqual(
			expect.arrayContaining(["李剑老师团队在少数民族地区调研", "崔玲玲老师在做田野调查"]),
		);
	});
}
