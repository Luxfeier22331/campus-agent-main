import { type ModelProvider, OpenAIProvider } from "@openai/agents";
import type { AgentRunner } from "./primary-agent.ts";
import { createOpenAIAgentsRunner, type OpenAIAgentsRunnerOptions } from "./sdk-runner.ts";

interface EnvReader {
	[key: string]: string | undefined;
}

interface OpenAIProviderConfig {
	apiKey: string;
	baseURL?: string;
	useResponses: boolean;
}

interface ProviderConfigDependencies {
	createProvider?: (config: OpenAIProviderConfig) => ModelProvider;
	createRunner?: (options: OpenAIAgentsRunnerOptions) => AgentRunner;
}

export function createOpenAIAgentsRunnerFromEnv(
	env: EnvReader = process.env,
	dependencies: ProviderConfigDependencies = {},
): AgentRunner {
	const createRunner = dependencies.createRunner ?? createOpenAIAgentsRunner;
	return createRunner(openAIAgentsRunnerOptionsFromEnv(env, dependencies));
}

export function openAIAgentsRunnerOptionsFromEnv(
	env: EnvReader = process.env,
	dependencies: Pick<ProviderConfigDependencies, "createProvider"> = {},
): OpenAIAgentsRunnerOptions {
	const createProvider =
		dependencies.createProvider ??
		((config: OpenAIProviderConfig): ModelProvider => new OpenAIProvider(config));
	const apiKey = readRequiredEnv(env, "PROMPT_RUNTIME_API_KEY");
	const baseURL = readOptionalEnv(env, "PROMPT_RUNTIME_BASE_URL");
	const model =
		readOptionalEnv(env, "AGENT_PROMPT_MODEL") ??
		readOptionalEnv(env, "PROMPT_RUNTIME_MODEL") ??
		failMissingModel();
	const transport = readOptionalEnv(env, "PROMPT_RUNTIME_TRANSPORT") ?? "responses";
	if (transport !== "responses") {
		throw new Error("PROMPT_RUNTIME_TRANSPORT must be responses for agent-runtime");
	}
	return {
		model,
		modelProvider: createProvider({
			apiKey,
			baseURL,
			useResponses: true,
		}),
	};
}

function readRequiredEnv(env: EnvReader, key: string): string {
	const value = readOptionalEnv(env, key);
	if (value === undefined) {
		throw new Error(`${key} is required for agent-runtime`);
	}
	return value;
}

function readOptionalEnv(env: EnvReader, key: string): string | undefined {
	const value = env[key]?.trim();
	return value === "" || value === undefined ? undefined : value;
}

function failMissingModel(): never {
	throw new Error("AGENT_PROMPT_MODEL or PROMPT_RUNTIME_MODEL is required for agent-runtime");
}
