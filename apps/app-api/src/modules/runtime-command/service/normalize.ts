import { createHash, createHmac, randomUUID } from "node:crypto";

import type { ResolvedAppPrincipal } from "../../auth";
import type {
	ChatCampusServiceTraceCard,
	ChatMessageStructuredPart,
	ChatPlaceCard,
	ChatSourceCard,
} from "../../chat";
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

function recordObjectArray(
	record: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): Record<string, unknown>[] {
	const value = snakeCaseKey in record ? record[snakeCaseKey] : record[camelCaseKey];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is Record<string, unknown> => isRecord(item));
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

const UNSAFE_CAMPUS_SERVICE_TRACE_TOKEN_PATTERN =
	/(?:release[_-]?id|ingestion_projection|table_parser_state|debug[_-]?only|postgres|s3:\/\/)/iu;

const SAFE_CAMPUS_SERVICE_REF_PREFIX_PATTERNS = [
	/^authenticated_notice:\d+$/iu,
	/^official_web:[a-z0-9._:-]{2,200}$/iu,
	/^handbook:[a-z0-9._:-]{2,200}$/iu,
	/^service_catalog:[a-z0-9._:-]{2,200}$/iu,
	/^contact_directory:[a-z0-9._:-]{2,200}$/iu,
	/^notice:[a-z0-9._:-]{2,200}$/iu,
];

function normalizeCampusServiceTraceRef(ref: string): string | null {
	const normalized = ref.trim();
	if (!(normalized && normalized.length <= 220)) {
		return null;
	}
	if (UNSAFE_CAMPUS_SERVICE_TRACE_TOKEN_PATTERN.test(normalized)) {
		return null;
	}
	if (!SAFE_CAMPUS_SERVICE_REF_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized))) {
		return null;
	}
	return normalized;
}

function dedupeStable(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		deduped.push(value);
	}
	return deduped;
}

function formatCampusServiceTraceRef(ref: string): string {
	if (ref.startsWith("authenticated_notice:")) {
		return `认证通知 #${ref.split(":").at(-1)}`;
	}
	if (ref.startsWith("official_web:")) {
		return `官网来源：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("handbook:")) {
		return `手册来源：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("service_catalog:")) {
		return `服务目录：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("contact_directory:")) {
		return `联系人目录：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("notice:")) {
		return `通知来源：${ref.split(":").slice(1).join("/")}`;
	}
	return ref;
}

function collectCampusServiceTraceRefsFromRecord(input: {
	record: Record<string, unknown>;
	noticeRefs: string[];
	sourceRefs: string[];
}) {
	input.noticeRefs.push(
		...recordStringArray(input.record, "related_notice_refs", "relatedNoticeRefs"),
	);
	input.noticeRefs.push(...recordStringArray(input.record, "notice_refs", "noticeRefs"));
	input.sourceRefs.push(...recordStringArray(input.record, "source_refs", "sourceRefs"));
	input.sourceRefs.push(
		...recordStringArray(input.record, "override_source_refs", "overrideSourceRefs"),
	);
	const rootSourceRef = recordString(input.record, "source_ref", "sourceRef");
	if (rootSourceRef) {
		input.sourceRefs.push(rootSourceRef);
	}

	for (const nestedRecord of [
		...recordObjectArray(input.record, "operational_notices", "operationalNotices"),
		...recordObjectArray(input.record, "contact_points", "contactPoints"),
		...recordObjectArray(input.record, "location_refs", "locationRefs"),
		...recordObjectArray(input.record, "office_hours", "officeHours"),
		...recordObjectArray(input.record, "guide_sections", "guideSections"),
		...recordObjectArray(input.record, "required_materials", "requiredMaterials"),
		...recordObjectArray(input.record, "entry_refs", "entryRefs"),
		...recordObjectArray(input.record, "contact_refs", "contactRefs"),
	]) {
		input.sourceRefs.push(...recordStringArray(nestedRecord, "source_refs", "sourceRefs"));
		const nestedSourceRef = recordString(nestedRecord, "source_ref", "sourceRef");
		if (nestedSourceRef) {
			input.sourceRefs.push(nestedSourceRef);
		}
		input.noticeRefs.push(
			...recordStringArray(nestedRecord, "related_notice_refs", "relatedNoticeRefs"),
		);
	}
}

