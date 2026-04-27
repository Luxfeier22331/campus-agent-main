import { createHash } from "node:crypto";

export const WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL = "wechat_official_account" as const;
export const WECHAT_OFFICIAL_ACCOUNT_PROVIDER = "feedwe" as const;
export const WECHAT_OFFICIAL_ACCOUNT_CAPTURE_BOUNDARY = "real_mp_weixin_page" as const;

export type WeChatArticleIdentityBasis = "article_url" | "provider_article_id";
export type WeChatArticleBodyState = "captured" | "not_captured" | "fetch_failed";
export type WeChatArticleAvailabilityState = "observed";
export type WeChatArticleBlockRole = "title" | "summary" | "body_paragraph";
export type WeChatArticleMediaResourceRole = "cover_image" | "inline_image";
export type WeChatArticlePageKind = "article" | "verification" | "non_article" | "fetch_error";
export type WeChatArticleMediaCaptureStatus = "captured" | "fetch_failed";

export interface WeChatOfficialAccountArticleManifest {
	schemaVersion: "wechat_official_account_article_manifest.v2";
	sourceChannel: typeof WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL;
	accountName: string;
	accountSlug: string;
	articleStableId: string;
	rawAssetId: string;
	rawVersionId: string;
	articleUrl: string | null;
	normalizedArticleUrl: string | null;
	articleIdentityBasis: WeChatArticleIdentityBasis;
	provider: typeof WECHAT_OFFICIAL_ACCOUNT_PROVIDER;
	providerArticleId: string | null;
	capturedAt: string;
	titleRaw: string;
	titleNormalized: string;
	publishTime: string | null;
	publishTimeSource: string | null;
	coverImageUrl: string | null;
	bodyState: WeChatArticleBodyState;
	metadataHash: string;
	blockCount: number;
	mediaRefCount: number;
	availabilityState: WeChatArticleAvailabilityState;
	captureBoundary: typeof WECHAT_OFFICIAL_ACCOUNT_CAPTURE_BOUNDARY;
	pageKind: WeChatArticlePageKind;
	pageParserVersion: string;
	capturedPageFinalUrl: string;
	inlineImageCount: number;
	capturedInlineImageCount: number;
	failedInlineImageCount: number;
}

export interface WeChatOfficialAccountContentBlockRow {
	schemaVersion: "wechat_official_account_content_block.v1";
	rawAssetId: string;
	rawVersionId: string;
	rowId: string;
	rowIndex: number;
	blockOrder: number;
	blockRole: WeChatArticleBlockRole;
	textRaw: string;
	textNormalized: string;
}

export interface WeChatOfficialAccountMediaRefRow {
	schemaVersion: "wechat_official_account_media_ref.v2";
	rawAssetId: string;
	rawVersionId: string;
	mediaRefId: string;
	refOrder: number;
	resourceRole: WeChatArticleMediaResourceRole;
	sourceUrl: string;
	normalizedSourceUrl: string;
	captureStatus: WeChatArticleMediaCaptureStatus;
	finalUrl: string | null;
	objectKey: string | null;
	contentSha256: string | null;
	mimeType: string | null;
	byteSize: number | null;
	capturedAt: string | null;
	fetchErrorMessage: string | null;
}

export type WeChatOfficialAccountSourceTruthArtifactType =
	| "source_truth_article_manifest"
	| "source_truth_content_blocks"
	| "source_truth_media_refs";

export interface WeChatOfficialAccountSerializedArtifact {
	artifactType: WeChatOfficialAccountSourceTruthArtifactType;
	contentType: "application/json" | "application/x-ndjson";
	data: Uint8Array;
	objectKey: string;
	recordCount: number;
}

export interface WeChatOfficialAccountArticleSourceTruthMaterial {
	accountName: string;
	accountSlug: string;
	articleStableId: string;
	rawAssetId: string;
	rawVersionId: string;
	year: string;
	manifest: WeChatOfficialAccountArticleManifest;
	contentBlocks: WeChatOfficialAccountContentBlockRow[];
	mediaRefs: WeChatOfficialAccountMediaRefRow[];
	artifacts: WeChatOfficialAccountSerializedArtifact[];
}

