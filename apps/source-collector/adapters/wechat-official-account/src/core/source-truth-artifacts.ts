import { WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL } from "./constants";
import {
	encodeJson,
	encodeJsonl,
	validateFilename,
	validatePathSegment,
} from "./source-truth-utils";
import type {
	WeChatOfficialAccountArticleManifest,
	WeChatOfficialAccountContentBlockRow,
	WeChatOfficialAccountMediaRefRow,
	WeChatOfficialAccountSerializedArtifact,
} from "./types";

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

export function serializeWeChatOfficialAccountArticleSourceTruthArtifacts(input: {
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
