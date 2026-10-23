import type { AgentRunner, StreamingAgentRunner } from "./agent-run-contract.ts";
import { createGeminiRunner, createStreamingGeminiRunner } from "./gemini-runner.ts";
import type { GeminiSourceResolver } from "./gemini-source-resolver.ts";
import {
	createRequestScopedOpenAIAgentsRunner,
	createRequestScopedStreamingOpenAIAgentsRunner,
} from "./openai-provider.ts";
export function createConfiguredRunner(resolveSources?: GeminiSourceResolver): AgentRunner {
	const openai = createRequestScopedOpenAIAgentsRunner();
	const google = createGeminiRunner(resolveSources ? { resolveSources } : {});
	return (input) =>
		input.providerConfig.provider === "google" &&
		input.providerConfig.transport === "generate_content"
			? google(input)
			: openai(input);
}
export function createConfiguredStreamingRunner(
	resolveSources?: GeminiSourceResolver,
): StreamingAgentRunner {
	const openai = createRequestScopedStreamingOpenAIAgentsRunner();
	const google = createStreamingGeminiRunner(resolveSources ? { resolveSources } : {});
	return (input) =>
		input.providerConfig.provider === "google" &&
		input.providerConfig.transport === "generate_content"
			? google(input)
			: openai(input);
}
