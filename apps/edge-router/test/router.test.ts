import { describe, expect, it, vi } from "vitest";

import router, { type Env, type LaneFetcher } from "../src/index";

const ORIGIN = "https://chat.muc.wiki";

function recordingFetcher(label: string) {
	const requests: Request[] = [];
	const fetcher: LaneFetcher = {
		fetch: vi.fn(async (request: Request) => {
			requests.push(request);
			return new Response(label);
		}),
	};
	return { fetcher, requests };
}

function createEnv(options: { production?: boolean; defaultLane?: string } = {}) {
	const staging = recordingFetcher("staging");
	const production = recordingFetcher("production");
	const env: Env = {
		CAMPUS_WEB_STAGING: staging.fetcher,
		DEFAULT_LANE: options.defaultLane ?? "staging",
		...(options.production ? { CAMPUS_WEB_PRODUCTION: production.fetcher } : {}),
	};
	return { env, production, staging };
}

function navigate(path: string, headers: Record<string, string> = {}): Request {
	return new Request(`${ORIGIN}${path}`, {
		headers: { "sec-fetch-mode": "navigate", ...headers },
	});
}

describe("edge router lane selection", () => {
	it("serves the default lane when no lane is selected", async () => {
		const { env, staging } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(new Request(`${ORIGIN}/`), env);

		await expect(response.text()).resolves.toBe("production");
		expect(staging.requests).toHaveLength(0);
	});

	it("routes requests with the staging lane cookie to staging", async () => {
		const { env, staging } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(
			new Request(`${ORIGIN}/chat`, { headers: { cookie: "__Host-campus_lane=staging" } }),
			env,
		);

		await expect(response.text()).resolves.toBe("staging");
		expect(staging.requests).toHaveLength(1);
	});

	it("falls back to the default lane when the selected lane has no binding", async () => {
		const { env } = createEnv({ defaultLane: "staging" });
		const response = await router.fetch(
			new Request(`${ORIGIN}/`, { headers: { cookie: "__Host-campus_lane=production" } }),
			env,
		);

		await expect(response.text()).resolves.toBe("staging");
	});

	it("ignores lane cookies outside the allowlist", async () => {
		const { env } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(
			new Request(`${ORIGIN}/`, { headers: { cookie: "__Host-campus_lane=development" } }),
			env,
		);

		await expect(response.text()).resolves.toBe("production");
	});

	it("moves cookie-less users when the default lane changes", async () => {
		const { env } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(navigate("/"), env);

		await expect(response.text()).resolves.toBe("production");
	});

	it("reports dependency_not_ready when the default lane has no binding", async () => {
		const { env } = createEnv({ defaultLane: "production" });
		const response = await router.fetch(new Request(`${ORIGIN}/`), env);

		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "dependency_not_ready" },
		});
	});
});