export interface CapturedWeChatOfficialAccountArticlePage {
	bodyBlocks: string[];
	contentType: string | null;
	coverImageUrl: string | null;
	fetchErrorMessage?: string | null;
	fetchedAt: string;
	finalUrl: string;
	inlineImageUrls: string[];
	pageKind: WeChatArticlePageKind;
	parserVersion: string;
	publishTime: string | null;
	publishTimeSource: string | null;
	rawHtml?: string | null;
	statusCode: number;
	summary: string | null;
	title: string | null;
}

export interface CapturedWeChatOfficialAccountArticleMedia {
	sourceUrl: string;
	normalizedSourceUrl: string;
	captureStatus: WeChatArticleMediaCaptureStatus;
	finalUrl: string | null;
	objectKey: string | null;
	contentSha256: string | null;
	mimeType: string | null;
	byteSize: number | null;
	capturedAt: string | null;
	fetchErrorMessage: string | null;
}

export interface WeChatOfficialAccountSourceTruthValidationIssue {
	code: string;
	message: string;
}

const textEncoder = new TextEncoder();
const FORBIDDEN_SOURCE_TRUTH_KEYS = new Set([
	"document_id",
	"doc_id",
	"version_id",
	"revision_track",
	"chunk_id",
	"chunk_order",
	"embedding",
	"visibility_level",
	"visibility_scope",
	"entitlement_groups",
	"policy_projection_version",
]);

