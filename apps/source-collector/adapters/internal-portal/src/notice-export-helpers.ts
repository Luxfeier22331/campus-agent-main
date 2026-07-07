import path from "node:path";

import { collectHtmlVisualReferenceCandidates } from "./html-visual-references.js";
import { buildNoticeTypePolicySnapshot } from "./notice-types.js";
import type {
	BundleAttachmentObservation,
	BundleLinkObservation,
	BundleNoticeAttachmentRelation,
	BundleNoticePayload,
	BundleNoticeRecord,
	InternalPortalCaptureRuntimeMetadata,
	NoticeAnnexInfo,
	NoticeCategoryRecord,
	NoticeCollectionMode,
	NoticeExportManifest,
	NoticeItem,
	NoticeRunAdmissionReport,
	NoticeSelectsResponse,
	NoticeTypeConfig,
} from "./types.js";
export const INTERNAL_PORTAL_SOURCE_CHANNEL = "internal_portal";
export const EXPORT_SCHEMA_VERSION = "internal_portal_notice_export_v1";
const HTML_ANCHOR_RE = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const ATTACHMENT_FILE_EXTENSIONS = new Set([
	".7z",
	".avif",
	".bmp",
	".csv",
	".doc",
	".docx",
	".gif",
	".jpeg",
	".jpg",
	".pdf",
	".png",
	".ppt",
	".pptx",
	".rar",
	".svg",
	".tif",
	".tiff",
	".txt",
	".webp",
	".xls",
	".xlsx",
	".zip",
]);

export function buildExportManifest(input: {
	attachmentStorageMode: InternalPortalCaptureRuntimeMetadata["attachment_storage_mode"];
	collectionMode: NoticeCollectionMode;
	detailFetched: number;
	exportedAt: string;
	fullScopeCompleted: boolean;
	fullScopeRequested: boolean;
	itemsInserted: number;
	itemsSeen: number;
	maxNotices: number | null;
	noticeTypes: NoticeTypeConfig[];
	observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>;
	observedOrganizations: Array<{ organization_id: string; organization_name: string }>;
	pageBudgetExhausted: boolean;
	pagesFetched: number;
	runAdmission: NoticeRunAdmissionReport;
	selectedNoticeIds?: string[];
	selectedNoticeTypes?: string[];
	siteId: string;
	sourceHomeUrl: string;
}): NoticeExportManifest {
	const timestamp = toTimestampLabel(input.exportedAt);
	const selectedNoticeIds = input.selectedNoticeIds ?? [];
	const selectedNoticeTypes = input.selectedNoticeTypes ?? [];
	return {
		schema_version: EXPORT_SCHEMA_VERSION,
		exported_at: input.exportedAt,
		export_date: timestamp.slice(0, 8),
		export_scope: `bootstrap-${timestamp}`,
		source_channel: INTERNAL_PORTAL_SOURCE_CHANNEL,
		source_surface: "notice",
		site_id: input.siteId,
		source_home_url: input.sourceHomeUrl,
		full_scope_requested: input.fullScopeRequested,
		full_scope_completed: input.fullScopeCompleted,
		page_budget_exhausted: input.pageBudgetExhausted,
		capture_runtime: {
			runtime_shell: "source_collector_node",
			export_contract_version: EXPORT_SCHEMA_VERSION,
			link_collection_mode: "html_reference_only",
			attachment_collection_mode:
				input.attachmentStorageMode === "reference_only"
					? "detail_api_and_html_reference_only"
					: "detail_api_and_html_materialized",
			attachment_storage_mode: input.attachmentStorageMode,
		},
		filters: {
			collection_mode: input.collectionMode,
			max_notices: input.maxNotices,
			notice_types:
				selectedNoticeTypes.length > 0
					? selectedNoticeTypes
					: input.noticeTypes.filter((item) => item.enabled).map((item) => item.type),
			...(selectedNoticeIds.length > 0 ? { selected_notice_ids: selectedNoticeIds } : {}),
		},
		run_admission: input.runAdmission,
		notice_type_policy: buildNoticeTypePolicySnapshot(input.noticeTypes),
		observed_notice_types: input.observedNoticeTypes,
		observed_organizations: input.observedOrganizations,
		run: {
			detail_fetched: input.detailFetched,
			errors: 0,
			finished_at: input.exportedAt,
			items_inserted: input.itemsInserted,
			items_seen: input.itemsSeen,
			mode: input.collectionMode,
			pages_fetched: input.pagesFetched,
			started_at: input.exportedAt,
			status: "success",
		},
	};
}

