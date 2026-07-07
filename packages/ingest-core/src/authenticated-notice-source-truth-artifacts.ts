import { load } from "cheerio";

import { parseOptionalText, parseRecord } from "./core.ts";

const BLOCK_SCHEMA = "authenticated_notice_block_v1";
const ATTACHMENT_REF_SCHEMA = "authenticated_notice_attachment_ref_v1";
const SOURCE_TRUTH_MANIFEST_SUFFIX = "/source-truth/notice-manifest.json";
const ATTACHMENT_REFERENCE_KEYWORDS = ["附件：", "附件:", "见附件", "详见附件", "参见附件"];
const FILE_RELEASE_REFERENCE_KEYWORDS = [
	"信息门户-文件发布",
	"文件发布",
	"自行下载",
	"下载参照执行",
	"下载后参照执行",
];
const WRAPPER_NOTICE_PREFIXES = ["关于发布", "关于印发", "关于修订", "关于转发", "关于公布"];
const WRAPPER_NOTICE_KEYWORDS = ["通知", "现将", "予以发布", "予以印发", "请遵照执行", "转发"];
const QUOTE_TITLE_PATTERN = /《([^》]{2,200})》/u;

export function buildAuthenticatedNoticeSourceRootKeyFromManifestKey(manifestKey: string): string {
	if (!manifestKey.endsWith(SOURCE_TRUTH_MANIFEST_SUFFIX)) {
		throw new Error(
			"authenticated notice manifest key must end with source-truth/notice-manifest.json",
		);
	}
	return manifestKey.slice(0, -SOURCE_TRUTH_MANIFEST_SUFFIX.length);
}

export function buildAuthenticatedNoticeContentBlocks(input: {
	bundleRecord: Record<string, unknown>;
	html: string;
	rawAssetId: string;
	rawVersionId: string;
	title: string;
}): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const append = (
		role: string,
		text: string,
		headingLevel: number | null = null,
		linkTarget: string | null = null,
		linkText: string | null = null,
	): void => {
		const normalized = normalizeText(text);
		if (!normalized) {
			return;
		}
		rows.push({
			schema_version: BLOCK_SCHEMA,
			raw_asset_id: input.rawAssetId,
			raw_version_id: input.rawVersionId,
			row_id: `block-${String(rows.length + 1).padStart(4, "0")}`,
			row_index: rows.length,
			block_order: rows.length + 1,
			block_role: role,
			heading_level: headingLevel,
			parent_heading_path: [],
			list_level: null,
			table_id: null,
			table_row_index: null,
			table_col_index: null,
			text_raw: text.trim(),
			text_normalized: normalized,
			html_fragment: null,
			link_target: linkTarget,
			link_text: linkText,
			table_html: null,
			table_cells: null,
		});
	};

	append("title", input.title, 1);
	for (const block of htmlTextBlocks(input.html)) {
		if (normalizeText(block.text) === normalizeText(input.title)) {
			continue;
		}
		append(block.role, block.text, block.headingLevel);
	}
	for (const link of arrayOrEmpty(input.bundleRecord.links).filter(isRecord)) {
		const linkTarget = parseOptionalText(link.final_url) ?? parseOptionalText(link.url);
		const linkText = parseOptionalText(link.link_text) ?? linkTarget;
		if (!(linkTarget && linkText)) {
			continue;
		}
		append("link", linkText, null, linkTarget, linkText);
	}
	return rows;
}

