import { createHash, createHmac, randomUUID } from "node:crypto";

import type { ResolvedAppPrincipal } from "../../auth";
import type { ChatMessageStructuredPart, ChatPlaceCard, ChatSourceCard } from "../../chat";
import type { RequestedScope, SupervisorExecutionResponse } from "../../integration";
import {
	normalizeVersionQuery,
	type VersionQuery,
	VersionQueryValidationError,
} from "../../version-query";
import { resolveRequestedCapabilityForSurface } from "./capability-policy";
import { createPreAcceptError } from "./errors";
import type { ChatCommandPayload, ValidatedChatCommandPayload } from "./types";

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(input: {
	conversationDiscriminator: string;
	prompt: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				conversationDiscriminator: input.conversationDiscriminator,
				prompt: input.prompt,
				requestedCapability: input.requestedCapability,
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
];

function collapseAssistantTextWhitespace(text: string): string {
	return text
		.replace(/\s{2,}/g, " ")
		.replace(/[ \t]+([，。；：！？])/g, "$1")
		.replace(/([（【《“‘])\s+/g, "$1")
		.replace(/\s+([）】》”’])/g, "$1")
		.trim();
}

function fallbackAssistantText(status: SupervisorExecutionResponse["status"]): string {
	if (status === "needs_clarification") {
		return "我需要先确认你的具体问题，请再补充一点。";
	}
	if (status === "no_answer") {
		return "当前没有足够依据回答这个问题。";
	}
	if (status === "approval_required") {
		return "该请求需要先经过审批后才能继续。";
	}
	if (status === "rejected") {
		return "该请求未通过当前策略校验。";
	}
	if (status === "error") {
		return "当前请求暂时无法完成，请稍后再试。";
	}
	return "我已经找到相关依据，但返回文案格式异常，请换个问法再试一次。";
}

export function sanitizePublicAssistantText(input: {
	status: SupervisorExecutionResponse["status"];
	text: string;
}): string {
	const normalized = normalizeString(input.text);
	if (!normalized) {
		return fallbackAssistantText(input.status);
	}

	const stripped = collapseAssistantTextWhitespace(
		normalized.replace(INTERNAL_LOCATOR_BRACKET_PATTERN, "").replace(/\s+\]/g, "]"),
	);
	if (!stripped) {
		return fallbackAssistantText(input.status);
	}
	if (INTERNAL_LOCATOR_PATTERNS.some((pattern) => pattern.test(stripped))) {
		return fallbackAssistantText(input.status);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordString(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): string | null {
	return normalizeOptionalString(
		snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey],
	);
}

function recordNumber(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): number | null {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function recordStringArray(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): string[] {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	return normalizeStringArray(value);
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeOptionalString(item))
		.filter((item): item is string => item !== null);
}

function normalizePointGeometry(value: unknown): ChatPlaceCard["pointGeometry"] {
	if (!isRecord(value)) {
		return null;
	}

	const longitude = typeof value.longitude === "number" ? value.longitude : null;
	const latitude = typeof value.latitude === "number" ? value.latitude : null;
	if (longitude === null || latitude === null) {
		return null;
	}

	return { latitude, longitude };
}

function normalizePlaceRef(
	value: unknown,
): Pick<
	ChatPlaceCard,
	"campusArea" | "campusScope" | "displayName" | "entityType" | "placeId"
> | null {
	if (!isRecord(value)) {
		return null;
	}

	const placeId = normalizeOptionalString(value.place_id);
	const entityType = normalizeOptionalString(value.entity_type);
	const displayName = normalizeOptionalString(value.display_name);
	if (!(placeId && entityType && displayName)) {
		return null;
	}

	return {
		placeId,
		entityType,
		displayName,
		campusScope: normalizeOptionalString(value.campus_scope),
		campusArea: normalizeOptionalString(value.campus_area),
	};
}

export function normalizePlaceCardPart(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTarget !== "navigation-agent" || input.status !== "completed") {
		return [];
	}

	if (!isRecord(input.result)) {
		return [];
	}

	const placeCard = isRecord(input.result.place_card) ? input.result.place_card : null;
	if (!placeCard) {
		return [];
	}

	const place = normalizePlaceRef(placeCard.place);
	if (!place) {
		return [];
	}

	return [
		{
			type: "place_card",
			placeCard: {
				...place,
				locationDescription: normalizeOptionalString(
					placeCard.location_description ?? placeCard.address,
				),
				landmarkHint: normalizeOptionalString(placeCard.landmark_hint),
				accessNote: normalizeOptionalString(placeCard.access_note ?? placeCard.directions),
				openingNote: normalizeOptionalString(placeCard.opening_note ?? placeCard.hours),
				serviceTags: normalizeStringArray(placeCard.service_tags ?? placeCard.tags),
				pointGeometry: normalizePointGeometry(placeCard.point_geometry),
				coordinateReferenceSystem: normalizeOptionalString(placeCard.coordinate_reference_system),
				sourceRefs: normalizeStringArray(placeCard.source_refs),
			},
		},
	];
}

function normalizeDocsReaderPath(value: unknown): string | null {
	const canonicalUrl = normalizeOptionalString(value);
	if (
		!canonicalUrl?.startsWith("/docs/") ||
		canonicalUrl.startsWith("//") ||
		canonicalUrl.includes("://") ||
		canonicalUrl.includes("..")
	) {
		return null;
	}

	const [withoutHash = ""] = canonicalUrl.split("#", 1);
	const [path = ""] = withoutHash.split("?", 1);
	const normalizedPath = path.replace(/\/+$/u, "");
	return normalizedPath.startsWith("/docs/") && normalizedPath.length > "/docs/".length
		? normalizedPath
		: null;
}

