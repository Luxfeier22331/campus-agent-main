// @vitest-environment node

import { describe, expect, it } from "vitest";

import { publicExecutionFailure } from "../src/modules/runtime-command/service/writes";

describe("runtime command public execution errors", () => {
	it.each([
		"admission_confirmation_uncertain",
		"admission_identity_conflict",
	])("preserves the admission error code %s", (errorCode) => {
		expect(
			publicExecutionFailure({
				errorCode,
				status: "error",
			}),
		).toMatchObject({ errorCode });
	});
});
