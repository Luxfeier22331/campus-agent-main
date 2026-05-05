import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(TEST_DIR, "fixtures", "pages");

export const LEGACY_BROAD_CRAWL_ADMISSION_FOR_TEST = {
	exclusionDecision: "legacy_contract_excluded",
	reason: "collector test exercises legacy crawl executor explicitly",
};

export function writeTestConfigRoot(
	options: { consumerDenominatorEnforcementMode?: "audit_only" | "retain_matching_only" } = {},
): { configRoot: string; outputDir: string } {
	const root = mkdtempSync(resolve(tmpdir(), "official-web-collector-"));
	const configRoot = resolve(root, "official_web");
	const siteRoot = resolve(configRoot, "campus_public");
	mkdirSync(siteRoot, { recursive: true });

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
						query_param_allowlist: ["id"],
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
				enforcement_mode: options.consumerDenominatorEnforcementMode ?? "audit_only",
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
						negative_patterns: [
							"采购",
							"招标",
							"中标",
							"中选",
							"比选",
							"竞价",
							"结果公示",
							"公示期",
							"公开招聘",
							"招聘启事",
							"新闻",
							"通知",
							"公告",
						],
						selected_write_target: "campus_services/contact_directory",
						review_policy: "selected_write_requires_review",
					},
					{
						consumer_family: "service_guide_candidate",
						owner_surface: "service_guide_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						materialization_policy: "candidate_only",
						page_families: ["article_detail", "directory_page", "generic_content_page"],
						title_keywords: ["办理", "申请", "补办", "挂失", "指南", "服务"],
						path_patterns: ["service", "guide", "card"],
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
						negative_patterns: [
							"采购",
							"招标",
							"中标",
							"中选",
							"比选",
							"竞价",
							"结果公示",
							"公示期",
							"公开招聘",
							"招聘启事",
							"新闻",
							"通知",
							"公告",
						],
						selected_write_target: "campus_services/service_guide",
						review_policy: "selected_write_requires_review",
					},
					{
						consumer_family: "academic_calendar_candidate",
						owner_surface: "academic_calendar_lookup",
						owner_agent_or_runtime: "calendar-agent",
						materialization_policy: "candidate_only",
						page_families: ["article_detail", "generic_content_page"],
						title_keywords: ["校历", "教学周", "放假安排", "补课安排", "节假日安排"],
						path_patterns: ["calendar", "xiaoli", "jwc", "jwgl"],
						required_evidence: ["calendar_arrangement"],
						optional_evidence: [],
						minimum_matched_evidence_count: 1,
						requires_keyword_or_path_match: true,
						negative_patterns: ["新闻", "通知公告", "采购", "招标", "中标"],
						selected_write_target: "calendar/academic_calendar",
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
						negative_patterns: ["新闻", "通知", "公告", "讲座"],
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
					"rejected_pages",
					"consumer_family_counts",
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
						url_hints: ["contact", "lianxi"],
						title_hints: ["联系", "联系我们", "联系方式"],
						required_evidence: ["phone"],
						optional_evidence: ["email", "location", "office_hours"],
						retention_policy: "retain_source_truth",
						review_policy: "selected_write_requires_review",
						materialization_policy: "candidate_only",
						inventory_only: false,
						notes: "Test target for public contact-directory evidence.",
					},
					{
						target_id: "campus-services-service-guide",
						consumer_family: "service_guide_candidate",
						owner_surface: "service_guide_lookup",
						selected_write_target: "campus_services/service_guide",
						source_hosts: ["www.example.edu"],
						url_hints: ["service", "guide", "card"],
						title_hints: ["办理", "申请", "补办", "挂失", "指南", "服务"],
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
						notes: "Test target for public service-guide evidence.",
					},
					{
						target_id: "official-web-academic-calendar",
						consumer_family: "academic_calendar_candidate",
						owner_surface: "academic_calendar_lookup",
						selected_write_target: "calendar/academic_calendar",
						source_hosts: ["www.example.edu"],
						url_hints: ["calendar", "xiaoli", "jwc", "jwgl"],
						title_hints: ["校历", "教学周", "放假安排", "补课安排", "节假日安排"],
						required_evidence: ["calendar_arrangement"],
						optional_evidence: [],
						retention_policy: "retain_source_truth",
						review_policy: "selected_write_requires_review",
						materialization_policy: "candidate_only",
						inventory_only: false,
						notes: "Test target for source-backed academic calendar facts.",
					},
					{
						target_id: "official-web-stable-reference",
						consumer_family: "stable_reference_candidate",
						owner_surface: "official_web/stable_reference",
						selected_write_target: "official_web/stable_reference",
						source_hosts: ["www.example.edu"],
						url_hints: ["about", "intro", "leader"],
						title_hints: ["学校简介", "学校概况", "现任领导", "机构设置"],
						required_evidence: ["stable_reference"],
						optional_evidence: [],
						retention_policy: "retain_source_truth",
						review_policy: "release_gate_required",
						materialization_policy: "release_gate_required",
						inventory_only: false,
						notes: "Test target for stable institutional reference evidence.",
					},
					{
						target_id: "official-web-institutional-rules",
						consumer_family: "regulation_candidate",
						owner_surface: "regulations/institutional_rules",
						selected_write_target: "regulations/institutional_rules",
						source_hosts: ["www.example.edu"],
						url_hints: ["gzzd", "rule"],
						title_hints: ["办法", "规定", "细则"],
						required_evidence: ["regulation_text"],
						optional_evidence: [],
						retention_policy: "retain_source_truth",
						review_policy: "release_gate_required",
						materialization_policy: "release_gate_required",
						inventory_only: false,
						notes: "Test target for institutional rules evidence.",
					},
					{
						target_id: "official-web-notice-news-inventory",
						consumer_family: "notice_news_candidate",
						owner_surface: "future_notice_runtime",
						selected_write_target: "",
						source_hosts: ["www.example.edu"],
						url_hints: ["news", "info"],
						title_hints: ["新闻", "通知", "公告", "讲座", "活动"],
						required_evidence: ["notice_news"],
						optional_evidence: [],
						retention_policy: "inventory_only",
						review_policy: "inventory_only",
						materialization_policy: "inventory_only",
						inventory_only: true,
						notes: "Test inventory-only target for notice/news evidence.",
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
						inventory_id: "campus-contact-directory",
						admission_target_id: "campus-services-contact-directory",
						target_label: "Campus contact directory",
						consumer_family: "contact_directory_candidate",
						owner_surface: "contact_directory_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						selected_write_target: "campus_services/contact_directory",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/contact/"],
						required_fields: ["phone", "source_url"],
						optional_fields: ["email", "location", "office_hours"],
						required_evidence: ["phone"],
						optional_evidence: ["email", "location", "office_hours"],
						materialization_policy: "candidate_only",
						review_policy: "selected_write_requires_review",
						inventory_only: false,
						release_blockers: ["no_preview_evidence"],
						preview_status: "candidate",
						notes: "Test inventory entry for contact-directory evidence.",
					},
					{
						inventory_id: "campus-service-guide",
						admission_target_id: "campus-services-service-guide",
						target_label: "Campus service guide",
						consumer_family: "service_guide_candidate",
						owner_surface: "service_guide_lookup",
						owner_agent_or_runtime: "campus-services-agent",
						selected_write_target: "campus_services/service_guide",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/service/"],
						required_fields: ["service_name", "process_steps", "source_url"],
						optional_fields: [
							"service_entry",
							"required_materials",
							"phone",
							"location",
							"office_hours",
						],
						required_evidence: ["service_process"],
						optional_evidence: [
							"service_entry",
							"service_material",
							"phone",
							"location",
							"office_hours",
						],
						materialization_policy: "candidate_only",
						review_policy: "selected_write_requires_review",
						inventory_only: false,
						release_blockers: ["no_preview_evidence"],
						preview_status: "candidate",
						notes: "Test inventory entry for service-guide evidence.",
					},
					{
						inventory_id: "campus-academic-calendar",
						admission_target_id: "official-web-academic-calendar",
						target_label: "Campus academic calendar",
						consumer_family: "academic_calendar_candidate",
						owner_surface: "academic_calendar_lookup",
						owner_agent_or_runtime: "calendar-agent",
						selected_write_target: "calendar/academic_calendar",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/calendar/"],
						required_fields: [
							"academic_year_label",
							"term_label",
							"date_range",
							"calendar_arrangement",
							"source_url",
							"source_version_evidence",
						],
						optional_fields: ["holiday_name", "week_index", "class_day_pattern"],
						required_evidence: ["calendar_arrangement"],
						optional_evidence: [],
						materialization_policy: "candidate_only",
						review_policy: "selected_write_requires_review",
						inventory_only: false,
						release_blockers: ["no_preview_evidence"],
						preview_status: "candidate",
						notes: "Test inventory entry for academic calendar evidence.",
					},
					{
						inventory_id: "campus-stable-reference",
						admission_target_id: "official-web-stable-reference",
						target_label: "Campus stable reference",
						consumer_family: "stable_reference_candidate",
						owner_surface: "official_web/stable_reference",
						owner_agent_or_runtime: "rag-agent",
						selected_write_target: "official_web/stable_reference",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/about/"],
						required_fields: ["title", "body", "source_url"],
						required_evidence: ["stable_reference"],
						optional_evidence: [],
						optional_fields: [],
						materialization_policy: "release_gate_required",
						review_policy: "release_gate_required",
						inventory_only: false,
						release_blockers: ["no_preview_evidence"],
						preview_status: "candidate",
						notes: "Test inventory entry for stable reference evidence.",
					},
					{
						inventory_id: "campus-institutional-rules",
						admission_target_id: "official-web-institutional-rules",
						target_label: "Campus institutional rules",
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
						required_evidence: ["regulation_text"],
						optional_evidence: [],
						optional_fields: [],
						materialization_policy: "release_gate_required",
						review_policy: "release_gate_required",
						inventory_only: false,
						release_blockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						preview_status: "candidate",
						notes: "Test inventory entry for institutional rules evidence.",
					},
					{
						inventory_id: "campus-notice-news-inventory",
						admission_target_id: "official-web-notice-news-inventory",
						target_label: "Campus notice and news inventory",
						consumer_family: "notice_news_candidate",
						owner_surface: "future_notice_runtime",
						owner_agent_or_runtime: "notice-agent",
						selected_write_target: "",
						source_hosts: ["www.example.edu"],
						source_urls: ["https://www.example.edu/news/"],
						required_fields: ["title", "source_url"],
						required_evidence: ["notice_news"],
						optional_evidence: [],
						optional_fields: [],
						materialization_policy: "inventory_only",
						review_policy: "inventory_only",
						inventory_only: true,
						release_blockers: ["not_in_serving_plan"],
						preview_status: "excluded",
						notes: "Test inventory-only entry for notice/news evidence.",
					},
				],
			},
			null,
			2,
		),
	);
	mkdirSync(resolve(siteRoot, "source-packs"), { recursive: true });
	writeFileSync(
		resolve(siteRoot, "source-packs", "tool-driven-first-slice.v1.json"),
		JSON.stringify(
			{
				schema_version: "official_web_source_pack_manifest.v1",
				site_id: "campus_public",
				source_pack_id: "tool-driven-first-slice.v1",
				entries: [
					{
						entry_id: "campus-service-guide",
						url: "https://www.example.edu/service/",
						content_family: "campus_service_guide",
						source_kind: "html_page",
						answer_bearing: true,
						demand_ids: ["owsp-campus-service-guide"],
						owner_surfaces: ["service_guide_lookup"],
						release_targets: ["campus_services/service_guide"],
						expected_facts: ["service_process"],
						composition_group: null,
						composition_role: null,
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						eval_questions: ["怎么办理？"],
					},
					{
						entry_id: "campus-academic-calendar",
						url: "https://www.example.edu/calendar/",
						content_family: "academic_calendar_reference",
						source_kind: "html_page",
						answer_bearing: true,
						demand_ids: ["owsp-campus-academic-calendar"],
						owner_surfaces: ["academic_calendar_lookup"],
						release_targets: ["calendar/academic_calendar"],
						expected_facts: ["calendar_arrangement"],
						composition_group: null,
						composition_role: null,
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						eval_questions: ["今天第几教学周？"],
					},
					{
						entry_id: "institutional-rules-column",
						url: "https://www.example.edu/rules/",
						content_family: "institutional_policy_reference",
						source_kind: "html_page",
						answer_bearing: false,
						demand_ids: ["owsp-campus-rules-column"],
						owner_surfaces: ["regulations/institutional_rules"],
						release_targets: ["regulations/institutional_rules"],
						expected_facts: ["regulation_text"],
						composition_group: null,
						composition_role: null,
						capture_policy: "one_time",
						refresh_posture: "manifest_refresh_only",
						extraction_gate: "deterministic_source_backed",
						target_workset_expansion: "same_host_manual_requeue",
						eval_questions: [],
					},
				],
			},
			null,
			2,
		),
	);

	return {
		configRoot,
		outputDir: resolve(root, "output"),
	};
}