export function buildAuthenticatedNoticeAttachmentRefs(input: {
	bundleRecord: Record<string, unknown>;
	noticeId: string;
	rawAssetId: string;
	rawVersionId: string;
}): Record<string, unknown>[] {
	const rows = joinedAttachments(input.bundleRecord).map(([attachment, relation], index) => {
		const terminalOutcome = terminalFetchOutcome(attachment);
		return {
			schema_version: ATTACHMENT_REF_SCHEMA,
			raw_asset_id: input.rawAssetId,
			raw_version_id: input.rawVersionId,
			attachment_ref_id: `attachment-${String(index + 1).padStart(4, "0")}`,
			ref_order: index + 1,
			notice_id: input.noticeId,
			relation_source: relation.relation_source ?? null,
			resource_role: relation.resource_role ?? null,
			content_kind: contentKindForRelation(input.bundleRecord, relation),
			anchor_text: parseOptionalText(relation.anchor_text),
			original_filename: parseOptionalText(attachment.original_filename),
			source_url: parseOptionalText(attachment.source_url),
			normalized_source_url: parseOptionalText(attachment.normalized_source_url),
			final_url: parseOptionalText(attachment.final_url),
			origin_scope: parseOptionalText(attachment.origin_scope),
			object_key: parseOptionalText(attachment.object_key),
			content_sha256: parseOptionalText(attachment.sha256),
			mime_type: parseOptionalText(attachment.mime_type),
			byte_size: attachment.byte_size ?? null,
			storage_provider: parseOptionalText(attachment.storage_provider),
			ingest_status: parseOptionalText(attachment.ingest_status),
			last_http_status: attachment.last_http_status ?? null,
			terminal_reason: terminalOutcome.terminalReason,
			last_error_class: terminalOutcome.lastErrorClass,
		};
	});

	const seenUrls = new Set<string>();
	for (const row of rows) {
		for (const url of [row.source_url, row.normalized_source_url, row.final_url]) {
			if (typeof url === "string") {
				for (const key of inlineImageUrlDedupeKeys(url)) {
					seenUrls.add(key);
				}
			}
		}
	}

	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	for (const inlineImage of htmlInlineImageRefs(String(notice.notice_content ?? ""))) {
		const imageKeys = new Set([
			...inlineImageUrlDedupeKeys(inlineImage.sourceUrl),
			...inlineImageUrlDedupeKeys(inlineImage.normalizedSourceUrl),
		]);
		if ([...imageKeys].some((key) => seenUrls.has(key))) {
			continue;
		}
		rows.push({
			schema_version: ATTACHMENT_REF_SCHEMA,
			raw_asset_id: input.rawAssetId,
			raw_version_id: input.rawVersionId,
			attachment_ref_id: `attachment-${String(rows.length + 1).padStart(4, "0")}`,
			ref_order: rows.length + 1,
			notice_id: input.noticeId,
			relation_source: "notice_html_inline_img",
			resource_role: "inline_image",
			content_kind: "inline_image",
			anchor_text: inlineImage.anchorText,
			original_filename: inlineImage.originalFilename,
			source_url: inlineImage.sourceUrl,
			normalized_source_url: inlineImage.normalizedSourceUrl,
			final_url: inlineImage.normalizedSourceUrl,
			origin_scope: "internal",
			object_key: null,
			content_sha256: null,
			mime_type: mimeTypeForFilename(inlineImage.originalFilename),
			byte_size: null,
			storage_provider: null,
			ingest_status: "reference_only",
			last_http_status: null,
			terminal_reason: null,
			last_error_class: null,
		});
		for (const key of imageKeys) {
			seenUrls.add(key);
		}
	}
	return rows;
}

export function buildAuthenticatedNoticeCaptureArtifacts(input: {
	bundleRecord: Record<string, unknown>;
	exportManifest: Record<string, unknown>;
}): {
	detailResponse: Record<string, unknown>;
	fetchMetadata: Record<string, unknown>;
	listResponse: Record<string, unknown>;
} {
	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	return {
		listResponse: {
			notice_id: notice.notice_id ?? input.bundleRecord.notice_id,
			notice_title: notice.notice_title ?? null,
			organization_name: notice.organization_name ?? null,
			organization_id: notice.organization_id ?? null,
			notice_release_time: notice.notice_release_time ?? null,
			notice_create_time: notice.notice_create_time ?? null,
			notice_first_time: notice.notice_first_time ?? null,
			notice_link: notice.notice_link ?? null,
			notice_source: notice.notice_source ?? null,
			notice_link_state: notice.notice_link_state ?? null,
			notice_state: notice.notice_state ?? null,
			notice_stick: notice.notice_stick ?? null,
			categories: arrayOrEmpty(notice.categories).filter(isRecord),
		},
		detailResponse: {
			notice,
			links: arrayOrEmpty(input.bundleRecord.links).filter(isRecord),
			notice_attachments: arrayOrEmpty(input.bundleRecord.notice_attachments).filter(isRecord),
			attachments: arrayOrEmpty(input.bundleRecord.attachments).filter(isRecord),
		},
		fetchMetadata: {
			schema_version: "authenticated_notice_fetch_metadata_v1",
			captured_at: parseOptionalText(input.exportManifest.exported_at) ?? null,
			export_manifest: input.exportManifest,
		},
	};
}