export function normalizeObservedNoticeTypes(
	response: NoticeSelectsResponse,
): Array<{ notice_type_id: number; notice_type_name: string }> {
	const normalized: Array<{ notice_type_id: number; notice_type_name: string }> = [];
	const seen = new Set<number>();
	for (const item of response.datas?.type ?? []) {
		const noticeTypeId = normalizeOptionalNoticeId(item.notice_type_id);
		const noticeTypeName = normalizeNullableText(item.notice_type_name);
		if (noticeTypeId === null || !noticeTypeName || seen.has(noticeTypeId)) {
			continue;
		}
		seen.add(noticeTypeId);
		normalized.push({
			notice_type_id: noticeTypeId,
			notice_type_name: noticeTypeName,
		});
	}
	return normalized.sort((left, right) => left.notice_type_id - right.notice_type_id);
}

export function normalizeObservedOrganizations(
	response: NoticeSelectsResponse,
): Array<{ organization_id: string; organization_name: string }> {
	const normalized: Array<{ organization_id: string; organization_name: string }> = [];
	const seen = new Set<string>();
	for (const item of response.datas?.org ?? []) {
		const organizationId = normalizeNullableText(item.organization_id);
		const organizationName = normalizeNullableText(item.organization_name);
		if (!(organizationId && organizationName) || seen.has(organizationId)) {
			continue;
		}
		seen.add(organizationId);
		normalized.push({
			organization_id: organizationId,
			organization_name: organizationName,
		});
	}
	return normalized.sort((left, right) =>
		left.organization_id.localeCompare(right.organization_id, "zh-Hans-CN"),
	);
}

export function mergeBundleRecord(
	existing: BundleNoticeRecord,
	notice: NoticeItem,
	observedAt: string,
): BundleNoticeRecord {
	const categories = dedupeCategories(
		existing.notice.categories,
		buildCategories({
			notice,
			noticeId: existing.notice_id,
			observedAt,
		}),
	);
	const mergedNotice: BundleNoticePayload = {
		...existing.notice,
		categories,
		notice_content: existing.notice.notice_content ?? normalizeNullableText(notice.notice_content),
		notice_create_time:
			existing.notice.notice_create_time ?? normalizeNullableText(notice.notice_create_time),
		notice_first_time:
			existing.notice.notice_first_time ?? normalizeNullableText(notice.notice_first_time),
		notice_link: existing.notice.notice_link ?? normalizeNullableText(notice.notice_link),
		notice_release_time:
			existing.notice.notice_release_time ?? normalizeNullableText(notice.notice_release_time),
		organization_id:
			existing.notice.organization_id ?? normalizeNullableText(notice.organization_id),
		organization_name:
			existing.notice.organization_name ?? normalizeNullableText(notice.organization_name),
	};
	return {
		...existing,
		notice: mergedNotice,
	};
}

