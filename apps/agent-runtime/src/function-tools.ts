import type {
	AgentRunnerInput,
	SdkToolRuntime,
	ToolExecutionResult,
} from "./agent-run-contract.ts";
import { retrievalDeadlineAt } from "./execution-budget.ts";
import { AgentRuntimeError } from "./runtime-errors.ts";
export interface FunctionToolContext {
	reportRetrieval?: AgentRunnerInput["reportRetrieval"];
	campusSearch: {
		resultRefs: Set<string>;
		nextCitationIndex: number;
		queue: Promise<void>;
	};
	functionToolBudget: {
		limit: number;
		reserved: number;
	};
	functionToolResults: Map<string, ToolExecutionResult>;
}

export function createFunctionToolContext(input: AgentRunnerInput): FunctionToolContext {
	return {
		reportRetrieval: input.reportRetrieval,
		campusSearch: {
			nextCitationIndex: input.citationStart,
			queue: Promise.resolve(),
			resultRefs: new Set(
				(input.priorEvidence ?? []).flatMap((item) => (item.resultRef ? [item.resultRef] : [])),
			),
		},
		functionToolBudget: { limit: input.limits.maxFunctionToolCalls, reserved: 0 },
		functionToolResults: new Map(),
	};
}
export async function invokeFunctionTool(
	runtimeTool: SdkToolRuntime,
	args: Record<string, unknown>,
	context: FunctionToolContext,
	invocationId: string,
) {
	if (context.functionToolBudget.reserved >= context.functionToolBudget.limit) {
		throw new AgentRuntimeError(
			"tool_call_budget_exhausted",
			"The admitted function tool call budget is exhausted.",
		);
	}
	context.functionToolBudget.reserved++;
	runtimeTool.signal?.throwIfAborted();
	const startedAt = new Date().toISOString();
	const started = performance.now();
	const deadlineAt = new Date(
		Math.min(
			Date.now() + (runtimeTool.timeoutMs ?? 45_000),
			retrievalDeadlineAt(runtimeTool.deadlineAt),
		),
	).toISOString();
	const result = await executeSdkTool(runtimeTool, args, context, invocationId, deadlineAt);
	context.functionToolResults.set(invocationId, {
		...result,
		argumentsJson: args,
		durationMs: Math.max(0.001, performance.now() - started),
		startedAt,
		completedAt: new Date().toISOString(),
		toolName: runtimeTool.name,
		invocationId,
	});
	return result;
}
async function executeSdkTool(
	runtimeTool: AgentRunnerInput["tools"][number],
	argumentsJson: Record<string, unknown>,
	context: FunctionToolContext,
	invocationId: string,
	deadlineAt: string,
) {
	if (Date.parse(deadlineAt) <= Date.now()) {
		return {
			status: "failed" as const,
			result: { error: "Retrieval budget exhausted; answer using existing materials." },
			failure: { code: "retrieval_budget_exhausted", operation: `tool.${runtimeTool.name}` },
		};
	}
	if (runtimeTool.name !== "campus_search") {
		return runtimeTool.execute(argumentsJson, { invocationId, deadlineAt });
	}
	const previous = context.campusSearch.queue;
	let release: () => void = () => undefined;
	context.campusSearch.queue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await runtimeTool.observe?.(argumentsJson, invocationId, { phase: "queued" });
	try {
		await waitForToolTurn(previous, runtimeTool.signal, Date.parse(deadlineAt));
	} catch (error) {
		await runtimeTool.observe?.(argumentsJson, invocationId, {
			phase: "failed",
			failureCode: "campus_search_timeout",
		});
		return {
			failure: {
				code: "campus_search_timeout",
				operation: "tool.campus_search",
				detail: error instanceof Error ? error.message : "campus search queue timed out",
				invocationId,
			},
			result: { error: "campus search queue timed out" },
			status: "failed" as const,
		};
	}
	try {
		if (runtimeTool.signal?.aborted) {
			await runtimeTool.observe?.(argumentsJson, invocationId, { phase: "canceled" });
			throw runtimeTool.signal.reason ?? new Error("Agent run was canceled.");
		}
		const citationStart = context.campusSearch.nextCitationIndex;
		const resultLimit = 5;
		context.reportRetrieval?.("campus", invocationId, "started");
		const result = await runtimeTool.execute(argumentsJson, {
			deadlineAt,
			citationStart,
			invocationId,
			resultLimit,
			excludedResultRefs: [...context.campusSearch.resultRefs],
		});
		const count = campusSearchResultCount(result, citationStart, resultLimit);
		if (result.status === "completed") {
			for (const item of result.result.results as Record<string, unknown>[]) {
				if (typeof item.result_ref === "string") {
					context.campusSearch.resultRefs.add(item.result_ref);
				}
			}
		}
		context.campusSearch.nextCitationIndex += count;
		context.reportRetrieval?.(
			"campus",
			invocationId,
			result.status === "completed"
				? count
					? "completed"
					: "no_match"
				: runtimeTool.signal?.aborted
					? "canceled"
					: "failed",
		);
		return result;
	} catch (error) {
		context.reportRetrieval?.(
			"campus",
			invocationId,
			runtimeTool.signal?.aborted ? "canceled" : "failed",
		);
		throw error;
	} finally {
		release();
	}
}

async function waitForToolTurn(
	previous: Promise<void>,
	signal: AbortSignal | undefined,
	deadlineMs: number,
): Promise<void> {
	const remaining = Math.max(1, deadlineMs - Date.now());
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error("campus search queue deadline exceeded")), remaining),
	);
	const canceled = signal
		? new Promise<never>((_, reject) => {
				if (signal.aborted) {
					reject(signal.reason ?? new Error("Agent run was canceled."));
				} else {
					signal.addEventListener(
						"abort",
						() => reject(signal.reason ?? new Error("Agent run was canceled.")),
						{ once: true },
					);
				}
			})
		: new Promise<never>(() => undefined);
	await Promise.race([previous, timeout, canceled]);
}

function campusSearchResultCount(
	result: Awaited<ReturnType<SdkToolRuntime["execute"]>>,
	citationStart: number,
	resultLimit: number,
): number {
	if (result.status !== "completed") {
		return 0;
	}
	const results = result.result.results;
	if (!Array.isArray(results) || results.length > resultLimit) {
		throw new AgentRuntimeError(
			"tool_execution_failed",
			"campus_search returned an invalid result list.",
		);
	}
	for (const [offset, item] of results.entries()) {
		if (
			item === null ||
			typeof item !== "object" ||
			(item as Record<string, unknown>).citation_index !== citationStart + offset
		) {
			throw new AgentRuntimeError(
				"tool_execution_failed",
				"campus_search returned invalid citation indexes.",
			);
		}
	}
	return results.length;
}
