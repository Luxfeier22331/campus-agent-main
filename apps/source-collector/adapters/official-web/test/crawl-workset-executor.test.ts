import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import type { OfficialWebPlannerPageCandidate } from "../src/control-plane";
import {
	buildOfficialWebCrawlPlan,
	findOfficialWebHostPolicy,
	loadOfficialWebConfig,
	type OfficialWebHostSummaryRecord,
	type OfficialWebUrlResultRecord,
} from "../src/core/index.ts";
import { buildInitialRequests, collectNavigationRequests } from "../src/crawl-discovery-requests";
import { buildListingRequeueRequests } from "../src/crawl-discovery-requeue";
import { buildPageObservationFromCollectedPage } from "../src/crawl-observations";
import { buildCollectedPageArtifacts } from "../src/page-artifacts";
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

function buildAssertion() {
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

describe("official web target workset executor", () => {
	it("builds initial requests from target workset pages only", async () => {
		const assertion = buildAssertion();
		const { requests } = await buildInitialRequests({
			...assertion,
			plannerPages: [buildPlannerPage()],
		});

		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/calendar/"]);
		expect(requests.map((request) => request.url)).not.toContain("https://www.example.edu/");
	});

	it("merges multiple target workset rows for the same URL into one fetch request", async () => {
		const assertion = buildAssertion();
		const calendarPage = buildPlannerPage();
		const servicePage = buildPlannerPage({
			consumerFamily: "regulation_candidate",
			materializationPolicy: "release_gate_required",
			normalizedCanonicalUrl: calendarPage.normalizedCanonicalUrl,
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/institutional_rules",
			targetCandidateId: "owcand_rules",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_rules",
			worksetReason: "target_candidate_due",
		});
		const { requests } = await buildInitialRequests({
			...assertion,
			plannerPages: [calendarPage, servicePage],
		});

		expect(requests).toHaveLength(1);
		const request = requests[0];
		if (!request) {
			throw new Error("expected one merged request");
		}
		expect(request.userData?.knownPages).toHaveLength(2);
		expect(request.userData?.knownPages?.map((page) => page.targetId).sort()).toEqual([
			"official-web-academic-calendar",
			"official-web-institutional-rules",
		]);
	});

	it("can disable conditional headers for evidence preview fetches", async () => {
		const assertion = buildAssertion();
		const { requests } = await buildInitialRequests({
			...assertion,
			disableConditionalHeaders: true,
			plannerPages: [
				buildPlannerPage({
					etag: '"etag-current"',
					lastModified: "Wed, 01 May 2026 08:00:00 GMT",
				}),
			],
		});

		const request = requests[0];
		if (!request) {
			throw new Error("expected one request");
		}
		expect(request.userData?.conditionalHeaders).toBeUndefined();
	});

	it("does not expand navigation outside returned target workset URLs", () => {
		const assertion = buildAssertion();
		const plannerPage = buildPlannerPage();
		const requests = collectNavigationRequests({
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			plannerPageLookup: new Map([[plannerPage.normalizedCanonicalUrl, plannerPage]]),
			html: load(`
					<a href="/calendar/">Calendar</a>
					<a href="/unadmitted/">Unadmitted</a>
				`),
			baseUrl: "https://www.example.edu/",
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual(["https://www.example.edu/calendar/"]);
	});

	it("allows admitted source-pack discovery rows to manually requeue same-host detail pages with inherited lineage", () => {
		const assertion = buildAssertion();
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
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
			requestedUrl: "https://www.example.edu/rules/",
			finalUrl: "https://www.example.edu/rules/",
			declaredCanonicalUrl: null,
			responseBody:
				"<html><head><title>规章制度</title></head><body><main><a href='/rules/policy-a.html'>示例大学岗位设置与聘用管理暂行办法</a><a href='/rules/policy-b.html'>示例大学劳动人事争议调解委员会工作实施细则</a></main></body></html>",
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
				"<html><head><title>规章制度</title></head><body><main><a href='/rules/policy-a.html'>示例大学岗位设置与聘用管理暂行办法</a><a href='/rules/policy-b.html'>示例大学劳动人事争议调解委员会工作实施细则</a></main></body></html>",
			),
		});
		page.pageManifest.pageFamily = "listing_page";

		const requests = buildListingRequeueRequests({
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
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
		const assertion = buildAssertion();
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
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
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
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
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
		const assertion = buildAssertion();
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
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
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
							<a href="/rules/policy-a.html">示例大学岗位设置与聘用管理暂行办法</a>
							<a href="/rules/policy-b.html">示例大学登记备案人员因私出国（境）管理办法</a>
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
							<a href="/rules/policy-a.html">示例大学岗位设置与聘用管理暂行办法</a>
							<a href="/rules/policy-b.html">示例大学登记备案人员因私出国（境）管理办法</a>
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
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			knownPage: discoverySeed,
			page,
			plannerPageLookup: new Map([[discoverySeed.normalizedCanonicalUrl, discoverySeed]]),
			depth: 1,
			targetWorksetOnly: true,
		});

		expect(requests.map((request) => request.url)).toEqual([
			"https://www.example.edu/rules/policy-a.html",
			"https://www.example.edu/rules/policy-b.html",
		]);
	});

	it("keeps explicit target-workset seed ordering ahead of source-pack preview requeue", async () => {
		const assertion = buildAssertion();
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
		const { requests: initialRequests } = await buildInitialRequests({
			...assertion,
			plannerPages: [listingSeed, directSeed],
		});
		const listingPage = buildCollectedPageArtifacts({
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
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
			bundle: assertion.bundle,
			hostPolicy: assertion.hostPolicy,
			hostSummary: assertion.hostSummary,
			knownPage: listingSeed,
			page: listingPage,
			plannerPageLookup: new Map([
				[listingSeed.normalizedCanonicalUrl, listingSeed],
				[directSeed.normalizedCanonicalUrl, directSeed],
			]),
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
		const assertion = buildAssertion();
		const targetLineage = buildPlannerPage();
		const page = buildCollectedPageArtifacts({
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
			requestedUrl: "https://www.example.edu/calendar/",
			finalUrl: "https://www.example.edu/calendar/",
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
				consumerFamily: "academic_calendar_candidate",
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
			targetJobId: "owtarget_calendar",
			targetCandidateId: "owcand_calendar",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			materializationPolicy: "candidate_only",
			selectedWriteTarget: "calendar/academic_calendar",
			reviewPolicy: "selected_write_requires_review",
		});
		expect(Object.keys(page.pageManifest)).not.toContain("target_job_id");
		expect(page.pageManifest.targetMatches?.[0]).toMatchObject({
			consumerFamily: "academic_calendar_candidate",
			worksetReason: "target_candidate_due",
		});
	});

	it("preserves multiple target lineages on a single fetched page", () => {
		const assertion = buildAssertion();
		const calendarPage = buildPlannerPage();
		const servicePage = buildPlannerPage({
			consumerFamily: "regulation_candidate",
			materializationPolicy: "release_gate_required",
			normalizedCanonicalUrl: calendarPage.normalizedCanonicalUrl,
			reviewPolicy: "release_gate_required",
			selectedWriteTarget: "regulations/institutional_rules",
			targetCandidateId: "owcand_rules",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-institutional-rules",
			targetJobId: "owtarget_rules",
			worksetReason: "target_candidate_due",
		});
		const page = buildCollectedPageArtifacts({
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
			requestedUrl: "https://www.example.edu/calendar/",
			finalUrl: "https://www.example.edu/calendar/",
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
					targetJobId: calendarPage.targetJobId,
					targetCandidateId: calendarPage.targetCandidateId,
					targetId: calendarPage.targetId,
					targetDeclarationVersion: calendarPage.targetDeclarationVersion,
					consumerFamily: "academic_calendar_candidate",
					retentionPolicy: "retain_source_truth",
					materializationPolicy: "candidate_only",
					selectedWriteTarget: calendarPage.selectedWriteTarget,
					reviewPolicy: calendarPage.reviewPolicy,
					worksetReason: calendarPage.worksetReason,
				},
				{
					targetJobId: servicePage.targetJobId,
					targetCandidateId: servicePage.targetCandidateId,
					targetId: servicePage.targetId,
					targetDeclarationVersion: servicePage.targetDeclarationVersion,
					consumerFamily: "regulation_candidate",
					retentionPolicy: "retain_source_truth",
					materializationPolicy: "release_gate_required",
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
			"official-web-academic-calendar",
			"official-web-institutional-rules",
		]);
		expect(page.pageManifest.targetJobId).toBe("owtarget_calendar");
		expect(page.pageManifest.targetCandidateId).toBe("owcand_calendar");
		expect(page.pageManifest.selectedWriteTarget).toBe("calendar/academic_calendar");
	});

	it("carries target lineage from page manifests into app-api page observations", () => {
		const assertion = buildAssertion();
		const targetLineage = buildPlannerPage();
		const page = buildCollectedPageArtifacts({
			bundle: assertion.bundle,
			plan: assertion.plan,
			hostPolicy: assertion.hostPolicy,
			requestedUrl: "https://www.example.edu/calendar/",
			finalUrl: "https://www.example.edu/calendar/",
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
				consumerFamily: "academic_calendar_candidate",
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
			targetCandidateId: "owcand_calendar",
			targetDeclarationVersion: "campus_public_target_source_map_v2",
			targetId: "official-web-academic-calendar",
			targetJobId: "owtarget_calendar",
		});
	});
});
