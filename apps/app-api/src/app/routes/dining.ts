import {
	DiningReviewCreateSchema,
	DiningReviewReportCreateSchema,
} from "@campus-agent/dining/domain";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal, resolvePrincipalForScope } from "../principal";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

const DINING_MENU_CACHE_CONTROL = "public, max-age=30, s-maxage=60";

export function registerDiningContentRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/dining/windows/:windowId/menu", async (c) => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(
				await scope
					.resolveDiningContentService()
					.getWindowMenu(requirePathId(c.req.param("windowId"))),
				{ headers: { "cache-control": DINING_MENU_CACHE_CONTROL } },
			);
		} catch (error) {
			return handleDiningError(error);
		}
	});

	input.app.get("/api/dining/menu-items/:menuItemId/reviews", async (c) => {
		const scope = input.createRequestScope();
		try {
			const principal = await resolvePrincipalForScope({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			return jsonResponse(
				await scope.resolveDiningContentService().listReviews({
					cursor: c.req.query("cursor") || undefined,
					limit: parseLimit(c.req.query("limit")),
					menuItemId: requirePathId(c.req.param("menuItemId")),
					viewerUserId: principal?.principal.principalId ?? null,
				}),
			);
		} catch (error) {
			return handleDiningError(error);
		}
	});

	input.app.post("/api/dining/menu-items/:menuItemId/reviews", async (c) => {
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
		try {
			const body = DiningReviewCreateSchema.parse(await readJsonRequestBody(c.req.raw));
			return jsonResponse(
				await scope.resolveDiningContentService().createReview({
					actor: {
						displayName: resolved.principal.principal.displayName,
						kind: "member",
						principalId: resolved.principal.principal.principalId,
					},
					anonymous: body.anonymous,
					body: body.body,
					idempotencyKey: requireIdempotencyKey(c.req.raw),
					menuItemId: requirePathId(c.req.param("menuItemId")),
				}),
				{ status: 201 },
			);
		} catch (error) {
			return handleDiningError(error);
		}
	});

	input.app.delete("/api/dining/reviews/:reviewId", async (c) => {
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
		try {
			await scope.resolveDiningContentService().deleteOwnReview({
				reviewId: requirePathId(c.req.param("reviewId")),
				userId: resolved.principal.principal.principalId,
			});
			return new Response(null, { status: 204 });
		} catch (error) {
			return handleDiningError(error);
		}
	});

	input.app.post("/api/dining/reviews/:reviewId/reports", async (c) => {
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
		try {
			const body = DiningReviewReportCreateSchema.parse(await readJsonRequestBody(c.req.raw));
			return jsonResponse(
				await scope.resolveDiningContentService().reportReview({
					details: body.details?.trim() || null,
					reason: body.reason,
					reviewId: requirePathId(c.req.param("reviewId")),
					userId: resolved.principal.principal.principalId,
				}),
				{ status: 201 },
			);
		} catch (error) {
			return handleDiningError(error);
		}
	});
}

function requirePathId(value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized || normalized.length > 200) {
		throw invalidRequest("dining_id_invalid", "食堂内容标识无效。");
	}
	return normalized;
}

function requireIdempotencyKey(request: Request): string {
	const value = request.headers.get("idempotency-key")?.trim();
	if (!value || value.length < 8 || value.length > 200) {
		throw invalidRequest("idempotency_key_invalid", "Idempotency-Key 必须为 8 至 200 个字符。");
	}
	return value;
}

function parseLimit(value: string | undefined): number {
	if (!value) {
		return 20;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
		throw invalidRequest("dining_review_limit_invalid", "评价分页数量必须在 1 至 50 之间。");
	}
	return parsed;
}

function invalidRequest(code: string, message: string): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status: 400 });
}

function handleDiningError(error: unknown): Response {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponse(error);
	}
	if (error && typeof error === "object" && "issues" in error) {
		return routeErrorResponse(invalidRequest("dining_request_invalid", "食堂内容请求无效。"));
	}
	throw error;
}
