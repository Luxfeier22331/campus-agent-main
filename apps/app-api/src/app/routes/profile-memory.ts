import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import { routeErrorResponseWithRouteErrorCorrelation } from "../responses";
import type { AppRequestScope } from "../types";

function requireObjectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "Expected a JSON object request body.",
			retryable: false,
			status: 400,
		});
	}
	return value as Record<string, unknown>;
}

function requireStringField(body: Record<string, unknown>, fieldName: string): string {
	const value = body[fieldName];
	if (typeof value !== "string") {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: `${fieldName} must be a string.`,
			retryable: false,
			status: 400,
		});
	}
	return value;
}

function requireBooleanField(body: Record<string, unknown>, fieldName: string): boolean {
	const value = body[fieldName];
	if (typeof value !== "boolean") {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: `${fieldName} must be a boolean.`,
			retryable: false,
			status: 400,
		});
	}
	return value;
}

async function requirePrincipal(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<
	| {
			principal: ResolvedAppPrincipal;
			response?: never;
	  }
	| {
			principal?: never;
			response: Response;
	  }
> {
	return requireSessionPrincipal(input);
}

export function registerProfileMemoryRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/me/profile-memory", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requirePrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const profileMemory = await scope
			.resolveProfileMemoryService()
			.list({ principal: resolved.principal });
		return jsonResponse({ profileMemory });
	});

	input.app.post("/api/me/profile-memory/items", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requirePrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const result = await scope.resolveProfileMemoryService().upsert({
				key: requireStringField(body, "key"),
				principal: resolved.principal,
				value: requireStringField(body, "value"),
			});
			return jsonResponse(result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
			}
			throw error;
		}
	});

	input.app.patch("/api/me/profile-memory/settings", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requirePrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const profileMemory = await scope.resolveProfileMemoryService().setEnabled({
				enabled: requireBooleanField(body, "enabled"),
				principal: resolved.principal,
			});
			return jsonResponse({ profileMemory });
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
			}
			throw error;
		}
	});

	input.app.delete("/api/me/profile-memory/items/:itemId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requirePrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const result = await scope.resolveProfileMemoryService().deleteItem({
			itemId: c.req.param("itemId"),
			principal: resolved.principal,
		});
		return jsonResponse(result);
	});
}