export function buildAuthenticatedNoticeProviderArtifacts(input: {
	bundleRecord: Record<string, unknown>;
	categoryPairs: readonly [string, string][];
	notice: Record<string, unknown>;
}): {
	attachmentObservations: Record<string, unknown>[];
	discoveredLinks: Record<string, unknown>[];
	normalizedNotice: Record<string, unknown>;
} {
	return {
		normalizedNotice: {
			schema_version: "authenticated_notice_normalized_notice_v1",
			notice_id: input.notice.notice_id ?? input.bundleRecord.notice_id,
			notice_title: input.notice.notice_title ?? null,
			organization_name: input.notice.organization_name ?? null,
			organization_id: input.notice.organization_id ?? null,
			notice_release_time: input.notice.notice_release_time ?? null,
			notice_create_time: input.notice.notice_create_time ?? null,
			notice_first_time: input.notice.notice_first_time ?? null,
			notice_link: input.notice.notice_link ?? null,
			notice_source: input.notice.notice_source ?? null,
			notice_link_state: input.notice.notice_link_state ?? null,
			notice_state: input.notice.notice_state ?? null,
			notice_stick: input.notice.notice_stick ?? null,
			notice_type_ids: input.categoryPairs.map(([id]) => id),
			notice_type_names: input.categoryPairs.map(([, name]) => name),
			notice_content_html: input.notice.notice_content ?? null,
		},
		discoveredLinks: arrayOrEmpty(input.bundleRecord.links).filter(isRecord),
		attachmentObservations: joinedAttachments(input.bundleRecord).map(([attachment, relation]) => ({
			attachment_id: attachment.attachment_id ?? null,
			link_id: relation.link_id ?? null,
			source_url: attachment.source_url ?? null,
			normalized_source_url: attachment.normalized_source_url ?? null,
			final_url: attachment.final_url ?? null,
			resource_role: relation.resource_role ?? null,
			relation_source: relation.relation_source ?? null,
			anchor_text: relation.anchor_text ?? null,
			object_key: attachment.object_key ?? null,
			content_sha256: attachment.sha256 ?? null,
			mime_type: attachment.mime_type ?? null,
			byte_size: attachment.byte_size ?? null,
			origin_scope: attachment.origin_scope ?? null,
			provenance_status: attachment.provenance_status ?? null,
		})),
	};
}

export function buildAuthenticatedNoticeCanonicalDocumentArtifacts(input: {
	contentBlocks: readonly Record<string, unknown>[];
	documentId: string;
	sourceUri: string;
	title: string;
	versionId: string;
}): { canonicalMarkdown: string; documentUnits: Record<string, unknown>[] } {
	const markdownLines = [`# ${input.title}`];
	const documentUnits: Record<string, unknown>[] = [];
	for (const block of input.contentBlocks) {
		const role = String(block.block_role ?? "paragraph");
		const text = String(block.text_normalized ?? "").trim();
		if (!text) {
			continue;
		}
		if (role !== "title") {
			markdownLines.push(markdownLineForBlock(role, text, block));
		}
		const rowId = String(block.row_id ?? "");
		documentUnits.push({
			doc_id: input.documentId,
			version_id: input.versionId,
			chunk_id: rowId,
			root_unit_id: rowId,
			unit_type: unitTypeForBlock(role),
			text,
			raw_text: String(block.text_raw ?? text),
			clean_text: text,
			anchor: {
				block_order: block.block_order ?? null,
				block_role: role,
				parent_heading_path: block.parent_heading_path ?? [],
				source_uri: input.sourceUri,
				link_target: block.link_target ?? null,
			},
			metadata: {
				block_role: role,
				heading_level: block.heading_level ?? null,
				link_target: block.link_target ?? null,
				link_text: block.link_text ?? null,
			},
		});
	}
	return {
		canonicalMarkdown: `${markdownLines.filter(Boolean).join("\n\n").trim()}\n`,
		documentUnits,
	};
}

