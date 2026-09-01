import { CAMPUS_PASSWORD_MAX_LENGTH } from "campus-contracts/auth";
import type { Hono } from "hono";

import { type Env, readAuthShellOrigin } from "../../config";
import { AppApiRouteError, errorEnvelope, jsonResponse, withNoStore } from "../../http";
import { resolveEmailVerificationReturnTarget } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import { readJsonRequestBody, resolveWaitUntil } from "../request-utils";
import type { AppRequestScope } from "../types";
import { authenticationDependencyFailure } from "./auth-failure";

const APP_AUTH_ROUTE_PREFIX = "/api/auth";
const EMAIL_VERIFICATION_ROUTE = "/api/auth/verify-email";
const EMAIL_VERIFICATION_RESULT_ROUTE = "/account/verify-email/result";
const PUBLIC_EMAIL_VERIFICATION_ERRORS = new Set([
	"EMAIL_ACCESS_REQUIRED",
	"INVALID_TOKEN",
	"TOKEN_EXPIRED",
]);

interface BrowserEmailVerificationContext {
	origin: string;
	returnTarget: string;
}

function rewriteApiAuthRequest(request: Request): Request {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(APP_AUTH_ROUTE_PREFIX)) {
		return request;
	}

	url.pathname = url.pathname.slice(APP_AUTH_ROUTE_PREFIX.length) || "/";
	return new Request(url, request);
}

function resolveBrowserEmailVerificationContext(
	request: Request,
	authShellOrigin: string,
): BrowserEmailVerificationContext | Response | undefined {
	if (request.method !== "GET") {
		return;
	}
	const url = new URL(request.url);
	if (url.pathname !== EMAIL_VERIFICATION_ROUTE) {
		return;
	}
	const callbackURLs = url.searchParams.getAll("callbackURL");
	if (callbackURLs.length !== 1) {
		return invalidVerificationCallbackResponse();
	}
	const origin = new URL(authShellOrigin).origin;
	try {
		return {
			origin,
			returnTarget: resolveEmailVerificationReturnTarget(callbackURLs[0] ?? "", origin),
		};
	} catch {
		return invalidVerificationCallbackResponse();
	}
}

function invalidVerificationCallbackResponse(): Response {
	return jsonResponse(
		errorEnvelope({
			code: "invalid_verification_callback",
			message: "Email verification callback is invalid.",
			retryable: false,
		}),
		{ status: 400 },
	);
}

function readVerificationErrorCode(response: Response, payload: unknown, origin: string): string {
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (location) {
			try {
				return new URL(location, response.url || origin).searchParams.get("error") ?? "";
			} catch {
				return "";
			}
		}
	}
	if (!payload || typeof payload !== "object") {
		return "";
	}
	if ("code" in payload && typeof payload.code === "string") {
		return payload.code;
	}
	if (
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		"code" in payload.error &&
		typeof payload.error.code === "string"
	) {
		return payload.error.code;
	}
	return "";
}

async function normalizeBrowserEmailVerificationResponse(
	response: Response,
	context: BrowserEmailVerificationContext,
): Promise<Response> {
	const isRedirect = response.status >= 300 && response.status < 400;
	if (response.ok || (isRedirect && !response.headers.get("location")?.includes("error="))) {
		return response;
	}
	const payload = isRedirect
		? null
		: await response
				.clone()
				.json()
				.catch(() => null);
	const rawCode = readVerificationErrorCode(response, payload, context.origin);
	const errorCode = PUBLIC_EMAIL_VERIFICATION_ERRORS.has(rawCode) ? rawCode : "VERIFICATION_FAILED";
	const resultUrl = new URL(EMAIL_VERIFICATION_RESULT_ROUTE, context.origin);
	resultUrl.searchParams.set("error", errorCode);
	resultUrl.searchParams.set("redirectTo", context.returnTarget);
	return Response.redirect(resultUrl, 302);
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
		const verificationContext = resolveBrowserEmailVerificationContext(
			c.req.raw,
			readAuthShellOrigin(input.env),
		);
		if (verificationContext instanceof Response) {
			return withNoStore(verificationContext);
		}

		try {
			const response = await input.authHandler(rewriteApiAuthRequest(c.req.raw), input.env, {
				getAppAuth: scope.getAppAuth,
			});
			return withNoStore(
				verificationContext
					? await normalizeBrowserEmailVerificationResponse(response, verificationContext)
					: response,
			);
		} catch (error) {
			const response = authenticationDependencyFailure({
				error,
				request: c.req.raw,
				source: "auth_handler",
			});
			return withNoStore(
				verificationContext
					? await normalizeBrowserEmailVerificationResponse(response, verificationContext)
					: response,
			);
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
		if (password.length === 0 || password.length > CAMPUS_PASSWORD_MAX_LENGTH) {
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
