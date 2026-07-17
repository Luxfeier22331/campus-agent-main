import type { Context, Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import type { ProfileMemoryService } from "../../modules/profile-memory";
import { requireSessionPrincipal } from "../principal";
import {
	createRouteErrorCorrelation,
	readJsonRequestBody,
	resolveWaitUntil,
} from "../request-utils";
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

function requireState(body: Record<string, unknown>): "active" | "paused" {
	const enabled = body.enabled;
	if (typeof enabled !== "boolean") {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "enabled must be a boolean.",
			retryable: false,
			status: 400,
		});
	}
	return enabled ? "active" : "paused";
}

function requireIdempotencyKey(request: Request): string {
	const value = request.headers.get("idempotency-key")?.trim();
	if (!value) {
		throw new AppApiRouteError({
			code: "idempotency_key_required",
			message: "Idempotency-Key is required.",
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
}) {
	return requireSessionPrincipal(input);
}

function scheduleDispatch(c: Context, service: ProfileMemoryService): void {
	resolveWaitUntil(c)?.(service.dispatchPending());
}

function mutationResponse(c: Context, service: ProfileMemoryService, value: unknown): Response {
	scheduleDispatch(c, service);
	return jsonResponse({ profileMemory: value }, { status: 202 });
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
		const correlation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const service = scope.resolveProfileMemoryService();
			const result = await service.createItem({
				idempotencyKey: requireIdempotencyKey(c.req.raw),
				key: requireStringField(body, "key"),
				principal: resolved.principal,
				value: requireStringField(body, "value"),
			});
			return mutationResponse(c, service, result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
			}
			throw error;
		}
	});

	input.app.patch("/api/me/profile-memory/items/:itemId", async (c) => {
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
		const correlation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const service = scope.resolveProfileMemoryService();
			const result = await service.updateItem({
				idempotencyKey: requireIdempotencyKey(c.req.raw),
				itemId: c.req.param("itemId"),
				key: requireStringField(body, "key"),
				principal: resolved.principal,
				value: requireStringField(body, "value"),
			});
			return mutationResponse(c, service, result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
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
		const correlation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const service = scope.resolveProfileMemoryService();
			const result = await service.setLifecycle({
				idempotencyKey: requireIdempotencyKey(c.req.raw),
				principal: resolved.principal,
				state: requireState(body),
			});
			return mutationResponse(c, service, result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
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
		const correlation = createRouteErrorCorrelation();
		try {
			const service = scope.resolveProfileMemoryService();
			const result = await service.deleteItem({
				idempotencyKey: requireIdempotencyKey(c.req.raw),
				itemId: c.req.param("itemId"),
				principal: resolved.principal,
			});
			return mutationResponse(c, service, result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
			}
			throw error;
		}
	});

	input.app.delete("/api/me/profile-memory", async (c) => {
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
		const correlation = createRouteErrorCorrelation();
		try {
			const service = scope.resolveProfileMemoryService();
			const result = await service.erase({
				idempotencyKey: requireIdempotencyKey(c.req.raw),
				principal: resolved.principal,
			});
			return mutationResponse(c, service, result);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, correlation);
			}
			throw error;
		}
	});
}