describe("edge router lane switching", () => {
	it("sets a non-default lane on navigation and strips the query parameter", async () => {
		const { env, staging } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(navigate("/dining?lane=staging&tab=menu"), env);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/dining?tab=menu");
		expect(response.headers.get("set-cookie")).toBe(
			"__Host-campus_lane=staging; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
		);
		expect(response.headers.get("clear-site-data")).toBe('"cache"');
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(staging.requests).toHaveLength(0);
	});

	it("clears the preference when the default lane is chosen", async () => {
		const { env } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(
			navigate("/?lane=prod", { cookie: "__Host-campus_lane=staging" }),
			env,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/");
		expect(response.headers.get("set-cookie")).toBe(
			"__Host-campus_lane=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
		);
	});

	it("lets production be chosen explicitly while staging is the default", async () => {
		const { env } = createEnv({ production: true, defaultLane: "staging" });
		const response = await router.fetch(navigate("/?lane=prod"), env);

		expect(response.headers.get("set-cookie")).toBe(
			"__Host-campus_lane=production; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
		);
	});

	it("forwards without a redirect when the lane is already selected", async () => {
		const { env, staging } = createEnv({ defaultLane: "staging" });
		const response = await router.fetch(navigate("/dining?lane=staging&tab=menu"), env);

		await expect(response.text()).resolves.toBe("staging");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(staging.requests[0]?.url).toBe(`${ORIGIN}/dining?tab=menu`);
	});

	it("does not switch lanes from embedded or scripted requests", async () => {
		const { env, production, staging } = createEnv({
			production: true,
			defaultLane: "production",
		});
		for (const mode of ["no-cors", "cors", "same-origin"]) {
			const response = await router.fetch(
				new Request(`${ORIGIN}/?lane=staging`, { headers: { "sec-fetch-mode": mode } }),
				env,
			);
			expect(response.headers.get("set-cookie")).toBeNull();
		}
		const post = await router.fetch(
			new Request(`${ORIGIN}/?lane=staging`, {
				headers: { "sec-fetch-mode": "navigate" },
				method: "POST",
			}),
			env,
		);

		expect(post.headers.get("set-cookie")).toBeNull();
		expect(staging.requests).toHaveLength(0);
		expect(production.requests).toHaveLength(4);
	});

	it("forwards navigations with an unknown lane value unchanged", async () => {
		const { env, staging } = createEnv();
		const response = await router.fetch(navigate("/?lane=preview"), env);

		await expect(response.text()).resolves.toBe("staging");
		expect(staging.requests[0]?.url).toBe(`${ORIGIN}/?lane=preview`);
	});
});

describe("edge router federation", () => {
	const stagingCookies = "__Host-campus_lane=staging; __Secure-campus-staging.session_token=s";

	it("routes the staging issuer's discovery documents to staging", async () => {
		const { env, production, staging } = createEnv({
			production: true,
			defaultLane: "production",
		});
		for (const path of [
			"/lanes/staging/.well-known/openid-configuration",
			"/lanes/staging/.well-known/oauth-authorization-server",
			"/.well-known/oauth-authorization-server/lanes/staging",
		]) {
			await router.fetch(new Request(`${ORIGIN}${path}`), env);
		}

		expect(production.requests).toHaveLength(0);
		expect(staging.requests.map((request) => request.url)).toEqual([
			`${ORIGIN}/.well-known/openid-configuration`,
			`${ORIGIN}/.well-known/oauth-authorization-server`,
			`${ORIGIN}/.well-known/oauth-authorization-server`,
		]);
	});

	it("routes staging back-channel calls by issuer path without a lane cookie", async () => {
		const { env, staging } = createEnv({ production: true, defaultLane: "production" });
		await router.fetch(
			new Request(`${ORIGIN}/lanes/staging/api/federation/token`, {
				body: "grant_type=authorization_code&code=abc",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					cookie: "__Secure-campus-production.session_token=p; theme=dark",
				},
				method: "POST",
			}),
			env,
		);
		const forwarded = staging.requests[0];

		expect(forwarded?.url).toBe(`${ORIGIN}/api/federation/token`);
		expect(forwarded?.method).toBe("POST");
		expect(forwarded?.headers.get("cookie")).toBe("theme=dark");
		await expect(forwarded?.text()).resolves.toBe("grant_type=authorization_code&code=abc");
	});

	it("keeps unprefixed issuer paths on production regardless of the lane cookie", async () => {
		const { env, production, staging } = createEnv({
			production: true,
			defaultLane: "staging",
		});
		for (const path of [
			"/.well-known/openid-configuration",
			"/api/federation/jwks",
			"/api/federation/userinfo",
		]) {
			await router.fetch(
				new Request(`${ORIGIN}${path}`, { headers: { cookie: stagingCookies } }),
				env,
			);
		}

		expect(staging.requests).toHaveLength(0);
		expect(production.requests).toHaveLength(3);
	});

	it("reports dependency_not_ready for the production issuer before production exists", async () => {
		const { env, staging } = createEnv({ defaultLane: "staging" });
		const response = await router.fetch(
			new Request(`${ORIGIN}/.well-known/openid-configuration`),
			env,
		);

		expect(response.status).toBe(503);
		expect(staging.requests).toHaveLength(0);
	});

	it("sends browser federation endpoints to the cookie lane", async () => {
		const { env, production, staging } = createEnv({
			production: true,
			defaultLane: "production",
		});
		await router.fetch(
			new Request(`${ORIGIN}/api/federation/authorize?client_id=c`, {
				headers: { cookie: stagingCookies },
			}),
			env,
		);
		await router.fetch(
			new Request(`${ORIGIN}/api/federation/consent`, {
				body: "{}",
				headers: { cookie: stagingCookies },
				method: "POST",
			}),
			env,
		);

		expect(production.requests).toHaveLength(0);
		expect(staging.requests).toHaveLength(2);
	});

	it("switches to the issuing lane before authorization and keeps the OAuth parameters", async () => {
		const { env } = createEnv({ production: true, defaultLane: "production" });
		const response = await router.fetch(
			navigate(
				"/api/federation/authorize?client_id=c&redirect_uri=https%3A%2F%2Frp.example%2Fcb&state=s&lane=staging",
			),
			env,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"/api/federation/authorize?client_id=c&redirect_uri=https%3A%2F%2Frp.example%2Fcb&state=s",
		);
		expect(response.headers.get("set-cookie")).toContain("__Host-campus_lane=staging;");
	});

	it("leaves other lane-prefixed paths to the cookie lane unchanged", async () => {
		const { env, staging } = createEnv();
		await router.fetch(new Request(`${ORIGIN}/lanes/staging/api/federation/authorize`), env);

		expect(staging.requests[0]?.url).toBe(`${ORIGIN}/lanes/staging/api/federation/authorize`);
	});
});