export function buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage(input: {
	accountName: string;
	accountSlug: string;
	article: unknown;
	capturedAt: string;
	page: CapturedWeChatOfficialAccountArticlePage;
	mediaCaptures: CapturedWeChatOfficialAccountArticleMedia[];
}): WeChatOfficialAccountArticleSourceTruthMaterial {
	const article = normalizeArticleRecord(input.article);
	const page = normalizeCapturedPage(input.page);
	const mediaCaptureLookup = normalizeMediaCaptureLookup(input.mediaCaptures);
	const accountName = firstText(article.accountName, input.accountName);
	const accountSlug = requireText(input.accountSlug, "accountSlug");
	const capturedAt = normalizeIsoTimestamp(input.capturedAt, "capturedAt");
	const providerArticleId = optionalText(article.id);
	const articleUrl = optionalText(article.url);
	const normalizedArticleUrl = articleUrl ? normalizeUrl(articleUrl) : null;
	if (!(normalizedArticleUrl || providerArticleId)) {
		throw new Error("article url or provider article id is required");
	}

	const fallbackTitle = requireText(article.title, "title");
	const titleRaw = firstText(page.title, fallbackTitle);
	const titleNormalized = normalizeText(titleRaw);
	const summaryRaw = firstText(page.summary, resolveArticleSummary(article));
	const bodyBlocksRaw = page.bodyBlocks.map((item) => item.trim()).filter(Boolean);
	const bodyState = resolveCapturedPageBodyState(page, bodyBlocksRaw.length);
	const articleIdentityBasis: WeChatArticleIdentityBasis = normalizedArticleUrl
		? "article_url"
		: "provider_article_id";
	const identityValue = normalizedArticleUrl ?? providerArticleId ?? "";
	const publishFromArticle = normalizePublishTime(article);
	const publishTime = normalizeOptionalIsoTimestamp(page.publishTime) ?? publishFromArticle.value;
	const publishTimeSource = firstText(page.publishTimeSource, publishFromArticle.source);
	const coverImageUrl = optionalText(page.coverImageUrl) ?? optionalText(article.coverUrl);
	const normalizedCoverImageUrl = coverImageUrl ? normalizeUrl(coverImageUrl) : null;
	const inlineImageUrls = dedupeUrls(page.inlineImageUrls);
	const articleStableId = prefixedHash("woa_article", `${accountSlug}\n${identityValue}`, 24);
	const rawAssetId = prefixedHash("woa_asset", `${accountSlug}\n${identityValue}`, 24);

	const normalizedMediaRefs = buildNormalizedMediaRefInputs({
		rawAssetId,
		normalizedCoverImageUrl,
		coverImageUrl,
		inlineImageUrls,
		mediaCaptureLookup,
	});
	const metadataHash = hashJson({
		accountName,
		accountSlug,
		bodyBlocks: bodyBlocksRaw.map((item) => normalizeText(item)),
		bodyState,
		contentType: page.contentType,
		coverImageUrl: normalizedCoverImageUrl,
		fetchErrorMessage: optionalText(page.fetchErrorMessage),
		mediaRefs: normalizedMediaRefs.map((item) => ({
			byteSize: item.byteSize,
			captureStatus: item.captureStatus,
			contentSha256: item.contentSha256,
			finalUrl: item.finalUrl,
			fetchErrorMessage: item.fetchErrorMessage,
			mimeType: item.mimeType,
			normalizedSourceUrl: item.normalizedSourceUrl,
			refOrder: item.refOrder,
			resourceRole: item.resourceRole,
			sourceUrl: item.sourceUrl,
		})),
		normalizedArticleUrl,
		pageFinalUrl: page.finalUrl,
		pageKind: page.pageKind,
		parserVersion: page.parserVersion,
		providerArticleId,
		publishTime,
		summary: summaryRaw ? normalizeText(summaryRaw) : null,
		titleNormalized,
	});
	const rawVersionId = prefixedHash("woa_ver", metadataHash, 24);
	const contentBlocks = buildContentBlocks({
		rawAssetId,
		rawVersionId,
		titleRaw,
		titleNormalized,
		summaryRaw,
		bodyBlocksRaw,
	});
	const mediaRefs = normalizedMediaRefs.map((item) =>
		buildMediaRef({
			...item,
			rawAssetId,
			rawVersionId,
		}),
	);
	const inlineMediaRefs = mediaRefs.filter((item) => item.resourceRole === "inline_image");
	const manifest: WeChatOfficialAccountArticleManifest = {
		schemaVersion: "wechat_official_account_article_manifest.v2",
		sourceChannel: WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
		accountName,
		accountSlug,
		articleStableId,
		rawAssetId,
		rawVersionId,
		articleUrl,
		normalizedArticleUrl,
		articleIdentityBasis,
		provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
		providerArticleId,
		capturedAt,
		titleRaw,
		titleNormalized,
		publishTime,
		publishTimeSource,
		coverImageUrl: normalizedCoverImageUrl,
		bodyState,
		metadataHash,
		blockCount: contentBlocks.length,
		mediaRefCount: mediaRefs.length,
		availabilityState: "observed",
		captureBoundary: WECHAT_OFFICIAL_ACCOUNT_CAPTURE_BOUNDARY,
		pageKind: page.pageKind,
		pageParserVersion: page.parserVersion,
		capturedPageFinalUrl: page.finalUrl,
		inlineImageCount: inlineMediaRefs.length,
		capturedInlineImageCount: inlineMediaRefs.filter(
			(item) => item.captureStatus === "captured",
		).length,
		failedInlineImageCount: inlineMediaRefs.filter(
			(item) => item.captureStatus === "fetch_failed",
		).length,
	};
	const year = extractYear(publishTime) ?? extractYear(capturedAt) ?? "undated";
	return {
		accountName,
		accountSlug,
		articleStableId,
		rawAssetId,
		rawVersionId,
		year,
		manifest,
		contentBlocks,
		mediaRefs,
		artifacts: serializeWeChatOfficialAccountArticleSourceTruthArtifacts({
			accountSlug,
			contentBlocks,
			manifest,
			mediaRefs,
			rawVersionId,
			year,
		}),
	};
}

export function buildWeChatOfficialAccountSourceTruthArtifactKey(input: {
	accountSlug: string;
	year: string;
	rawVersionId: string;
	filename: "article-manifest.json" | "content-blocks.jsonl" | "media-refs.jsonl";
}): string {
	return [
		WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
		validatePathSegment(input.accountSlug, "accountSlug"),
		validatePathSegment(input.year, "year"),
		validatePathSegment(input.rawVersionId, "rawVersionId"),
		"source-truth",
		validateFilename(input.filename),
	].join("/");
}

