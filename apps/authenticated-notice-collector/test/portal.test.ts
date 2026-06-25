import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { CollectorConfig } from "../src/config.js";
import { createApiContextFromStorageState } from "../src/portal.js";

describe("authenticated notice collector portal bootstrap", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it("bootstraps the portal page before creating an API request context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-bootstrap-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];
		let disposed = false;

		const config = buildConfig(runtimeDir);
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
			launchBrowser: async () => ({
				close: async () => {
					calls.push("browser.close");
				},
				newContext: async (input) => {
					calls.push(`browser.newContext:${String(input.storageState)}`);
					return {
						newPage: async () => ({
							close: async () => {
								calls.push("page.close");
							},
							goto: async (url: string) => {
								calls.push(`page.goto:${url}`);
							},
						}),
						storageState: async (input) => {
							calls.push(`storageState:${input?.path ?? "none"}`);
							return {
								cookies: [
									{
										domain: "portal.example.edu",
										expires: -1,
										httpOnly: true,
										name: "JSESSIONID",
										path: "/",
										sameSite: "Lax",
										secure: false,
										value: "bootstrapped-session",
									},
								],
								origins: [],
							};
						},
					};
				},
			}),
		});

		expect(calls).toEqual([
			`browser.newContext:${config.authStorageStatePath}`,
			"page.goto:https://portal.example.edu/page/11#/",
			`storageState:${config.authStorageStatePath}`,
			"request.newContext:bootstrapped-session",
			"page.close",
			"browser.close",
		]);

		await apiContext.dispose();
		expect(disposed).toBe(true);
	});

	it("still closes the browser when portal bootstrap fails", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-bootstrap-fail-"));
		tempDirs.push(runtimeDir);
		let closed = false;

		await expect(
			createApiContextFromStorageState(buildConfig(runtimeDir), {
				launchBrowser: async () => ({
					close: async () => {
						closed = true;
					},
					newContext: async () => ({
						newPage: async () => ({
							goto: async () => {
								throw new Error("bootstrap failed");
							},
						}),
						storageState: async () => ({
							cookies: [],
							origins: [],
						}),
					}),
				}),
			}),
		).rejects.toThrow("bootstrap failed");

		expect(closed).toBe(true);
	});

	it("fails closed when the portal route times out before bootstrap completes", async () => {
		const runtimeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "collector-portal-bootstrap-timeout-"),
		);
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = buildConfig(runtimeDir);
		await expect(
			createApiContextFromStorageState(config, {
				createRequestContext: async () => {
					throw new Error("unexpected request context");
				},
				launchBrowser: async () => ({
					close: async () => {
						calls.push("browser.close");
					},
					newContext: async () => ({
						newPage: async () => ({
							close: async () => {
								calls.push("page.close");
							},
							goto: async () => {
								throw new Error(
									"page.goto: net::ERR_TIMED_OUT at https://portal.example.edu/page/11#/",
								);
							},
						}),
						storageState: async () => {
							throw new Error("unexpected storage state read");
						},
					}),
				}),
			}),
		).rejects.toThrow("net::ERR_TIMED_OUT");

		expect(calls).toEqual(["page.close", "browser.close"]);
	});

	it("fails closed when browser launch times out before bootstrap", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-launch-timeout-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = buildConfig(runtimeDir);
		fs.mkdirSync(path.dirname(config.authStorageStatePath), { recursive: true });
		fs.writeFileSync(
			config.authStorageStatePath,
			JSON.stringify({
				cookies: [
					{
						domain: "portal.example.edu",
						expires: -1,
						httpOnly: true,
						name: "JSESSIONID",
						path: "/",
						sameSite: "Lax",
						secure: false,
						value: "stored-session",
					},
				],
				origins: [],
			}),
			"utf-8",
		);

		await expect(
			createApiContextFromStorageState(config, {
				createRequestContext: async () => {
					calls.push("request.newContext");
					throw new Error("unexpected request context");
				},
				launchBrowser: async () => {
					throw new Error("browserType.launch: Timeout 180000ms exceeded.");
				},
			}),
		).rejects.toThrow("Timeout 180000ms exceeded");

		expect(calls).toEqual([]);
	});

	it("seeds stored auth from an explicit SSO_TGC token before portal bootstrap", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-sso-token-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = {
			...buildConfig(runtimeDir),
			authSsoTgcToken: "SSO_TGC=seeded-token; Path=/; Domain=.muc.edu.cn",
		};
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const ssoCookie = input.storageState.cookies.find((cookie) => cookie.name === "SSO_TGC");
				calls.push(`request.newContext:${ssoCookie?.value ?? "missing"}`);
				expect(ssoCookie).toMatchObject({
					domain: ".muc.edu.cn",
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
			launchBrowser: async () => ({
				close: async () => undefined,
				newContext: async () => ({
					newPage: async () => ({
						close: async () => undefined,
						goto: async () => undefined,
					}),
					storageState: async () => ({ cookies: [], origins: [] }),
				}),
			}),
		});

		expect(calls).toEqual(["request.newContext:seeded-token"]);

		await apiContext.dispose();
	});

	it("seeds stored auth from explicit portal cookies before portal bootstrap", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-explicit-cookies-"));
		tempDirs.push(runtimeDir);
		const calls: string[] = [];

		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "seeded-session",
			authNginxCookie: "seeded-upstream",
			authSsoTgcToken: "seeded-ticket",
		};
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
					domain: ".muc.edu.cn",
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
			launchBrowser: async () => ({
				close: async () => undefined,
				newContext: async () => ({
					newPage: async () => ({
						close: async () => undefined,
						goto: async () => undefined,
					}),
					storageState: async () => ({ cookies: [], origins: [] }),
				}),
			}),
		});

		expect(calls).toEqual(["request.newContext:seeded-session"]);

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
			authSsoTgcToken: "fresh-ticket",
		};
		fs.mkdirSync(path.dirname(config.authStorageStatePath), { recursive: true });
		fs.writeFileSync(
			config.authStorageStatePath,
			JSON.stringify({
				cookies: [
					{
						domain: "portal.example.edu",
						expires: -1,
						httpOnly: true,
						name: "JSESSIONID",
						path: "/",
						sameSite: "Lax",
						secure: false,
						value: "stale-session",
					},
					{
						domain: "portal.example.edu",
						expires: -1,
						httpOnly: false,
						name: "nginx",
						path: "/",
						sameSite: "Lax",
						secure: false,
						value: "stale-upstream",
					},
					{
						domain: ".muc.edu.cn",
						expires: -1,
						httpOnly: true,
						name: "SSO_TGC",
						path: "/",
						sameSite: "Lax",
						secure: true,
						value: "stale-ticket",
					},
				],
				origins: [],
			}),
			"utf-8",
		);

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
			launchBrowser: async () => ({
				close: async () => undefined,
				newContext: async () => ({
					newPage: async () => ({
						close: async () => undefined,
						goto: async () => undefined,
					}),
					storageState: async () => ({ cookies: [], origins: [] }),
				}),
			}),
		});

		expect(calls).toEqual(["request.newContext:fresh-session"]);

		await apiContext.dispose();
	});

	it("preserves explicit operator cookies when bootstrap storage state drops them", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-cookie-merge-"));
		tempDirs.push(runtimeDir);

		const config = {
			...buildConfig(runtimeDir),
			authJsessionId: "seeded-session",
			authNginxCookie: "seeded-upstream",
			authSsoTgcToken: "seeded-ticket",
		};
		const apiContext = await createApiContextFromStorageState(config, {
			createRequestContext: async (input) => {
				const cookiesByName = new Map(
					input.storageState.cookies.map((cookie) => [cookie.name, cookie]),
				);
				expect(cookiesByName.get("JSESSIONID")).toMatchObject({
					name: "JSESSIONID",
					value: "refreshed-session",
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
			launchBrowser: async () => ({
				close: async () => undefined,
				newContext: async () => ({
					newPage: async () => ({
						close: async () => undefined,
						goto: async () => undefined,
					}),
					storageState: async () => ({
						cookies: [
							{
								domain: "portal.example.edu",
								expires: -1,
								httpOnly: true,
								name: "JSESSIONID",
								path: "/",
								sameSite: "Lax",
								secure: false,
								value: "refreshed-session",
							},
						],
						origins: [],
					}),
				}),
			}),
		});

		await apiContext.dispose();
	});

	it("passes the configured portal proxy to the API request context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-proxy-"));
		tempDirs.push(runtimeDir);

		const config = {
			...buildConfig(runtimeDir),
			authSsoTgcToken: "proxy-seeded-token",
			bypassProxyForPortal: false,
			portalProxyServer: "http://127.0.0.1:10808",
		};
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
			launchBrowser: async () => ({
				close: async () => undefined,
				newContext: async () => ({
					newPage: async () => ({
						close: async () => undefined,
						goto: async () => undefined,
					}),
					storageState: async () => ({ cookies: [], origins: [] }),
				}),
			}),
		});

		await apiContext.dispose();
	});

	it("rejects invalid SSO_TGC token material before creating a request context", async () => {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-portal-invalid-sso-"));
		tempDirs.push(runtimeDir);

		await expect(
			createApiContextFromStorageState(
				{
					...buildConfig(runtimeDir),
					authSsoTgcToken: "not a cookie token",
				},
				{
					createRequestContext: async () => {
						throw new Error("unexpected request context");
					},
					launchBrowser: async () => {
						throw new Error("unexpected browser launch");
					},
				},
			),
		).rejects.toThrow("invalid AUTHENTICATED_NOTICE_SSO_TGC");
	});
});

