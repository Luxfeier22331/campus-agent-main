import type { Context, Hono } from "hono";
import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { AppAuthResolutionInput, ResolvedAppPrincipal } from "../../modules/auth";
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
		authInput: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}) {
	return requireSessionPrincipal(input);
}

async function mutationResponse(
	c: Context,
	service: ProfileMemoryService,
	value: unknown,
): Promise<Response> {
	const dispatch = service.dispatchPending();
	const waitUntil = resolveWaitUntil(c);
	if (waitUntil) {
		waitUntil(dispatch);
	} else {
		await dispatch;
	}
	return jsonResponse({ profileMemory: value }, { status: 202 });
}
export function registerProfileMemoryRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: AppAuthResolutionInput,
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	async function handle(
		c: Context,
		operation: (
			service: ProfileMemoryService,
			principal: ResolvedAppPrincipal,
		) => Promise<Response>,
	): Promise<Response> {
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
		try {
			return await operation(scope.resolveProfileMemoryService(), resolved.principal);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithRouteErrorCorrelation(error, createRouteErrorCorrelation());
			}
			throw error;
		}
	}
	input.app.get("/api/me/profile-memory", (c) =>
		handle(c, async (service, principal) =>
			jsonResponse({ profileMemory: await service.list({ principal }) }),
		),
	);
	input.app.get("/api/me/profile-memory/items", (c) =>
		handle(c, async (service, principal) => {
			const limit = Number(c.req.query("limit") ?? 20);
			const offset = Number(c.req.query("offset") ?? 0);
			const kind = c.req.query("kind");
			const state = c.req.query("state");
			const q = c.req.query("q")?.trim();
			if (
				!Number.isInteger(limit) ||
				limit < 1 ||
				limit > 100 ||
				!Number.isInteger(offset) ||
				offset < 0 ||
				(kind !== undefined && kind !== "fact" && kind !== "experience" && kind !== "summary") ||
				(state !== undefined && state !== "active" && state !== "inactive")
			) {
				throw new AppApiRouteError({
					code: "invalid_request",
					message: "Invalid memory list query.",
					status: 400,
					retryable: false,
				});
			}
			return jsonResponse(
				await service.listItems({
					principal,
					limit,
					offset,
					...(q ? { q } : {}),
					...(kind ? { kind } : {}),
					...(state ? { state } : {}),
				}),
			);
		}),
	);
	input.app.get("/api/me/profile-memory/items/:memoryId", (c) =>
		handle(c, async (service, principal) =>
			jsonResponse({
				item: await service.getItem({ principal, memoryId: c.req.param("memoryId") }),
			}),
		),
	);
	input.app.post("/api/me/profile-memory/items", (c) =>
		handle(c, async (service, principal) => {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			return mutationResponse(
				c,
				service,
				await service.createItem({
					principal,
					idempotencyKey: requireIdempotencyKey(c.req.raw),
					text: requireStringField(body, "text"),
				}),
			);
		}),
	);
	input.app.patch("/api/me/profile-memory/items/:memoryId", (c) =>
		handle(c, async (service, principal) => {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const state = body.state;
			if (state !== undefined && state !== "active" && state !== "inactive") {
				throw new AppApiRouteError({
					code: "invalid_request",
					message: "Invalid memory state.",
					status: 400,
					retryable: false,
				});
			}
			return mutationResponse(
				c,
				service,
				await service.updateItem({
					principal,
					idempotencyKey: requireIdempotencyKey(c.req.raw),
					memoryId: c.req.param("memoryId"),
					...(body.text === undefined ? {} : { text: requireStringField(body, "text") }),
					...(state === undefined ? {} : { state }),
				}),
			);
		}),
	);
	input.app.post("/api/me/profile-memory/operations/:commandId/retry", (c) =>
		handle(c, async (service, principal) =>
			mutationResponse(
				c,
				service,
				await service.retryCommand({
					principal,
					idempotencyKey: requireIdempotencyKey(c.req.raw),
					commandId: c.req.param("commandId"),
				}),
			),
		),
	);
	input.app.patch("/api/me/profile-memory/settings", (c) =>
		handle(c, async (service, principal) => {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			return mutationResponse(
				c,
				service,
				await service.setLifecycle({
					principal,
					idempotencyKey: requireIdempotencyKey(c.req.raw),
					state: requireState(body),
				}),
			);
		}),
	);
	input.app.delete("/api/me/profile-memory", (c) =>
		handle(c, async (service, principal) =>
			mutationResponse(
				c,
				service,
				await service.erase({ principal, idempotencyKey: requireIdempotencyKey(c.req.raw) }),
			),
		),
	);
}
