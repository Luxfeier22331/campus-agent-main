import { load } from "cheerio";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SAMPLE_DYNAMIC_SHELL_PAGE_HTML,
  SAMPLE_NEWS_ARTICLE_DETAIL_HTML,
  writeTestConfigRoot,
} from "./test-support";

const CRAWL_TEST_TIMEOUT_MS = 30_000;

describe("official-web-collector dynamic shell crawl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it(
    "requeues promoted detail pages from dynamic shell discovery without changing shell source-truth semantics",
    async () => {
      const promotedDetailHtml = SAMPLE_NEWS_ARTICLE_DETAIL_HTML.replace(
        "</body>",
        `
        <nav class="noise-links">
          <a href="https://www.example.edu?pageId=87948&wfwfid=24149&websiteId=64168">首页</a>
          <a href="https://www.example.edu/engine2/general/more?appId=537849&websiteId=64168&wfwfid=24149&pageId=87948&typeId=3049665&currentBranch=0">最新资源</a>
        </nav>
      </body>`,
      );

    vi.doMock("crawlee", async () => {
      const actual = await vi.importActual<typeof import("crawlee")>("crawlee");

      class FakeConfiguration {
        constructor(_input: unknown) {}
      }

      class FakeRequestQueue {
        readonly seen = new Set<string>();
      }

      class FakeCheerioCrawler {
        private readonly options: {
          requestQueue: FakeRequestQueue;
          maxRequestsPerCrawl: number;
          requestHandler: (context: unknown) => Promise<void>;
        };

        constructor(options: FakeCheerioCrawler["options"]) {
          this.options = options;
        }

        async run(seedRequests: Array<{ url: string; uniqueKey: string; userData: unknown }>): Promise<void> {
          const queue = [...seedRequests];
          for (const request of seedRequests) {
            this.options.requestQueue.seen.add(request.uniqueKey);
          }

          while (queue.length > 0 && this.options.requestQueue.seen.size <= this.options.maxRequestsPerCrawl) {
            const request = queue.shift();
            if (!request) {
              continue;
            }

            const html =
              request.url === "https://www.example.edu/"
                ? SAMPLE_DYNAMIC_SHELL_PAGE_HTML
                : promotedDetailHtml;

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
                addRequests: async (requests: Array<{ url: string; uniqueKey: string; userData: unknown }>) => {
                  for (const nextRequest of requests) {
                    if (this.options.requestQueue.seen.has(nextRequest.uniqueKey)) {
                      continue;
                    }
                    this.options.requestQueue.seen.add(nextRequest.uniqueKey);
                    queue.push(nextRequest);
                  }
                },
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
              enabled: true,
              seed_urls: ["https://www.example.edu/"],
              allowed_path_prefixes: ["/"],
              denied_path_patterns: ["^/login"],
              query_param_allowlist: [
                "appId",
                "currentBranch",
                "p",
                "pageId",
                "typeId",
                "websiteId",
                "wfwfid",
              ],
              max_depth: 2,
              max_pages_per_run: 10,
              max_concurrency: 1,
              min_delay_ms: 0,
              respect_robots: true,
              explicit_sitemaps: [],
              dynamic_shell_discovery: {
                enabled: true,
                engine: "playwright",
                wait_after_load_ms: 100,
                max_promoted_urls: 5,
                allowed_request_url_patterns: ["^https://www\\.example\\.edu/api/"],
                ignored_request_url_patterns: [],
                promoted_url_patterns: ["^https://www\\.example\\.edu/engine2/d/"],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const promotedDetailUrl = "https://www.example.edu/engine2/d/9285452/699558/0?p=87948";
    const dynamicShellDiscoverer = vi.fn(async () => ({
      promotedUrls: [promotedDetailUrl],
      audit: {
        sourceUrl: "https://www.example.edu/",
        host: "www.example.edu",
        wait: {
          waitAfterLoadMs: 100,
          networkObservationTimeoutMs: 100,
          matchedResponseUrl: "https://www.example.edu/api/content",
          matchedSelector: null,
          usedNetworkIdleFallback: false,
          usedFixedDelayFallback: false,
        },
        captures: [
          {
            url: "https://www.example.edu/api/content",
            status: 200,
            contentType: "application/json",
            ignored: false,
            allowed: true,
          },
        ],
        extractedUrls: [promotedDetailUrl],
        resolvedUrls: [promotedDetailUrl],
        admissions: [
          {
            url: promotedDetailUrl,
            admitted: true,
            normalizedUrl: promotedDetailUrl,
            reason: "admitted",
            host: "www.example.edu",
          },
        ],
        promotedUrls: [promotedDetailUrl],
      },
    }));

    const { crawlSite } = await import("../src/index");
    const result = await crawlSite("campus_public", {
      configRoot,
      outputDir,
      crawlRunId: "owrun_dynamic_shell",
      maxPagesPerHost: 5,
      maxTotalPages: 5,
      dynamicShellDiscoverer,
    });

    expect(dynamicShellDiscoverer).toHaveBeenCalledTimes(1);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page) => page.pageManifest.normalizedCanonicalUrl)).toEqual([
      "https://www.example.edu/",
      promotedDetailUrl,
    ]);
    expect(result.pages[0]?.pageManifest.pageFamily).toBe("dynamic_shell_page");
    expect(result.pages[1]?.pageManifest.pageFamily).toBe("article_detail");
    expect(
      result.urlResults.some(
        (item) =>
          item.normalizedCanonicalUrl === promotedDetailUrl &&
          item.discoveryMethod === "manual_requeue" &&
          item.discoveredFromUrl === "https://www.example.edu/",
      ),
    ).toBe(true);
    expect(
      result.urlResults.some(
        (item) =>
          item.normalizedCanonicalUrl ===
            "https://www.example.edu/?pageid=87948&websiteid=64168&wfwfid=24149" ||
          item.normalizedCanonicalUrl ===
            "https://www.example.edu/engine2/general/more?appid=537849&currentbranch=0&pageid=87948&typeid=3049665&websiteid=64168&wfwfid=24149",
      ),
    ).toBe(false);
    expect(result.artifactPaths["dynamic-shell-discovery-audit.jsonl"]).toBeDefined();
    const auditLines = readFileSync(
      result.artifactPaths["dynamic-shell-discovery-audit.jsonl"]!,
      "utf-8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{
      promotedUrls: string[];
      sourceUrl: string;
    }>;
      expect(auditLines).toEqual([
        expect.objectContaining({
          sourceUrl: "https://www.example.edu/",
          promotedUrls: [promotedDetailUrl],
        }),
      ]);
    },
    CRAWL_TEST_TIMEOUT_MS,
  );
});
