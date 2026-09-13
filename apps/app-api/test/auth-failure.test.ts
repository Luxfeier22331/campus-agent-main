import { describe, expect, it } from "vitest";

import { classifyAuthenticationDependencyFailure } from "../src/app/routes/auth-failure";

describe("authentication dependency failure classification", () => {
	it("classifies connection timeouts", () => {
		expect(classifyAuthenticationDependencyFailure(new Error("connect ETIMEDOUT"))).toBe(
			"connect_timeout",
		);
	});

	it("classifies reset connections", () => {
		expect(classifyAuthenticationDependencyFailure(new Error("connection terminated"))).toBe(
			"connection_reset",
		);
	});

	it("classifies pool exhaustion", () => {
		expect(classifyAuthenticationDependencyFailure(new Error("pool has no available client"))).toBe(
			"pool_unavailable",
		);
	});

	it("does not expose unknown error details", () => {
		expect(classifyAuthenticationDependencyFailure(new Error("unexpected failure"))).toBe(
			"unknown",
		);
	});
});
