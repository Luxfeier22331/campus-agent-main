import { createHash, createHmac, randomUUID } from "node:crypto";

import type { ResolvedAppPrincipal } from "../../auth";
import type {
	ChatCampusServiceTraceCard,
	ChatMessageStructuredPart,
	ChatPlaceCard,
	ChatSourceItem,
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

function normalizeSourceKind(source: Record<string, unknown>): ChatSourceItem["sourceKind"] {
	const explicit = recordString(source, "source_kind", "sourceKind");
	if (
		explicit === "campus_service" ||
		explicit === "curriculum" ||
		explicit === "document" ||
		explicit === "notice" ||
		explicit === "regulation"
	) {
		return explicit;
	}
	const collection = recordString(source, "collection", "collection");
	if (collection === "curriculum_plan") {
		return "curriculum";
	}
	if (
		collection === "student_rules" ||
		collection === "institutional_rules" ||
		collection === "scoped_rules"
	) {
		return "regulation";
	}
	return "document";
}

function normalizeSourceTargetKind(
	source: Record<string, unknown>,
	hasCanonicalReader: boolean,
	hasPublicNoticeUrl: boolean,
): ChatSourceItem["targetKind"] | null {
	const explicit = recordString(source, "target_kind", "targetKind");
	if (
		explicit === "canonical_reader" ||
		explicit === "notice_reader" ||
		explicit === "public_notice_url" ||
		explicit === "restricted_notice"
	) {
		return explicit;
	}
	const sourceKind = normalizeSourceKind(source);
	if (hasCanonicalReader && sourceKind === "notice" && hasPublicNoticeUrl) {
		return "notice_reader";
	}
	if (hasCanonicalReader) {
		return "canonical_reader";
	}
	if (hasPublicNoticeUrl) {
		return "public_notice_url";
	}
	return null;
}

function normalizePublicNoticeUrl(value: unknown): string | null {
	const rawUrl = normalizeOptionalString(value);
	if (!rawUrl) {
		return null;
	}
	try {
		const url = new URL(rawUrl);
		const hostname = url.hostname.toLowerCase();
		const isMucPublicHost =
			(hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn")) &&
			hostname !== "my.muc.edu.cn";
		if (url.protocol !== "https:" || !(isMucPublicHost || hostname === "mp.weixin.qq.com")) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function sourceOriginalNoticeUrl(source: Record<string, unknown>): string | null {
	return normalizePublicNoticeUrl(
		source.original_url ??
			source.originalUrl ??
			source.public_notice_url ??
			source.publicNoticeUrl ??
			source.notice_url ??
			source.noticeUrl ??
			source.source_url ??
			source.sourceUrl,
	);
}

function sourcePublisherLabel(source: Record<string, unknown>): string {
	return (
		recordString(source, "publisher_label", "publisherLabel") ??
		recordString(source, "source_family_label", "sourceFamilyLabel") ??
		""
	);
}

function sourcePublishedAt(source: Record<string, unknown>): string {
	return (
		recordString(source, "published_at", "publishedAt") ??
		recordString(source, "publish_time", "publishTime") ??
		""
	);
}

function buildCanonicalReaderSourceItem(input: {
	basePath: string;
	readerAnchor: string | null;
	source: Record<string, unknown>;
	targetKind: "canonical_reader" | "notice_reader";
	title: string;
	snippet: string | null;
	originalNoticeUrl: string | null;
}): ChatSourceItem {
	const href = buildSourceCardHref({
		anchor: input.readerAnchor,
		basePath: input.basePath,
		highlightUnitIds: normalizeHighlightUnitIds(normalizeAnchor(input.source.anchor)),
	});
	const sourceKind = normalizeSourceKind(input.source);
	return {
		targetKind: input.targetKind,
		sourceKind,
		title: input.title,
		snippet: input.snippet,
		primaryAction: {
			label: input.targetKind === "notice_reader" ? "查看整理版" : "查看文档",
			href,
			external: false,
			disabledReason: null,
		},
		secondaryActions:
			input.targetKind === "notice_reader" && input.originalNoticeUrl
				? [
						{
							label: "原通知",
							href: input.originalNoticeUrl,
							external: true,
							disabledReason: null,
						},
					]
				: [],
		sectionTitle: normalizeSectionTitle(normalizeAnchor(input.source.anchor), input.source),
		collectionLabel: collectionLabel(recordString(input.source, "collection", "collection")),
		publisherLabel: sourcePublisherLabel(input.source),
		publishedAt: sourcePublishedAt(input.source),
		versionLabel:
			input.source.is_current === false || input.source.isCurrent === false ? "历史版本" : "现行版",
		pageLabel: pageLabel(normalizeAnchor(input.source.anchor)),
		trustLabel: "",
	};
}

function buildPublicNoticeSourceItem(input: {
	source: Record<string, unknown>;
	title: string;
	snippet: string | null;
	originalNoticeUrl: string;
}): ChatSourceItem {
	return {
		targetKind: "public_notice_url",
		sourceKind: "notice",
		title: input.title,
		snippet: input.snippet,
		primaryAction: {
			label: "打开原通知",
			href: input.originalNoticeUrl,
			external: true,
			disabledReason: null,
		},
		secondaryActions: [],
		sectionTitle: "",
		collectionLabel: "",
		publisherLabel: sourcePublisherLabel(input.source),
		publishedAt: sourcePublishedAt(input.source),
		versionLabel: "",
		pageLabel: "",
		trustLabel: "",
	};
}

function buildRestrictedNoticeSourceItem(input: {
	source: Record<string, unknown>;
	title: string;
	snippet: string | null;
}): ChatSourceItem {
	return {
		targetKind: "restricted_notice",
		sourceKind: "notice",
		title: input.title,
		snippet: input.snippet,
		primaryAction: {
			label: "需登录查看",
			href: null,
			external: false,
			disabledReason: "该来源需要校内身份后才能查看。",
		},
		secondaryActions: [],
		sectionTitle: "",
		collectionLabel: "",
		publisherLabel: sourcePublisherLabel(input.source),
		publishedAt: sourcePublishedAt(input.source),
		versionLabel: "",
		pageLabel: "",
		trustLabel: "",
	};
}

function normalizeSourceItem(source: unknown): ChatSourceItem | null {
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
	const originalNoticeUrl = sourceOriginalNoticeUrl(source);
	const targetKind = normalizeSourceTargetKind(
		source,
		Boolean(basePath),
		Boolean(originalNoticeUrl),
	);
	if (!(targetKind && title)) {
		return null;
	}

	if (targetKind === "restricted_notice") {
		return buildRestrictedNoticeSourceItem({ source, title, snippet });
	}

	if (targetKind === "public_notice_url") {
		return originalNoticeUrl
			? buildPublicNoticeSourceItem({ source, title, snippet, originalNoticeUrl })
			: null;
	}

	if (targetKind === "canonical_reader" || targetKind === "notice_reader") {
		return basePath
			? buildCanonicalReaderSourceItem({
					basePath,
					readerAnchor,
					source,
					targetKind,
					title,
					snippet,
					originalNoticeUrl,
				})
			: null;
	}

	return null;
}

function sourceItemDedupeKey(sourceItem: ChatSourceItem): string {
	const primaryHref = sourceItem.primaryAction.href ?? "";
	return primaryHref
		? primaryHref.replace(/\?hl=[^#]*/u, "")
		: `${sourceItem.targetKind}:${sourceItem.title}`;
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

export function normalizeSourceItemsPart(input: {
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTarget !== "rag-agent" || input.status !== "completed") {
		return [];
	}

	const sourceItems: ChatSourceItem[] = [];
	const seenSourceKeys = new Set<string>();
	for (const source of resultEvidenceSources(input.result)) {
		const sourceItem = normalizeSourceItem(source);
		if (!sourceItem) {
			continue;
		}
		const dedupeKey = sourceItemDedupeKey(sourceItem);
		if (seenSourceKeys.has(dedupeKey)) {
			continue;
		}
		seenSourceKeys.add(dedupeKey);
		sourceItems.push(sourceItem);
		if (sourceItems.length >= 5) {
			break;
		}
	}

	return sourceItems.length > 0
		? [
				{
					type: "source_items",
					sourceItems,
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
	const internalNoticeMatch = ref.match(/^notice:muc_internal_portal:(\d+)$/iu);
	if (internalNoticeMatch) {
		return `校内通知 #${internalNoticeMatch[1]}`;
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
		...normalizeSourceItemsPart(input),
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
	return /[。！？!?）)]$/u.test(normalized) ? normalized : `${normalized}。`;
}

function normalizeIsoTimeLabel(value: unknown): string | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/T(\d{2}:\d{2})/u);
	return match?.[1] ?? null;
}

function normalizeIsoDateTimeParts(value: unknown): { day: string; time: string } | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/u);
	if (!match) {
		return null;
	}
	return {
		day: `${Number(match[1])}月${Number(match[2])}日`,
		time: match[3],
	};
}

function isOpenEndedEffectiveUntil(value: unknown): boolean {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return false;
	}
	const year = Number(normalized.slice(0, 4));
	return Number.isFinite(year) && year >= 2099;
}

function formatServiceStatusEffectiveWindow(toolResult: Record<string, unknown>): string | null {
	const start = normalizeIsoDateTimeParts(toolResult.effective_from ?? toolResult.effectiveFrom);
	const rawEnd = toolResult.effective_until ?? toolResult.effectiveUntil;
	if (!start) {
		return null;
	}
	if (isOpenEndedEffectiveUntil(rawEnd)) {
		return `${start.day} ${start.time} 起`;
	}
	const end = normalizeIsoDateTimeParts(rawEnd);
	if (!end) {
		return null;
	}
	if (start.day === end.day) {
		return `${start.day} ${start.time} 至 ${end.time}`;
	}
	return `${start.day} ${start.time} 至 ${end.day} ${end.time}`;
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
	return result;
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
	if (
		normalizeOptionalString(result.subject_query ?? result.subjectQuery) ||
		normalizeOptionalString(result.resolved_subject ?? result.resolvedSubject) ||
		normalizeOptionalString(result.observed_status ?? result.observedStatus)
	) {
		return "service_status_lookup";
	}
	if (
		normalizeOptionalString(result.intent) ||
		isRecord(result.resolved_route) ||
		isRecord(result.resolvedRoute) ||
		isRecord(result.selected_departure) ||
		isRecord(result.selectedDeparture)
	) {
		return "transport_schedule_lookup";
	}
	if (
		normalizeOptionalString(result.guide_focus ?? result.guideFocus) ||
		isRecord(result.resolved_service) ||
		isRecord(result.resolvedService)
	) {
		return "service_guide_lookup";
	}
	if (
		normalizeOptionalString(result.contact_focus ?? result.contactFocus) ||
		isRecord(result.resolved_contact) ||
		isRecord(result.resolvedContact)
	) {
		return "contact_directory_lookup";
	}
	return null;
}

function normalizeCandidateDisplayName(value: unknown): string | null {
	if (!isRecord(value)) {
		return normalizeOptionalString(value);
	}
	return (
		recordString(value, "display_name", "displayName") ??
		recordString(value, "label", "label") ??
		recordString(value, "name", "name") ??
		recordString(value, "service_name", "serviceName") ??
		recordString(value, "route_name", "routeName") ??
		recordString(value, "query_text", "queryText")
	);
}

function normalizeCandidateDisplayNames(value: unknown, maxCount = 3): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const names = value
		.map((item) => normalizeCandidateDisplayName(item))
		.filter((item): item is string => item !== null);
	return dedupeStringList(names).slice(0, maxCount);
}

function normalizeFailCloseReasonLabel(reason: string): string {
	if (reason === "current_state_unverifiable") {
		return "当前时效无法稳定确认";
	}
	if (reason === "source_truth_unavailable") {
		return "当前来源暂不可用";
	}
	if (reason === "temporal_scope_ambiguous") {
		return "时间范围不明确";
	}
	if (reason === "source_family_unavailable") {
		return "可用来源类型不足";
	}
	if (reason === "source_conflict") {
		return "来源信息存在冲突";
	}
	if (reason === "manual_review_required") {
		return "需要人工核验";
	}
	if (reason === "privacy_policy_restricted") {
		return "该信息受权限策略限制";
	}
	if (reason === "stable_contact_unavailable") {
		return "当前没有可确认的稳定联系方式";
	}
	return "当前依据不足";
}

function deriveCampusServicesSubject(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	if (!input.toolResult) {
		return "这项校园服务";
	}
	if (input.toolName === "service_status_lookup") {
		return (
			recordString(input.toolResult, "resolved_subject", "resolvedSubject") ??
			recordString(input.toolResult, "subject_query", "subjectQuery") ??
			"该服务状态"
		);
	}
	if (input.toolName === "transport_schedule_lookup") {
		const resolvedRoute =
			isRecord(input.toolResult.resolved_route) || isRecord(input.toolResult.resolvedRoute)
				? ((input.toolResult.resolved_route ?? input.toolResult.resolvedRoute) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedRoute ? recordString(resolvedRoute, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "query_text", "queryText") ??
			"该班车线路"
		);
	}
	if (input.toolName === "service_guide_lookup") {
		const resolvedService =
			isRecord(input.toolResult.resolved_service) || isRecord(input.toolResult.resolvedService)
				? ((input.toolResult.resolved_service ?? input.toolResult.resolvedService) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedService ? recordString(resolvedService, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "service_query", "serviceQuery") ??
			"该服务办理指南"
		);
	}
	if (input.toolName === "contact_directory_lookup") {
		const resolvedContact =
			isRecord(input.toolResult.resolved_contact) || isRecord(input.toolResult.resolvedContact)
				? ((input.toolResult.resolved_contact ?? input.toolResult.resolvedContact) as Record<
						string,
						unknown
					>)
				: null;
		return (
			(resolvedContact ? recordString(resolvedContact, "display_name", "displayName") : null) ??
			recordString(input.toolResult, "query_text", "queryText") ??
			"该联系对象"
		);
	}
	return "这项校园服务";
}

function renderCampusServicesClarificationAnswer(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	const clarificationReason = input.toolResult
		? recordString(input.toolResult, "clarification_reason", "clarificationReason")
		: null;
	if (input.toolName === "transport_schedule_lookup") {
		const routeCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_routes ?? input.toolResult?.candidateRoutes,
		);
		const stopCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.stop_refs ?? input.toolResult?.stopRefs,
		);
		if (clarificationReason === "route_direction_required") {
			return routeCandidates.length > 0
				? `请说明班车方向（从哪里到哪里）。可选线路：${routeCandidates.join("、")}。`
				: "请说明班车方向（从哪里到哪里）。";
		}
		if (clarificationReason === "route_variant_ambiguous") {
			return routeCandidates.length > 0
				? `我找到了多个相似线路，请先确认：${routeCandidates.join("、")}。`
				: "我找到了多个相似线路，请先确认你要查询的具体线路。";
		}
		if (clarificationReason === "origin_stop_ambiguous") {
			return stopCandidates.length > 0
				? `请先确认出发站点：${stopCandidates.join("、")}。`
				: "请先确认出发站点。";
		}
		if (clarificationReason === "destination_stop_ambiguous") {
			return stopCandidates.length > 0
				? `请先确认到达站点：${stopCandidates.join("、")}。`
				: "请先确认到达站点。";
		}
		if (clarificationReason === "service_date_required") {
			return "请补充查询日期（例如 4 月 30 日）。";
		}
		if (clarificationReason === "route_family_required") {
			return routeCandidates.length > 0
				? `请先说明要查询哪条班车线：${routeCandidates.join("、")}。`
				: "请先说明要查询哪条班车线。";
		}
	}
	if (input.toolName === "service_guide_lookup") {
		const serviceCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_services ?? input.toolResult?.candidateServices,
		);
		if (clarificationReason === "service_ambiguous") {
			return serviceCandidates.length > 0
				? `我找到了多个可能的服务，请先确认：${serviceCandidates.join("、")}。`
				: "请先确认你要查询的具体服务。";
		}
		if (clarificationReason === "campus_scope_required") {
			return "请先说明校区（例如海淀校区或丰台校区）。";
		}
		if (clarificationReason === "audience_required") {
			return "请说明你对应的人群（学生、教职工或访客）。";
		}
		if (clarificationReason === "guide_focus_required") {
			return "请说明你要查询办理流程、所需材料、入口还是办公时间。";
		}
	}
	if (input.toolName === "contact_directory_lookup") {
		const contactCandidates = normalizeCandidateDisplayNames(
			input.toolResult?.candidate_contacts ?? input.toolResult?.candidateContacts,
		);
		if (clarificationReason === "contact_entity_ambiguous") {
			return contactCandidates.length > 0
				? `我找到了多个可能的联系对象，请先确认：${contactCandidates.join("、")}。`
				: "请先明确你要查询的部门或联系对象。";
		}
		if (clarificationReason === "contact_focus_required") {
			return "请说明你要查询电话、邮箱、办公地点还是办公时间。";
		}
		if (clarificationReason === "department_required") {
			return "请补充具体部门名称。";
		}
		if (clarificationReason === "campus_scope_required") {
			return "请先说明校区（例如海淀校区或丰台校区）。";
		}
		if (clarificationReason === "audience_required") {
			return "请说明你对应的人群（学生、教职工或访客）。";
		}
		if (clarificationReason === "purpose_required") {
			return "请补充你的咨询事项，我会据此定位对应联系方式。";
		}
	}
	return "为避免答错，请补充具体服务对象、校区或时间范围。";
}

