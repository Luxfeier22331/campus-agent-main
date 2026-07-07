import { describe, expect, it } from "vitest";
import {
	buildWeChatPublicNoticeProjectionReportFromSourceTruth,
	buildWeChatPublicNoticeReadModelResult,
	type NoticeConsumptionProjectionEntry,
	type ObjectStore,
	sha256Hex,
	type WeChatSourceTruthArtifactRefs,
} from "../src/index.ts";

const SOURCE_BUCKET = "campus-agent-source";

describe("wechat public notice projection", () => {
	it("retains captured text articles and demotes uncaptured articles", async () => {
		const objectStore = new InMemoryObjectStore(SOURCE_BUCKET);
		const retainedRefs = objectStore.putArticle({
			articleStableId: "woa_article_captured",
			bodyBlockTexts: ["第一段正文"],
			bodyState: "captured",
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/captured",
			prefix: "wechat_official_account/muc/2026/woa_ver_captured",
			providerArticleId: "feedwe-captured",
			title: "关于教学安排调整的通知",
		});
		const pendingRefs = objectStore.putArticle({
			articleStableId: "woa_article_pending",
			bodyState: "not_captured",
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/pending",
			prefix: "wechat_official_account/muc/2026/woa_ver_pending",
			providerArticleId: "feedwe-pending",
			title: "只有链接的通知",
		});

		const report = await buildWeChatPublicNoticeProjectionReportFromSourceTruth({
			artifactRefs: [retainedRefs, pendingRefs],
			objectStore,
		});

		expect(report.totalArticleCount).toBe(2);
		expect(report.retainedCount).toBe(1);
		const byNoticeId = indexByNoticeId(report.projectionEntries);
		expect(byNoticeId.woa_article_captured.target_surface).toBe("notice_level_query");
		expect(byNoticeId.woa_article_captured.consumption_status).toBe("retained_for_notice_query");
		expect(byNoticeId.woa_article_captured.role_metadata).toMatchObject({
			body_state: "captured",
			capture_gate_status: "captured_body",
			dedupe_status: "unique",
			ocr_required: false,
			provider: "feedwe",
		});
		expect(byNoticeId.woa_article_pending.target_surface).toBe("unsupported");
		expect(byNoticeId.woa_article_pending.consumption_status).toBe("no_adoption");
		expect(byNoticeId.woa_article_pending.role_metadata).toMatchObject({
			body_state: "not_captured",
			capture_gate_status: "body_not_captured",
			dedupe_status: "capture_pending",
		});
	});

	it("uses inline-image OCR status to move articles between pending, retained, and terminal states", async () => {
		const objectStore = new InMemoryObjectStore(SOURCE_BUCKET);
		const pendingRefs = objectStore.putArticle({
			articleStableId: "woa_article_multimodal_pending",
			bodyBlockTexts: ["详情见配图。"],
			bodyState: "captured",
			inlineImageUrls: ["https://cdn.example.com/inline-1.png"],
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/multimodal-pending",
			prefix: "wechat_official_account/muc/2026/woa_ver_multimodal_pending",
			providerArticleId: "feedwe-multimodal-pending",
			title: "实践周班车安排图示待处理",
		});
		const readyRefs = objectStore.putArticle({
			articleStableId: "woa_article_multimodal_ready",
			bodyState: "captured",
			inlineImageUrls: ["https://cdn.example.com/inline-2.png"],
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/multimodal-ready",
			prefix: "wechat_official_account/muc/2026/woa_ver_multimodal_ready",
			providerArticleId: "feedwe-multimodal-ready",
			title: "实践周班车安排图示已识别",
		});
		objectStore.putOcrManifest({
			mediaRefId: "woa_article_multimodal_ready:media:1",
			mediaRefsKey: readyRefs.mediaRefsKey,
			payload: {
				child_document_id: "wechat_notice_image:muc:woa_article_multimodal_ready:media-1",
				error: "",
				extracted_text: "4月22日 08:00 海淀校区发车；18:30 丰台校区返程。",
				image_object_key:
					"wechat_official_account/muc/2026/woa_ver_multimodal_ready/capture/media/inline-1/original.png",
				model: "gpt-4.1-mini",
				provider: "openai-chat-completions",
				status: "admitted",
				summary: "图中列出了实践周班车加车安排。",
			},
		});
		const failedRefs = objectStore.putArticle({
			articleStableId: "woa_article_multimodal_failed",
			bodyBlockTexts: ["详情见配图。"],
			bodyState: "captured",
			inlineImageUrls: ["https://cdn.example.com/inline-3.png"],
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/multimodal-failed",
			prefix: "wechat_official_account/muc/2026/woa_ver_multimodal_failed",
			providerArticleId: "feedwe-multimodal-failed",
			title: "实践周班车安排图示失败",
		});
		objectStore.putOcrManifest({
			mediaRefId: "woa_article_multimodal_failed:media:1",
			mediaRefsKey: failedRefs.mediaRefsKey,
			payload: {
				error: "provider timeout",
				status: "ocr_failed",
			},
		});

		const report = await buildWeChatPublicNoticeProjectionReportFromSourceTruth({
			artifactRefs: [pendingRefs, readyRefs, failedRefs],
			objectStore,
		});

		const byNoticeId = indexByNoticeId(report.projectionEntries);
		expect(byNoticeId.woa_article_multimodal_pending.target_surface).toBe(
			"multimodal_processing_candidate",
		);
		expect(byNoticeId.woa_article_multimodal_pending.consumption_status).toBe(
			"pending_multimodal_processing",
		);
		expect(byNoticeId.woa_article_multimodal_pending.role_metadata).toMatchObject({
			capture_gate_status: "multimodal_pending",
			ocr_required: true,
			ocr_status: "pending",
		});
		expect(byNoticeId.woa_article_multimodal_ready.target_surface).toBe("notice_level_query");
		expect(byNoticeId.woa_article_multimodal_ready.role_metadata).toMatchObject({
			ocr_status: "admitted",
			multimodal_processing_status: "completed",
		});
		expect(
			String(byNoticeId.woa_article_multimodal_ready.role_metadata.multimodal_extracted_text),
		).toContain("08:00");
		expect(byNoticeId.woa_article_multimodal_failed.target_surface).toBe("unsupported");
		expect(byNoticeId.woa_article_multimodal_failed.consumption_status).toBe("no_adoption");
		expect(byNoticeId.woa_article_multimodal_failed.role_metadata).toMatchObject({
			capture_gate_status: "multimodal_terminal_failure",
			ocr_status: "terminal_failure",
			processing_gap_reason: "multimodal_terminal_failure",
		});
	});

	it("suppresses duplicate WeChat articles when a higher-priority reference already exists", async () => {
		const objectStore = new InMemoryObjectStore(SOURCE_BUCKET);
		const refs = objectStore.putArticle({
			articleStableId: "woa_article_duplicate",
			bodyBlockTexts: ["正文"],
			bodyState: "captured",
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/duplicate",
			prefix: "wechat_official_account/muc/2026/woa_ver_duplicate",
			providerArticleId: "feedwe-duplicate",
			title: "校园开放日活动安排",
		});
		const referenceEntry = projectionReferenceEntry({
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/duplicate",
			sourceFamily: "official_web_public",
			sourceNoticeId: "official:notice:001",
			title: "校园开放日活动安排",
		});

		const report = await buildWeChatPublicNoticeProjectionReportFromSourceTruth({
			artifactRefs: [refs],
			objectStore,
			referenceEntries: [referenceEntry],
		});

		expect(report.retainedCount).toBe(0);
		expect(report.duplicateSuppressedCount).toBe(1);
		expect(report.duplicateSourceFamilyCounts).toEqual({ official_web_public: 1 });
		expect(report.projectionEntries[0]?.target_surface).toBe("unsupported");
		expect(report.projectionEntries[0]?.role_metadata).toMatchObject({
			dedupe_status: "suppressed_duplicate",
			duplicate_of_notice_id: "official:notice:001",
			duplicate_of_source_family: "official_web_public",
		});
	});

	it("fails closed when WeChat source truth contains forbidden downstream fields", async () => {
		const objectStore = new InMemoryObjectStore(SOURCE_BUCKET);
		const refs = objectStore.putArticle({
			articleStableId: "woa_article_bad",
			bodyState: "not_captured",
			manifestOverrides: { document_id: "forbidden" },
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/bad",
			prefix: "wechat_official_account/muc/2026/woa_ver_bad",
			providerArticleId: "feedwe-bad",
			title: "错误示例",
		});

		await expect(
			buildWeChatPublicNoticeProjectionReportFromSourceTruth({
				artifactRefs: [refs],
				objectStore,
			}),
		).rejects.toThrow("wechat source truth contains forbidden fields");
	});

	it("builds read-model rows and canonical markdown artifacts for queryable WeChat entries", async () => {
		const objectStore = new InMemoryObjectStore(SOURCE_BUCKET);
		const refs = objectStore.putArticle({
			articleStableId: "woa_article_captured",
			bodyBlockTexts: ["第一段正文", "第二段正文"],
			bodyState: "captured",
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/captured",
			prefix: "wechat_official_account/muc/2026/woa_ver_captured",
			providerArticleId: "feedwe-captured",
			title: "实践周班车安排",
		});
		const report = await buildWeChatPublicNoticeProjectionReportFromSourceTruth({
			artifactRefs: [refs],
			objectStore,
		});

		const result = await buildWeChatPublicNoticeReadModelResult({
			entries: report.projectionEntries,
			objectStore,
			sourceBucket: SOURCE_BUCKET,
		});

		expect(result.readModelEntries).toHaveLength(1);
		const row = result.readModelEntries[0];
		expect(row?.queryable).toBe(true);
		expect(row?.source_url).toBe("https://mp.weixin.qq.com/s/captured");
		expect(row?.canonical_markdown_object_key).toBeTruthy();
		expect(result.canonicalMarkdownArtifacts).toHaveLength(1);
		const artifact = result.canonicalMarkdownArtifacts[0];
		expect(artifact?.objectKey).toBe(row?.canonical_markdown_object_key);
		expect(artifact?.contentType).toBe("text/markdown; charset=utf-8");
		expect(new TextDecoder().decode(artifact?.data)).toContain("# 实践周班车安排");
		expect(new TextDecoder().decode(artifact?.data)).toContain("第一段正文");
	});
});

