import { sha256Hex } from "./core.ts";
import type { NoticeConsumptionProjectionEntry } from "./notice-consumption-projection.ts";
import {
	BODY_EXCERPT_MAX_CHARS,
	type DuplicateReferenceHit,
	NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
	NOTICE_ANSWERABILITY_REFERENCE_ONLY,
	NOTICE_COMPLETENESS_COMPLETE,
	NOTICE_COMPLETENESS_REFERENCE_ONLY,
	NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
	NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
	NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
	NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
	NOTICE_DEFAULT_AGENT_NOTICE,
	NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
	NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
	NOTICE_TARGET_SURFACE_UNSUPPORTED,
	NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
	WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
	WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER,
	WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
	WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
	WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
	WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
	WECHAT_PUBLIC_NOTICE_SOURCE_LABEL,
	type WeChatArticleSourceTruth,
	type WeChatPublicNoticeProjectionBuildReport,
} from "./wechat-public-notice-types.ts";
import {
	compareProjectionEntries,
	text,
	toPublishDay,
	uniqueNonEmpty,
} from "./wechat-public-notice-utils.ts";

export function buildWeChatPublicNoticeProjectionEntries(input: {
	articles: readonly WeChatArticleSourceTruth[];
	consumerAdmissionBatchId?: string;
	referenceEntries?: readonly NoticeConsumptionProjectionEntry[];
	sourceCollection?: string;
	sourceCorpus?: string;
}): WeChatPublicNoticeProjectionBuildReport {
	const referenceSignals = buildReferenceSignalMap(input.referenceEntries ?? []);
	const retainedEntries: NoticeConsumptionProjectionEntry[] = [];
	const outputEntries: NoticeConsumptionProjectionEntry[] = [];
	const duplicateSourceFamilyCounts = new Map<string, number>();
	let duplicateSuppressedCount = 0;
	let retainedCount = 0;
	const sourceCorpus = input.sourceCorpus ?? WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS;
	const sourceCollection = input.sourceCollection ?? WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION;

	for (const article of input.articles) {
		const duplicateHit = findDuplicateReference({
			article,
			localEntries: retainedEntries,
			referenceSignals,
		});
		if (!duplicateHit) {
			const entry = isQueryAdmittedArticle(article)
				? buildRetainedNoticeEntry({
						article,
						consumerAdmissionBatchId: input.consumerAdmissionBatchId ?? "",
						sourceCollection,
						sourceCorpus,
					})
				: buildCapturePendingReferenceEntry({
						article,
						consumerAdmissionBatchId: input.consumerAdmissionBatchId ?? "",
						sourceCollection,
						sourceCorpus,
					});
			if (entry.consumption_status === NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY) {
				retainedCount += 1;
			}
			outputEntries.push(entry);
			retainedEntries.push(entry);
			continue;
		}
		duplicateSuppressedCount += 1;
		duplicateSourceFamilyCounts.set(
			duplicateHit.sourceFamily,
			(duplicateSourceFamilyCounts.get(duplicateHit.sourceFamily) ?? 0) + 1,
		);
		outputEntries.push(
			buildSuppressedDuplicateEntry({
				article,
				consumerAdmissionBatchId: input.consumerAdmissionBatchId ?? "",
				duplicateHit,
				sourceCollection,
				sourceCorpus,
			}),
		);
	}

	return {
		duplicateSourceFamilyCounts: Object.fromEntries(
			[...duplicateSourceFamilyCounts.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		duplicateSuppressedCount,
		projectionEntries: outputEntries.sort(compareProjectionEntries),
		retainedCount,
		totalArticleCount: input.articles.length,
	};
}

function buildRetainedNoticeEntry(input: {
	article: WeChatArticleSourceTruth;
	consumerAdmissionBatchId: string;
	sourceCollection: string;
	sourceCorpus: string;
}): NoticeConsumptionProjectionEntry {
	const metadata = buildArticleRoleMetadata(input.article, input.consumerAdmissionBatchId);
	const noticeDocumentId = `wechat_notice:${input.article.accountSlug}:${input.article.articleStableId}`;
	const unitDigest = sha256Hex(
		[
			input.article.articleStableId,
			input.article.rawVersionId,
			WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
		].join("\n"),
	).slice(0, 16);
	return {
		answerability: NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
		completeness_status: NOTICE_COMPLETENESS_COMPLETE,
		consumption_status: NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
		default_agent: NOTICE_DEFAULT_AGENT_NOTICE,
		primary_role: WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
		role_metadata: { ...metadata, dedupe_status: "unique" },
		semantic_owner: WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER,
		source_attachment_ref_ids: input.article.inlineImageRefs.map((item) => item.mediaRefId),
		source_collection: input.sourceCollection,
		source_corpus: input.sourceCorpus,
		source_document_id: noticeDocumentId,
		source_family: WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
		source_notice_document_id: noticeDocumentId,
		source_notice_id: input.article.articleStableId,
		source_notice_release_time: input.article.publishTime || null,
		target_surface: NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
		temporal_policy: NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
		unit_id: `notice_unit:wechat:${input.article.articleStableId}:${unitDigest}`,
		updated_at: input.article.publishTime,
	};
}

function buildCapturePendingReferenceEntry(input: {
	article: WeChatArticleSourceTruth;
	consumerAdmissionBatchId: string;
	sourceCollection: string;
	sourceCorpus: string;
}): NoticeConsumptionProjectionEntry {
	const retained = buildRetainedNoticeEntry(input);
	let targetSurface = NOTICE_TARGET_SURFACE_UNSUPPORTED;
	let completenessStatus = NOTICE_COMPLETENESS_REFERENCE_ONLY;
	const answerability = NOTICE_ANSWERABILITY_REFERENCE_ONLY;
	let consumptionStatus = NOTICE_CONSUMPTION_STATUS_NO_ADOPTION;
	if (
		input.article.bodyState === "captured" &&
		input.article.inlineImageOutcomes.length > 0 &&
		!hasTerminalInlineImageFailure(input.article) &&
		hasPendingInlineImageOutcome(input.article)
	) {
		targetSurface = NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE;
		completenessStatus = NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING;
		consumptionStatus = NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING;
	}
	return {
		...retained,
		answerability,
		completeness_status: completenessStatus,
		consumption_status: consumptionStatus,
		role_metadata: { ...retained.role_metadata, dedupe_status: "capture_pending" },
		target_surface: targetSurface,
	};
}

function buildSuppressedDuplicateEntry(input: {
	article: WeChatArticleSourceTruth;
	consumerAdmissionBatchId: string;
	duplicateHit: DuplicateReferenceHit;
	sourceCollection: string;
	sourceCorpus: string;
}): NoticeConsumptionProjectionEntry {
	const retained = buildRetainedNoticeEntry(input);
	return {
		...retained,
		consumption_status: NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
		role_metadata: {
			...retained.role_metadata,
			canonical_notice_id: input.duplicateHit.sourceNoticeId,
			canonical_source_family: input.duplicateHit.sourceFamily,
			dedupe_basis: input.duplicateHit.dedupeBasis,
			dedupe_status: "suppressed_duplicate",
			duplicate_of_notice_id: input.duplicateHit.sourceNoticeId,
			duplicate_of_source_family: input.duplicateHit.sourceFamily,
		},
		target_surface: NOTICE_TARGET_SURFACE_UNSUPPORTED,
	};
}

function buildArticleRoleMetadata(
	article: WeChatArticleSourceTruth,
	consumerAdmissionBatchId: string,
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		account_name: article.accountName,
		account_slug: article.accountSlug,
		article_url: article.articleUrl,
		body_excerpt: buildArticleBodyExcerpt(article),
		body_paragraph_count: article.bodyParagraphs.length,
		body_state: article.bodyState,
		capture_gate_status: captureGateStatus(article),
		content_block_count: article.contentBlockCount,
		cover_image_url: article.coverImageUrl,
		inline_image_count: article.inlineImageCount,
		inline_image_ref_ids: article.inlineImageRefs.map((item) => item.mediaRefId),
		inline_image_status_counts: inlineImageStatusCounts(article),
		media_ref_count: article.mediaRefCount,
		metadata_hash: article.metadataHash,
		multimodal_child_document_ids: article.inlineImageOutcomes
			.map((item) => item.childDocumentId)
			.filter(Boolean),
		multimodal_extracted_text: aggregateMultimodalText(article),
		multimodal_processing_status: multimodalProcessingStatus(article),
		multimodal_summary: aggregateMultimodalSummary(article),
		normalized_article_url: article.normalizedArticleUrl,
		notice_title: article.titleRaw,
		ocr_manifest_keys: article.inlineImageOutcomes
			.map((item) => item.ocrManifestKey)
			.filter(Boolean),
		ocr_required: articleOcrRequired(article),
		ocr_status: articleOcrStatus(article),
		processing_gap_reason: processingGapReason(article),
		projection_source_label: WECHAT_PUBLIC_NOTICE_SOURCE_LABEL,
		provider: article.provider,
		provider_article_id: article.providerArticleId,
		publish_day: article.publishDay,
		publish_time: article.publishTime,
		publish_time_source: article.publishTimeSource,
		source_bucket: article.bucket,
		source_channel: WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
		source_image_object_keys: article.inlineImageOutcomes
			.map((item) => item.imageObjectKey)
			.filter(Boolean),
		source_url: article.normalizedArticleUrl || article.articleUrl,
		summary_text: article.summaryText,
		title: article.titleRaw,
		title_normalized: article.titleNormalized,
		manifest_key: article.manifestKey,
		content_blocks_key: article.contentBlocksKey,
		media_refs_key: article.mediaRefsKey,
	};
	if (consumerAdmissionBatchId.trim()) {
		metadata.consumer_admission_batch_id = consumerAdmissionBatchId.trim();
	}
	return metadata;
}

function isQueryAdmittedArticle(article: WeChatArticleSourceTruth): boolean {
	if (article.bodyState !== "captured") {
		return false;
	}
	if (article.inlineImageOutcomes.length === 0) {
		return article.bodyParagraphs.length > 0;
	}
	if (hasPendingInlineImageOutcome(article) || hasTerminalInlineImageFailure(article)) {
		return false;
	}
	return Boolean(
		article.bodyParagraphs.length > 0 ||
			aggregateMultimodalText(article) ||
			aggregateMultimodalSummary(article),
	);
}

function findDuplicateReference(input: {
	article: WeChatArticleSourceTruth;
	localEntries: readonly NoticeConsumptionProjectionEntry[];
	referenceSignals: Map<string, [string, string]>;
}): DuplicateReferenceHit | null {
	for (const [dedupeBasis, signal] of dedupeSignalsForArticle(input.article)) {
		const existing = input.referenceSignals.get(signal);
		if (!existing) {
			continue;
		}
		const [sourceFamily, sourceNoticeId] = existing;
		if (
			sourceFamily === WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY &&
			sourceNoticeId === input.article.articleStableId
		) {
			continue;
		}
		if (
			sourceFamilyPriority(sourceFamily) >= sourceFamilyPriority(WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY)
		) {
			return { dedupeBasis, sourceFamily, sourceNoticeId };
		}
	}
	const localSignals = buildReferenceSignalMap(input.localEntries);
	for (const [dedupeBasis, signal] of dedupeSignalsForArticle(input.article)) {
		const existing = localSignals.get(signal);
		if (!existing) {
			continue;
		}
		const [sourceFamily, sourceNoticeId] = existing;
		if (
			sourceFamily === WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY &&
			sourceNoticeId === input.article.articleStableId
		) {
			continue;
		}
		return { dedupeBasis, sourceFamily, sourceNoticeId };
	}
	return null;
}

function buildReferenceSignalMap(
	entries: readonly NoticeConsumptionProjectionEntry[],
): Map<string, [string, string]> {
	const signalMap = new Map<string, [string, string]>();
	for (const entry of entries) {
		for (const signal of dedupeSignalsForProjectionEntry(entry)) {
			if (!signalMap.has(signal)) {
				signalMap.set(signal, [entry.source_family, entry.source_notice_id]);
			}
		}
	}
	return signalMap;
}

function dedupeSignalsForArticle(article: WeChatArticleSourceTruth): [string, string][] {
	const signals: [string, string][] = [];
	if (article.normalizedArticleUrl) {
		signals.push(["normalized_article_url", `url:${article.normalizedArticleUrl}`]);
		signals.push([
			"account_slug+normalized_article_url",
			`account_url:${article.accountSlug}:${article.normalizedArticleUrl}`,
		]);
	}
	if (article.titleNormalized && article.publishDay) {
		signals.push([
			"title+publish_day",
			`title_day:${article.titleNormalized}:${article.publishDay}`,
		]);
	}
	if (article.accountSlug && article.providerArticleId) {
		signals.push([
			"account_slug+provider_article_id",
			`provider_id:${article.accountSlug}:${article.providerArticleId}`,
		]);
	}
	return signals;
}

function dedupeSignalsForProjectionEntry(entry: NoticeConsumptionProjectionEntry): string[] {
	const metadata = entry.role_metadata ?? {};
	const accountSlug = text(metadata.account_slug);
	const normalizedArticleUrl = text(metadata.normalized_article_url) || text(metadata.source_url);
	const titleNormalized = text(metadata.title_normalized) || text(metadata.title);
	const publishDay = toPublishDay(text(metadata.publish_time) || text(metadata.published_at));
	const providerArticleId = text(metadata.provider_article_id);
	const signals: string[] = [];
	if (normalizedArticleUrl) {
		signals.push(`url:${normalizedArticleUrl}`);
	}
	if (accountSlug && normalizedArticleUrl) {
		signals.push(`account_url:${accountSlug}:${normalizedArticleUrl}`);
	}
	if (titleNormalized && publishDay) {
		signals.push(`title_day:${titleNormalized}:${publishDay}`);
	}
	if (accountSlug && providerArticleId) {
		signals.push(`provider_id:${accountSlug}:${providerArticleId}`);
	}
	return [...new Set(signals)];
}

function sourceFamilyPriority(sourceFamily: string): number {
	if (sourceFamily === "internal_notice_restricted") {
		return 3;
	}
	if (sourceFamily === "official_web_public") {
		return 2;
	}
	if (sourceFamily === WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY) {
		return 1;
	}
	return 0;
}

function articleOcrRequired(article: WeChatArticleSourceTruth): boolean {
	return article.bodyState === "captured" && article.inlineImageCount > 0;
}

function captureGateStatus(article: WeChatArticleSourceTruth): string {
	if (article.bodyState === "fetch_failed") {
		return "fetch_failed";
	}
	if (article.bodyState !== "captured") {
		return "body_not_captured";
	}
	if (article.inlineImageOutcomes.length > 0) {
		if (hasPendingInlineImageOutcome(article)) {
			return "multimodal_pending";
		}
		if (hasTerminalInlineImageFailure(article)) {
			return "multimodal_terminal_failure";
		}
		if (
			article.bodyParagraphs.length > 0 ||
			aggregateMultimodalText(article) ||
			aggregateMultimodalSummary(article)
		) {
			return "multimodal_completed";
		}
		return "multimodal_no_text";
	}
	if (article.bodyParagraphs.length > 0) {
		return "captured_body";
	}
	return "captured_without_text";
}

function articleOcrStatus(article: WeChatArticleSourceTruth): string {
	if (article.inlineImageOutcomes.length === 0) {
		return "not_needed";
	}
	if (article.bodyState !== "captured") {
		return "not_admitted";
	}
	if (hasPendingInlineImageOutcome(article)) {
		return "pending";
	}
	if (hasTerminalInlineImageFailure(article)) {
		return "terminal_failure";
	}
	if (aggregateMultimodalSummary(article) || aggregateMultimodalText(article)) {
		return "admitted";
	}
	return "no_extractable_text";
}

function multimodalProcessingStatus(article: WeChatArticleSourceTruth): string {
	if (article.inlineImageOutcomes.length === 0) {
		return "not_needed";
	}
	if (article.bodyState !== "captured") {
		return "not_admitted";
	}
	if (hasPendingInlineImageOutcome(article)) {
		return "pending";
	}
	if (hasTerminalInlineImageFailure(article)) {
		return "terminal_failure";
	}
	if (aggregateMultimodalSummary(article) || aggregateMultimodalText(article)) {
		return "completed";
	}
	return "no_extractable_text";
}

function processingGapReason(article: WeChatArticleSourceTruth): string {
	if (article.bodyState === "fetch_failed") {
		return "fetch_failed";
	}
	if (article.bodyState !== "captured") {
		return "body_not_captured";
	}
	if (article.inlineImageOutcomes.length > 0) {
		if (hasPendingInlineImageOutcome(article)) {
			return "multimodal_pending";
		}
		if (hasTerminalInlineImageFailure(article)) {
			return "multimodal_terminal_failure";
		}
		if (
			article.bodyParagraphs.length === 0 &&
			!aggregateMultimodalText(article) &&
			!aggregateMultimodalSummary(article)
		) {
			return "multimodal_no_extractable_text";
		}
	}
	return "";
}

function inlineImageStatusCounts(article: WeChatArticleSourceTruth): Record<string, number> {
	const counts = new Map<string, number>();
	for (const outcome of article.inlineImageOutcomes) {
		counts.set(outcome.status, (counts.get(outcome.status) ?? 0) + 1);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
	);
}

function hasPendingInlineImageOutcome(article: WeChatArticleSourceTruth): boolean {
	return article.inlineImageOutcomes.some((item) => item.status === "pending");
}

function hasTerminalInlineImageFailure(article: WeChatArticleSourceTruth): boolean {
	return article.inlineImageOutcomes.some(
		(item) => item.status === "fetch_failed" || item.status === "ocr_failed",
	);
}

function aggregateMultimodalSummary(article: WeChatArticleSourceTruth): string {
	return uniqueNonEmpty(article.inlineImageOutcomes.map((item) => item.summary)).join("\n\n");
}

function aggregateMultimodalText(article: WeChatArticleSourceTruth): string {
	return uniqueNonEmpty(article.inlineImageOutcomes.map((item) => item.extractedText)).join("\n\n");
}

function buildArticleBodyExcerpt(article: WeChatArticleSourceTruth): string {
	if (article.summaryText) {
		return article.summaryText.slice(0, BODY_EXCERPT_MAX_CHARS);
	}
	if (aggregateMultimodalText(article)) {
		return aggregateMultimodalText(article).slice(0, BODY_EXCERPT_MAX_CHARS);
	}
	if (aggregateMultimodalSummary(article)) {
		return aggregateMultimodalSummary(article).slice(0, BODY_EXCERPT_MAX_CHARS);
	}
	if (article.bodyParagraphs.length > 0) {
		return article.bodyParagraphs.join("\n\n").slice(0, BODY_EXCERPT_MAX_CHARS);
	}
	return article.titleNormalized.slice(0, BODY_EXCERPT_MAX_CHARS);
}
