import type { AgentRunnerInput, AgentRunnerResult } from "./agent-run-contract.ts";
import { ModelOutputError, modelOutputDiagnostic } from "./model-output.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";

// A terminal operation failure still owns the successfully completed tool work.
export function failedRunnerResult(
	error: unknown,
	input: AgentRunnerInput,
	result: AgentRunnerResult,
): AgentRunnerResult {
	if (input.signal?.aborted && input.signal.reason?.name !== "TimeoutError") {
		throw input.signal.reason;
	}
	if (
		!(error instanceof ModelOutputError) &&
		result.toolResults.length === 0 &&
		result.webEvidence?.length === 0 &&
		!result.answerStarted
	) {
		throw error;
	}
	const failure = agentRuntimeErrorPayload(error, {
		...(input.signal?.aborted ? { deadlineSignal: input.signal } : {}),
		operation: `workflow.${input.operation}`,
	});
	const diagnostic =
		error instanceof ModelOutputError ? modelOutputDiagnostic(error, input, result) : undefined;
	return {
		...result,
		...(diagnostic ? { modelOutputDiagnostic: diagnostic } : {}),
		finalOutput: "",
		failure: {
			code: failure.code,
			operation: failure.operation,
			...(failure.detail ? { detail: failure.detail } : {}),
			...(failure.http_status === undefined ? {} : { httpStatus: failure.http_status }),
			...(failure.invocation_id ? { invocationId: failure.invocation_id } : {}),
		},
	};
}
