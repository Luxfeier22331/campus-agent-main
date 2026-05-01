import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import type { OfficialWebPlannerPageCandidate } from "../src/control-plane";
import { buildInitialRequests, collectNavigationRequests } from "../src/crawl-discovery-requests";
import type { CollectorRobotsState } from "../src/crawl-internal-types";
import { buildPageObservationFromCollectedPage } from "../src/crawl-observations";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "../src/official-web-core";
import { buildCollectedPageArtifacts } from "../src/page-artifacts";
import { writeTestConfigRoot } from "./test-support";

function buildPlannerPage(
	overrides: Partial<OfficialWebPlannerPageCandidate> = {},
): OfficialWebPlannerPageCandidate {
	return {
		cadenceClass: "target_candidate",
		consumerFamily: "contact_directory_candidate",
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
		normalizedCanonicalUrl: "https://www.example.edu/contact/",
		pageFamily: "target_candidate",
		pageTitleNormalized: "",
		priorityScore: 90,
		responseBodyHash: null,
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "selected_write_requires_review",
		selectedWriteTarget: "campus_services/contact_directory",
		siteId: "campus_public",
		targetCandidateId: "owcand_contact",
		targetDeclarationVersion: "campus_public_target_source_map_v2",
		targetId: "campus-services-contact-directory",
		targetJobId: "owtarget_contact",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

function buildFixture() {
	const { configRoot } = writeTestConfigRoot();
	const bundle = loadOfficialWebConfig("campus_public", { configRoot });
	const plan = buildOfficialWebCrawlPlan("campus_public", {
		configRoot,
		crawlRunId: "owrun_workset_executor",
	});
	const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");
	if (!hostPolicy) {
		throw new Error("host policy missing");
	}
	const robotsState: CollectorRobotsState = {
		blocked: false,
		failure: null,
		robots: null,
		sitemaps: [],
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

describe("official web target workset executor", () => {
	it("builds initial requests from target workset pages only", async () => {
		const fixture = buildFixture();
		const requests = await buildInitialRequests({
			...fixture,
			executionMode: "target-workset",
			plannerPages: [buildPlannerPage()],
		});

		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/contact/"]);
		expect(requests.map((request) => request.url)).not.toContain("https://www.example.edu/");
	});

	it("can disable conditional headers for evidence preview fetches", async () => {
		const fixture = buildFixture();
		const requests = await buildInitialRequests({
			...fixture,
			disableConditionalHeaders: true,
			executionMode: "target-workset",
			plannerPages: [
				buildPlannerPage({
					etag: '"etag-current"',
					lastModified: "Wed, 01 May 2026 08:00:00 GMT",
				}),
			],
		});

		expect(requests[0]?.userData.conditionalHeaders).toBeUndefined();
	});

	it("does not expand navigation outside returned target workset URLs", () => {
		const fixture = buildFixture();
		const plannerPage = buildPlannerPage();
		const requests = collectNavigationRequests({
			bundle: fixture.bundle,
			hostPolicy: fixture.hostPolicy,
			hostSummary: fixture.hostSummary,
			robotsState: fixture.robotsState,
			plannerPageLookup: new Map([[plannerPage.normalizedCanonicalUrl, plannerPage]]),
			html: load(`
				<a href="/contact/">Contact</a>
				<a href="/unadmitted/">Unadmitted</a>
			`),
			baseUrl: "https://www.example.edu/",
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/contact/"]);
	});

	it("writes target lineage to page manifests using camelCase keys", () => {
		const fixture = buildFixture();
		const targetLineage = buildPlannerPage();
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/contact/",
			finalUrl: "https://www.example.edu/contact/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼</main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: targetLineage.targetJobId,
				targetCandidateId: targetLineage.targetCandidateId,
				targetId: targetLineage.targetId,
				targetDeclarationVersion: targetLineage.targetDeclarationVersion,
				consumerFamily: "contact_directory_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "candidate_only",
				selectedWriteTarget: targetLineage.selectedWriteTarget,
				reviewPolicy: targetLineage.reviewPolicy,
				worksetReason: targetLineage.worksetReason,
			},
			html: load(
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼</main></body></html>",
			),
		});

		expect(page.pageManifest).toMatchObject({
			targetJobId: "owtarget_contact",
			targetCandidateId: "owcand_contact",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			materializationPolicy: "candidate_only",
			selectedWriteTarget: "campus_services/contact_directory",
			reviewPolicy: "selected_write_requires_review",
		});
		expect(Object.keys(page.pageManifest)).not.toContain("target_job_id");
		expect(page.pageManifest.targetMatches?.[0]).toMatchObject({
			consumerFamily: "contact_directory_candidate",
			worksetReason: "target_candidate_due",
		});
	});

	it("carries target lineage from page manifests into app-api page observations", () => {
		const fixture = buildFixture();
		const targetLineage = buildPlannerPage();
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/contact/",
			finalUrl: "https://www.example.edu/contact/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼</main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: targetLineage.targetJobId,
				targetCandidateId: targetLineage.targetCandidateId,
				targetId: targetLineage.targetId,
				targetDeclarationVersion: targetLineage.targetDeclarationVersion,
				consumerFamily: "contact_directory_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "candidate_only",
				selectedWriteTarget: targetLineage.selectedWriteTarget,
				reviewPolicy: targetLineage.reviewPolicy,
				worksetReason: targetLineage.worksetReason,
			},
			html: load(
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼</main></body></html>",
			),
		});

		expect(
			buildPageObservationFromCollectedPage("campus_public", "owrun_workset_executor", "hot", page),
		).toMatchObject({
			targetCandidateId: "owcand_contact",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "campus-services-contact-directory",
			targetJobId: "owtarget_contact",
		});
	});
});
