import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ModelProvider } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { openAIAgentsRunnerOptionsFromProviderConfig } from "../src/provider-config.ts";

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
				transport: "chat_completions",
			}),
		).toThrow("provider transport must be responses");
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
});
