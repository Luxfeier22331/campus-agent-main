import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { InternalPortalConfig } from "../src/config.js";
import { createApiContextFromStorageState } from "../src/portal.js";

describe("internal portal source collector portal bootstrap", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it("uses stored auth state without bootstrapping the portal page", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-storage-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];
		let disposed = false;

		const config = buildConfig(runtimeDir);
		writeStorageState(config, [{ name: "JSESSIONID", value: "stored-session" }]);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				calls.push(`request.newContext:${input.storageState.cookies[0]?.value ?? "missing"}`);
				expect(input.baseURL).toBe("https://portal.example.edu");
				expect(input.extraHTTPHeaders.referer).toBe("https://portal.example.edu/page/11");
				return {
					dispose: async () => {
						disposed = true;
					},
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		expect(calls).toEqual(["request.newContext:stored-session"]);

		await apiContext.dispose();
		expect(disposed).toBe(true);
	});

	it("fails closed when stored auth state is missing", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-storage-missing-"));
		tempDirs.push(runtimeDir);

		await expect(createApiContextFromStorageState(buildConfig(runtimeDir))).rejects.toThrow(
			"auth storage state or explicit portal cookies are required",
		);
	});

	it("creates missing stored auth state from explicit operator cookies", async () => {
		const runtimeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "collector-portal-storage-seed-missing-"),
		);
		tempDirs.push(runtimeDir);
		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "seeded-session",
		};

		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				expect(input.storageState).toMatchObject({
					cookies: [expect.objectContaining({ name: "JSESSIONID", value: "seeded-session" })],
					origins: [],
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		expect(fileMode(config.authStorageStatePath)).toBe(0o600);
		expect(JSON.parse(fs.readFileSync(config.authStorageStatePath, "utf-8"))).toMatchObject({
			cookies: [expect.objectContaining({ name: "JSESSIONID", value: "seeded-session" })],
			origins: [],
		});
		await apiContext.dispose();
	});

	it("fails closed when stored auth state is invalid", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-storage-invalid-"));
		tempDirs.push(runtimeDir);

		const config = buildConfig(runtimeDir);
		fs.mkdirSync(path.dirname(config.authStorageStatePath), { recursive: true });
		fs.writeFileSync(config.authStorageStatePath, JSON.stringify({ cookies: [] }), "utf-8");

		await expect(createApiContextFromStorageState(config)).rejects.toThrow("invalid storage state");
	});

	it("seeds stored auth from an explicit SSO_TGC token before creating API context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-sso-token-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = {
			...buildConfig(runtimeDir),
			authSsoCookieDomain: ".example.edu",
			authSsoTgcToken: "SSO_TGC=seeded-token; Path=/; Domain=.example.edu",
		};
		writeStorageState(config, []);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const ssoCookie = input.storageState.cookies.find((cookie) => cookie.name === "SSO_TGC");
				calls.push(`request.newContext:${ssoCookie?.value ?? "missing"}`);
				expect(ssoCookie).toMatchObject({
					domain: ".example.edu",
					httpOnly: true,
					name: "SSO_TGC",
					path: "/",
					secure: true,
					value: "seeded-token",
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		expect(calls).toEqual(["request.newContext:seeded-token"]);
		expect(fileMode(config.authStorageStatePath)).toBe(0o600);

		await apiContext.dispose();
	});

	it("seeds stored auth from explicit portal cookies before creating API context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-explicit-cookies-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "seeded-session",
			authNginxCookie: "seeded-upstream",
			authSsoCookieDomain: ".example.edu",
			authSsoTgcToken: "seeded-ticket",
		};
		writeStorageState(config, []);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const cookiesByName = new Map(
					input.storageState.cookies.map((cookie) => [cookie.name, cookie]),
				);
				calls.push(`request.newContext:${cookiesByName.get("JSESSIONID")?.value ?? "missing"}`);
				expect(cookiesByName.get("JSESSIONID")).toMatchObject({
					domain: "portal.example.edu",
					httpOnly: true,
					name: "JSESSIONID",
					path: "/",
					secure: true,
					value: "seeded-session",
				});
				expect(cookiesByName.get("nginx")).toMatchObject({
					domain: "portal.example.edu",
					httpOnly: true,
					name: "nginx",
					path: "/",
					secure: true,
					value: "seeded-upstream",
				});
				expect(cookiesByName.get("SSO_TGC")).toMatchObject({
					domain: ".example.edu",
					httpOnly: true,
					name: "SSO_TGC",
					path: "/",
					secure: true,
					value: "seeded-ticket",
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		expect(calls).toEqual(["request.newContext:seeded-session"]);
		expect(fileMode(config.authStorageStatePath)).toBe(0o600);

		await apiContext.dispose();
	});

	it("overrides stale stored operator cookies with fresh explicit portal cookies", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-cookie-override-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "fresh-session",
			authNginxCookie: "fresh-upstream",
			authSsoCookieDomain: ".example.edu",
			authSsoTgcToken: "fresh-ticket",
		};
		writeStorageState(config, [
			{ name: "JSESSIONID", value: "stale-session" },
			{ httpOnly: false, name: "nginx", value: "stale-upstream" },
			{ domain: ".example.edu", name: "SSO_TGC", secure: true, value: "stale-ticket" },
		]);

		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const cookiesByName = new Map(
					input.storageState.cookies.map((cookie) => [cookie.name, cookie]),
				);
				calls.push(`request.newContext:${cookiesByName.get("JSESSIONID")?.value ?? "missing"}`);
				expect(cookiesByName.get("JSESSIONID")).toMatchObject({
					name: "JSESSIONID",
					value: "fresh-session",
				});
				expect(cookiesByName.get("nginx")).toMatchObject({
					name: "nginx",
					value: "fresh-upstream",
				});
				expect(cookiesByName.get("SSO_TGC")).toMatchObject({
					name: "SSO_TGC",
					value: "fresh-ticket",
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		expect(calls).toEqual(["request.newContext:fresh-session"]);

		await apiContext.dispose();
	});

	it("uses explicit operator cookies before partial stored auth cookies", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-cookie-merge-"));
		tempDirs.push(runtimeDir);

		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "seeded-session",
			authNginxCookie: "seeded-upstream",
			authSsoCookieDomain: ".example.edu",
			authSsoTgcToken: "seeded-ticket",
		};
		writeStorageState(config, [{ name: "JSESSIONID", value: "refreshed-session" }]);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const cookiesByName = new Map(
					input.storageState.cookies.map((cookie) => [cookie.name, cookie]),
				);
				expect(cookiesByName.get("JSESSIONID")).toMatchObject({
					name: "JSESSIONID",
					value: "seeded-session",
				});
				expect(cookiesByName.get("nginx")).toMatchObject({
					name: "nginx",
					value: "seeded-upstream",
				});
				expect(cookiesByName.get("SSO_TGC")).toMatchObject({
					name: "SSO_TGC",
					value: "seeded-ticket",
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		await apiContext.dispose();
	});

	it("passes the configured portal proxy to the API request context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-proxy-"));
		tempDirs.push(runtimeDir);

		const config = {
			...buildConfig(runtimeDir),
			authSsoCookieDomain: ".example.edu",
			authSsoTgcToken: "proxy-seeded-token",
			bypassProxyForPortal: false,
			portalProxyServer: "http://127.0.0.1:10808",
		};
		writeStorageState(config, []);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				expect(input.proxy).toEqual({ server: "http://127.0.0.1:10808" });
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		await apiContext.dispose();
	});

	it("rejects invalid SSO_TGC token material before creating a request context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-invalid-sso-"));
		tempDirs.push(runtimeDir);
		const config = buildConfig(runtimeDir);
		writeStorageState(config, []);

		await expect(
			createApiContextFromStorageState(
				{
					...config,
					authSsoCookieDomain: ".example.edu",
					authSsoTgcToken: "not a cookie token",
				},
				{
					createRequestContext: async () => {
						throw new Error("unexpected request context");
					},
				},
			),
		).rejects.toThrow("invalid INTERNAL_PORTAL_SSO_TGC");
	});

	it("uses the explicit SSO cookie domain for multi-label public suffixes", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-sso-domain-"));
		tempDirs.push(runtimeDir);

		const config = {
			...buildConfig(runtimeDir),
			authSsoCookieDomain: ".example.edu.cn",
			authSsoTgcToken: "seeded-ticket",
			portalBaseUrl: "https://portal.example.edu.cn",
			portalPageUrl: "https://portal.example.edu.cn/page/11#/",
			sourceHomeUrl: "https://portal.example.edu.cn",
		};
		writeStorageState(config, []);
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const ssoCookie = input.storageState.cookies.find((cookie) => cookie.name === "SSO_TGC");
				expect(ssoCookie).toMatchObject({
					domain: ".example.edu.cn",
					name: "SSO_TGC",
					value: "seeded-ticket",
				});
				return {
					dispose: async () => undefined,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				};
			},
		});

		await apiContext.dispose();
	});
});

