// @vitest-environment node

import { describe, expect, it } from "vitest";

import { publicExecutionFailure } from "../src/modules/runtime-command/service/writes";

describe("runtime command public execution errors", () => {
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
