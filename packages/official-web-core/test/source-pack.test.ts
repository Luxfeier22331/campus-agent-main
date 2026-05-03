import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadOfficialWebConfig } from "../src/index";

function writeSourcePackFixtureRoot(): string {
	const root = mkdtempSync(resolve(tmpdir(), "official-web-source-pack-"));
	const siteRoot = resolve(root, "campus_public");
	mkdirSync(resolve(siteRoot, "source-packs"), { recursive: true });

	writeFileSync(
		resolve(siteRoot, "site.json"),
		JSON.stringify(
			{
				schema_version: "official_web_site_config.v1",
				config_version: "campus_public.v1",
				site_id: "campus_public",
				display_name: "Campus public",
				source_channel: "official_web",
				entry_host: "www.example.edu",
				allowed_hosts: ["www.example.edu"],
				seed_set_version: "campus_public_seeds_v1",
				host_policy_version: "campus_public_hosts_v1",
				crawl_policy_version: "campus_public_crawl_policy_v1",
				projection_policy_version: "campus_public_projection_v1",
				credentials_mode: "public",
				user_agent: "collector-test/1.0",
				request_timeout_ms: 15000,
				request_handler_timeout_ms: 30000,
				max_request_retries: 2,
				max_redirect_hops: 5,
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
				host_policy_version: "campus_public_hosts_v1",
				hosts: [
					{
						host: "www.example.edu",
						public_kind: "directory_site",
						host_group: "university_core",
						owner_label: "Example homepage",
						rollout_order: 10,
						enabled: true,
						seed_urls: ["https://www.example.edu/"],
						allowed_path_prefixes: ["/"],
						denied_path_patterns: ["^/login"],
						query_param_allowlist: [],
						max_depth: 2,
						max_pages_per_run: 10,
						max_concurrency: 1,
						min_delay_ms: 1000,
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
				seed_set_version: "campus_public_seeds_v1",
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
				crawl_policy_version: "campus_public_crawl_policy_v1",
				scheme_allowlist: ["https"],
				content_type_allowlist: ["text/html"],
				discovery_order: ["seed", "navigation"],
				default_query_policy: "deny_all",
				default_query_param_allowlist: [],
				default_denied_path_patterns: ["^/search"],
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
				title: "public",
				description: "public",
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
				scheduler_policy_version: "campus_public_scheduler_v1",
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
						notes: "baseline coverage for all enabled hosts",
					},
					{
						lane_id: "hot",
						enabled: true,
						run_intent: "hot",
						cadence_minutes: 30,
						host_filter: ["www.example.edu"],
						max_pages_per_host: 5,
						max_total_pages: 10,
						notes: "hot listing and recent detail refresh",
					},
					{
						lane_id: "repair",
						enabled: true,
						run_intent: "repair",
						cadence_minutes: 120,
						host_filter: [],
						max_pages_per_host: 5,
						max_total_pages: 10,
						notes: "repair failed fetches",
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
				qc_policy_version: "campus_public_qc_v1",
				allowed_review_issue_codes: [],
				allowed_review_page_families: [],
				host_overrides: [],
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
				projection_policy_version: "campus_public_projection_v1",
				declarations: [],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "consumer-denominator.json"),
		JSON.stringify(
			{
				schema_version: "official_web_consumer_denominator.v1",
				site_id: "campus_public",
				denominator_version: "campus_public_consumer_denominator_v1",
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
						required_evidence: ["phone"],
						optional_evidence: ["email", "location", "office_hours"],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: true,
						negative_patterns: ["采购", "通知", "公告"],
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
						required_evidence: ["service_process"],
						optional_evidence: [
							"service_entry",
							"service_material",
							"phone",
							"location",
							"office_hours",
						],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: true,
						negative_patterns: ["采购", "通知", "公告"],
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
						optional_evidence: [],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: false,
						negative_patterns: ["新闻", "通知", "公告"],
						selected_write_target: "official_web/stable_reference",
						review_policy: "release_gate_required",
					},
					{
						consumer_family: "regulation_candidate",
						owner_surface: "regulations/institutional_rules",
						owner_agent_or_runtime: "rag-agent",
						materialization_policy: "release_gate_required",
						page_families: ["article_detail", "generic_content_page"],
						title_keywords: ["办法", "规定", "细则", "制度"],
						path_patterns: ["gzzd", "rule", "policy"],
						required_evidence: ["regulation_text"],
						optional_evidence: [],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: false,
						negative_patterns: ["新闻", "通知", "公告"],
						selected_write_target: "regulations/institutional_rules",
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
						optional_evidence: [],
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
	writeFileSync(
		resolve(siteRoot, "target-source-map.json"),
		JSON.stringify(
			{
				schema_version: "official_web_target_source_map.v2",
				site_id: "campus_public",
				map_version: "campus_public_target_source_map_v2",
				targets: [
					{
						target_id: "campus-services-contact-directory",
						consumer_family: "contact_directory_candidate",
						owner_surface: "contact_directory_lookup",
						selected_write_target: "campus_services/contact_directory",
						source_hosts: ["www.example.edu"],
						url_hints: ["contact"],
						title_hints: ["联系", "联系方式"],
						required_evidence: ["phone"],
						optional_evidence: ["email", "location", "office_hours"],
						retention_policy: "retain_source_truth",
						review_policy: "selected_write_requires_review",
						materialization_policy: "candidate_only",
						inventory_only: false,
						notes: "contact",
					},
					{
						target_id: "campus-services-service-guide",
						consumer_family: "service_guide_candidate",
						owner_surface: "service_guide_lookup",
						selected_write_target: "campus_services/service_guide",
						source_hosts: ["www.example.edu"],
						url_hints: ["service", "guide"],
						title_hints: ["办理", "指南"],
						required_evidence: ["service_process"],
						optional_evidence: [
							"service_entry",
							"service_material",
							"phone",
							"location",
							"office_hours",
						],
						retention_policy: "retain_source_truth",
						review_policy: "selected_write_requires_review",
						materialization_policy: "candidate_only",
						inventory_only: false,
						notes: "service",
					},
					{
						target_id: "official-web-stable-reference",
						consumer_family: "stable_reference_candidate",
						owner_surface: "official_web/stable_reference",
						selected_write_target: "official_web/stable_reference",
						source_hosts: ["www.example.edu"],
						url_hints: ["about"],
						title_hints: ["学校简介"],
						required_evidence: ["stable_reference"],
						optional_evidence: [],
						retention_policy: "retain_source_truth",
						review_policy: "release_gate_required",
						materialization_policy: "release_gate_required",
						inventory_only: false,
						notes: "stable",
					},
					{
						target_id: "official-web-institutional-rules",
						consumer_family: "regulation_candidate",
						owner_surface: "regulations/institutional_rules",
						selected_write_target: "regulations/institutional_rules",
						source_hosts: ["www.example.edu"],
						url_hints: ["rule"],
						title_hints: ["办法"],
						required_evidence: ["regulation_text"],
						optional_evidence: [],
						retention_policy: "retain_source_truth",
						review_policy: "release_gate_required",
						materialization_policy: "release_gate_required",
						inventory_only: false,
						notes: "institutional rules",
					},
					{
						target_id: "official-web-notice-news-inventory",
						consumer_family: "notice_news_candidate",
						owner_surface: "future_notice_runtime",
						selected_write_target: "",
						source_hosts: ["www.example.edu"],
						url_hints: ["news"],
						title_hints: ["新闻", "通知"],
						required_evidence: ["notice_news"],
						optional_evidence: [],
						retention_policy: "inventory_only",
						review_policy: "inventory_only",
						materialization_policy: "inventory_only",
						inventory_only: true,
						notes: "inventory",
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		resolve(siteRoot, "target-inventory.json"),
		JSON.stringify(
			{
				schema_version: "official_web_target_inventory.v1",
				site_id: "campus_public",
				inventory_version: "campus_public_target_inventory_v1",
				entries: [
					{
						inventory_id: "contact-entry",
						admission_target_id: "campus-services-contact-directory",
						target_label: "Contact entry",
						consumer_family: "contact_directory_candidate",
						owner_surface: "contact_directory_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						selected_write_target: "campus_services/contact_directory",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/contact"],
						required_fields: ["organization_name", "source_url"],
						optional_fields: ["email", "location", "office_hours"],
						required_evidence: ["phone"],
						optional_evidence: ["email", "location", "office_hours"],
						materialization_policy: "candidate_only",
						review_policy: "selected_write_requires_review",
						inventory_only: false,
						release_blockers: ["no_preview_evidence"],
						preview_status: "candidate",
						notes: "contact inventory",
					},
					{
						inventory_id: "rules-entry",
						admission_target_id: "official-web-institutional-rules",
						target_label: "Institutional rules entry",
						consumer_family: "regulation_candidate",
						owner_surface: "regulations/institutional_rules",
						owner_agent_or_runtime: "rag-agent",
						selected_write_target: "regulations/institutional_rules",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/rules/policy"],
						required_fields: [
							"reference_title",
							"normalized_content_summary",
							"authoritative_source_url",
							"release_scope",
							"source_version_evidence",
						],
						optional_fields: [],
						required_evidence: ["regulation_text"],
						optional_evidence: [],
						materialization_policy: "release_gate_required",
						review_policy: "release_gate_required",
						inventory_only: false,
						release_blockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						preview_status: "candidate",
						notes: "rules inventory",
					},
				],
			},
			null,
			2,
		),
	);

	writeFileSync(
		resolve(siteRoot, "source-packs", "tool-driven-first-slice.v1.json"),
		JSON.stringify(
			{
				schema_version: "official_web_source_pack_manifest.v1",
				site_id: "campus_public",
				source_pack_id: "tool-driven-first-slice.v1",
				entries: [
					{
						entry_id: "campus-card-guide",
						url: "https://www.example.edu/service/campus-card",
						content_family: "campus_service_guide",
						source_kind: "html_page",
						answer_bearing: true,
						demand_ids: ["owsp-it-campus-card-guide"],
						owner_surfaces: ["service_guide_lookup"],
						release_targets: ["campus_services/service_guide"],
						expected_facts: ["service_process", "phone"],
						composition_group: null,
						composition_role: null,
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						eval_questions: ["校园卡丢了怎么办？"],
					},
					{
						entry_id: "campus-card-contact",
						url: "https://www.example.edu/service/campus-card",
						content_family: "campus_service_guide",
						source_kind: "html_page",
						answer_bearing: true,
						demand_ids: ["owsp-it-campus-card-guide", "owsp-it-campus-card-contact"],
						owner_surfaces: ["service_guide_lookup", "contact_directory_lookup"],
						release_targets: [
							"campus_services/service_guide",
							"campus_services/contact_directory",
						],
						expected_facts: ["service_process", "phone", "location"],
						composition_group: null,
						composition_role: null,
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						eval_questions: ["校园卡服务电话是多少？"],
					},
					{
						entry_id: "disclosure-process",
						url: "https://www.example.edu/disclosure/process",
						content_family: "campus_service_guide",
						source_kind: "download_reference_page",
						answer_bearing: true,
						demand_ids: ["owsp-info-disclosure-apply"],
						owner_surfaces: ["service_guide_lookup"],
						release_targets: ["campus_services/service_guide"],
						expected_facts: ["service_process", "service_material"],
						composition_group: "information_disclosure",
						composition_role: "procedure_source",
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						eval_questions: ["信息公开怎么申请？"],
					},
				],
			},
			null,
			2,
		),
	);

	return root;
}

describe("official web source pack config", () => {
	it("loads a source-pack manifest from the canonical site path", () => {
		const configRoot = writeSourcePackFixtureRoot();

		const config = loadOfficialWebConfig("campus_public", { configRoot });

		expect(config.sourcePackManifest).toMatchObject({
			schemaVersion: "official_web_source_pack_manifest.v1",
			siteId: "campus_public",
			sourcePackId: "tool-driven-first-slice.v1",
		});
		expect(config.sourcePackManifest.entries).toHaveLength(3);
		expect(config.sourcePackManifest.entries[1]).toMatchObject({
			entryId: "campus-card-contact",
			ownerSurfaces: ["service_guide_lookup", "contact_directory_lookup"],
			releaseTargets: [
				"campus_services/service_guide",
				"campus_services/contact_directory",
			],
		});
	});

	it("fails closed when a multi-owner source-pack row cannot map to compatible release targets", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-multi-owner",
							url: "https://www.example.edu/service/campus-card",
							content_family: "campus_service_guide",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-it-campus-card-guide"],
							owner_surfaces: ["service_guide_lookup", "contact_directory_lookup"],
							release_targets: ["campus_services/service_guide"],
							expected_facts: ["service_process", "phone"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							eval_questions: ["校园卡服务电话是多少？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/multi-owner row must map each owner surface to a compatible release target/u,
		);
	});

	it("fails closed when a source-pack row tries to admit notice/news runtime", () => {
		const configRoot = writeSourcePackFixtureRoot();
		const manifestPath = resolve(
			configRoot,
			"campus_public",
			"source-packs",
			"tool-driven-first-slice.v1.json",
		);

		writeFileSync(
			manifestPath,
			JSON.stringify(
				{
					schema_version: "official_web_source_pack_manifest.v1",
					site_id: "campus_public",
					source_pack_id: "tool-driven-first-slice.v1",
					entries: [
						{
							entry_id: "bad-news-open",
							url: "https://www.example.edu/news/123",
							content_family: "public_notice_news",
							source_kind: "html_page",
							answer_bearing: true,
							demand_ids: ["owsp-latest-news"],
							owner_surfaces: ["future_notice_runtime"],
							release_targets: ["official_web/fresh_news"],
							expected_facts: ["notice_news"],
							composition_group: null,
							composition_role: null,
							capture_policy: "one_time",
							refresh_posture: "manifest_refresh_only",
							extraction_gate: "deterministic_source_backed",
							eval_questions: ["最近有什么新闻？"],
						},
					],
				},
				null,
				2,
			),
		);

		expect(() => loadOfficialWebConfig("campus_public", { configRoot })).toThrow(
			/attempts to open official_web\/fresh_news or official_web\/news_archive/u,
		);
	});
});