export function validateWeChatOfficialAccountArticleSourceTruth(
	material: WeChatOfficialAccountArticleSourceTruthMaterial,
): WeChatOfficialAccountSourceTruthValidationIssue[] {
	const issues: WeChatOfficialAccountSourceTruthValidationIssue[] = [];
	if (material.manifest.schemaVersion !== "wechat_official_account_article_manifest.v2") {
		issues.push({ code: "invalid_schema", message: "article manifest schemaVersion is invalid" });
	}
	if (material.manifest.sourceChannel !== WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL) {
		issues.push({ code: "invalid_source_channel", message: "sourceChannel is invalid" });
	}
	if (material.manifest.blockCount !== material.contentBlocks.length) {
		issues.push({ code: "block_count_mismatch", message: "blockCount does not match blocks" });
	}
	if (material.manifest.mediaRefCount !== material.mediaRefs.length) {
		issues.push({
			code: "media_count_mismatch",
			message: "mediaRefCount does not match media refs",
		});
	}
	const inlineRefs = material.mediaRefs.filter((item) => item.resourceRole === "inline_image");
	if (material.manifest.inlineImageCount !== inlineRefs.length) {
		issues.push({
			code: "inline_image_count_mismatch",
			message: "inlineImageCount does not match inline media refs",
		});
	}
	if (
		material.manifest.capturedInlineImageCount !==
		inlineRefs.filter((item) => item.captureStatus === "captured").length
	) {
		issues.push({
			code: "captured_inline_image_count_mismatch",
			message: "capturedInlineImageCount does not match captured inline media refs",
		});
	}
	if (
		material.manifest.failedInlineImageCount !==
		inlineRefs.filter((item) => item.captureStatus === "fetch_failed").length
	) {
		issues.push({
			code: "failed_inline_image_count_mismatch",
			message: "failedInlineImageCount does not match failed inline media refs",
		});
	}
	if (
		material.manifest.bodyState === "captured" &&
		!material.contentBlocks.some((item) => item.blockRole === "body_paragraph")
	) {
		issues.push({
			code: "captured_body_missing_blocks",
			message: "captured article source-truth must contain body_paragraph blocks",
		});
	}
	if (
		material.manifest.bodyState !== "captured" &&
		material.contentBlocks.some((item) => item.blockRole === "body_paragraph")
	) {
		issues.push({
			code: "uncaptured_body_contains_blocks",
			message: "uncaptured article source-truth must not contain body_paragraph blocks",
		});
	}
	for (const mediaRef of material.mediaRefs) {
		if (mediaRef.schemaVersion !== "wechat_official_account_media_ref.v2") {
			issues.push({
				code: "invalid_media_ref_schema",
				message: `media ref ${mediaRef.mediaRefId} schemaVersion is invalid`,
			});
		}
		if (mediaRef.captureStatus === "captured") {
			if (!(mediaRef.objectKey && mediaRef.contentSha256 && mediaRef.mimeType && mediaRef.byteSize)) {
				issues.push({
					code: "captured_media_missing_object_metadata",
					message: `captured media ref ${mediaRef.mediaRefId} must include object metadata`,
				});
			}
		}
		if (mediaRef.captureStatus === "fetch_failed" && !mediaRef.fetchErrorMessage) {
			issues.push({
				code: "failed_media_missing_error",
				message: `failed media ref ${mediaRef.mediaRefId} must include fetchErrorMessage`,
			});
		}
	}
	for (const key of findForbiddenKeys(material)) {
		issues.push({
			code: "forbidden_field",
			message: `source-truth must not contain forbidden field ${key}`,
		});
	}
	return issues;
}

function buildContentBlocks(input: {
	rawAssetId: string;
	rawVersionId: string;
	titleRaw: string;
	titleNormalized: string;
	summaryRaw: string;
	bodyBlocksRaw: string[];
}): WeChatOfficialAccountContentBlockRow[] {
	const rows = [
		buildContentBlock({
			blockOrder: 0,
			blockRole: "title",
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			rowIndex: 0,
			textRaw: input.titleRaw,
			textNormalized: input.titleNormalized,
		}),
	];
	if (input.summaryRaw) {
		rows.push(
			buildContentBlock({
				blockOrder: rows.length,
				blockRole: "summary",
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				rowIndex: rows.length,
				textRaw: input.summaryRaw,
				textNormalized: normalizeText(input.summaryRaw),
			}),
		);
	}
	for (const block of input.bodyBlocksRaw) {
		rows.push(
			buildContentBlock({
				blockOrder: rows.length,
				blockRole: "body_paragraph",
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				rowIndex: rows.length,
				textRaw: block,
				textNormalized: normalizeText(block),
			}),
		);
	}
	return rows;
}