function buildConfig(runtimeDir: string): InternalPortalConfig {
	return {
		authCheckNoticeType: "5",
		authCheckPageSize: 3,
		authJsessionId: null,
		authNginxCookie: null,
		authSsoCookieDomain: null,
		defaultInlineVisualCapture: true,
		authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
		authSsoTgcToken: null,
		bypassProxyForPortal: true,
		historicalBackfillMaxPagesPerType: null,
		noticeTypesPath: path.join(runtimeDir, "notice-types.json"),
		portalBaseUrl: "https://portal.example.edu",
		portalPageUrl: "https://portal.example.edu/page/11#/",
		portalProxyServer: null,
		requestMaxRetries: 3,
		runtimeDir,
		siteId: "portal_site",
		sourceHomeUrl: "https://portal.example.edu",
	};
}

function writeStorageState(
	config: InternalPortalConfig,
	cookies: Array<{
		domain?: string;
		httpOnly?: boolean;
		name: string;
		secure?: boolean;
		value: string;
	}>,
): void {
	fs.mkdirSync(path.dirname(config.authStorageStatePath), { recursive: true });
	fs.writeFileSync(
		config.authStorageStatePath,
		JSON.stringify({
			cookies: cookies.map((cookie) => ({
				domain: cookie.domain ?? "portal.example.edu",
				expires: -1,
				httpOnly: cookie.httpOnly ?? true,
				name: cookie.name,
				path: "/",
				sameSite: "Lax",
				secure: cookie.secure ?? false,
				value: cookie.value,
			})),
			origins: [],
		}),
		"utf-8",
	);
}

function fileMode(filePath: string): number {
	return fs.statSync(filePath).mode & 0o777;
}
