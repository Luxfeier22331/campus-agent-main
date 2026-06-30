import { load } from "cheerio";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OfficialWebControlPlaneClient, OfficialWebPlannerPageCandidate } from "../src/index";
import { writeTestConfigRoot } from "./test-support";

interface MockResponseInput {
	headers: Record<string, string>;
	request: {
		uniqueKey: string;
		url: string;
		userData: unknown;
	};
}

function buildKnownPage(
	overrides: Partial<OfficialWebPlannerPageCandidate> = {},
): OfficialWebPlannerPageCandidate {
	return {
		cadenceClass: "detail_recent",
		consumerFamily: "academic_calendar_candidate",
		contentType: "text/html",
		discoveredFromUrl: "https://www.example.edu/news/",
		discoveryMethod: "navigation",
		etag: '"etag-v1"',
		fetchProfile: "target_candidate_fetch",
		host: "www.example.edu",
		hostPolicy: {
			host: "www.example.edu",
			sourceHost: "www.example.edu",
		},
		inventoryOnly: false,
		lastChangeReason: "content_changed",
		lastChangedAt: "2026-03-31T08:00:00.000Z",
		lastFetchDisposition: "fetched",
		lastHttpStatus: 200,
		lastModified: "Tue, 31 Mar 2026 08:00:00 GMT",
		lastNotModifiedAt: null,
		lastSeenAt: "2026-03-31T08:00:00.000Z",
		lastSuccessfulRunId: "owrun_previous",
		mainContentHash: "main-v1",
		materializationPolicy: "candidate_only",
		nextEligibleFetchAt: "2026-04-01T08:00:00.000Z",
		normalizedCanonicalUrl: "https://www.example.edu/",
		pageFamily: "directory_page",
		pageTitleNormalized: "Campus public",
		priorityScore: 10,
		responseBodyHash: "body-v1",
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "selected_write_requires_review",
		selectedWriteTarget: "calendar/academic_calendar",
		siteId: "campus_public",
		targetCandidateId: "owcand_test",
		targetDeclarationVersion: "test_target_source_map_v2",
		targetId: "official-web-academic-calendar",
		targetJobId: "owtarget_test",
		worksetReason: "target_candidate_due",
		...overrides,
	};
}