function buildNormalizedMediaRefInputs(input: {
	rawAssetId: string;
	normalizedCoverImageUrl: string | null;
	coverImageUrl: string | null;
	inlineImageUrls: string[];
	mediaCaptureLookup: Map<string, NormalizedMediaCapture>;
}): NormalizedMediaRefInput[] {
	const mediaRefs: NormalizedMediaRefInput[] = [];
	if (input.normalizedCoverImageUrl) {
		mediaRefs.push(
			buildNormalizedMediaRefInput({
				mediaCaptureLookup: input.mediaCaptureLookup,
				normalizedSourceUrl: input.normalizedCoverImageUrl,
				refOrder: mediaRefs.length,
				resourceRole: "cover_image",
				sourceUrl: input.coverImageUrl ?? input.normalizedCoverImageUrl,
			}),
		);
	}
	for (const inlineImageUrl of input.inlineImageUrls) {
		mediaRefs.push(
			buildNormalizedMediaRefInput({
				mediaCaptureLookup: input.mediaCaptureLookup,
				normalizedSourceUrl: inlineImageUrl,
				refOrder: mediaRefs.length,
				resourceRole: "inline_image",
				sourceUrl: inlineImageUrl,
			}),
		);
	}
	return mediaRefs;
}

type NormalizedMediaCapture = {
	byteSize: number | null;
	captureStatus: WeChatArticleMediaCaptureStatus;
	capturedAt: string | null;
	contentSha256: string | null;
	finalUrl: string | null;
	fetchErrorMessage: string | null;
	mimeType: string | null;
	objectKey: string | null;
	sourceUrl: string;
	normalizedSourceUrl: string;
};

type NormalizedMediaRefInput = NormalizedMediaCapture & {
	refOrder: number;
	resourceRole: WeChatArticleMediaResourceRole;
};

function normalizeMediaCaptureLookup(
	values: CapturedWeChatOfficialAccountArticleMedia[],
): Map<string, NormalizedMediaCapture> {
	const lookup = new Map<string, NormalizedMediaCapture>();
	for (const value of values) {
		const normalizedSourceUrl = normalizeUrl(requireText(value.normalizedSourceUrl, "normalizedSourceUrl"));
		lookup.set(normalizedSourceUrl, {
			byteSize: normalizeByteSize(value.byteSize),
			captureStatus: normalizeMediaCaptureStatus(value.captureStatus),
			capturedAt: normalizeOptionalIsoTimestamp(optionalText(value.capturedAt)),
			contentSha256: optionalText(value.contentSha256),
			finalUrl: normalizeOptionalUrl(optionalText(value.finalUrl)),
			fetchErrorMessage: optionalText(value.fetchErrorMessage),
			mimeType: optionalText(value.mimeType),
			objectKey: optionalText(value.objectKey),
			sourceUrl: optionalText(value.sourceUrl) ?? normalizedSourceUrl,
			normalizedSourceUrl,
		});
	}
	return lookup;
}

function buildNormalizedMediaRefInput(input: {
	mediaCaptureLookup: Map<string, NormalizedMediaCapture>;
	normalizedSourceUrl: string;
	refOrder: number;
	resourceRole: WeChatArticleMediaResourceRole;
	sourceUrl: string;
}): NormalizedMediaRefInput {
	const capture = input.mediaCaptureLookup.get(input.normalizedSourceUrl);
	if (capture) {
		return {
			...capture,
			refOrder: input.refOrder,
			resourceRole: input.resourceRole,
			sourceUrl: input.sourceUrl,
		};
	}
	return {
		byteSize: null,
		captureStatus: "fetch_failed",
		capturedAt: null,
		contentSha256: null,
		finalUrl: null,
		fetchErrorMessage: "capture result missing",
		mimeType: null,
		objectKey: null,
		refOrder: input.refOrder,
		resourceRole: input.resourceRole,
		sourceUrl: input.sourceUrl,
		normalizedSourceUrl: input.normalizedSourceUrl,
	};
}