function campusServiceResultRecords(result: unknown): Record<string, unknown>[] {
	if (!isRecord(result)) {
		return [];
	}
	const records: Record<string, unknown>[] = [result];
	const toolResult = isRecord(result.tool_result)
		? result.tool_result
		: isRecord(result.toolResult)
			? result.toolResult
			: null;
	if (toolResult && toolResult !== result) {
		records.push(toolResult);
	}
	return records;
}

function buildCampusServiceTraceCards(input: {
	noticeRefs: string[];
	sourceRefs: string[];
}): ChatCampusServiceTraceCard[] {
	const normalizedNoticeRefs = dedupeStable(
		input.noticeRefs
			.map((item) => normalizeCampusServiceTraceRef(item))
			.filter((item): item is string => item !== null),
	);
	const noticeRefSet = new Set(normalizedNoticeRefs);
	const normalizedSourceRefs = dedupeStable(
		input.sourceRefs
			.map((item) => normalizeCampusServiceTraceRef(item))
			.filter((item): item is string => item !== null)
			.filter((item) => !noticeRefSet.has(item)),
	);
	const noticeLabels = normalizedNoticeRefs.map(formatCampusServiceTraceRef).slice(0, 6);
	const sourceLabels = normalizedSourceRefs.map(formatCampusServiceTraceRef).slice(0, 8);
	const cards: ChatCampusServiceTraceCard[] = [];
	if (noticeLabels.length > 0) {
		cards.push({
			title: "相关通知",
			refs: noticeLabels,
		});
	}
	if (sourceLabels.length > 0) {
		cards.push({
			title: "信息来源",
			refs: sourceLabels,
		});
	}
	return cards;
}

export function normalizeCampusServiceTracePart(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTarget !== "campus-services-agent" || input.status !== "completed") {
		return [];
	}

	const records = campusServiceResultRecords(input.result);
	if (records.length === 0) {
		return [];
	}

	const noticeRefs: string[] = [];
	const sourceRefs: string[] = [];
	for (const record of records) {
		collectCampusServiceTraceRefsFromRecord({
			record,
			noticeRefs,
			sourceRefs,
		});
	}
	const traceCards = buildCampusServiceTraceCards({
		noticeRefs,
		sourceRefs,
	});
	return traceCards.length > 0
		? [
				{
					type: "campus_service_trace_cards",
					traceCards,
				},
			]
		: [];
}

export function normalizeChatResponseStructuredParts(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	return [
		...normalizePlaceCardPart(input),
		...normalizeSourceCardsPart(input),
		...normalizeCampusServiceTracePart(input),
	];
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

function dedupeStringList(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeSourceRefCategory(reference: string): string | null {
	const prefix = reference.split(":", 1)[0]?.toLowerCase() ?? "";
	if (prefix === "authenticated_notice" || prefix === "internal_notice" || prefix === "notice") {
		return "校内通知";
	}
	if (prefix === "official_web") {
		return "学校官网";
	}
	if (prefix === "service_catalog" || prefix === "campus_services") {
		return "服务目录";
	}
	return null;
}

function normalizeSourceRefSummary(referenceCandidates: string[]): string {
	const categories = dedupeStringList(
		referenceCandidates
			.map((reference) => normalizeSourceRefCategory(reference))
			.filter((category): category is string => category !== null),
	);
	return categories.length > 0 ? `来源：${categories.join("、")}` : "";
}

function collectNestedSourceRefs(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) =>
		isRecord(entry) ? recordStringArray(entry, "source_refs", "sourceRefs") : [],
	);
}

function appendSourceSummary(text: string, referenceCandidates: string[]): string {
	const summary = normalizeSourceRefSummary(referenceCandidates);
	if (!summary) {
		return text;
	}
	return `${text}（${summary}）`;
}

function ensureSentenceEnd(text: string): string {
	const normalized = normalizeOptionalString(text);
	if (!normalized) {
		return "";
	}
	return /[。！？!?]$/u.test(normalized) ? normalized : `${normalized}。`;
}

function normalizeIsoTimeLabel(value: unknown): string | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/T(\d{2}:\d{2})/u);
	return match?.[1] ?? null;
}

