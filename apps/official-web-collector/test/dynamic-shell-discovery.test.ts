import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type DynamicShellNetworkCapture,
	discoverDynamicShellPromotedUrls,
	extractPromotedUrlsFromNetworkCaptures,
	type OfficialWebDynamicShellDiscoveryPolicy,
	resolvePromotedUrlsWithHtmlRedirects,
} from "../src/dynamic-shell-discovery";

describe("official-web-collector dynamic shell discovery", () => {
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
				"^https://lib\\.muc\\.edu\\.cn/engine2/api/data/general/",
				"^https://lib\\.muc\\.edu\\.cn/page/\\d+/all-request",
			],
			ignoredRequestUrlPatterns: [
				"^https://lib\\.muc\\.edu\\.cn/assets/",
				"^https://p\\.ananas\\.chaoxing\\.com/",
			],
			promotedUrlPatterns: [
				"^https://lib\\.muc\\.edu\\.cn/engine2/general-rest/\\d+/proxy-detail-url",
				"^https://lib\\.muc\\.edu\\.cn/db/detail",
			],
			waitForResponseUrlPatterns: [],
			waitForSelectorPatterns: [],
		};
		const captures: DynamicShellNetworkCapture[] = [
			{
				url: "https://lib.muc.edu.cn/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=1e90148874955111ed88bf78afbbbef7afd6",
				status: 200,
				contentType: "application/json;charset=UTF-8",
				bodyText: JSON.stringify({
					code: 1,
					data: {
						map: {
							"3047868": [
								{
									url: "/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=http://lib.muc.edu.cn&pageId=87948&engineInstanceId=699558",
								},
							],
							"3049665": [
								{
									url: "https://lib.muc.edu.cn/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
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
				url: "https://lib.muc.edu.cn/assets/js/index_page.min.js?v=2023030202",
				status: 200,
				contentType: "application/javascript",
				bodyText:
					"const ignored = 'https://lib.muc.edu.cn/db/detail?id=999&pageId=87948&wfwfid=24149&websiteId=64168';",
			},
			{
				url: "https://p.ananas.chaoxing.com/star3/origin/foo.png",
				status: 200,
				contentType: "image/png",
				bodyText: null,
			},
		];

		const promotedUrls = extractPromotedUrlsFromNetworkCaptures({
			baseUrl: "https://lib.muc.edu.cn/",
			captures,
			policy,
		});

		expect(promotedUrls).toEqual([
			"https://lib.muc.edu.cn/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=http://lib.muc.edu.cn&pageId=87948&engineInstanceId=699558",
			"https://lib.muc.edu.cn/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
		]);
	});

	it("resolves proxy detail urls to final detail pages before requeue", async () => {
		const fetchImpl = vi.fn(async () => ({
			text: async () =>
				`<!doctype html><html><body><script>window.location.href = "\\/engine2\\/d\\/9285452\\/699558\\/0?p=87948&amp;websiteId=64168";</script></body></html>`,
		}));

		const resolvedUrls = await resolvePromotedUrlsWithHtmlRedirects({
			urls: [
				"https://lib.muc.edu.cn/engine2/general-rest/9285452/proxy-detail-url?pageType=1&typeId=&dataTypeId=3047868&withDomain=false&domain=http://lib.muc.edu.cn&pageId=87948&engineInstanceId=699558",
				"https://lib.muc.edu.cn/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
			],
			userAgent: "collector-test/1.0",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(resolvedUrls).toEqual([
			"https://lib.muc.edu.cn/engine2/d/9285452/699558/0?p=87948&websiteId=64168",
			"https://lib.muc.edu.cn/db/detail?id=389&pageId=87948&wfwfid=24149&websiteId=64168",
		]);
	});

	it("uses event-driven wait hints and returns discovery audit details", async () => {
		const waitForResponse = vi.fn(async () => ({
			url: () =>
				"https://lib.muc.edu.cn/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
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

		vi.doMock("playwright", () => ({
			chromium: {
				launch: vi.fn(async () => ({
					newPage: async () => ({
						on: (event: string, listener: (response: never) => void) => {
							if (event === "response") {
								responseListeners.push(listener as never);
							}
						},
						goto: async () => {
							const response = {
								url: () =>
									"https://lib.muc.edu.cn/engine2/api/data/general/537849/list-tree-types-and-datas?engineInstanceId=test",
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
													url: "https://lib.muc.edu.cn/engine2/d/9285452/699558/0?p=87948",
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
						close: async () => undefined,
					}),
					close: async () => undefined,
				})),
			},
		}));

		const { loadOfficialWebConfig, findOfficialWebHostPolicy } = await import(
			"../src/official-web-core"
		);
		const bundle = loadOfficialWebConfig("muc_public");
		const hostPolicy = findOfficialWebHostPolicy(bundle, "lib.muc.edu.cn");

		expect(hostPolicy?.dynamicShellDiscovery).not.toBeNull();
		if (!hostPolicy?.dynamicShellDiscovery) {
			throw new Error("expected lib.muc.edu.cn dynamic shell policy");
		}

		const result = await discoverDynamicShellPromotedUrls({
			bundle,
			hostPolicy: {
				...hostPolicy,
				dynamicShellDiscovery: {
					...hostPolicy.dynamicShellDiscovery,
					waitForResponseUrlPatterns: ["^https://lib\\.muc\\.edu\\.cn/engine2/api/data/general/"],
					waitForSelectorPatterns: ["#app-ready"],
					networkObservationTimeoutMs: 1200,
				},
			},
			page: {
				pageManifest: {
					finalUrl: "https://lib.muc.edu.cn/",
					normalizedCanonicalUrl: "https://lib.muc.edu.cn/",
				},
			} as never,
		});

		expect(result.promotedUrls).toEqual([
			"https://lib.muc.edu.cn/engine2/d/9285452/699558/0?p=87948",
		]);
		expect(waitForResponse).toHaveBeenCalledTimes(1);
		expect(waitForSelector).toHaveBeenCalledTimes(1);
		expect(waitForLoadState).toHaveBeenCalledWith("networkidle", {
			timeout: 1200,
		});
		expect(waitForTimeout).not.toHaveBeenCalled();
		expect(result.audit.wait.matchedResponseUrl).toContain("/engine2/api/data/general/");
		expect(result.audit.wait.matchedSelector).toBe("#app-ready");
		expect(result.audit.promotedUrls).toEqual([
			"https://lib.muc.edu.cn/engine2/d/9285452/699558/0?p=87948",
		]);
		expect(result.audit.extractedUrls).toContain(
			"https://lib.muc.edu.cn/engine2/d/9285452/699558/0?p=87948",
		);
	});
});
