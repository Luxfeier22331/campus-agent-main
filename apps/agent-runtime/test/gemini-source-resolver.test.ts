import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRunnerInput, AgentRunnerResult } from "../src/agent-run-contract.ts";
import {
	createGeminiSourceResolver,
	isPublicSourceAddress,
	type SourceResolverDependencies,
} from "../src/gemini-source-resolver.ts";

const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test";
const page = "https://www.muc.edu.cn/ggfw/cjwt/mdgk.htm?q=1#address";
const input = { operation: "solve" } as AgentRunnerInput;
function result(urls = [redirect]): AgentRunnerResult {
	return {
		finalOutput: "😀海淀校区",
		providerResponseId: "test",
		toolResults: [],
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
		webEvidence: urls.map((url) => ({
			url,
			title: "muc.edu.cn",
			excerpt: "海淀校区",
			startIndex: 1,
			endIndex: 5,
		})),
	};
}
const lookup = async () => ["8.8.8.8"];
function html(body: string, type = "text/html; charset=utf-8") {
	return new Response(body, { headers: { "content-type": type } });
}
function redirectTo(location: string) {
	return new Response(null, { status: 302, headers: { location } });
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("Gemini source pages", () => {
	it("reads a real HTTP redirect and HTML while preserving the evidence identity and span", async () => {
		const requests: string[] = [];
		const server = createServer((request, response) => {
			requests.push(request.url ?? "");
			if (request.url?.startsWith("/grounding-api-redirect")) {
				response.writeHead(302, { location: page });
				response.end();
			} else {
				response.writeHead(200, { "content-type": "text/html" });
				response.end(
					'<head><title>旧标题</title><meta property="og:title" content=" 民大概况 &amp; 校区 "></head>',
				);
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("address missing");
		}
		const resolver = createGeminiSourceResolver({
			lookup,
			fetch: (url, signal) => {
				const target = new URL(url);
				return fetch(`http://127.0.0.1:${address.port}${target.pathname}${target.search}`, {
					redirect: "manual",
					signal,
				});
			},
		});
		try {
			const value = result([redirect, redirect]);
			await resolver.resolve(input, value);
			expect(requests).toHaveLength(2);
			expect(value.webEvidence).toEqual(
				[0, 1].map(() => ({
					url: redirect,
					title: "民大概况 & 校区",
					excerpt: "海淀校区",
					startIndex: 1,
					endIndex: 5,
					sourceLink: { href: page },
				})),
			);
		} finally {
			await resolver.close();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
	it.each(["'", '"'])("follows a standalone static redirect using %s quotes", async (quote) => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo("https://yx.muc.edu.cn/bks/baodaoxuzhi/baodaoxuzhi/"))
			.mockResolvedValueOnce(
				html(
					`<script>\r\nwindow.location.href=${quote}fengtaixiaoqu/?a=1#address${quote};\r\n</script>\r\n`,
				),
			)
			.mockResolvedValueOnce(html("<title>丰台校区报到须知</title>"));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(value.webEvidence?.[0]).toMatchObject({
			url: redirect,
			title: "丰台校区报到须知",
			startIndex: 1,
			endIndex: 5,
			sourceLink: {
				href: "https://yx.muc.edu.cn/bks/baodaoxuzhi/baodaoxuzhi/fengtaixiaoqu/?a=1#address",
			},
		});
		expect(fetch).toHaveBeenCalledTimes(3);
	});
	it.each([
		`<html><title>正常网页</title><script>window.location.href='/other';</script></html>`,
		"<script>window.location.href=target;</script>",
		`<script>window.location.href='/a' + '/b';</script>`,
		`<script>window.location.href='/a';run();</script>`,
		`<script>window.location.href='/a';</script><script>run();</script>`,
	])("does not interpret scripts outside the standalone literal stub: %s", async (body) => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(html(body));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBe(page);
	});
	it.each([
		"http://127.0.0.1/",
		"file:///etc/passwd",
		"https://private.example/",
		"https://user:pass@example.com/",
	])("validates a static redirect target %s", async (target) => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(html(`<script>window.location.href='${target}'</script>`));
		const value = result();
		await createGeminiSourceResolver({
			fetch,
			lookup: async (host) => (host === "private.example" ? ["10.0.0.1"] : ["8.8.8.8"]),
		}).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBeNull();
	});
	it("shares HTTP and static redirect loop and hop limits", async () => {
		let n = 0;
		const fetch = vi.fn(async () =>
			++n % 2
				? redirectTo(`https://www.muc.edu.cn/${n}`)
				: html(`<script>window.location.href='/${n}'</script>`),
		);
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(6);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBeNull();
		const loop = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(html(`<script>window.location.href='${redirect}'</script>`));
		await createGeminiSourceResolver({ lookup, fetch: loop }).resolve(input, result());
		expect(loop).toHaveBeenCalledTimes(2);
	});
	it("does not follow a static redirect after cancellation", async () => {
		const controller = new AbortController();
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockImplementationOnce(async () => {
				controller.abort();
				return html("<script>window.location.href='/next'</script>");
			});
		await createGeminiSourceResolver({ lookup, fetch }).resolve(
			{ ...input, signal: controller.signal },
			result(),
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("follows relative redirects and retains query strings and fragments", async () => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(redirectTo("../xydy.htm?campus=2"))
			.mockResolvedValueOnce(html("<title>校园导游</title>"));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBe(
			"https://www.muc.edu.cn/ggfw/xydy.htm?campus=2#address",
		);
	});
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"192.168.1.1",
		"::1",
		"::ffff:127.0.0.1",
		"fc00::1",
		"fe80::1",
		"0.0.0.0",
	])("rejects non-public address %s", (address) => {
		expect(isPublicSourceAddress(address)).toBe(false);
	});
	it.each([
		"http://127.0.0.1/private",
		"https://user:secret@example.com/",
		"file:///etc/passwd",
		"http://[::1]/",
		"https://example.com:1234/",
	])("does not follow unsafe target %s", async (target) => {
		const fetch = vi.fn(async () => redirectTo(target));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(value.webEvidence?.[0]?.sourceLink).toEqual({ href: null });
	});
	it("checks DNS results on every hop, including after a public original URL", async () => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(redirectTo("https://private.example/"));
		const value = result();
		await createGeminiSourceResolver({
			lookup: async (host) => (host === "private.example" ? ["10.0.0.1"] : ["8.8.8.8"]),
			fetch,
		}).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBeNull();
	});
	it.each([403, 404, 200])(
		"retains the original URL when the title is unavailable (HTTP %s)",
		async (status) => {
			const fetch = vi
				.fn<SourceResolverDependencies["fetch"]>()
				.mockResolvedValueOnce(redirectTo(page))
				.mockResolvedValueOnce(
					new Response("no title", { status, headers: { "content-type": "application/pdf" } }),
				);
			const value = result();
			await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
			expect(value.webEvidence?.[0]).toMatchObject({
				sourceLink: { href: page },
				title: "网页标题暂不可用",
			});
		},
	);
	it("uses an existing specific title when fetching HTML fails", async () => {
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockRejectedValueOnce(new Error("unreachable"));
		const value = result();
		if (value.webEvidence?.[0]) {
			value.webEvidence[0].title = "学校简介";
		}
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(value.webEvidence?.[0]).toMatchObject({ sourceLink: { href: page }, title: "学校简介" });
	});
	it("decodes a declared GBK title", async () => {
		const body = Buffer.concat([
			Buffer.from('<head><meta charset="gbk"><title>'),
			Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
			Buffer.from("</title></head>"),
		]);
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce(new Response(body, { headers: { "content-type": "text/html" } }));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(value.webEvidence?.[0]?.title).toBe("中文");
	});
	it("stops reading at the page limit and cancels the body", async () => {
		const cancel = vi.fn();
		const read = vi
			.fn()
			.mockResolvedValue({ done: false, value: new Uint8Array(512 * 1024).fill(32) });
		const fetch = vi
			.fn<SourceResolverDependencies["fetch"]>()
			.mockResolvedValueOnce(redirectTo(page))
			.mockResolvedValueOnce({
				status: 200,
				headers: new Headers({ "content-type": "text/html" }),
				body: { cancel, getReader: () => ({ read, cancel }) },
			});
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(read).toHaveBeenCalledTimes(1);
		expect(cancel).toHaveBeenCalled();
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBe(page);
	});
	it("bounds redirect loops and long chains", async () => {
		let n = 0;
		const fetch = vi.fn(async () => redirectTo(`https://www.muc.edu.cn/${n++}`));
		const value = result();
		await createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		expect(fetch).toHaveBeenCalledTimes(6);
		expect(value.webEvidence?.[0]?.sourceLink?.href).toBeNull();
		const loop = vi.fn(async () => redirectTo(redirect));
		const second = result();
		await createGeminiSourceResolver({ lookup, fetch: loop }).resolve(input, second);
		expect(loop).toHaveBeenCalledTimes(1);
	});
	it("bounds concurrency and stops the whole batch without losing unprocessed citations", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
			return controller.signal;
		});
		const fetch = vi.fn<SourceResolverDependencies["fetch"]>(
			() =>
				new Promise(() => {
					/* Simulate a transport that ignores abort. */
				}),
		);
		const value = result(Array.from({ length: 12 }, (_, i) => `${redirect}${i}`));
		const pending = createGeminiSourceResolver({ lookup, fetch }).resolve(input, value);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetch).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(10_000);
		await pending;
		expect(fetch.mock.calls.length).toBeLessThanOrEqual(8);
		expect(value.webEvidence).toHaveLength(12);
		expect(value.webEvidence?.every((item) => item.sourceLink?.href === null)).toBe(true);
	});
	it("does not fetch after cancellation or the operation deadline", async () => {
		const fetch = vi.fn();
		const resolver = createGeminiSourceResolver({ lookup, fetch });
		for (const extra of [
			{ signal: AbortSignal.abort() },
			{ deadlineAt: new Date(Date.now()).toISOString() },
		]) {
			const value = result();
			await resolver.resolve({ ...input, ...extra }, value);
			expect(value.webEvidence?.[0]?.sourceLink?.href).toBeNull();
		}
		expect(fetch).not.toHaveBeenCalled();
	});
	it("leaves direct sources and metadata-only answers untouched", async () => {
		const fetch = vi.fn();
		const resolver = createGeminiSourceResolver({ lookup, fetch });
		const direct = result([page]);
		await resolver.resolve(input, direct);
		expect(direct.webEvidence?.[0]).not.toHaveProperty("sourceLink");
		await resolver.resolve(input, result([]));
		expect(fetch).not.toHaveBeenCalled();
	});
});
