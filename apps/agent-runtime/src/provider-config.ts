import { type ModelProvider, OpenAIProvider } from "@openai/agents";
import type { AgentRunner, PromptProviderRuntimeConfig } from "./primary-agent.ts";
import { createOpenAIAgentsRunner, type OpenAIAgentsRunnerOptions } from "./sdk-runner.ts";

interface OpenAIProviderConfig {
	apiKey: string;
	baseURL?: string;
	useResponses: boolean;
}

interface ProviderConfigDependencies {
	createProvider?: (config: OpenAIProviderConfig) => ModelProvider;
	createRunner?: (options: OpenAIAgentsRunnerOptions) => AgentRunner;
}

export function createRequestScopedOpenAIAgentsRunner(
	dependencies: ProviderConfigDependencies = {},
): AgentRunner {
	const createRunner = dependencies.createRunner ?? createOpenAIAgentsRunner;
	return createRunner({
		resolveRuntimeOptions: (providerConfig) =>
			openAIAgentsRunnerOptionsFromProviderConfig(providerConfig, dependencies),
	});
}

export function openAIAgentsRunnerOptionsFromProviderConfig(
	config: PromptProviderRuntimeConfig,
	dependencies: Pick<ProviderConfigDependencies, "createProvider"> = {},
): OpenAIAgentsRunnerOptions {
	const createProvider =
		dependencies.createProvider ??
		((providerConfig: OpenAIProviderConfig): ModelProvider => new OpenAIProvider(providerConfig));
	const apiKey = trimmed(config.apiKey);
	if (apiKey === undefined) {
		throw new Error("provider api key is required for agent-runtime");
	}
	const model = trimmed(config.model);
	if (model === undefined) {
		throw new Error("provider model is required for agent-runtime");
	}
	if (trimmed(config.transport) !== "responses") {
		throw new Error("provider transport must be responses for agent-runtime");
	}
	const provider = trimmed(config.provider);
	if (provider !== undefined && provider !== "openai") {
		throw new Error("provider must be openai for agent-runtime");
	}
	return {
		model,
		modelProvider: createProvider({
			apiKey,
			baseURL: trimmed(config.baseUrl),
			useResponses: true,
		}),
	};
}

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim();
	return result === "" || result === undefined ? undefined : result;
}
