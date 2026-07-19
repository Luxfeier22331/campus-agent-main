import { describe, expect, it, vi } from "vitest";

import {
	buildAttachmentDownloadRequest,
	fetchTrustedExternalVisualBinary,
	runAttachmentCrawleeDownloadOutcomes,
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
		const results = await runAttachmentCrawleeDownloads({
			apiContext: {
				get: apiGet,
				post: async () => {
					throw new Error("unexpected post");
				},
			},
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
		expect(results.get("portal:1")).toMatchObject({
			contentDisposition: "attachment; filename*=UTF-8''sample.pdf",
			contentType: "application/pdf",
			etag: '"etag-portal"',
			statusCode: 200,
		});
		expect(results.get("portal:1")?.body.toString("utf-8")).toBe("portal-bytes");
	});

	it("enforces the aggregate byte budget while downloads are collected", async () => {
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
				externalVisualFetcher: async () => ({
					body: Buffer.from("ab"),
					contentDisposition: null,
					contentType: "image/png",
					etag: null,
					lastModified: null,
					statusCode: 200,
				}),
				maxTotalBytes: 3,
				requestMaxRetries: 0,
				requests: [
					{
						attachmentUrl: "https://mmbiz.qpic.cn/one.png",
						cacheKey: "external:one",
						fetchMode: "trusted_external_visual",
						siteId: "example_internal_portal",
					},
					{
						attachmentUrl: "https://mmbiz.qpic.cn/two.png",
						cacheKey: "external:two",
						fetchMode: "trusted_external_visual",
						siteId: "example_internal_portal",
					},
				],
			}),
		).rejects.toThrow("attachment_run_size_limit_exceeded:4");
	});

	it("downloads trusted external visuals through Crawlee request context and rejects non-image responses", async () => {
		const externalVisualFetcher = vi.fn(async ({ attachmentUrl }) => {
			expect(attachmentUrl).toBe("https://mmbiz.qpic.cn/image.jpg");
			return {
				body: Buffer.from("wechat-image"),
				contentDisposition: null,
				contentType: "image/jpeg; charset=binary",
				etag: '"etag-external"',
				lastModified: null,
				statusCode: 200,
			};
		});
		const results = await runAttachmentCrawleeDownloads({
			apiContext: {
				get: async () => {
					throw new Error("portal API context must not fetch external visual");
				},
				post: async () => {
					throw new Error("unexpected post");
				},
			},
			externalVisualFetcher,
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

		expect(externalVisualFetcher).toHaveBeenCalledOnce();
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
				externalVisualFetcher: async () => {
					throw new Error("downloadExternalVisual returned non-image content-type");
				},
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

	it("validates every trusted external visual redirect", async () => {
		const sendRequest = vi
			.fn()
			.mockResolvedValueOnce({
				body: Buffer.alloc(0),
				headers: { location: "/redirected.jpg" },
				statusCode: 302,
			})
			.mockResolvedValueOnce({
				body: Buffer.from("image"),
				headers: { "content-type": "image/jpeg" },
				statusCode: 200,
			});

		await expect(
			fetchTrustedExternalVisualBinary({
				attachmentUrl: "https://mmbiz.qpic.cn/image.jpg",
				sendRequest,
			}),
		).resolves.toMatchObject({ contentType: "image/jpeg", statusCode: 200 });
		expect(sendRequest).toHaveBeenNthCalledWith(2, {
			maxRedirects: 0,
			responseType: "buffer",
			url: "https://mmbiz.qpic.cn/redirected.jpg",
		});

		await expect(
			fetchTrustedExternalVisualBinary({
				attachmentUrl: "https://mmbiz.qpic.cn/image.jpg",
				sendRequest: vi.fn().mockResolvedValue({
					body: Buffer.alloc(0),
					headers: { location: "http://127.0.0.1/private" },
					statusCode: 302,
				}),
			}),
		).rejects.toThrow("rejected untrusted URL");
	});

	it("rejects trusted external visual redirects beyond three hops", async () => {
		const sendRequest = vi.fn().mockResolvedValue({
			body: Buffer.alloc(0),
			headers: { location: "/next.jpg" },
			statusCode: 302,
		});
		await expect(
			fetchTrustedExternalVisualBinary({
				attachmentUrl: "https://mmbiz.qpic.cn/image.jpg",
				sendRequest,
			}),
		).rejects.toThrow("exceeded redirect limit");
		expect(sendRequest).toHaveBeenCalledTimes(4);
	});

	it("returns per-request outcomes after Crawlee exhausts individual downloads", async () => {
		const apiGet = vi.fn(async (url: string) => ({
			body: async () => {
				if (url.includes("broken")) {
					throw new Error("socket closed before body completed");
				}
				return Buffer.from("portal-bytes");
			},
			headers: () => ({
				"content-type": "application/pdf",
			}),
			json: async () => ({}),
			ok: () => true,
			status: () => 200,
			statusText: () => "OK",
		}));

		const outcomes = await runAttachmentCrawleeDownloadOutcomes({
			apiContext: {
				get: apiGet,
				post: async () => {
					throw new Error("unexpected post");
				},
			},
			requestMaxRetries: 0,
			requests: [
				{
					attachmentUrl: "https://portal.example.edu/download?id=ok",
					cacheKey: "portal:ok",
					fetchMode: "portal_internal",
					siteId: "example_internal_portal",
				},
				{
					attachmentUrl: "https://portal.example.edu/download?id=broken",
					cacheKey: "portal:broken",
					fetchMode: "portal_internal",
					siteId: "example_internal_portal",
				},
			],
		});

		expect(outcomes.get("portal:ok")).toMatchObject({
			status: "fulfilled",
			result: {
				contentType: "application/pdf",
				statusCode: 200,
			},
		});
		expect(outcomes.get("portal:broken")).toMatchObject({
			status: "rejected",
			error: expect.objectContaining({
				message: "socket closed before body completed",
			}),
		});
	});
});
