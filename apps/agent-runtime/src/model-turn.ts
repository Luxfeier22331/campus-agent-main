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
	if (turn.continuation.provider === "openai") {
		return {
			provider: "openai",
			items: [
				...turn.continuation.items,
				...results.map((r, index) => ({
					type: "function_call_result" as const,
					name: r.toolName,
					callId: turn.calls[index]!.id,
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
				parts: results.map((r, index) => ({
					functionResponse: {
						id: turn.calls[index]!.id,
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
