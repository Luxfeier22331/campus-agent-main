import type {
	WECHAT_OFFICIAL_ACCOUNT_CAPTURE_BOUNDARY,
	WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
	WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
} from "./constants";

export type WeChatArticleIdentityBasis = "article_url" | "provider_article_id";
export type WeChatArticleBodyState = "captured" | "not_captured" | "fetch_failed";
export type WeChatArticleAvailabilityState = "observed";
export type WeChatArticleBlockRole = "title" | "summary" | "body_paragraph";
export type WeChatArticleMediaResourceRole = "cover_image" | "inline_image";
export type WeChatArticlePageKind = "article" | "verification" | "non_article" | "fetch_error";
export type WeChatArticleMediaCaptureStatus = "captured" | "fetch_failed";

export interface WeChatOfficialAccountArticleManifest {
	schemaVersion: "wechat_official_account_article_manifest.v3";
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
	schemaVersion: "wechat_official_account_media_ref.v3";
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
