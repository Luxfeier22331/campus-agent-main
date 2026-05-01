import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
	buildOfficialWebCrawlPlan,
	buildOfficialWebSchedulerPlan,
	loadOfficialWebConfig,
	resolveOfficialWebConfigPaths,
} from "../src/index";

function writeMinimalConsumerDenominator(siteRoot: string): void {
	writeFileSync(
		resolve(siteRoot, "consumer-denominator.json"),
		JSON.stringify(
			{
				schema_version: "official_web_consumer_denominator.v1",
				site_id: "campus_public",
				denominator_version: "test_consumer_denominator_v1",
				enforcement_mode: "retain_matching_only",
				default_rejected_policy: "reject",
				consumer_families: [
					{
						consumer_family: "contact_directory_candidate",
						owner_surface: "contact_directory_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						materialization_policy: "candidate_only",
						page_families: [
							"article_detail",
							"directory_page",
							"contact_widget_page",
							"generic_content_page",
						],
						title_keywords: ["联系", "联系我们", "联系方式"],
						path_patterns: ["contact", "lianxi"],
						required_evidence: ["phone", "email", "location", "office_hours"],
						minimum_matched_evidence_count: 2,
						requires_keyword_or_path_match: true,
						negative_patterns: ["采购", "招标", "中标", "通知", "公告"],
						selected_write_target: "campus_services/contact_directory",
						review_policy: "selected_write_requires_review",
					},
					{
						consumer_family: "service_guide_candidate",
						owner_surface: "service_guide_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						materialization_policy: "candidate_only",
						page_families: ["article_detail", "directory_page", "generic_content_page"],
						title_keywords: ["办理", "申请", "指南", "服务"],
						path_patterns: ["service", "guide", "apply"],
						required_evidence: [
							"service_process",
							"service_entry",
							"service_material",
							"phone",
							"location",
							"office_hours",
						],
						minimum_matched_evidence_count: 2,
						requires_keyword_or_path_match: true,
						negative_patterns: ["采购", "招标", "中标", "通知", "公告"],
						selected_write_target: "campus_services/service_guide",
						review_policy: "selected_write_requires_review",
					},
					{
						consumer_family: "stable_reference_candidate",
						owner_surface: "official_web/stable_reference",
						owner_agent_or_runtime: "rag-agent",
						materialization_policy: "release_gate_required",
						page_families: ["article_detail", "directory_page", "generic_content_page"],
						title_keywords: ["学校简介", "学校概况", "现任领导", "机构设置"],
						path_patterns: ["about", "intro", "leader"],
						required_evidence: ["stable_reference"],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: false,
						negative_patterns: ["新闻", "通知", "公告"],
						selected_write_target: "official_web/stable_reference",
						review_policy: "release_gate_required",
					},
					{
						consumer_family: "notice_news_candidate",
						owner_surface: "future_notice_runtime",
						owner_agent_or_runtime: "notice-agent",
						materialization_policy: "inventory_only",
						page_families: ["article_detail"],
						title_keywords: ["新闻", "通知", "公告", "讲座", "活动"],
						path_patterns: ["news", "info"],
						required_evidence: ["notice_news"],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: false,
						negative_patterns: [],
						selected_write_target: "",
						review_policy: "inventory_only",
					},
				],
				reporting_counters: [
					"fetched_pages",
					"retained_source_truth_pages",
					"discovery_only_pages",
					"rejected_pages",
					"consumer_family_counts",
					"rejected_reason_counts",
				],
			},
			null,
			2,
		),
	);
}

function writeMinimalTargetSourceMap(siteRoot: string): void {
	writeFileSync(
		resolve(siteRoot, "target-source-map.json"),
		JSON.stringify(
			{
				schema_version: "official_web_target_source_map.v1",
				site_id: "campus_public",
				map_version: "test_target_source_map_v1",
				targets: [
					{
						target_id: "contact-directory",
						consumer_family: "contact_directory_candidate",
						owner_surface: "contact_directory_lookup",
						selected_write_target: "campus_services/contact_directory",
						source_hosts: ["www.example.edu"],
						url_patterns: ["contact"],
						title_keywords: ["Contact"],
						required_evidence: ["phone"],
						notes: "test target",
					},
				],
			},
			null,
			2,
		),
	);
}