function normalizeCampusServicesToolResult(result: unknown): Record<string, unknown> | null {
	if (!isRecord(result)) {
		return null;
	}
	if (isRecord(result.tool_result)) {
		return result.tool_result;
	}
	if (isRecord(result.toolResult)) {
		return result.toolResult;
	}
	return null;
}

function normalizeCampusServicesToolName(result: unknown): string | null {
	if (!isRecord(result)) {
		return null;
	}
	const payloadKind = normalizeOptionalString(result.payload_kind ?? result.payloadKind);
	if (payloadKind) {
		return payloadKind;
	}
	if (Array.isArray(result.allowed_tools)) {
		const firstTool = normalizeOptionalString(result.allowed_tools[0]);
		return firstTool;
	}
	return null;
}

function renderServiceStatusLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedSubject =
		recordString(toolResult, "resolved_subject", "resolvedSubject") ?? "相关服务";
	const statusNote = recordString(toolResult, "status_note", "statusNote");
	const notices = Array.isArray(toolResult.operational_notices)
		? toolResult.operational_notices
				.map((notice) =>
					isRecord(notice)
						? (recordString(notice, "note", "note") ??
							recordString(notice, "content", "content") ??
							recordString(notice, "title", "title"))
						: null,
				)
				.filter((notice): notice is string => Boolean(notice))
				.slice(0, 2)
		: [];
	const fallbackStatus = recordString(toolResult, "observed_status", "observedStatus");
	const normalizedStatus =
		fallbackStatus === "running"
			? "当前状态：正常运行"
			: fallbackStatus === "limited_service"
				? "当前状态：有限运行"
				: fallbackStatus === "suspended"
					? "当前状态：暂停服务"
					: "";
	const clauses = [
		statusNote ? `${resolvedSubject}：${statusNote}` : "",
		statusNote ? "" : normalizedStatus,
		notices.length > 0 ? `最新提示：${notices.join("；")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...recordStringArray(toolResult, "override_source_refs", "overrideSourceRefs"),
		...collectNestedSourceRefs(toolResult.operational_notices),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function renderTransportScheduleLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedRoute =
		isRecord(toolResult.resolved_route) || isRecord(toolResult.resolvedRoute)
			? ((toolResult.resolved_route ?? toolResult.resolvedRoute) as Record<string, unknown>)
			: null;
	const selectedDeparture =
		isRecord(toolResult.selected_departure) || isRecord(toolResult.selectedDeparture)
			? ((toolResult.selected_departure ?? toolResult.selectedDeparture) as Record<string, unknown>)
			: null;
	const routeName = resolvedRoute
		? (recordString(resolvedRoute, "display_name", "displayName") ?? "通勤班车")
		: "通勤班车";
	const departureTime = normalizeIsoTimeLabel(
		selectedDeparture?.departure_at ?? selectedDeparture?.departureAt,
	);
	const originStop = isRecord(
		selectedDeparture?.origin_stop_ref ?? selectedDeparture?.originStopRef,
	)
		? ((selectedDeparture?.origin_stop_ref ?? selectedDeparture?.originStopRef) as Record<
				string,
				unknown
			>)
		: null;
	const destinationStop = isRecord(
		selectedDeparture?.destination_stop_ref ?? selectedDeparture?.destinationStopRef,
	)
		? ((selectedDeparture?.destination_stop_ref ?? selectedDeparture?.destinationStopRef) as Record<
				string,
				unknown
			>)
		: null;
	const originName = originStop ? recordString(originStop, "display_name", "displayName") : null;
	const destinationName = destinationStop
		? recordString(destinationStop, "display_name", "displayName")
		: null;
	const routeDirection =
		originName && destinationName ? `（${originName} -> ${destinationName}）` : "";
	const base = departureTime ? `${routeName}首班车时间为 ${departureTime}${routeDirection}` : "";
	if (!base) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.schedule_items ?? toolResult.scheduleItems),
		...collectNestedSourceRefs(toolResult.upcoming_departures ?? toolResult.upcomingDepartures),
	];
	return ensureSentenceEnd(appendSourceSummary(base, referenceCandidates));
}

function renderServiceGuideLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedService =
		isRecord(toolResult.resolved_service) || isRecord(toolResult.resolvedService)
			? ((toolResult.resolved_service ?? toolResult.resolvedService) as Record<string, unknown>)
			: null;
	const serviceName = resolvedService
		? (recordString(resolvedService, "display_name", "displayName") ?? "该服务")
		: "该服务";
	const guideSections = Array.isArray(toolResult.guide_sections ?? toolResult.guideSections)
		? ((toolResult.guide_sections ?? toolResult.guideSections) as unknown[])
				.map((section) => {
					if (!isRecord(section)) {
						return null;
					}
					const content = recordString(section, "content", "content");
					if (!content) {
						return null;
					}
					const title = recordString(section, "title", "title");
					return title ? `${title}：${content}` : content;
				})
				.filter((section): section is string => Boolean(section))
				.slice(0, 2)
		: [];
	const entryRefs = Array.isArray(toolResult.entry_refs ?? toolResult.entryRefs)
		? ((toolResult.entry_refs ?? toolResult.entryRefs) as unknown[])
				.map((entry) => (isRecord(entry) ? recordString(entry, "label", "label") : null))
				.filter((label): label is string => Boolean(label))
				.slice(0, 2)
		: [];
	const clauses = [
		guideSections.length > 0 ? `${serviceName}：${guideSections.join("；")}` : "",
		entryRefs.length > 0 ? `可用入口：${entryRefs.join("、")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.guide_sections ?? toolResult.guideSections),
		...collectNestedSourceRefs(toolResult.entry_refs ?? toolResult.entryRefs),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function renderContactDirectoryLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedContact =
		isRecord(toolResult.resolved_contact) || isRecord(toolResult.resolvedContact)
			? ((toolResult.resolved_contact ?? toolResult.resolvedContact) as Record<string, unknown>)
			: null;
	const contactName = resolvedContact
		? (recordString(resolvedContact, "display_name", "displayName") ?? "该部门")
		: "该部门";
	const contactPoints = Array.isArray(toolResult.contact_points ?? toolResult.contactPoints)
		? ((toolResult.contact_points ?? toolResult.contactPoints) as unknown[])
				.map((point) => {
					if (!isRecord(point)) {
						return null;
					}
					const value = recordString(point, "value", "value");
					if (!value) {
						return null;
					}
					const label = recordString(point, "label", "label");
					return label ? `${label}：${value}` : value;
				})
				.filter((point): point is string => Boolean(point))
				.slice(0, 2)
		: [];
	const locationRefs = Array.isArray(toolResult.location_refs ?? toolResult.locationRefs)
		? ((toolResult.location_refs ?? toolResult.locationRefs) as unknown[])
				.map((location) => {
					if (!isRecord(location)) {
						return null;
					}
					const locationRef =
						recordString(location, "location_ref", "locationRef") ??
						recordString(location, "value", "value");
					if (!locationRef) {
						return null;
					}
					const label = recordString(location, "label", "label");
					return label ? `${label}：${locationRef}` : locationRef;
				})
				.filter((location): location is string => Boolean(location))
				.slice(0, 1)
		: [];
	const clauses = [
		contactPoints.length > 0 ? `${contactName}联系方式：${contactPoints.join("；")}` : "",
		locationRefs.length > 0 ? `办公地点：${locationRefs[0]}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...collectNestedSourceRefs(toolResult.contact_points ?? toolResult.contactPoints),
		...collectNestedSourceRefs(toolResult.location_refs ?? toolResult.locationRefs),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

export function synthesizeCampusServicesAssistantText(input: {
	result: unknown;
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
}): string | null {
	if (input.status !== "completed" || input.selectedTarget !== "campus-services-agent") {
		return null;
	}
	const toolName = normalizeCampusServicesToolName(input.result);
	const toolResult = normalizeCampusServicesToolResult(input.result);
	if (!(toolName && toolResult)) {
		return null;
	}
	if (toolName === "service_status_lookup") {
		return renderServiceStatusLookupAnswer(toolResult);
	}
	if (toolName === "transport_schedule_lookup") {
		return renderTransportScheduleLookupAnswer(toolResult);
	}
	if (toolName === "service_guide_lookup") {
		return renderServiceGuideLookupAnswer(toolResult);
	}
	if (toolName === "contact_directory_lookup") {
		return renderContactDirectoryLookupAnswer(toolResult);
	}
	return null;
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
