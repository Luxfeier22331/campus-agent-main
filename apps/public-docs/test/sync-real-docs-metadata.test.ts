import { describe, expect, it } from "vitest";
import {
	buildCurriculumMetaEntries,
	buildGroupMetaEntries,
	buildHandbookMetaEntries,
	buildTopLevelMetaEntries,
} from "../scripts/sync-real-docs";
import { buildPublicRegulationMarkdown } from "../scripts/sync-real-docs/regulations";
import { formatJsonContent } from "../scripts/sync-real-docs/shared";

describe("public-docs navigation and metadata generation", () => {
	it("formats generated metadata JSON with tab indentation", () => {
		expect(formatJsonContent(["index", "law-ethnic-experimental-program"])).toBe(
			'[\n\t"index",\n\t"law-ethnic-experimental-program"\n]\n',
		);
	});

	it("builds labeled sidebar metadata without redundant collection overview entries", () => {
		expect(buildTopLevelMetaEntries({ includePublicRegulations: false })[0]).toEqual({
			type: "file",
			name: "index",
			label: "文档首页",
		});
		expect(
			buildHandbookMetaEntries({
				flowGraphDocs: [
					{
						slug: "central-minzu-student-dormitory-management-workflow",
						title: "中央民族大学学生公寓管理工作流程",
						filename: "central-minzu-student-dormitory-management-workflow.mdx",
					},
				],
				handbookDocs: [
					{
						slug: "credit-system",
						title: "中央民族大学本科学分制实施办法",
						documentId: "handbook:test",
					},
				],
			}),
		).toEqual([
			{ type: "dir", name: "workflows", label: "办事流程", collapsed: true },
			{ type: "dir", name: "academic", label: "学籍与教学", collapsed: true },
		]);
		expect(
			buildCurriculumMetaEntries([
				{
					slug: "computer-science",
					title: "计算机类本科人才培养方案",
					key: "curriculum/example/document-units.jsonl",
				},
				{
					slug: "philosophy-strong-base",
					title: "哲学（强基计划）本科人才培养方案",
					key: "curriculum/example-2/document-units.jsonl",
				},
				{
					slug: "general-pe",
					title: "中央民族大学通识课程 “大学体育”课程教学计划",
					key: "curriculum/example-3/document-units.jsonl",
				},
			]),
		).toEqual([
			{ type: "dir", name: "undergraduate", label: "本科专业与专业类", collapsed: true },
			{ type: "dir", name: "strong-base", label: "强基计划", collapsed: true },
			{ type: "dir", name: "general-education", label: "通识课程", collapsed: true },
		]);
	});

	it("does not create subgroup overview sidebar entries", () => {
		expect(
			buildGroupMetaEntries([
				{
					slug: "credit-system",
					title: "中央民族大学本科学分制实施办法",
				},
			]),
		).toEqual([
			{
				type: "file",
				name: "credit-system",
				label: "中央民族大学本科学分制实施办法",
			},
		]);
		expect(
			buildGroupMetaEntries([
				{
					slug: "computer-science",
					title: "计算机类本科人才培养方案",
				},
			]).some((entry) => typeof entry !== "string" && "name" in entry && entry.name === "index"),
		).toBe(false);
	});

	it("renders public regulation source metadata without leaking internal collection ids", () => {
		const markdown = buildPublicRegulationMarkdown({
			doc: {
				audienceSegment: "public_service",
				collection: "institutional_rules",
				collectionLabel: "学校规章",
				documentId: "official_web_regulation:example",
				docsNavGroup: "public_service",
				key: "regulations/documents/institutional_rules/example/source-faithful/2026/document-units.jsonl",
				slug: "campus-regulation-example",
				title: "中央民族大学示例规章",
			},
			jsonlText: [
				'{"doc_id":"regulation:example","version_id":"sha256:regulation-version","source_pdf":"regulation-source.pdf","page_start":1,"page_end":2,"visibility_level":"public","entitlement_groups":[],"row_type":"heading","clean_text":"中央民族大学示例规章"}',
				'{"doc_id":"regulation:example","version_id":"sha256:regulation-version","source_pdf":"regulation-source.pdf","page_start":2,"page_end":2,"visibility_level":"public","entitlement_groups":[],"row_type":"paragraph","clean_text":"正文"}',
			].join("\n"),
		});

		expect(markdown).toContain('<section class="document-meta-panel"');
		expect(markdown).toContain("<span>2026 版</span>");
		expect(markdown).toContain("<span>原文第 1-2 页</span>");
		expect(markdown).toContain("<span>来源：学校规章</span>");
		expect(markdown).toContain("<summary>来源详情</summary>");
		expect(markdown).toContain("<dd>学校规章</dd>");
		expect(markdown).toContain("<dt>原始文件</dt>");
		expect(markdown).toContain("<dd>regulation-source.pdf</dd>");
		expect(markdown).not.toContain("<dt>状态</dt>");
		expect(markdown).not.toContain("<dd>当前展示版</dd>");
		expect(markdown).toContain('documentKind: "publicRegulation"');
		expect(markdown).toContain('readerLayout: "reference"');
		expect(markdown).toContain('readerMeasure: "wide"');
		expect(markdown).not.toContain("readerProfile:");
		expect(markdown).not.toContain("institutional_rules");
	});
});
