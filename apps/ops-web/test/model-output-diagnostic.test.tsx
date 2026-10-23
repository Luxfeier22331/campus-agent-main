import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ModelOutputDiagnosticPanel } from "../src/app/model-output-diagnostic.tsx";
import type { ModelOutputDiagnostic } from "../src/shared/model-output-diagnostic.ts";

afterEach(cleanup);
const diagnostic: ModelOutputDiagnostic = {
	schema_version: 1,
	text: "<script>bad()</script>",
	original_utf8_bytes: 22,
	truncated: false,
	validation_stage: "json_parse",
	validation_message: "Invalid JSON",
	output_schema: "executor_output",
	finish_reason: "STOP",
};
describe("model output diagnostics", () => {
	it("renders the actual failed text as plain text", () => {
		const { container } = render(<ModelOutputDiagnosticPanel diagnostic={diagnostic} />);
		expect(screen.getByText(diagnostic.text)).toBeTruthy();
		expect(container.querySelector("script")).toBeNull();
		expect(screen.getByText(/STOP/)).toBeTruthy();
	});
	it("distinguishes empty output from a missing observation", () => {
		const { rerender } = render(
			<ModelOutputDiagnosticPanel
				diagnostic={{ ...diagnostic, text: "", original_utf8_bytes: 0 }}
			/>,
		);
		expect(screen.getByText("模型返回空文本")).toBeTruthy();
		rerender(<ModelOutputDiagnosticPanel diagnostic={null} />);
		expect(screen.queryByText("模型返回空文本")).toBeNull();
		expect(screen.getByText(/未记录模型输出/)).toBeTruthy();
	});
	it("labels truncated text", () => {
		render(
			<ModelOutputDiagnosticPanel
				diagnostic={{ ...diagnostic, truncated: true, original_utf8_bytes: 100000 }}
			/>,
		);
		expect(screen.getByText(/已截断/)).toBeTruthy();
	});
});
