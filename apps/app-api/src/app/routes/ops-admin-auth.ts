import { timingSafeEqual } from "node:crypto";

import type { Env } from "../../config";
import { AppApiRouteError } from "../../http";

function routeError(code: string, message: string, status: number): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status });
}

function secureEqual(expected: string, provided: string): boolean {
	const left = Buffer.from(expected);
	const right = Buffer.from(provided);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function requireOpsAdminToken(request: Request, env: Env): void {
	const expected = env.OPS_WEB_INTERNAL_TOKEN?.trim();
	if (!expected) {
		throw routeError("ops_admin_not_configured", "Ops administration is not configured.", 503);
	}
	const authorization = request.headers.get("authorization")?.trim();
	const provided = authorization?.startsWith("Bearer ")
		? authorization.slice("Bearer ".length).trim()
		: "";
	if (!(provided && secureEqual(expected, provided))) {
		throw routeError("ops_admin_unauthorized", "Ops administration token is invalid.", 401);
	}
}

export function requireOpsCommandHeaders(request: Request): {
	actorId: string;
	idempotencyKey: string;
} {
	if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
		throw routeError("json_required", "Content-Type must be application/json.", 415);
	}
	const actorId = request.headers.get("x-ops-actor-id")?.trim();
	const idempotencyKey = request.headers.get("idempotency-key")?.trim();
	if (!actorId || actorId.length > 200) {
		throw routeError("ops_actor_required", "A valid ops actor is required.", 400);
	}
	if (!idempotencyKey || idempotencyKey.length > 200) {
		throw routeError("idempotency_key_required", "A valid Idempotency-Key is required.", 400);
	}
	return { actorId, idempotencyKey };
}
