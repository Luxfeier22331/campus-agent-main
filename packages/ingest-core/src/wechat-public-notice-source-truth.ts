import { z } from "zod";

import type { ObjectStoreReader } from "./core.ts";
import {
	type InlineImageOutcome,
	type InlineImageRef,
	WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
	type WeChatArticleSourceTruth,
	type WeChatSourceTruthArtifactRefs,
} from "./wechat-public-notice-types.ts";
import {
	buildInlineImageArtifactKeys,
	ensureForbiddenFieldsAbsent,
	loadOptionalJsonObject,
	normalizeRequiredRefValue,
	parseJsonLines,
	parseJsonObject,
	parseWithSchema,
	text,
	toPublishDay,
} from "./wechat-public-notice-utils.ts";

const ArticleManifestSchema = z.object({
	accountName: z.string().trim().min(1),
	accountSlug: z.string().trim().min(1),
	articleStableId: z.string().trim().min(1),
	articleUrl: z.string().trim().default(""),
	blockCount: z.number().int().nonnegative().nullable().optional(),
	bodyState: z.enum(["captured", "fetch_failed", "not_captured"]),
	coverImageUrl: z.string().trim().default(""),
	mediaRefCount: z.number().int().nonnegative().nullable().optional(),
	metadataHash: z.string().trim().min(1),
	normalizedArticleUrl: z.string().trim().default(""),
	provider: z.string().trim().min(1),
	providerArticleId: z.string().trim().default(""),
	publishTime: z.string().trim().default(""),
	publishTimeSource: z.string().trim().default(""),
	rawAssetId: z.string().trim().min(1),
	rawVersionId: z.string().trim().min(1),
	sourceChannel: z.literal(WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL),
	titleNormalized: z.string().trim().min(1),
	titleRaw: z.string().trim().min(1),
});

const ContentBlockSchema = z.object({
	blockRole: z.string().trim(),
	textNormalized: z.string().trim().nullable().optional(),
	textRaw: z.string().trim().nullable().optional(),
});

const MediaRefSchema = z.object({
	byteSize: z.number().int().nonnegative().nullable().optional(),
	captureStatus: z.string().trim().default(""),
	capturedAt: z.string().trim().default(""),
	contentSha256: z.string().trim().nullable().optional(),
	fetchErrorMessage: z.string().trim().nullable().optional(),
	finalUrl: z.string().trim().nullable().optional(),
	mediaRefId: z.string().trim().min(1),
	mimeType: z.string().trim().nullable().optional(),
	normalizedSourceUrl: z.string().trim().min(1),
	objectKey: z.string().trim().nullable().optional(),
	refOrder: z.number().int().nonnegative().default(0),
	resourceRole: z.string().trim(),
	sourceUrl: z.string().trim().min(1),
});

export async function loadWeChatArticleSourceTruth(input: {
	defaultBucket: string;
	objectStore: ObjectStoreReader;
	refs: WeChatSourceTruthArtifactRefs;
}): Promise<WeChatArticleSourceTruth> {
	const bucket = normalizeRequiredRefValue(
		input.refs.bucket ?? input.defaultBucket,
		"source-truth artifact bucket",
	);
	const articleManifestKey = normalizeRequiredRefValue(
		input.refs.articleManifestKey,
		"articleManifestKey",
	);
	const contentBlocksKey = normalizeRequiredRefValue(
		input.refs.contentBlocksKey,
		"contentBlocksKey",
	);
	const mediaRefsKey = normalizeRequiredRefValue(input.refs.mediaRefsKey, "mediaRefsKey");
	const manifest = parseJsonObject(
		await input.objectStore.getObject({ bucket, key: articleManifestKey }),
		"article manifest",
	);
	const contentBlocks = parseJsonLines(
		await input.objectStore.getObject({ bucket, key: contentBlocksKey }),
		"content blocks",
	);
	const mediaRefs = parseJsonLines(
		await input.objectStore.getObject({ bucket, key: mediaRefsKey }),
		"media refs",
	);
	ensureForbiddenFieldsAbsent([manifest, contentBlocks, mediaRefs]);
	const parsedManifest = parseWithSchema(ArticleManifestSchema, manifest, "article manifest");
	if (!(parsedManifest.normalizedArticleUrl || parsedManifest.providerArticleId)) {
		throw new Error("wechat source truth requires normalizedArticleUrl or providerArticleId");
	}
	const parsedContentBlocks = contentBlocks.map((row) =>
		parseWithSchema(ContentBlockSchema, row, "content block"),
	);
	const parsedMediaRefs = mediaRefs.map((row) => parseWithSchema(MediaRefSchema, row, "media ref"));
	assertCountMatches(parsedManifest.blockCount, parsedContentBlocks.length, "blockCount");
	assertCountMatches(parsedManifest.mediaRefCount, parsedMediaRefs.length, "mediaRefCount");
	const inlineImageRefs = parsedMediaRefs
		.filter((row) => row.resourceRole === "inline_image")
		.map(rowToInlineImageRef)
		.sort(
			(left, right) =>
				left.refOrder - right.refOrder || left.mediaRefId.localeCompare(right.mediaRefId),
		);
	const inlineImageOutcomes = await Promise.all(
		inlineImageRefs.map((inlineRef) =>
			loadInlineImageOutcome({
				bucket,
				inlineRef,
				mediaRefsKey,
				objectStore: input.objectStore,
			}),
		),
	);
	return {
		accountName: parsedManifest.accountName,
		accountSlug: parsedManifest.accountSlug,
		articleStableId: parsedManifest.articleStableId,
		articleUrl: parsedManifest.articleUrl,
		bodyParagraphs: extractBlockTexts(parsedContentBlocks, "body_paragraph"),
		bodyState: parsedManifest.bodyState,
		bucket,
		contentBlockCount: parsedContentBlocks.length,
		contentBlocksKey,
		coverImageUrl: parsedManifest.coverImageUrl,
		inlineImageCount: inlineImageRefs.length,
		inlineImageOutcomes,
		inlineImageRefs,
		manifestKey: articleManifestKey,
		mediaRefCount: parsedMediaRefs.length,
		mediaRefsKey,
		metadataHash: parsedManifest.metadataHash,
		normalizedArticleUrl: parsedManifest.normalizedArticleUrl,
		provider: parsedManifest.provider,
		providerArticleId: parsedManifest.providerArticleId,
		publishDay: toPublishDay(parsedManifest.publishTime),
		publishTime: parsedManifest.publishTime,
		publishTimeSource: parsedManifest.publishTimeSource,
		rawAssetId: parsedManifest.rawAssetId,
		rawVersionId: parsedManifest.rawVersionId,
		summaryText: extractBlockTexts(parsedContentBlocks, "summary")[0] ?? "",
		titleNormalized: parsedManifest.titleNormalized,
		titleRaw: parsedManifest.titleRaw,
	};
}

