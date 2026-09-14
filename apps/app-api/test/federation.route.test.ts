import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	RESEND_API_KEY: "resend_test_key",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("federation provider routes", () => {
	it.each(["/.well-known/openid-configuration", "/api/federation/userinfo"])(
		"reports dependency failure accurately for %s",
		async (path) => {
			const app = createApp(env, {
				authHandler: vi.fn().mockRejectedValue(new Error("unavailable")),
				getAppAuth: vi.fn().mockRejectedValue(new Error("unavailable")),
			});
			const response = await app.fetch(new Request(`https://campus.muc.wiki${path}`), env);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				error: {
					code: "dependency_not_ready",
					message: "Authentication service is temporarily unavailable.",
					retryable: true,
				},
			});
		},
	);
	it("maps legacy app auth routes to Better Auth root endpoints", async () => {
		const seen: string[] = [];
		const app = createApp(env, {
			authHandler: vi.fn((request: Request) => {
				seen.push(new URL(request.url).pathname);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			}),
		});

		const response = await app.fetch(
			new Request("https://campus.muc.wiki/api/auth/sign-in/email", {
				body: JSON.stringify({ email: "jane@example.edu", password: "StagingPass!2026" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		expect(seen).toEqual(["/sign-in/email"]);
	});

	it("maps canonical federation routes to Better Auth OAuth provider endpoints", async () => {
		const seen: Array<{ method: string; pathname: string }> = [];
		const app = createApp(env, {
			authHandler: vi.fn((request: Request) => {
				const url = new URL(request.url);
				seen.push({
					method: request.method,
					pathname: url.pathname,
				});
				return new Response(JSON.stringify({ ok: true, pathname: url.pathname }), {
					headers: { "content-type": "application/json" },
				});
			}),
		});

		const requests = [
			new Request("https://campus.muc.wiki/api/federation/client?client_id=test-oauth-client"),
			new Request("https://campus.muc.wiki/api/federation/authorize"),
			new Request("https://campus.muc.wiki/api/federation/consent", { method: "POST" }),
			new Request("https://campus.muc.wiki/api/federation/token", { method: "POST" }),
			new Request("https://campus.muc.wiki/api/federation/userinfo"),
			new Request("https://campus.muc.wiki/api/federation/jwks"),
			new Request("https://campus.muc.wiki/api/federation/logout"),
		];

		for (const request of requests) {
			const response = await app.fetch(request, env);
			expect(response.status).toBe(200);
		}

		expect(seen).toEqual([
			{ method: "GET", pathname: "/oauth2/public-client" },
			{ method: "GET", pathname: "/oauth2/authorize" },
			{ method: "POST", pathname: "/oauth2/consent" },
			{ method: "POST", pathname: "/oauth2/token" },
			{ method: "GET", pathname: "/oauth2/userinfo" },
			{ method: "GET", pathname: "/jwks" },
			{ method: "GET", pathname: "/oauth2/end-session" },
		]);
	});

	it("exposes only public OAuth client fields", async () => {
		const app = createApp(env, {
			authHandler: vi.fn(() =>
				Response.json({
					client_id: "test-oauth-client",
					client_name: "Test OAuth Client",
					client_uri: "https://oauth.example.test",
					client_secret: "must-not-leak",
					metadata: { owner: "private" },
					redirect_uris: ["https://oauth.example.test/callback"],
				}),
			),
		});

		const response = await app.fetch(
			new Request("https://campus.muc.wiki/api/federation/client?client_id=test-oauth-client"),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			client_id: "test-oauth-client",
			client_name: "Test OAuth Client",
			client_uri: "https://oauth.example.test",
		});
	});

	it("keeps consent redirect JSON for the browser to validate before navigation", async () => {
		const app = createApp(env, {
			authHandler: vi.fn(() =>
				Response.json({
					redirect: true,
					url: "https://oauth.example.test/callback?code=abc&state=xyz",
				}),
			),
		});

		const response = await app.fetch(
			new Request("https://campus.muc.wiki/api/federation/consent", {
				body: JSON.stringify({ accept: true, oauth_query: "signed-query" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			redirect: true,
			url: "https://oauth.example.test/callback?code=abc&state=xyz",
		});
	});

	it("normalizes provider JSON redirects to HTTP redirects on federation routes", async () => {
		const app = createApp(env, {
			authHandler: vi.fn(() =>
				Response.json({
					redirect: true,
					url: "https://wiki.mucwiki-edge.link/wiki/Special:PluggableAuthLogin?code=abc&state=xyz",
				}),
			),
		});

		const response = await app.fetch(
			new Request("https://campus.muc.wiki/api/federation/authorize"),
			env,
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://wiki.mucwiki-edge.link/wiki/Special:PluggableAuthLogin?code=abc&state=xyz",
		);
	});

	it("normalizes browser authorize errors to the campus federation error page", async () => {
		const app = createApp(env, {
			authHandler: vi.fn(() =>
				Response.json(
					{
						error: "invalid_redirect_uri",
						error_description: "redirect URI is not registered",
					},
					{ status: 400 },
				),
			),
		});

		const response = await app.fetch(
			new Request("https://campus-staging.mucwiki-edge.link/api/federation/authorize"),
			env,
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://campus-staging.mucwiki-edge.link/account/federation/error?error=invalid_redirect_uri&error_description=redirect+URI+is+not+registered",
		);
	});

	it("serves well-known metadata through the Better Auth provider metadata API", async () => {
		const getOpenIdConfig = vi.fn(async () => ({
			issuer: "https://campus-staging.mucwiki-edge.link",
			authorization_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/authorize",
			token_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/token",
			userinfo_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/userinfo",
			jwks_uri: "https://campus-staging.mucwiki-edge.link/jwks",
			end_session_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/end-session",
		}));
		const getOAuthServerConfig = vi.fn(async () => ({
			issuer: "https://campus-staging.mucwiki-edge.link",
			authorization_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/authorize",
			token_endpoint: "https://campus-staging.mucwiki-edge.link/oauth2/token",
			jwks_uri: "https://campus-staging.mucwiki-edge.link/jwks",
		}));
		const app = createApp(env, {
			authHandler: vi.fn(() => new Response(null, { status: 404 })),
			getAppAuth: vi.fn(async () => ({
				api: {
					getOAuthServerConfig,
					getOpenIdConfig,
				},
			})) as never,
		});

		const openIdResponse = await app.fetch(
			new Request("https://api-staging.mucwiki-edge.link/.well-known/openid-configuration"),
			env,
		);
		const oauthMetadataResponse = await app.fetch(
			new Request("https://api-staging.mucwiki-edge.link/.well-known/oauth-authorization-server"),
			env,
		);

		expect(openIdResponse.status).toBe(200);
		expect(oauthMetadataResponse.status).toBe(200);
		await expect(openIdResponse.json()).resolves.toMatchObject({
			issuer: "https://campus-staging.mucwiki-edge.link",
			authorization_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/authorize",
			token_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/token",
			userinfo_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/userinfo",
			jwks_uri: "https://campus-staging.mucwiki-edge.link/api/federation/jwks",
			end_session_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/logout",
		});
		await expect(oauthMetadataResponse.json()).resolves.toMatchObject({
			issuer: "https://campus-staging.mucwiki-edge.link",
			authorization_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/authorize",
			token_endpoint: "https://campus-staging.mucwiki-edge.link/api/federation/token",
			jwks_uri: "https://campus-staging.mucwiki-edge.link/api/federation/jwks",
		});
	});
});
