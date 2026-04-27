import { describe, expect, it } from "vitest";

import {
	buildWeChatOfficialAccountArticleSourceTruthMaterial,
	validateWeChatOfficialAccountArticleSourceTruth,
} from "../src";

describe("WeChat official-account article source-truth", () => {
	it("normalizes FeedWe history metadata into article source-truth without body content", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterial({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			article: {
				accountName: "中央民族大学学生会",
				coverUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/0?wx_fmt=jpeg",
				id: "feedwe-article-1",
				publishDate: "2025-12-16 08:00:00",
				title: "关于开展校园活动报名的通知",
				url: "https://mp.weixin.qq.com/s/F0UtP1Dx-D5OCVMQCn2Dpg?scene=1#wechat_redirect",
			},
			capturedAt: "2026-04-27T08:00:00.000Z",
		});

		expect(material.manifest).toMatchObject({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			articleIdentityBasis: "article_url",
			articleUrl: "https://mp.weixin.qq.com/s/F0UtP1Dx-D5OCVMQCn2Dpg?scene=1#wechat_redirect",
			availabilityState: "observed",
			bodyState: "not_captured",
			blockCount: 1,
			coverImageUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/0?wx_fmt=jpeg",
			mediaRefCount: 1,
			normalizedArticleUrl: "https://mp.weixin.qq.com/s/F0UtP1Dx-D5OCVMQCn2Dpg?scene=1",
			provider: "feedwe",
			providerArticleId: "feedwe-article-1",
			publishTime: "2025-12-16T00:00:00.000Z",
			publishTimeSource: "publishDate",
			schemaVersion: "wechat_official_account_article_manifest.v1",
			sourceChannel: "wechat_official_account",
			titleNormalized: "关于开展校园活动报名的通知",
			titleRaw: "关于开展校园活动报名的通知",
		});
		expect(material.year).toBe("2025");
		expect(material.rawAssetId).toMatch(/^woa_asset_[a-f0-9]{24}$/);
		expect(material.rawVersionId).toMatch(/^woa_ver_[a-f0-9]{24}$/);
		expect(material.articleStableId).toMatch(/^woa_article_[a-f0-9]{24}$/);
		expect(material.contentBlocks).toEqual([
			expect.objectContaining({
				blockRole: "title",
				textNormalized: "关于开展校园活动报名的通知",
			}),
		]);
		expect(material.mediaRefs).toEqual([
			expect.objectContaining({
				resourceRole: "cover_image",
				normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/0?wx_fmt=jpeg",
			}),
		]);
		expect(JSON.stringify(material)).not.toContain("document_id");
		expect(JSON.stringify(material)).not.toContain("chunk_id");
		expect(JSON.stringify(material)).not.toContain("embedding");
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});

	it("uses provider article id as fail-closed identity fallback when URL is absent", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterial({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			article: {
				id: "feedwe-only-id",
				publishDate: "2025-12-16 08:00:00",
				title: "无 URL 文章",
			},
			capturedAt: "2026-04-27T08:00:00.000Z",
		});

		expect(material.manifest.articleIdentityBasis).toBe("provider_article_id");
		expect(material.manifest.normalizedArticleUrl).toBeNull();
		expect(material.manifest.providerArticleId).toBe("feedwe-only-id");
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});

	it("rejects articles without title or stable identity", () => {
		expect(() =>
			buildWeChatOfficialAccountArticleSourceTruthMaterial({
				accountName: "中央民族大学学生会",
				accountSlug: "中央民族大学学生会",
				article: {
					publishDate: "2025-12-16 08:00:00",
				},
				capturedAt: "2026-04-27T08:00:00.000Z",
			}),
		).toThrow("title is required");

		expect(() =>
			buildWeChatOfficialAccountArticleSourceTruthMaterial({
				accountName: "中央民族大学学生会",
				accountSlug: "中央民族大学学生会",
				article: {
					title: "缺少稳定身份",
				},
				capturedAt: "2026-04-27T08:00:00.000Z",
			}),
		).toThrow("article url or provider article id is required");
	});

	it("serializes source-truth artifacts under ADR-0002 source prefix", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterial({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			article: {
				id: "feedwe-article-1",
				publishDate: "2025-12-16 08:00:00",
				title: "关于开展校园活动报名的通知",
				url: "https://mp.weixin.qq.com/s/F0UtP1Dx-D5OCVMQCn2Dpg",
			},
			capturedAt: "2026-04-27T08:00:00.000Z",
		});

		expect(material.artifacts.map((artifact) => artifact.objectKey)).toEqual([
			`wechat_official_account/中央民族大学学生会/2025/${material.rawVersionId}/source-truth/article-manifest.json`,
			`wechat_official_account/中央民族大学学生会/2025/${material.rawVersionId}/source-truth/content-blocks.jsonl`,
			`wechat_official_account/中央民族大学学生会/2025/${material.rawVersionId}/source-truth/media-refs.jsonl`,
		]);
		expect(material.artifacts[0]?.contentType).toBe("application/json");
		expect(material.artifacts[1]?.contentType).toBe("application/x-ndjson");
	});
});