function serializeWeChatOfficialAccountArticleSourceTruthArtifacts(input: {
	accountSlug: string;
	contentBlocks: WeChatOfficialAccountContentBlockRow[];
	manifest: WeChatOfficialAccountArticleManifest;
	mediaRefs: WeChatOfficialAccountMediaRefRow[];
	rawVersionId: string;
	year: string;
}): WeChatOfficialAccountSerializedArtifact[] {
	return [
		{
			artifactType: "source_truth_article_manifest",
			contentType: "application/json",
			data: encodeJson(input.manifest),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "article-manifest.json",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: 1,
		},
		{
			artifactType: "source_truth_content_blocks",
			contentType: "application/x-ndjson",
			data: encodeJsonl(input.contentBlocks),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "content-blocks.jsonl",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: input.contentBlocks.length,
		},
		{
			artifactType: "source_truth_media_refs",
			contentType: "application/x-ndjson",
			data: encodeJsonl(input.mediaRefs),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "media-refs.jsonl",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: input.mediaRefs.length,
		},
	];
}

function buildContentBlock(input: {
	blockOrder: number;
	blockRole: WeChatArticleBlockRole;
	rawAssetId: string;
	rawVersionId: string;
	rowIndex: number;
	textRaw: string;
	textNormalized: string;
}): WeChatOfficialAccountContentBlockRow {
	return {
		schemaVersion: "wechat_official_account_content_block.v1",
		rawAssetId: input.rawAssetId,
		rawVersionId: input.rawVersionId,
		rowId: prefixedHash(
			"woa_block",
			`${input.rawAssetId}\n${input.rawVersionId}\n${input.rowIndex}\n${input.blockRole}`,
			24,
		),
		rowIndex: input.rowIndex,
		blockOrder: input.blockOrder,
		blockRole: input.blockRole,
		textRaw: input.textRaw,
		textNormalized: input.textNormalized,
	};
}

function buildMediaRef(input: NormalizedMediaRefInput & { rawAssetId: string; rawVersionId: string }): WeChatOfficialAccountMediaRefRow {
	return {
		schemaVersion: "wechat_official_account_media_ref.v2",
		rawAssetId: input.rawAssetId,
		rawVersionId: input.rawVersionId,
		mediaRefId: prefixedHash(
			"woa_media",
			`${input.rawAssetId}\n${input.rawVersionId}\n${input.refOrder}\n${input.normalizedSourceUrl}`,
			24,
		),
		refOrder: input.refOrder,
		resourceRole: input.resourceRole,
		sourceUrl: input.sourceUrl,
		normalizedSourceUrl: input.normalizedSourceUrl,
		captureStatus: input.captureStatus,
		finalUrl: input.finalUrl,
		objectKey: input.objectKey,
		contentSha256: input.contentSha256,
		mimeType: input.mimeType,
		byteSize: input.byteSize,
		capturedAt: input.capturedAt,
		fetchErrorMessage: input.fetchErrorMessage,
	};
}

function normalizeCapturedPage(value: CapturedWeChatOfficialAccountArticlePage) {
	return {
		bodyBlocks: Array.isArray(value.bodyBlocks) ? value.bodyBlocks.filter(Boolean) : [],
		contentType: optionalText(value.contentType),
		coverImageUrl: normalizeOptionalUrl(optionalText(value.coverImageUrl)),
		fetchErrorMessage: optionalText(value.fetchErrorMessage),
		fetchedAt: normalizeIsoTimestamp(value.fetchedAt, "page.fetchedAt"),
		finalUrl: normalizeUrl(requireText(value.finalUrl, "page.finalUrl")),
		inlineImageUrls: Array.isArray(value.inlineImageUrls) ? value.inlineImageUrls : [],
		pageKind: normalizePageKind(value.pageKind),
		parserVersion: requireText(value.parserVersion, "page.parserVersion"),
		publishTime: normalizeOptionalIsoTimestamp(optionalText(value.publishTime)),
		publishTimeSource: optionalText(value.publishTimeSource),
		statusCode: Number.isInteger(value.statusCode) ? value.statusCode : 0,
		summary: optionalText(value.summary),
		title: optionalText(value.title),
	};
}