function renderCampusServicesNoAnswer(input: {
	toolName: string | null;
	toolResult: Record<string, unknown> | null;
}): string {
	const outcome = input.toolResult ? recordString(input.toolResult, "outcome", "outcome") : null;
	const failCloseReason = input.toolResult
		? recordString(input.toolResult, "fail_close_reason", "failCloseReason")
		: null;
	const subject = deriveCampusServicesSubject(input);
	const reasonLabel = failCloseReason ? normalizeFailCloseReasonLabel(failCloseReason) : null;
	if (outcome === "not_found") {
		return reasonLabel
			? `目前没有检索到“${subject}”的有效信息（${reasonLabel}）。`
			: `目前没有检索到“${subject}”的有效信息。`;
	}
	if (outcome === "temporarily_unverifiable" || failCloseReason) {
		return reasonLabel
			? `为避免误导，我暂不直接给出“${subject}”的结论（${reasonLabel}）。`
			: `为避免误导，我暂不直接给出“${subject}”的结论。`;
	}
	return `当前没有足够依据回答“${subject}”。`;
}

function renderCampusServicesNoActionGuardrail(status: "approval_required" | "rejected"): string {
	const base = "我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件";
	return status === "approval_required"
		? `${base}。该请求涉及执行动作，需按校内流程人工办理。`
		: `${base}。请根据我提供的办理入口或联系方式自行操作。`;
}

function renderServiceStatusLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedSubject =
		recordString(toolResult, "resolved_subject", "resolvedSubject") ?? "相关服务";
	const statusNote = recordString(toolResult, "status_note", "statusNote");
	const effectiveWindow = formatServiceStatusEffectiveWindow(toolResult);
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
	const statusLabel = normalizeServiceStatusLabel(fallbackStatus);
	const clauses = [
		statusLabel ? `${resolvedSubject}：当前状态：${statusLabel}。` : "",
		effectiveWindow ? `有效时间：${effectiveWindow}。` : "",
		statusNote ? `提示：${ensureSentenceEnd(statusNote)}` : "",
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

function normalizeServiceStatusLabel(status: string | null): string {
	if (status === "open") {
		return "正常开放";
	}
	if (status === "closed") {
		return "未开放";
	}
	if (status === "temporarily_closed") {
		return "临时关闭";
	}
	if (status === "limited_service") {
		return "有限开放";
	}
	if (status === "unknown") {
		return "状态未确认";
	}
	return "";
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
	const operationalNotices = normalizeTransportOperationalNotices(toolResult);
	const clauses = [
		base,
		operationalNotices.length > 0 ? `最新提示：${operationalNotices.join("；")}` : "",
	].filter(Boolean);
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.operational_notices ?? toolResult.operationalNotices),
		...collectNestedSourceRefs(toolResult.schedule_items ?? toolResult.scheduleItems),
		...collectNestedSourceRefs(toolResult.upcoming_departures ?? toolResult.upcomingDepartures),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function normalizeTransportOperationalNotices(toolResult: Record<string, unknown>): string[] {
	const notices = toolResult.operational_notices ?? toolResult.operationalNotices;
	if (!Array.isArray(notices)) {
		return [];
	}
	return dedupeStable(
		notices
			.map((notice) => {
				if (!isRecord(notice)) {
					return "";
				}
				return (
					recordString(notice, "operational_comment", "operationalComment") ??
					recordString(notice, "note", "note") ??
					recordString(notice, "content", "content") ??
					recordString(notice, "title", "title") ??
					""
				);
			})
			.filter(Boolean),
	).slice(0, 2);
}

function renderServiceGuideLookupAnswer(toolResult: Record<string, unknown>): string | null {
	const resolvedService =
		isRecord(toolResult.resolved_service) || isRecord(toolResult.resolvedService)
			? ((toolResult.resolved_service ?? toolResult.resolvedService) as Record<string, unknown>)
			: null;
	const serviceName = resolvedService
		? (recordString(resolvedService, "display_name", "displayName") ?? "该服务")
		: "该服务";
	const guideSections = recordObjectArray(toolResult, "guide_sections", "guideSections")
		.map(formatServiceGuideSection)
		.filter((section): section is string => Boolean(section))
		.slice(0, 2);
	const materials = recordObjectArray(toolResult, "required_materials", "requiredMaterials")
		.map(formatServiceGuideMaterial)
		.filter((material): material is string => Boolean(material))
		.slice(0, 4);
	const entryRefs = recordObjectArray(toolResult, "entry_refs", "entryRefs")
		.map(formatServiceGuideEntry)
		.filter((entry): entry is string => Boolean(entry))
		.slice(0, 3);
	const officeHours = recordObjectArray(toolResult, "office_hours", "officeHours")
		.map(formatServiceGuideHours)
		.filter((hours): hours is string => Boolean(hours))
		.slice(0, 3);
	const contactRefs = recordObjectArray(toolResult, "contact_refs", "contactRefs")
		.map(formatServiceGuideContact)
		.filter((contact): contact is string => Boolean(contact))
		.slice(0, 3);
	const eligibilityNotes = recordStringArray(
		toolResult,
		"eligibility_notes",
		"eligibilityNotes",
	).slice(0, 3);
	const clauses = [
		guideSections.length > 0 ? `${serviceName}：${guideSections.join("；")}` : "",
		materials.length > 0 ? `所需材料：${materials.join("、")}` : "",
		entryRefs.length > 0 ? `可用入口：${entryRefs.join("、")}` : "",
		officeHours.length > 0 ? `办理时间：${officeHours.join("、")}` : "",
		contactRefs.length > 0 ? `联系方式：${contactRefs.join("、")}` : "",
		eligibilityNotes.length > 0 ? `适用范围：${eligibilityNotes.join("、")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...recordStringArray(toolResult, "related_notice_refs", "relatedNoticeRefs"),
		...collectNestedSourceRefs(toolResult.guide_sections ?? toolResult.guideSections),
		...collectNestedSourceRefs(toolResult.required_materials ?? toolResult.requiredMaterials),
		...collectNestedSourceRefs(toolResult.entry_refs ?? toolResult.entryRefs),
		...collectNestedSourceRefs(toolResult.office_hours ?? toolResult.officeHours),
		...collectNestedSourceRefs(toolResult.contact_refs ?? toolResult.contactRefs),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function formatServiceGuideSection(section: Record<string, unknown>): string | null {
	const content = recordString(section, "content", "content");
	if (!content) {
		return null;
	}
	const title = recordString(section, "title", "title");
	return title ? `${title}：${content}` : content;
}

function formatServiceGuideMaterial(material: Record<string, unknown>): string | null {
	const name = recordString(material, "name", "name");
	if (!name) {
		return null;
	}
	const note = recordString(material, "note", "note");
	const requiredSuffix = material.required === false ? "（可选）" : "";
	return [name + requiredSuffix, note].filter(Boolean).join(" ");
}

function formatServiceGuideEntry(entry: Record<string, unknown>): string | null {
	const label = recordString(entry, "label", "label");
	if (!label) {
		return null;
	}
	const locationRef = recordString(entry, "location_ref", "locationRef");
	const url = recordString(entry, "url", "url");
	return [label, locationRef && locationRef !== label ? locationRef : "", url]
		.filter(Boolean)
		.join(" ");
}

function formatServiceGuideHours(hours: Record<string, unknown>): string | null {
	const label = recordString(hours, "label", "label");
	const dayPattern = recordString(hours, "day_pattern", "dayPattern");
	const timeRange = recordString(hours, "time_range", "timeRange");
	const effectiveNote = recordString(hours, "effective_note", "effectiveNote");
	return [label, dayPattern, timeRange ?? effectiveNote].filter(Boolean).join(" ") || null;
}

function formatServiceGuideContact(contact: Record<string, unknown>): string | null {
	const label = recordString(contact, "label", "label");
	const phone = recordString(contact, "phone", "phone");
	const email = recordString(contact, "email", "email");
	const locationRef = recordString(contact, "location_ref", "locationRef");
	return [label, phone, email, locationRef].filter(Boolean).join(" ") || null;
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
				.map((point) => (isRecord(point) ? formatContactDirectoryPoint(point) : null))
				.filter((point): point is string => Boolean(point))
				.slice(0, 2)
		: [];
	const locationRefs = Array.isArray(toolResult.location_refs ?? toolResult.locationRefs)
		? ((toolResult.location_refs ?? toolResult.locationRefs) as unknown[])
				.map((location) => (isRecord(location) ? formatContactDirectoryLocation(location) : null))
				.filter((location): location is string => Boolean(location))
				.slice(0, 1)
		: [];
	const officeHours = Array.isArray(toolResult.office_hours ?? toolResult.officeHours)
		? ((toolResult.office_hours ?? toolResult.officeHours) as unknown[])
				.map((hours) => (isRecord(hours) ? formatContactDirectoryHours(hours) : null))
				.filter((hours): hours is string => Boolean(hours))
				.slice(0, 2)
		: [];
	const clauses = [
		contactPoints.length > 0 ? `${contactName}联系方式：${contactPoints.join("；")}` : "",
		locationRefs.length > 0 ? `办公地点：${locationRefs[0]}` : "",
		officeHours.length > 0 ? `办公时间：${officeHours.join("；")}` : "",
	].filter(Boolean);
	if (clauses.length === 0) {
		return null;
	}
	const referenceCandidates = [
		...recordStringArray(toolResult, "source_refs", "sourceRefs"),
		...collectNestedSourceRefs(toolResult.contact_points ?? toolResult.contactPoints),
		...collectNestedSourceRefs(toolResult.location_refs ?? toolResult.locationRefs),
		...collectNestedSourceRefs(toolResult.office_hours ?? toolResult.officeHours),
	];
	return ensureSentenceEnd(appendSourceSummary(clauses.join(" "), referenceCandidates));
}

function formatContactDirectoryPoint(point: Record<string, unknown>): string | null {
	const value = recordString(point, "value", "value");
	if (!value) {
		return null;
	}
	const label = recordString(point, "label", "label");
	return label ? `${label}：${value}` : value;
}

function formatContactDirectoryLocation(location: Record<string, unknown>): string | null {
	const locationText =
		recordString(location, "address_text", "addressText") ??
		recordString(location, "location_ref", "locationRef") ??
		recordString(location, "value", "value");
	if (!locationText) {
		return null;
	}
	const label = recordString(location, "label", "label");
	return label && label !== locationText ? `${label}：${locationText}` : locationText;
}

function formatContactDirectoryHours(hours: Record<string, unknown>): string | null {
	const label = recordString(hours, "label", "label");
	const dayPattern = recordString(hours, "day_pattern", "dayPattern");
	const timeRange = recordString(hours, "time_range", "timeRange");
	const effectiveNote = recordString(hours, "effective_note", "effectiveNote");
	return [label, dayPattern, timeRange ?? effectiveNote].filter(Boolean).join(" ") || null;
}

export function synthesizeCampusServicesAssistantText(input: {
	result: unknown;
	selectedTarget: string | null;
	status: SupervisorExecutionResponse["status"];
}): string | null {
	if (input.selectedTarget !== "campus-services-agent") {
		return null;
	}
	const toolName = normalizeCampusServicesToolName(input.result);
	const toolResult = normalizeCampusServicesToolResult(input.result);
	if (input.status === "needs_clarification") {
		return renderCampusServicesClarificationAnswer({
			toolName,
			toolResult,
		});
	}
	if (input.status === "no_answer") {
		return renderCampusServicesNoAnswer({
			toolName,
			toolResult,
		});
	}
	if (input.status === "approval_required" || input.status === "rejected") {
		return renderCampusServicesNoActionGuardrail(input.status);
	}
	if (input.status !== "completed") {
		return null;
	}
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
