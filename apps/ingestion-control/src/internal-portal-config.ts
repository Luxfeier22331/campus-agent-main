import type { InternalPortalClientConfig } from "@campus-agent/internal-portal-client";
import descriptor from "../../../configs/sources/internal-portal.json" with { type: "json" };

export function createInternalPortalClientConfig(ssoTgc: string): InternalPortalClientConfig {
	return {
		portalBaseUrl: descriptor.portal_base_url,
		portalPageUrl: descriptor.portal_page_url,
		proxyServer: null,
		ssoCookieDomain: descriptor.sso_cookie_domain,
		ssoTgc,
	};
}
