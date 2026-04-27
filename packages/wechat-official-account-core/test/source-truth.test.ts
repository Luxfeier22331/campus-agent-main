import { describe, expect, it } from "vitest";

import {
	buildWeChatOfficialAccountArticleSourceTruthMaterial,
	buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage,
	buildWeChatOfficialAccountArticleSourceTruthMaterialFromFeedWeDiscoveryArticle,
	buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWeDiscoveryPage,
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

	it("keeps FeedWe discovery summary as fallback metadata without promoting it into captured body", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterialFromFeedWeDiscoveryArticle(
			{
				accountName: "中央民族大学学生会",
				accountSlug: "中央民族大学学生会",
				article: {
					author: "中央民族大学学生会",
					coverImage: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/feedwe-cover/0?wx_fmt=jpeg",
					id: "feedwe-auth-article-1",
					publishDate: "2026-04-26T01:14:40.000Z",
					summary:
						"有乘车需求的MUCer注意啦\n4月27日—5月5日期间\n通勤车辆有所调整\n\n🚌通勤班车运营安排\n【4月27日】实行工作日时间表",
					title: "MUC出行快讯｜加车！实践周班车合集来啦～",
					url: "https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw",
				},
				capturedAt: "2026-04-27T08:00:00.000Z",
			},
		);

		expect(material.manifest.bodyState).toBe("not_captured");
		expect(material.manifest.publishTime).toBe("2026-04-26T01:14:40.000Z");
		expect(material.manifest.publishTimeSource).toBe("publishDate");
		expect(material.manifest.coverImageUrl).toBe(
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/feedwe-cover/0?wx_fmt=jpeg",
		);
		expect(material.contentBlocks).toEqual([
			expect.objectContaining({
				blockRole: "title",
				textRaw: "MUC出行快讯｜加车！实践周班车合集来啦～",
			}),
			expect.objectContaining({
				blockRole: "summary",
				textRaw:
					"有乘车需求的MUCer注意啦\n4月27日—5月5日期间\n通勤车辆有所调整\n\n🚌通勤班车运营安排\n【4月27日】实行工作日时间表",
			}),
		]);
		expect(material.contentBlocks.some((item) => item.blockRole === "body_paragraph")).toBe(false);
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});

	it("replays FeedWe provider pages as metadata-only source-truth even when summary text is present", () => {
		const materials = buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWeDiscoveryPage({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			capturedAt: "2026-04-27T08:00:00.000Z",
			page: {
				raw: {
					articles: [
						{
							id: "feedwe-auth-article-1",
							publishDate: "2026-04-26T01:14:40.000Z",
							summary: "第一段\n第二段",
							title: "正文来自 FeedWe",
							url: "https://mp.weixin.qq.com/s/provider-article",
						},
					],
				},
			},
		});

		expect(materials).toHaveLength(1);
		expect(materials[0]?.manifest.bodyState).toBe("not_captured");
		expect(materials[0]?.contentBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ blockRole: "summary", textRaw: "第一段\n第二段" }),
			]),
		);
		expect(materials[0]?.contentBlocks.some((item) => item.blockRole === "body_paragraph")).toBe(
			false,
		);
	});

	it("builds captured-body source-truth from the real WeChat article page", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			article: {
				accountName: "中央民族大学学生会",
				coverUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/feedwe-cover/0?wx_fmt=jpeg",
				id: "feedwe-article-2",
				publishDate: "2026-04-26 09:15:01",
				title: "MUC出行快讯｜加车！实践周班车合集来啦～",
				url: "https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw#wechat_redirect",
			},
			capturedAt: "2026-04-27T08:00:00.000Z",
			page: {
				bodyBlocks: [
					"有乘车需求的MUCer注意啦",
					"4月27日—5月5日期间通勤车辆有所调整",
					"🚌通勤班车运营安排",
				],
				contentType: "text/html; charset=utf-8",
				coverImageUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
				fetchedAt: "2026-04-27T08:01:00.000Z",
				finalUrl: "https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw",
				inlineImageUrls: [
					"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
					"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
				],
				pageKind: "article",
				parserVersion: "wechat-page-parser.v1",
				publishTime: "2026-04-26T01:15:01.000Z",
				publishTimeSource: "window.ct",
				statusCode: 200,
				summary: "有乘车需求的MUCer注意啦\n4月27日—5月5日期间\n通勤车辆有所调整",
				title: "MUC出行快讯｜加车！实践周班车合集来啦～",
			},
		});

		expect(material.manifest.bodyState).toBe("captured");
		expect(material.manifest.publishTime).toBe("2026-04-26T01:15:01.000Z");
		expect(material.manifest.coverImageUrl).toBe(
			"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
		);
		expect(material.contentBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockRole: "title",
					textRaw: "MUC出行快讯｜加车！实践周班车合集来啦～",
				}),
				expect.objectContaining({
					blockRole: "summary",
					textRaw: "有乘车需求的MUCer注意啦\n4月27日—5月5日期间\n通勤车辆有所调整",
				}),
				expect.objectContaining({
					blockRole: "body_paragraph",
					textRaw: "有乘车需求的MUCer注意啦",
				}),
			]),
		);
		expect(material.mediaRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					resourceRole: "cover_image",
					normalizedSourceUrl:
						"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
				}),
				expect.objectContaining({
					resourceRole: "inline_image",
					normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
				}),
			]),
		);
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});

	it("fails closed when the fetched page is a verification wall and preserves only fallback summary metadata", () => {
		const material = buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage({
			accountName: "中央民族大学学生会",
			accountSlug: "中央民族大学学生会",
			article: {
				id: "feedwe-article-verify",
				publishDate: "2026-04-26 09:15:01",
				summary: "详情见图片",
				title: "验证页样例",
				url: "https://mp.weixin.qq.com/s/verify-wall",
			},
			capturedAt: "2026-04-27T08:00:00.000Z",
			page: {
				bodyBlocks: [],
				contentType: "text/html; charset=utf-8",
				coverImageUrl: null,
				fetchedAt: "2026-04-27T08:01:00.000Z",
				finalUrl: "https://mp.weixin.qq.com/s/verify-wall",
				inlineImageUrls: [],
				pageKind: "verification",
				parserVersion: "wechat-page-parser.v1",
				publishTime: null,
				publishTimeSource: null,
				statusCode: 200,
				summary: null,
				title: null,
			},
		});

		expect(material.manifest.bodyState).toBe("fetch_failed");
		expect(material.contentBlocks).toEqual([
			expect.objectContaining({ blockRole: "title", textRaw: "验证页样例" }),
			expect.objectContaining({ blockRole: "summary", textRaw: "详情见图片" }),
		]);
		expect(material.contentBlocks.some((item) => item.blockRole === "body_paragraph")).toBe(false);
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});
});
