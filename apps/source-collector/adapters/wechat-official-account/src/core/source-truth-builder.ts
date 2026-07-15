import {
	WECHAT_OFFICIAL_ACCOUNT_CAPTURE_BOUNDARY,
	WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
	WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
} from "./constants";
import { serializeWeChatOfficialAccountArticleSourceTruthArtifacts } from "./source-truth-artifacts";
import {
	dedupeUrls,
	extractYear,
	firstText,
	hashJson,
	normalizeIsoTimestamp,
	normalizeOptionalIsoTimestamp,
	normalizeOptionalUrl,
	normalizeText,
	normalizeUrl,
	optionalText,
	parseDateTime,
	prefixedHash,
	requireText,
} from "./source-truth-utils";
import type {
	CapturedWeChatOfficialAccountArticleMedia,
	CapturedWeChatOfficialAccountArticlePage,
	WeChatArticleBlockRole,
	WeChatArticleBodyState,
	WeChatArticleIdentityBasis,
	WeChatArticleMediaCaptureStatus,
	WeChatArticleMediaResourceRole,
	WeChatArticlePageKind,
	WeChatOfficialAccountArticleManifest,
	WeChatOfficialAccountArticleSourceTruthMaterial,
	WeChatOfficialAccountContentBlockRow,
	WeChatOfficialAccountMediaRefRow,
} from "./types";

export function buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage(input: {
	accountName: string;
	accountSlug: string;
	article: unknown;
	page: CapturedWeChatOfficialAccountArticlePage;
	mediaCaptures: CapturedWeChatOfficialAccountArticleMedia[];
}): WeChatOfficialAccountArticleSourceTruthMaterial {
	const article = normalizeArticleRecord(input.article);
	const page = normalizeCapturedPage(input.page);
	const mediaCaptureLookup = normalizeMediaCaptureLookup(input.mediaCaptures);
	const accountName = firstText(article.accountName, input.accountName);
	const accountSlug = requireText(input.accountSlug, "accountSlug");
	const providerArticleId = optionalText(article.id);
	const articleUrl = optionalText(article.url);
	const normalizedArticleUrl = articleUrl ? normalizeUrl(articleUrl) : null;
	if (!(normalizedArticleUrl || providerArticleId)) {
		throw new Error("article url or provider article id is required");
	}

	const articleTitle = requireText(article.title, "title");
	const titleRaw = firstText(page.title, articleTitle);
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
		schemaVersion: "wechat_official_account_article_manifest.v3",
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
		capturedInlineImageCount: inlineMediaRefs.filter((item) => item.captureStatus === "captured")
			.length,
		failedInlineImageCount: inlineMediaRefs.filter((item) => item.captureStatus === "fetch_failed")
			.length,
	};
	const year = extractYear(publishTime) ?? "undated";
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

interface NormalizedMediaCapture {
	byteSize: number | null;
	captureStatus: WeChatArticleMediaCaptureStatus;
	contentSha256: string | null;
	finalUrl: string | null;
	fetchErrorMessage: string | null;
	mimeType: string | null;
	objectKey: string | null;
	sourceUrl: string;
	normalizedSourceUrl: string;
}

type NormalizedMediaRefInput = NormalizedMediaCapture & {
	refOrder: number;
	resourceRole: WeChatArticleMediaResourceRole;
};

function normalizeMediaCaptureLookup(values: CapturedWeChatOfficialAccountArticleMedia[]) {
	const lookup = new Map<string, NormalizedMediaCapture>();
	for (const value of values) {
		const normalizedSourceUrl = normalizeUrl(
			requireText(value.normalizedSourceUrl, "normalizedSourceUrl"),
		);
		lookup.set(normalizedSourceUrl, {
			byteSize: normalizeByteSize(value.byteSize),
			captureStatus: normalizeMediaCaptureStatus(value.captureStatus),
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

function buildMediaRef(
	input: NormalizedMediaRefInput & { rawAssetId: string; rawVersionId: string },
): WeChatOfficialAccountMediaRefRow {
	return {
		schemaVersion: "wechat_official_account_media_ref.v3",
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
