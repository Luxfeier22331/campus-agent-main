import { describe, expect, it, vi } from "vitest";

import {
	buildAttachmentDownloadRequest,
	runAttachmentCrawleeDownloads,
} from "../src/attachment-crawlee-runner.js";

describe("authenticated notice attachment Crawlee runner", () => {
	it("builds stable internal Crawlee request identities without leaking source URLs", () => {
		const request = buildAttachmentDownloadRequest({
			attachmentUrl: "https://portal.example.edu/download?id=1&notice_id=355120",
			cacheKey: "portal_internal:https://portal.example.edu/download?id=1&notice_id=355120",
			fetchMode: "portal_internal",
			siteId: "example_internal_portal",
		});

		expect(request).toMatchObject({
			label: "portal_internal",
			method: "GET",
			url: "https://collector.local/authenticated-notice/download/portal_internal",
		});
		expect(request.uniqueKey).toBe(
			"attachment_download:example_internal_portal:portal_internal:1e1cd1d63094a394",
		);
		expect(request.url).not.toContain("download?id=1");
		expect(request.userData).toMatchObject({
			attachmentUrl: "https://portal.example.edu/download?id=1&notice_id=355120",
			fetchMode: "portal_internal",
		});
	});

	it("downloads portal internal attachment bytes through api context inside Crawlee", async () => {
		const apiGet = vi.fn(async () => ({
			body: async () => Buffer.from("portal-bytes"),
			headers: () => ({
				"content-disposition": "attachment; filename*=UTF-8''sample.pdf",
				"content-type": "application/pdf",
				etag: '"etag-portal"',
			}),
			json: async () => ({}),
			ok: () => true,
			status: () => 200,
			statusText: () => "OK",
		}));
		const handledUserData: unknown[] = [];
		const results = await runAttachmentCrawleeDownloads({
			apiContext: {
				get: apiGet,
				post: async () => {
					throw new Error("unexpected post");
				},
			},
			crawlerFactory: ({ maxRequestRetries, requestHandler }) => ({
				run: async (requests) => {
					expect(maxRequestRetries).toBe(3);
					for (const request of requests) {
						handledUserData.push(request.userData);
						await requestHandler({
							request: {
								userData: request.userData,
							},
						});
					}
				},
			}),
			requestMaxRetries: 3,
			requests: [
				{
					attachmentUrl: "https://portal.example.edu/download?id=1",
					cacheKey: "portal:1",
					fetchMode: "portal_internal",
					siteId: "example_internal_portal",
				},
			],
		});

		expect(apiGet).toHaveBeenCalledWith("https://portal.example.edu/download?id=1");
		expect(handledUserData).toEqual([
			{
				attachmentUrl: "https://portal.example.edu/download?id=1",
				cacheKey: "portal:1",
				fetchMode: "portal_internal",
			},
		]);
		expect(results.get("portal:1")).toMatchObject({
			contentDisposition: "attachment; filename*=UTF-8''sample.pdf",
			contentType: "application/pdf",
			etag: '"etag-portal"',
			statusCode: 200,
		});
		expect(results.get("portal:1")?.body.toString("utf-8")).toBe("portal-bytes");
	});

	it("downloads trusted external visuals through Crawlee request context and rejects non-image responses", async () => {
		const sendRequest = vi.fn(async () => ({
			body: Buffer.from("wechat-image"),
			headers: {
				"content-disposition": undefined,
				"content-length": "12",
				"content-type": "image/jpeg; charset=binary",
				etag: '"etag-external"',
			},
			statusCode: 200,
		}));
		const results = await runAttachmentCrawleeDownloads({
			apiContext: {
				get: async () => {
					throw new Error("portal API context must not fetch external visual");
				},
				post: async () => {
					throw new Error("unexpected post");
				},
			},
			crawlerFactory: ({ requestHandler }) => ({
				run: async (requests) => {
					for (const request of requests) {
						await requestHandler({
							request: {
								userData: request.userData,
							},
							sendRequest,
						});
					}
				},
			}),
			requestMaxRetries: 1,
			requests: [
				{
					attachmentUrl: "https://mmbiz.qpic.cn/image.jpg",
					cacheKey: "external:1",
					fetchMode: "trusted_external_visual",
					siteId: "example_internal_portal",
				},
			],
		});

		expect(sendRequest).toHaveBeenCalledWith({
			responseType: "buffer",
			url: "https://mmbiz.qpic.cn/image.jpg",
		});
		expect(results.get("external:1")).toMatchObject({
			contentType: "image/jpeg; charset=binary",
			etag: '"etag-external"',
			statusCode: 200,
		});
		expect(results.get("external:1")?.body.toString("utf-8")).toBe("wechat-image");

		await expect(
			runAttachmentCrawleeDownloads({
				apiContext: {
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				},
				crawlerFactory: ({ failedRequestHandler, requestHandler }) => ({
					run: async (requests) => {
						for (const request of requests) {
							const context = {
								request: {
									userData: request.userData,
								},
								sendRequest: async () => ({
									body: Buffer.from("not-image"),
									headers: {
										"content-type": "text/html",
									},
									statusCode: 200,
								}),
							};
							try {
								await requestHandler(context);
							} catch (error) {
								await failedRequestHandler(context, error as Error);
							}
						}
					},
				}),
				requestMaxRetries: 1,
				requests: [
					{
						attachmentUrl: "https://mmbiz.qpic.cn/not-image",
						cacheKey: "external:bad",
						fetchMode: "trusted_external_visual",
						siteId: "example_internal_portal",
					},
				],
			}),
		).rejects.toThrow("downloadExternalVisual returned non-image content-type");
	});
});
