import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { OfficialWebPlannerPageCandidate } from "../src/control-plane";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "../src/core/index.ts";
import {
	buildConfiguredSitemapRequestTransform,
	buildInitialRequests,
} from "../src/crawl-discovery-requests";
import { writeTestConfigRoot } from "./test-support";

const SOURCE_ROOT = resolve(import.meta.dirname, "../src");

function buildPlannerPage(
	overrides: Partial<OfficialWebPlannerPageCandidate> = {},
): OfficialWebPlannerPageCandidate {
	return {
		cadenceClass: "target_candidate",
		consumerFamily: "academic_calendar_candidate",
		contentType: "text/html",
		discoveredFromUrl: null,
		discoveryMethod: "manual_requeue",
		etag: null,
		fetchProfile: "target_candidate_fetch",
		host: "www.example.edu",
		hostPolicy: {
			host: "www.example.edu",
			sourceHost: "www.example.edu",
		},
		inventoryOnly: false,
		lastChangeReason: "target_candidate_admitted",
		lastChangedAt: null,
		lastFetchDisposition: "never_fetched",
		lastHttpStatus: null,
		lastModified: null,
		lastNotModifiedAt: null,
		lastSeenAt: "2026-05-01T08:00:00.000Z",
		lastSuccessfulRunId: null,
		mainContentHash: null,
		materializationPolicy: "candidate_only",
		nextEligibleFetchAt: "2026-05-01T08:00:00.000Z",
		normalizedCanonicalUrl: "https://www.example.edu/calendar/",
		pageFamily: "target_candidate",
		pageTitleNormalized: "",
		priorityScore: 90,
		responseBodyHash: null,
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "selected_write_requires_review",
		selectedWriteTarget: "calendar/academic_calendar",
		siteId: "campus_public",
		targetCandidateId: "owcand_calendar",
		targetDeclarationVersion: "campus_public_target_source_map_v2",
		targetId: "official-web-academic-calendar",
		targetJobId: "owtarget_calendar",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

function buildAssertion() {
	const { configRoot } = writeTestConfigRoot();
	const bundle = loadOfficialWebConfig("campus_public", { configRoot });
	const plan = buildOfficialWebCrawlPlan("campus_public", {
		configRoot,
		crawlRunId: "owrun_sitemap_discovery",
	});
	const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
	if (!hostPolicy) {
		throw new Error("host policy missing");
	}
	const hostSummary: OfficialWebHostSummaryRecord = {
		admissionRejected: 0,
		failures: 0,
		host: "www.example.edu",
		pagesFetched: 0,
		pagesObserved: 0,
		robotsBlocked: false,
	};
	const urlResults: OfficialWebUrlResultRecord[] = [];

	return { bundle, hostPolicy, hostSummary, plan, urlResults };
}

describe("official web sitemap discovery", () => {
	it("does not restore self-built robots or sitemap fetch paths", () => {
		for (const relativePath of [
			"crawl-discovery-requests.ts",
			"crawl-single-host.ts",
			"crawl-discovery-requeue.ts",
		]) {
			const source = readFileSync(resolve(SOURCE_ROOT, relativePath), "utf-8");
			expect(source).not.toContain("RobotsTxtFile.find");
			expect(source).not.toContain("Sitemap.load");
			expect(source).not.toContain("parseUrlsFromSitemaps");
		}
	});

	it("keeps initial requests limited to admitted target workset pages", () => {
		const assertion = buildAssertion();
		const { requests } = buildInitialRequests({
			...assertion,
			plannerPages: [],
		});

		expect(requests).toEqual([]);
	});

	it("converts configured sitemap URLs through the same admission boundary", () => {
		const assertion = buildAssertion();
		const transform = buildConfiguredSitemapRequestTransform({
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			plan: assertion.plan,
			plannerPageLookup: new Map(),
			urlResults: assertion.urlResults,
		});

		const admitted = transform({ url: "https://www.example.edu/calendar/" });
		const rejected = transform({ url: "https://www.example.edu/login" });

		if (!admitted) {
			throw new Error("expected configured sitemap URL to be admitted");
		}
		expect(admitted.url).toBe("https://www.example.edu/calendar/");
		expect(admitted.userData?.discoveryMethod).toBe("configured_sitemap");
		expect(rejected).toBe(false);
		expect(assertion.hostSummary.admissionRejected).toBe(1);
		expect(assertion.urlResults[0]).toMatchObject({
			requestedUrl: "https://www.example.edu/login",
			outcome: "admission_rejected",
		});
	});

	it("keeps target workset metadata when a configured sitemap discovers the same URL", () => {
		const assertion = buildAssertion();
		const knownPage = buildPlannerPage();
		const transform = buildConfiguredSitemapRequestTransform({
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			plan: assertion.plan,
			plannerPageLookup: new Map([[knownPage.normalizedCanonicalUrl, knownPage]]),
			urlResults: assertion.urlResults,
		});

		const request = transform({ url: knownPage.normalizedCanonicalUrl });

		if (!request) {
			throw new Error("expected configured sitemap URL to be admitted");
		}
		expect(request.userData?.discoveryMethod).toBe(knownPage.discoveryMethod);
		expect(request.userData?.knownPages).toHaveLength(1);
	});
});
