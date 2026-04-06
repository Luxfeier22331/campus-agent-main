import { load } from "cheerio";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writeTestConfigRoot } from "./test-support";

const CRAWL_TEST_TIMEOUT_MS = 15_000;

describe("official-web-collector robots handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function prepareCrawlSite() {
    vi.doMock("crawlee", async () => {
      const actual = await vi.importActual<typeof import("crawlee")>("crawlee");

      class FakeConfiguration {
        constructor(_input: unknown) {}
      }

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
                addRequests: async () => {},
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

    return await import("../src/index");
  }

  it(
    "retries transient robots fetch failures before allowing a 404 robots response",
    async () => {
      const fetchImplementation = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("socket hang up") }))
        .mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("temporary dns error") }))
        .mockResolvedValue({
          status: 404,
          text: async () => "",
        });
      vi.stubGlobal("fetch", fetchImplementation);

      const { configRoot, outputDir } = writeTestConfigRoot();
      const { crawlSite } = await prepareCrawlSite();
      const result = await crawlSite("campus_public", {
        configRoot,
        outputDir,
        crawlRunId: "owrun_robots_retry_success",
        maxPagesPerHost: 1,
        maxTotalPages: 1,
      });

      expect(fetchImplementation).toHaveBeenCalledTimes(3);
      expect(result.failures).toEqual([]);
      expect(result.crawlRun.status).toBe("completed");
      expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(false);
      expect(result.hostSummary.hosts[0]?.pagesFetched).toBe(1);
      expect(result.urlResults).toHaveLength(1);
    },
    CRAWL_TEST_TIMEOUT_MS,
  );

  it(
    "records nested causes when robots fetch exhausts retries and blocks the host",
    async () => {
      const fetchImplementation = vi.fn().mockRejectedValue(
        new TypeError("fetch failed", {
          cause: new Error("getaddrinfo EAI_AGAIN example.edu"),
        }),
      );
      vi.stubGlobal("fetch", fetchImplementation);

      const { configRoot, outputDir } = writeTestConfigRoot();
      const { crawlSite } = await prepareCrawlSite();
      const result = await crawlSite("campus_public", {
        configRoot,
        outputDir,
        crawlRunId: "owrun_robots_retry_failure",
        maxPagesPerHost: 1,
        maxTotalPages: 1,
      });

      expect(fetchImplementation).toHaveBeenCalledTimes(3);
      expect(result.crawlRun.status).toBe("completed_with_errors");
      expect(result.hostSummary.hosts[0]?.robotsBlocked).toBe(true);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.reason).toBe("robots_fetch_failed");
      expect(result.failures[0]?.message).toContain("getaddrinfo EAI_AGAIN");
    },
    CRAWL_TEST_TIMEOUT_MS,
  );
});
