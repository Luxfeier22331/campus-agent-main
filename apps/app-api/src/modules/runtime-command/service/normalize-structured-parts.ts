import type {
	ChatCampusServiceTraceCard,
	ChatMessageStructuredPart,
	ChatPlaceCard,
	ChatSourceItem,
} from "../../chat";
import type { SupervisorExecutionResponse } from "../../integration";
import {
	dedupeStable,
	isRecord,
	normalizeOptionalString,
	normalizeStringArray,
	recordNumber,
	recordObjectArray,
	recordString,
	recordStringArray,
} from "./normalize-record-utils";

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

export function resultEvidenceSources(result: unknown): unknown[] {
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
		...recordObjectArray(input.record, "procedure_groups", "procedureGroups"),
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
