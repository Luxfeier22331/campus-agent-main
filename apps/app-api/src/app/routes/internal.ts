import { createHash, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Hono } from "hono";

import { type Env, readAuthShellOrigin, resolveEnvironment } from "../../config";
import { withRuntimeDatabase } from "../../db/runtime";
import {
	AppApiRouteError,
	errorEnvelope,
	jsonResponse,
	routeErrorResponse,
	withNoStore,
} from "../../http";
import {
	buildEndUserEmailAdmissionPolicy,
	hashAppPassword,
	isEndUserEmailAllowedForAuth,
} from "../../modules/auth";
import {
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../modules/integration";
import { ChatFinalizationConflict } from "../../modules/runtime-command/store-types";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

function authorized(request: Request, env: Env): boolean {
	const expected = env.APP_API_EXECUTION_SHARED_SECRET?.trim();
	const provided = request.headers.get("x-app-product-callback-auth")?.trim();
	if (!(expected && provided)) {
		return false;
	}
	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	return (
		expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
	);
}

function requireObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeHeaderValue(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function hasMatchingStagingSmokeAuthSecret(request: Request, env: Env): boolean {
	const expected = normalizeHeaderValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET);
	const provided = normalizeHeaderValue(request.headers.get("x-app-staging-smoke-auth"));
	if (!(expected && provided)) {
		return false;
	}
	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	return (
		expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
	);
}

function readStringField(payload: Record<string, unknown>, fieldName: string): string | null {
	const value = payload[fieldName];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseCsvList(value: string | null | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

async function resetStagingSmokeIdentity(input: {
	email: string;
	env: Env;
	name: string;
	password: string;
}): Promise<void> {
	const policy = buildEndUserEmailAdmissionPolicy({
		endUserEmailAllowlist: parseCsvList(input.env.APP_API_END_USER_EMAIL_ALLOWLIST),
		endUserEmailDomainAllowlist: parseCsvList(input.env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST),
	});
	if (!isEndUserEmailAllowedForAuth(input.email, policy)) {
		throw new AppApiRouteError({
			code: "end_user_email_not_allowed",
			message: "This email is not allowed for campus sign-in.",
			retryable: false,
			status: 403,
		});
	}

	const userId = crypto.randomUUID();
	const accountRowId = crypto.randomUUID();
	const passwordHash = await hashAppPassword(input.password);
	const now = new Date();
	await withRuntimeDatabase(input.env, async (db) => {
		await db.execute(sql`
			delete from "chat"."conversations"
			where "owner_user_id" in (
				select "id" from "app_auth"."user" where "email" = ${input.email}
			)
		`);
		await db.execute(sql`delete from "app_auth"."user" where "email" = ${input.email}`);
		await db.execute(sql`
			insert into "app_auth"."user" (
				"id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"
			)
			values (${userId}, ${input.name}, ${input.email}, false, null, ${now}, ${now})
		`);
		await db.execute(sql`
			insert into "app_auth"."account" (
				"id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt"
			)
			values (${accountRowId}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})
		`);
	});
}

export function registerInternalRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.post("/api/internal/staging-smoke/auth/session", async (c) => {
		if (resolveEnvironment(input.env) !== "staging") {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "not_found",
					message: "Route not found.",
					retryable: false,
					status: 404,
				}),
			);
		}
		if (!input.env.APP_API_STAGING_SMOKE_AUTH_SECRET?.trim()) {
			return jsonResponse(
				errorEnvelope({
					code: "staging_smoke_auth_not_configured",
					message: "Staging smoke auth secret is not configured.",
					retryable: false,
				}),
				{ status: 503 },
			);
		}
		if (!hasMatchingStagingSmokeAuthSecret(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "staging_smoke_auth_required",
					message: "Staging smoke auth secret required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}

		const payload = await readJsonRequestBody(c.req.raw);
		const email = readStringField(payload, "email")?.toLowerCase() ?? null;
		const password = readStringField(payload, "password");
		const name = readStringField(payload, "name") ?? "Campus Agent Smoke";
		if (!(email && password)) {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "invalid_request",
					message: "email and password are required.",
					retryable: false,
					status: 400,
				}),
			);
		}

		if (payload.resetIdentity === true) {
			await resetStagingSmokeIdentity({ email, env: input.env, name, password });
		}

		const authShellOrigin = readAuthShellOrigin(input.env);
		const signInRequest = new Request(new URL("/api/auth/sign-in/email", authShellOrigin), {
			body: JSON.stringify({ email, password, rememberMe: true }),
			headers: {
				"content-type": "application/json",
				origin: authShellOrigin,
				referer: `${authShellOrigin.replace(/\/$/, "")}/account/login`,
			},
			method: "POST",
		});
		const auth = await input.createRequestScope().getAppAuth();
		return withNoStore(
			await auth.api.signInEmail({
				asResponse: true,
				body: { email, password, rememberMe: true },
				headers: signInRequest.headers,
				request: signInRequest,
			}),
		);
	});

	input.app.put("/api/internal/execution/runs/:runId/product-finalization", async (c) => {
		if (!authorized(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "internal_auth_required",
					message: "Product callback credential required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}
		const body = requireObject(await c.req.json().catch(() => null));
		const completedAt = body?.completed_at;
		const finalizationFingerprint = body?.finalization_fingerprint;
		const response = requireObject(body?.response);
		const runId = c.req.param("runId").trim();
		if (
			typeof completedAt !== "string" ||
			Number.isNaN(Date.parse(completedAt)) ||
			typeof finalizationFingerprint !== "string" ||
			!finalizationFingerprint.trim() ||
			!response ||
			!runId ||
			finalizationFingerprint.trim() !== sha256(`${runId}\0${JSON.stringify(response)}`)
		) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "Chat product finalization is invalid.",
					retryable: false,
				}),
				{ status: 400 },
			);
		}
		let parsedResponse: ToolExecutionResponse;
		try {
			parsedResponse = parseExecutionFinalizationResponsePayload(response);
		} catch {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "Chat product finalization response violates its contract.",
					retryable: false,
				}),
				{ status: 400 },
			);
		}
		const service = input.createRequestScope().resolveChatCommandService();
		if (!service.applyProductFinalization) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Chat product finalization is not configured.",
					retryable: true,
				}),
				{ status: 503 },
			);
		}
		try {
			const result = await service.applyProductFinalization({
				completedAt,
				finalizationFingerprint: finalizationFingerprint.trim(),
				response: parsedResponse,
				runId,
			});
			return jsonResponse(result, { status: 200 });
		} catch (error) {
			if (error instanceof ChatFinalizationConflict) {
				return jsonResponse(
					errorEnvelope({
						code: "finalization_conflict",
						message: "Chat finalization conflicts with the recorded terminal result.",
						retryable: false,
					}),
					{ status: 409 },
				);
			}
			throw error;
		}
	});

	input.app.put("/api/internal/profile-memory/commands/:commandId/result", async (c) => {
		if (!authorized(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "internal_auth_required",
					message: "Product callback credential required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}
		const body = requireObject(await c.req.json().catch(() => null));
		const status = body?.status;
		const resultFingerprint = body?.result_fingerprint;
		const errorCode = body?.error_code;
		if (
			(status !== "succeeded" && status !== "failed") ||
			typeof resultFingerprint !== "string" ||
			!/^[a-f0-9]{64}$/u.test(resultFingerprint.trim()) ||
			(errorCode !== undefined && typeof errorCode !== "string") ||
			(typeof errorCode === "string" && errorCode.trim().length > 64) ||
			resultFingerprint.trim() !==
				sha256(
					`${c.req.param("commandId").trim()}\0${status}\0${typeof errorCode === "string" ? errorCode.trim() : ""}`,
				)
		) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "Memory command result is invalid.",
					retryable: false,
				}),
				{ status: 400 },
			);
		}
		const outcome = await input
			.createRequestScope()
			.resolveProfileMemoryService()
			.applyResult({
				commandId: c.req.param("commandId"),
				...(typeof errorCode === "string" && errorCode.trim()
					? { errorCode: errorCode.trim() }
					: {}),
				resultFingerprint: resultFingerprint.trim(),
				status,
			});
		if (outcome === "not_found") {
			return jsonResponse(
				errorEnvelope({
					code: "command_not_found",
					message: "Memory command was not found.",
					retryable: false,
				}),
				{ status: 404 },
			);
		}
		if (outcome === "conflict") {
			return jsonResponse(
				errorEnvelope({
					code: "result_conflict",
					message: "Memory command result conflicts with the recorded terminal result.",
					retryable: false,
				}),
				{ status: 409 },
			);
		}
		return jsonResponse({ outcome }, { status: 200 });
	});
}
