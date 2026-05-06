import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import type { OfficialWebPlannerPageCandidate } from "../src/control-plane";
import { buildInitialRequests, collectNavigationRequests } from "../src/crawl-discovery-requests";
import { buildListingRequeueRequests } from "../src/crawl-discovery-requeue";
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

	it("merges multiple target workset rows for the same URL into one fetch request", async () => {
		const fixture = buildFixture();
		const contactPage = buildPlannerPage();
		const servicePage = buildPlannerPage({
			consumerFamily: "service_guide_candidate",
			materializationPolicy: "candidate_only",
			normalizedCanonicalUrl: contactPage.normalizedCanonicalUrl,
			reviewPolicy: "selected_write_requires_review",
			selectedWriteTarget: "campus_services/service_guide",
			targetCandidateId: "owcand_service",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "campus-services-service-guide",
			targetJobId: "owtarget_service",
			worksetReason: "target_candidate_due",
		});
		const requests = await buildInitialRequests({
			...fixture,
			executionMode: "target-workset",
			plannerPages: [contactPage, servicePage],
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.userData.knownPages).toHaveLength(2);
		expect(requests[0]?.userData.knownPages?.map((page) => page.targetId).sort()).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
		]);
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

	it("allows admitted source-pack discovery rows to manually requeue same-host detail pages with inherited lineage", () => {
		const fixture = buildFixture();
		const discoverySeed = buildPlannerPage({
			consumerFamily: "regulation_candidate",
			discoveryMethod: "manual_requeue",
			host: "www.example.edu",
			hostPolicy: {
				host: "www.example.edu",
				sourceHost: "www.example.edu",
			},
			normalizedCanonicalUrl: "https://www.example.edu/rules/",
			pageFamily: "target_candidate",
			pageTitleNormalized: "规章制度",
			selectedWriteTarget: "regulations/institutional_rules",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			targetCandidateId: "owcand_rules_column",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_rules",
			worksetReason: "source_pack_preview_seed",
		});
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/rules/",
			finalUrl: "https://www.example.edu/rules/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>规章制度</title></head><body><main><a href='/rules/policy-a.html'>中央民族大学岗位设置与聘用管理暂行办法</a><a href='/rules/policy-b.html'>中央民族大学劳动人事争议调解委员会工作实施细则</a></main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: discoverySeed.targetJobId,
				targetCandidateId: discoverySeed.targetCandidateId,
				targetId: discoverySeed.targetId,
				targetDeclarationVersion: discoverySeed.targetDeclarationVersion,
				consumerFamily: "regulation_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "release_gate_required",
				selectedWriteTarget: discoverySeed.selectedWriteTarget,
				reviewPolicy: discoverySeed.reviewPolicy,
				worksetReason: discoverySeed.worksetReason,
				sourcePackId: "tool-driven-first-slice.v1",
				sourcePackEntryId: "institutional-rules-column",
				compositionGroup: null,
				compositionRole: null,
			},
			html: load(
				"<html><head><title>规章制度</title></head><body><main><a href='/rules/policy-a.html'>中央民族大学岗位设置与聘用管理暂行办法</a><a href='/rules/policy-b.html'>中央民族大学劳动人事争议调解委员会工作实施细则</a></main></body></html>",
			),
		});
		page.pageManifest.pageFamily = "listing_page";

		const requests = buildListingRequeueRequests({
			bundle: fixture.bundle,
			hostPolicy: fixture.hostPolicy,
			hostSummary: fixture.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
			robotsState: fixture.robotsState,
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual([
			"https://www.example.edu/rules/policy-a.html",
			"https://www.example.edu/rules/policy-b.html",
		]);
		expect(requests[0]?.userData.discoveryMethod).toBe("manual_requeue");
		expect(requests[0]?.userData.knownPage).toBeUndefined();
		expect(requests[0]?.userData.inheritedTargetLineages).toMatchObject([
			{
				targetId: "official-web-institutional-rules",
				targetJobId: "owtarget_rules",
				targetCandidateId: "owcand_rules_column",
				sourcePackId: "tool-driven-first-slice.v1",
				sourcePackEntryId: "institutional-rules-column",
				selectedWriteTarget: "regulations/institutional_rules",
			},
		]);
	});

	it("allows regulation source-pack preview directory pages to manually requeue same-host detail pages", () => {
		const fixture = buildFixture();
		const discoverySeed = buildPlannerPage({
			consumerFamily: "student_regulation_candidate",
			discoveryMethod: "manual_requeue",
			host: "www.example.edu",
			hostPolicy: {
				host: "www.example.edu",
				sourceHost: "www.example.edu",
			},
			normalizedCanonicalUrl: "https://www.example.edu/xsgz/jwgl/",
			pageFamily: "target_candidate",
			pageTitleNormalized: "教务管理",
			selectedWriteTarget: "regulations/student_rules",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			targetCandidateId: "owcand_student_rules_column",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-student-rules",
			targetJobId: "owtarget_student_rules",
			worksetReason: "source_pack_preview_seed",
		});
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/xsgz/jwgl/",
			finalUrl: "https://www.example.edu/xsgz/jwgl/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>教务管理</title></head><body><main><a href='/info/1247/4911.htm'>本科生转专业实施细则</a><a href='/info/1247/4881.htm'>本科生学籍管理规定</a></main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: discoverySeed.targetJobId,
				targetCandidateId: discoverySeed.targetCandidateId,
				targetId: discoverySeed.targetId,
				targetDeclarationVersion: discoverySeed.targetDeclarationVersion,
				consumerFamily: "student_regulation_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "release_gate_required",
				selectedWriteTarget: discoverySeed.selectedWriteTarget,
				reviewPolicy: discoverySeed.reviewPolicy,
				worksetReason: discoverySeed.worksetReason,
				sourcePackId: "official-web-regulation-expansion.v1",
				sourcePackEntryId: "owsp-student-rules-jwgl-listing",
				compositionGroup: null,
				compositionRole: null,
			},
			html: load(
				"<html><head><title>教务管理</title></head><body><main><a href='/info/1247/4911.htm'>本科生转专业实施细则</a><a href='/info/1247/4881.htm'>本科生学籍管理规定</a></main></body></html>",
			),
		});
		page.pageManifest.pageFamily = "directory_page";
		discoverySeed.mainContentHash = page.pageManifest.mainContentHash;

		const requests = buildListingRequeueRequests({
			bundle: fixture.bundle,
			hostPolicy: fixture.hostPolicy,
			hostSummary: fixture.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
			robotsState: fixture.robotsState,
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual([
			"https://www.example.edu/info/1247/4911.htm",
			"https://www.example.edu/info/1247/4881.htm",
		]);
		expect(requests[0]?.userData.inheritedTargetLineages).toMatchObject([
			{
				targetId: "official-web-student-rules",
				targetJobId: "owtarget_student_rules",
				targetCandidateId: "owcand_student_rules_column",
				sourcePackId: "official-web-regulation-expansion.v1",
				sourcePackEntryId: "owsp-student-rules-jwgl-listing",
				selectedWriteTarget: "regulations/student_rules",
				worksetReason: "source_pack_preview_seed",
			},
		]);
	});

	it("filters non-regulation navigation links from regulation source-pack preview requeue", () => {
		const fixture = buildFixture();
		const discoverySeed = buildPlannerPage({
			consumerFamily: "regulation_candidate",
			discoveryMethod: "manual_requeue",
			host: "www.example.edu",
			hostPolicy: {
				host: "www.example.edu",
				sourceHost: "www.example.edu",
			},
			normalizedCanonicalUrl: "https://www.example.edu/rules/",
			pageFamily: "target_candidate",
			pageTitleNormalized: "人事制度",
			selectedWriteTarget: "regulations/institutional_rules",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			targetCandidateId: "owcand_rules_column",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_rules",
			worksetReason: "source_pack_preview_seed",
		});
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/rules/",
			finalUrl: "https://www.example.edu/rules/",
			declaredCanonicalUrl: null,
			responseBody: `
				<html>
					<head><title>人事制度</title></head>
					<body>
						<nav>
							<a href="/gbrs/">干部人事</a>
							<a href="/index/gsgg/">公示公告</a>
						</nav>
						<main>
							<a href="/rules/policy-a.html">中央民族大学岗位设置与聘用管理暂行办法</a>
							<a href="/rules/policy-b.html">中央民族大学登记备案人员因私出国（境）管理办法</a>
							<a href="/rules/not-policy.html">办公地点</a>
							<a href="/">首页</a>
						</main>
					</body>
				</html>
			`,
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: discoverySeed.targetJobId,
				targetCandidateId: discoverySeed.targetCandidateId,
				targetId: discoverySeed.targetId,
				targetDeclarationVersion: discoverySeed.targetDeclarationVersion,
				consumerFamily: "regulation_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "release_gate_required",
				selectedWriteTarget: discoverySeed.selectedWriteTarget,
				reviewPolicy: discoverySeed.reviewPolicy,
				worksetReason: discoverySeed.worksetReason,
				sourcePackId: "official-web-regulation-expansion.v1",
				sourcePackEntryId: "owsp-institutional-rules-rszd-listing",
				compositionGroup: null,
				compositionRole: null,
			},
			html: load(`
				<html>
					<head><title>人事制度</title></head>
					<body>
						<nav>
							<a href="/gbrs/">干部人事</a>
							<a href="/index/gsgg/">公示公告</a>
						</nav>
						<main>
							<a href="/rules/policy-a.html">中央民族大学岗位设置与聘用管理暂行办法</a>
							<a href="/rules/policy-b.html">中央民族大学登记备案人员因私出国（境）管理办法</a>
							<a href="/rules/not-policy.html">办公地点</a>
							<a href="/">首页</a>
						</main>
					</body>
				</html>
			`),
		});
		page.pageManifest.pageFamily = "directory_page";
		discoverySeed.mainContentHash = page.pageManifest.mainContentHash;

		const requests = buildListingRequeueRequests({
			bundle: fixture.bundle,
			hostPolicy: fixture.hostPolicy,
			hostSummary: fixture.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
			robotsState: fixture.robotsState,
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual([
			"https://www.example.edu/rules/policy-a.html",
			"https://www.example.edu/rules/policy-b.html",
		]);
	});

	it("keeps explicit target-workset seed ordering ahead of source-pack preview requeue", async () => {
		const fixture = buildFixture();
		const listingSeed = buildPlannerPage({
			consumerFamily: "student_regulation_candidate",
			discoveryMethod: "manual_requeue",
			host: "www.example.edu",
			hostPolicy: {
				host: "www.example.edu",
				sourceHost: "www.example.edu",
			},
			normalizedCanonicalUrl: "https://www.example.edu/xsgz/jwgl/",
			pageTitleNormalized: "教务管理",
			selectedWriteTarget: "regulations/student_rules",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			targetCandidateId: "owcand_student_rules_column",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-student-rules",
			targetJobId: "owtarget_student_rules",
			worksetReason: "source_pack_preview_seed",
		});
		const directSeed = buildPlannerPage({
			consumerFamily: "regulation_candidate",
			discoveryMethod: "manual_requeue",
			host: "www.example.edu",
			hostPolicy: {
				host: "www.example.edu",
				sourceHost: "www.example.edu",
			},
			normalizedCanonicalUrl: "https://www.example.edu/gzzd/direct-policy.htm",
			pageTitleNormalized: "校园网用户管理规定",
			selectedWriteTarget: "regulations/institutional_rules",
			materializationPolicy: "release_gate_required",
			reviewPolicy: "release_gate_required",
			targetCandidateId: "owcand_direct_policy",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_rules",
			worksetReason: "source_pack_preview_seed",
		});
		const initialRequests = await buildInitialRequests({
			...fixture,
			executionMode: "target-workset",
			plannerPages: [listingSeed, directSeed],
		});
		const listingPage = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: listingSeed.normalizedCanonicalUrl,
			finalUrl: listingSeed.normalizedCanonicalUrl,
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>教务管理</title></head><body><main><a href='/info/1247/4911.htm'>本科生转专业实施细则</a></main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineage: {
				targetJobId: listingSeed.targetJobId,
				targetCandidateId: listingSeed.targetCandidateId,
				targetId: listingSeed.targetId,
				targetDeclarationVersion: listingSeed.targetDeclarationVersion,
				consumerFamily: "student_regulation_candidate",
				retentionPolicy: "retain_source_truth",
				materializationPolicy: "release_gate_required",
				selectedWriteTarget: listingSeed.selectedWriteTarget,
				reviewPolicy: listingSeed.reviewPolicy,
				worksetReason: listingSeed.worksetReason,
				sourcePackId: "official-web-public-regulation-closeout.v1",
				sourcePackEntryId: "owsp-closeout-student-rules-jwgl-listing",
				compositionGroup: null,
				compositionRole: null,
			},
			html: load(
				"<html><head><title>教务管理</title></head><body><main><a href='/info/1247/4911.htm'>本科生转专业实施细则</a></main></body></html>",
			),
		});
		listingPage.pageManifest.pageFamily = "directory_page";
		listingSeed.mainContentHash = listingPage.pageManifest.mainContentHash;

		const requeueRequests = buildListingRequeueRequests({
			bundle: fixture.bundle,
			hostPolicy: fixture.hostPolicy,
			hostSummary: fixture.hostSummary,
			knownPage: listingSeed,
			page: listingPage,
			plannerPageLookup: new Map([
				[listingSeed.normalizedCanonicalUrl, listingSeed],
				[directSeed.normalizedCanonicalUrl, directSeed],
			]),
			robotsState: fixture.robotsState,
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(initialRequests.map((request) => request.url)).toEqual([
			"https://www.example.edu/xsgz/jwgl/",
			"https://www.example.edu/gzzd/direct-policy.htm",
		]);
		expect(requeueRequests.map((request) => request.url)).toEqual([
			"https://www.example.edu/info/1247/4911.htm",
		]);
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

	it("preserves multiple target lineages on a single fetched page", () => {
		const fixture = buildFixture();
		const contactPage = buildPlannerPage();
		const servicePage = buildPlannerPage({
			consumerFamily: "service_guide_candidate",
			materializationPolicy: "candidate_only",
			normalizedCanonicalUrl: contactPage.normalizedCanonicalUrl,
			reviewPolicy: "selected_write_requires_review",
			selectedWriteTarget: "campus_services/service_guide",
			targetCandidateId: "owcand_service",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "campus-services-service-guide",
			targetJobId: "owtarget_service",
			worksetReason: "target_candidate_due",
		});
		const page = buildCollectedPageArtifacts({
			bundle: fixture.bundle,
			plan: fixture.plan,
			hostPolicy: fixture.hostPolicy,
			requestedUrl: "https://www.example.edu/contact/",
			finalUrl: "https://www.example.edu/contact/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼 办理流程：先登记后办理</main></body></html>",
			responseHeaders: {
				"content-type": "text/html; charset=utf-8",
			},
			httpStatus: 200,
			contentType: "text/html",
			discoveryMethod: "manual_requeue",
			discoveredFromUrl: null,
			fetchedAt: "2026-05-01T08:00:00.000Z",
			targetLineages: [
				{
					targetJobId: contactPage.targetJobId,
					targetCandidateId: contactPage.targetCandidateId,
					targetId: contactPage.targetId,
					targetDeclarationVersion: contactPage.targetDeclarationVersion,
					consumerFamily: "contact_directory_candidate",
					retentionPolicy: "retain_source_truth",
					materializationPolicy: "candidate_only",
					selectedWriteTarget: contactPage.selectedWriteTarget,
					reviewPolicy: contactPage.reviewPolicy,
					worksetReason: contactPage.worksetReason,
				},
				{
					targetJobId: servicePage.targetJobId,
					targetCandidateId: servicePage.targetCandidateId,
					targetId: servicePage.targetId,
					targetDeclarationVersion: servicePage.targetDeclarationVersion,
					consumerFamily: "service_guide_candidate",
					retentionPolicy: "retain_source_truth",
					materializationPolicy: "candidate_only",
					selectedWriteTarget: servicePage.selectedWriteTarget,
					reviewPolicy: servicePage.reviewPolicy,
					worksetReason: servicePage.worksetReason,
				},
			],
			html: load(
				"<html><head><title>Contact</title></head><body><main>联系我们 010-12345678 office@example.edu 地址：一号楼 办理流程：先登记后办理</main></body></html>",
			),
		});

		expect(page.pageManifest.targetMatches?.map((match) => match.targetId).sort()).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
		]);
		expect(page.pageManifest.targetJobId).toBe("owtarget_contact");
		expect(page.pageManifest.targetCandidateId).toBe("owcand_contact");
		expect(page.pageManifest.selectedWriteTarget).toBe("campus_services/contact_directory");
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
