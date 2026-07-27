import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Headers, Response } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "../src/auth-errors.js";
import type { InternalPortalConfig } from "../src/config.js";
import {
	checkPortalAuthentication,
	createPortalApiContext,
	type PortalFetch,
} from "../src/portal.js";

describe("internal portal HTTP session", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs.splice(0)) {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});

	it("establishes an in-memory cookie session through guarded manual redirects", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch();
		const apiContext = await createPortalApiContext(config, {
			fetch: harness.fetch,
		});

		const response = await apiContext.post("/notice", { form: { page: "1" } });
		expect(await response.text()).toBe(JSON.stringify({ state: true }));
		expect(harness.bootstrapCount()).toBe(1);
		expect(harness.calls.every((call) => call.redirect === "manual")).toBe(true);
		expect(harness.calls.find((call) => call.url.hostname === "sso.example.edu")?.cookie).toContain(
			"SSO_TGC=current-ticket",
		);
		expect(harness.calls.find((call) => call.url.pathname === "/notice")?.cookie).toContain(
			"JSESSIONID=session-1",
		);

		await apiContext.dispose();
	});

	it("creates an independent cookie jar for every API context", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch();

		const first = await createPortalApiContext(config, { fetch: harness.fetch });
		await first.dispose();
		const second = await createPortalApiContext(config, { fetch: harness.fetch });
		await second.dispose();

		expect(harness.bootstrapCount()).toBe(2);
	});

	it("rejects redirect hosts outside the configured SSO parent domain before fetching them", async () => {
		const config = createConfig();
		const calls: URL[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			calls.push(url);
			return responseAt(url, null, {
				headers: { location: "https://login.attacker.example/cas" },
				status: 302,
			});
		};

		await expect(createPortalApiContext(config, { fetch })).rejects.toThrow(
			"portal SSO redirected outside the configured authentication boundary",
		);
		expect(calls.map(String)).toEqual([config.portalBaseUrl]);
	});

	it("rejects a redirect downgrade before issuing the HTTP request", async () => {
		const config = createConfig();
		const calls: URL[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			calls.push(url);
			return responseAt(url, null, {
				headers: { location: "http://sso.example.edu/cas" },
				status: 302,
			});
		};

		await expect(createPortalApiContext(config, { fetch })).rejects.toThrow(
			"internal portal SSO redirect requires a credential-free HTTPS URL",
		);
		expect(calls).toHaveLength(1);
	});

	it("requires an observed ST return to the exact portal host", async () => {
		const config = createConfig();
		const fetch: PortalFetch = async (request) =>
			responseAt(requestUrl(request), "portal home", { status: 200 });

		await expect(createPortalApiContext(config, { fetch })).rejects.toBeInstanceOf(
			PortalCredentialExpiredError,
		);
		await expect(createPortalApiContext(config, { fetch })).rejects.toThrow(
			"portal SSO did not issue a service ticket",
		);
	});

	it("reports bootstrap 5xx responses as session establishment failures", async () => {
		const config = createConfig();
		const bootstrapFetch: PortalFetch = async (request) =>
			responseAt(requestUrl(request), "unavailable", {
				status: 503,
				statusText: "Service Unavailable",
			});
		await expect(createPortalApiContext(config, { fetch: bootstrapFetch })).rejects.toThrow(
			"portal SSO navigation failed: 503 Service Unavailable",
		);
	});

	it("normalizes a same-host HTTP port 80 service-ticket return to HTTPS", async () => {
		const config = createConfig();
		const calls: URL[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			calls.push(url);
			return url.pathname === "/start"
				? responseAt(url, null, {
						headers: {
							location: "http://portal.example.edu:80/callback?ticket=ST-1",
						},
						status: 302,
					})
				: textResponse(url, "portal home");
		};

		const apiContext = await createPortalApiContext(config, { fetch });

		expect(calls.map(String)).toEqual([
			config.portalBaseUrl,
			"https://portal.example.edu/callback?ticket=ST-1",
		]);
		await apiContext.dispose();
	});

	it("bounds the manually followed SSO redirect chain", async () => {
		const config = createConfig();
		let requestCount = 0;
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			requestCount += 1;
			const hop = Number(url.searchParams.get("hop") ?? "0") + 1;
			return responseAt(url, null, {
				headers: { location: `${config.portalBaseUrl}?hop=${hop}` },
				status: 302,
			});
		};

		await expect(createPortalApiContext(config, { fetch })).rejects.toThrow(
			"Reached maximum redirect of 10",
		);
		expect(requestCount).toBe(11);
	});

	it("releases every response body while following the SSO redirect chain", async () => {
		const config = createConfig();
		const responses: Response[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			let response: Response;
			if (url.pathname === "/start") {
				response = responseAt(url, "portal redirect", {
					headers: { location: "https://sso.example.edu/login" },
					status: 302,
				});
			} else if (url.hostname === "sso.example.edu") {
				response = responseAt(url, "SSO redirect", {
					headers: { location: "https://portal.example.edu/callback?ticket=ST-1" },
					status: 302,
				});
			} else if (url.pathname === "/callback") {
				response = responseAt(url, "service-ticket redirect", {
					headers: {
						location: "https://portal.example.edu/home",
						"set-cookie": "JSESSIONID=session-1; Path=/; Secure; HttpOnly",
					},
					status: 302,
				});
			} else if (url.pathname === "/home") {
				response = textResponse(url, "portal home");
			} else {
				response = jsonResponse(url);
			}
			responses.push(response);
			return response;
		};

		const apiContext = await createPortalApiContext(config, { fetch });

		expect(responses).toHaveLength(4);
		expect(responses.every((response) => response.bodyUsed)).toBe(true);
		await apiContext.dispose();
	});

	it("returns a session-invalid payload without rebuilding the session", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch({
			apiResponse: ({ url }) =>
				url.pathname === "/notice"
					? textResponse(url, "error_comsys_session_invalid")
					: jsonResponse(url),
		});
		const apiContext = await createPortalApiContext(config, { fetch: harness.fetch });

		const response = await apiContext.post("/notice", { form: {} });
		expect(await response.text()).toBe("error_comsys_session_invalid");
		expect(harness.bootstrapCount()).toBe(1);

		await apiContext.dispose();
	});

	it("fails on 401 without rebuilding the session", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch({
			apiResponse: ({ url }) =>
				url.pathname === "/notice" ? textResponse(url, "unauthorized", 401) : jsonResponse(url),
		});
		const apiContext = await createPortalApiContext(config, { fetch: harness.fetch });

		await expect(apiContext.post("/notice", { form: {} })).rejects.toBeInstanceOf(
			PortalSessionExpiredError,
		);
		expect(harness.bootstrapCount()).toBe(1);

		await apiContext.dispose();
	});

	it("fails on a portal API redirect to SSO without rebuilding the session", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch({
			apiResponse: ({ url }) =>
				url.pathname === "/notice"
					? responseAt(url, null, {
							headers: { location: "https://sso.example.edu/login" },
							status: 302,
						})
					: jsonResponse(url),
		});
		const apiContext = await createPortalApiContext(config, { fetch: harness.fetch });

		await expect(apiContext.post("/notice", { form: {} })).rejects.toBeInstanceOf(
			PortalCredentialExpiredError,
		);
		expect(harness.bootstrapCount()).toBe(1);

		await apiContext.dispose();
	});

	it("aborts in-flight HTTP work when the API context is disposed", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch({
			apiResponse: ({ init, url }) => {
				if (url.pathname !== "/slow") {
					return jsonResponse(url);
				}
				return new Promise<Response>((_resolve, reject) => {
					const signal = init.signal;
					if (!signal) {
						reject(new Error("test request did not receive an AbortSignal"));
						return;
					}
					if (signal.aborted) {
						reject(signal.reason);
						return;
					}
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		});
		const apiContext = await createPortalApiContext(config, { fetch: harness.fetch });
		const pending = apiContext.get("/slow");
		await Promise.resolve();

		await apiContext.dispose();
		await expect(pending).rejects.toThrow("internal portal HTTP session disposed");
	});

	it("forwards an upstream AbortSignal into SSO bootstrap", async () => {
		const config = createConfig();
		const abortController = new AbortController();
		const fetch: PortalFetch = async (_request, init = {}) =>
			await new Promise<Response>((_resolve, reject) => {
				const signal = init.signal;
				if (!signal) {
					reject(new Error("test bootstrap did not receive an AbortSignal"));
					return;
				}
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		const pending = createPortalApiContext(config, {
			abortSignal: abortController.signal,
			fetch,
		});
		abortController.abort(new Error("activity cancelled"));

		await expect(pending).rejects.toThrow("activity cancelled");
	});

	it("checks authentication entirely in memory", async () => {
		const config = createConfig();
		const harness = createAuthenticatedFetch();

		const result = await checkPortalAuthentication(config, { fetch: harness.fetch });

		expect(result).toBeUndefined();
		expect(harness.bootstrapCount()).toBe(1);
	});

	it("fails closed when the credential file or cookie domain is unavailable", async () => {
		const missingConfig = createConfig({ writeCredential: false });
		await expect(createPortalApiContext(missingConfig)).rejects.toBeInstanceOf(
			PortalCredentialUnavailableError,
		);

		const malformedConfig = createConfig({ credential: "SSO_TGC=value; Path=/" });
		await expect(createPortalApiContext(malformedConfig)).rejects.toBeInstanceOf(
			PortalCredentialUnavailableError,
		);

		const missingDomain = createConfig();
		missingDomain.authSsoCookieDomain = null;
		await expect(createPortalApiContext(missingDomain)).rejects.toBeInstanceOf(
			PortalCredentialUnavailableError,
		);
	});

	function createConfig(
		options: { credential?: string; writeCredential?: boolean } = {},
	): InternalPortalConfig {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-session-"));
		tempDirs.push(tempDir);
		const config: InternalPortalConfig = {
			authSsoCookieDomain: ".example.edu",
			authSsoTgc: null,
			authSsoTgcFile: path.join(tempDir, "credential", "sso_tgc"),
			portalBaseUrl: "https://portal.example.edu/start",
			portalPageUrl: "https://portal.example.edu/page/11#/",
			portalProxyServer: null,
			siteId: "portal_site",
			sourceHomeUrl: "https://portal.example.edu",
		};
		if (options.writeCredential !== false) {
			const credentialFile = config.authSsoTgcFile;
			if (!credentialFile) {
				throw new Error("test credential path is missing");
			}
			fs.mkdirSync(path.dirname(credentialFile), { recursive: true });
			fs.writeFileSync(credentialFile, options.credential ?? "current-ticket", "utf-8");
		}
		return config;
	}
});

interface RecordedCall {
	cookie: string;
	redirect: string | undefined;
	url: URL;
}

function createAuthenticatedFetch(
	input: {
		apiResponse?: (input: {
			bootstrapCount: number;
			init: NonNullable<Parameters<PortalFetch>[1]>;
			url: URL;
		}) => Response | Promise<Response>;
	} = {},
) {
	let bootstrapCount = 0;
	const calls: RecordedCall[] = [];
	const fetch: PortalFetch = async (request, init = {}) => {
		const url = requestUrl(request);
		const headers = new Headers(init.headers);
		calls.push({
			cookie: headers.get("cookie") ?? "",
			redirect: init.redirect,
			url,
		});
		if (url.hostname === "portal.example.edu" && url.pathname === "/start") {
			bootstrapCount += 1;
			return responseAt(url, null, {
				headers: { location: `https://sso.example.edu/login?round=${bootstrapCount}` },
				status: 302,
			});
		}
		if (url.hostname === "sso.example.edu" && url.pathname === "/login") {
			return responseAt(url, null, {
				headers: {
					location: `https://portal.example.edu/callback?ticket=ST-${bootstrapCount}`,
				},
				status: 302,
			});
		}
		if (url.hostname === "portal.example.edu" && url.pathname === "/callback") {
			return responseAt(url, null, {
				headers: {
					location: "https://portal.example.edu/home",
					"set-cookie": `JSESSIONID=session-${bootstrapCount}; Path=/; Secure; HttpOnly`,
				},
				status: 302,
			});
		}
		if (url.hostname === "portal.example.edu" && url.pathname === "/home") {
			return textResponse(url, "portal home");
		}
		return await (input.apiResponse?.({ bootstrapCount, init, url }) ?? jsonResponse(url));
	};
	return {
		bootstrapCount: () => bootstrapCount,
		calls,
		fetch,
	};
}

function requestUrl(input: Parameters<PortalFetch>[0]): URL {
	if (typeof input === "string") {
		return new URL(input);
	}
	return "url" in input ? new URL(input.url) : new URL(String(input));
}

function jsonResponse(url: URL, payload: object = { state: true }): Response {
	return textResponse(url, JSON.stringify(payload));
}

function textResponse(url: URL, payload: string, status = 200): Response {
	return responseAt(url, payload, {
		headers: { "content-type": "application/json" },
		status,
		statusText: status === 401 ? "Unauthorized" : "OK",
	});
}

function responseAt(
	url: URL,
	body: string | null,
	init: ConstructorParameters<typeof Response>[1],
): Response {
	const response = new Response(body, init);
	Object.defineProperty(response, "url", { configurable: true, value: url.toString() });
	return response;
}
