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

const SAMPLE_INFORMATION_DISCLOSURE_CONTACT_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>联系方式 - 中央民族大学信息公开</title>
  </head>
  <body>
    <main>
      <h1>联系方式</h1>
      <p>地址：北京市海淀区中关村南大街27号 中央民族大学 100081</p>
      <p>电话：010-68932551</p>
      <p>传真：010-68933983</p>
    </main>
  </body>
</html>
`.trim();

const SAMPLE_STUDENT_CAMPUS_CARD_SERVICE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>学生校园卡服务 - 信息化建设管理处</title>
  </head>
  <body>
    <main>
      <h1>学生校园卡服务</h1>
      <p>服务名称：领取新卡。根据领取通知，学院新生负责人带有效证件和领卡说明领取。</p>
      <p>服务名称：挂失。校园卡丢失后，请立即通过圈存机或民大通APP“我的一卡通”模块进行挂失。</p>
      <p>服务名称：校园卡补办。校园卡损坏或丢失后，先将卡挂失，挂失后可以到自助补卡机上进行补卡。</p>
      <p>服务名称：交易流水查询。用户可持有效证件到校园卡管理中心前台进行查询和咨询。</p>
      <p>校园卡管理中心位置：海淀校区在中慧楼2层，电话：010-68933381。丰台校区在智慧中心一层，电话：010-83878225。</p>
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

const SAMPLE_SERVICE_MATERIAL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <title>依申请公开信息申请表下载 - Campus public</title>
  </head>
  <body>
    <main>
      <h1>依申请公开信息申请表下载</h1>
      <p>申请人可下载中央民族大学依申请公开信息申请表和审批表。</p>
      <p>附件：中央民族大学依申请公开信息申请表。</p>
    </main>
  </body>
</html>
`.trim();

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
			"contact_directory_candidate",
			"service_guide_candidate",
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
			ownerSurface: "academic_calendar_lookup",
			selectedWriteTarget: "calendar/academic_calendar",
		});
		expect(calendarMatch?.matchedEvidence).toEqual(["calendar_arrangement"]);
	});

	it("retains service material pages as source-truth candidates without making material release-blocking", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_service_material",
			requestedUrl: "https://www.example.edu/apply-form.htm",
			finalUrl: "https://www.example.edu/apply-form.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_SERVICE_MATERIAL_PAGE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});

		const serviceMatch = evaluation.consumerMatches.find(
			(item) => item.consumerFamily === "service_guide_candidate",
		);
		expect(evaluation.retentionDecision).toBe("retain_source_truth");
		expect(serviceMatch?.matchedEvidence).toEqual(["service_material"]);
		expect(
			bundle.consumerDenominator.consumerFamilies.find(
				(item) => item.consumerFamily === "service_guide_candidate",
			)?.requiredEvidence,
		).toEqual(["service_process"]);
	});

	it("classifies information-disclosure contact pages as contact candidates", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_xxgk_contact",
			requestedUrl: "https://www.example.edu/xxgk/lxfs.htm",
			finalUrl: "https://www.example.edu/xxgk/lxfs.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_INFORMATION_DISCLOSURE_CONTACT_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});
		const contactMatch = evaluation.consumerMatches.find(
			(item) => item.consumerFamily === "contact_directory_candidate",
		);

		expect(evaluation.retentionDecision).toBe("retain_source_truth");
		expect(contactMatch?.matchedEvidence).toEqual(["phone", "location"]);
	});

	it("classifies student campus-card service pages as service-guide candidates", () => {
		const { configRoot } = writeTestConfigRoot({
			consumerDenominatorEnforcementMode: "retain_matching_only",
		});
		const bundle = loadOfficialWebConfig("campus_public", { configRoot });
		const page = createCollectedPageArtifactForTest({
			configRoot,
			crawlRunId: "owrun_consumer_campus_card",
			requestedUrl: "https://www.example.edu/info/1027/1127.htm",
			finalUrl: "https://www.example.edu/info/1027/1127.htm",
			declaredCanonicalUrl: null,
			responseBody: SAMPLE_STUDENT_CAMPUS_CARD_SERVICE_HTML,
			fetchedAt: "2026-05-01T10:00:00.000Z",
		});

		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: bundle.consumerDenominator,
			page,
		});
		const serviceMatch = evaluation.consumerMatches.find(
			(item) => item.consumerFamily === "service_guide_candidate",
		);

		expect(evaluation.retentionDecision).toBe("retain_source_truth");
		expect(serviceMatch?.matchedEvidence).toEqual([
			"service_process",
			"service_entry",
			"service_material",
			"phone",
			"location",
		]);
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
						targetCandidateId: "owcand_contact_home",
						targetId: "campus-services-contact-directory",
						targetDeclarationVersion: "campus_public_target_source_map_v2",
						consumerFamily: "contact_directory_candidate",
						retentionPolicy: "retain_source_truth",
						materializationPolicy: "candidate_only",
						selectedWriteTarget: "campus_services/contact_directory",
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
