import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
} from "../src/core/index.ts";
import { buildCollectedPageArtifacts } from "../src/page-artifacts";
import { buildCollectorQualityAudit } from "../src/quality-audit";
import {
	SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
	SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
	SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
	SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
	SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
	SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
	writeTestConfigRoot,
} from "./test-support";

describe("source-collector official-web adapter quality audit", () => {
	const SAMPLE_VISIBLE_PLACEHOLDER_MAIN_CONTENT_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>示例详情</title>
  </head>
  <body>
    <main>
      <h1>示例详情</h1>
      <p>暂无歌词...</p>
    </main>
  </body>
</html>
  `.trim();

	it("surfaces structural shell pages for manual review instead of passing them silently", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_001",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/training/undergraduate.htm",
			finalUrl: "https://www.example.edu/training/undergraduate.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_STRUCTURAL_SHELL_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "seed",
			discoveredFromUrl: null,
			fetchedAt: "2026-03-29T09:03:00.000Z",
			html: load(SAMPLE_STRUCTURAL_SHELL_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_001",
			pages: [pageArtifacts],
		});

		expect(audit.summary.familyCounts.structural_shell_page).toBe(1);
		expect(audit.pages[0]?.pageFamily).toBe("structural_shell_page");
		expect(audit.pages[0]?.status).toBe("review");
		expect(audit.pages[0]?.issues).toEqual([
			expect.objectContaining({
				code: "shell_family_requires_manual_review",
				severity: "review",
			}),
		]);
	});

	it("does not fail onclick-driven listing pages once main-content links are extracted", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_002",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "seed",
			discoveredFromUrl: null,
			fetchedAt: "2026-03-31T10:01:00.000Z",
			html: load(SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_002",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.pageFamily).toBe("listing_page");
		expect(audit.pages[0]?.status).toBe("pass");
		expect(audit.pages[0]?.issues).toEqual([]);
	});

	it("reports div-only visible-content pages as shell-review findings until primary extraction owns the pattern", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_003",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/rcpy.htm",
			finalUrl: "https://www.example.edu/rcpy.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "seed",
			discoveredFromUrl: null,
			fetchedAt: "2026-03-31T16:02:00.000Z",
			html: load(SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_003",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.pageFamily).toBe("dynamic_shell_page");
		expect(audit.pages[0]?.status).toBe("review");
		expect(audit.pages[0]?.issues).toEqual([
			expect.objectContaining({
				code: "shell_family_requires_manual_review",
				severity: "review",
			}),
		]);
	});

	it("flags thin engine2 detail pages for review when body content is incomplete", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_engine2_thin",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
			finalUrl: "https://www.example.edu/engine2/d/9285452/699558/0",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-04-01T09:10:00.000Z",
			html: load(SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_engine2_thin",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.status).toBe("review");
		expect(audit.pages[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "detail_like_page_with_thin_body",
					severity: "review",
				}),
			]),
		);
	});

	it("does not report hydrated engine2 detail pages as thin-body review findings", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_engine2_hydrated",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
			finalUrl: "https://www.example.edu/engine2/d/9285434/699558/0",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: "https://www.example.edu/",
			fetchedAt: "2026-04-01T09:11:00.000Z",
			html: load(SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_engine2_recovered",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.status).toBe("pass");
		expect(audit.pages[0]?.issues).toEqual([]);
	});

	it("flags placeholder text that leaks into main content blocks", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_placeholder",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/info/placeholder.htm",
			finalUrl: "https://www.example.edu/info/placeholder.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_VISIBLE_PLACEHOLDER_MAIN_CONTENT_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "navigation",
			discoveredFromUrl: "https://www.example.edu/list.htm",
			fetchedAt: "2026-04-01T09:12:00.000Z",
			html: load(SAMPLE_VISIBLE_PLACEHOLDER_MAIN_CONTENT_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_placeholder",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.status).toBe("review");
		expect(audit.pages[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "placeholder_main_content_detected",
					severity: "review",
				}),
			]),
		);
	});

	it("reports sport-homepage card clusters as shell-review findings until primary extraction owns the listing pattern", () => {
		const { configRoot } = writeTestConfigRoot();
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const plan = buildOfficialWebCrawlPlan("campus_public", {
			configRoot,
			crawlRunId: "owrun_quality_004",
		});
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy).not.toBeNull();
		if (!hostPolicy) {
			return;
		}

		const pageArtifacts = buildCollectedPageArtifacts({
			bundle,
			plan,
			hostPolicy: {
				...hostPolicy,
				publicKind: "content_site",
			},
			requestedUrl: "https://www.example.edu/sport/",
			finalUrl: "https://www.example.edu/sport/",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_SPORT_CARD_HOME_PAGE_HTML,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "seed",
			discoveredFromUrl: null,
			fetchedAt: "2026-03-31T17:21:00.000Z",
			html: load(SAMPLE_SPORT_CARD_HOME_PAGE_HTML),
		});

		const audit = buildCollectorQualityAudit({
			siteId: "campus_public",
			crawlRunId: "owrun_quality_004",
			pages: [pageArtifacts],
		});

		expect(audit.pages[0]?.pageFamily).toBe("dynamic_shell_page");
		expect(audit.pages[0]?.status).toBe("review");
		expect(audit.pages[0]?.issues).toEqual([
			expect.objectContaining({
				code: "shell_family_requires_manual_review",
				severity: "review",
			}),
		]);
	});
});
