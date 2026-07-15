import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type DynamicShellNetworkCapture,
	discoverDynamicShellPromotedUrls,
	extractPromotedUrlsFromNetworkCaptures,
	type OfficialWebDynamicShellDiscoveryPolicy,
	resolvePromotedUrlsWithHtmlRedirects,
} from "../src/dynamic-shell-discovery";
import {
	captureDynamicShellNetwork,
	type DynamicShellCrawlerFactory,
	observeDynamicShellPage,
} from "../src/dynamic-shell-discovery-network";

describe("source-collector official-web adapter dynamic shell discovery", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("extracts promoted same-host detail urls from allowlisted JSON responses", () => {
		const policy: OfficialWebDynamicShellDiscoveryPolicy = {
			enabled: true,
			engine: "playwright",
			waitAfterLoadMs: 1500,
			networkObservationTimeoutMs: 1500,
			maxPromotedUrls: 10,
			allowedRequestUrlPatterns: [
				"^https://www\\.example\\.edu/engine2/api/data/general/",
				"^https://www\\.example\\.edu/page/\\d+/all-request",
			],
			ignoredRequestUrlPatterns: [
				"^https://www\\.example\\.edu/assets/",
				"^https://p\\.ananas\\.chaoxing\\.com/",
			],
			promotedUrlPatterns: [
				"^https://www\\.example\\.edu/engine2/general-rest/\\d+/proxy-detail-url",
				"^https://www\\.example\\.edu/db/detail",
			],
			waitForResponseUrlPatterns: [],
			waitForSelectorPatterns: [],
		};
		const captures: DynamicShellNetworkCapture[] = [
			{
				url: "https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=1e90148874955111ed88bf78afbbbef7afd6",
				status: 200,
				contentType: "application/json;charset=UTF-8",
				bodyText: JSON.stringify({
					code: 1,
					data: {
						map: {
							"3047868": [
								{
									url: "/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=https://www.example.edu&pageId=87948&engineInstanceId=699558",
								},
							],
							"3049665": [
								{
									url: "https://www.example.edu/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
								},
							],
							"3049666": [
								{
									url: "/engine2/general-rest/9285452/outer-proxy-detail-url?pageType=1&amp;pageId=87948&amp;websiteId=64168",
								},
							],
						},
					},
				}),
			},
			{
				url: "https://www.example.edu/assets/js/index_page.min.js?v=2023030202",
				status: 200,
				contentType: "application/javascript",
				bodyText:
					"const ignored = 'https://www.example.edu/db/detail?id=999&pageId=87948&wfwfid=24149&websiteId=64168';",
			},
			{
				url: "https://p.ananas.chaoxing.com/star3/origin/foo.png",
				status: 200,
				contentType: "image/png",
				bodyText: null,
			},
		];

		const promotedUrls = extractPromotedUrlsFromNetworkCaptures({
			baseUrl: "https://www.example.edu/",
			captures,
			policy,
		});

		expect(promotedUrls).toEqual([
			"https://www.example.edu/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=https://www.example.edu&pageId=87948&engineInstanceId=699558",
			"https://www.example.edu/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
		]);
	});

	it("resolves proxy detail urls to final detail pages before requeue", async () => {
		const fetchImpl = vi.fn(async () => ({
			text: async () =>
				`<!doctype html><html><body><script>window.location.href = "\\/engine2\\/d\\/9285452\\/699558\\/0?p=87948&amp;websiteId=64168";</script></body></html>`,
		}));

		const resolvedUrls = await resolvePromotedUrlsWithHtmlRedirects({
			urls: [
				"https://www.example.edu/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=https://www.example.edu&pageId=87948&engineInstanceId=699558",
				"https://www.example.edu/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
			],
			userAgent: "collector-test/1.0",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(resolvedUrls).toEqual([
			"https://www.example.edu/engine2/d/9285452/699558/0?p=87948&websiteId=64168",
			"https://www.example.edu/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
		]);
	});

	it("uses event-driven wait hints and returns discovery audit details", async () => {
		const { loadOfficialWebConfig, findOfficialWebHostPolicy } = await import(
			"../src/core/index.ts"
		);
		const bundle = loadOfficialWebConfig("muc_public");
		const hostPolicy = findOfficialWebHostPolicy(bundle, "www.example.edu");

		expect(hostPolicy?.dynamicShellDiscovery).not.toBeNull();
		if (!hostPolicy?.dynamicShellDiscovery) {
			throw new Error("expected www.example.edu dynamic shell policy");
		}
		const policy = hostPolicy.dynamicShellDiscovery;

		const result = await discoverDynamicShellPromotedUrls({
			bundle,
			hostPolicy: {
				...hostPolicy,
				dynamicShellDiscovery: {
					...policy,
					waitForResponseUrlPatterns: ["^https://www\\.example\\.edu/engine2/api/data/general/"],
					waitForSelectorPatterns: ["#app-ready"],
					networkObservationTimeoutMs: 1200,
				},
			},
			captureNetwork: async () => ({
				captures: [
					{
						url: "https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
						status: 200,
						contentType: "application/json;charset=UTF-8",
						bodyText: JSON.stringify({
							code: 1,
							data: {
								items: [
									{
										url: "https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
									},
								],
							},
						}),
					},
				],
				wait: {
					waitAfterLoadMs: policy.waitAfterLoadMs,
					networkObservationTimeoutMs: 1200,
					matchedResponseUrl:
						"https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
					matchedSelector: "#app-ready",
					usedNetworkIdleWait: false,
					usedFixedDelayWait: false,
				},
			}),
			page: {
				observation: {
					finalUrl: "https://www.example.edu/",
				},
				pageManifest: {
					normalizedCanonicalUrl: "https://www.example.edu/",
				},
			} as never,
		});

		expect(result.promotedUrls).toEqual([
			"https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
		]);
		expect(result.audit.wait.matchedResponseUrl).toContain("/engine2/api/data/general/");
		expect(result.audit.wait.matchedSelector).toBe("#app-ready");
		expect(result.audit.promotedUrls).toEqual([
			"https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
		]);
		expect(result.audit.extractedUrls).toContain(
			"https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
		);
	});

	it("captures dynamic shell responses through a Crawlee PlaywrightCrawler boundary", async () => {
		const waitForResponse = vi.fn(async () => ({
			url: () =>
				"https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
		}));
		const waitForSelector = vi.fn(async () => ({ selector: "#app-ready" }));
		const waitForLoadState = vi.fn(async () => undefined);
		const waitForTimeout = vi.fn(async () => undefined);
		const responseListeners: Array<
			(response: {
				url(): string;
				status(): number;
				headers(): Record<string, string>;
				text(): Promise<string>;
			}) => void
		> = [];
		const crawlerRun = vi.fn(
			async (
				requests: Array<{
					uniqueKey?: string;
					url: string;
				}>,
			) => {
				expect(requests).toEqual([
					{
						uniqueKey: "dynamic_shell:https://www.example.edu/",
						url: "https://www.example.edu/",
					},
				]);
				await requestHandler({
					page: {
						on: (
							event: "response",
							listener: (response: {
								url(): string;
								status(): number;
								headers(): Record<string, string>;
								text(): Promise<string>;
							}) => void,
						) => {
							if (event === "response") {
								responseListeners.push(listener);
							}
						},
						goto: async () => {
							const response = {
								url: () =>
									"https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
								status: () => 200,
								headers: () => ({
									"content-type": "application/json;charset=UTF-8",
								}),
								text: async () =>
									JSON.stringify({
										code: 1,
										data: {
											items: [
												{
													url: "https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
												},
											],
										},
									}),
							};
							for (const listener of responseListeners) {
								listener(response);
							}
						},
						waitForResponse,
						waitForSelector,
						waitForLoadState,
						waitForTimeout,
					},
				});
			},
		);
		let requestHandler: Parameters<DynamicShellCrawlerFactory>[0]["requestHandler"];

		const result = await captureDynamicShellNetwork({
			url: "https://www.example.edu/",
			policy: {
				enabled: true,
				engine: "playwright",
				waitAfterLoadMs: 1500,
				networkObservationTimeoutMs: 1200,
				maxPromotedUrls: 10,
				allowedRequestUrlPatterns: [],
				ignoredRequestUrlPatterns: [],
				promotedUrlPatterns: [],
				waitForResponseUrlPatterns: ["^https://www\\.example\\.edu/engine2/api/data/general/"],
				waitForSelectorPatterns: ["#app-ready"],
			},
			crawlerFactory: (input: Parameters<DynamicShellCrawlerFactory>[0]) => {
				requestHandler = input.requestHandler;
				return {
					run: crawlerRun,
				};
			},
		});

		expect(crawlerRun).toHaveBeenCalledTimes(1);
		expect(waitForResponse).toHaveBeenCalledTimes(1);
		expect(waitForSelector).toHaveBeenCalledTimes(1);
		expect(waitForLoadState).toHaveBeenCalledWith("networkidle", {
			timeout: 1200,
		});
		expect(waitForTimeout).not.toHaveBeenCalled();
		expect(result.wait).toEqual({
			waitAfterLoadMs: 1500,
			networkObservationTimeoutMs: 1200,
			matchedResponseUrl:
				"https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
			matchedSelector: "#app-ready",
			usedNetworkIdleWait: false,
			usedFixedDelayWait: false,
		});
		expect(result.captures).toEqual([
			{
				url: "https://www.example.edu/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
				status: 200,
				contentType: "application/json;charset=utf-8",
				bodyText: JSON.stringify({
					code: 1,
					data: {
						items: [
							{
								url: "https://www.example.edu/engine2/d/9285452/699558/0?p=87948",
							},
						],
					},
				}),
			},
		]);
	});

	it("keeps dynamic shell page observation inside one Crawlee page policy helper", async () => {
		const events: string[] = [];
		const responseListeners: Array<
			(response: {
				url(): string;
				status(): number;
				headers(): Record<string, string>;
				text(): Promise<string>;
			}) => void
		> = [];

		const result = await observeDynamicShellPage({
			url: "https://www.example.edu/",
			policy: {
				enabled: true,
				engine: "playwright",
				waitAfterLoadMs: 750,
				networkObservationTimeoutMs: 1200,
				maxPromotedUrls: 10,
				allowedRequestUrlPatterns: [],
				ignoredRequestUrlPatterns: [],
				promotedUrlPatterns: [],
				waitForResponseUrlPatterns: ["^https://www\\.example\\.edu/api/ready"],
				waitForSelectorPatterns: ["#app-ready"],
			},
			page: {
				on: (event, listener) => {
					events.push(`on:${event}`);
					responseListeners.push(listener);
				},
				goto: async (url) => {
					events.push(`goto:${url}`);
					for (const listener of responseListeners) {
						listener({
							url: () => "https://www.example.edu/api/data",
							status: () => 200,
							headers: () => ({ "content-type": "application/json" }),
							text: async () => '{"ok":true}',
						});
					}
				},
				waitForLoadState: async (state, options) => {
					events.push(`waitForLoadState:${state}:${options?.timeout ?? "none"}`);
					throw new Error("networkidle timeout");
				},
				waitForResponse: async () => {
					events.push("waitForResponse");
					throw new Error("response timeout");
				},
				waitForSelector: async () => {
					events.push("waitForSelector");
					throw new Error("selector timeout");
				},
				waitForTimeout: async (timeout) => {
					events.push(`waitForTimeout:${timeout}`);
				},
			},
		});

		expect(events).toEqual([
			"waitForResponse",
			"waitForSelector",
			"on:response",
			"goto:https://www.example.edu/",
			"waitForLoadState:networkidle:750",
			"waitForTimeout:750",
		]);
		expect(result.wait).toEqual({
			waitAfterLoadMs: 750,
			networkObservationTimeoutMs: 1200,
			matchedResponseUrl: null,
			matchedSelector: null,
			usedNetworkIdleWait: true,
			usedFixedDelayWait: true,
		});
		expect(result.captures).toEqual([
			{
				url: "https://www.example.edu/api/data",
				status: 200,
				contentType: "application/json",
				bodyText: '{"ok":true}',
			},
		]);
	});
});
