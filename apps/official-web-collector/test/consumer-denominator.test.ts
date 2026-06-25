import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOfficialWebConfig } from "official-web-core";
import { describe, expect, it } from "vitest";
import {
	applyOfficialWebConsumerDenominator,
	evaluateOfficialWebConsumerDenominator,
} from "../src/consumer-denominator";
import { crawlSite } from "../src/crawl";
import type { CollectedPageArtifact } from "../src/page-artifacts";
import {
	createCollectedPageArtifactForTest,
	createTargetWorksetControlPlaneForTest,
	readJsonArtifact,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	writeTestConfigRoot,
} from "./crawl-test-support";

const SAMPLE_ACADEMIC_CALENDAR_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>民大校历 - 中央民族大学</title>
  </head>
  <body>
    <main>
      <h1>民大校历</h1>
      <p>2026-2027学年秋季学期教学周安排。</p>
      <p>第1教学周：9月1日至9月7日。</p>
      <p>国庆放假安排及补课安排另见校历标注。</p>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_STUDENT_RULE_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>中央民族大学学生奖学金评定办法 - Campus public</title>
  </head>
  <body>
    <main>
      <h1>中央民族大学学生奖学金评定办法</h1>
      <p>第一条 为规范学生奖学金评定工作，制定本办法。</p>
      <p>第二条 本办法适用于全日制在校学生。</p>
    </main>
  </body>
