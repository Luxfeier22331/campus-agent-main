import assert from "node:assert/strict";
import type { Content } from "@google/genai";
import type { AgentInputItem } from "@openai/agents";
import type {
	AgentRunnerInput,
	AgentRunnerResult,
	ToolExecutionResult,
} from "./agent-run-contract.ts";

export interface ModelToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}
export type ProviderContinuation =
	| { provider: "openai"; items: AgentInputItem[] }
	| { provider: "gemini"; contents: Content[] };
export interface ModelTurn {
	continuation: ProviderContinuation;
	calls: ModelToolCall[];
	result: AgentRunnerResult;
}
export function continueWithTools(
	turn: ModelTurn,
	results: ToolExecutionResult[],
): ProviderContinuation {
	const pairedResults = results.map((result, index) => {
		const call = turn.calls[index];
		assert(call, "Tool result requires a corresponding model call");
		return { result, call };
	});
	if (turn.continuation.provider === "openai") {
		return {
			provider: "openai",
			items: [
				...turn.continuation.items,
				...pairedResults.map(({ result: r, call }) => ({
					type: "function_call_result" as const,
					name: r.toolName,
					callId: call.id,
					status: "completed" as const,
					output: JSON.stringify({
						status: r.status,
						result: r.result,
						...(r.failure ? { failure: r.failure } : {}),
					}),
				})),
			],
		};
	}
	return {
		provider: "gemini",
		contents: [
			...turn.continuation.contents,
			{
				role: "user",
				parts: pairedResults.map(({ result: r, call }) => ({
					functionResponse: {
						id: call.id,
						name: r.toolName,
						response: {
							status: r.status,
							result: r.result,
							...(r.failure ? { failure: r.failure } : {}),
						},
					},
				})),
			},
		],
	};
}
export type ModelTurnRunner = (
	input: AgentRunnerInput,
	continuation?: ProviderContinuation,
	onDelta?: (delta: string) => Promise<void>,
) => Promise<ModelTurn>;
