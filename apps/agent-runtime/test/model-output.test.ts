import { describe, expect, it } from "vitest";
import type { AgentRunnerInput, AgentRunnerResult } from "../src/agent-run-contract.ts";
import {
	ModelOutputError,
	modelOutputDiagnostic,
	parseModelOutputJSON,
} from "../src/model-output.ts";

describe("model output diagnostics", () => {
	it("bounds UTF-8 without changing the model output or splitting characters", () => {
		const text = "中".repeat(30000);
		const result = {
			finalOutput: text,
			rawModelOutput: { text, finishReason: "STOP" },
		} as AgentRunnerResult;
		const diagnostic = modelOutputDiagnostic(
			new ModelOutputError("json_parse", "workflow.execute_step", new SyntaxError("invalid")),
			{
				operation: "execute_step",
				outputSchema: { name: "executor_output", schema: {} },
			} as AgentRunnerInput,
			result,
		);
		if (!diagnostic) {
			throw new Error("diagnostic missing");
		}
		expect(diagnostic.original_utf8_bytes).toBe(90000);
		expect(Buffer.byteLength(diagnostic.text)).toBe(65535);
		expect(diagnostic.text).not.toContain("�");
		expect(diagnostic.truncated).toBe(true);
		expect(result.finalOutput).toBe(text);
	});
	it("does not mistake an unavailable raw snapshot for empty model output", () => {
		expect(
			modelOutputDiagnostic(
				new ModelOutputError(
					"schema_validation",
					"workflow.execute_step",
					new Error("invalid schema"),
				),
				{ operation: "execute_step" } as AgentRunnerInput,
				{ finalOutput: "", structuredOutput: { summary: 42 } } as AgentRunnerResult,
			),
		).toBeUndefined();
	});
	it.each(["", "```json\n{}\n```", "plain text"])(
		"classifies invalid JSON without embedding its body in the error: %s",
		(text) => {
			expect(() => parseModelOutputJSON(text, "workflow.execute_step")).toThrow(ModelOutputError);
			try {
				parseModelOutputJSON(text, "workflow.execute_step");
			} catch (error) {
				expect(error).toMatchObject({
					code: "model_output_invalid",
					validationStage: "json_parse",
				});
			}
		},
	);
});
