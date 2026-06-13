import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, routeErrorResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import type { AppDependencies, AppRequestScope } from "../types";

function readRequiredAdapterBaseUrl(env: Env): string | null {
	const value = env.CHATKIT_ADAPTER_BASE_URL?.trim();
	if (!value) {
		return null;
	}
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function readRequiredInternalSecret(env: Env): string | null {
	const value = env.APP_API_INTERNAL_SHARED_SECRET?.trim();
	return value || null;
}

function encodeHeaderValue(value: string): string {
	if (/^[\x20-\x7E]+$/.test(value) && !value.includes(",")) {
		return value;
	}
	return `b64:${Buffer.from(value, "utf8").toString("base64")}`;
}

function setOptionalHeader(headers: Record<string, string>, name: string, value: string | null) {
	if (value) {
		headers[name] = encodeHeaderValue(value);
	}
}

function setOptionalListHeader(headers: Record<string, string>, name: string, values: string[]) {
	if (values.length > 0) {
		headers[name] = values.map(encodeHeaderValue).join(",");
	}
}

function buildPrincipalHeaders(principal: ResolvedAppPrincipal): HeadersInit {
	const headers: Record<string, string> = {
		"x-app-campus-principal-id": principal.principal.principalId,
		"x-app-campus-principal-type": principal.principal.type,
	};
	setOptionalHeader(headers, "x-app-campus-display-name", principal.principal.displayName);
	setOptionalHeader(headers, "x-app-campus-email", principal.principal.email);
	setOptionalListHeader(headers, "x-app-campus-actor-roles", principal.actor.roles);
	setOptionalListHeader(headers, "x-app-campus-departments", principal.actor.departments);
	setOptionalHeader(headers, "x-app-campus-cohort", principal.actor.cohort ?? null);
	setOptionalHeader(headers, "x-app-campus-major", principal.actor.major ?? null);
	setOptionalHeader(headers, "x-app-campus-program", principal.actor.program ?? null);
	if (principal.authorization) {
		setOptionalHeader(
			headers,
			"x-app-campus-entitlement-snapshot-id",
			principal.authorization.entitlementSnapshotId,
		);
		setOptionalListHeader(
			headers,
			"x-app-campus-entitlement-groups",
			principal.authorization.entitlementGroups,
		);
		setOptionalHeader(
			headers,
			"x-app-campus-visibility-level",
			principal.authorization.retrievalFilter.visibilityLevel,
		);
		setOptionalHeader(
			headers,
			"x-app-campus-visibility-scope",
			principal.authorization.visibilityScope,
		);
		setOptionalHeader(
			headers,
			"x-app-campus-applicability-scope",
			principal.authorization.applicabilityScope ?? null,
		);
		setOptionalListHeader(
			headers,
			"x-app-campus-ownership-scopes",
			principal.authorization.ownershipScopes,
		);
	}
	return headers;
}

function buildForwardedHeaders(input: {
	contentType: string | null;
	internalSecret: string;
	principal: ResolvedAppPrincipal;
	request: Request;
}): Headers {
	const headers = new Headers({
		accept: input.request.headers.get("accept") ?? "application/json",
		"x-app-internal-auth": input.internalSecret,
		...buildPrincipalHeaders(input.principal),
	});
	if (input.contentType) {
		headers.set("content-type", input.contentType);
	}
	return headers;
}

function buildAdapterRequest(input: {
	adapterBaseUrl: string;
	body: ArrayBuffer;
	contentType: string | null;
	internalSecret: string;
	principal: ResolvedAppPrincipal;
	request: Request;
}): Request {
	const inbound = new URL(input.request.url);
	const target = new URL("/chatkit", input.adapterBaseUrl);
	target.search = inbound.search;
	return new Request(target, {
		body: input.body,
		headers: buildForwardedHeaders(input),
		method: input.request.method,
	});
}

function chatAccessForbiddenResponse(): Response {
	return routeErrorResponse(
		new AppApiRouteError({
			code: "forbidden",
			message: "Chat access is not available for this principal.",
			retryable: false,
			status: 403,
		}),
	);
}

function chatKitSessionRequiredResponse(): Response {
	return routeErrorResponse(
		new AppApiRouteError({
			code: "session_required",
			message: "请先登录。",
			retryable: false,
			status: 401,
		}),
	);
}

function chatKitDependencyNotReadyResponse(): Response {
	return routeErrorResponse(
		new AppApiRouteError({
			code: "dependency_not_ready",
			message: "服务暂不可用，请稍后再试。",
			retryable: true,
			status: 503,
		}),
	);
}

export function registerChatKitRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	fetchChatKitAdapter?: AppDependencies["fetchChatKitAdapter"];
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.post("/api/chatkit", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			if (resolved.response.status === 401) {
				return chatKitSessionRequiredResponse();
			}
			return resolved.response;
		}
		if (!resolved.principal.permissions.chat) {
			return chatAccessForbiddenResponse();
		}

		const adapterBaseUrl = readRequiredAdapterBaseUrl(input.env);
		const internalSecret = readRequiredInternalSecret(input.env);
		if (!(adapterBaseUrl && internalSecret)) {
			return chatKitDependencyNotReadyResponse();
		}

		const adapterRequest = buildAdapterRequest({
			adapterBaseUrl,
			body: await c.req.raw.arrayBuffer(),
			contentType: c.req.header("content-type") ?? null,
			internalSecret,
			principal: resolved.principal,
			request: c.req.raw,
		});
		const fetchAdapter = input.fetchChatKitAdapter ?? fetch;
		let adapterResponse: Response;
		try {
			adapterResponse = await fetchAdapter(adapterRequest);
		} catch {
			return chatKitDependencyNotReadyResponse();
		}
		const headers = new Headers(adapterResponse.headers);
		headers.delete("set-cookie");
		return new Response(adapterResponse.body, {
			headers,
			status: adapterResponse.status,
			statusText: adapterResponse.statusText,
		});
	});
}
