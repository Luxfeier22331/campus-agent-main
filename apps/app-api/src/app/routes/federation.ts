import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { dependencyNotReadyResponse } from "../responses";
import type { AppRequestScope } from "../types";

const FEDERATION_ROUTE_REWRITES = new Map<string, string>([
	["/api/federation/authorize", "/oauth2/authorize"],
	["/api/federation/token", "/oauth2/token"],
	["/api/federation/userinfo", "/oauth2/userinfo"],
	["/api/federation/jwks", "/jwks"],
	["/api/federation/logout", "/oauth2/end-session"],
]);

const FEDERATION_METADATA_ENDPOINT_REWRITES = {
	authorization_endpoint: "/api/federation/authorize",
	token_endpoint: "/api/federation/token",
	userinfo_endpoint: "/api/federation/userinfo",
	jwks_uri: "/api/federation/jwks",
	end_session_endpoint: "/api/federation/logout",
} as const;

type FederationMetadataAuth = Parameters<typeof oauthProviderOpenIdConfigMetadata>[0] &
	Parameters<typeof oauthProviderAuthServerMetadata>[0];

function buildRedirectResponse(url: string): Response | null {
	let redirectUrl: URL;
	try {
		redirectUrl = new URL(url);
	} catch {
		return null;
	}

	if (!(redirectUrl.protocol === "https:" && redirectUrl.hostname)) {
		return null;
	}

	return new Response(null, {
		headers: {
			location: redirectUrl.toString(),
		},
		status: 303,
	});
}

async function normalizeFederationProviderResponse(input: {
	request: Request;
	response: Response;
}): Promise<Response> {
	const { request, response } = input;
	const requestUrl = new URL(request.url);
	if (
		request.method === "GET" &&
		requestUrl.pathname === "/api/federation/authorize" &&
		response.status >= 400
	) {
		return await normalizeAuthorizeErrorResponse({ request, response });
	}

	if (response.status !== 200) {
		return response;
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return response;
	}

	let payload: unknown;
	try {
		payload = await response.clone().json();
	} catch {
		return response;
	}

	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return response;
	}

	const body = payload as Record<string, unknown>;
	if (body.redirect !== true || typeof body.url !== "string") {
		return response;
	}

	return buildRedirectResponse(body.url) ?? response;
}

async function normalizeAuthorizeErrorResponse(input: {
	request: Request;
	response: Response;
}): Promise<Response> {
	const contentType = input.response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return input.response;
	}

	let payload: unknown;
	try {
		payload = await input.response.clone().json();
	} catch {
		return input.response;
	}

	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return input.response;
	}

	const body = payload as Record<string, unknown>;
	const error = typeof body.error === "string" ? body.error : "invalid_request";
	const description =
		typeof body.error_description === "string"
			? body.error_description
			: typeof body.message === "string"
				? body.message
				: "";
	const errorUrl = new URL("/account/federation/error", new URL(input.request.url).origin);
	errorUrl.searchParams.set("error", error);
	if (description) {
		errorUrl.searchParams.set("error_description", description);
	}

	return new Response(null, {
		headers: {
			location: errorUrl.toString(),
		},
		status: 303,
	});
}

function rewriteFederationRequest(request: Request): Request {
	const url = new URL(request.url);
	const targetPath = FEDERATION_ROUTE_REWRITES.get(url.pathname);
	if (!targetPath) {
		return request;
	}

	url.pathname = targetPath;
	return new Request(url, request);
}

async function rewriteFederationMetadataResponse(input: {
	request: Request;
	response: Response;
}): Promise<Response> {
	const requestPath = new URL(input.request.url).pathname;
	if (
		requestPath !== "/.well-known/openid-configuration" &&
		requestPath !== "/.well-known/oauth-authorization-server"
	) {
		return input.response;
	}

	const contentType = input.response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return input.response;
	}

	const metadata = await input.response.clone().json();
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return input.response;
	}

	const rewritten: Record<string, unknown> = {
		...(metadata as Record<string, unknown>),
	};
	const issuer =
		typeof rewritten.issuer === "string" && rewritten.issuer.trim()
			? new URL(rewritten.issuer).origin
			: new URL(input.request.url).origin;
	for (const [field, path] of Object.entries(FEDERATION_METADATA_ENDPOINT_REWRITES)) {
		if (field in rewritten) {
			rewritten[field] = `${issuer}${path}`;
		}
	}

	return new Response(JSON.stringify(rewritten), input.response);
}

export function registerFederationRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	authHandler: (
		request: Request,
		env: Env,
		authInput?: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<Response> | Response;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	const handleMetadataRequest = async (request: Request) => {
		const scope = input.createRequestScope();

		try {
			const auth = (await scope.getAppAuth()) as unknown as FederationMetadataAuth;
			const metadataHandler =
				new URL(request.url).pathname === "/.well-known/oauth-authorization-server"
					? oauthProviderAuthServerMetadata(auth)
					: oauthProviderOpenIdConfigMetadata(auth);
			const response = await metadataHandler(request);
			return await rewriteFederationMetadataResponse({ request, response });
		} catch {
			return dependencyNotReadyResponse();
		}
	};

	const handleFederationRequest = async (request: Request) => {
		const scope = input.createRequestScope();

		try {
			const providerResponse = await input.authHandler(
				rewriteFederationRequest(request),
				input.env,
				{
					getAppAuth: scope.getAppAuth,
				},
			);
			const response = await normalizeFederationProviderResponse({
				request,
				response: providerResponse,
			});
			return await rewriteFederationMetadataResponse({ request, response });
		} catch {
			return dependencyNotReadyResponse();
		}
	};

	input.app.get("/.well-known/openid-configuration", (c) => handleMetadataRequest(c.req.raw));
	input.app.get("/.well-known/oauth-authorization-server", (c) => handleMetadataRequest(c.req.raw));
	input.app.get("/api/federation/authorize", (c) => handleFederationRequest(c.req.raw));
	input.app.post("/api/federation/token", (c) => handleFederationRequest(c.req.raw));
	input.app.get("/api/federation/userinfo", (c) => handleFederationRequest(c.req.raw));
	input.app.get("/api/federation/jwks", (c) => handleFederationRequest(c.req.raw));
	input.app.get("/api/federation/logout", (c) => handleFederationRequest(c.req.raw));
}