export function buildAuthenticatedNoticeOwnerExpectations(input: {
	attachmentRefs: readonly Record<string, unknown>[];
	contentBlocks: readonly Record<string, unknown>[];
	title: string;
}): Record<string, unknown>[] {
	if (input.attachmentRefs.length > 0) {
		return [];
	}
	const titleHint = extractQuotedTitle(input.title);
	const bodyLines = bodyLinesForOwnerExpectations(input.contentBlocks);
	const wrapperLike = looksLikeWrapperNotice({
		body: bodyLines.join("\n"),
		title: input.title,
	});
	const rows: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	const appendExpectation = (expectation: {
		evidenceReason: string;
		evidenceText: string;
		ownerKind: string;
		ownerTitleHint: string | null;
		relationType: string;
	}): void => {
		const normalizedTitleHint = parseOptionalText(expectation.ownerTitleHint) ?? "";
		const normalizedEvidenceText = parseOptionalText(expectation.evidenceText) ?? "";
		const key = [
			expectation.ownerKind,
			expectation.relationType,
			normalizedTitleHint,
			normalizedEvidenceText,
		].join("\u0000");
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		rows.push({
			owner_expectation_id: `owner-expectation-${String(rows.length + 1).padStart(4, "0")}`,
			owner_kind: expectation.ownerKind,
			relation_type: expectation.relationType,
			evidence_reason: expectation.evidenceReason,
			owner_title_hint: normalizedTitleHint || null,
			evidence_text: normalizedEvidenceText,
		});
	};

	for (const line of bodyLines) {
		if (looksLikeAttachmentOwnerSignal(line)) {
			appendExpectation({
				ownerKind: "attachment_document",
				relationType: "attachment_ref",
				evidenceReason: "attachment_anchor_detected",
				ownerTitleHint: extractOwnerTitleHint(line) ?? titleHint,
				evidenceText: line,
			});
			continue;
		}
		if (looksLikeFileReleaseReference(line) && (wrapperLike || titleHint)) {
			appendExpectation({
				ownerKind: "file_release_document",
				relationType: "file_release_ref",
				evidenceReason: "file_release_reference_detected",
				ownerTitleHint: extractOwnerTitleHint(line) ?? titleHint,
				evidenceText: line,
			});
		}
	}
	return rows;
}

export function buildAuthenticatedNoticeAttachmentIdentity(
	bundleRecord: Record<string, unknown>,
): unknown[] {
	return joinedAttachments(bundleRecord)
		.map(([attachment, relation]) => [
			parseOptionalText(attachment.normalized_source_url) ??
				parseOptionalText(attachment.source_url) ??
				"",
			parseOptionalText(relation.resource_role) ?? "",
			parseOptionalText(attachment.sha256) ?? "",
		])
		.sort();
}

function markdownLineForBlock(role: string, text: string, block: Record<string, unknown>): string {
	if (role === "heading") {
		const level =
			typeof block.heading_level === "number" && block.heading_level >= 2 ? block.heading_level : 2;
		return `${"#".repeat(Math.max(level, 2))} ${text}`;
	}
	if (role === "list_item") {
		return `- ${text}`;
	}
	if (role === "link") {
		const target = parseOptionalText(block.link_target);
		return target ? `- [${text}](${target})` : `- ${text}`;
	}
	return text;
}

function unitTypeForBlock(role: string): string {
	if (role === "title" || role === "heading") {
		return "heading";
	}
	if (role === "list_item") {
		return "list_item";
	}
	if (role === "table") {
		return "table";
	}
	if (role === "link") {
		return "link";
	}
	return "paragraph";
}

function htmlTextBlocks(
	html: string,
): { headingLevel: number | null; role: string; text: string }[] {
	const rows: { headingLevel: number | null; role: string; text: string }[] = [];
	const $ = load(html);
	$("h1,h2,h3,h4,h5,h6,p,li").each((_index, element) => {
		const tag = element.tagName.toLowerCase();
		const text = normalizeText($(element).text());
		if (!text) {
			return;
		}
		rows.push({
			headingLevel: tag.startsWith("h") ? Number.parseInt(tag.slice(1), 10) : null,
			role: tag.startsWith("h") ? "heading" : tag === "li" ? "list_item" : "paragraph",
			text,
		});
	});
	if (rows.length === 0) {
		const text = normalizeText($.root().text());
		if (text) {
			rows.push({ headingLevel: null, role: "paragraph", text });
		}
	}
	return rows;
}

