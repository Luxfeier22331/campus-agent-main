import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOfficialWebConfig } from "official-web-core";
import { describe, expect, it } from "vitest";
import { evaluateOfficialWebConsumerDenominator } from "../src/consumer-denominator";
import { crawlSite } from "../src/crawl";
import {
	createCollectedPageArtifactForTest,
	readJsonArtifact,
	SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
	writeTestConfigRoot,
} from "./crawl-test-support";

const SAMPLE_CONTACT_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>联系我们 - Campus public</title>
  </head>
  <body>
    <main>
      <h1>联系我们</h1>
      <p>信息化建设管理处校园卡管理中心</p>
      <p>海淀校区办公地点：中慧楼二层，联系电话：010-68933381。</p>
      <p>丰台校区办公地点：智慧中心一层大厅，联系电话：010-83878225。</p>
      <p>办公时间：周一至周五 08:30-11:30，14:00-17:00。</p>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_SERVICE_GUIDE_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>校园卡挂失补办指南 - Campus public</title>
  </head>
  <body>
    <main>
      <h1>校园卡挂失补办指南</h1>
      <p>校园卡丢失后应先办理挂失，再补办新卡。</p>
      <p>办理流程：通过企业微信或民大通 APP 挂失后，到学生自助补卡机补办。</p>
      <p>办理地点：海淀校区中慧楼二层校园卡管理中心；丰台校区智慧中心一层大厅。</p>
      <p>咨询电话：010-68933381。</p>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_PROCUREMENT_NOTICE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>中央民族大学海淀校区家属区供电智能管理系统维保服务项目中选结果公示</title>
  </head>
  <body>
    <main>
      <h1>中央民族大学海淀校区家属区供电智能管理系统维保服务项目中选结果公示</h1>
      <p>采购人：中央民族大学。</p>
      <p>项目地点：海淀校区家属区。</p>
      <p>联系电话：010-68933381。</p>
      <p>本公示期为三个工作日。</p>
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
			"contact_directory_candidate",
			"service_guide_candidate",
			"stable_reference_candidate",
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
							consumer_family: "contact_directory_candidate",
							owner_surface: "contact_directory_lookup",
							owner_agent_or_runtime: "campus-services-agent",
							materialization_policy: "emit_directly",
							page_families: ["directory_page"],
							title_keywords: ["联系"],
							path_patterns: [],
							required_evidence: ["phone"],
							negative_patterns: [],
							selected_write_target: "campus_services/contact_directory",
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

	it("classifies contact and service pages with evidence-bearing consumer matches", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const contactPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_contact",
			requestedUrl: "https://www.example.edu/contact.htm",
			finalUrl: "https://www.example.edu/contact.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_CONTACT_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});
		const servicePage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_service",
			requestedUrl: "https://www.example.edu/card-service.htm",
			finalUrl: "https://www.example.edu/card-service.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_SERVICE_GUIDE_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const contactEvaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page: contactPage,
		});
		const serviceEvaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page: servicePage,
		});

		expect(contactEvaluation.retentionDecision).toBe("retain_source_truth");
		expect(contactEvaluation.consumerMatches.map((item) => item.consumerFamily)).toContain(
			"contact_directory_candidate",
		);
		expect(contactEvaluation.consumerMatches[0]?.matchedEvidence).toContain("phone");
		expect(serviceEvaluation.retentionDecision).toBe("retain_source_truth");
		expect(serviceEvaluation.consumerMatches.map((item) => item.consumerFamily)).toContain(
			"service_guide_candidate",
		);
		expect(
			serviceEvaluation.consumerMatches.find(
				(item) => item.consumerFamily === "service_guide_candidate",
			)?.matchedEvidence,
		).toContain("service_process");
	});

	it("does not classify procurement notices as selected-write contact or service candidates", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_procurement",
			requestedUrl: "https://www.example.edu/info/1358/29171.htm",
			finalUrl: "https://www.example.edu/info/1358/29171.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_PROCUREMENT_NOTICE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});

		expect(evaluation.consumerMatches.map((item) => item.consumerFamily)).not.toContain(
			"contact_directory_candidate",
		);
		expect(evaluation.consumerMatches.map((item) => item.consumerFamily)).not.toContain(
			"service_guide_candidate",
		);
	});

	it("requires configured keyword/path match and enough evidence before selected-write candidate retention", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const contactRule = bundle.consumerDenominator.consumerFamilies.find(
			(item) => item.consumerFamily === "contact_directory_candidate",
		);
		if (!contactRule) {
			throw new Error("contact rule is required");
		}
		const ruleTuning = contactRule as typeof contactRule & {
			minimumMatchedEvidenceCount: number;
			requiresKeywordOrPathMatch: boolean;
		};
		ruleTuning.minimumMatchedEvidenceCount = 2;
		ruleTuning.requiresKeywordOrPathMatch = true;

		const evidenceOnlyPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_evidence_only",
			requestedUrl: "https://www.example.edu/info/unit.htm",
			finalUrl: "https://www.example.edu/info/unit.htm",
			declaredCanonicalUrl: null,
			responseBody: `
        <html><head><title>信息化服务</title></head><body><main>
          <h1>信息化服务</h1>
          <p>办公地点：中慧楼二层，联系电话：010-68933381。</p>
        </main></body></html>
      `,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});
		const insufficientEvidencePage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_insufficient_evidence",
			requestedUrl: "https://www.example.edu/contact.htm",
			finalUrl: "https://www.example.edu/contact.htm",
			declaredCanonicalUrl: null,
			responseBody: `
        <html><head><title>联系我们</title></head><body><main>
          <h1>联系我们</h1>
          <p>联系电话：010-68933381。</p>
        </main></body></html>
      `,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		expect(
			evaluateOfficialWebConsumerDenominator({
				consumerDenominator: bundle.consumerDenominator,
				page: evidenceOnlyPage,
			}).consumerMatches.map((item) => item.consumerFamily),
		).not.toContain("contact_directory_candidate");
		expect(
			evaluateOfficialWebConsumerDenominator({
				consumerDenominator: bundle.consumerDenominator,
				page: insufficientEvidencePage,
			}).consumerMatches.map((item) => item.consumerFamily),
		).not.toContain("contact_directory_candidate");
	});

	it("filters non-consumer pages from retained source truth and reports denominator counters", async () => {
		const { configRoot, outputDir } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const contactPage = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_filter",
			requestedUrl: "https://www.example.edu/contact.htm",
			finalUrl: "https://www.example.edu/contact.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_CONTACT_PAGE_HTML,
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
		});

		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_consumer_filter",
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
				pages: [contactPage, rejectedPage],
			}),
		});

		expect(result.pages).toHaveLength(1);
		expect(result.pages[0]?.pageManifest.normalizedCanonicalUrl).toBe(
			"https://www.example.edu/contact.htm",
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
			contact_directory_candidate: 1,
		});
		expect(crawlRun.counters.consumerDenominator.rejectedReasonCounts).toMatchObject({
			no_consumer_denominator_match: 1,
		});
	});
});
