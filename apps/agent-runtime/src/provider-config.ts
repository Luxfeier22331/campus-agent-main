import { isIP } from "node:net";
import { type ModelProvider, OpenAIProvider } from "@openai/agents";
import OpenAI from "openai";
import type {
	AgentRunner,
	PromptProviderRuntimeConfig,
	StreamingAgentRunner,
} from "./agent-run-contract.ts";
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
		((providerConfig: OpenAIProviderConfig): ModelProvider =>
			new OpenAIProvider({
				openAIClient: new OpenAI({
					apiKey: providerConfig.apiKey,
					baseURL: providerConfig.baseURL,
					fetch: fetchWithoutRedirects,
				}),
				useResponses: providerConfig.useResponses,
			}));
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
	const baseURL = normalizeProviderBaseURL(config.baseUrl);
	return {
		model,
		modelProvider: createProvider({
			apiKey,
			baseURL,
			useResponses: transport === "responses",
		}),
	};
}

export function normalizeProviderBaseURL(value: string | undefined): string {
	const raw = trimmed(value);
	if (raw === undefined) {
		throw new Error("provider base url is required for agent-runtime");
	}
	if (raw.includes("\\") || raw.includes("?") || raw.includes("#")) {
		throw new Error("provider base url is invalid for agent-runtime");
	}
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("provider base url is invalid for agent-runtime");
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		!parsed.hostname ||
		parsed.username !== "" ||
		parsed.password !== ""
	) {
		throw new Error("provider base url is invalid for agent-runtime");
	}
	if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
		throw new Error("provider base url must use https outside loopback");
	}
	return parsed.toString();
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (normalized === "localhost") {
		return true;
	}
	const family = isIP(normalized);
	return (family === 4 && normalized.startsWith("127.")) || (family === 6 && normalized === "::1");
}

export const fetchWithoutRedirects: typeof fetch = (input, init) => {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	for (const [name, value] of new Headers(init?.headers)) {
		headers.set(name, value);
	}
	headers.set("user-agent", "campus-agent");
	return globalThis.fetch(input, { ...init, headers, redirect: "manual" });
};

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim();
	return result === "" || result === undefined ? undefined : result;
}
