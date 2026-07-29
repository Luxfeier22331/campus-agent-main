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
import { hashAppPassword } from "../../modules/auth";
import { isCampusEmail } from "../../modules/auth/campus-access";
import {
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../modules/integration";
import {
	MAX_EXECUTION_INPUT_BYTES,
	sha256Text,
} from "../../modules/runtime-command/service/durable-metadata";
import { ChatFinalizationConflict } from "../../modules/runtime-command/store-types";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

function hasMatchingSecret(
	expectedValue: string | null | undefined,
	providedValue: string | null,
): boolean {
	const expected = expectedValue?.trim() ?? "";
	const provided = providedValue?.trim() ?? "";
	const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
	const providedDigest = createHash("sha256").update(provided, "utf8").digest();
	return Boolean(expected && provided) && timingSafeEqual(expectedDigest, providedDigest);
}

function authorized(request: Request, env: Env): boolean {
	return hasMatchingSecret(
		env.APP_API_EXECUTION_SHARED_SECRET,
		request.headers.get("x-app-product-callback-auth"),
	);
}

function executionInputAuthorized(request: Request, env: Env): boolean {
	return hasMatchingSecret(
		env.APP_API_EXECUTION_INPUT_SHARED_SECRET,
		request.headers.get("x-app-execution-auth"),
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

async function resetStagingSmokeIdentity(input: {
	email: string;
	env: Env;
	name: string;
	password: string;
}): Promise<void> {
	if (!isCampusEmail(input.email)) {
		throw new AppApiRouteError({
			code: "campus_email_required",
			message: "A muc.edu.cn email address is required for the smoke identity.",
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
			values (${userId}, ${input.name}, ${input.email}, true, null, ${now}, ${now})
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
	input.app.get("/api/internal/execution/runs/:runId/input", async (c) => {
		if (!executionInputAuthorized(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "internal_auth_required",
					message: "Execution input credential required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}
		const runId = c.req.param("runId").trim();
		if (!runId) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "run_id is required.",
					retryable: false,
				}),
				{ status: 400 },
			);
		}
		const service = input.createRequestScope().resolveChatCommandService();
		if (!service.readExecutionInput) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Execution input storage is not configured.",
					retryable: true,
				}),
				{ status: 503 },
			);
		}
		const frozen = await service.readExecutionInput(runId);
		if (
			!frozen ||
			frozen.executionInputReleasedAt ||
			(frozen.executionInputJson === null && frozen.executionInputSha256 === null)
		) {
			return jsonResponse(
				errorEnvelope({
					code: "execution_input_not_found",
					message: "Execution input not found.",
					retryable: false,
				}),
				{ status: 404 },
			);
		}
		const size =
			frozen.executionInputJson === null
				? 0
				: new TextEncoder().encode(frozen.executionInputJson).byteLength;
		if (
			frozen.executionInputJson === null ||
			frozen.executionInputSha256 === null ||
			!/^[a-f0-9]{64}$/u.test(frozen.executionInputSha256) ||
			size > MAX_EXECUTION_INPUT_BYTES ||
			sha256Text(frozen.executionInputJson) !== frozen.executionInputSha256
		) {
			return jsonResponse(
				errorEnvelope({
					code: "execution_input_conflict",
					message: "Frozen execution input is unavailable or inconsistent.",
					retryable: false,
				}),
				{ status: 409 },
			);
		}
		return new Response(frozen.executionInputJson, {
			headers: {
				"cache-control": "no-store",
				"content-type": "application/json; charset=utf-8",
			},
			status: 200,
		});
	});

	input.app.delete("/api/internal/execution/runs/:runId/input", async (c) => {
		if (!executionInputAuthorized(c.req.raw, input.env)) {
			return jsonResponse(
				errorEnvelope({
					code: "internal_auth_required",
					message: "Execution input credential required.",
					retryable: false,
				}),
				{ status: 401 },
			);
		}
		const runId = c.req.param("runId").trim();
		if (!runId) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "run_id is required.",
					retryable: false,
				}),
				{ status: 400 },
			);
		}
		const service = input.createRequestScope().resolveChatCommandService();
		if (!service.releaseExecutionInput) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Execution input storage is not configured.",
					retryable: true,
				}),
				{ status: 503 },
			);
		}
		const outcome = await service.releaseExecutionInput({
			releasedAt: new Date().toISOString(),
			runId,
		});
		if (outcome === "not_terminal") {
			return jsonResponse(
				errorEnvelope({
					code: "execution_input_not_terminal",
					message: "Execution input cannot be released before product finalization.",
					retryable: true,
				}),
				{ status: 409 },
			);
		}
		return new Response(null, {
			headers: { "cache-control": "no-store" },
			status: 204,
		});
	});

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
		const responseJson = body?.response_json;
		const runId = c.req.param("runId").trim();
		if (
			typeof completedAt !== "string" ||
			Number.isNaN(Date.parse(completedAt)) ||
			typeof finalizationFingerprint !== "string" ||
			!finalizationFingerprint.trim() ||
			typeof responseJson !== "string" ||
			responseJson.length === 0 ||
			(body !== null && "response" in body) ||
			!runId ||
			finalizationFingerprint.trim() !== sha256(`${runId}\0${responseJson}`)
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
		let response: Record<string, unknown> | null;
		try {
			response = requireObject(JSON.parse(responseJson));
		} catch {
			response = null;
		}
		if (!response) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "Chat product finalization response is invalid JSON object.",
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
