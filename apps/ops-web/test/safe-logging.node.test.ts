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

		logOpsError("ops_web.postgres_pool", error, { source: "requests" });

		expect(spy).toHaveBeenCalledOnce();
		const serialized = String(spy.mock.calls[0]?.[0]);
		expect(JSON.parse(serialized)).toEqual({
			error_code: "57P01",
			event_type: "ops_web.postgres_pool",
			level: "error",
			source: "requests",
			status: "failed",
		});
		expect(serialized).toContain("57P01");
		expect(serialized).not.toContain("password");
		expect(serialized).not.toContain("secretKey");
		expect(serialized).not.toContain("12345");
		spy.mockRestore();
	});
});
