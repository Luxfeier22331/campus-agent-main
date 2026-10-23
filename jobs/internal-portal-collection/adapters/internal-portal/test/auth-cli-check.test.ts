import { describe, expect, it, vi } from "vitest";

import type { InternalPortalConfig } from "../src/config.js";
import { checkInternalPortalAuth } from "../src/auth-cli.js";
import { checkPortalAuthentication } from "../src/portal.js";

const config: InternalPortalConfig = {
	authSsoCookieDomain: ".example.edu",
	authSsoTgc: "TGT-current",
	portalBaseUrl: "https://portal.example.edu",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	portalProxyServer: null,
	siteId: "synthetic_internal_portal",
	sourceHomeUrl: "https://portal.example.edu",
};

describe("internal portal auth check", () => {
	it("establishes one portal session without calling a content surface", async () => {
		const checkAuthentication = vi.fn<typeof checkPortalAuthentication>(async () => undefined);

		await checkInternalPortalAuth({ config, checkAuthentication });
		expect(checkAuthentication).toHaveBeenCalledOnce();
		const [actualConfig, options] = checkAuthentication.mock.calls[0] ?? [];
		expect(actualConfig).toEqual(config);
		expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
	});

	it("propagates session establishment failure", async () => {
		await expect(
			checkInternalPortalAuth({
				config,
				checkAuthentication: async () => {
					throw new Error("portal SSO did not issue a service ticket");
				},
			}),
		).rejects.toThrow("portal SSO did not issue a service ticket");
	});
});