describe("edge router cookie isolation", () => {
	const browserCookies = [
		"__Host-campus_lane=staging",
		"__Secure-campus-staging.session_token=staging-session",
		"__Secure-campus-production.session_token=production-session",
		"campus-production.session_data=production-data",
		"__Secure-better-auth.session_token=legacy-session",
		"theme=dark",
	].join("; ");

	it("forwards only the target lane's auth cookies", async () => {
		const { env, staging } = createEnv({ production: true, defaultLane: "production" });
		await router.fetch(
			new Request(`${ORIGIN}/api/me`, { headers: { cookie: browserCookies } }),
			env,
		);

		expect(staging.requests[0]?.headers.get("cookie")).toBe(
			"__Secure-campus-staging.session_token=staging-session; theme=dark",
		);
	});

	it("never forwards staging sessions to production", async () => {
		const { env, production } = createEnv({ production: true, defaultLane: "production" });
		await router.fetch(
			new Request(`${ORIGIN}/api/federation/token`, { headers: { cookie: browserCookies } }),
			env,
		);

		expect(production.requests[0]?.headers.get("cookie")).toBe(
			"__Secure-campus-production.session_token=production-session; campus-production.session_data=production-data; theme=dark",
		);
	});

	it("drops the cookie header when nothing remains", async () => {
		const { env, staging } = createEnv();
		await router.fetch(
			new Request(`${ORIGIN}/`, { headers: { cookie: "__Host-campus_lane=staging" } }),
			env,
		);

		expect(staging.requests[0]?.headers.has("cookie")).toBe(false);
	});

	it("preserves method, body and version override headers", async () => {
		const { env, staging } = createEnv();
		await router.fetch(
			new Request(`${ORIGIN}/api/chat/requests`, {
				body: JSON.stringify({ message: "hi" }),
				headers: {
					"cloudflare-workers-version-overrides": 'campus-web-staging="version"',
					"content-type": "application/json",
				},
				method: "POST",
			}),
			env,
		);
		const forwarded = staging.requests[0];

		expect(forwarded?.method).toBe("POST");
		expect(forwarded?.headers.get("cloudflare-workers-version-overrides")).toBe(
			'campus-web-staging="version"',
		);
		await expect(forwarded?.json()).resolves.toEqual({ message: "hi" });
	});
});
