import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanHandbookMarkdown } from "../scripts/sync-real-docs/handbook";
import { syncHandbookFlowGraphArtifacts } from "../scripts/sync-real-docs/handbook-flow-graph";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

describe("handbook generated markdown", () => {
	it("publishes handbook flow graph docs from canonical curated JSON when object store source is absent", async () => {
		const root = mkdtempSync(join(tmpdir(), "public-docs-flow-graph-"));
		temporaryDirectories.push(root);
		const docsRoot = join(root, "apps/public-docs/docs");
		const targetDir = join(docsRoot, "student-handbook/workflows");
		mkdirSync(targetDir, { recursive: true });
		mkdirSync(join(root, "apps/public-docs/src/generated/handbook-flow-graphs"), {
			recursive: true,
		});
		const client = new FakeObjectStore(new Map());

		const docs = await syncHandbookFlowGraphArtifacts({
			client,
			docsRoot,
			routeDepthFromDocsRoot: 2,
			targetDir,
		});

		expect(docs).toEqual([
			{
				filename: "central-minzu-student-dormitory-management-workflow.mdx",
				slug: "central-minzu-student-dormitory-management-workflow",
				title: "中央民族大学学生公寓管理工作流程",
			},
		]);
		const dataPath = join(
			root,
			"apps/public-docs/src/generated/handbook-flow-graphs/central-minzu-student-dormitory-management-workflow.data.ts",
		);
		expect(readFileSync(dataPath, "utf-8")).toContain('flowHeading: "研究生申请办理退宿手续"');
		expect(readFileSync(dataPath, "utf-8")).toContain('extractionStatus: "ready"');
	});

	it("renders handbook lead-ins as styled non-heading blocks", () => {
		const markdown = [
			"---",
			"title: '中央民族大学学生资助管理工作暂行办法'",
			"---",
			"",
			"按照国家相关政策并结合学校的实际情况,对学生提供以下几种方式的资助:",
			"(一)奖学金用于奖励品学兼优的学生。",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toContain(
			'<p class="docs-lead-in">按照国家相关政策并结合学校的实际情况,对学生提供以下几种方式的资助:</p>',
		);
		expect(cleaned).toContain("(一)奖学金用于奖励品学兼优的学生。");
	});

	it("disables framework footer navigation on generated handbook detail pages", () => {
		const markdown = [
			"---",
			"title: '中央民族大学学生资助管理工作暂行办法'",
			"---",
			"",
			"正文。",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toMatch(
			/^---\ntitle: '中央民族大学学生资助管理工作暂行办法'\nfooter: false\ncorpus:/,
		);
		expect(cleaned).toContain('documentKind: "studentHandbookArticle"');
		expect(cleaned).toContain('readerLayout: "reference"');
		expect(cleaned).toContain('readerMeasure: "wide"');
		expect(cleaned).toContain('readerOutline: "document"');
		expect(cleaned).not.toContain("readerProfile:");
	});

	it("renders handbook source and page metadata from frontmatter", () => {
		const markdown = [
			"---",
			"title: '中央民族大学学生资助管理工作暂行办法'",
			"doc_id: handbook:test",
			"version_id: sha256:handbook-version",
			"source_doc: '学生手册_2018.pdf'",
			"page_start: 42",
			"page_end: 44",
			"---",
			"",
			"正文。",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toContain('<section class="document-meta-panel"');
		expect(cleaned).toContain('<p class="document-meta-summary">');
		expect(cleaned).toContain("<span>2018 版</span>");
		expect(cleaned).toContain("<span>原文第 42-44 页</span>");
		expect(cleaned).toContain("<span>来源：学生手册</span>");
		expect(cleaned).toContain("<summary>来源详情</summary>");
		expect(cleaned).toContain("<dt>文档集合</dt>");
		expect(cleaned).toContain("<dd>学生手册</dd>");
		expect(cleaned).toContain("<dt>原始文件</dt>");
		expect(cleaned).toContain("<dd>学生手册_2018.pdf</dd>");
		expect(cleaned).toContain("<dt>version_id</dt>");
		expect(cleaned).not.toContain("<dt>状态</dt>");
		expect(cleaned.indexOf('<section class="document-meta-panel"')).toBeLessThan(
			cleaned.indexOf("正文。"),
		);
	});

	it("splits handbook dense parenthesized enums for readable rendering", () => {
		const markdown = [
			"---",
			"title: '中央民族大学学生资助管理工作暂行办法'",
			"---",
			"",
			"按照国家相关政策并结合学校的实际情况,对学生提供以下几种方式的资助: (一)奖学金用于奖励品学兼优的学生; (二)助学金用于资助家庭经济困难学生; (三)勤工助学提供校内岗位。",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toContain(
			'<p class="docs-lead-in">按照国家相关政策并结合学校的实际情况,对学生提供以下几种方式的资助:</p>',
		);
		expect(cleaned).toContain(
			"\n(一)奖学金用于奖励品学兼优的学生;\n\n(二)助学金用于资助家庭经济困难学生;\n\n(三)勤工助学提供校内岗位。\n",
		);
		expect(cleaned).not.toContain(": (一)");
		expect(cleaned).not.toContain("; (二)");
	});

	it("promotes handbook inline numbered chapter headings after splitting them from body text", () => {
		const markdown = [
			"---",
			"title: '中央民族大学本科创新教育实施办法'",
			"---",
			"",
			"学校为学生参与创新教育活动设立专项经费、提供必要的条件。 二、管理各院系负责日常的与创新教育有关的教学活动和实践活动的管理。 三、项目",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toContain("提供必要的条件。\n\n## 二、管理\n\n各院系负责日常");
		expect(cleaned).toContain("实践活动的管理。\n\n## 三、项目\n");
		expect(cleaned).not.toContain("条件。 二、管理");
		expect(cleaned).not.toContain("管理。 三、项目");
	});

	it("cleans handbook markdown without escaping grade ranges as decimal labels", () => {
		const markdown = [
			"---",
			"title: '中央民族大学推荐应届本科毕业生免试攻读硕士学位研究生管理办法'",
			"---",
			"",
			"(二)成绩要求",
			"1.1-3学年所修课程平均成绩在本专业排名前 $30\\%$",
			"",
		].join("\n");

		const cleaned = cleanHandbookMarkdown(markdown);

		expect(cleaned).toContain("1.1-3学年所修课程平均成绩在本专业排名前 30%");
		expect(cleaned).not.toContain("1\\.1-3学年");
		expect(cleaned).not.toContain("$30\\%$");
	});
});
