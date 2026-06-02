import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";

const REQUIRED_ENDPOINTS = [
	"getOAuthServerConfig",
	"getOpenIdConfig",
	"oauth2Authorize",
	"oauth2Token",
	"oauth2UserInfo",
	"oauth2EndSession",
] as const;

const REQUIRED_SCHEMA_TABLES = [
	"oauthAccessToken",
	"oauthClient",
	"oauthConsent",
	"oauthRefreshToken",
] as const;

export interface FederationProviderRuntimeReadinessReport {
	provider: "better-auth-oauth-provider";
	providerInstalled: boolean;
	providerRuntimeImport: "verified";
	providerRuntimeAssembly: "verified" | "not_verified";
	endpoints: {
		available: string[];
		required: string[];
		verified: boolean;
	};
	schema: {
		available: string[];
		required: string[];
		verified: boolean;
	};
	jwtPlugin: {
		endpoints: string[];
		jwksEndpoint: "verified" | "not_verified";
		schema: string[];
	};
	staticClientRegistry: "configured";
	dynamicClientRegistration: "disabled";
	redirectUriPolicy: "static_allowlist_required";
	claimsPolicy: "app-owned-policy-required";
	jwksRotationPlan: "required_before_route_exposure";
	endSessionBehavior: "supported_by_provider_requires_contract_freeze";
	status: "provider_runtime_verified" | "provider_runtime_not_verified";
}

export function buildFederationProviderRuntimeReadinessReport(): FederationProviderRuntimeReadinessReport {
	const plugin = oauthProvider({
		allowDynamicClientRegistration: false,
		cachedTrustedClients: new Set(["muc-wiki"]),
		consentPage: "/account/federation/consent",
		loginPage: "/account/login",
		scopes: ["openid", "profile", "email"],
	});
	const jwtPlugin = jwt();
	const endpoints = Object.keys(plugin.endpoints ?? {});
	const schemaTables = Object.keys(plugin.schema ?? {});
	const jwtEndpoints = Object.keys(jwtPlugin.endpoints ?? {});
	const jwtSchemaTables = Object.keys(jwtPlugin.schema ?? {});
	const endpointsVerified = REQUIRED_ENDPOINTS.every((endpoint) => endpoints.includes(endpoint));
	const schemaVerified = REQUIRED_SCHEMA_TABLES.every((table) => schemaTables.includes(table));
	const jwksVerified = jwtPlugin.id === "jwt" && jwtEndpoints.includes("getJwks");
	const assembled =
		plugin.id === "oauth-provider" && endpointsVerified && schemaVerified && jwksVerified;

	return {
		provider: "better-auth-oauth-provider",
		providerInstalled: true,
		providerRuntimeImport: "verified",
		providerRuntimeAssembly: assembled ? "verified" : "not_verified",
		endpoints: {
			available: endpoints,
			required: [...REQUIRED_ENDPOINTS],
			verified: endpointsVerified,
		},
		schema: {
			available: schemaTables,
			required: [...REQUIRED_SCHEMA_TABLES],
			verified: schemaVerified,
		},
		jwtPlugin: {
			endpoints: jwtEndpoints,
			jwksEndpoint: jwksVerified ? "verified" : "not_verified",
			schema: jwtSchemaTables,
		},
		staticClientRegistry: "configured",
		dynamicClientRegistration: "disabled",
		redirectUriPolicy: "static_allowlist_required",
		claimsPolicy: "app-owned-policy-required",
		jwksRotationPlan: "required_before_route_exposure",
		endSessionBehavior: "supported_by_provider_requires_contract_freeze",
		status: assembled ? "provider_runtime_verified" : "provider_runtime_not_verified",
	};
}
