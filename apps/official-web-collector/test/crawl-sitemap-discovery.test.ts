import { Sitemap } from "crawlee";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OfficialWebPlannerPageCandidate } from "../src/control-plane";
import { buildInitialRequests } from "../src/crawl-discovery-requests";
import type { CollectorRobotsState } from "../src/crawl-internal-types";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "../src/official-web-core";
import { writeTestConfigRoot } from "./test-support";

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

function buildFixture() {
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
	const robotsState: CollectorRobotsState = {
		blocked: false,
		failure: null,
		robots: null,
	};
	const hostSummary: OfficialWebHostSummaryRecord = {
		admissionRejected: 0,
		failures: 0,
		host: "www.example.edu",
		pagesFetched: 0,
		pagesObserved: 0,
		robotsBlocked: false,
	};
	const urlResults: OfficialWebUrlResultRecord[] = [];

	return { bundle, hostPolicy, hostSummary, plan, robotsState, urlResults };
}

describe("official web sitemap discovery", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("adds robots sitemap URLs through Crawlee robots sitemap parsing", async () => {
		const fixture = buildFixture();
		const parseUrlsFromSitemaps = vi.fn(async () => [
			"https://www.example.edu/calendar/",
			"https://www.example.edu/login",
		]);
		const { requests } = await buildInitialRequests({
			...fixture,
			plannerPages: [],
			robotsState: {
				...fixture.robotsState,
				robots: {
					getSitemaps: () => ["https://www.example.edu/sitemap.xml"],
					isAllowed: () => true,
					parseUrlsFromSitemaps,
				} as never,
			},
		});

		expect(parseUrlsFromSitemaps).toHaveBeenCalledTimes(1);
		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/calendar/"]);
		expect(requests[0]?.userData.discoveryMethod).toBe("robots_sitemap");
		expect(fixture.hostSummary.admissionRejected).toBe(1);
	});

	it("adds configured sitemap URLs through Crawlee Sitemap.load", async () => {
		const loadSitemap = vi.spyOn(Sitemap, "load").mockResolvedValueOnce({
			urls: ["https://www.example.edu/calendar/"],
		} as never);
		const fixture = buildFixture();
		const { requests } = await buildInitialRequests({
			...fixture,
			hostPolicy: {
				...fixture.hostPolicy,
				explicitSitemaps: ["https://www.example.edu/sitemap.xml"],
			},
			plannerPages: [],
		});

		expect(loadSitemap).toHaveBeenCalledWith(["https://www.example.edu/sitemap.xml"]);
		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/calendar/"]);
		expect(requests[0]?.userData.discoveryMethod).toBe("configured_sitemap");
	});

	it("keeps target workset metadata when a sitemap discovers the same URL", async () => {
		const fixture = buildFixture();
		const knownPage = buildPlannerPage();
		const { requests } = await buildInitialRequests({
			...fixture,
			plannerPages: [knownPage],
			robotsState: {
				...fixture.robotsState,
				robots: {
					getSitemaps: () => ["https://www.example.edu/sitemap.xml"],
					isAllowed: () => true,
					parseUrlsFromSitemaps: async () => [knownPage.normalizedCanonicalUrl],
				} as never,
			},
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.userData.discoveryMethod).toBe(knownPage.discoveryMethod);
		expect(requests[0]?.userData.knownPages).toHaveLength(1);
	});

	it("records sitemap parse failures without silently admitting the source", async () => {
		const fixture = buildFixture();
		const { failures, requests } = await buildInitialRequests({
			...fixture,
			plannerPages: [],
			robotsState: {
				...fixture.robotsState,
				robots: {
					getSitemaps: () => ["https://www.example.edu/sitemap.xml"],
					isAllowed: () => true,
					parseUrlsFromSitemaps: async () => {
						throw new TypeError("sitemap fetch failed", {
							cause: new Error("socket hang up"),
						});
					},
				} as never,
			},
		});

		expect(requests).toEqual([]);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.reason).toBe("robots_sitemap_parse_failed");
		expect(failures[0]?.message).toContain("socket hang up");
	});
});
