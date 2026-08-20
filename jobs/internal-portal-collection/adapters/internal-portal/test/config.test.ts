import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";

import {
	type InternalPortalDescriptor,
	loadInternalPortalDescriptor,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
	resolveInternalPortalSiteId,
} from "../src/config.js";

const TEST_DESCRIPTOR: InternalPortalDescriptor = {
	portalBaseUrl: "https://portal.example.edu",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	siteId: "synthetic_internal_portal",
	sourceHomeUrl: "https://portal.example.edu",
	ssoCookieDomain: ".example.edu",
};

function resolveTestConfig(
	source: Record<string, string | undefined> = {},
	descriptor: InternalPortalDescriptor = TEST_DESCRIPTOR,
) {
	return resolveInternalPortalConfig(
		{
			INTERNAL_PORTAL_SSO_TGC: "TGT-current",
			...source,
		},
		descriptor,
	);
}

describe("internal portal collection config", () => {
	it("loads only adapter-owned env files without overriding process env", () => {
		const config = vi.spyOn(dotenv, "config").mockReturnValue({ parsed: {} });
		const processEnv = {};

		loadInternalPortalEnv(processEnv);

		expect(config).toHaveBeenCalledTimes(2);
		expect(config.mock.calls[0]?.[0]).toMatchObject({
			path: expect.stringMatching(/adapters\/internal-portal\/\.env\.local$/u),
			quiet: true,
		});
		expect(config.mock.calls[1]?.[0]).toMatchObject({
			path: expect.stringMatching(/adapters\/internal-portal\/\.env$/u),
			quiet: true,
		});
		expect(config.mock.calls.every(([options]) => options?.override !== true)).toBe(true);
		expect(config.mock.calls.every(([options]) => options?.processEnv === processEnv)).toBe(true);
		config.mockRestore();
	});

	it("loads the repository-owned portal descriptor", () => {
		expect(loadInternalPortalDescriptor()).toMatchObject({
			portalBaseUrl: "https://my.muc.edu.cn",
			siteId: "muc_internal_portal",
		});
		expect(resolveInternalPortalSiteId(TEST_DESCRIPTOR)).toBe("synthetic_internal_portal");
	});

	it("uses authenticated portal defaults", () => {
		const config = resolveTestConfig();

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/11#/");
		expect(config.sourceHomeUrl).toBe("https://portal.example.edu");
		expect(config.siteId).toBe("synthetic_internal_portal");
		expect(config.authSsoTgc).toBe("TGT-current");
		expect(config.portalProxyServer).toBeNull();
	});

	it("leaves the local TGC optional until an authenticated command runs", () => {
		const config = resolveInternalPortalConfig({});

		expect(config.authSsoTgc).toBeNull();
	});

	it("keeps credentials and the local proxy as environment inputs", () => {
		const config = resolveTestConfig(
			{
				INTERNAL_PORTAL_PROXY_SERVER: "http://127.0.0.1:10808",
			},
			{
				...TEST_DESCRIPTOR,
				portalPageUrl: "https://portal.example.edu/page/99#/",
			},
		);

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
		expect(config.authSsoCookieDomain).toBe(".example.edu");
		expect(config.authSsoTgc).toBe("TGT-current");
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
	});

	it("ignores retired env keys instead of creating migration guards", () => {
		const config = resolveTestConfig({
			AUTHENTICATED_NOTICE_BASE_URL: "https://legacy.example.edu",
			INTERNAL_PORTAL_JSESSIONID: "retired-session",
			INTERNAL_PORTAL_NGINX: "retired-upstream",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.authSsoTgc).toBe("TGT-current");
	});

	it("rejects SSO cookie domains outside the configured portal host", () => {
		expect(() =>
			resolveTestConfig(
				{},
				{
					...TEST_DESCRIPTOR,
					portalBaseUrl: "https://portal.example.edu.cn",
					portalPageUrl: "https://portal.example.edu.cn/page/11#/",
					ssoCookieDomain: ".edu.cn",
				},
			),
		).toThrow("sso_cookie_domain must be a registrable parent domain");
		expect(() =>
			resolveTestConfig(
				{},
				{
					...TEST_DESCRIPTOR,
					portalBaseUrl: "https://portal.example.edu.cn",
					portalPageUrl: "https://portal.example.edu.cn/page/11#/",
					ssoCookieDomain: ".other.edu.cn",
				},
			),
		).toThrow("sso_cookie_domain must match or parent the portal host");
	});

	it("requires credential-free HTTPS portal URLs on one portal host", () => {
		expect(() =>
			resolveTestConfig({}, { ...TEST_DESCRIPTOR, portalBaseUrl: "http://portal.example.edu" }),
		).toThrow("portal_base_url must be a credential-free HTTPS URL");
		expect(() =>
			resolveTestConfig(
				{},
				{
					...TEST_DESCRIPTOR,
					portalPageUrl: "https://other.example.edu/page/11#/",
				},
			),
		).toThrow("portal_page_url must use the portal host");
	});
});
