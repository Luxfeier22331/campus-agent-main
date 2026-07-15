import { describe, expect, it } from "vitest";
import { buildWeChatOfficialAccountCaptureRelease } from "../src/capture-release.ts";
import type { WeChatOfficialAccountCaptureArtifactRef } from "../src/index.ts";

describe("WeChat official account capture release", () => {
	it("builds a run-level capture release from article source-truth artifacts", () => {
		const artifacts: WeChatOfficialAccountCaptureArtifactRef[] = [
			ref("source_truth_article_manifest", "article-manifest.json"),
			ref("source_truth_content_blocks", "content-blocks.jsonl"),
			ref("source_truth_media_refs", "media-refs.jsonl"),
			ref("provider_response", "provider/feedwe/provider-response.jsonl"),
		];
		const release = buildWeChatOfficialAccountCaptureRelease({
			accountSlug: "muc_tuanwei",
			artifacts,
			capturedAt: "2026-04-04T01:23:45.000Z",
			captureRunId: "wcrun_20260404T012345Z",
			sourceBucket: "campus-agent-source",
		});
		expect(release.schema_version).toBe("wechat_official_account_capture_release.v1");
		expect(release.capture_run_id).toBe("wcrun_20260404T012345Z");
		expect(release.article_source_truth_refs).toHaveLength(1);
		expect(release.article_source_truth_refs[0]?.manifest_ref).toEqual(
			objectRef("campus-agent-source", "article-manifest.json"),
		);
	});
});

function ref(
	artifactType: WeChatOfficialAccountCaptureArtifactRef["artifactType"],
	fileName: string,
): WeChatOfficialAccountCaptureArtifactRef {
	return {
		artifactType,
		byteSize: 123,
		contentSha256: "b".repeat(64),
		objectKey: `wechat_official_account/muc_tuanwei/2026/woa_ver_abc123/source-truth/${fileName}`,
		recordCount: 1,
	};
}

function objectRef(bucket: string, fileName: string) {
	return {
		bucket,
		key: `wechat_official_account/muc_tuanwei/2026/woa_ver_abc123/source-truth/${fileName}`,
		content_sha256: "b".repeat(64),
		byte_size: 123,
		record_count: 1,
	};
}
