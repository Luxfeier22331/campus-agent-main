import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";

import {
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
	resolveInternalPortalSiteId,
} from "../src/config.js";

const TEST_SSO_TGC_FILE = "/tmp/internal-portal-sso-tgc";

function resolveTestConfig(source: Record<string, string | undefined> = {}) {
	return resolveInternalPortalConfig({
		INTERNAL_PORTAL_SSO_TGC_FILE: TEST_SSO_TGC_FILE,
		...source,
	});
}

describe("internal portal source collector config", () => {
	it("loads managed local, developer, and repository env without overriding process env", () => {
		const config = vi.spyOn(dotenv, "config").mockReturnValue({ parsed: {} });

		loadInternalPortalEnv();

		expect(config).toHaveBeenCalledTimes(3);
		expect(config.mock.calls[0]?.[0]).toMatchObject({
			path: expect.stringMatching(/adapters\/internal-portal\/\.env\.local$/u),
			quiet: true,
		});
		expect(config.mock.calls[1]?.[0]).toMatchObject({
			path: expect.stringMatching(/adapters\/internal-portal\/\.env$/u),
			quiet: true,
		});
		expect(config.mock.calls[2]?.[0]).toMatchObject({
			path: expect.stringMatching(/\/\.env$/u),
			quiet: true,
		});
		expect(String(config.mock.calls[2]?.[0]?.path)).not.toContain("adapters/internal-portal");
		expect(config.mock.calls.every(([options]) => options?.override !== true)).toBe(true);
		config.mockRestore();
	});

	it("resolves site identity without parsing unrelated portal configuration", () => {
		expect(
			resolveInternalPortalSiteId({
				INTERNAL_PORTAL_BASE_URL: "not-a-url",
				INTERNAL_PORTAL_SITE_ID: "muc_internal_portal",
			}),
		).toBe("muc_internal_portal");
	});

	it("uses authenticated portal defaults", () => {
		const config = resolveTestConfig();

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/11#/");
		expect(config.sourceHomeUrl).toBe("https://portal.example.edu");
		expect(config.siteId).toBe("synthetic_internal_portal");
		expect(config.authSsoTgc).toBeNull();
		expect(config.authSsoTgcFile).toBe(TEST_SSO_TGC_FILE);
		expect(config.portalProxyServer).toBeNull();
	});

	it("accepts a direct TGC and leaves the file optional", () => {
		const config = resolveInternalPortalConfig({ INTERNAL_PORTAL_SSO_TGC: "TGT-current" });

		expect(config.authSsoTgc).toBe("TGT-current");
		expect(config.authSsoTgcFile).toBeNull();
	});

	it("accepts explicit overrides from env-like input", () => {
		const config = resolveTestConfig({
			INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu",
			INTERNAL_PORTAL_PAGE_URL: "https://portal.example.edu/page/99#/",
			INTERNAL_PORTAL_PROXY_SERVER: "http://127.0.0.1:10808",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".example.edu",
			INTERNAL_PORTAL_SSO_TGC_FILE: "/run/secrets/internal-portal/sso_tgc",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
		expect(config.authSsoCookieDomain).toBe(".example.edu");
		expect(config.authSsoTgc).toBeNull();
		expect(config.authSsoTgcFile).toBe("/run/secrets/internal-portal/sso_tgc");
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
	});

	it("requires direct and file-backed TGC inputs to be mutually exclusive", () => {
		expect(() =>
			resolveTestConfig({
				INTERNAL_PORTAL_SSO_TGC: "TGT-local",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_TGC and INTERNAL_PORTAL_SSO_TGC_FILE are mutually exclusive");
	});

	it("ignores retired env keys instead of creating migration guards", () => {
		const config = resolveTestConfig({
			AUTHENTICATED_NOTICE_BASE_URL: "https://legacy.example.edu",
			INTERNAL_PORTAL_JSESSIONID: "retired-session",
			INTERNAL_PORTAL_NGINX: "retired-upstream",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.authSsoTgcFile).toBe(TEST_SSO_TGC_FILE);
	});

	it("rejects SSO cookie domains outside the configured portal host", () => {
		expect(() =>
			resolveTestConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".edu.cn",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must be a registrable parent domain");
		expect(() =>
			resolveTestConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".other.edu.cn",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must match or parent the portal host");
	});

	it("requires credential-free HTTPS portal URLs on one portal host", () => {
		expect(() =>
			resolveTestConfig({
				INTERNAL_PORTAL_BASE_URL: "http://portal.example.edu",
			}),
		).toThrow("INTERNAL_PORTAL_BASE_URL must be a credential-free HTTPS URL");
		expect(() =>
			resolveTestConfig({
				INTERNAL_PORTAL_PAGE_URL: "https://other.example.edu/page/11#/",
			}),
		).toThrow("INTERNAL_PORTAL_PAGE_URL must use the portal host");
	});
});
