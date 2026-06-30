// @vitest-environment node

import { describe, expect, it } from "vitest";

import { defaultValidatePromptProvider } from "../src/modules/provider-config/validators";

describe("provider config prompt validator", () => {
	it("validates responses prompt providers by strict structured output text", async () => {
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
							content: [{ text: '{"status":"ok"}', type: "output_text" }],
							role: "assistant",
							status: "completed",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						input: "provider config validation",
						max_output_tokens: 128,
						model: "gpt-compatible",
						text: {
							format: {
								name: "provider_config_validation",
								schema: {
									additionalProperties: false,
									properties: { status: { const: "ok", type: "string" } },
									required: ["status"],
									type: "object",
								},
								strict: true,
								type: "json_schema",
							},
						},
					},
					url: "https://provider.example/v1/responses",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects responses prompt providers that ignore structured output format", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					output: [
						{
							content: [{ text: "ok", type: "output_text" }],
							role: "assistant",
							status: "completed",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects responses prompt providers that omit SDK-required output item status", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					output: [
						{
							content: [{ text: '{"status":"ok"}', type: "output_text" }],
							role: "assistant",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects chat-completions prompt providers that ignore structured response format", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "ok", role: "assistant" } }],
					id: "chatcmpl_unstructured",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "chat_completions",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates chat-completions prompt providers by strict structured message shape", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: '{"kind":"answer","answerText":"provider config validation"}',
								role: "assistant",
							},
						},
					],
					id: "chatcmpl_compatible",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "chat_completions",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						max_tokens: 64,
						messages: [
							{
								content: "Return a short JSON answer matching the schema.",
								role: "system",
							},
							{ content: "provider config validation", role: "user" },
						],
						model: "gpt-compatible",
						response_format: {
							json_schema: {
								name: "output",
								schema: {
									$schema: "http://json-schema.org/draft-07/schema#",
									additionalProperties: false,
									properties: {
										answerText: { minLength: 1, type: "string" },
										kind: { const: "answer", type: "string" },
									},
									required: ["kind", "answerText"],
									type: "object",
								},
								strict: true,
							},
							type: "json_schema",
						},
					},
					url: "https://provider.example/v1/chat/completions",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