export function buildReferenceArtifacts(input: {
	htmlValue: string;
	noticeAnnexes?: NoticeAnnexInfo[] | null;
	noticeId: number;
	observedAt: string;
	sourceHomeUrl?: string;
}): {
	links: BundleLinkObservation[];
	noticeAttachments: BundleNoticeAttachmentRelation[];
	attachments: BundleAttachmentObservation[];
} {
	const links: BundleLinkObservation[] = [];
	const noticeAttachments: BundleNoticeAttachmentRelation[] = [];
	const attachments: BundleAttachmentObservation[] = [];
	const attachmentIds = new Map<string, number>();
	const htmlAttachmentIds = new Set<number>();
	const annexAttachmentIds = new Set<number>();
	const inlineImageLinkKeys = new Set<string>();
	let nextLinkId = 1;
	let nextAttachmentId = 1;

	function ensureAttachmentObservation(params: {
		filenameHint: string | null;
		finalUrl: string;
		linkHost: string | null;
		linkScope: "internal" | "external" | "unsupported";
		urlScheme: string | null;
	}): number {
		let attachmentId = attachmentIds.get(params.finalUrl);
		if (attachmentId !== undefined) {
			return attachmentId;
		}

		attachmentId = nextAttachmentId;
		nextAttachmentId += 1;
		attachmentIds.set(params.finalUrl, attachmentId);
		attachments.push({
			attachment_id: attachmentId,
			source_url: params.finalUrl,
			normalized_source_url: params.finalUrl,
			final_url: params.finalUrl,
			original_filename: deriveOriginalFilename(params.finalUrl, params.filenameHint),
			mime_type: null,
			byte_size: null,
			sha256: null,
			storage_provider: "reference_only",
			bucket: null,
			object_key: null,
			etag: null,
			version_id: null,
			origin_url_scheme: params.urlScheme,
			origin_host: params.linkHost,
			origin_scope: params.linkScope,
			provenance_status: "reference_only",
			ingest_status: "reference_only",
			local_path: null,
			downloaded_at: null,
			uploaded_at: null,
			last_error: null,
			created_at: input.observedAt,
			updated_at: input.observedAt,
		});
		return attachmentId;
	}

	for (const match of input.htmlValue.matchAll(HTML_ANCHOR_RE)) {
		const rawHref = decodeHtmlAttribute(String(match[2] || ""));
		const linkText = normalizeNullableText(stripHtml(String(match[3] || "")));
		if (!rawHref) {
			continue;
		}
		const resolvedLink = resolveLinkTarget({
			rawHref,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		const contentKind = isAttachmentLike({
			href: rawHref,
			linkText,
			finalUrl: resolvedLink.finalUrl,
		})
			? "attachment_list"
			: "body_link";
		const linkId = nextLinkId;
		nextLinkId += 1;
		links.push({
			id: linkId,
			notice_id: input.noticeId,
			run_id: null,
			source: "content",
			content_kind: contentKind,
			url: rawHref,
			url_scheme: resolvedLink.urlScheme,
			link_host: resolvedLink.linkHost,
			link_scope: resolvedLink.linkScope,
			collect_policy: resolvedLink.collectPolicy,
			skip_reason: resolvedLink.skipReason,
			link_text: linkText,
			final_url: resolvedLink.finalUrl,
			title: null,
			status_code: null,
			content_type: null,
			downloaded: false,
			download_path: null,
			file_size: null,
			fetched_at: input.observedAt,
			error_message: resolvedLink.errorMessage,
		});

		if (
			contentKind !== "attachment_list" ||
			resolvedLink.collectPolicy !== "reference_only" ||
			resolvedLink.finalUrl === null
		) {
			continue;
		}
		const attachmentId = ensureAttachmentObservation({
			filenameHint: linkText,
			finalUrl: resolvedLink.finalUrl,
			linkHost: resolvedLink.linkHost,
			linkScope: resolvedLink.linkScope,
			urlScheme: resolvedLink.urlScheme,
		});
		htmlAttachmentIds.add(attachmentId);
		noticeAttachments.push({
			notice_id: input.noticeId,
			attachment_id: attachmentId,
			link_id: linkId,
			relation_source: "content",
			resource_role: "attachment",
			anchor_text: linkText,
			discovered_at: input.observedAt,
		});
	}

	function addInlineImageReference(candidate: { linkText: string | null; rawUrl: string }): void {
		if (!candidate.rawUrl) {
			return;
		}
		const resolvedLink = resolveLinkTarget({
			rawHref: candidate.rawUrl,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		const linkKey =
			resolvedLink.finalUrl ?? `${resolvedLink.urlScheme ?? "unknown"}:${candidate.rawUrl}`;
		if (inlineImageLinkKeys.has(linkKey)) {
			return;
		}
		inlineImageLinkKeys.add(linkKey);
		const linkText =
			candidate.linkText ??
			(resolvedLink.finalUrl === null ? null : deriveOriginalFilename(resolvedLink.finalUrl, null));
		const linkId = nextLinkId;
		nextLinkId += 1;
		links.push({
			id: linkId,
			notice_id: input.noticeId,
			run_id: null,
			source: "content",
			content_kind: "inline_image",
			url: candidate.rawUrl,
			url_scheme: resolvedLink.urlScheme,
			link_host: resolvedLink.linkHost,
			link_scope: resolvedLink.linkScope,
			collect_policy: resolvedLink.collectPolicy,
			skip_reason: resolvedLink.skipReason,
			link_text: linkText,
			final_url: resolvedLink.finalUrl,
			title: null,
			status_code: null,
			content_type: null,
			downloaded: false,
			download_path: null,
			file_size: null,
			fetched_at: input.observedAt,
			error_message: resolvedLink.errorMessage,
		});

		if (resolvedLink.collectPolicy !== "reference_only" || resolvedLink.finalUrl === null) {
			return;
		}
		const attachmentId = ensureAttachmentObservation({
			filenameHint: linkText,
			finalUrl: resolvedLink.finalUrl,
			linkHost: resolvedLink.linkHost,
			linkScope: resolvedLink.linkScope,
			urlScheme: resolvedLink.urlScheme,
		});
		if (htmlAttachmentIds.has(attachmentId)) {
			return;
		}
		htmlAttachmentIds.add(attachmentId);
		noticeAttachments.push({
			notice_id: input.noticeId,
			attachment_id: attachmentId,
			link_id: linkId,
			relation_source: "content",
			resource_role: "inline_image",
			anchor_text: linkText,
			discovered_at: input.observedAt,
		});
	}

	for (const candidate of collectHtmlVisualReferenceCandidates(input.htmlValue)) {
		addInlineImageReference(candidate);
	}

	for (const annex of input.noticeAnnexes ?? []) {
		const annexId = normalizeNullableText(annex.notice_annex_id);
		if (!annexId) {
			continue;
		}
		const finalUrl = buildDetailAttachmentUrl({
			noticeId: input.noticeId,
			annexId,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		if (!finalUrl) {
			continue;
		}
		const resolvedLink = resolveLinkTarget({
			rawHref: finalUrl,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		if (resolvedLink.collectPolicy !== "reference_only" || resolvedLink.finalUrl === null) {
			continue;
		}
		const anchorText = normalizeNullableText(annex.notice_annex_name) ?? annexId;
		const attachmentId = ensureAttachmentObservation({
			filenameHint: anchorText,
			finalUrl: resolvedLink.finalUrl,
			linkHost: resolvedLink.linkHost,
			linkScope: resolvedLink.linkScope,
			urlScheme: resolvedLink.urlScheme,
		});
		if (htmlAttachmentIds.has(attachmentId) || annexAttachmentIds.has(attachmentId)) {
			continue;
		}
		annexAttachmentIds.add(attachmentId);
		noticeAttachments.push({
			notice_id: input.noticeId,
			attachment_id: attachmentId,
			link_id: null,
			relation_source: "detail_api",
			resource_role: "attachment",
			anchor_text: anchorText,
			discovered_at: input.observedAt,
		});
	}

	return {
		links,
		noticeAttachments,
		attachments,
	};
}

export function buildCategories(input: {
	notice: NoticeItem;
	noticeId: number;
	observedAt: string;
}): NoticeCategoryRecord[] {
	const noticeType = normalizeNoticeType(input.notice.notice_type);
	if (!noticeType) {
		return [];
	}
	return [
		{
			notice_id: input.noticeId,
			notice_type: noticeType,
			notice_type_name: normalizeNullableText(input.notice.notice_type_name),
			category_first_seen_at: input.observedAt,
			category_last_seen_at: input.observedAt,
			category_last_run_id: null,
		},
	];
}

export function buildNoticeBrowserUrls(input: {
	noticeId: number;
	noticeLink: string | null;
	noticeLinkState: number | null;
	noticeSource: number | null;
	noticeType: string;
	sourceHomeUrl?: string | null;
}): Pick<
	BundleNoticePayload,
	"notice_browser_url" | "notice_browser_url_source" | "portal_print_url"
> {
	const portalPrintUrl = buildPortalPrintUrl(input);
	if (input.noticeSource === 1 && input.noticeLinkState !== 1 && input.noticeLink) {
		return {
			notice_browser_url: input.noticeLink,
			notice_browser_url_source: "api_notice_link",
			portal_print_url: portalPrintUrl,
		};
	}
	if (portalPrintUrl) {
		return {
			notice_browser_url: portalPrintUrl,
			notice_browser_url_source: "portal_print_route",
			portal_print_url: portalPrintUrl,
		};
	}
	return {
		notice_browser_url: null,
		notice_browser_url_source: "unavailable",
		portal_print_url: null,
	};
}

function buildPortalPrintUrl(input: {
	noticeId: number;
	noticeLinkState: number | null;
	noticeType: string;
	sourceHomeUrl?: string | null;
}): string | null {
	const noticeType = input.noticeType.trim();
	if (!noticeType) {
		return null;
	}
	const origin = sourceHomeOrigin(input.sourceHomeUrl);
	if (!origin) {
		return null;
	}
	const params = new URLSearchParams({
		type: noticeType,
		notice_id: String(input.noticeId),
		show_type: "1",
	});
	if (input.noticeLinkState === 1) {
		params.set("notice_link_state", "1");
	}
	return `${origin}/#/print?${params.toString()}`;
}

function sourceHomeOrigin(value: string | null | undefined): string | null {
	try {
		const trimmed = value?.trim();
		return trimmed ? new URL(trimmed).origin : null;
	} catch {
		return null;
	}
}

function dedupeCategories(...categorySets: NoticeCategoryRecord[][]): NoticeCategoryRecord[] {
	const merged = new Map<string, NoticeCategoryRecord>();
	for (const categorySet of categorySets) {
		for (const category of categorySet) {
			merged.set(category.notice_type, category);
		}
	}
	return [...merged.values()];
}

function buildDetailAttachmentUrl(input: {
	noticeId: number;
	annexId: string;
	sourceHomeUrl?: string;
}): string | null {
	if (!input.sourceHomeUrl) {
		return null;
	}
	try {
		const url = new URL("/comsys-portal-notice-web/download", input.sourceHomeUrl);
		url.searchParams.set("id", input.annexId);
		url.searchParams.set("notice_id", String(input.noticeId));
		return url.toString();
	} catch {
		return null;
	}
}

export function normalizeOptionalNoticeId(
	value: number | string | null | undefined,
): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) {
			return Math.trunc(parsed);
		}
	}
	return null;
}

export function normalizeRequiredNoticeId(value: number | string | null | undefined): number {
	const noticeId = normalizeOptionalNoticeId(value);
	if (noticeId === null) {
		throw new Error("notice_id is required");
	}
	return noticeId;
}

export function normalizeNoticeType(value: number | string | null | undefined): string {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(Math.trunc(value));
	}
	if (typeof value === "string") {
		return value.trim();
	}
	return "";
}

function resolveLinkTarget(input: { rawHref: string; sourceHomeUrl?: string }): {
	collectPolicy: "reference_only" | "skip_scheme";
	errorMessage: string | null;
	finalUrl: string | null;
	linkHost: string | null;
	linkScope: "internal" | "external" | "unsupported";
	skipReason: "unsupported_scheme" | null;
	urlScheme: string | null;
} {
	const explicitScheme = extractUrlScheme(input.rawHref);
	if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
		return {
			collectPolicy: "skip_scheme",
			errorMessage: "unsupported scheme",
			finalUrl: null,
			linkHost: null,
			linkScope: "unsupported",
			skipReason: "unsupported_scheme",
			urlScheme: explicitScheme,
		};
	}

	try {
		const url = input.sourceHomeUrl
			? new URL(input.rawHref, input.sourceHomeUrl)
			: new URL(input.rawHref);
		const sourceHome = input.sourceHomeUrl ? new URL(input.sourceHomeUrl) : null;
		return {
			collectPolicy: "reference_only",
			errorMessage: null,
			finalUrl: url.toString(),
			linkHost: url.host || null,
			linkScope: sourceHome && sourceHome.host === url.host ? "internal" : "external",
			skipReason: null,
			urlScheme: url.protocol.replace(/:$/, "") || null,
		};
	} catch {
		return {
			collectPolicy: "skip_scheme",
			errorMessage: "unsupported scheme",
			finalUrl: null,
			linkHost: null,
			linkScope: "unsupported",
			skipReason: "unsupported_scheme",
			urlScheme: explicitScheme,
		};
	}
}

function isAttachmentLike(input: {
	href: string;
	linkText: string | null;
	finalUrl: string | null;
}): boolean {
	const candidate = input.finalUrl ?? input.href;
	try {
		const parsed = new URL(candidate);
		const extension = path.posix.extname(parsed.pathname).toLowerCase();
		if (ATTACHMENT_FILE_EXTENSIONS.has(extension)) {
			return true;
		}
		if (parsed.pathname.toLowerCase().endsWith("/download") && parsed.searchParams.has("id")) {
			return true;
		}
	} catch {
		return false;
	}
	return /附件|下载/.test(`${input.linkText ?? ""}${candidate}`);
}

function deriveOriginalFilename(finalUrl: string, linkText: string | null): string | null {
	try {
		const parsed = new URL(finalUrl);
		const filename = safeDecodeURIComponent(path.posix.basename(parsed.pathname));
		const extension = path.posix.extname(filename).toLowerCase();
		if (filename && ATTACHMENT_FILE_EXTENSIONS.has(extension)) {
			return filename;
		}
		if (linkText) {
			return linkText;
		}
		if (filename) {
			return filename;
		}
	} catch {
		return linkText;
	}
	return linkText;
}

function extractUrlScheme(value: string): string | null {
	const match = value.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
	const scheme = match?.[1];
	return scheme ? scheme.toLowerCase() : null;
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function stripHtml(value: string): string {
	return value.replace(HTML_TAG_RE, " ").replace(WHITESPACE_RE, " ").trim();
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
	const text = normalizeNullableText(value);
	if (!text) {
		throw new Error(`${fieldName} is required`);
	}
	return text;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function normalizeNullableNumber(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

export function toTimestampLabel(value: string): string {
	return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}
