import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { collectHtmlVisualReferenceCandidates } from "../src/html-visual-references";
import {
	buildVisualReferenceAuditReport,
	collectVisualReferenceAudit,
	writeVisualReferenceAuditReport,
} from "../src/visual-ref-audit-core";

it("classifies visual reference patterns from notice html", () => {
	const candidates = collectHtmlVisualReferenceCandidates(
		[
			'<p><img data-src="/upload/lazy.png" alt="懒加载图.png"/></p>',
			'<p><img srcset="/upload/small.jpg 480w, /upload/large.jpg 960w" title="响应式图"/></p>',
			'<picture><source srcset="/upload/source.webp 1x, /upload/source@2x.webp 2x"></picture>',
			'<p><span style="background-image: url(&quot;/upload/bg.png&quot;)"></span></p>',
		].join(""),
	);

	expect(candidates.map((candidate) => candidate.pattern)).toEqual([
		"img_lazy_attr",
		"img_srcset",
		"img_srcset",
		"source_srcset",
		"source_srcset",
		"style_url",
	]);
	expect(candidates.map((candidate) => candidate.rawUrl)).toEqual([
		"/upload/lazy.png",
		"/upload/small.jpg",
		"/upload/large.jpg",
		"/upload/source.webp",
		"/upload/source@2x.webp",
		"/upload/bg.png",
	]);
});

it("builds a read-only visual reference audit report", () => {
	const report = buildVisualReferenceAuditReport({
		generatedAt: "2026-04-26T22:30:00.000Z",
		siteId: "muc_internal_portal",
		sourceHomeUrl: "https://portal.example.edu/home",
		notices: [
			{
				noticeId: 355550,
				noticeType: "5",
				noticeTypeName: "办公通知",
				title: "关于图示区域调整的通知",
				htmlValue: [
					'<p><img data-src="/upload/lazy.png" alt="懒加载图.png"/></p>',
					'<p><img srcset="/upload/small.jpg 480w, /upload/large.jpg 960w" title="响应式图"/></p>',
					'<picture><source srcset="/upload/source.webp 1x"></picture>',
					'<p><span style="background-image: url(&quot;/upload/bg.png&quot;)"></span></p>',
				].join(""),
			},
		],
	});

	expect(report).toEqual({
		generated_at: "2026-04-26T22:30:00.000Z",
		site_id: "muc_internal_portal",
		source_home_url: "https://portal.example.edu/home",
		summary: {
			notices_scanned: 1,
			notices_with_visual_refs: 1,
			candidates_found: 5,
			pattern_counts: {
				img_lazy_attr: 1,
				img_src: 0,
				img_srcset: 2,
				source_srcset: 1,
				style_url: 1,
			},
		},
		candidates: [
			{
				attribute_name: "data-src",
				link_text: "懒加载图.png",
				notice_id: 355550,
				notice_title: "关于图示区域调整的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
				pattern: "img_lazy_attr",
				raw_url: "/upload/lazy.png",
				resolved_url: "https://portal.example.edu/upload/lazy.png",
				source_tag: "img",
			},
			{
				attribute_name: "srcset",
				link_text: "响应式图",
				notice_id: 355550,
				notice_title: "关于图示区域调整的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
				pattern: "img_srcset",
				raw_url: "/upload/small.jpg",
				resolved_url: "https://portal.example.edu/upload/small.jpg",
				source_tag: "img",
			},
			{
				attribute_name: "srcset",
				link_text: "响应式图",
				notice_id: 355550,
				notice_title: "关于图示区域调整的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
				pattern: "img_srcset",
				raw_url: "/upload/large.jpg",
				resolved_url: "https://portal.example.edu/upload/large.jpg",
				source_tag: "img",
			},
			{
				attribute_name: "srcset",
				link_text: null,
				notice_id: 355550,
				notice_title: "关于图示区域调整的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
				pattern: "source_srcset",
				raw_url: "/upload/source.webp",
				resolved_url: "https://portal.example.edu/upload/source.webp",
				source_tag: "source",
			},
			{
				attribute_name: "style",
				link_text: null,
				notice_id: 355550,
				notice_title: "关于图示区域调整的通知",
				notice_type: "5",
				notice_type_name: "办公通知",
				pattern: "style_url",
				raw_url: "/upload/bg.png",
				resolved_url: "https://portal.example.edu/upload/bg.png",
				source_tag: "style",
			},
		],
	});
});

it("collects a selected visual reference audit without materializing attachments", async () => {
	const report = await collectVisualReferenceAudit({
		createApiContext: async () => ({
			dispose: async () => undefined,
			get: async () => {
				throw new Error("audit must not download visual refs");
			},
			post: async () => {
				throw new Error("unexpected raw API post");
			},
		}),
		collectionMode: "selected",
		generatedAt: "2026-04-26T22:30:00.000Z",
		fetchNoticeDetail: async ({ noticeId, noticeType }) => ({
			datas: {
				notice_info: {
					home_url: "https://portal.example.edu/home",
					notice_content: '<p><img src="/upload/live.png" alt="现场图.png"/></p>',
					notice_id: noticeId,
					notice_title: "关于图示区域调整的通知",
					notice_type_name: noticeType === "5" ? "办公通知" : null,
				},
			},
			state: true,
		}),
		fetchNoticePage: async () => {
			throw new Error("selected audit must not scan list pages");
		},
		noticeTypes: [
			{
				backfillPageSize: 20,
				backfillPages: 1,
				enabled: true,
				incrementalPageSize: 20,
				incrementalPages: 1,
				name: "办公通知",
				type: "5",
			},
		],
		requestBackoffBaseMs: 1,
		requestMaxRetries: 1,
		selectedNotices: [
			{
				noticeId: 355550,
				noticeType: "5",
			},
		],
		siteId: "muc_internal_portal",
		sourceHomeUrl: "https://portal.example.edu/home",
	});

	expect(report.summary).toEqual({
		candidates_found: 1,
		notices_scanned: 1,
		notices_with_visual_refs: 1,
		pattern_counts: {
			img_lazy_attr: 0,
			img_src: 1,
			img_srcset: 0,
			source_srcset: 0,
			style_url: 0,
		},
	});
	expect(report.candidates).toEqual([
		{
			attribute_name: "src",
			link_text: "现场图.png",
			notice_id: 355550,
			notice_title: "关于图示区域调整的通知",
			notice_type: "5",
			notice_type_name: "办公通知",
			pattern: "img_src",
			raw_url: "/upload/live.png",
			resolved_url: "https://portal.example.edu/upload/live.png",
			source_tag: "img",
		},
	]);
});

it("writes a visual reference audit report", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "visual-ref-audit-"));
	try {
		const report = buildVisualReferenceAuditReport({
			generatedAt: "2026-04-26T22:30:00.000Z",
			notices: [],
			siteId: "muc_internal_portal",
			sourceHomeUrl: "https://portal.example.edu/home",
		});

		const written = writeVisualReferenceAuditReport({
			outputDir: tempDir,
			report,
		});

		expect(path.basename(written.reportPath)).toBe("visual-reference-candidates.json");
		expect(JSON.parse(fs.readFileSync(written.reportPath, "utf-8"))).toEqual(report);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
