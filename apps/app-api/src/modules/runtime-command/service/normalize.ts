import { createHash, createHmac, randomUUID } from "node:crypto";
import { AppApiRouteError } from "../../../http";
import type { ResolvedAppPrincipal } from "../../auth";
import type { ToolExecutionResponse } from "../../integration";
import { createPreAcceptError } from "./errors";
import { isRecord, normalizeOptionalString } from "./normalize-record-utils";
import { resultSources } from "./normalize-source-items";
import type {
	ChatCommandPayload,
	ChatCommandRequestKind,
	InternalEvalChatCommandPayload,
	ValidatedChatCommandPayload,
} from "./types";

export { normalizeSourceItemsPart } from "./normalize-source-items";

export {
	normalizeCampusServiceTracePart,
	normalizeChatResponseStructuredParts,
} from "./normalize-structured-parts";

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(input: {
	conversationDiscriminator: string;
	prompt: string;
	requestedTool: string | null;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				conversationDiscriminator: input.conversationDiscriminator,
				prompt: input.prompt,
				requestedTool: input.requestedTool,
			}),
		)
		.digest("hex");
}

export function previewText(text: string, maxLength = 160): string {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

const INTERNAL_LOCATOR_PATTERNS = [
	/source-faithful/iu,
	/\b(?:program_semester_facts|program_family_facts|course_facts|curriculum|handbook|official_web|student_rules|service_catalog|campus_services|authenticated_notice|internal_notice|notice):/iu,
	/\bchunk-[a-z0-9_-]+\b/iu,
	/\[[^\]\n]*#[^\]\n]*\]/u,
	/(?:release[_-]?id|projection(?:_id|_table)?|table_parser_state|debug[_-]?only)\s*[:=]/iu,
	/\bingestion_projection\b/iu,
	/\bs3:\/\//iu,
];

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

	if (INTERNAL_LOCATOR_PATTERNS.some((pattern) => pattern.test(input.text))) {
		throw new AppApiRouteError({
			code: "execution_invalid_public_response",
			message: "Execution public answer text leaked internal locator content.",
			retryable: true,
			status: 502,
		});
	}
	return input.text;
}

function normalizeRequestedTool(value: unknown): string | null {
	const tool = normalizeString(value);
	return tool || null;
}

function assertSupportedPayloadFields(
	payload: ChatCommandPayload | InternalEvalChatCommandPayload,
	requestKind: ChatCommandRequestKind,
): void {
	const supportedFields = new Set(["conversationId", "prompt"]);
	if (requestKind === "internal_eval") {
		supportedFields.add("requestedTool");
	}
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

export function deriveSafetyIdentifier(
	principal: ResolvedAppPrincipal,
	secret: string,
): string | null {
	const source = resolveSafetyIdentifierSource(principal);
	const normalizedSecret = normalizeString(secret);
	if (!(source && normalizedSecret)) {
		return null;
	}

	return createHmac("sha256", normalizedSecret).update(source).digest("hex");
}

export function extractSourceDocIds(result: unknown): string[] {
	if (!isRecord(result)) {
		return [];
	}

	const sources = resultSources(result);
	if (sources.length === 0) {
		return [];
	}

	const sourceDocIds = sources
		.map((source) =>
			isRecord(source)
				? normalizeOptionalString(
						source.source_document_id ?? source.sourceDocumentId ?? source.doc_id,
					)
				: null,
		)
		.filter((sourceDocumentId): sourceDocumentId is string => Boolean(sourceDocumentId));

	return Array.from(new Set(sourceDocIds));
}

export function resolveValidatedPayload(
	payload: ChatCommandPayload | InternalEvalChatCommandPayload,
	input: { requestKind: ChatCommandRequestKind },
): ValidatedChatCommandPayload {
	assertSupportedPayloadFields(payload, input.requestKind);
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

	const internalPayload = payload as InternalEvalChatCommandPayload;
	const requestedTool =
		input.requestKind === "internal_eval"
			? normalizeRequestedTool(internalPayload.requestedTool)
			: null;

	return {
		conversationId,
		prompt,
		requestedTool,
	};
}
