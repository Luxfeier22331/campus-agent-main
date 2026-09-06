// @vitest-environment node

import { describe, expect, it } from "vitest";

import { publicExecutionFailure } from "../src/modules/runtime-command/service/errors";

describe("runtime command public execution errors", () => {
	it.each([
		["provider_connection_failed", "provider_unavailable"],
		["agent_deadline_exceeded", "execution_timeout"],
		["invalid_request", "runtime_invariant_failed"],
		["agent_runtime_not_configured", "runtime_invariant_failed"],
		["agent_runtime_result_invalid", "runtime_invariant_failed"],
		["finalization_projection_conflict", "runtime_invariant_failed"],
		["model_target_mismatch", "runtime_invariant_failed"],
		["agent_runtime_failed", "run_failed"],
		["future_bounded_failure", "run_failed"],
	] as const)("maps %s to the product error %s", (sourceCode, publicCode) => {
		expect(
			publicExecutionFailure({
				errorCode: sourceCode,
				status: "error",
			}),
		).toMatchObject({ errorCode: publicCode });
	});

	it("uses the runtime tool error message without campus retrieval wording", () => {
		expect(
			publicExecutionFailure({
				errorCode: "tool_execution_failed",
				status: "error",
			}),
		).toEqual({
			errorCode: "tool_execution_failed",
			message: "A runtime tool could not complete.",
		});
	});
});
