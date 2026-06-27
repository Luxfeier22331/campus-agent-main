import { createHash, createHmac, randomUUID } from "node:crypto";
import { AppApiRouteError } from "../../../http";
import type { ResolvedAppPrincipal } from "../../auth";
import type { RequestedScope, ToolExecutionResponse } from "../../integration";
import {
	normalizeVersionQuery,
	type VersionQuery,
	VersionQueryValidationError,
} from "../../version-query";
import { createPreAcceptError } from "./errors";
import { isRecord, normalizeOptionalString } from "./normalize-record-utils";
import { resultEvidenceSources } from "./normalize-structured-parts";
import { resolveRequestedToolForSurface } from "./tool-policy";
import type { ChatCommandPayload, ValidatedChatCommandPayload } from "./types";

export {
	normalizeCampusServiceTracePart,
	normalizeChatResponseStructuredParts,
	normalizePlaceCardPart,
	normalizeSourceItemsPart,
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
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				conversationDiscriminator: input.conversationDiscriminator,
				prompt: input.prompt,
				requestedTool: input.requestedTool,
				requestedScope: input.requestedScope,
				versionQuery: input.versionQuery,
			}),
		)
		.digest("hex");
}

export function previewText(text: string, maxLength = 160): string {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

const INTERNAL_LOCATOR_BRACKET_PATTERN =
	/\[[^\]\n]*(?:source-faithful|chunk-[a-z0-9_-]+|(?:program_semester_facts|program_family_facts|course_facts|curriculum|handbook|official_web|student_rules|service_catalog|campus_services|authenticated_notice|internal_notice|notice):[^\]\n#]*#[^\]\n]*)[^\]\n]*\]/giu;

const INTERNAL_LOCATOR_PATTERNS = [
	/source-faithful/iu,
	/\b(?:program_semester_facts|program_family_facts|course_facts|curriculum|handbook|official_web|student_rules|service_catalog|campus_services|authenticated_notice|internal_notice|notice):/iu,
	/\bchunk-[a-z0-9_-]+\b/iu,
	/\[[^\]\n]*#[^\]\n]*\]/u,
	/(?:release[_-]?id|projection(?:_id|_table)?|table_parser_state|debug[_-]?only)\s*[:=]/iu,
	/\bingestion_projection\b/iu,
	/\bs3:\/\//iu,
];

function collapseAssistantTextWhitespace(text: string): string {
	return text
		.replace(/\s{2,}/g, " ")
		.replace(/[ \t]+([，。；：！？])/g, "$1")
		.replace(/([（【《“‘])\s+/g, "$1")
		.replace(/\s+([）】》”’])/g, "$1")
		.trim();
}

export function sanitizePublicAssistantText(input: {
	status: ToolExecutionResponse["status"];
	text: string;
}): string {
	const normalized = normalizeString(input.text);
	if (!normalized) {
		throw new AppApiRouteError({
			code: "execution_invalid_public_response",
			message: `execution returned an empty public answer text for status ${input.status}.`,
			retryable: true,
			status: 502,
		});
	}

	const stripped = collapseAssistantTextWhitespace(
		normalized.replace(INTERNAL_LOCATOR_BRACKET_PATTERN, "").replace(/\s+\]/g, "]"),
	);
	if (!stripped) {
		throw new AppApiRouteError({
			code: "execution_invalid_public_response",
			message: "Execution public answer text became empty after locator scrubbing.",
			retryable: true,
			status: 502,
		});
	}
	if (INTERNAL_LOCATOR_PATTERNS.some((pattern) => pattern.test(stripped))) {
		throw new AppApiRouteError({
			code: "execution_invalid_public_response",
			message: "Execution public answer text leaked internal locator content.",
			retryable: true,
			status: 502,
		});
	}
	return stripped;
}

function normalizeRequestedScope(value: unknown): RequestedScope | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const scope = value as Record<string, unknown>;
	const corpus = normalizeString(scope.corpus);
	const collection = normalizeString(scope.collection);
	if (!(corpus && collection)) {
		return null;
	}

	return { corpus, collection };
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

	const sources = resultEvidenceSources(result);
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
	payload: ChatCommandPayload,
	input: { surface: string },
): ValidatedChatCommandPayload {
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

	const requestedTool = resolveRequestedToolForSurface({
		requestedTool: payload.requestedTool,
		surface: input.surface,
	});

	const requestedScope = normalizeRequestedScope(payload.requestedScope);
	let versionQuery: VersionQuery | null;
	try {
		versionQuery = normalizeVersionQuery(payload.versionQuery);
	} catch (error) {
		if (error instanceof VersionQueryValidationError) {
			throw createPreAcceptError({
				code: "validation_failed",
				details: { field: error.field },
				message: error.message,
				status: 422,
			});
		}
		throw error;
	}

	return {
		conversationId,
		prompt,
		requestedTool,
		requestedScope,
		versionQuery,
	};
}
