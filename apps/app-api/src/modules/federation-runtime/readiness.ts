import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import { buildFederationProviderClaimSet } from "./claims";
import {
	FEDERATION_CLAIMS,
	FEDERATION_ID_TOKEN_SIGNING_ALG,
	FEDERATION_JWKS_GRACE_PERIOD_SECONDS,
	FEDERATION_JWKS_KEY_PAIR_CONFIG,
	FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS,
	FEDERATION_SCOPES,
} from "./config";

const REQUIRED_ENDPOINTS = [
	"getOAuthClientPublic",
	"getOAuthServerConfig",
	"getOpenIdConfig",
	"oauth2Authorize",
	"oauth2Consent",
	"oauth2Token",
	"oauth2UserInfo",
	"oauth2EndSession",
] as const;

const REQUIRED_SCHEMA_TABLES = [
	"oauthAccessToken",
	"oauthClient",
	"oauthClientAssertion",
	"oauthClientResource",
	"oauthConsent",
	"oauthRefreshToken",
	"oauthResource",
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
		idTokenSigningAlg: typeof FEDERATION_ID_TOKEN_SIGNING_ALG;
		jwksEndpoint: "verified" | "not_verified";
		keyPairConfig: typeof FEDERATION_JWKS_KEY_PAIR_CONFIG;
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
		advertisedMetadata: {
			claims_supported: [...FEDERATION_CLAIMS],
			scopes_supported: [...FEDERATION_SCOPES],
		},
		consentPage: "/account/federation/consent",
		customIdTokenClaims: buildFederationProviderClaimSet,
		customUserInfoClaims: buildFederationProviderClaimSet,
		grantTypes: ["authorization_code", "refresh_token"],
		loginPage: "/account/login",
		scopes: [...FEDERATION_SCOPES],
	});
	const jwtPlugin = jwt({
		disableSettingJwtHeader: true,
		jwks: {
			gracePeriod: FEDERATION_JWKS_GRACE_PERIOD_SECONDS,
			keyPairConfig: FEDERATION_JWKS_KEY_PAIR_CONFIG,
			rotationInterval: FEDERATION_JWKS_ROTATION_INTERVAL_SECONDS,
		},
	});
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
			idTokenSigningAlg: FEDERATION_ID_TOKEN_SIGNING_ALG,
			jwksEndpoint: jwksVerified ? "verified" : "not_verified",
			keyPairConfig: FEDERATION_JWKS_KEY_PAIR_CONFIG,
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
