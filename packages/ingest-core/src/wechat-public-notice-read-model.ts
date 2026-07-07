import { buildDocumentArtifactKey } from "./artifacts.ts";
import { type ObjectStoreReader, sha256Hex } from "./core.ts";
import type { InternalNoticeReadModelEntry } from "./internal-notice-read-model.ts";
import type { NoticeConsumptionProjectionEntry } from "./notice-consumption-projection.ts";
import { extractBlockTexts, parseContentBlocks } from "./wechat-public-notice-source-truth.ts";
import {
	BODY_EXCERPT_MAX_CHARS,
	NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
	NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
	SEARCH_TEXT_MAX_CHARS,
	WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
	WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
	type WeChatCanonicalMarkdownArtifact,
	type WeChatPublicNoticeReadModelBuildResult,
} from "./wechat-public-notice-types.ts";
import {
	compareReadModelEntries,
	formatFrontMatterValue,
	normalizeNoticeTimestamp,
	stringArray,
	text,
	uniqueNonEmpty,
} from "./wechat-public-notice-utils.ts";

export async function buildWeChatPublicNoticeReadModelResult(input: {
	entries: readonly NoticeConsumptionProjectionEntry[];
	objectStore?: ObjectStoreReader;
	sourceBucket?: string;
}): Promise<WeChatPublicNoticeReadModelBuildResult> {
	const rows: InternalNoticeReadModelEntry[] = [];
	const canonicalMarkdownArtifacts: WeChatCanonicalMarkdownArtifact[] = [];
	for (const entry of input.entries) {
		const metadata = entry.role_metadata ?? {};
		const title =
			text(metadata.notice_title) ||
			text(metadata.title) ||
			text(metadata.title_normalized) ||
			entry.source_notice_id;
		const sourceUrl =
			text(metadata.source_url) ||
			text(metadata.normalized_article_url) ||
			text(metadata.article_url);
		let bodyExcerpt = buildReadModelBodyExcerpt({ metadata, title });
		let canonicalMarkdownObjectKey = "";
		if (text(metadata.body_state) === "captured" && input.objectStore) {
			const artifact = await buildCanonicalMarkdownArtifact({
				entry,
				metadata,
				objectStore: input.objectStore,
				sourceBucket: input.sourceBucket ?? "",
				title,
			});
			bodyExcerpt = artifact.bodyExcerpt;
			canonicalMarkdownObjectKey = artifact.objectKey;
			canonicalMarkdownArtifacts.push({
				contentType: "text/markdown; charset=utf-8",
				data: artifact.data,
				objectKey: artifact.objectKey,
			});
		}
		const publishedAt = text(metadata.publish_time) || text(entry.source_notice_release_time);
		rows.push({
			attachment_refs: entry.source_attachment_ref_ids,
			body_excerpt: bodyExcerpt,
			canonical_document_id:
				entry.source_notice_document_id || entry.source_document_id || entry.source_notice_id,
			canonical_markdown_object_key: canonicalMarkdownObjectKey,
			canonical_url: sourceUrl,
			consumption_status: entry.consumption_status,
			effective_at_ts: "",
			entitlement_groups: [],
			expires_at_ts: "",
			policy_projection_version: "public-notice-projection-v1",
			primary_role: entry.primary_role,
			projection_updated_at: entry.updated_at,
			provenance_refs: buildReadModelProvenanceRefs({
				canonicalDocumentId:
					entry.source_notice_document_id || entry.source_document_id || entry.source_notice_id,
				entry,
				metadata,
			}),
			published_at: publishedAt,
			published_at_ts: normalizeNoticeTimestamp(publishedAt),
			queryable: isWeChatReadModelQueryable(entry),
			search_text: buildReadModelSearchText({
				bodyExcerpt,
				entry,
				metadata,
				sourceUrl,
				title,
			}),
			source_collection: entry.source_collection,
			source_corpus: entry.source_corpus,
			source_family: entry.source_family,
			source_notice_id: entry.source_notice_id,
			source_url: sourceUrl,
			target_surface: entry.target_surface,
			title,
			unit_id: entry.unit_id,
			updated_at: entry.updated_at,
			visibility_level: "public",
		});
	}
	return {
		canonicalMarkdownArtifacts: canonicalMarkdownArtifacts.sort((left, right) =>
			left.objectKey.localeCompare(right.objectKey),
		),
		readModelEntries: rows.sort(compareReadModelEntries),
	};
}