export function extractBlockTexts(
	contentBlocks: readonly z.infer<typeof ContentBlockSchema>[],
	blockRole: string,
): string[] {
	return contentBlocks
		.filter((row) => row.blockRole === blockRole)
		.map((row) => text(row.textRaw) || text(row.textNormalized))
		.filter(Boolean);
}

export function parseContentBlocks(value: Uint8Array): z.infer<typeof ContentBlockSchema>[] {
	return parseJsonLines(value, "content blocks").map((row) =>
		parseWithSchema(ContentBlockSchema, row, "content block"),
	);
}

async function loadInlineImageOutcome(input: {
	bucket: string;
	inlineRef: InlineImageRef;
	mediaRefsKey: string;
	objectStore: ObjectStoreReader;
}): Promise<InlineImageOutcome> {
	const ocrManifestKey = buildInlineImageArtifactKeys({
		mediaRefId: input.inlineRef.mediaRefId,
		mediaRefsKey: input.mediaRefsKey,
	}).ocrManifestKey;
	const ocrPayload = await loadOptionalJsonObject({
		bucket: input.bucket,
		key: ocrManifestKey,
		objectStore: input.objectStore,
	});
	if (ocrPayload) {
		return {
			childDocumentId: text(ocrPayload.child_document_id),
			error: text(ocrPayload.error),
			extractedText: text(ocrPayload.extracted_text),
			imageObjectKey: text(ocrPayload.image_object_key) || input.inlineRef.objectKey,
			mediaRefId: input.inlineRef.mediaRefId,
			model: text(ocrPayload.model),
			normalizedSourceUrl: input.inlineRef.normalizedSourceUrl,
			ocrManifestKey,
			provider: text(ocrPayload.provider),
			sourceUrl: input.inlineRef.sourceUrl,
			status: coerceOutcomeStatus(ocrPayload.status),
			summary: text(ocrPayload.summary),
		};
	}
	if (input.inlineRef.captureStatus === "fetch_failed" || !input.inlineRef.objectKey) {
		return buildTerminalInlineImageOutcome(input.inlineRef, ocrManifestKey);
	}
	return {
		childDocumentId: "",
		error: "",
		extractedText: "",
		imageObjectKey: input.inlineRef.objectKey,
		mediaRefId: input.inlineRef.mediaRefId,
		model: "",
		normalizedSourceUrl: input.inlineRef.normalizedSourceUrl,
		ocrManifestKey,
		provider: "",
		sourceUrl: input.inlineRef.sourceUrl,
		status: "pending",
		summary: "",
	};
}

function rowToInlineImageRef(row: z.infer<typeof MediaRefSchema>): InlineImageRef {
	return {
		byteSize: row.byteSize ?? 0,
		captureStatus: row.captureStatus,
		capturedAt: row.capturedAt,
		contentSha256: row.contentSha256 ?? "",
		fetchErrorMessage: row.fetchErrorMessage ?? "",
		finalUrl: row.finalUrl ?? "",
		mediaRefId: row.mediaRefId,
		mimeType: row.mimeType ?? "",
		normalizedSourceUrl: row.normalizedSourceUrl,
		objectKey: row.objectKey ?? "",
		refOrder: row.refOrder,
		sourceUrl: row.sourceUrl,
	};
}

function assertCountMatches(
	expected: number | null | undefined,
	actual: number,
	fieldName: string,
): void {
	if (expected !== null && expected !== undefined && expected !== actual) {
		throw new Error(`wechat source truth ${fieldName} does not match source rows`);
	}
}

function buildTerminalInlineImageOutcome(
	inlineRef: InlineImageRef,
	ocrManifestKey: string,
): InlineImageOutcome {
	return {
		childDocumentId: "",
		error: inlineRef.fetchErrorMessage || "missing source image object",
		extractedText: "",
		imageObjectKey: inlineRef.objectKey,
		mediaRefId: inlineRef.mediaRefId,
		model: "",
		normalizedSourceUrl: inlineRef.normalizedSourceUrl,
		ocrManifestKey,
		provider: "",
		sourceUrl: inlineRef.sourceUrl,
		status: "fetch_failed",
		summary: "",
	};
}

function coerceOutcomeStatus(value: unknown): InlineImageOutcome["status"] {
	const normalized = text(value);
	if (
		normalized === "admitted" ||
		normalized === "fetch_failed" ||
		normalized === "ocr_failed" ||
		normalized === "pending" ||
		normalized === "no_extractable_text"
	) {
		return normalized === "no_extractable_text" ? "admitted" : normalized;
	}
	throw new Error(`unsupported WeChat inline image OCR status: ${normalized}`);
}