describe("official-web-core config loading", () => {
	it("resolves muc_public repo-tracked config paths", () => {
		const paths = resolveOfficialWebConfigPaths("muc_public");

		expect(paths.siteRoot.endsWith("configs/sources/official_web/muc_public")).toBe(true);
		expect(paths.sitePath.endsWith("configs/sources/official_web/muc_public/site.json")).toBe(true);
		expect(paths.hostsPath.endsWith("configs/sources/official_web/muc_public/hosts.json")).toBe(
			true,
		);
		expect(paths.seedsPath.endsWith("configs/sources/official_web/muc_public/seeds.json")).toBe(
			true,
		);
		expect(
			paths.schedulerPolicyPath.endsWith(
				"configs/sources/official_web/muc_public/scheduler-policy.json",
			),
		).toBe(true);
		expect(
			paths.qcPolicyPath.endsWith("configs/sources/official_web/muc_public/qc-policy.json"),
		).toBe(true);
		expect(
			paths.targetSourceMapPath.endsWith(
				"configs/sources/official_web/muc_public/target-source-map.json",
			),
		).toBe(true);
	});

	it("loads muc_public and builds a stable crawl plan", () => {
		const config = loadOfficialWebConfig("muc_public");
		const plan = buildOfficialWebCrawlPlan("muc_public", {
			crawlRunId: "muc_public-TEST",
			now: new Date("2026-03-28T16:00:00.000Z"),
		});
		const schedulerPlan = buildOfficialWebSchedulerPlan("muc_public", {
			now: new Date("2026-03-28T16:00:00.000Z"),
		});

		expect(config.site.siteId).toBe("muc_public");
		expect(config.site.sourceChannel).toBe("official_web");
		expect(config.site.allowedHosts).not.toContain("my.muc.edu.cn");
		expect(config.site.allowedHosts).not.toContain("service.muc.edu.cn");
		expect(config.hosts.hosts.filter((item) => item.enabled)).toHaveLength(33);
		expect(config.seeds.seeds).toHaveLength(33);
		expect(config.projectionDeclarations.declarations.length).toBeGreaterThan(0);
		expect(
			config.projectionDeclarations.declarations.find(
				(item) => item.pageFamily === "dynamic_shell_page",
			),
		).toMatchObject({
			action: "manual_review",
		});
		expect(config.qcPolicy.qcPolicyVersion).toBe("muc_public_qc_v1");
		expect(config.qcPolicy.allowedReviewIssueCodes).toContain(
			"shell_family_requires_manual_review",
		);
		expect(config.qcPolicy.allowedReviewPageFamilies).toContain("dynamic_shell_page");
		expect(config.schedulerPolicy.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(config.targetSourceMap.mapVersion).toBe("muc_public_target_source_map_v1");
		expect(config.targetSourceMap.targets.map((target) => target.targetId)).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
			"official-web-stable-reference",
			"official-web-notice-news-inventory",
		]);
		expect(config.targetSourceMap.targets[0]).toMatchObject({
			consumerFamily: "contact_directory_candidate",
			selectedWriteTarget: "campus_services/contact_directory",
		});
		expect(config.hosts.hosts.find((item) => item.host === "www.muc.edu.cn")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "学校主页",
			rolloutOrder: 10,
		});
		expect(config.hosts.hosts.find((item) => item.host === "law.muc.edu.cn")).toMatchObject({
			hostGroup: "college",
			ownerLabel: "法学院",
			rolloutOrder: 140,
		});
		expect(plan.crawlRunId).toBe("muc_public-TEST");
		expect(plan.runIntent).toBe("baseline");
		expect(plan.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(plan.enabledHosts).toHaveLength(33);
		expect(plan.enabledHosts.find((item) => item.host === "www.muc.edu.cn")).toMatchObject({
			hostGroup: "university_core",
			ownerLabel: "学校主页",
			rolloutOrder: 10,
		});
		expect(plan.seeds).toHaveLength(33);
		expect(plan.requiredArtifacts).toEqual([
			"crawl-run.json",
			"host-summary.json",
			"url-results.jsonl",
			"failures.jsonl",
		]);
		expect(schedulerPlan.siteId).toBe("muc_public");
		expect(schedulerPlan.schedulerPolicyVersion).toBe("muc_public_scheduler_v1");
		expect(schedulerPlan.timezone).toBe("Asia/Shanghai");
		expect(schedulerPlan.lanes).toHaveLength(5);
		expect(schedulerPlan.lanes[0]).toMatchObject({
			laneId: "consumer-candidate-hot",
			runIntent: "hot",
			schedulerRunKeyPattern: "muc_public:consumer-candidate-hot:{scheduled-at-iso}",
			siteId: "muc_public",
		});
		expect(schedulerPlan.lanes[1]).toMatchObject({
			laneId: "consumer-stable-baseline",
			runIntent: "baseline",
			schedulerRunKeyPattern: "muc_public:consumer-stable-baseline:{scheduled-at-iso}",
			siteId: "muc_public",
		});
	});

	it("allows multiple scheduler lanes for the same run intent when lane ids are unique", () => {
		const schedulerPlan = buildOfficialWebSchedulerPlan("muc_public", {
			now: new Date("2026-03-28T16:00:00.000Z"),
		});

		const baselineLanes = schedulerPlan.lanes.filter((lane) => lane.runIntent === "baseline");

		expect(baselineLanes.map((lane) => lane.laneId)).toEqual([
			"consumer-stable-baseline",
			"college-single-host-baseline",
			"topic-single-host-baseline",
		]);
		expect(new Set(schedulerPlan.lanes.map((lane) => lane.laneId)).size).toBe(
			schedulerPlan.lanes.length,
		);
	});

	it("allows crawl plans to carry a run intent", () => {
		const plan = buildOfficialWebCrawlPlan("muc_public", {
			crawlRunId: "muc_public-HOT",
			runIntent: "hot",
			now: new Date("2026-03-30T00:00:00.000Z"),
		});

		expect(plan.crawlRunId).toBe("muc_public-HOT");
		expect(plan.runIntent).toBe("hot");
	});

	it("rejects seeds that target a disabled host", () => {
		const root = mkdtempSync(resolve(tmpdir(), "official-web-core-"));
		const siteRoot = resolve(root, "campus_public");
		mkdirSync(siteRoot, { recursive: true });

		writeFileSync(
			resolve(siteRoot, "site.json"),
			JSON.stringify(
				{
					schema_version: "official_web_site_config.v1",
					config_version: "test.v1",
					site_id: "campus_public",
					display_name: "Campus public",
					source_channel: "official_web",
					entry_host: "www.example.edu",
					allowed_hosts: ["www.example.edu"],
					seed_set_version: "test_seeds_v1",
					host_policy_version: "test_hosts_v1",
					crawl_policy_version: "test_crawl_v1",
					projection_policy_version: "test_projections_v1",
					credentials_mode: "public",
					user_agent: "collector-test/1.0",
					request_timeout_ms: 1000,
					request_handler_timeout_ms: 1000,
					max_request_retries: 1,
					max_redirect_hops: 3,
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "hosts.json"),
			JSON.stringify(
				{
					schema_version: "official_web_host_policy.v1",
					site_id: "campus_public",
					host_policy_version: "test_hosts_v1",
					hosts: [
						{
							host: "www.example.edu",
							public_kind: "directory_site",
							host_group: "university_core",
							owner_label: "Example homepage",
							rollout_order: 10,
							enabled: true,
							seed_urls: [],
							allowed_path_prefixes: ["/"],
							denied_path_patterns: [],
							query_param_allowlist: [],
							max_depth: 3,
							max_pages_per_run: 10,
							max_concurrency: 1,
							min_delay_ms: 100,
							respect_robots: true,
							explicit_sitemaps: [],
						},
						{
							host: "portal.example.edu",
							public_kind: "portal",
							host_group: "excluded",
							owner_label: "Example portal",
							rollout_order: 20,
							enabled: false,
							seed_urls: [],
							allowed_path_prefixes: ["/"],
							denied_path_patterns: [".*"],
							query_param_allowlist: [],
							max_depth: 0,
							max_pages_per_run: 0,
							max_concurrency: 1,
							min_delay_ms: 100,
							respect_robots: true,
							explicit_sitemaps: [],
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "seeds.json"),
			JSON.stringify(
				{
					schema_version: "official_web_seed_set.v1",
					site_id: "campus_public",
					seed_set_version: "test_seeds_v1",
					seeds: [
						{
							seed_id: "portal-home",
							url: "https://portal.example.edu/",
							host: "portal.example.edu",
							reason: "Bad seed",
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "crawl-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_crawl_policy.v1",
					site_id: "campus_public",
					crawl_policy_version: "test_crawl_v1",
					scheme_allowlist: ["https"],
					content_type_allowlist: ["text/html"],
					discovery_order: ["seed"],
					default_query_policy: "deny_all",
					default_query_param_allowlist: [],
					default_denied_path_patterns: [],
					frontier_identity_key: "normalized_canonical_url",
					expand_within_same_hostname_only: true,
					cross_host_expansion_requires_allowlist: true,
					allow_cross_host_redirect_only_if_allowlisted: true,
					respect_robots_by_default: true,
					robots_4xx_behavior: "allow",
					robots_429_behavior: "backoff_host",
					robots_5xx_behavior: "fail_closed_host",
					record_redirect_chain: true,
					use_conditional_fetch: true,
					max_total_pages_per_run: 10,
					max_total_failures_per_run: 10,
					max_runtime_minutes: 10,
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "credentials.schema.json"),
			JSON.stringify(
				{
					schema_version: "official_web_credentials_schema.v1",
					site_id: "campus_public",
					credentials_mode: "public",
					title: "test",
					description: "test",
					type: "object",
					additionalProperties: false,
					properties: {},
					required: [],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "scheduler-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_scheduler_policy.v1",
					site_id: "campus_public",
					scheduler_policy_version: "test_scheduler_v1",
					timezone: "Asia/Shanghai",
					lanes: [
						{
							lane_id: "baseline",
							enabled: true,
							run_intent: "baseline",
							cadence_minutes: 1440,
							host_filter: [],
							max_pages_per_host: 10,
							max_total_pages: 10,
							notes: "baseline coverage",
						},
						{
							lane_id: "hot",
							enabled: true,
							run_intent: "hot",
							cadence_minutes: 60,
							host_filter: ["www.example.edu"],
							max_pages_per_host: 5,
							max_total_pages: 10,
							notes: "hot listings",
						},
						{
							lane_id: "repair",
							enabled: true,
							run_intent: "repair",
							cadence_minutes: 120,
							host_filter: [],
							max_pages_per_host: 5,
							max_total_pages: 10,
							notes: "retry failures",
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "projection-declarations.json"),
			JSON.stringify(
				{
					schema_version: "official_web_projection_declarations.v1",
					site_id: "campus_public",
					projection_policy_version: "test_projections_v1",
					declarations: [],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "qc-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_qc_policy.v1",
					site_id: "campus_public",
					qc_policy_version: "test_qc_v1",
					allowed_review_issue_codes: [],
					allowed_review_page_families: [],
					host_overrides: [],
				},
				null,
				2,
			),
		);
		writeMinimalConsumerDenominator(siteRoot);
		writeMinimalTargetSourceMap(siteRoot);

		expect(() =>
			loadOfficialWebConfig("campus_public", {
				configRoot: root,
			}),
		).toThrowError(/disabled host/);
	});

	it("rejects shell-family projection declarations that emit documents directly", () => {
		const root = mkdtempSync(resolve(tmpdir(), "official-web-core-"));
		const siteRoot = resolve(root, "campus_public");
		mkdirSync(siteRoot, { recursive: true });

		writeFileSync(
			resolve(siteRoot, "site.json"),
			JSON.stringify(
				{
					schema_version: "official_web_site_config.v1",
					config_version: "test.v1",
					site_id: "campus_public",
					display_name: "Campus public",
					source_channel: "official_web",
					entry_host: "www.example.edu",
					allowed_hosts: ["www.example.edu"],
					seed_set_version: "test_seeds_v1",
					host_policy_version: "test_hosts_v1",
					crawl_policy_version: "test_crawl_v1",
					projection_policy_version: "test_projections_v1",
					credentials_mode: "public",
					user_agent: "collector-test/1.0",
					request_timeout_ms: 1000,
					request_handler_timeout_ms: 1000,
					max_request_retries: 1,
					max_redirect_hops: 3,
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "hosts.json"),
			JSON.stringify(
				{
					schema_version: "official_web_host_policy.v1",
					site_id: "campus_public",
					host_policy_version: "test_hosts_v1",
					hosts: [
						{
							host: "www.example.edu",
							public_kind: "content_site",
							host_group: "university_core",
							owner_label: "Example homepage",
							rollout_order: 10,
							enabled: true,
							seed_urls: ["https://www.example.edu/"],
							allowed_path_prefixes: ["/"],
							denied_path_patterns: [],
							query_param_allowlist: [],
							max_depth: 3,
							max_pages_per_run: 10,
							max_concurrency: 1,
							min_delay_ms: 100,
							respect_robots: true,
							explicit_sitemaps: [],
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "seeds.json"),
			JSON.stringify(
				{
					schema_version: "official_web_seed_set.v1",
					site_id: "campus_public",
					seed_set_version: "test_seeds_v1",
					seeds: [
						{
							seed_id: "home",
							url: "https://www.example.edu/",
							host: "www.example.edu",
							reason: "homepage",
							discovery_method: "seed",
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "crawl-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_crawl_policy.v1",
					site_id: "campus_public",
					crawl_policy_version: "test_crawl_v1",
					scheme_allowlist: ["https"],
					content_type_allowlist: ["text/html"],
					discovery_order: ["seed"],
					default_query_policy: "deny_all",
					default_query_param_allowlist: [],
					default_denied_path_patterns: [],
					frontier_identity_key: "normalized_canonical_url",
					expand_within_same_hostname_only: true,
					cross_host_expansion_requires_allowlist: true,
					allow_cross_host_redirect_only_if_allowlisted: true,
					respect_robots_by_default: true,
					robots_4xx_behavior: "allow",
					robots_429_behavior: "backoff_host",
					robots_5xx_behavior: "fail_closed_host",
					record_redirect_chain: true,
					use_conditional_fetch: true,
					max_total_pages_per_run: 10,
					max_total_failures_per_run: 10,
					max_runtime_minutes: 10,
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "credentials.schema.json"),
			JSON.stringify(
				{
					schema_version: "official_web_credentials_schema.v1",
					site_id: "campus_public",
					credentials_mode: "public",
					title: "test",
					description: "test",
					type: "object",
					additionalProperties: false,
					properties: {},
					required: [],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "scheduler-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_scheduler_policy.v1",
					site_id: "campus_public",
					scheduler_policy_version: "test_scheduler_v1",
					timezone: "Asia/Shanghai",
					lanes: [
						{
							lane_id: "baseline",
							enabled: true,
							run_intent: "baseline",
							cadence_minutes: 1440,
							host_filter: [],
							max_pages_per_host: 10,
							max_total_pages: 10,
							notes: "baseline coverage",
						},
						{
							lane_id: "hot",
							enabled: true,
							run_intent: "hot",
							cadence_minutes: 60,
							host_filter: ["www.example.edu"],
							max_pages_per_host: 5,
							max_total_pages: 10,
							notes: "hot listings",
						},
						{
							lane_id: "repair",
							enabled: true,
							run_intent: "repair",
							cadence_minutes: 120,
							host_filter: [],
							max_pages_per_host: 5,
							max_total_pages: 10,
							notes: "retry failures",
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "projection-declarations.json"),
			JSON.stringify(
				{
					schema_version: "official_web_projection_declarations.v1",
					site_id: "campus_public",
					projection_policy_version: "test_projections_v1",
					declarations: [
						{
							declaration_id: "dynamic-shell-primary",
							page_family: "dynamic_shell_page",
							target_corpus: "official_web",
							target_collection: "campus_public_pages",
							projection_family: "shell_review",
							document_kind: "shell",
							action: "emit_document",
						},
					],
				},
				null,
				2,
			),
		);
		writeFileSync(
			resolve(siteRoot, "qc-policy.json"),
			JSON.stringify(
				{
					schema_version: "official_web_qc_policy.v1",
					site_id: "campus_public",
					qc_policy_version: "test_qc_v1",
					allowed_review_issue_codes: [],
					allowed_review_page_families: [],
					host_overrides: [],
				},
				null,
				2,
			),
		);
		writeMinimalConsumerDenominator(siteRoot);
		writeMinimalTargetSourceMap(siteRoot);

		expect(() =>
			loadOfficialWebConfig("campus_public", {
				configRoot: root,
			}),
		).toThrowError(/manual_review/);
	});
});