function normalizeText(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function contentKindForRelation(
	bundleRecord: Record<string, unknown>,
	relation: Record<string, unknown>,
): string | null {
	const linkId = relation.link_id;
	if (linkId === undefined || linkId === null) {
		return null;
	}
	for (const link of arrayOrEmpty(bundleRecord.links).filter(isRecord)) {
		if (link.id === linkId) {
			return parseOptionalText(link.content_kind);
		}
	}
	return null;
}

function terminalFetchOutcome(attachment: Record<string, unknown>): {
	lastErrorClass: string | null;
	terminalReason: string | null;
} {
	const terminalReason = parseOptionalText(attachment.terminal_reason);
	const lastErrorClass = parseOptionalText(attachment.last_error_class);
	if (terminalReason === "http_404" || terminalReason === "http_410") {
		return { lastErrorClass: "terminal_unavailable", terminalReason };
	}
	const lastError = parseOptionalText(attachment.last_error);
	for (const [status, reason] of [
		[404, "http_404"],
		[410, "http_410"],
	] as const) {
		if (
			lastError === `terminal_unavailable:${reason}` ||
			textMentionsHttpStatus(lastError, status)
		) {
			return { lastErrorClass: "terminal_unavailable", terminalReason: reason };
		}
	}
	if (
		parseOptionalText(attachment.provenance_status) === "terminal_unavailable" ||
		parseOptionalText(attachment.ingest_status) === "terminal_unavailable"
	) {
		return { lastErrorClass: "terminal_unavailable", terminalReason: "portal_file_missing" };
	}
	if (lastErrorClass === "transient_failed" || isRetryableAttachmentError(lastError)) {
		return { lastErrorClass: "transient_failed", terminalReason: null };
	}
	return { lastErrorClass: null, terminalReason: null };
}

function joinedAttachments(
	bundleRecord: Record<string, unknown>,
): [Record<string, unknown>, Record<string, unknown>][] {
	const attachmentsById = new Map<unknown, Record<string, unknown>>();
	for (const attachment of arrayOrEmpty(bundleRecord.attachments).filter(isRecord)) {
		attachmentsById.set(attachment.attachment_id, attachment);
	}
	const rows: [Record<string, unknown>, Record<string, unknown>][] = [];
	for (const relation of arrayOrEmpty(bundleRecord.notice_attachments).filter(isRecord)) {
		const attachment = attachmentsById.get(relation.attachment_id);
		if (attachment) {
			rows.push([attachment, relation]);
		}
	}
	return rows;
}

function htmlInlineImageRefs(html: string): {
	anchorText: string;
	normalizedSourceUrl: string;
	originalFilename: string;
	sourceUrl: string;
}[] {
	const refs: {
		anchorText: string;
		normalizedSourceUrl: string;
		originalFilename: string;
		sourceUrl: string;
	}[] = [];
	const seen = new Set<string>();
	const $ = load(html);
	$("img").each((_index, element) => {
		const sourceUrl = parseOptionalText($(element).attr("src"));
		if (!sourceUrl || seen.has(sourceUrl)) {
			return;
		}
		const normalizedSourceUrl = normalizeInlineImageUrl(sourceUrl);
		const anchorText =
			parseOptionalText($(element).attr("title")) ??
			parseOptionalText($(element).attr("alt")) ??
			filenameFromUrl(sourceUrl);
		refs.push({
			anchorText,
			normalizedSourceUrl,
			originalFilename: filenameFromUrl(sourceUrl, anchorText),
			sourceUrl,
		});
		seen.add(sourceUrl);
	});
	return refs;
}

function inlineImageUrlDedupeKeys(value: string): string[] {
	const normalized = normalizeInlineImageUrl(value);
	const parsed = parseAbsoluteUrl(normalized);
	if (!(parsed?.protocol && parsed.host)) {
		return [normalized];
	}
	const host = parsed.host.endsWith(":80") ? parsed.host.slice(0, -3) : parsed.host;
	const schemeAgnostic = `${parsed.pathname}${parsed.search}${parsed.hash}`;
	return [...new Set([normalized, `//${host}${schemeAgnostic}`, schemeAgnostic])];
}

function normalizeInlineImageUrl(value: string): string {
	const normalized = value.trim();
	const parsed = parseAbsoluteUrl(normalized);
	if (!(parsed?.protocol && parsed.host)) {
		return normalized;
	}
	const protocol = parsed.protocol === "http:" ? "https:" : parsed.protocol;
	const host = parsed.host.endsWith(":80") ? parsed.host.slice(0, -3) : parsed.host;
	return `${protocol}//${host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function filenameFromUrl(value: string, preferredText?: string): string {
	const parsed = parseAbsoluteUrl(value);
	const pathname = parsed?.pathname ?? value;
	const candidate =
		parseOptionalText(preferredText) ?? safeDecodeURIComponent(pathname).split("/").pop();
	const filename = String(candidate ?? "inline-image")
		.trim()
		.split("/")
		.pop()
		?.trim();
	return filename || "inline-image";
}

function mimeTypeForFilename(filename: string): string | null {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".png")) {
		return "image/png";
	}
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lower.endsWith(".gif")) {
		return "image/gif";
	}
	if (lower.endsWith(".webp")) {
		return "image/webp";
	}
	return null;
}

function bodyLinesForOwnerExpectations(
	contentBlocks: readonly Record<string, unknown>[],
): string[] {
	const lines: string[] = [];
	for (const block of contentBlocks) {
		if (String(block.block_role ?? "") === "title") {
			continue;
		}
		const text = parseOptionalText(block.text_raw) ?? parseOptionalText(block.text_normalized);
		if (!text) {
			continue;
		}
		for (const line of text.split(/\r?\n/u)) {
			const normalizedLine = parseOptionalText(line);
			if (normalizedLine) {
				lines.push(normalizedLine);
			}
		}
	}
	return lines;
}

function looksLikeAttachmentOwnerSignal(line: string): boolean {
	const stripped = line.trim();
	return (
		stripped.includes("附件") &&
		(stripped.startsWith("附件") ||
			ATTACHMENT_REFERENCE_KEYWORDS.some((keyword) => stripped.includes(keyword)))
	);
}

function looksLikeFileReleaseReference(line: string): boolean {
	const stripped = line.trim();
	return (
		stripped.length > 0 &&
		FILE_RELEASE_REFERENCE_KEYWORDS.some((keyword) => stripped.includes(keyword))
	);
}

function looksLikeWrapperNotice(input: { body: string; title: string }): boolean {
	const combined = [input.title, input.body].filter(Boolean).join("\n");
	return (
		WRAPPER_NOTICE_PREFIXES.some((prefix) => input.title.startsWith(prefix)) ||
		WRAPPER_NOTICE_KEYWORDS.some((keyword) => combined.includes(keyword))
	);
}

function extractOwnerTitleHint(value: string): string | null {
	const quotedTitle = extractQuotedTitle(value);
	if (quotedTitle) {
		return quotedTitle;
	}
	const stripped = value.trim();
	if (!stripped.startsWith("附件")) {
		return null;
	}
	const remainder = stripped
		.replace(/^附件\s*\d*\s*[:：]?\s*/u, "")
		.replace(/[：:。；;，,\s]+$/u, "")
		.trim();
	return parseOptionalText(remainder);
}

function extractQuotedTitle(value: string | null | undefined): string | null {
	const text = parseOptionalText(value);
	if (!text) {
		return null;
	}
	return parseOptionalText(QUOTE_TITLE_PATTERN.exec(text)?.[1]);
}

function textMentionsHttpStatus(value: string | null, status: number): boolean {
	if (!value) {
		return false;
	}
	return (
		value.includes(` ${status}`) ||
		value.includes(`:${status}`) ||
		value.includes(`_${status}`) ||
		value.trim().endsWith(String(status))
	);
}

function isRetryableAttachmentError(value: string | null): boolean {
	const normalized = String(value ?? "").toLowerCase();
	if (!normalized || normalized.startsWith("default_inline_visual_capture_skipped:")) {
		return false;
	}
	return ["timeout", "timed out", "econn", "enotfound", "socket", "network", "fetch failed"].some(
		(token) => normalized.includes(token),
	);
}

function parseAbsoluteUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function arrayOrEmpty(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
