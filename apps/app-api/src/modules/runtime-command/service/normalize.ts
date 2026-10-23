import { createHash, createHmac, randomUUID } from "node:crypto";
import { AppApiRouteError } from "../../../http";
import type { ResolvedAppPrincipal } from "../../auth";
import type { ToolExecutionResponse } from "../../integration";
import { createPreAcceptError } from "./errors";
import type {
	ChatCommandPayload,
	InternalEvalChatCommandPayload,
	ValidatedChatCommandPayload,
} from "./types";

export { normalizeSourceItemsPart } from "./normalize-source-items";
export { normalizeChatResponseStructuredParts } from "./normalize-structured-parts";

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(input: {
	conversationDiscriminator: string;
	prompt: string;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				conversationDiscriminator: input.conversationDiscriminator,
				prompt: input.prompt,
			}),
		)
		.digest("hex");
}

export function sanitizePublicAssistantText(input: {
	status: ToolExecutionResponse["status"];
	text: string;
}): string {
	if (!input.text.trim()) {
		throw new AppApiRouteError({
			code: "execution_invalid_public_response",
			message: `execution returned an empty public answer text for status ${input.status}.`,
			retryable: true,
			status: 502,
		});
	}

	return input.text;
}

function assertSupportedPayloadFields(
	payload: ChatCommandPayload | InternalEvalChatCommandPayload,
): void {
	const supportedFields = new Set(["conversationId", "prompt"]);
	for (const field of Object.keys(payload as Record<string, unknown>)) {
		if (supportedFields.has(field)) {
			continue;
		}
		throw createPreAcceptError({
			code: "validation_failed",
			details: { field },
			message: `${field} is not supported.`,
			status: 422,
		});
	}
}

function resolveSafetyIdentifierSource(principal: ResolvedAppPrincipal): string | null {
	const principalId = normalizeString(principal.principal.principalId);
	if (principalId) {
		return `principal:${principalId}`;
	}

	const sessionId = normalizeString(principal.session?.sessionId);
	if (sessionId) {
		return `session:${sessionId}`;
	}

	return null;
}

function requireSafetyIdentifierSecret(secret: string): string {
	const normalizedSecret = normalizeString(secret);
	if (!normalizedSecret) {
		throw new Error(
			"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET is required when deriving a safety identifier.",
		);
	}
	return normalizedSecret;
}

export function deriveSafetyIdentifier(
	principal: ResolvedAppPrincipal,
	secret: string,
): string | null {
	const source = resolveSafetyIdentifierSource(principal);
	if (!source) {
		return null;
	}

	return createHmac("sha256", requireSafetyIdentifierSecret(secret)).update(source).digest("hex");
}

export function deriveSafetyIdentifierForUser(userId: string, secret: string): string | null {
	const normalizedUserId = normalizeString(userId);
	if (!normalizedUserId) {
		return null;
	}

	return createHmac("sha256", requireSafetyIdentifierSecret(secret))
		.update(`principal:${normalizedUserId}`)
		.digest("hex");
}

export function resolveValidatedPayload(
	payload: ChatCommandPayload | InternalEvalChatCommandPayload,
): ValidatedChatCommandPayload {
	assertSupportedPayloadFields(payload);
	const conversationId = normalizeString(payload.conversationId) || null;

	const prompt = normalizeString(payload.prompt);
	if (!prompt) {
		throw createPreAcceptError({
			code: "validation_failed",
			details: { field: "prompt" },
			message: "prompt is required.",
			status: 422,
		});
	}

	return {
		conversationId,
		prompt,
	};
}
