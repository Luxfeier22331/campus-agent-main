// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { logOpsError } from "../src/server/safe-logging";

describe("safe ops logging", () => {
	it("logs only allowlisted error metadata", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const error = Object.assign(
			new Error("postgres://operator:password@db.internal/app?sslcert=secret"),
			{
				code: "57P01",
				secretKey: 12345,
			},
		);

		logOpsError("postgres pool error", error, { source: "requests" });

		const serialized = JSON.stringify(spy.mock.calls);
		expect(serialized).toContain("57P01");
		expect(serialized).not.toContain("password");
		expect(serialized).not.toContain("secretKey");
		expect(serialized).not.toContain("12345");
		spy.mockRestore();
	});
});
