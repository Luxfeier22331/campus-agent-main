import { load } from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOfficialWebPlannerPageForTest, writeTestConfigRoot } from "./test-support";

interface MockResponseInput {
	headers: Record<string, string>;
	request: { uniqueKey: string; url: string; userData: unknown };
}

function mockCrawlee(
	respond: (input: MockResponseInput) => {
		body?: string;
		contentType?: string | null;
		headers?: Record<string, string>;
		statusCode: number;
	},
): void {
	vi.doMock("crawlee", () => {
		class FakeConfiguration {}
		class FakeRequestQueue {
			readonly seen = new Set<string>();
		}
		interface FakeCrawlerOptions {
			maxRequestsPerCrawl: number;
			preNavigationHooks?: Array<
				(
					context: { request: MockResponseInput["request"] },
					options: { headers?: Record<string, string> },
				) => Promise<void>
			>;
			requestHandler: (context: unknown) => Promise<void>;
			requestQueue: FakeRequestQueue;
		}
		class FakeCheerioCrawler {
			private readonly options: FakeCrawlerOptions;

			constructor(options: FakeCrawlerOptions) {
				this.options = options;
			}
			async run(seedRequests: MockResponseInput["request"][]): Promise<void> {
				for (const request of seedRequests.slice(0, this.options.maxRequestsPerCrawl)) {
					const gotOptions: { headers?: Record<string, string> } = {};
					for (const hook of this.options.preNavigationHooks ?? []) {
						await hook({ request }, gotOptions);
					}
					const response = respond({ headers: gotOptions.headers ?? {}, request });
					const body = response.body ?? "";
					await this.options.requestHandler({
						request: { ...request, loadedUrl: request.url },
						response: {
							url: request.url,
							statusCode: response.statusCode,
							headers: response.headers ?? {},
						},
						contentType: { type: response.contentType ?? null },
						body,
						$: load(body || "<html></html>"),
						crawler: { addRequests: async () => undefined },
					});
				}
			}
		}
		return {
			Configuration: FakeConfiguration,
			RequestQueue: { open: vi.fn(async () => new FakeRequestQueue()) },
			CheerioCrawler: FakeCheerioCrawler,
		};
	});
}

describe("official-web freshness-aware crawl", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("uses the candidate ETag and records not_modified", async () => {
		const requestHeaders = new Map<string, Record<string, string>>();
		mockCrawlee(({ headers, request }) => {
			requestHeaders.set(request.url, headers);
			return { statusCode: 304, contentType: "text/html", headers: { etag: '"etag-v1"' } };
		});
		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun-etag",
			localArtifactsOnly: true,
			crawlCandidates: [
				buildOfficialWebPlannerPageForTest({
					discoveryMethod: "navigation",
					etag: '"etag-v1"',
					lastModified: "Tue, 31 Mar 2026 08:00:00 GMT",
					mainContentHash: "main-v1",
					responseBodyHash: "body-v1",
				}),
			],
			maxPagesPerHost: 1,
			maxTotalPages: 1,
		});
		expect(requestHeaders.get("https://www.example.edu/")).toMatchObject({
			"if-none-match": '"etag-v1"',
			"user-agent": "collector-test/1.0",
		});
		expect(result.urlResults[0]).toMatchObject({ outcome: "not_modified", httpStatus: 304 });
		expect(result.pageObservations[0]).toMatchObject({
			disposition: "not_modified",
			mainContentHash: "main-v1",
			responseBodyHash: "body-v1",
		});
	});

	it("preserves a known title for deleted pages", async () => {
		mockCrawlee(() => ({ statusCode: 404, contentType: "text/html" }));
		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun-deleted",
			localArtifactsOnly: true,
			crawlCandidates: [
				buildOfficialWebPlannerPageForTest({
					normalizedCanonicalUrl: "https://www.example.edu/calendar-guide",
					pageTitleNormalized: "校历查看方式",
				}),
			],
			maxPagesPerHost: 1,
			maxTotalPages: 1,
		});
		expect(result.pageObservations[0]).toMatchObject({
			disposition: "deleted",
			pageTitleNormalized: "校历查看方式",
		});
	});

	it("bootstraps unseen seeds without reviving disabled freshness hosts", async () => {
		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const worksets: string[][] = [];
		const crawlHosts = async (input: {
			dynamicPlan: { duePages: Array<{ normalizedCanonicalUrl: string }> };
		}) => {
			worksets.push(input.dynamicPlan.duePages.map((page) => page.normalizedCanonicalUrl));
			return {
				dynamicShellDiscoveryAudits: [],
				failures: [],
				hostSummaries: [],
				pageObservations: [],
				pages: [],
				urlResults: [],
			};
		};

		await crawlSite("campus_public", {
			configRoot,
			crawlRunId: "owrun-bootstrap-new-host",
			crawlCandidates: [],
			crawlHosts,
			freshnessKnownSeedUrls: [],
			localArtifactsOnly: true,
			outputDir,
		});
		await crawlSite("campus_public", {
			configRoot,
			crawlRunId: "owrun-known-host-not-due",
			crawlCandidates: [],
			crawlHosts,
			freshnessKnownSeedUrls: ["https://www.example.edu/"],
			localArtifactsOnly: true,
			outputDir,
		});
		await crawlSite("campus_public", {
			configRoot,
			crawlRunId: "owrun-disabled-host-freshness",
			crawlCandidates: [
				buildOfficialWebPlannerPageForTest({
					host: "disabled.example.edu",
					hostPolicy: {
						host: "disabled.example.edu",
						sourceHost: "disabled.example.edu",
					},
					normalizedCanonicalUrl: "https://disabled.example.edu/",
				}),
			],
			crawlHosts,
			freshnessKnownSeedUrls: ["https://www.example.edu/"],
			localArtifactsOnly: true,
			outputDir,
		});
		await crawlSite("campus_public", {
			configRoot,
			crawlRunId: "owrun-new-seed-on-known-host",
			crawlCandidates: [],
			crawlHosts,
			freshnessKnownSeedUrls: ["https://www.example.edu/retired-seed"],
			localArtifactsOnly: true,
			outputDir,
		});

		expect(worksets).toEqual([["https://www.example.edu/"], [], [], ["https://www.example.edu/"]]);
	});

	it("preserves configured seed identity when a due candidate has the same URL", async () => {
		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		let configuredSeedUrl: string | null | undefined;

		await crawlSite("campus_public", {
			configRoot,
			crawlRunId: "owrun-seed-and-due-candidate",
			crawlCandidates: [
				buildOfficialWebPlannerPageForTest({
					normalizedCanonicalUrl: "https://www.example.edu/",
				}),
			],
			crawlHosts: async (input: {
				dynamicPlan: {
					duePages: Array<{ configuredSeedUrl?: string | null }>;
				};
			}) => {
				configuredSeedUrl = input.dynamicPlan.duePages[0]?.configuredSeedUrl;
				return {
					dynamicShellDiscoveryAudits: [],
					failures: [],
					hostSummaries: [],
					pageObservations: [],
					pages: [],
					urlResults: [],
				};
			},
			freshnessKnownSeedUrls: [],
			localArtifactsOnly: true,
			outputDir,
		});

		expect(configuredSeedUrl).toBe("https://www.example.edu/");
	});
});
