import type { ObjectStoreReader } from "./core.ts";
import type { NoticeConsumptionProjectionEntry } from "./notice-consumption-projection.ts";
import { buildWeChatPublicNoticeProjectionEntries } from "./wechat-public-notice-projection-build.ts";
import { loadWeChatArticleSourceTruth } from "./wechat-public-notice-source-truth.ts";
import {
	WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
	WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
	type WeChatPublicNoticeProjectionBuildReport,
	type WeChatSourceTruthArtifactRefs,
} from "./wechat-public-notice-types.ts";

export { buildWeChatPublicNoticeProjectionEntries } from "./wechat-public-notice-projection-build.ts";
export { buildWeChatPublicNoticeReadModelResult } from "./wechat-public-notice-read-model.ts";
export type {
	WeChatCanonicalMarkdownArtifact,
	WeChatPublicNoticeProjectionBuildReport,
	WeChatPublicNoticeReadModelBuildResult,
	WeChatSourceTruthArtifactRefs,
} from "./wechat-public-notice-types.ts";

export async function buildWeChatPublicNoticeProjectionReportFromSourceTruth(input: {
	artifactRefs: readonly WeChatSourceTruthArtifactRefs[];
	consumerAdmissionBatchId?: string;
	objectStore: ObjectStoreReader;
	referenceEntries?: readonly NoticeConsumptionProjectionEntry[];
	sourceBucket?: string;
	sourceCollection?: string;
	sourceCorpus?: string;
}): Promise<WeChatPublicNoticeProjectionBuildReport> {
	if (input.artifactRefs.length === 0) {
		throw new Error("at least one WeChat source-truth artifact ref is required");
	}
	const articles = await Promise.all(
		input.artifactRefs.map((ref) =>
			loadWeChatArticleSourceTruth({
				defaultBucket: input.sourceBucket ?? "",
				objectStore: input.objectStore,
				refs: ref,
			}),
		),
	);
	return buildWeChatPublicNoticeProjectionEntries({
		articles,
		consumerAdmissionBatchId: input.consumerAdmissionBatchId ?? "",
		referenceEntries: input.referenceEntries ?? [],
		sourceCollection: input.sourceCollection ?? WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
		sourceCorpus: input.sourceCorpus ?? WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
	});
}
