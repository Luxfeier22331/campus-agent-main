import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { loadOfficialWebConfig } from "../src/index";
import {
	writeMinimalConsumerDenominator,
	writeMinimalSourcePackManifest,
	writeMinimalTargetInventory,
	writeMinimalTargetSourceMap,
} from "./config-fixtures";

export function registerOfficialWebConfigPart02() {
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
		writeMinimalTargetInventory(siteRoot);
		writeMinimalSourcePackManifest(siteRoot);

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
		writeMinimalTargetInventory(siteRoot);
		writeMinimalSourcePackManifest(siteRoot);

		expect(() =>
			loadOfficialWebConfig("campus_public", {
				configRoot: root,
			}),
		).toThrowError(/manual_review/);
	});

	it("fails closed when target inventory references an unknown admission target", () => {
		const root = mkdtempSync(resolve(tmpdir(), "official-web-core-"));
		const siteRoot = resolve(root, "muc_public");
		cpSync(resolve("..", "..", "configs/sources/official_web/muc_public"), siteRoot, {
			recursive: true,
		});

		const inventoryPath = resolve(siteRoot, "target-inventory.json");
		const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
		inventory.entries[0].admission_target_id = "missing-target";
		writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));

		expect(() =>
			loadOfficialWebConfig("muc_public", {
				configRoot: root,
			}),
		).toThrowError(/unknown admission target/);
	});

	it("fails closed when a non-inventory target inventory entry lacks source urls", () => {
		const root = mkdtempSync(resolve(tmpdir(), "official-web-core-"));
		const siteRoot = resolve(root, "muc_public");
		cpSync(resolve("..", "..", "configs/sources/official_web/muc_public"), siteRoot, {
			recursive: true,
		});

		const inventoryPath = resolve(siteRoot, "target-inventory.json");
		const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
		inventory.entries[0].source_urls = [];
		writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));

		expect(() =>
			loadOfficialWebConfig("muc_public", {
				configRoot: root,
			}),
		).toThrowError(/must define source_urls/);
	});
}
