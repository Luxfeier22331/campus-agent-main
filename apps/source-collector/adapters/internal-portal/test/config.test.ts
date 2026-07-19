import { describe, expect, it } from "vitest";

import { applyInternalPortalNoProxyEnv, resolveInternalPortalConfig } from "../src/config.js";

describe("internal portal source collector config", () => {
	it("uses repo-local runtime defaults and authenticated portal semantics", () => {
		const config = resolveInternalPortalConfig({});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/11#/");
		expect(config.sourceHomeUrl).toBe("https://portal.example.edu");
		expect(config.siteId).toBe("synthetic_internal_portal");
		expect(
			config.noticeTypesPath.endsWith(
				"apps/source-collector/adapters/internal-portal/config/notice-types.json",
			),
		).toBe(true);
		expect(config.requestMaxRetries).toBe(3);
		expect(
			config.authStorageStatePath.endsWith(
				"apps/source-collector/adapters/internal-portal/runtime/auth/storageState.json",
			),
		).toBe(true);
		expect(config.authSsoTgcFile.endsWith("runtime/auth/sso_tgc")).toBe(true);
		expect(config.reconcileMaxPagesPerType).toBeNull();
	});

	it("accepts explicit overrides from env-like input", () => {
		const config = resolveInternalPortalConfig({
			INTERNAL_PORTAL_AUTH_CHECK_NOTICE_TYPE: "6",
			INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu",
			INTERNAL_PORTAL_PAGE_URL: "https://portal.example.edu/page/99#/",
			INTERNAL_PORTAL_BYPASS_PROXY: "false",
			INTERNAL_PORTAL_PROXY_SERVER: "http://127.0.0.1:10808",
			INTERNAL_PORTAL_RECONCILE_MAX_PAGES_PER_TYPE: "500",
			INTERNAL_PORTAL_REQUEST_MAX_RETRIES: "5",
			INTERNAL_PORTAL_RUNTIME_DIR: "/tmp/collector-runtime",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".example.edu",
			INTERNAL_PORTAL_SSO_TGC_FILE: "/run/secrets/internal-portal/sso_tgc",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
		expect(config.requestMaxRetries).toBe(5);
		expect("authCookieHeader" in config).toBe(false);
		expect(config.authCheckNoticeType).toBe("6");
		expect(config.authSsoCookieDomain).toBe(".example.edu");
		expect(config.authSsoTgcFile).toBe("/run/secrets/internal-portal/sso_tgc");
		expect(config.reconcileMaxPagesPerType).toBe(500);
		expect(config.bypassProxyForPortal).toBe(false);
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
		expect(config.authStorageStatePath).toBe("/tmp/collector-runtime/auth/storageState.json");
	});

	it("resolves an explicit portal proxy server when proxy bypass is disabled", () => {
		const config = resolveInternalPortalConfig({
			INTERNAL_PORTAL_BYPASS_PROXY: "false",
			INTERNAL_PORTAL_PROXY_SERVER: "http://127.0.0.1:10808",
		});

		expect(config.bypassProxyForPortal).toBe(false);
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
	});

	it("requires an explicit portal proxy server when proxy bypass is disabled", () => {
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BYPASS_PROXY: "false",
				INTERNAL_PORTAL_PROXY_SERVER: "",
				HTTP_PROXY: "http://127.0.0.1:10808",
			}),
		).toThrow("INTERNAL_PORTAL_PROXY_SERVER is required when INTERNAL_PORTAL_BYPASS_PROXY=false");
	});

	it("rejects SSO cookie domains outside the configured portal host", () => {
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".edu.cn",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must be a registrable parent domain");
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".other.edu.cn",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must match or parent the portal host");
	});

	it("rejects invalid explicit SSO cookie domains even when SSO_TGC is not seeded", () => {
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".edu.cn",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must be a registrable parent domain");
	});

	it("rejects retired authenticated-notice env keys in internal-portal runtime", () => {
		expect(() =>
			resolveInternalPortalConfig({
				AUTHENTICATED_NOTICE_BASE_URL: "https://legacy.example.edu",
			}),
		).toThrow("retired internal-portal env keys are not supported: AUTHENTICATED_NOTICE_BASE_URL");
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_JSESSIONID: "retired-session",
				INTERNAL_PORTAL_NGINX: "retired-upstream",
				INTERNAL_PORTAL_SSO_TGC: "retired-ticket",
			}),
		).toThrow(
			"retired internal-portal env keys are not supported: INTERNAL_PORTAL_JSESSIONID, INTERNAL_PORTAL_NGINX, INTERNAL_PORTAL_SSO_TGC",
		);
	});

	it("derives portal hosts for no_proxy and preserves existing entries", () => {
		const env = {
			INTERNAL_PORTAL_BASE_URL: "https://my.muc.edu.cn",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".muc.edu.cn",
			NO_PROXY: "localhost,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,127.0.0.1,muc.edu.cn,.muc.edu.cn,my.muc.edu.cn");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("does not duplicate muc portal hosts when no_proxy already contains them", () => {
		const env = {
			INTERNAL_PORTAL_BASE_URL: "https://my.muc.edu.cn",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".muc.edu.cn",
			no_proxy: "localhost,.muc.edu.cn,my.muc.edu.cn",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,.muc.edu.cn,my.muc.edu.cn,muc.edu.cn");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("removes muc portal hosts from no_proxy when proxy bypass is disabled", () => {
		const env = {
			INTERNAL_PORTAL_BYPASS_PROXY: "false",
			INTERNAL_PORTAL_BASE_URL: "https://my.muc.edu.cn",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".muc.edu.cn",
			NO_PROXY: "localhost,muc.edu.cn,.muc.edu.cn,my.muc.edu.cn,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,127.0.0.1");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});
});
