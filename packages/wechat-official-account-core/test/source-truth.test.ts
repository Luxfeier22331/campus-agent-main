import { describe, expect, it } from "vitest";

import {
	buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage,
	validateWeChatOfficialAccountArticleSourceTruth,
} from "../src";

describe("WeChat official-account article source-truth", () => {
	it("builds canonical source-truth from the real WeChat article page with object-backed media refs", () => {
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
			mediaCaptures: [
				{
					byteSize: 321_456,
					captureStatus: "captured",
					capturedAt: "2026-04-27T08:01:03.000Z",
					contentSha256: "a".repeat(64),
					finalUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
					fetchErrorMessage: null,
					mimeType: "image/jpeg",
					normalizedSourceUrl:
						"https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
					objectKey:
						"wechat_official_account/中央民族大学学生会/2026/woa_ver_placeholder/capture/media/cover/original.jpg",
					sourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/page-cover/0?wx_fmt=jpeg",
				},
				{
					byteSize: 120_001,
					captureStatus: "captured",
					capturedAt: "2026-04-27T08:01:04.000Z",
					contentSha256: "b".repeat(64),
					finalUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
					fetchErrorMessage: null,
					mimeType: "image/jpeg",
					normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
					objectKey:
						"wechat_official_account/中央民族大学学生会/2026/woa_ver_placeholder/capture/media/inline-1/original.jpg",
					sourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
				},
				{
					byteSize: null,
					captureStatus: "fetch_failed",
					capturedAt: "2026-04-27T08:01:05.000Z",
					contentSha256: null,
					finalUrl: null,
					fetchErrorMessage: "403 Forbidden",
					mimeType: null,
					normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
					objectKey: null,
					sourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
				},
			],
		});

		expect(material.manifest).toMatchObject({
			schemaVersion: "wechat_official_account_article_manifest.v2",
			bodyState: "captured",
			captureBoundary: "real_mp_weixin_page",
			capturedInlineImageCount: 1,
			capturedPageFinalUrl: "https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw",
			failedInlineImageCount: 1,
			inlineImageCount: 2,
			pageKind: "article",
			pageParserVersion: "wechat-page-parser.v1",
			publishTime: "2026-04-26T01:15:01.000Z",
		});
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
					textRaw: "🚌通勤班车运营安排",
				}),
			]),
		);
		expect(material.mediaRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					schemaVersion: "wechat_official_account_media_ref.v2",
					resourceRole: "cover_image",
					captureStatus: "captured",
					mimeType: "image/jpeg",
					objectKey: expect.stringContaining("/capture/media/cover/"),
				}),
				expect.objectContaining({
					schemaVersion: "wechat_official_account_media_ref.v2",
					resourceRole: "inline_image",
					normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-1/0?wx_fmt=jpeg",
					captureStatus: "captured",
					contentSha256: "b".repeat(64),
				}),
				expect.objectContaining({
					schemaVersion: "wechat_official_account_media_ref.v2",
					resourceRole: "inline_image",
					normalizedSourceUrl: "https://mmbiz.qpic.cn/sz_mmbiz_jpg/example/inline-2/0?wx_fmt=jpeg",
					captureStatus: "fetch_failed",
					fetchErrorMessage: "403 Forbidden",
					objectKey: null,
				}),
			]),
		);
		expect(material.artifacts.map((artifact) => artifact.objectKey)).toEqual([
			`wechat_official_account/中央民族大学学生会/2026/${material.rawVersionId}/source-truth/article-manifest.json`,
			`wechat_official_account/中央民族大学学生会/2026/${material.rawVersionId}/source-truth/content-blocks.jsonl`,
			`wechat_official_account/中央民族大学学生会/2026/${material.rawVersionId}/source-truth/media-refs.jsonl`,
		]);
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});

	it("fails closed when the fetched page is a verification wall and preserves fallback summary metadata", () => {
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
			mediaCaptures: [],
		});

		expect(material.manifest).toMatchObject({
			schemaVersion: "wechat_official_account_article_manifest.v2",
			bodyState: "fetch_failed",
			captureBoundary: "real_mp_weixin_page",
			capturedInlineImageCount: 0,
			failedInlineImageCount: 0,
			inlineImageCount: 0,
			pageKind: "verification",
		});
		expect(material.contentBlocks).toEqual([
			expect.objectContaining({ blockRole: "title", textRaw: "验证页样例" }),
			expect.objectContaining({ blockRole: "summary", textRaw: "详情见图片" }),
		]);
		expect(material.contentBlocks.some((item) => item.blockRole === "body_paragraph")).toBe(false);
		expect(validateWeChatOfficialAccountArticleSourceTruth(material)).toEqual([]);
	});
});
