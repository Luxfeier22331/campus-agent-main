import { load } from "cheerio";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTargetWorksetCandidatesForTest, writeTestConfigRoot } from "./test-support";

const CRAWL_TEST_TIMEOUT_MS = 30_000;

describe("source-collector official-web adapter robots handling", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	async function prepareCrawlSite(
		input: {
			simulateRobotsSkip?: boolean;
			onCrawlerOptions?: (options: Record<string, unknown>) => void;
		} = {},
	) {
		vi.doMock("crawlee", () => {
			class FakeConfiguration {}

			class FakeCheerioCrawler {
				private readonly options: {
					requestHandler: (context: unknown) => Promise<void>;
					onSkippedRequest?: (input: { url: string; reason: string }) => Promise<void>;
					respectRobotsTxtFile?: boolean | { userAgent?: string };
				};

				constructor(options: FakeCheerioCrawler["options"]) {
					this.options = options;
					input.onCrawlerOptions?.(options as Record<string, unknown>);
				}

				async run(seedRequests: Array<{ url: string; userData: unknown }>): Promise<void> {
					for (const request of seedRequests) {
						if (input.simulateRobotsSkip) {
							await this.options.onSkippedRequest?.({
								url: request.url,
								reason: "robotsTxt",
							});
							continue;
						}
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
							enqueueLinks: async () => undefined,
							crawler: {
								addRequests: async () => undefined,
							},
						});
					}
				}
			}

			return {
				Configuration: FakeConfiguration,
				RequestQueue: {
					open: vi.fn(async () => ({ processedCount: 0 })),
				},
				CheerioCrawler: FakeCheerioCrawler,
				SitemapRequestList: {
					open: vi.fn(async () => ({
						[Symbol.asyncIterator]: () => ({
							async next() {
								return { done: true, value: undefined };
							},
						}),
						markRequestHandled: vi.fn(),
						teardown: vi.fn(),
					})),
				},
			};
		});

		return await import("../src/index");
	}

	it(
		"delegates robots policy to Crawlee instead of fetching robots manually",
		async () => {
			let crawlerOptions: Record<string, unknown> | undefined;

			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await prepareCrawlSite({
				onCrawlerOptions: (options) => {
					crawlerOptions = options;
				},
			});
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_robots_delegated",
				localArtifactsOnly: true,
				crawlCandidates: buildTargetWorksetCandidatesForTest({
					runId: "owrun_robots_delegated",
				}),
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(crawlerOptions?.respectRobotsTxtFile).toMatchObject({
				userAgent: "collector-test",
			});
			expect(result.failures).toEqual([]);
			expect(result.crawlRun.status).toBe("completed");
			expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(false);
			expect(result.hostSummary.hosts[0]?.pagesFetched).toBe(1);
			expect(result.urlResults).toHaveLength(1);
		},
		CRAWL_TEST_TIMEOUT_MS,
	);

	it(
		"records robots-blocked URL results from Crawlee skipped-request callbacks",
		async () => {
			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await prepareCrawlSite({ simulateRobotsSkip: true });
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_robots_skipped",
				localArtifactsOnly: true,
				crawlCandidates: buildTargetWorksetCandidatesForTest({
					runId: "owrun_robots_skipped",
				}),
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(result.crawlRun.status).toBe("completed");
			expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(true);
			expect(result.urlResults).toHaveLength(1);
			expect(result.urlResults[0]).toMatchObject({
				outcome: "robots_blocked",
				requestedUrl: "https://www.example.edu/",
			});
		},
		CRAWL_TEST_TIMEOUT_MS,
	);
});