function buildConfig(runtimeDir: string): CollectorConfig {
	return {
		authCheckNoticeType: "5",
		authCheckPageSize: 3,
		authJsessionId: null,
		authNginxCookie: null,
		attachmentFetchRequestManifestPath: null,
		attachmentFetchStatusDatabaseUrl: null,
		attachmentFetchStatusDisabled: false,
		defaultInlineVisualCapture: true,
		authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
		authSsoTgcToken: null,
		bypassProxyForPortal: true,
		collectionMode: "incremental",
		collectorRunLedgerDatabaseUrl: null,
		collectorRunLedgerDisabled: false,
		collectorRunLeaseDatabaseUrl: null,
		collectorRunLeaseDisabled: false,
		collectorRunLeaseTtlSeconds: 3600,
		exportsDir: path.join(runtimeDir, "exports"),
		historicalBackfillMaxPagesPerType: null,
		noticeTypeAllowlist: null,
		noticeTypesPath: path.join(runtimeDir, "notice-types.json"),
		packageRoot: runtimeDir,
		repoRoot: runtimeDir,
		portalBaseUrl: "https://portal.example.edu",
		portalPageUrl: "https://portal.example.edu/page/11#/",
		portalProxyServer: null,
		requestBackoffBaseMs: 1,
		requestMaxRetries: 3,
		runtimeDir,
		siteId: "portal_site",
		sourceHomeUrl: "https://portal.example.edu",
		writeLocalExports: false,
	};
}
