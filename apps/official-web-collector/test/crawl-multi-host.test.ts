import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "cheerio";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LEGACY_BROAD_CRAWL_ADMISSION_FOR_TEST, writeTestConfigRoot } from "./test-support";

const CRAWL_TEST_TIMEOUT_MS = 30_000;

describe("official-web-collector multi-host crawl", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it(
		"isolates request queues across hosts so later hosts are not starved by earlier maxRequestsPerCrawl state",
		async () => {
			const queueByName = new Map<string, { processedCount: number }>();
			const getQueue = (name: string | undefined) => {
				const key = name ?? "__default__";
				const existing = queueByName.get(key);
				if (existing) {
					return existing;
				}
				const created = { processedCount: 0 };
				queueByName.set(key, created);
				return created;
			};

			vi.doMock("crawlee", async () => {
				const actual = await vi.importActual<typeof import("crawlee")>("crawlee");

				class FakeConfiguration {}

				class FakeCheerioCrawler {
					private readonly options: {
						requestQueue: { processedCount: number };
						maxRequestsPerCrawl: number;
						requestHandler: (context: unknown) => Promise<void>;
					};

					constructor(options: FakeCheerioCrawler["options"]) {
						this.options = options;
					}

					async run(seedRequests: Array<{ url: string; userData: unknown }>): Promise<void> {
						const remaining = Math.max(
							0,
							this.options.maxRequestsPerCrawl - this.options.requestQueue.processedCount,
						);
						const toProcess = seedRequests.slice(0, remaining);
						this.options.requestQueue.processedCount += toProcess.length;

						for (const request of toProcess) {
							const html = `<!doctype html><html lang="zh-CN"><head><title>${new URL(request.url).hostname}</title></head><body><main><h1>${new URL(request.url).hostname}</h1><p>seed page</p></main></body></html>`;
							await this.options.requestHandler({
								request: {
									url: request.url,
									loadedUrl: request.url,
									userData: request.userData,
								},
								response: {
									url: request.url,
									statusCode: 200,
									headers: {
										"content-type": "text/html; charset=utf-8",
									},
								},
								contentType: {
									type: "text/html",
								},
								body: html,
								$: load(html),
								crawler: {
									addRequests: async () => undefined,
								},
							});
						}
					}
				}

				return {
					...actual,
					Configuration: FakeConfiguration,
					RequestQueue: {
						open: vi.fn(async (name?: string) => getQueue(name)),
					},
					CheerioCrawler: FakeCheerioCrawler,
					RobotsTxtFile: {
						from: vi.fn(() => ({
							getSitemaps: () => [],
							isAllowed: () => true,
						})),
					},
					Sitemap: {
						load: vi.fn(async () => ({ urls: [] })),
					},
				};
			});

			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					status: 404,
					text: async () => "",
				})),
			);

			const { configRoot, outputDir } = writeTestConfigRoot();
			writeFileSync(
				resolve(configRoot, "campus_public", "site.json"),
				JSON.stringify(
					{
						schema_version: "official_web_site_config.v1",
						config_version: "campus_public.v1",
						site_id: "campus_public",
						display_name: "Campus public",
						source_channel: "official_web",
						entry_host: "www.example.edu",
						allowed_hosts: ["www.example.edu", "news.example.edu"],
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
				resolve(configRoot, "campus_public", "hosts.json"),
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
								denied_path_patterns: [],
								query_param_allowlist: [],
								max_depth: 1,
								max_pages_per_run: 1,
								max_concurrency: 1,
								min_delay_ms: 0,
								respect_robots: true,
								explicit_sitemaps: [],
							},
							{
								host: "news.example.edu",
								public_kind: "content_site",
								host_group: "university_support",
								owner_label: "Example news",
								rollout_order: 20,
								enabled: true,
								seed_urls: ["https://news.example.edu/"],
								allowed_path_prefixes: ["/"],
								denied_path_patterns: [],
								query_param_allowlist: [],
								max_depth: 1,
								max_pages_per_run: 1,
								max_concurrency: 1,
								min_delay_ms: 0,
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
				resolve(configRoot, "campus_public", "seeds.json"),
				JSON.stringify(
					{
						schema_version: "official_web_seed_set.v1",
						site_id: "campus_public",
						seed_set_version: "campus_public_seeds_v1",
						seeds: [
							{
								seed_id: "www-home",
								url: "https://www.example.edu/",
								host: "www.example.edu",
								reason: "homepage",
								discovery_method: "seed",
							},
							{
								seed_id: "news-home",
								url: "https://news.example.edu/",
								host: "news.example.edu",
								reason: "homepage",
								discovery_method: "seed",
							},
						],
					},
					null,
					2,
				),
			);

			const { crawlSite } = await import("../src/index");
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_multi_host_queue",
				legacyBroadCrawlAdmission: LEGACY_BROAD_CRAWL_ADMISSION_FOR_TEST,
				hostFilter: ["www.example.edu", "news.example.edu"],
				maxPagesPerHost: 1,
				maxTotalPages: 2,
			});

			expect(result.urlResults).toHaveLength(2);
			expect(result.hostSummary.hosts).toHaveLength(2);
			expect(result.hostSummary.hosts.every((item) => item.pagesObserved === 1)).toBe(true);
			expect(result.hostSummary.hosts.every((item) => item.pagesFetched === 1)).toBe(true);
		},
		CRAWL_TEST_TIMEOUT_MS,
	);

	it("rejects unknown hosts in hostFilter instead of silently dropping them", async () => {
		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");

		await expect(
			crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_unknown_host_filter",
				legacyBroadCrawlAdmission: LEGACY_BROAD_CRAWL_ADMISSION_FOR_TEST,
				hostFilter: ["ethnology.example.edu"],
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			}),
		).rejects.toThrow("hostFilter references unknown or disabled hosts: ethnology.example.edu");
	});
});
