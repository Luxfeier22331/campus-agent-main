import { describe, expect, it } from "vitest";

import { applyCollectorNoProxyEnv, resolveCollectorConfig } from "../src/config.js";

describe("authenticated notice collector config", () => {
	it("fails closed without an explicit authenticated portal URL", () => {
		expect(() => resolveCollectorConfig({})).toThrow("AUTHENTICATED_NOTICE_BASE_URL is required");
	});

	it("uses repo-local runtime defaults with explicit authenticated portal semantics", () => {
		const config = resolveCollectorConfig({
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
			AUTHENTICATED_NOTICE_SITE_ID: "example_internal_portal",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/11#/");
		expect(config.sourceHomeUrl).toBe("https://portal.example.edu");
		expect(config.siteId).toBe("example_internal_portal");
		expect(
			config.noticeTypesPath.endsWith(
				"apps/authenticated-notice-collector/config/notice-types.json",
			),
		).toBe(true);
		expect(config.exportsDir.endsWith("apps/authenticated-notice-collector/runtime/exports")).toBe(
			true,
		);
		expect(config.requestMaxRetries).toBe(3);
		expect(
			config.authStorageStatePath.endsWith(
				"apps/authenticated-notice-collector/runtime/auth/storageState.json",
			),
		).toBe(true);
		expect(config.attachmentFetchStatusDatabaseUrl).toBeNull();
		expect(config.attachmentFetchStatusDisabled).toBe(false);
		expect(config.attachmentFetchRequestManifestPath).toBeNull();
		expect(config.defaultInlineVisualCapture).toBe(false);
		expect(config.authJsessionId).toBeNull();
		expect(config.authNginxCookie).toBeNull();
		expect(config.collectionMode).toBe("incremental");
		expect(config.collectorRunLedgerDatabaseUrl).toBeNull();
		expect(config.collectorRunLedgerDisabled).toBe(false);
		expect(config.collectorRunLeaseDatabaseUrl).toBeNull();
		expect(config.collectorRunLeaseDisabled).toBe(false);
		expect(config.collectorRunLeaseTtlSeconds).toBe(3600);
		expect(config.historicalBackfillMaxPagesPerType).toBeNull();
		expect(config.writeLocalExports).toBe(false);
	});

	it("accepts explicit overrides from env-like input", () => {
		const config = resolveCollectorConfig({
			AUTHENTICATED_NOTICE_AUTH_CHECK_NOTICE_TYPE: "6",
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_SITE_ID: "example_internal_portal",
			AUTHENTICATED_NOTICE_JSESSIONID: "session-2",
			AUTHENTICATED_NOTICE_NGINX: "sticky-2",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/99#/",
			AUTHENTICATED_NOTICE_BYPASS_PROXY: "false",
			AUTHENTICATED_NOTICE_PROXY_SERVER: "http://127.0.0.1:10808",
			AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DATABASE_URL:
				"postgresql://runtime.example/postgres",
			AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DISABLE: "true",
			AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH:
				"/tmp/attachment-fetch-request-manifest.json",
			AUTHENTICATED_NOTICE_DEFAULT_INLINE_VISUAL_CAPTURE: "false",
			AUTHENTICATED_NOTICE_COLLECTION_MODE: "backfill",
			AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL:
				"postgresql://ledger.example/postgres",
			AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DISABLE: "true",
			AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL: "postgresql://lease.example/postgres",
			AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DISABLE: "true",
			AUTHENTICATED_NOTICE_COLLECTOR_LEASE_TTL_SECONDS: "120",
			AUTHENTICATED_NOTICE_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE: "500",
			AUTHENTICATED_NOTICE_NOTICE_TYPE_ALLOWLIST: "9982, 6,9982",
			AUTHENTICATED_NOTICE_REQUEST_MAX_RETRIES: "5",
			AUTHENTICATED_NOTICE_RUNTIME_DIR: "/tmp/collector-runtime",
			AUTHENTICATED_NOTICE_SSO_TGC: "sso-token",
			AUTHENTICATED_NOTICE_WRITE_LOCAL_EXPORTS: "true",
		});

		expect(config.portalBaseUrl).toBe("https://portal.example.edu");
		expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
		expect(config.requestMaxRetries).toBe(5);
		expect("authCookieHeader" in config).toBe(false);
		expect(config.authJsessionId).toBe("session-2");
		expect(config.authNginxCookie).toBe("sticky-2");
		expect(config.authCheckNoticeType).toBe("6");
		expect(config.authSsoTgcToken).toBe("sso-token");
		expect(config.noticeTypeAllowlist).toEqual(["9982", "6"]);
		expect(config.attachmentFetchStatusDatabaseUrl).toBe("postgresql://runtime.example/postgres");
		expect(config.attachmentFetchStatusDisabled).toBe(true);
		expect(config.attachmentFetchRequestManifestPath).toBe(
			"/tmp/attachment-fetch-request-manifest.json",
		);
		expect(config.defaultInlineVisualCapture).toBe(false);
		expect(config.collectionMode).toBe("backfill");
		expect(config.collectorRunLedgerDatabaseUrl).toBe("postgresql://ledger.example/postgres");
		expect(config.collectorRunLedgerDisabled).toBe(true);
		expect(config.collectorRunLeaseDatabaseUrl).toBe("postgresql://lease.example/postgres");
		expect(config.collectorRunLeaseDisabled).toBe(true);
		expect(config.collectorRunLeaseTtlSeconds).toBe(120);
		expect(config.historicalBackfillMaxPagesPerType).toBe(500);
		expect(config.bypassProxyForPortal).toBe(false);
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
		expect(config.authStorageStatePath).toBe("/tmp/collector-runtime/auth/storageState.json");
		expect(config.writeLocalExports).toBe(true);
	});

	it("resolves an explicit portal proxy server when proxy bypass is disabled", () => {
		const config = resolveCollectorConfig({
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_BYPASS_PROXY: "false",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
			AUTHENTICATED_NOTICE_PROXY_SERVER: "http://127.0.0.1:10808",
			AUTHENTICATED_NOTICE_SITE_ID: "example_internal_portal",
		});

		expect(config.bypassProxyForPortal).toBe(false);
		expect(config.portalProxyServer).toBe("http://127.0.0.1:10808");
	});

	it("requires an explicit portal proxy server when proxy bypass is disabled", () => {
		expect(() =>
			resolveCollectorConfig({
				AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
				AUTHENTICATED_NOTICE_BYPASS_PROXY: "false",
				AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
				AUTHENTICATED_NOTICE_PROXY_SERVER: "",
				AUTHENTICATED_NOTICE_SITE_ID: "example_internal_portal",
				HTTP_PROXY: "http://127.0.0.1:10808",
			}),
		).toThrow(
			"AUTHENTICATED_NOTICE_PROXY_SERVER is required when AUTHENTICATED_NOTICE_BYPASS_PROXY=false",
		);
	});

	it("appends configured portal hosts into no_proxy and preserves existing entries", () => {
		const env = {
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
			NO_PROXY: "localhost,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyCollectorNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,127.0.0.1,portal.example.edu,example.edu,.example.edu");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("does not duplicate configured portal hosts when no_proxy already contains them", () => {
		const env = {
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
			no_proxy: "localhost,.example.edu,portal.example.edu",
		} as NodeJS.ProcessEnv;

		applyCollectorNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,.example.edu,portal.example.edu,example.edu");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("removes configured portal hosts from no_proxy when proxy bypass is disabled", () => {
		const env = {
			AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
			AUTHENTICATED_NOTICE_BYPASS_PROXY: "false",
			AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/11#/",
			NO_PROXY: "localhost,example.edu,.example.edu,portal.example.edu,127.0.0.1",
		} as NodeJS.ProcessEnv;

		applyCollectorNoProxyEnv(env);

		expect(env.NO_PROXY).toBe("localhost,127.0.0.1");
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});
});
