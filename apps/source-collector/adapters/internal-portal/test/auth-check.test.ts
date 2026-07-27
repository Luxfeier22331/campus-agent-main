import { describe, expect, it, vi } from "vitest";

import { checkAuth } from "../src/auth-check.js";
import type { InternalPortalConfig } from "../src/config.js";

const config: InternalPortalConfig = {
	authSsoCookieDomain: ".example.edu",
	authSsoTgc: "TGT-current",
	authSsoTgcFile: null,
	portalBaseUrl: "https://portal.example.edu",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	portalProxyServer: null,
	siteId: "synthetic_internal_portal",
	sourceHomeUrl: "https://portal.example.edu",
};

describe("internal portal source collector auth check", () => {
	it("establishes one portal session without calling a content surface", async () => {
		const checkAuthentication = vi.fn(async () => undefined);

		await expect(checkAuth({ config, checkAuthentication })).resolves.toBeUndefined();
		expect(checkAuthentication).toHaveBeenCalledOnce();
		expect(checkAuthentication).toHaveBeenCalledWith(config);
	});

	it("propagates session establishment failure", async () => {
		await expect(
			checkAuth({
				config,
				checkAuthentication: async () => {
					throw new Error("portal SSO did not issue a service ticket");
				},
			}),
		).rejects.toThrow("portal SSO did not issue a service ticket");
	});
});