function readFixture(name: string): string {
	return readFileSync(resolve(FIXTURE_DIR, name), "utf-8").trim();
}

export const SAMPLE_PAGE_HTML = readFixture("sample-page.html");
export const SAMPLE_HOME_PAGE_HTML = readFixture("sample-home-page.html");
export const SAMPLE_DIRECTORY_PAGE_HTML = readFixture("sample-directory-page.html");
export const SAMPLE_ROSTER_DIRECTORY_PAGE_HTML = readFixture("sample-roster-directory-page.html");
export const SAMPLE_ORGANIZATION_DIRECTORY_PAGE_HTML = readFixture(
	"sample-organization-directory-page.html",
);
export const SAMPLE_NEWS_HOME_PAGE_HTML = readFixture("sample-news-home-page.html");
export const SAMPLE_NEWS_ARTICLE_DETAIL_HTML = readFixture("sample-news-article-detail.html");
export const SAMPLE_HISTORY_HOME_CARD_PAGE_HTML = readFixture("sample-history-home-card-page.html");
export const SAMPLE_LAW_DENSE_ROSTER_DIRECTORY_PAGE_HTML = readFixture(
	"sample-law-dense-roster-directory-page.html",
);
export const SAMPLE_LAW_TABMENU_DIRECTORY_PAGE_HTML = readFixture(
	"sample-law-tabmenu-directory-page.html",
);
export const SAMPLE_DT_LIST_PAGE_HTML = readFixture("sample-dt-list-page.html");
export const SAMPLE_FEATURE_LIST_PAGE_HTML = readFixture("sample-feature-list-page.html");
export const SAMPLE_CONTACT_CARD_PAGE_HTML = readFixture("sample-contact-card-page.html");
export const SAMPLE_DYNAMIC_SHELL_PAGE_HTML = readFixture("sample-dynamic-shell-page.html");
export const SAMPLE_IMAGE_STRUCTURAL_SHELL_PAGE_HTML = readFixture(
	"sample-image-structural-shell-page.html",
);
export const SAMPLE_STRUCTURAL_SHELL_PAGE_HTML = readFixture("sample-structural-shell-page.html");
export const SAMPLE_SPORT_CARD_HOME_PAGE_HTML = readFixture("sample-sport-card-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_HTML = readFixture("sample-xiaoyou-home-page.html");
export const SAMPLE_XIAOYOU_HOME_PAGE_TITLE_ATTR_HTML = readFixture(
	"sample-xiaoyou-home-page-title-attr.html",
);
export const SAMPLE_XIAOYOU_LIST_PAGE_HTML = readFixture("sample-xiaoyou-list-page.html");
export const SAMPLE_VISIBLE_CONTENT_DYNAMIC_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>人才培养 - Campus public</title>
    <script>
      window.__PAGE_DATA__ = {};
      $(".detail-shell").load("/api/training");
    </script>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <a href="/index.htm">首页</a>
        <a href="/rcpy.htm">人才培养</a>
      </nav>
    </header>
    <div class="page-shell">
      <div class="left-nav sidebar">
        <a href="/bkjy.htm">本科教育</a>
        <a href="/yjsjy.htm">研究生教育</a>
      </div>
      <div class="detail-shell">
        <div class="hq-p">
          中央民族大学研究生教育始于上世纪五十年代，始终坚持厚基础、宽视野、重创新的人才培养理念，全面深化研究生教育综合改革。
        </div>
        <div class="hq-p">
          学校围绕学科建设、队伍建设、人才培养和科学研究等目标制定专项计划，持续提升学生创新能力与国际化能力。
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();
export const SAMPLE_VISIBLE_CONTENT_PANEL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>体育学院 - Campus public</title>
    <script>
      window.__INITIAL_STATE__ = {};
    </script>
  </head>
  <body>
    <header>
      <div class="site-nav">
        <a href="/index.htm">首页</a>
        <a href="/xygk.htm">学院概况</a>
      </div>
    </header>
    <div class="homepage-shell">
      <div class="panel-body">
        <div class="news-panel">
          <div class="panel-title">学院新闻</div>
          <div class="news-card">
            <a href="/info/1062/6423.htm">温暖入心，关怀入寝：体育学院开展春季学期宿舍走访</a>
            <div class="summary">学院围绕学生发展与宿舍安全开展专项走访，并形成后续服务安排。</div>
            <div class="publish-date">2026-03-30</div>
          </div>
          <div class="news-card">
            <a href="/info/1062/6343.htm">凝心聚力谋发展 砥砺奋进启新程：体育学院召开年度工作会</a>
            <div class="summary">会议围绕党建思政、学科建设与训练工作安排年度重点任务。</div>
            <div class="publish-date">2026-03-18</div>
          </div>
        </div>
        <div class="notice-panel">
          <div class="panel-title">通知公告</div>
          <div class="notice-card">
            <a href="/info/1063/6543.htm">中央民族大学体育学院2026年体育硕士招生调剂方案</a>
            <div class="summary">根据上级和学校有关规定，体育学院拟接受 2026 年体育硕士专业学位调剂生。</div>
            <div class="publish-date">2026-03-30</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`.trim();
export const SAMPLE_ONCLICK_NEWS_HOME_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>信息工程学院 - Campus public</title>
  </head>
  <body>
    <header>
      <nav class="top-nav">
        <a href="/index.htm">网站首页</a>
        <a href="/xygk/xyjj.htm">学院概况</a>
      </nav>
    </header>
    <main class="page-main">
      <section class="news-list">
        <ul>
          <li class="news-item">
            <div class="news-time">2026-02-12</div>
            <div class="news-content">
              <dl>
                <dt>
                  <a href="javascript:void(0)" onclick="opennews('info/1040/6035.htm')">
                    教育部重点实验室与中国中医科学院中国医史文献研究所开展学术交流
                  </a>
                </dt>
                <dd>
                  <a class="news-detail" href="javascript:void(0)" onclick="opennews('info/1040/6035.htm')">
                    详细内容&gt;
                  </a>
                </dd>
              </dl>
            </div>
          </li>
          <li class="news-item">
            <div class="news-time">2026-01-01</div>
            <div class="news-content">
              <dl>
                <dt>
                  <a href="javascript:void(0)" onclick="opennews('info/1040/6036.htm')">
                    AI赋能交叉学科，一校三址共享优质教学资源
                  </a>
                </dt>
                <dd>
                  <a class="news-detail" href="javascript:void(0)" onclick="opennews('info/1040/6036.htm')">
                    详细内容&gt;
                  </a>
                </dd>
              </dl>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </body>
</html>
`.trim();

export const SAMPLE_ENGINE2_BOOTSTRAP_DETAIL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>关于举办2026年春季线上图采会活动通知</title>
  </head>
  <body>
    <div id="index">
      <div class="info-box">
        <div class="txt-c">
          <h1 class="title fz-title">关于举办2026年春季线上图采会活动通知</h1>
          <div class="time fz-time">
            <span class="mg-r16">发布时间：2026-03-18 09:44:37</span>
          </div>
        </div>
        <div class="content noteContent richtext" id="editor1">
          <!-- 当前内容加载异常，请确认您当前网络是否连通互联网或者联系门户管理员！-->
        </div>
      </div>
    </div>
    <div id="audioDiv" style="z-index: 9000; display: none;">
      <div class="grid-music-container f-usn">
        <div class="m-music-lyric-wrap">
          <div class="inner">
            <ul class="js-music-lyric-content">
              <li class="eof">暂无歌词...</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <script>
      var app = {
        renderRichtext: function (_targetId, _content) {},
      };
      var bootstrap = {
        data: {
          "content": "<p>各位师生/读者：</p><p>春启新篇，书香聚力。2026年春季线上图采会将于3月23日至3月27日在线上举办。</p><p>具体操作方式如下：点击右上角登录，输入用户名后进入图采会完成荐购。</p><p><a href=\\"https://d.cxstar.com/\\" target=\\"_blank\\">https://d.cxstar.com/</a></p>",
          "1": {
            "pageType": 1,
            "value": "关于举办2026年春季线上图采会活动通知",
            "key": "标题",
            "url": ""
          }
        }
      };
      var content = bootstrap.data.content;
      app.renderRichtext("editor1", content);
    </script>
  </body>
</html>
`.trim();

export const SAMPLE_ENGINE2_THIN_DETAIL_PAGE_HTML = `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>资源动态详情</title>
  </head>
  <body>
    <div class="info-box">
      <h1 class="title fz-title">资源动态详情</h1>
      <div class="time fz-time">
        <span>发布时间：2026-03-31 11:17:42</span>
      </div>
      <div class="content noteContent richtext" id="editor1"></div>
    </div>
  </body>
</html>
`.trim();
