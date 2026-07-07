import type { InternalNoticeReadModelEntry } from "./internal-notice-read-model.ts";
import type { NoticeConsumptionProjectionEntry } from "./notice-consumption-projection.ts";

export const WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL = "wechat_official_account";
export const WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY = "wechat_public_notice";
export const WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS = "campus_notices";
export const WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION = "wechat_public_notice";
export const WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE = "notice_window";
export const WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER = "notice_body";
export const WECHAT_PUBLIC_NOTICE_SOURCE_LABEL = "wechat_public_notice_projection_v1";
export const NOTICE_DEFAULT_AGENT_NOTICE = "notice";
export const NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query";
export const NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE =
	"multimodal_processing_candidate";
export const NOTICE_TARGET_SURFACE_UNSUPPORTED = "unsupported";
export const NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW = "announcement_window";
export const NOTICE_COMPLETENESS_COMPLETE = "complete";
export const NOTICE_COMPLETENESS_REFERENCE_ONLY = "reference_only";
export const NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING = "requires_multimodal_processing";
export const NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE = "body_only_answerable";
export const NOTICE_ANSWERABILITY_REFERENCE_ONLY = "reference_only";
export const NOTICE_CONSUMPTION_STATUS_NO_ADOPTION = "no_adoption";
export const NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING =
	"pending_multimodal_processing";
export const NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY = "retained_for_notice_query";
export const BODY_EXCERPT_MAX_CHARS = 800;
export const SEARCH_TEXT_MAX_CHARS = 2000;

export const FORBIDDEN_WECHAT_SOURCE_TRUTH_FIELDS = new Set([
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

export type WeChatBodyState = "captured" | "fetch_failed" | "not_captured";
export type InlineImageOutcomeStatus = "admitted" | "fetch_failed" | "ocr_failed" | "pending";

export interface WeChatSourceTruthArtifactRefs {
	articleManifestKey: string;
	bucket?: string;
	contentBlocksKey: string;
	mediaRefsKey: string;
}

export interface WeChatPublicNoticeProjectionBuildReport {
	duplicateSourceFamilyCounts: Record<string, number>;
	duplicateSuppressedCount: number;
	projectionEntries: NoticeConsumptionProjectionEntry[];
	retainedCount: number;
	totalArticleCount: number;
}

export interface WeChatPublicNoticeReadModelBuildResult {
	canonicalMarkdownArtifacts: WeChatCanonicalMarkdownArtifact[];
	readModelEntries: InternalNoticeReadModelEntry[];
}

export interface WeChatCanonicalMarkdownArtifact {
	contentType: "text/markdown; charset=utf-8";
	data: Uint8Array;
	objectKey: string;
}

export interface WeChatArticleSourceTruth {
	accountName: string;
	accountSlug: string;
	articleStableId: string;
	articleUrl: string;
	bodyParagraphs: string[];
	bodyState: WeChatBodyState;
	bucket: string;
	contentBlocksKey: string;
	contentBlockCount: number;
	coverImageUrl: string;
	inlineImageCount: number;
	inlineImageOutcomes: InlineImageOutcome[];
	inlineImageRefs: InlineImageRef[];
	manifestKey: string;
	mediaRefCount: number;
	mediaRefsKey: string;
	metadataHash: string;
	normalizedArticleUrl: string;
	provider: string;
	providerArticleId: string;
	publishDay: string;
	publishTime: string;
	publishTimeSource: string;
	rawAssetId: string;
	rawVersionId: string;
	summaryText: string;
	titleNormalized: string;
	titleRaw: string;
}

export interface InlineImageRef {
	byteSize: number;
	captureStatus: string;
	capturedAt: string;
	contentSha256: string;
	fetchErrorMessage: string;
	finalUrl: string;
	mediaRefId: string;
	mimeType: string;
	normalizedSourceUrl: string;
	objectKey: string;
	refOrder: number;
	sourceUrl: string;
}

export interface InlineImageOutcome {
	childDocumentId: string;
	error: string;
	extractedText: string;
	imageObjectKey: string;
	mediaRefId: string;
	model: string;
	normalizedSourceUrl: string;
	ocrManifestKey: string;
	provider: string;
	sourceUrl: string;
	status: InlineImageOutcomeStatus;
	summary: string;
}

export interface DuplicateReferenceHit {
	dedupeBasis: string;
	sourceFamily: string;
	sourceNoticeId: string;
}
