import { Agent, Headers, Response } from "undici";
import { describe, expect, it } from "vitest";
import {
	checkPortalAuthentication,
	createPortalApiContext,
	type InternalPortalClientConfig,
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	type PortalFetch,
	PortalSessionExpiredError,
	validateSsoTgc,
} from "../src/index.ts";
import { PORTAL_REQUEST_TIMEOUTS } from "../src/portal.ts";

describe("internal portal HTTP session", () => {
	it("establishes an isolated cookie session and exposes a CAS-refreshed TGC", async () => {
		const harness = createAuthenticatedFetch({ refreshedTgc: "rotated-ticket" });
		const context = await createPortalApiContext(TEST_CONFIG, { fetch: harness.fetch });

		const response = await context.post("/notice", { form: { page: "1" } });
		expect(await response.text()).toBe(JSON.stringify({ state: true }));
		expect(context.getSsoTgc()).toBe("rotated-ticket");
		expect(harness.bootstrapCount()).toBe(1);
		expect(harness.calls.every((call) => call.redirect === "manual")).toBe(true);
		expect(harness.calls.find((call) => call.url.hostname === "sso.example.edu")?.cookie).toContain(
			"SSO_TGC=current-ticket",
		);
		expect(harness.calls.find((call) => call.url.pathname === "/notice")?.cookie).toContain(
			"JSESSIONID=session-1",
		);

		await context.dispose();
	});

	it("returns the effective TGC from one-shot authentication", async () => {
		const harness = createAuthenticatedFetch({ refreshedTgc: "next-ticket" });

		await expect(checkPortalAuthentication(TEST_CONFIG, { fetch: harness.fetch })).resolves.toEqual(
			{
				ssoTgc: "next-ticket",
			},
		);
	});

	it("rejects redirect hosts outside the configured authentication boundary", async () => {
		const calls: URL[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			calls.push(url);
			return responseAt(url, null, {
				headers: { location: "https://login.attacker.example/cas" },
				status: 302,
			});
		};

		await expect(createPortalApiContext(TEST_CONFIG, { fetch })).rejects.toThrow(
			"portal SSO redirected outside the configured authentication boundary",
		);
		expect(calls.map(String)).toEqual([TEST_CONFIG.portalBaseUrl]);
	});

	it("requires an observed service-ticket return to the exact portal host", async () => {
		const fetch: PortalFetch = async (request) =>
			responseAt(requestUrl(request), "portal home", { status: 200 });

		await expect(createPortalApiContext(TEST_CONFIG, { fetch })).rejects.toBeInstanceOf(
			PortalCredentialExpiredError,
		);
		await expect(createPortalApiContext(TEST_CONFIG, { fetch })).rejects.toThrow(
			"portal SSO did not issue a service ticket",
		);
	});

	it("normalizes a same-host HTTP service-ticket return to HTTPS", async () => {
		const calls: URL[] = [];
		const fetch: PortalFetch = async (request) => {
			const url = requestUrl(request);
			calls.push(url);
			return url.pathname === "/start"
				? responseAt(url, null, {
						headers: { location: "http://portal.example.edu:80/callback?ticket=ST-1" },
						status: 302,
					})
				: textResponse(url, "portal home");
		};

		const context = await createPortalApiContext(TEST_CONFIG, { fetch });
		expect(calls.map(String)).toEqual([
			TEST_CONFIG.portalBaseUrl,
			"https://portal.example.edu/callback?ticket=ST-1",
		]);
		await context.dispose();
	});

	it("rejects authenticated API responses after session expiry", async () => {
		const harness = createAuthenticatedFetch({
			apiResponse: ({ url }) =>
				url.pathname === "/notice" ? textResponse(url, "unauthorized", 401) : jsonResponse(url),
		});
		const context = await createPortalApiContext(TEST_CONFIG, { fetch: harness.fetch });

		await expect(context.post("/notice", { form: {} })).rejects.toBeInstanceOf(
			PortalSessionExpiredError,
		);
		await context.dispose();
	});

	it("forwards an upstream AbortSignal into bootstrap", async () => {
		const controller = new AbortController();
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
		const pending = createPortalApiContext(TEST_CONFIG, {
			abortSignal: controller.signal,
			fetch,
		});
		controller.abort(new Error("check cancelled"));

		await expect(pending).rejects.toThrow("check cancelled");
	});

	it("routes every portal request through a dispatcher with stall timeouts", async () => {
		const harness = createAuthenticatedFetch();
		const dispatcher = new Agent();
		const created: { proxyServer: string | null; timeouts: object }[] = [];
		const dispatchers = new Set<unknown>();
		const fetch: PortalFetch = async (request, init) => {
			dispatchers.add(init?.dispatcher);
			return await harness.fetch(request, init);
		};
		const context = await createPortalApiContext(
			{ ...TEST_CONFIG, proxyServer: "http://proxy.example.edu:3128" },
			{
				createDispatcher: (proxyServer, timeouts) => {
					created.push({ proxyServer, timeouts });
					return dispatcher;
				},
				fetch,
			},
		);
		await context.post("/notice", { form: {} });
		await context.dispose();

		expect(created).toEqual([
			{ proxyServer: "http://proxy.example.edu:3128", timeouts: PORTAL_REQUEST_TIMEOUTS },
		]);
		expect([...dispatchers]).toEqual([dispatcher]);
		expect(dispatcher.closed).toBe(true);
	});

	it("accepts only the raw, printable TGC value", () => {
		expect(validateSsoTgc("TGT-current")).toBe("TGT-current");
		expect(() => validateSsoTgc(" TGT-current")).toThrow(PortalCredentialUnavailableError);
		expect(() => validateSsoTgc("SSO_TGC=TGT-current")).toThrow(PortalCredentialUnavailableError);
		expect(() => validateSsoTgc("TGT-current; Path=/")).toThrow(PortalCredentialUnavailableError);
	});
});

const TEST_CONFIG: InternalPortalClientConfig = {
	portalBaseUrl: "https://portal.example.edu/start",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	proxyServer: null,
	ssoCookieDomain: ".example.edu",
	ssoTgc: "current-ticket",
};

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
		refreshedTgc?: string;
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
					...(input.refreshedTgc
						? {
								"set-cookie": `SSO_TGC=${input.refreshedTgc}; Domain=.example.edu; Path=/; Secure; HttpOnly`,
							}
						: {}),
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
