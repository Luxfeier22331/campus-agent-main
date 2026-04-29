// @vitest-environment node

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSupervisorExecutionResponsePayload } from "../src/modules/integration/supervisor";

const fixtureDir = resolve(process.cwd(), "../..", "tests/fixtures/supervisor_execution_contract");

function loadFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

describe("supervisor execution canonical response fixtures", () => {
	it("parses canonical terminal state fixtures", () => {
		expect(
			parseSupervisorExecutionResponsePayload(
				loadFixture("response_completed_delegate.valid.json"),
				"fallback-trace",
			),
		).toMatchObject({
			selectedTarget: "rag-agent",
			status: "completed",
			traceId: "trace-contract-completed",
			workflowTraceSummary: {
				directVsDelegateBranch: "delegate",
				selectedTarget: "rag-agent",
				selectedTools: ["retrieval.query"],
			},
		});
		expect(
			parseSupervisorExecutionResponsePayload(
				loadFixture("response_cancelled_null_target.valid.json"),
				"fallback-trace",
			),
		).toMatchObject({
			error: {
				code: "execution_cancelled",
				retryable: false,
			},
			selectedTarget: null,
			status: "cancelled",
			traceId: "trace-contract-cancelled",
		});
		expect(
			parseSupervisorExecutionResponsePayload(
				loadFixture("response_timeout.valid.json"),
				"fallback-trace",
			),
		).toMatchObject({
			error: {
				code: "execution_timeout",
				retryable: true,
			},
			selectedTarget: null,
			status: "error",
		});
	});

	it("rejects non-canonical response fixtures instead of accepting camelCase fallback", () => {
		for (const fixtureName of [
			"response_camel_case.invalid.json",
			"response_extra_field.invalid.json",
		]) {
			expect(() =>
				parseSupervisorExecutionResponsePayload(loadFixture(fixtureName), "fallback-trace"),
			).toThrow(/supervisor response contract/i);
		}
	});
});
