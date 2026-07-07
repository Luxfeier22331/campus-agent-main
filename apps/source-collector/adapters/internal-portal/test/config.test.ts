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
		expect(
			config.exportsDir.endsWith("apps/source-collector/adapters/internal-portal/runtime/exports"),
		).toBe(true);
		expect(config.requestMaxRetries).toBe(3);
		expect(
			config.authStorageStatePath.endsWith(
				"apps/source-collector/adapters/internal-portal/runtime/auth/storageState.json",
			),
		).toBe(true);
		expect(config.attachmentFetchStatusDatabaseUrl).toBeNull();
		expect(config.attachmentFetchStatusDisabled).toBe(false);
		expect(config.attachmentFetchRequestManifestPath).toBeNull();
		expect(config.defaultInlineVisualCapture).toBe(false);
		expect(config.authJsessionId).toBeNull();
		expect(config.authNginxCookie).toBeNull();
		expect(config.collectionMode).toBe("incremental");
		expect(config.internalPortalRunLedgerDatabaseUrl).toBeNull();
		expect(config.internalPortalRunLedgerDisabled).toBe(false);
		expect(config.historicalBackfillMaxPagesPerType).toBeNull();
		expect(config.writeLocalExports).toBe(false);
	});

	it("accepts explicit overrides from env-like input", () => {
		const config = resolveInternalPortalConfig({
			INTERNAL_PORTAL_AUTH_CHECK_NOTICE_TYPE: "6",
			INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu",
			INTERNAL_PORTAL_JSESSIONID: "session-2",
			INTERNAL_PORTAL_NGINX: "sticky-2",
			INTERNAL_PORTAL_PAGE_URL: "https://portal.example.edu/page/99#/",
			INTERNAL_PORTAL_BYPASS_PROXY: "false",
			INTERNAL_PORTAL_PROXY_SERVER: "http://127.0.0.1:10808",
			INTERNAL_PORTAL_ATTACHMENT_FETCH_STATUS_DATABASE_URL: "postgresql://runtime.example/postgres",
			INTERNAL_PORTAL_ATTACHMENT_FETCH_STATUS_DISABLE: "true",
			INTERNAL_PORTAL_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH:
				"/tmp/attachment-fetch-request-manifest.json",
			INTERNAL_PORTAL_DEFAULT_INLINE_VISUAL_CAPTURE: "false",
			INTERNAL_PORTAL_COLLECTION_MODE: "backfill",
			INTERNAL_PORTAL_RUN_LEDGER_DATABASE_URL: "postgresql://ledger.example/postgres",
			INTERNAL_PORTAL_RUN_LEDGER_DISABLE: "true",
			INTERNAL_PORTAL_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE: "500",
			INTERNAL_PORTAL_NOTICE_TYPE_ALLOWLIST: "9982, 6,9982",
			INTERNAL_PORTAL_REQUEST_MAX_RETRIES: "5",
			INTERNAL_PORTAL_RUNTIME_DIR: "/tmp/collector-runtime",
			INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".example.edu",
			INTERNAL_PORTAL_SSO_TGC: "sso-token",
			INTERNAL_PORTAL_WRITE_LOCAL_EXPORTS: "true",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
		expect(config.requestMaxRetries).toBe(5);
		expect("authCookieHeader" in config).toBe(false);
		expect(config.authJsessionId).toBe("session-2");
		expect(config.authNginxCookie).toBe("sticky-2");
		expect(config.authCheckNoticeType).toBe("6");
		expect(config.authSsoCookieDomain).toBe(".example.edu");
		expect(config.authSsoTgcToken).toBe("sso-token");
		expect(config.noticeTypeAllowlist).toEqual(["9982", "6"]);
		expect(config.attachmentFetchStatusDatabaseUrl).toBe("postgresql://runtime.example/postgres");
		expect(config.attachmentFetchStatusDisabled).toBe(true);
		expect(config.attachmentFetchRequestManifestPath).toBe(
			"/tmp/attachment-fetch-request-manifest.json",
		);
		expect(config.defaultInlineVisualCapture).toBe(false);
		expect(config.collectionMode).toBe("backfill");
		expect(config.internalPortalRunLedgerDatabaseUrl).toBe("postgresql://ledger.example/postgres");
		expect(config.internalPortalRunLedgerDisabled).toBe(true);
		expect(config.historicalBackfillMaxPagesPerType).toBe(500);
		expect(config.bypassProxyForPortal).toBe(false);
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
		expect(config.authStorageStatePath).toBe("/tmp/collector-runtime/auth/storageState.json");
		expect(config.writeLocalExports).toBe(true);
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

	it("requires an explicit SSO cookie domain when SSO_TGC is seeded", () => {
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_SSO_TGC: "sso-token",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN is required when INTERNAL_PORTAL_SSO_TGC is set");
	});

	it("rejects SSO cookie domains outside the configured portal host", () => {
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".edu.cn",
				INTERNAL_PORTAL_SSO_TGC: "sso-token",
			}),
		).toThrow("INTERNAL_PORTAL_SSO_COOKIE_DOMAIN must be a registrable parent domain");
		expect(() =>
			resolveInternalPortalConfig({
				INTERNAL_PORTAL_BASE_URL: "https://portal.example.edu.cn",
				INTERNAL_PORTAL_SSO_COOKIE_DOMAIN: ".other.edu.cn",
				INTERNAL_PORTAL_SSO_TGC: "sso-token",
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
	});

	it("appends muc portal hosts into no_proxy and preserves existing entries", () => {
		const env = {
			NO_PROXY: "localhost,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe(
			"localhost,127.0.0.1,example.edu,.example.edu,portal.example.edu,auth.example.edu",
		);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("does not duplicate muc portal hosts when no_proxy already contains them", () => {
		const env = {
			no_proxy: "localhost,.example.edu,portal.example.edu",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe(
			"localhost,.example.edu,portal.example.edu,example.edu,auth.example.edu",
		);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("removes muc portal hosts from no_proxy when proxy bypass is disabled", () => {
		const env = {
			INTERNAL_PORTAL_BYPASS_PROXY: "false",
			NO_PROXY: "localhost,example.edu,.example.edu,portal.example.edu,auth.example.edu,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyInternalPortalNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,127.0.0.1");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});
});
