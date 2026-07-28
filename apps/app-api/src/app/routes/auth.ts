import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, withNoStore } from "../../http";
import { requireSessionPrincipal } from "../principal";
import { readJsonRequestBody, resolveWaitUntil } from "../request-utils";
import type { AppRequestScope } from "../types";
import { authenticationDependencyFailure } from "./auth-failure";

const APP_AUTH_ROUTE_PREFIX = "/api/auth";

function rewriteApiAuthRequest(request: Request): Request {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(APP_AUTH_ROUTE_PREFIX)) {
		return request;
	}

	url.pathname = url.pathname.slice(APP_AUTH_ROUTE_PREFIX.length) || "/";
	return new Request(url, request);
}

export function registerAuthRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	authHandler: (
		request: Request,
		env: Env,
		authInput?: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<Response> | Response;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<import("../../modules/auth").ResolvedAppPrincipal | null>;
}) {
	input.app.all("/api/auth/*", async (c) => {
		const scope = input.createRequestScope();

		try {
			return withNoStore(
				await input.authHandler(rewriteApiAuthRequest(c.req.raw), input.env, {
					getAppAuth: scope.getAppAuth,
				}),
			);
		} catch (error) {
			return authenticationDependencyFailure({
				error,
				request: c.req.raw,
				scope,
				source: "auth_handler",
			});
		}
	});

	input.app.get("/api/me", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse({
			principal: resolved.principal.principal,
			session: resolved.principal.session,
			permissions: resolved.principal.permissions,
		});
	});

	input.app.post("/api/account/delete", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}
		const payload = await readJsonRequestBody(c.req.raw);
		const password = typeof payload.password === "string" ? payload.password : "";
		if (password.length === 0 || password.length > 128) {
			throw new AppApiRouteError({
				code: "REAUTHENTICATION_REQUIRED",
				message: "Current password is required.",
				retryable: false,
				status: 400,
			});
		}
		const verificationHeaders = new Headers(c.req.raw.headers);
		verificationHeaders.delete("content-encoding");
		verificationHeaders.delete("content-length");
		verificationHeaders.delete("transfer-encoding");
		verificationHeaders.set("content-type", "application/json");
		const verificationResponse = await input.authHandler(
			new Request(new URL("/verify-password", c.req.raw.url), {
				body: JSON.stringify({ password }),
				headers: verificationHeaders,
				method: "POST",
			}),
			input.env,
			{ getAppAuth: scope.getAppAuth },
		);
		if (verificationResponse.status === 429) {
			return withNoStore(verificationResponse);
		}
		if (!verificationResponse.ok) {
			throw new AppApiRouteError({
				code: "REAUTHENTICATION_REQUIRED",
				message: "Current password is invalid.",
				retryable: false,
				status: 401,
			});
		}
		const service = scope.resolveAccountLifecycleService();
		const receipt = await service.requestDeletion({ principal: resolved.principal });
		resolveWaitUntil(c)?.(service.dispatchPending());
		return jsonResponse(receipt, { status: 202 });
	});
}
