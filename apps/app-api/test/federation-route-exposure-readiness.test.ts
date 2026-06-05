// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildFederationRuntimeReadinessReport } from "../scripts/verify-federation-runtime-readiness";

describe("federation route exposure readiness", () => {
	it("declares the implemented federation provider route surface", () => {
		const report = buildFederationRuntimeReadinessReport();

		expect(report.oidcProviderAvailable).toBe(true);
		expect(report.oauthProviderInstalled).toBe(true);
		expect(report.recommendedProvider).toBe("better-auth-oauth-provider");
		expect(report.providerRuntime.status).toBe("provider_runtime_verified");
		expect(report.routeExposure).toEqual({
			federationRoutesExposed: true,
			productionRoutesExposed: [
				"/.well-known/openid-configuration",
				"/.well-known/oauth-authorization-server",
				"/api/federation/authorize",
				"/api/federation/token",
				"/api/federation/userinfo",
				"/api/federation/jwks",
				"/api/federation/logout",
			],
		});
		expect(report.status).toBe("provider_verified_routes_exposed");
		expect(report.requiredChecks).toContain("worker-runtime-import");
		expect(report.requiredChecks).toContain("jwks-and-key-rotation");
	});
});
