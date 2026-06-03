import { WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL } from "./constants";
import type {
	WeChatOfficialAccountArticleSourceTruthMaterial,
	WeChatOfficialAccountSourceTruthValidationIssue,
} from "./types";

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
		const hasObjectMetadata =
			mediaRef.objectKey && mediaRef.contentSha256 && mediaRef.mimeType && mediaRef.byteSize;
		if (mediaRef.captureStatus === "captured" && !hasObjectMetadata) {
			issues.push({
				code: "captured_media_missing_object_metadata",
				message: `captured media ref ${mediaRef.mediaRefId} must include object metadata`,
			});
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
