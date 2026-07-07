import type { WeChatOfficialAccountCaptureArtifactRef } from "./capture.ts";

export interface WeChatOfficialAccountCaptureRelease {
	schema_version: "wechat_official_account_capture_release.v1";
	source_channel: "wechat_official_account";
	account_slug: string;
	capture_run_id: string;
	captured_at: string;
	article_source_truth_refs: WeChatOfficialAccountArticleSourceTruthReleaseRef[];
}

export interface WeChatOfficialAccountArticleSourceTruthReleaseRef {
	article_stable_id: string;
	raw_asset_id: string;
	raw_version_id: string;
	manifest_ref: WeChatOfficialAccountReleaseObjectRef;
	content_blocks_ref: WeChatOfficialAccountReleaseObjectRef;
	media_refs_ref: WeChatOfficialAccountReleaseObjectRef;
}

export interface WeChatOfficialAccountReleaseObjectRef {
	bucket: string;
	key: string;
	content_sha256: string;
	byte_size: number;
	record_count?: number;
}

export function buildWeChatOfficialAccountCaptureRelease(input: {
	accountSlug: string;
	artifacts: WeChatOfficialAccountCaptureArtifactRef[];
	capturedAt: string;
	captureRunId: string;
	sourceBucket: string;
}): WeChatOfficialAccountCaptureRelease {
	const refsByVersion = new Map<
		string,
		Partial<
			Pick<
				WeChatOfficialAccountArticleSourceTruthReleaseRef,
				"content_blocks_ref" | "manifest_ref" | "media_refs_ref"
			>
		> & {
			article_stable_id: string;
			raw_asset_id: string;
			raw_version_id: string;
		}
	>();
	for (const artifact of input.artifacts) {
		const field = sourceTruthArtifactField(artifact.artifactType);
		if (!field) {
			continue;
		}
		const rawVersionId = extractRawVersionId(artifact.objectKey);
		const existing =
			refsByVersion.get(rawVersionId) ??
			({
				article_stable_id: "unknown",
				raw_asset_id: "unknown",
				raw_version_id: rawVersionId,
			} as const);
		refsByVersion.set(rawVersionId, {
			...existing,
			[field]: toReleaseObjectRef({
				artifact,
				sourceBucket: input.sourceBucket,
			}),
		});
	}

	return {
		schema_version: "wechat_official_account_capture_release.v1",
		source_channel: "wechat_official_account",
		account_slug: input.accountSlug,
		capture_run_id: input.captureRunId,
		captured_at: input.capturedAt,
		article_source_truth_refs: [...refsByVersion.values()].map((ref) => {
			if (!(ref.manifest_ref && ref.content_blocks_ref && ref.media_refs_ref)) {
				throw new Error(`incomplete WeChat source-truth refs for ${ref.raw_version_id}`);
			}
			return {
				article_stable_id: ref.article_stable_id,
				raw_asset_id: ref.raw_asset_id,
				raw_version_id: ref.raw_version_id,
				manifest_ref: ref.manifest_ref,
				content_blocks_ref: ref.content_blocks_ref,
				media_refs_ref: ref.media_refs_ref,
			};
		}),
	};
}

function sourceTruthArtifactField(
	artifactType: WeChatOfficialAccountCaptureArtifactRef["artifactType"],
): "content_blocks_ref" | "manifest_ref" | "media_refs_ref" | null {
	if (artifactType === "source_truth_article_manifest") {
		return "manifest_ref";
	}
	if (artifactType === "source_truth_content_blocks") {
		return "content_blocks_ref";
	}
	if (artifactType === "source_truth_media_refs") {
		return "media_refs_ref";
	}
	return null;
}

function toReleaseObjectRef(input: {
	artifact: WeChatOfficialAccountCaptureArtifactRef;
	sourceBucket: string;
}): WeChatOfficialAccountReleaseObjectRef {
	return {
		bucket: input.sourceBucket,
		key: input.artifact.objectKey,
		content_sha256: input.artifact.contentSha256,
		byte_size: input.artifact.byteSize,
		record_count: input.artifact.recordCount,
	};
}

function extractRawVersionId(objectKey: string): string {
	const parts = objectKey.split("/");
	if (parts.length < 5) {
		throw new Error(`invalid WeChat source-truth object key: ${objectKey}`);
	}
	return parts[3];
}