function mockCrawlee(
	respond: (input: MockResponseInput) => {
		body?: string;
		contentType?: string | null;
		omitCheerio?: boolean;
		headers?: Record<string, string>;
		statusCode: number;
	},
): void {
	vi.doMock("crawlee", async () => {
		const actual = await vi.importActual<typeof import("crawlee")>("crawlee");

		class FakeConfiguration {}

		class FakeRequestQueue {
			readonly seen = new Set<string>();
		}

		class FakeCheerioCrawler {
			private readonly options: {
				maxRequestsPerCrawl: number;
				preNavigationHooks?: Array<
					(
						context: { request: { uniqueKey: string; url: string; userData: unknown } },
						gotOptions: { headers?: Record<string, string> },
					) => Promise<void>
				>;
				requestHandler: (context: unknown) => Promise<void>;
				requestQueue: FakeRequestQueue;
			};

			constructor(options: FakeCheerioCrawler["options"]) {
				this.options = options;
			}

			async run(
				seedRequests: Array<{ uniqueKey: string; url: string; userData: unknown }>,
			): Promise<void> {
				const queue = [...seedRequests];
				for (const request of seedRequests) {
					this.options.requestQueue.seen.add(request.uniqueKey);
				}

				while (
					queue.length > 0 &&
					this.options.requestQueue.seen.size <= this.options.maxRequestsPerCrawl
				) {
					const request = queue.shift();
					if (!request) {
						continue;
					}

					const gotOptions: { headers?: Record<string, string> } = {};
					for (const hook of this.options.preNavigationHooks ?? []) {
						await hook({ request }, gotOptions);
					}

					const response = respond({
						headers: gotOptions.headers ?? {},
						request,
					});
					const body = response.body ?? "";
					const cheerioRoot = response.omitCheerio ? undefined : load(body || "<html></html>");
					await this.options.requestHandler({
						request: {
							url: request.url,
							loadedUrl: request.url,
							userData: request.userData,
						},
						response: {
							url: request.url,
							statusCode: response.statusCode,
							headers: response.headers ?? {},
						},
						contentType: {
							type: response.contentType ?? null,
						},
						body,
						$: cheerioRoot,
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
				open: vi.fn(async () => new FakeRequestQueue()),
			},
			CheerioCrawler: FakeCheerioCrawler,
			RobotsTxtFile: {
				find: vi.fn(async () => ({
					getSitemaps: () => [],
					isAllowed: () => true,
					parseUrlsFromSitemaps: async () => [],
				})),
			},
			Sitemap: {
				load: vi.fn(async () => ({ urls: [] })),
			},
		};
	});
}

const CRAWL_TEST_TIMEOUT_MS = 30_000;

describe("official-web-collector incremental crawl", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it(
		"sends If-None-Match and records not_modified observations for known pages",
		async () => {
			const requestHeaders = new Map<string, Record<string, string>>();
			mockCrawlee(({ headers, request }) => {
				requestHeaders.set(request.url, headers);
				return {
					statusCode: headers["if-none-match"] === '"etag-v1"' ? 304 : 200,
					contentType: "text/html",
					headers: {
						etag: '"etag-v1"',
					},
				};
			});

			const startRun = vi.fn(async () => ({
				run: {
					runId: "owrun_incremental_etag",
					siteId: "campus_public",
					startedAt: "2026-04-01T08:00:00.000Z",
					status: "accepted",
				},
			}));
			const sendHeartbeat = vi.fn(async () => ({
				run: {
					runId: "owrun_incremental_etag",
					status: "accepted",
				},
			}));
			const resolvePlan = vi.fn(async () => ({
				plan: {
					duePages: [buildKnownPage()],
					hostFilter: ["www.example.edu"],
					maxPagesPerHost: 1,
					maxTotalPages: 1,
					resolvedAt: "2026-04-01T08:00:00.000Z",
					runIntent: "baseline" as const,
					siteId: "campus_public",
					summary: {
						duePages: 1,
						listingPages: 0,
						repairPages: 0,
						selectedHosts: 1,
						staticPages: 1,
						targetJobs: 1,
						worksetRows: 1,
					},
				},
			}));
			let finalizeInput: Parameters<OfficialWebControlPlaneClient["finalizeRun"]>[0] | undefined;
			const finalizeRun = vi.fn(
				async (input: Parameters<OfficialWebControlPlaneClient["finalizeRun"]>[0]) => {
					finalizeInput = input;
					return {
						run: {
							runId: "owrun_incremental_etag",
							status: "completed",
							finishedAt: "2026-04-01T08:00:01.000Z",
						},
					};
				},
			);
			const controlPlaneClient: OfficialWebControlPlaneClient = {
				startRun,
				sendHeartbeat,
				resolvePlan,
				finalizeRun,
			};

			const { configRoot, outputDir } = writeTestConfigRoot();
			const { crawlSite } = await import("../src/index");
			const result = await crawlSite("campus_public", {
				configRoot,
				outputDir,
				crawlRunId: "owrun_incremental_etag",
				localArtifactsOnly: true,
				controlPlaneClient,
				maxPagesPerHost: 1,
				maxTotalPages: 1,
			});

			expect(startRun).toHaveBeenCalledTimes(1);
			expect(resolvePlan).toHaveBeenCalledTimes(1);
			expect(sendHeartbeat).toHaveBeenCalledTimes(1);
			expect(finalizeRun).toHaveBeenCalledTimes(1);
			expect(requestHeaders.get("https://www.example.edu/")).toMatchObject({
				accept: "text/html,application/xhtml+xml",
				"if-none-match": '"etag-v1"',
				"user-agent": "collector-test/1.0",
			});
			expect(result.pages).toHaveLength(0);
			expect(result.urlResults).toHaveLength(1);
			expect(result.urlResults[0]).toMatchObject({
				normalizedCanonicalUrl: "https://www.example.edu/",
				outcome: "not_modified",
				httpStatus: 304,
			});
			expect(result.pageObservations).toHaveLength(1);
			expect(result.pageObservations[0]).toMatchObject({
				disposition: "not_modified",
				etag: '"etag-v1"',
				httpStatus: 304,
				lastModified: "Tue, 31 Mar 2026 08:00:00 GMT",
				mainContentHash: "main-v1",
				normalizedCanonicalUrl: "https://www.example.edu/",
				rawAssetId: null,
				rawVersionId: null,
				responseBodyHash: "body-v1",
			});

			expect(finalizeInput).toMatchObject({
				runId: "owrun_incremental_etag",
				terminalStatus: "completed",
				summary: {
					failureCount: 0,
					pagesNormalized: 0,
					rawAssetsObserved: 0,
					urlsDiscovered: 1,
					urlsFetched: 0,
				},
			});
			expect(finalizeInput?.pageObservations).toEqual([
				expect.objectContaining({
					disposition: "not_modified",
					mainContentHash: "main-v1",
					responseBodyHash: "body-v1",
				}),
			]);
		},
		CRAWL_TEST_TIMEOUT_MS,
	);

	it("records not_modified even when a 304 response does not provide a cheerio document", async () => {
		mockCrawlee(() => ({
			statusCode: 304,
			contentType: "application/octet-stream",
			omitCheerio: true,
			headers: {},
		}));

		const controlPlaneClient: OfficialWebControlPlaneClient = {
			startRun: async () => ({
				run: {
					runId: "owrun_incremental_304_without_body",
					siteId: "campus_public",
					startedAt: "2026-04-01T08:10:00.000Z",
					status: "accepted",
				},
			}),
			sendHeartbeat: async () => ({
				run: {
					runId: "owrun_incremental_304_without_body",
					status: "accepted",
				},
			}),
			resolvePlan: async () => ({
				plan: {
					duePages: [buildKnownPage()],
					hostFilter: ["www.example.edu"],
					maxPagesPerHost: 1,
					maxTotalPages: 1,
					resolvedAt: "2026-04-01T08:10:00.000Z",
					runIntent: "baseline",
					siteId: "campus_public",
					summary: {
						duePages: 1,
						listingPages: 0,
						repairPages: 0,
						selectedHosts: 1,
						staticPages: 1,
						targetJobs: 1,
						worksetRows: 1,
					},
				},
			}),
			finalizeRun: async () => ({
				run: {
					runId: "owrun_incremental_304_without_body",
					status: "completed",
					finishedAt: "2026-04-01T08:10:01.000Z",
				},
			}),
		};

		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_incremental_304_without_body",
			localArtifactsOnly: true,
			controlPlaneClient,
			maxPagesPerHost: 1,
			maxTotalPages: 1,
		});

		expect(result.urlResults[0]).toMatchObject({
			outcome: "not_modified",
			httpStatus: 304,
		});
		expect(result.pageObservations[0]).toMatchObject({
			disposition: "not_modified",
			mainContentHash: "main-v1",
			responseBodyHash: "body-v1",
		});
	});

	it("preserves non-empty known-page titles for deleted target-workset observations", async () => {
		let finalizeInput: Parameters<OfficialWebControlPlaneClient["finalizeRun"]>[0] | undefined;
		mockCrawlee(() => ({
			statusCode: 404,
			contentType: "text/html",
			headers: {},
		}));

		const controlPlaneClient: OfficialWebControlPlaneClient = {
			startRun: async () => ({
				run: {
					runId: "owrun_deleted_title_preserved",
					siteId: "campus_public",
					startedAt: "2026-04-01T08:20:00.000Z",
					status: "accepted",
				},
			}),
			sendHeartbeat: async () => ({
				run: {
					runId: "owrun_deleted_title_preserved",
					status: "accepted",
				},
			}),
			resolvePlan: async () => ({
				plan: {
					duePages: [
						buildKnownPage({
							discoveryMethod: "manual_requeue",
							lastFetchDisposition: "never_fetched",
							normalizedCanonicalUrl: "https://www.example.edu/calendar-guide",
							pageFamily: "target_candidate",
							pageTitleNormalized: "校历查看方式",
							targetCandidateId: "owcand_calendar",
							targetId: "official-web-academic-calendar",
							targetJobId: "owtarget_calendar",
						}),
					],
					hostFilter: ["www.example.edu"],
					maxPagesPerHost: 1,
					maxTotalPages: 1,
					resolvedAt: "2026-04-01T08:20:00.000Z",
					runIntent: "hot",
					siteId: "campus_public",
					summary: {
						duePages: 1,
						listingPages: 0,
						repairPages: 0,
						selectedHosts: 1,
						staticPages: 1,
						targetJobs: 1,
						worksetRows: 1,
					},
				},
			}),
			finalizeRun: async (input) => {
				finalizeInput = input;
				return {
					run: {
						runId: "owrun_deleted_title_preserved",
						status: "completed",
						finishedAt: "2026-04-01T08:20:01.000Z",
					},
				};
			},
		};

		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_deleted_title_preserved",
			localArtifactsOnly: true,
			controlPlaneClient,
			maxPagesPerHost: 1,
			maxTotalPages: 1,
		});

		expect(result.urlResults[0]).toMatchObject({
			httpStatus: 404,
			outcome: "deleted",
		});
		expect(result.pageObservations[0]).toMatchObject({
			disposition: "deleted",
			pageTitleNormalized: "校历查看方式",
		});
		expect(finalizeInput?.pageObservations).toEqual([
			expect.objectContaining({
				disposition: "deleted",
				pageTitleNormalized: "校历查看方式",
			}),
		]);
	});

	it("uses If-Modified-Since when ETag is unavailable", async () => {
		const requestHeaders = new Map<string, Record<string, string>>();
		mockCrawlee(({ headers, request }) => {
			requestHeaders.set(request.url, headers);
			return {
				statusCode: headers["if-modified-since"] === "Tue, 31 Mar 2026 08:00:00 GMT" ? 304 : 200,
				contentType: "text/html",
				headers: {},
			};
		});

		const controlPlaneClient: OfficialWebControlPlaneClient = {
			startRun: async () => ({
				run: {
					runId: "owrun_incremental_last_modified",
					siteId: "campus_public",
					startedAt: "2026-04-01T08:30:00.000Z",
					status: "accepted",
				},
			}),
			sendHeartbeat: async () => ({
				run: {
					runId: "owrun_incremental_last_modified",
					status: "accepted",
				},
			}),
			resolvePlan: async () => ({
				plan: {
					duePages: [
						buildKnownPage({
							etag: null,
						}),
					],
					hostFilter: ["www.example.edu"],
					maxPagesPerHost: 1,
					maxTotalPages: 1,
					resolvedAt: "2026-04-01T08:30:00.000Z",
					runIntent: "baseline",
					siteId: "campus_public",
					summary: {
						duePages: 1,
						listingPages: 0,
						repairPages: 0,
						selectedHosts: 1,
						staticPages: 1,
						targetJobs: 1,
						worksetRows: 1,
					},
				},
			}),
			finalizeRun: async () => ({
				run: {
					runId: "owrun_incremental_last_modified",
					status: "completed",
					finishedAt: "2026-04-01T08:30:01.000Z",
				},
			}),
		};

		const { configRoot, outputDir } = writeTestConfigRoot();
		const { crawlSite } = await import("../src/index");
		const result = await crawlSite("campus_public", {
			configRoot,
			outputDir,
			crawlRunId: "owrun_incremental_last_modified",
			localArtifactsOnly: true,
			controlPlaneClient,
			maxPagesPerHost: 1,
			maxTotalPages: 1,
		});

		expect(requestHeaders.get("https://www.example.edu/")).toMatchObject({
			"if-modified-since": "Tue, 31 Mar 2026 08:00:00 GMT",
		});
		expect(result.urlResults[0]).toMatchObject({
			outcome: "not_modified",
			httpStatus: 304,
		});
		expect(result.pageObservations[0]).toMatchObject({
			disposition: "not_modified",
			etag: null,
			lastModified: "Tue, 31 Mar 2026 08:00:00 GMT",
			mainContentHash: "main-v1",
			responseBodyHash: "body-v1",
		});
	});
});