function normalizeAnchor(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function normalizeHighlightUnitIds(anchor: Record<string, unknown>): string[] {
	const rootUnitIds = recordStringArray(anchor, "root_unit_ids", "rootUnitIds");
	const rootUnitId = recordString(anchor, "root_unit_id", "rootUnitId");
	return Array.from(new Set([...(rootUnitId ? [rootUnitId] : []), ...rootUnitIds]));
}

function buildSourceCardHref(input: {
	anchor: string | null;
	basePath: string;
	highlightUnitIds: string[];
}): string {
	const query =
		input.highlightUnitIds.length > 0
			? `?hl=${input.highlightUnitIds.map((item) => encodeURIComponent(item)).join(",")}`
			: "";
	const hash = input.anchor ? `#${encodeURIComponent(input.anchor)}` : "";
	return `${input.basePath}${query}${hash}`;
}

function collectionLabel(collection: string | null): string {
	if (collection === "curriculum_plan") {
		return "培养方案";
	}
	if (collection === "student_rules") {
		return "学生手册";
	}
	return "公开文档";
}

function pageLabel(anchor: Record<string, unknown>): string {
	const pageStart = recordNumber(anchor, "page_start", "pageStart");
	const pageEnd = recordNumber(anchor, "page_end", "pageEnd");
	if (pageStart && pageEnd && pageStart !== pageEnd) {
		return `原文第 ${pageStart}-${pageEnd} 页`;
	}
	if (pageStart || pageEnd) {
		return `原文第 ${pageStart ?? pageEnd} 页`;
	}
	return "";
}

function normalizeSnippet(value: unknown): string | null {
	const snippet = normalizeOptionalString(value);
	if (!snippet) {
		return null;
	}

	return snippet.length <= 180 ? snippet : `${snippet.slice(0, 179)}…`;
}

function normalizeSectionTitle(
	anchor: Record<string, unknown>,
	source: Record<string, unknown>,
): string {
	const sectionPath = recordStringArray(anchor, "section_path", "sectionPath");
	const sectionTitle = sectionPath.at(-1);
	return (
		sectionTitle ??
		recordString(anchor, "section_title", "sectionTitle") ??
		recordString(source, "section_title", "sectionTitle") ??
		""
	);
}

function normalizeSourceCard(source: unknown): ChatSourceCard | null {
	if (!isRecord(source)) {
		return null;
	}

	const basePath = normalizeDocsReaderPath(source.canonical_url ?? source.canonicalUrl);
	const anchor = normalizeAnchor(source.anchor);
	const readerAnchor =
		recordString(anchor, "reader_anchor", "readerAnchor") ??
		recordString(anchor, "anchor", "anchor");
	const title =
		recordString(source, "canonical_source_title", "canonicalSourceTitle") ??
		recordString(source, "source_title", "sourceTitle") ??
		recordString(source, "title", "title");
	const snippet = normalizeSnippet(source.snippet);
	if (!(basePath && title && snippet)) {
		return null;
	}

	const href = buildSourceCardHref({
		anchor: readerAnchor,
		basePath,
		highlightUnitIds: normalizeHighlightUnitIds(anchor),
	});

	return {
		title,
		sectionTitle: normalizeSectionTitle(anchor, source),
		snippet,
		href,
		collectionLabel: collectionLabel(recordString(source, "collection", "collection")),
		versionLabel: source.is_current === false || source.isCurrent === false ? "历史版本" : "现行版",
		pageLabel: pageLabel(anchor),
	};
}

function sourceCardDedupeKey(sourceCard: ChatSourceCard): string {
	return sourceCard.href.replace(/\?hl=[^#]*/u, "");
}

function resultEvidenceSources(result: unknown): unknown[] {
	if (!isRecord(result)) {
		return [];
	}

	if (Array.isArray(result.sources)) {
		return result.sources;
	}

	return isRecord(result.evidence) && Array.isArray(result.evidence.sources)
		? result.evidence.sources
		: [];
}

export function normalizeSourceCardsPart(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTarget !== "rag-agent" || input.status !== "completed") {
		return [];
	}

	const sourceCards: ChatSourceCard[] = [];
	const seenSourceKeys = new Set<string>();
	for (const source of resultEvidenceSources(input.result)) {
		const sourceCard = normalizeSourceCard(source);
		if (!sourceCard) {
			continue;
		}
		const dedupeKey = sourceCardDedupeKey(sourceCard);
		if (seenSourceKeys.has(dedupeKey)) {
			continue;
		}
		seenSourceKeys.add(dedupeKey);
		sourceCards.push(sourceCard);
		if (sourceCards.length >= 5) {
			break;
		}
	}

	return sourceCards.length > 0
		? [
				{
					type: "source_cards",
					sourceCards,
				},
			]
		: [];
}

export function normalizeChatResponseStructuredParts(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	return [...normalizePlaceCardPart(input), ...normalizeSourceCardsPart(input)];
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

	const requestedCapability = resolveRequestedCapabilityForSurface({
		requestedCapability: payload.requestedCapability,
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
		requestedCapability,
		requestedScope,
		versionQuery,
	};
}