async function buildCanonicalMarkdownArtifact(input: {
	entry: NoticeConsumptionProjectionEntry;
	metadata: Record<string, unknown>;
	objectStore: ObjectStoreReader;
	sourceBucket: string;
	title: string;
}): Promise<{ bodyExcerpt: string; data: Uint8Array; objectKey: string }> {
	const sourceBucket = text(input.metadata.source_bucket) || input.sourceBucket;
	if (!sourceBucket) {
		throw new Error("wechat read-model materialization requires source bucket");
	}
	const contentBlocksKey = text(input.metadata.content_blocks_key);
	if (!contentBlocksKey) {
		throw new Error("wechat read-model materialization requires content_blocks_key");
	}
	const contentBlocks = parseContentBlocks(
		await input.objectStore.getObject({ bucket: sourceBucket, key: contentBlocksKey }),
	);
	const body = extractBlockTexts(contentBlocks, "body_paragraph").join("\n\n").trim();
	const multimodalSummary = text(input.metadata.multimodal_summary);
	const multimodalExtractedText = text(input.metadata.multimodal_extracted_text);
	if (!(body || multimodalSummary || multimodalExtractedText)) {
		throw new Error("captured wechat article is missing body and multimodal text");
	}
	const canonicalDocumentId =
		input.entry.source_document_id ||
		input.entry.source_notice_document_id ||
		input.entry.source_notice_id;
	const objectKey = buildDocumentArtifactKey({
		collection: input.entry.source_collection,
		corpus: input.entry.source_corpus,
		documentId: canonicalDocumentId,
		filename: "canonical.md",
		revisionTrack: "source-faithful",
		title: input.title,
		versionId: canonicalVersionToken(input.metadata, input.entry.source_notice_id),
		year: text(input.metadata.publish_day),
	});
	const canonicalMarkdown = renderCanonicalMarkdown({
		body,
		metadata: input.metadata,
		multimodalExtractedText,
		multimodalSummary,
		title: input.title,
	});
	const excerptSource =
		multimodalExtractedText || multimodalSummary || body || text(input.metadata.summary_text);
	return {
		bodyExcerpt: excerptSource.trim().slice(0, BODY_EXCERPT_MAX_CHARS),
		data: new TextEncoder().encode(canonicalMarkdown),
		objectKey,
	};
}

function isWeChatReadModelQueryable(entry: NoticeConsumptionProjectionEntry): boolean {
	return (
		entry.consumption_status === NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY &&
		entry.target_surface === NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY &&
		text(entry.role_metadata?.body_state) === "captured"
	);
}

function buildReadModelBodyExcerpt(input: {
	metadata: Record<string, unknown>;
	title: string;
}): string {
	return (
		text(input.metadata.multimodal_extracted_text) ||
		text(input.metadata.multimodal_summary) ||
		text(input.metadata.body_excerpt) ||
		text(input.metadata.summary_text) ||
		text(input.metadata.title_normalized) ||
		text(input.metadata.title) ||
		text(input.metadata.notice_title) ||
		input.title
	).slice(0, BODY_EXCERPT_MAX_CHARS);
}

function buildReadModelProvenanceRefs(input: {
	canonicalDocumentId: string;
	entry: NoticeConsumptionProjectionEntry;
	metadata: Record<string, unknown>;
}): string[] {
	return uniqueNonEmpty([
		input.entry.source_notice_document_id,
		input.entry.source_document_id ?? "",
		input.canonicalDocumentId,
		text(input.metadata.manifest_key),
		text(input.metadata.content_blocks_key),
		text(input.metadata.media_refs_key),
		...stringArray(input.metadata.source_image_object_keys),
		...stringArray(input.metadata.ocr_manifest_keys),
		...stringArray(input.metadata.multimodal_child_document_ids),
		input.entry.unit_id,
	]);
}

function buildReadModelSearchText(input: {
	bodyExcerpt: string;
	entry: NoticeConsumptionProjectionEntry;
	metadata: Record<string, unknown>;
	sourceUrl: string;
	title: string;
}): string {
	return uniqueNonEmpty([
		input.title,
		input.entry.source_notice_id,
		input.entry.primary_role,
		input.entry.target_surface,
		input.sourceUrl,
		text(input.metadata.account_name),
		text(input.metadata.account_slug),
		text(input.metadata.provider_article_id),
		text(input.metadata.multimodal_summary),
		text(input.metadata.multimodal_extracted_text),
		input.bodyExcerpt,
	])
		.join("\n")
		.slice(0, SEARCH_TEXT_MAX_CHARS);
}

function canonicalVersionToken(metadata: Record<string, unknown>, sourceNoticeId: string): string {
	const fingerprint = [
		text(metadata.metadata_hash) || sourceNoticeId,
		text(metadata.multimodal_summary),
		text(metadata.multimodal_extracted_text),
		text(metadata.ocr_status),
	].join("\n");
	return `sha256:${sha256Hex(fingerprint)}`;
}

function renderCanonicalMarkdown(input: {
	body: string;
	metadata: Record<string, unknown>;
	multimodalExtractedText: string;
	multimodalSummary: string;
	title: string;
}): string {
	const frontMatter: Record<string, string> = {
		account_name: text(input.metadata.account_name),
		account_slug: text(input.metadata.account_slug),
		body_state: text(input.metadata.body_state),
		provider: text(input.metadata.provider),
		provider_article_id: text(input.metadata.provider_article_id),
		published_at: text(input.metadata.publish_time),
		source_channel: WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
		source_family: WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
		source_url: text(input.metadata.source_url),
	};
	const lines = ["---"];
	for (const [key, value] of Object.entries(frontMatter)) {
		if (!value) {
			continue;
		}
		lines.push(`${key}: ${formatFrontMatterValue(value)}`);
	}
	lines.push("---", "", `# ${input.title}`, "");
	if (input.body.trim()) {
		lines.push(input.body.trim());
	}
	if (input.multimodalSummary) {
		lines.push("", "## OCR Summary", "", input.multimodalSummary);
	}
	if (input.multimodalExtractedText) {
		lines.push("", "## OCR Extracted Text", "", input.multimodalExtractedText);
	}
	lines.push("");
	return lines.join("\n");
}
