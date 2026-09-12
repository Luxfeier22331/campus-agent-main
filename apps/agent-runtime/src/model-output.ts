import type {
	AgentRunnerInput,
	AgentRunnerResult,
	ModelOutputDiagnostic,
} from "./agent-run-contract.ts";
import { AgentRuntimeError, summarizeRuntimeError } from "./runtime-errors.ts";

export class ModelOutputError extends AgentRuntimeError {
	readonly validationStage: ModelOutputDiagnostic["validation_stage"];
	constructor(
		validationStage: ModelOutputDiagnostic["validation_stage"],
		operation: string,
		cause: unknown,
	) {
		super("model_output_invalid", "Model returned invalid structured output.", {
			operation,
			detail: summarizeRuntimeError(cause),
		});
		this.validationStage = validationStage;
	}
}

export function parseModelOutputJSON(text: string, operation: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new ModelOutputError("json_parse", operation, error);
	}
}

export function modelOutputDiagnostic(
	error: ModelOutputError,
	input: AgentRunnerInput,
	result: AgentRunnerResult,
): ModelOutputDiagnostic | undefined {
	// A normalized structured result is not the original visible model text.
	if (!result.rawModelOutput) {
		return undefined;
	}
	const text = result.rawModelOutput.text;
	const bytes = Buffer.from(text, "utf8");
	const limit = 64 * 1024;
	let end = Math.min(bytes.length, limit);
	// Do not cut inside a multi-byte code point.
	while (end < bytes.length && end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) {
		end--;
	}
	return {
		schema_version: 1,
		text: bytes.subarray(0, end).toString("utf8"),
		original_utf8_bytes: bytes.length,
		truncated: end < bytes.length,
		validation_stage: error.validationStage,
		validation_message: error.failure.detail ?? "Invalid model output",
		output_schema: input.outputSchema?.name ?? input.operation,
		finish_reason: result.rawModelOutput?.finishReason ?? null,
	};
}
