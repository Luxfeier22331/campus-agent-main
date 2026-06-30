import { load } from "cheerio";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTargetWorksetControlPlaneForTest, writeTestConfigRoot } from "./test-support";

const CRAWL_TEST_TIMEOUT_MS = 30_000;

describe("official-web-collector robots handling", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	async function prepareCrawlSite(
		input: {
			robotsFind?: (
				url: string,
				proxyUrl?: string,
				options?: { timeoutMillis?: number },
			) => unknown;
		} = {},
	) {
		vi.doMock("crawlee", async () => {
			const actual = await vi.importActual<typeof import("crawlee")>("crawlee");
			const robotsFind =
				input.robotsFind ??
				vi.fn(() => ({
					getSitemaps: () => [],
					isAllowed: () => true,
					parseUrlsFromSitemaps: async () => [],
				}));

			class FakeConfiguration {}

			class FakeCheerioCrawler {
				private readonly options: {
					requestHandler: (context: unknown) => Promise<void>;
				};

				constructor(options: FakeCheerioCrawler["options"]) {
					this.options = options;
				}

				async run(seedRequests: Array<{ url: string; userData: unknown }>): Promise<void> {
					for (const request of seedRequests) {
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
					open: vi.fn(async () => ({ processedCount: 0 })),
				},
				CheerioCrawler: FakeCheerioCrawler,
				RobotsTxtFile: {
					find: robotsFind,
				},
				Sitemap: {
					load: vi.fn(async () => ({ urls: [] })),
				},
			};
		});

		return await import("../src/index");
	}

	it(
		"allows a missing robots response without retrying the robots fetch path",
		async () => {
			const robotsFind = vi.fn(() => ({
				getSitemaps: () => [],
				isAllowed: () => true,
				parseUrlsFromSitemaps: async () => [],
			}));

			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await prepareCrawlSite({ robotsFind });
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_robots_retry_success",
				localArtifactsOnly: true,
				controlPlaneClient: createTargetWorksetControlPlaneForTest({
					runId: "owrun_robots_retry_success",
				}),
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(robotsFind).toHaveBeenCalledWith("https://www.example.edu/", undefined, {
				timeoutMillis: expect.any(Number),
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
		"records nested causes when robots fetch fails and blocks the host",
		async () => {
			const robotsFind = vi.fn(() => {
				throw new TypeError("fetch failed", {
					cause: new Error("getaddrinfo EAI_AGAIN example.edu"),
				});
			});

			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await prepareCrawlSite({ robotsFind });
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_robots_retry_failure",
				localArtifactsOnly: true,
				controlPlaneClient: createTargetWorksetControlPlaneForTest({
					runId: "owrun_robots_retry_failure",
				}),
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(robotsFind).toHaveBeenCalledTimes(1);
			expect(result.crawlRun.status).toBe("completed_with_errors");
			expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(true);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]?.reason).toBe("robots_fetch_failed");
			expect(result.failures[0]?.message).toContain("getaddrinfo EAI_AGAIN");
		},
		CRAWL_TEST_TIMEOUT_MS,
	);

	it.each([
		{ reason: "robots_rate_limited", statusCode: 429 },
		{ reason: "robots_server_error", statusCode: 503 },
	] as const)(
		"records $reason when Crawlee robots discovery fails with HTTP $statusCode",
		async ({ reason, statusCode }) => {
			const robotsFind = vi.fn(() => {
				const error = new Error(`robots returned ${statusCode}`) as Error & {
					response?: { statusCode: number };
				};
				error.response = { statusCode };
				throw error;
			});

			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await prepareCrawlSite({ robotsFind });
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: `owrun_robots_${statusCode}`,
				localArtifactsOnly: true,
				controlPlaneClient: createTargetWorksetControlPlaneForTest({
					runId: `owrun_robots_${statusCode}`,
				}),
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(robotsFind).toHaveBeenCalledTimes(1);
			expect(result.crawlRun.status).toBe("completed_with_errors");
			expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(true);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				reason,
				retryable: true,
				phase: "robots",
			});
		},
		CRAWL_TEST_TIMEOUT_MS,
	);
});