function resolveCapturedPageBodyState(
	page: ReturnType<typeof normalizeCapturedPage>,
	bodyBlockCount: number,
): WeChatArticleBodyState {
	if (page.statusCode < 200 || page.statusCode >= 300 || page.pageKind !== "article") {
		return "fetch_failed";
	}
	return bodyBlockCount > 0 ? "captured" : "not_captured";
}

function normalizeArticleRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("article must be an object");
	}
	return value as Record<string, unknown>;
}

function normalizePublishTime(article: Record<string, unknown>): {
	source: string | null;
	value: string | null;
} {
	for (const key of ["publishDate", "publishTime", "publish_time", "publishedAt", "published_at"]) {
		const value = optionalText(article[key]);
		if (!value) {
			continue;
		}
		const parsed = parseDateTime(value);
		if (parsed) {
			return { source: key, value: parsed };
		}
	}
	return { source: null, value: null };
}

function parseDateTime(value: string): string | null {
	const normalized = value.trim();
	const localMatch =
		/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/.exec(
			normalized,
		);
	if (localMatch?.groups) {
		const { day, hour, minute, month, second = "00", year } = localMatch.groups;
		const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
		return Number.isNaN(date.valueOf()) ? null : date.toISOString();
	}
	const date = new Date(normalized);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function extractYear(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = /(?<year>19\d{2}|20\d{2})/.exec(value);
	return match?.groups?.year ?? null;
}

function normalizeUrl(value: string): string {
	const parsed = new URL(value.trim());
	parsed.hash = "";
	return parsed.toString();
}

function normalizeOptionalUrl(value: string | null): string | null {
	return value ? normalizeUrl(value) : null;
}

function firstText(...values: unknown[]): string {
	for (const value of values) {
		const normalized = optionalText(value);
		if (normalized) {
			return normalized;
		}
	}
	return "";
}

function requireText(value: unknown, field: string): string {
	const normalized = optionalText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePageKind(value: unknown): WeChatArticlePageKind {
	if (
		value === "article" ||
		value === "verification" ||
		value === "non_article" ||
		value === "fetch_error"
	) {
		return value;
	}
	return "non_article";
}

function normalizeMediaCaptureStatus(value: unknown): WeChatArticleMediaCaptureStatus {
	return value === "captured" ? "captured" : "fetch_failed";
}

function normalizeByteSize(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return Math.trunc(value);
}

function resolveArticleSummary(article: Record<string, unknown>): string {
	return (
		optionalText(article.summary) ??
		optionalText(article.description) ??
		optionalText(article.digest) ??
		""
	);
}

function normalizeText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeIsoTimestamp(value: string, field: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		throw new Error(`${field} must be a valid ISO timestamp`);
	}
	return date.toISOString();
}

function normalizeOptionalIsoTimestamp(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function dedupeUrls(values: string[]): string[] {
	const deduped = new Map<string, string>();
	for (const value of values) {
		const normalized = optionalText(value);
		if (!normalized) {
			continue;
		}
		const canonical = normalizeUrl(normalized);
		if (!deduped.has(canonical)) {
			deduped.set(canonical, canonical);
		}
	}
	return [...deduped.values()];
}

function hashJson(value: Record<string, unknown>): string {
	return sha256Hex(JSON.stringify(value));
}

function prefixedHash(prefix: string, value: string, length: number): string {
	return `${prefix}_${sha256Hex(value).slice(0, length)}`;
}

function sha256Hex(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function encodeJson(value: unknown): Uint8Array {
	return textEncoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function encodeJsonl(rows: unknown[]): Uint8Array {
	return textEncoder.encode(
		rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
	);
}

function validatePathSegment(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.includes("/")) {
		throw new Error(`${field} must be a non-empty path segment`);
	}
	return normalized;
}

function validateFilename(value: string): string {
	if (!value || value.includes("/")) {
		throw new Error("filename must be a basename");
	}
	return value;
}

function findForbiddenKeys(value: unknown): string[] {
	const found = new Set<string>();
	visitForbiddenKeys(value, found);
	return [...found].sort();
}

function visitForbiddenKeys(value: unknown, found: Set<string>): void {
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			visitForbiddenKeys(item, found);
		}
		return;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_SOURCE_TRUTH_KEYS.has(key)) {
			found.add(key);
		}
		visitForbiddenKeys(nested, found);
	}
}
