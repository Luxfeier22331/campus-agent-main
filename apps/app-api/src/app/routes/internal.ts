import { createHash, timingSafeEqual } from "node:crypto";

import type { Hono } from "hono";

import type { Env } from "../../config";
import { errorEnvelope, jsonResponse } from "../../http";
import {
	parseExecutionFinalizationResponsePayload,
	type ToolExecutionResponse,
} from "../../modules/integration";
import {
	MAX_EXECUTION_INPUT_BYTES,
	sha256Text,
} from "../../modules/runtime-command/service/durable-metadata";
import { ChatFinalizationConflict } from "../../modules/runtime-command/store-types";
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
		env.APP_API_EXECUTION_SHARED_SECRET,
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

export function registerInternalRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/internal/execution/requests/:requestId/input", async (c) => {
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
		const requestId = c.req.param("requestId").trim();
		if (!requestId) {
			return jsonResponse(
				errorEnvelope({
					code: "invalid_request",
					message: "request_id is required.",
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
		const frozen = await service.readExecutionInput(requestId);
		if (!frozen || (frozen.executionInputJson === null && frozen.executionInputSha256 === null)) {
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

	input.app.put("/api/internal/execution/requests/:requestId/product-finalization", async (c) => {
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
		const requestId = c.req.param("requestId").trim();
		if (
			typeof completedAt !== "string" ||
			Number.isNaN(Date.parse(completedAt)) ||
			typeof finalizationFingerprint !== "string" ||
			!finalizationFingerprint.trim() ||
			typeof responseJson !== "string" ||
			responseJson.length === 0 ||
			(body !== null && "response" in body) ||
			!requestId ||
			finalizationFingerprint.trim() !== sha256(`${requestId}\0${responseJson}`)
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
				requestId,
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
