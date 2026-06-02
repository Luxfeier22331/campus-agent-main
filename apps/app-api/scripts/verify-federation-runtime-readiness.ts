import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildFederationProviderRuntimeReadinessReport } from "../src/modules/federation-runtime/readiness.ts";

const require = createRequire(import.meta.url);
const repoRoot = resolve(process.cwd(), "../..");

function hasPackage(specifier: string): boolean {
	try {
		require.resolve(specifier);
		return true;
	} catch {
		return false;
	}
}

function hasRoutePattern(pattern: string): boolean {
	const source = readFileSync(resolve(repoRoot, "apps/app-api/src/app/route-exposure.ts"), "utf8");
	return source.includes(pattern);
}

export function buildFederationRuntimeReadinessReport() {
	const oauthProviderInstalled = hasPackage("@better-auth/oauth-provider");
	const oidcProviderAvailable = hasPackage("better-auth/plugins");
	const providerRuntime = buildFederationProviderRuntimeReadinessReport();
	const productionRoutesExposed = [
		"/api/federation/",
		"/.well-known/openid-configuration",
		"/.well-known/oauth-authorization-server",
		"/oauth2/",
	].filter(hasRoutePattern);

	return {
		recommendedProvider: "better-auth-oauth-provider",
		oauthProviderInstalled,
		oidcProviderAvailable,
		providerRuntime,
		routeExposure: {
			federationRoutesExposed: productionRoutesExposed.length > 0,
			productionRoutesExposed,
		},
		requiredChecks: [
			"worker-runtime-import",
			"drizzle-schema-generation",
			"static-client-registry",
			"redirect-uri-allowlist",
			"claims-policy-mapping",
			"jwks-and-key-rotation",
			"end-session-behavior",
		],
		status:
			oauthProviderInstalled &&
			providerRuntime.status === "provider_runtime_verified" &&
			productionRoutesExposed.length === 0
				? "provider_verified_routes_closed"
				: "blocked_before_route_exposure",
	};
}

if (process.argv[1]?.endsWith("verify-federation-runtime-readiness.ts")) {
	console.log(JSON.stringify(buildFederationRuntimeReadinessReport(), null, 2));
}
