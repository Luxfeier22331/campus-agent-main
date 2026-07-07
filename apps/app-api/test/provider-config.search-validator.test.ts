// @vitest-environment node

import { describe, expect, it } from "vitest";

import { defaultValidateSearchProvider } from "../src/modules/provider-config/validators";

describe("provider config search validator", () => {
	it("validates Perplexity search providers through the Search API", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					results: [
						{
							snippet: "中央民族大学官网公开页面。",
							title: "中央民族大学",
							url: "https://www.muc.edu.cn/",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "pplx-key",
					baseUrl: "https://api.perplexity.ai",
					dimensions: null,
					featureConfig: {},
					model: "sonar",
					provider: "perplexity",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "perplexity_search",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						max_results: 3,
						query: "site:muc.edu.cn 中央民族大学",
						search_domain_filter: ["muc.edu.cn"],
					},
					url: "https://api.perplexity.ai/search",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates admitted Perplexity-compatible search providers through the same transport", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					results: [
						{
							snippet: "中央民族大学官网公开页面。",
							title: "中央民族大学",
							url: "https://www.muc.edu.cn/",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "compatible-key",
					baseUrl: "https://compatible-search.example",
					dimensions: null,
					featureConfig: {},
					model: "sonar-compatible",
					provider: "perplexity_compatible",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "perplexity_search",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						max_results: 3,
						query: "site:muc.edu.cn 中央民族大学",
						search_domain_filter: ["muc.edu.cn"],
					},
					url: "https://compatible-search.example/search",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects incompatible search response shape", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ answer: "not a ranked search result payload" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			})) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "pplx-key",
					baseUrl: "https://api.perplexity.ai",
					dimensions: null,
					featureConfig: {},
					model: "sonar",
					provider: "perplexity",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "perplexity_search",
				}),
			).resolves.toMatchObject({
				errorCode: "search_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates OpenAI Responses web search providers through the hosted web_search tool", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					output: [
						{
							action: {
								sources: [
									{
										title: "中央民族大学",
										url: "https://www.muc.edu.cn/",
									},
								],
							},
							type: "web_search_call",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "openai-key",
					baseUrl: "https://api.openai.com/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-5-search-api",
					provider: "openai",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "openai_responses_web_search",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						include: ["web_search_call.action.sources"],
						input: "Search muc.edu.cn for 中央民族大学 and return cited official sources.",
						model: "gpt-5-search-api",
						tool_choice: "required",
						tools: [
							{
								filters: { allowed_domains: ["muc.edu.cn"] },
								search_context_size: "low",
								type: "web_search",
							},
						],
					},
					url: "https://api.openai.com/v1/responses",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates Gemini Google Search grounding providers", async () => {
		const observedRequests: Array<{ body: unknown; headers: Record<string, string>; url: string }> =
			[];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				headers: Object.fromEntries(new Headers(init?.headers).entries()),
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					steps: [
						{
							content: [
								{
									annotations: [
										{
											title: "中央民族大学",
											type: "url_citation",
											url: "https://www.muc.edu.cn/",
										},
									],
									text: "中央民族大学官方网页。",
									type: "text",
								},
							],
							type: "model_output",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "gemini-key",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					dimensions: null,
					featureConfig: {},
					model: "gemini-2.5-flash",
					provider: "gemini",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "gemini_google_search",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						input: "Search muc.edu.cn for 中央民族大学 and cite official sources.",
						model: "gemini-2.5-flash",
						tools: [{ type: "google_search" }],
					},
					headers: {
						"content-type": "application/json",
						"x-goog-api-key": "gemini-key",
					},
					url: "https://generativelanguage.googleapis.com/v1beta/interactions",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates Linux.do Chat Completions web search providers through citation annotations", async () => {
		const observedRequests: Array<{ body: unknown; headers: Record<string, string>; url: string }> =
			[];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				headers: Object.fromEntries(new Headers(init?.headers).entries()),
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								annotations: [
									{
										type: "url_citation",
										url_citation: {
											title: "校园网服务",
											url: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
										},
									},
								],
								content: "中央民族大学校园网服务说明。",
							},
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "linux-do-key",
					baseUrl: "https://hub.linux.do/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-5-search-api-2025-10-14",
					provider: "linux_do",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "openai_chat_completions_web_search",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						max_tokens: 512,
						messages: [
							{
								content:
									"Search muc.edu.cn for 中央民族大学 and cite official public HTTPS sources.",
								role: "user",
							},
						],
						model: "gpt-5-search-api-2025-10-14",
						web_search_options: {
							search_context_size: "low",
						},
					},
					headers: {
						authorization: "Bearer linux-do-key",
						"content-type": "application/json",
					},
					url: "https://hub.linux.do/v1/chat/completions",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects Linux.do Chat Completions web search responses without citations", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								annotations: [],
								content: "没有引用。",
							},
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "linux-do-key",
					baseUrl: "https://hub.linux.do/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-5-search-api-2025-10-14",
					provider: "linux_do",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "openai_chat_completions_web_search",
				}),
			).resolves.toMatchObject({
				errorCode: "search_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects Gemini Google Search responses without URL citation annotations", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					steps: [
						{
							content: [
								{
									annotations: [
										{
											title: "中央民族大学",
											type: "not_url_citation",
											url: "https://www.muc.edu.cn/",
										},
									],
									text: "中央民族大学官方网页。",
									type: "text",
								},
							],
							type: "model_output",
						},
					],
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidateSearchProvider({
					apiKey: "gemini-key",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					dimensions: null,
					featureConfig: {},
					model: "gemini-2.5-flash",
					provider: "gemini",
					role: "public_web_search",
					timeoutMs: 30000,
					transport: "gemini_google_search",
				}),
			).resolves.toMatchObject({
				errorCode: "search_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects unsupported public web search provider identity or transport", async () => {
		await expect(
			defaultValidateSearchProvider({
				apiKey: "search-key",
				baseUrl: "https://search.example",
				dimensions: null,
				featureConfig: {},
				model: "search-model",
				provider: "openai-compatible",
				role: "public_web_search",
				timeoutMs: 30000,
				transport: "chat_completions",
			}),
		).resolves.toMatchObject({
			errorCode: "search_provider_unsupported",
			ok: false,
			status: "failed",
		});

		await expect(
			defaultValidateSearchProvider({
				apiKey: "search-key",
				baseUrl: "https://search.example",
				dimensions: null,
				featureConfig: {},
				model: "search-model",
				provider: "gemini",
				role: "public_web_search",
				timeoutMs: 30000,
				transport: "perplexity_search",
			}),
		).resolves.toMatchObject({
			errorCode: "search_provider_unsupported",
			ok: false,
			status: "failed",
		});

		await expect(
			defaultValidateSearchProvider({
				apiKey: "search-key",
				baseUrl: "https://hub.linux.do/v1",
				dimensions: null,
				featureConfig: {},
				model: "gpt-5-search-api-2025-10-14",
				provider: "linux_do",
				role: "public_web_search",
				timeoutMs: 30000,
				transport: "chat_completions",
			}),
		).resolves.toMatchObject({
			errorCode: "search_provider_unsupported",
			ok: false,
			status: "failed",
		});
	});
});
