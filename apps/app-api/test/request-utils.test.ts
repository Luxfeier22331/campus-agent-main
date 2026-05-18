// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveWaitUntil } from "../src/app/request-utils";

describe("request utils", () => {
	it("does not swallow runtime context waitUntil access errors", () => {
		const context = {
			get executionCtx(): { waitUntil(promise: Promise<unknown>): void } {
				throw new Error("execution context unavailable");
			},
		};

		expect(() => resolveWaitUntil(context)).toThrow("execution context unavailable");
	});
});
