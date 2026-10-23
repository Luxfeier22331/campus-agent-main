import { describe, expect, it } from "vitest";

import { formatRawError } from "../src/raw-error.ts";

describe("raw job errors", () => {
	it("keeps the complete stack and cause chain", () => {
		const cause = new Error("provider returned HTTP 502: upstream body");
		cause.stack = "CAUSE STACK";
		const error = new Error("classification failed", { cause });
		error.stack = "OUTER STACK";

		expect(formatRawError(error)).toBe("OUTER STACK\nCaused by: CAUSE STACK");
	});

	it("does not redact non-Error values", () => {
		expect(formatRawError("Bearer debugging-token")).toBe("Bearer debugging-token");
	});
});
