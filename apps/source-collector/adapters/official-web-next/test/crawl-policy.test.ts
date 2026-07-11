import { load } from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficialWebNextArtifactStore, OfficialWebNextCaptureInput } from "../src/index.ts";

class InMemoryArtifactStore implements OfficialWebNextArtifactStore {
	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}) {
		return {
			objectKey: input.objectKey,
			contentSha256: `test-sha-${input.objectKey}`,
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

describe("official-web-next crawl policy", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("uses robots and default user-agent unless the caller overrides them", async () => {
		const crawlerOptions = await runWithMockedCrawlee({});

		expect(crawlerOptions.respectRobotsTxtFile).toEqual({
			userAgent: "campus-agent-official-web-next/0.1",
		});
		expect(crawlerOptions.requestHeaders).toMatchObject({
			"user-agent": "campus-agent-official-web-next/0.1",
			accept: "text/html,application/xhtml+xml",
		});
	});

	it("does not let undefined partial policy fields override defaults", async () => {
		const crawlerOptions = await runWithMockedCrawlee({
			crawlPolicy: {
				respectRobots: undefined,
				userAgent: undefined,
			},
		});

		expect(crawlerOptions.respectRobotsTxtFile).toEqual({
			userAgent: "campus-agent-official-web-next/0.1",
		});
		expect(crawlerOptions.requestHeaders).toMatchObject({
			"user-agent": "campus-agent-official-web-next/0.1",
		});
	});

	it("honors explicit crawl policy overrides", async () => {
		const crawlerOptions = await runWithMockedCrawlee({
			crawlPolicy: {
				respectRobots: false,
				userAgent: "collector-test/1.0",
			},
		});

		expect(crawlerOptions.respectRobotsTxtFile).toBe(false);
		expect(crawlerOptions.requestHeaders).toMatchObject({
			"user-agent": "collector-test/1.0",
		});
	});
});

async function runWithMockedCrawlee(input: {
	crawlPolicy?: OfficialWebNextCaptureInput["crawlPolicy"];
}) {
	const crawlerOptions: {
		requestHeaders?: Record<string, string>;
		respectRobotsTxtFile?: unknown;
	} = {};
	vi.doMock("crawlee", async () => {
		const actual = await vi.importActual<typeof import("crawlee")>("crawlee");
		class FakeConfiguration {}
		class FakeCheerioCrawler {
			private readonly options: {
				preNavigationHooks?: Array<
					(
						context: { request: { uniqueKey: string; url: string; userData: unknown } },
						gotOptions: { headers?: Record<string, string> },
					) => Promise<void>
				>;
				requestHandler: (context: unknown) => Promise<void>;
				respectRobotsTxtFile?: unknown;
			};

			constructor(options: FakeCheerioCrawler["options"]) {
				this.options = options;
				crawlerOptions.respectRobotsTxtFile = options.respectRobotsTxtFile;
			}

			async run(requests: Array<{ uniqueKey: string; url: string; userData: unknown }>) {
				const request = requests[0];
				const gotOptions: { headers?: Record<string, string> } = {};
				for (const hook of this.options.preNavigationHooks ?? []) {
					await hook({ request }, gotOptions);
				}
				crawlerOptions.requestHeaders = gotOptions.headers;
				const body =
					"<!doctype html><html><head><title>Home</title></head><body><main><p>Text</p></main></body></html>";
				await this.options.requestHandler({
					request: {
						url: request.url,
						loadedUrl: request.url,
						uniqueKey: request.uniqueKey,
						userData: request.userData,
					},
					response: {
						url: request.url,
						statusCode: 200,
						headers: {
							"content-type": "text/html",
						},
					},
					contentType: {
						type: "text/html",
					},
					body,
					$: load(body),
				});
			}
		}
		return {
			...actual,
			Configuration: FakeConfiguration,
			CheerioCrawler: FakeCheerioCrawler,
		};
	});

	const { runOfficialWebNextCapture: runCapture } = await import("../src/index.ts");
	await runCapture({
		artifactStore: new InMemoryArtifactStore(),
		crawlPolicy: input.crawlPolicy,
		limits: {
			maxConcurrency: 1,
			maxRequests: 1,
			sameDomainDelayMs: 0,
		},
		runId: "ow-next-run-policy",
		siteId: "muc_public",
		workset: [
			{
				discoveryMethod: "seed",
				host: "www.example.edu",
				url: "https://www.example.edu/",
			},
		],
	});
	return crawlerOptions;
}
