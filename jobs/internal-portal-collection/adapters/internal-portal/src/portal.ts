import {
	type CreatePortalApiContextDependencies,
	checkPortalAuthentication as checkSharedPortalAuthentication,
	createPortalApiContext as createSharedPortalApiContext,
	type InternalPortalClientConfig,
	PortalCredentialUnavailableError,
} from "@campus-agent/internal-portal-client";
import { type InternalPortalConfig, resolveInternalPortalConfig } from "./config.js";
import type { ApiRequestContextLike, DisposableApiContextLike } from "./types.js";

export { type PortalFetch, validateSsoTgc } from "@campus-agent/internal-portal-client";

export async function createPortalApiContext(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
	return await createSharedPortalApiContext(toClientConfig(config), dependencies);
}

export async function checkPortalAuthentication(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<void> {
	await checkSharedPortalAuthentication(toClientConfig(config), dependencies);
}

function toClientConfig(config: InternalPortalConfig): InternalPortalClientConfig {
	if (!config.authSsoTgc) {
		throw new PortalCredentialUnavailableError("INTERNAL_PORTAL_SSO_TGC is required");
	}
	if (!config.authSsoCookieDomain) {
		throw new PortalCredentialUnavailableError(
			"sso_cookie_domain is required in the internal portal descriptor",
		);
	}
	return {
		portalBaseUrl: config.portalBaseUrl,
		portalPageUrl: config.portalPageUrl,
		proxyServer: config.portalProxyServer,
		ssoCookieDomain: config.authSsoCookieDomain,
		ssoTgc: config.authSsoTgc,
	};
}
