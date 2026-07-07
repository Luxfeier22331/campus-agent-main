import { type ModelProvider, OpenAIProvider } from "@openai/agents";
import type {
	AgentRunner,
	PromptProviderRuntimeConfig,
	StreamingAgentRunner,
} from "./primary-agent.ts";
import {
	createOpenAIAgentsRunner,
	createStreamingOpenAIAgentsRunner,
	type OpenAIAgentsRunnerOptions,
} from "./sdk-runner.ts";

interface OpenAIProviderConfig {
	apiKey: string;
	baseURL?: string;
	useResponses: boolean;
}

interface ProviderConfigDependencies {
	createProvider?: (config: OpenAIProviderConfig) => ModelProvider;
	createRunner?: (options: OpenAIAgentsRunnerOptions) => AgentRunner;
	createStreamingRunner?: (options: OpenAIAgentsRunnerOptions) => StreamingAgentRunner;
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

export function createRequestScopedStreamingOpenAIAgentsRunner(
	dependencies: ProviderConfigDependencies = {},
): StreamingAgentRunner {
	const createStreamingRunner =
		dependencies.createStreamingRunner ?? createStreamingOpenAIAgentsRunner;
	return createStreamingRunner({
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
	const transport = trimmed(config.transport);
	if (transport !== "responses" && transport !== "chat_completions") {
		throw new Error("provider transport must be responses or chat_completions for agent-runtime");
	}
	const provider = trimmed(config.provider);
	if (provider !== undefined && provider !== "openai" && provider !== "openai-compatible") {
		throw new Error("provider must be openai or openai-compatible for agent-runtime");
	}
	return {
		model,
		modelProvider: createProvider({
			apiKey,
			baseURL: trimmed(config.baseUrl),
			useResponses: transport === "responses",
		}),
	};
}

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim();
	return result === "" || result === undefined ? undefined : result;
}
