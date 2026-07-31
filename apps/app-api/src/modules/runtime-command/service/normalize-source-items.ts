import type { ChatMessageStructuredPart, ChatSourceItem } from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import { normalizeDocsReaderPath } from "../../source-trace";
import {
	isRecord,
	normalizeOptionalString,
	recordNumber,
	recordString,
	recordStringArray,
} from "./normalize-record-utils";
import {
	normalizedAllowedPublicNoticeHosts,
	normalizePublicNoticeUrl,
} from "./public-notice-url-policy";

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
		explicit === "public_web_url" ||
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
	if (recordString(source, "source_ref", "sourceRef") || recordString(source, "doc_id", "docId")) {
		return "canonical_reader";
	}
	return null;
}

function normalizeExternalSourceUrl(value: unknown): string | null {
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
		if (url.protocol !== "https:" || url.port !== "" || !isMucPublicHost) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function sourceOriginalNoticeUrl(
	source: Record<string, unknown>,
	allowedPublicNoticeHosts: Set<string>,
): string | null {
	return normalizePublicNoticeUrl(
		source.original_url ??
			source.originalUrl ??
			source.public_notice_url ??
			source.publicNoticeUrl ??
			source.notice_url ??
			source.noticeUrl ??
			source.source_url ??
			source.sourceUrl,
		allowedPublicNoticeHosts,
	);
}

function sourceExternalUrl(source: Record<string, unknown>): string | null {
	return normalizeExternalSourceUrl(
		source.canonical_url ??
			source.canonicalUrl ??
			source.url ??
			source.href ??
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
	basePath: string | null;
	readerAnchor: string | null;
	source: Record<string, unknown>;
	targetKind: "canonical_reader" | "notice_reader";
	title: string;
	snippet: string | null;
	originalNoticeUrl: string | null;
}): ChatSourceItem {
	const href = input.basePath
		? buildSourceCardHref({
				anchor: input.readerAnchor,
				basePath: input.basePath,
				highlightUnitIds: normalizeHighlightUnitIds(normalizeAnchor(input.source.anchor)),
			})
		: null;
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
			disabledReason: href ? null : "该来源暂未生成可打开的整理版文档。",
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

function buildExternalSourceItem(input: {
	source: Record<string, unknown>;
	title: string;
	snippet: string | null;
	url: string;
}): ChatSourceItem {
	return {
		targetKind: "public_web_url",
		sourceKind: normalizeSourceKind(input.source),
		title: input.title,
		snippet: input.snippet,
		primaryAction: {
			label: "打开网页",
			href: input.url,
			external: true,
			disabledReason: null,
		},
		secondaryActions: [],
		sectionTitle: "",
		collectionLabel: collectionLabel(recordString(input.source, "collection", "collection")),
		publisherLabel: sourcePublisherLabel(input.source),
		publishedAt: sourcePublishedAt(input.source),
		versionLabel: "",
		pageLabel: "",
		trustLabel: "",
	};
}

function normalizeSourceItem(
	source: unknown,
	allowedPublicNoticeHosts: Set<string>,
): ChatSourceItem | null {
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
	const originalNoticeUrl = sourceOriginalNoticeUrl(source, allowedPublicNoticeHosts);
	const externalUrl = sourceExternalUrl(source);
	const targetKind = normalizeSourceTargetKind(
		source,
		Boolean(basePath),
		Boolean(originalNoticeUrl),
	);
	const normalizedTargetKind = targetKind;
	if (!(normalizedTargetKind && title)) {
		return null;
	}

	if (normalizedTargetKind === "restricted_notice") {
		return withSourceProofMetadata(
			buildRestrictedNoticeSourceItem({ source, title, snippet }),
			source,
		);
	}

	if (normalizedTargetKind === "public_web_url") {
		return externalUrl
			? withSourceProofMetadata(
					buildExternalSourceItem({ source, title, snippet, url: externalUrl }),
					source,
				)
			: null;
	}

	if (normalizedTargetKind === "public_notice_url") {
		return originalNoticeUrl
			? withSourceProofMetadata(
					buildPublicNoticeSourceItem({ source, title, snippet, originalNoticeUrl }),
					source,
				)
			: null;
	}

	if (normalizedTargetKind === "canonical_reader" || normalizedTargetKind === "notice_reader") {
		return withSourceProofMetadata(
			buildCanonicalReaderSourceItem({
				basePath,
				readerAnchor,
				source,
				targetKind: normalizedTargetKind,
				title,
				snippet,
				originalNoticeUrl,
			}),
			source,
		);
	}

	return null;
}

function withSourceProofMetadata(sourceItem: ChatSourceItem, source: Record<string, unknown>) {
	return {
		...sourceItem,
		...optionalRecordStrings(source, {
			versionId: ["version_id", "versionId"],
		}),
	};
}

function optionalRecordStrings(
	source: Record<string, unknown>,
	fields: Record<string, string[]>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [targetKey, sourceKeys] of Object.entries(fields)) {
		for (const sourceKey of sourceKeys) {
			const value = source[sourceKey];
			if (typeof value === "string" && value.trim()) {
				result[targetKey] = value.trim();
				break;
			}
		}
	}
	return result;
}

function sourceItemDedupeKey(sourceItem: ChatSourceItem): string {
	const primaryHref = sourceItem.primaryAction.href ?? "";
	return primaryHref
		? primaryHref.replace(/\?hl=[^#]*/u, "")
		: `${sourceItem.targetKind}:${sourceItem.title}`;
}

export function resultSources(result: unknown): unknown[] {
	if (!isRecord(result)) {
		return [];
	}

	return Array.isArray(result.sources) ? result.sources : [];
}

export function normalizeSourceItemsPart(input: {
	allowedPublicNoticeHosts?: readonly string[];
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.status !== "completed") {
		return [];
	}

	const sourceItems: ChatSourceItem[] = [];
	const seenSourceKeys = new Set<string>();
	const allowedPublicNoticeHosts = normalizedAllowedPublicNoticeHosts(
		input.allowedPublicNoticeHosts,
	);
	for (const source of resultSources(input.result)) {
		const sourceItem = normalizeSourceItem(source, allowedPublicNoticeHosts);
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
