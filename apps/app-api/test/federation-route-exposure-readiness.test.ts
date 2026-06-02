// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildFederationRuntimeReadinessReport } from "../scripts/verify-federation-runtime-readiness";

describe("federation route exposure readiness", () => {
	it("keeps production federation routes closed after provider runtime verification", () => {
		const report = buildFederationRuntimeReadinessReport();

		expect(report.oidcProviderAvailable).toBe(true);
		expect(report.oauthProviderInstalled).toBe(true);
		expect(report.recommendedProvider).toBe("better-auth-oauth-provider");
		expect(report.providerRuntime.status).toBe("provider_runtime_verified");
		expect(report.routeExposure).toEqual({
			federationRoutesExposed: false,
			productionRoutesExposed: [],
		});
		expect(report.status).toBe("provider_verified_routes_closed");
		expect(report.requiredChecks).toContain("worker-runtime-import");
		expect(report.requiredChecks).toContain("jwks-and-key-rotation");
	});
});
