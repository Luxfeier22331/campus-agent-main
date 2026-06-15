import type { ModelProvider } from "@openai/agents";
import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../src/primary-agent.ts";
import {
	createOpenAIAgentsRunnerFromEnv,
	openAIAgentsRunnerOptionsFromEnv,
} from "../src/provider-config.ts";

describe("agent runtime provider config", () => {
	it("creates SDK runner options from prompt runtime env", () => {
		const provider: ModelProvider = {
			async getModel() {
				throw new Error("provider should not be resolved by config tests");
			},
		};
		const providerConfigs: unknown[] = [];

		const options = openAIAgentsRunnerOptionsFromEnv(
			{
				PROMPT_RUNTIME_API_KEY: "provider-key",
				PROMPT_RUNTIME_BASE_URL: "https://provider.example/v1",
				PROMPT_RUNTIME_TRANSPORT: "responses",
				PROMPT_RUNTIME_MODEL: "gpt-shared",
				AGENT_PROMPT_MODEL: "gpt-agent",
			},
			{
				createProvider(config) {
					providerConfigs.push(config);
					return provider;
				},
			},
		);

		expect(options.model).toBe("gpt-agent");
		expect(options.modelProvider).toBe(provider);
		expect(providerConfigs).toEqual([
			{
				apiKey: "provider-key",
				baseURL: "https://provider.example/v1",
				useResponses: true,
			},
		]);
	});

	it("falls back to shared prompt model when agent model is not set", () => {
		const options = openAIAgentsRunnerOptionsFromEnv({
			PROMPT_RUNTIME_API_KEY: "provider-key",
			PROMPT_RUNTIME_MODEL: "gpt-shared",
		});

		expect(options.model).toBe("gpt-shared");
	});

	it("creates the runner through the injectable factory", () => {
		const runner: AgentRunner = async () => ({
			finalOutput: "done",
			providerResponseId: "resp",
			toolCalls: [],
			traceRef: "",
			usage: { inputTokens: 0, outputTokens: 0 },
		});
		const observedOptions: unknown[] = [];

		const result = createOpenAIAgentsRunnerFromEnv(
			{
				PROMPT_RUNTIME_API_KEY: "provider-key",
				AGENT_PROMPT_MODEL: "gpt-agent",
			},
			{
				createRunner(options) {
					observedOptions.push(options);
					return runner;
				},
			},
		);

		expect(result).toBe(runner);
		expect(observedOptions).toHaveLength(1);
	});

	it("fails closed when provider credentials or model are missing", () => {
		expect(() => createOpenAIAgentsRunnerFromEnv({ AGENT_PROMPT_MODEL: "gpt-agent" })).toThrow(
			"PROMPT_RUNTIME_API_KEY is required",
		);
		expect(() =>
			createOpenAIAgentsRunnerFromEnv({ PROMPT_RUNTIME_API_KEY: "provider-key" }),
		).toThrow("AGENT_PROMPT_MODEL or PROMPT_RUNTIME_MODEL is required");
	});

	it("rejects non-responses transport", () => {
		expect(() =>
			createOpenAIAgentsRunnerFromEnv({
				PROMPT_RUNTIME_API_KEY: "provider-key",
				PROMPT_RUNTIME_TRANSPORT: "chat_completions",
				AGENT_PROMPT_MODEL: "gpt-agent",
			}),
		).toThrow("PROMPT_RUNTIME_TRANSPORT must be responses");
	});
});
