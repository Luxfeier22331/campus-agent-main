import { describe, expect, it } from "vitest";

import { classifyAuthenticationDependencyFailure } from "../src/app/routes/auth-failure";

describe("authentication dependency failure classification", () => {
	it("classifies connection timeouts", () => {
		expect(
			classifyAuthenticationDependencyFailure(
				Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
			),
		).toBe("network_timeout");
	});

	it("classifies reset connections", () => {
		expect(
			classifyAuthenticationDependencyFailure(
				Object.assign(new Error("reset"), { code: "ECONNRESET" }),
			),
		).toBe("connection_reset");
	});

	it("classifies pool exhaustion", () => {
		expect(
			classifyAuthenticationDependencyFailure(Object.assign(new Error("pool"), { code: "53300" })),
		).toBe("connection_limit");
	});

	it("does not expose unknown error details", () => {
		expect(classifyAuthenticationDependencyFailure(new Error("unexpected failure"))).toBe(
			"unknown",
		);
	});
});