</html>
`.trim();

describe("official web consumer denominator", () => {
	it("loads consumer denominator config with explicit downstream owners", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });

		expect(bundle.consumerDenominator.schemaVersion).toBe("official_web_consumer_denominator.v1");
		expect(bundle.consumerDenominator.consumerFamilies.map((item) => item.consumerFamily)).toEqual([
			"academic_calendar_candidate",
			"stable_reference_candidate",
			"regulation_candidate",
			"student_regulation_candidate",
			"notice_news_candidate",
		]);
		expect(
			bundle.consumerDenominator.consumerFamilies.find(
				(item) => item.consumerFamily === "notice_news_candidate",
			)?.materializationPolicy,
		).toBe("inventory_only");
	});

	it("rejects unsupported consumer materialization policies", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const denominatorPath = resolve(configRoot, "campus_public", "consumer-denominator.json");
		writeFileSync(
			denominatorPath,
			JSON.stringify(
				{
					schema_version: "official_web_consumer_denominator.v1",
					site_id: "campus_public",
					denominator_version: "bad_policy",
					enforcement_mode: "retain_matching_only",
					default_rejected_policy: "reject",
					consumer_families: [
						{
							consumer_family: "academic_calendar_candidate",
							owner_surface: "calendar/academic_calendar",
							owner_capability_or_runtime: "calendar",
							materialization_policy: "emit_directly",
							page_families: ["article_detail"],
							title_keywords: ["校历"],
							path_patterns: [],
							required_evidence: ["calendar_arrangement"],
							negative_patterns: [],
							selected_write_target: "calendar/academic_calendar",
							review_policy: "selected_write_requires_review",
						},
					],
					reporting_counters: [],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/unsupported official_web consumer materialization policy/u,
		);
	});

	it("classifies academic calendar pages with calendar arrangement evidence", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_calendar",
			requestedUrl: "https://www.example.edu/calendar.htm",
			finalUrl: "https://www.example.edu/calendar.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_ACADEMIC_CALENDAR_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});

		const calendarMatch = evaluation.consumerMatches.find(
			(item) => item.consumerFamily === "academic_calendar_candidate",
		);
		expect(evaluation.retentionDecision).toBe("retain_source_truth");
		expect(calendarMatch).toMatchObject({
			consumerFamily: "academic_calendar_candidate",
			ownerSurface: "calendar/academic_calendar",
			selectedWriteTarget: "calendar/academic_calendar",
		});
		expect(calendarMatch?.matchedEvidence).toEqual(["calendar_arrangement"]);
	});

	it("classifies student regulation pages onto the student-rules family", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_student_rule",
			requestedUrl: "https://www.example.edu/xsgz/jwgl/student-award.htm",
			finalUrl: "https://www.example.edu/xsgz/jwgl/student-award.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_STUDENT_RULE_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});
		const studentMatch = evaluation.consumerMatches.find(
			(item) => item.consumerFamily === "student_regulation_candidate",
		);

		expect(evaluation.retentionDecision).toBe("retain_source_truth");
		expect(studentMatch).toMatchObject({
			consumerFamily: "student_regulation_candidate",
			ownerSurface: "regulations/student_rules",
			selectedWriteTarget: "regulations/student_rules",
		});
		expect(studentMatch?.matchedEvidence).toEqual(["regulation_text"]);
	});

	it("requires configured keyword/path match and enough evidence before calendar candidate retention", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const calendarRule = bundle.consumerDenominator.consumerFamilies.find(
			(item) => item.consumerFamily === "academic_calendar_candidate",
		);
		if (!calendarRule) {
			throw new Error("calendar rule is required");
		}
		const ruleTuning = calendarRule as typeof calendarRule & {
			minimumMatchedEvidenceCount: number;
			requiresKeywordOrPathMatch: boolean;
		};
		ruleTuning.minimumMatchedEvidenceCount = 1;
		ruleTuning.requiresKeywordOrPathMatch = true;

		const evidenceOnlyPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_evidence_only",
			requestedUrl: "https://www.example.edu/info/teaching-arrangement.htm",
			finalUrl: "https://www.example.edu/info/teaching-arrangement.htm",
			declaredCanonicalUrl: null,
			responseBody: `
        <html><head><title>教学安排</title></head><body><main>
          <h1>教学安排</h1>
          <p>第1教学周：9月1日至9月7日。</p>
        </main></body></html>
      `,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});
		const insufficientEvidencePage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_insufficient_evidence",
			requestedUrl: "https://www.example.edu/xiaoli/info.htm",
			finalUrl: "https://www.example.edu/xiaoli/info.htm",
			declaredCanonicalUrl: null,
			responseBody: `
        <html><head><title>页面说明</title></head><body><main>
          <h1>页面说明</h1>
          <p>本页面稍后更新。</p>
        </main></body></html>
      `,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		expect(
			evaluateOfficialWebConsumerDenominator({
				consumerDenominator: bundle.consumerDenominator,
				page: evidenceOnlyPage,
			}).consumerMatches.map((item) => item.consumerFamily),
		).not.toContain("academic_calendar_candidate");
		expect(
			evaluateOfficialWebConsumerDenominator({
				consumerDenominator: bundle.consumerDenominator,
				page: insufficientEvidencePage,
			}).consumerMatches.map((item) => item.consumerFamily),
		).not.toContain("academic_calendar_candidate");
	});

	it("filters non-consumer pages from retained source truth and reports denominator counters", async () => {
		const { configRoot, outputDir } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const calendarPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_filter",
			requestedUrl: "https://www.example.edu/calendar.htm",
			finalUrl: "https://www.example.edu/calendar.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_ACADEMIC_CALENDAR_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});
		const rejectedPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_filter",
			requestedUrl: "https://www.example.edu/shell.htm",
			finalUrl: "https://www.example.edu/shell.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
			targetLineage: null,
		});

		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_consumer_filter",
			localArtifactsOnly: true,
			controlPlaneClient: createTargetWorksetControlPlaneForTest({
				runId: "owrun_consumer_filter",
			}),
			crawlHosts: async () => ({
				hostSummaries: [
					{
						host: "www.example.edu",
						pagesObserved: 2,
						pagesFetched: 2,
						failures: 0,
						admissionRejected: 0,
						robotsBlocked: false,
					},
				],
				pageObservations: [],
				urlResults: [],
				failures: [],
				pages: [calendarPage, rejectedPage],
			}),
		});

		expect(result.pages).toHaveLength(1);
		expect(result.pages[0]?.pageManifest.normalizedCanonicalUrl).toBe(
			"https://www.example.edu/calendar.htm",
		);
		expect(result.sourceTruthBundle.pages).toHaveLength(1);
		expect(result.crawlRun.counters.consumerDenominator).toMatchObject({
			retainedSourceTruthPages: 1,
			rejectedPages: 1,
		});
		const crawlRun = readJsonArtifact<{
			counters: {
				consumerDenominator: {
					consumerFamilyCounts: Record<string, number>;
					rejectedReasonCounts: Record<string, number>;
				};
			};
		}>(result.artifactPaths["crawl-run.json"]);
		expect(crawlRun.counters.consumerDenominator.consumerFamilyCounts).toMatchObject({
			academic_calendar_candidate: 1,
		});
		expect(crawlRun.counters.consumerDenominator.rejectedReasonCounts).toMatchObject({
			no_consumer_denominator_match: 1,
		});
	});

	it("retains explicit target-workset source truth even when denominator evidence is pending review", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const listingPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_target_review",
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			declaredCanonicalUrl: null,
			responseBody: `
        <html><head><title>Campus public</title></head><body><main>
          <a href="/news/1.htm">新闻</a>
          <a href="/news/2.htm">通知</a>
        </main></body></html>
      `,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});
		const targetPage: CollectedPageArtifact = {
			...listingPage,
			pageManifest: {
				...listingPage.pageManifest,
				pageFamily: "listing_page",
				targetMatches: [
					{
						targetJobId: "owtarget_contact",
						targetCandidateId: "owcand_calendar_home",
						targetId: "official-web-academic-calendar",
						targetDeclarationVersion: "campus_public_target_source_map_v2",
						consumerFamily: "academic_calendar_candidate",
						retentionPolicy: "retain_source_truth",
						materializationPolicy: "candidate_only",
						selectedWriteTarget: "calendar/academic_calendar",
						reviewPolicy: "selected_write_requires_review",
						worksetReason: "manual_live_seam_seed",
					},
				],
			},
		};

		const result = applyOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			pages: [targetPage],
		});

		expect(result.retainedPages).toHaveLength(1);
		expect(result.retainedPages[0]?.pageManifest.consumerRetentionDecision).toBe(
			"retain_source_truth",
		);
		expect(result.retainedPages[0]?.pageManifest.consumerRejectionReason).toBe(
			"target_workset_retention_policy",
		);
		expect(result.summary).toMatchObject({
			retainedSourceTruthPages: 1,
			discoveryOnlyPages: 0,
			rejectedPages: 0,
		});
	});
});
