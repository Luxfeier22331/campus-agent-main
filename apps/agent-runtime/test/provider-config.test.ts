import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { ModelProvider } from "@openai/agents";
import { describe, expect, it } from "vitest";
import {
	fetchWithoutRedirects,
	normalizeProviderBaseURL,
	openAIAgentsRunnerOptionsFromProviderConfig,
} from "../src/provider-config.ts";

describe("agent runtime provider config", () => {
	it("creates SDK runner options from request scoped provider config", () => {
		const provider: ModelProvider = {
			async getModel() {
				throw new Error("provider should not be resolved by config tests");
			},
		};
		const providerConfigs: unknown[] = [];

		const options = openAIAgentsRunnerOptionsFromProviderConfig(
			{
				apiKey: "request-provider-key",
				baseUrl: "https://request-provider.example/v1",
				model: "gpt-request",
				provider: "openai",
				transport: "responses",
			},
			{
				createProvider(config) {
					providerConfigs.push(config);
					return provider;
				},
			},
		);

		expect(options.model).toBe("gpt-request");
		expect(options.modelProvider).toBe(provider);
		expect(providerConfigs).toEqual([
			{
				apiKey: "request-provider-key",
				baseURL: "https://request-provider.example/v1",
				useResponses: true,
			},
		]);
	});

	it("uses SDK chat-completions transport for OpenAI-compatible prompt profiles", () => {
		const provider: ModelProvider = {
			async getModel() {
				throw new Error("provider should not be resolved by config tests");
			},
		};
		const providerConfigs: unknown[] = [];

		const options = openAIAgentsRunnerOptionsFromProviderConfig(
			{
				apiKey: "request-provider-key",
				baseUrl: "https://request-provider.example/v1",
				model: "gpt-request",
				provider: "openai-compatible",
				transport: "chat_completions",
			},
			{
				createProvider(config) {
					providerConfigs.push(config);
					return provider;
				},
			},
		);

		expect(options.model).toBe("gpt-request");
		expect(options.modelProvider).toBe(provider);
		expect(providerConfigs).toEqual([
			{
				apiKey: "request-provider-key",
				baseURL: "https://request-provider.example/v1",
				useResponses: false,
			},
		]);
	});

	it("rejects incomplete request scoped provider config", () => {
		expect(() =>
			openAIAgentsRunnerOptionsFromProviderConfig({
				apiKey: "",
				baseUrl: "https://provider.example/v1",
				model: "gpt-agent",
				provider: "openai",
				transport: "responses",
			}),
		).toThrow("provider api key is required");
		expect(() =>
			openAIAgentsRunnerOptionsFromProviderConfig({
				apiKey: "provider-key",
				baseUrl: "https://provider.example/v1",
				model: "",
				provider: "openai",
				transport: "responses",
			}),
		).toThrow("provider model is required");
		expect(() =>
			openAIAgentsRunnerOptionsFromProviderConfig({
				apiKey: "provider-key",
				baseUrl: "https://provider.example/v1",
				model: "gpt-agent",
				provider: "openai",
				transport: "legacy_completions",
			}),
		).toThrow("provider transport must be responses or chat_completions");
	});

	it("does not expose env-based provider config entrypoints", () => {
		const source = readFileSync(
			fileURLToPath(new URL("../src/provider-config.ts", import.meta.url)),
			"utf8",
		);

		expect(source).not.toContain("createOpenAIAgentsRunnerFromEnv");
		expect(source).not.toContain("openAIAgentsRunnerOptionsFromEnv");
		expect(source).not.toContain("AGENT_PROMPT_MODEL");
		expect(source).not.toContain("PROMPT_RUNTIME_MODEL");
		expect(source).not.toContain("PROMPT_RUNTIME_API_KEY");
	});

	it("rejects unsafe provider base URLs at the runtime consumer boundary", () => {
		for (const baseUrl of [
			"https://provider.example/v1?redirect=https://evil.example",
			"https://user:password@provider.example/v1",
			"https://provider.example/v1#fragment",
			"http://provider.example/v1",
			"not-a-url",
			undefined,
		]) {
			expect(() => normalizeProviderBaseURL(baseUrl)).toThrow();
		}
		expect(normalizeProviderBaseURL("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
	});

	it("does not follow a provider redirect to another origin", async () => {
		let targetRequests = 0;
		let providerUserAgent = "";
		const target = createServer((_request, response) => {
			targetRequests += 1;
			response.writeHead(500, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "redirect target must not be reached" }));
		});
		await listen(target);
		const targetAddress = target.address() as { port: number };
		const redirect = createServer((request, response) => {
			providerUserAgent = request.headers["user-agent"] ?? "";
			response.writeHead(307, { location: `http://127.0.0.1:${targetAddress.port}/v1/responses` });
			response.end();
		});
		await listen(redirect);

		try {
			const redirectAddress = redirect.address() as { port: number };
			const response = await fetchWithoutRedirects(
				`http://127.0.0.1:${redirectAddress.port}/v1/responses`,
				{
					headers: { "user-agent": "OpenAI/JS 7.4.0" },
				},
			);
			expect(response.status).toBe(307);
			await response.body?.cancel();
			expect(providerUserAgent).toBe("campus-agent");
			expect(targetRequests).toBe(0);
		} finally {
			await close(redirect);
			await close(target);
		}
	});
});

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
