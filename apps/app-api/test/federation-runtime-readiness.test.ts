import { describe, expect, it } from "vitest";

import { buildFederationProviderRuntimeReadinessReport } from "../src/modules/federation-runtime/readiness";

describe("federation runtime readiness", () => {
	it("verifies the OAuth provider runtime assembly", () => {
		const report = buildFederationProviderRuntimeReadinessReport();

		expect(report).toMatchObject({
			dynamicClientRegistration: "disabled",
			provider: "better-auth-oauth-provider",
			providerInstalled: true,
			providerRuntimeAssembly: "verified",
			providerRuntimeImport: "verified",
			staticClientRegistry: "configured",
			status: "provider_runtime_verified",
		});
		expect(report.endpoints.required).toEqual(
			expect.arrayContaining([
				"getOAuthServerConfig",
				"getOpenIdConfig",
				"oauth2Authorize",
				"oauth2Token",
				"oauth2UserInfo",
				"oauth2EndSession",
			]),
		);
		expect(report.schema.required).toEqual(
			expect.arrayContaining([
				"oauthAccessToken",
				"oauthClient",
				"oauthConsent",
				"oauthRefreshToken",
			]),
		);
		expect(report.endpoints.verified).toBe(true);
		expect(report.schema.verified).toBe(true);
		expect(report.jwtPlugin).toMatchObject({
			idTokenSigningAlg: "RS256",
			jwksEndpoint: "verified",
			keyPairConfig: {
				alg: "RS256",
				modulusLength: 2048,
			},
		});
		expect(report.jwtPlugin.endpoints).toEqual(
			expect.arrayContaining(["getJwks", "getToken", "signJWT", "verifyJWT"]),
		);
		expect(report.jwtPlugin.schema).toContain("jwks");
		expect(report.jwksRotationPlan).toBe("required_before_route_exposure");
	});
});
