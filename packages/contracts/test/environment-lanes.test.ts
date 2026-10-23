import {
	authCookiePrefix,
	isEnvironmentLane,
	laneIssuerPath,
	laneQueryValue,
	parseLaneQueryValue,
} from "campus-contracts/environment-lanes";
import { describe, expect, it } from "vitest";

describe("environment lanes", () => {
	it("maps short query values to deployed lanes and round-trips them", () => {
		expect(parseLaneQueryValue("staging")).toBe("staging");
		expect(parseLaneQueryValue("prod")).toBe("production");
		expect(laneQueryValue("production")).toBe("prod");
		expect(laneQueryValue("staging")).toBe("staging");
	});

	it("rejects values outside the allowlist", () => {
		for (const value of [null, "", "production", "STAGING", "toString", "__proto__"]) {
			expect(parseLaneQueryValue(value)).toBeNull();
		}
		expect(isEnvironmentLane("development")).toBe(false);
	});

	it("gives each lane a distinct auth cookie prefix", () => {
		expect(authCookiePrefix("staging")).toBe("campus-staging");
		expect(authCookiePrefix("production")).toBe("campus-production");
	});

	it("keeps production on the root issuer and prefixes other lanes", () => {
		expect(laneIssuerPath("production")).toBe("");
		expect(laneIssuerPath("staging")).toBe("/lanes/staging");
	});
});