function indexByNoticeId(
	entries: readonly NoticeConsumptionProjectionEntry[],
): Record<string, NoticeConsumptionProjectionEntry> {
	return Object.fromEntries(entries.map((entry) => [entry.source_notice_id, entry]));
}

class InMemoryObjectStore implements ObjectStore {
	readonly #objects = new Map<string, Uint8Array>();
	readonly bucket: string;

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const object = this.#objects.get(input.key);
		if (!object) {
			throw new Error(`missing object: ${input.key}`);
		}
		return object;
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		this.#objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256Hex(input.body),
		};
	}

	putArticle(input: {
		articleStableId: string;
		bodyBlockTexts?: readonly string[];
		bodyState: "captured" | "fetch_failed" | "not_captured";
		inlineImageUrls?: readonly string[];
		manifestOverrides?: Record<string, unknown>;
		normalizedArticleUrl: string;
		prefix: string;
		providerArticleId: string;
		title: string;
	}): WeChatSourceTruthArtifactRefs {
		const refs = {
			articleManifestKey: `${input.prefix}/source-truth/article-manifest.json`,
			bucket: this.bucket,
			contentBlocksKey: `${input.prefix}/source-truth/content-blocks.jsonl`,
			mediaRefsKey: `${input.prefix}/source-truth/media-refs.jsonl`,
		};
		const contentBlocks = [
			{
				blockOrder: 0,
				blockRole: "title",
				rawAssetId: `woa_asset:${input.articleStableId}`,
				rawVersionId: `woa_ver:${input.articleStableId}`,
				rowId: `${input.articleStableId}:block:0`,
				rowIndex: 0,
				schemaVersion: "wechat_official_account_content_block.v1",
				textNormalized: input.title,
				textRaw: input.title,
			},
			...(input.bodyBlockTexts ?? []).map((text, index) => ({
				blockOrder: index + 1,
				blockRole: "body_paragraph",
				rawAssetId: `woa_asset:${input.articleStableId}`,
				rawVersionId: `woa_ver:${input.articleStableId}`,
				rowId: `${input.articleStableId}:block:${index + 1}`,
				rowIndex: index + 1,
				schemaVersion: "wechat_official_account_content_block.v1",
				textNormalized: text,
				textRaw: text,
			})),
		];
		const mediaRefs = [
			{
				byteSize: 11,
				captureStatus: "captured",
				capturedAt: "2026-04-22T00:00:00+08:00",
				contentSha256: "c".repeat(64),
				fetchErrorMessage: null,
				finalUrl: "https://cdn.example.com/cover.png",
				mediaRefId: `${input.articleStableId}:media:0`,
				mimeType: "image/png",
				normalizedSourceUrl: "https://cdn.example.com/cover.png",
				objectKey: `${input.prefix}/capture/media/cover/original.png`,
				rawAssetId: `woa_asset:${input.articleStableId}`,
				rawVersionId: `woa_ver:${input.articleStableId}`,
				refOrder: 0,
				resourceRole: "cover_image",
				schemaVersion: "wechat_official_account_media_ref.v2",
				sourceUrl: "https://cdn.example.com/cover.png",
			},
			...(input.inlineImageUrls ?? []).map((url, index) => ({
				byteSize: 100 + index,
				captureStatus: "captured",
				capturedAt: "2026-04-22T00:00:00+08:00",
				contentSha256: String(index + 1).repeat(64),
				fetchErrorMessage: null,
				finalUrl: url,
				mediaRefId: `${input.articleStableId}:media:${index + 1}`,
				mimeType: "image/png",
				normalizedSourceUrl: url,
				objectKey: `${input.prefix}/capture/media/inline-${index + 1}/original.png`,
				rawAssetId: `woa_asset:${input.articleStableId}`,
				rawVersionId: `woa_ver:${input.articleStableId}`,
				refOrder: index + 1,
				resourceRole: "inline_image",
				schemaVersion: "wechat_official_account_media_ref.v2",
				sourceUrl: url,
			})),
		];
		const manifest = {
			accountName: "示例大学学生会",
			accountSlug: "muc",
			articleIdentityBasis: "article_url",
			articleStableId: input.articleStableId,
			articleUrl: input.normalizedArticleUrl,
			availabilityState: "observed",
			blockCount: contentBlocks.length,
			bodyState: input.bodyState,
			captureBoundary: "real_mp_weixin_page",
			capturedAt: "2026-04-22T00:00:00+08:00",
			capturedInlineImageCount: input.inlineImageUrls?.length ?? 0,
			capturedPageFinalUrl: input.normalizedArticleUrl,
			coverImageUrl: "https://cdn.example.com/cover.png",
			failedInlineImageCount: 0,
			inlineImageCount: input.inlineImageUrls?.length ?? 0,
			mediaRefCount: mediaRefs.length,
			metadataHash: `sha256:${input.articleStableId}`,
			normalizedArticleUrl: input.normalizedArticleUrl,
			pageKind: input.bodyState === "captured" ? "article" : "verification",
			pageParserVersion: "wechat-page-parser.v1",
			provider: "feedwe",
			providerArticleId: input.providerArticleId,
			publishTime: "2026-04-20T08:00:00+08:00",
			publishTimeSource: "provider",
			rawAssetId: `woa_asset:${input.articleStableId}`,
			rawVersionId: `woa_ver:${input.articleStableId}`,
			schemaVersion: "wechat_official_account_article_manifest.v2",
			sourceChannel: "wechat_official_account",
			titleNormalized: input.title,
			titleRaw: input.title,
			...input.manifestOverrides,
		};
		this.putJson(refs.articleManifestKey, manifest);
		this.putJsonLines(refs.contentBlocksKey, contentBlocks);
		this.putJsonLines(refs.mediaRefsKey, mediaRefs);
		return refs;
	}

	putOcrManifest(input: {
		mediaRefId: string;
		mediaRefsKey: string;
		payload: Record<string, unknown>;
	}): void {
		this.putJson(
			buildInlineImageArtifactKeys({
				mediaRefId: input.mediaRefId,
				mediaRefsKey: input.mediaRefsKey,
			}).ocrManifestKey,
			input.payload,
		);
	}

	private putJson(key: string, value: unknown): void {
		this.#objects.set(key, new TextEncoder().encode(JSON.stringify(value)));
	}

	private putJsonLines(key: string, rows: readonly unknown[]): void {
		this.#objects.set(
			key,
			new TextEncoder().encode(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`),
		);
	}
}

function buildInlineImageArtifactKeys(input: { mediaRefId: string; mediaRefsKey: string }): {
	ocrManifestKey: string;
} {
	const articlePrefix = input.mediaRefsKey.replace(/\/source-truth\/media-refs\.jsonl$/u, "");
	return {
		ocrManifestKey: `${articlePrefix}/projection/wechat_public_notice/multimodal/${slugifySegment(input.mediaRefId)}/ocr-manifest.json`,
	};
}

function slugifySegment(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^a-zA-Z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.toLowerCase();
	return normalized.slice(0, 96) || sha256Hex(value).slice(0, 16);
}

function projectionReferenceEntry(input: {
	normalizedArticleUrl: string;
	sourceFamily: string;
	sourceNoticeId: string;
	title: string;
}): NoticeConsumptionProjectionEntry {
	return {
		answerability: "reference_only",
		completeness_status: "reference_only",
		consumption_status: "retained_for_notice_query",
		default_agent: "notice",
		primary_role: "notice_window",
		role_metadata: {
			normalized_article_url: input.normalizedArticleUrl,
			publish_time: "2026-04-20T11:00:00+08:00",
			title_normalized: input.title,
		},
		semantic_owner: "notice_body",
		source_attachment_ref_ids: [],
		source_collection: "internal_notice",
		source_corpus: "campus_notices",
		source_document_id: `notice:${input.sourceNoticeId}`,
		source_family: input.sourceFamily,
		source_notice_document_id: `notice:${input.sourceNoticeId}`,
		source_notice_id: input.sourceNoticeId,
		source_notice_release_time: "2026-04-20T11:00:00+08:00",
		target_surface: "notice_level_query",
		temporal_policy: "announcement_window",
		unit_id: `notice_unit:${input.sourceFamily}:${input.sourceNoticeId}`,
		updated_at: "2026-04-20T11:00:00+08:00",
	};
}
