import { describe, expect, it } from "vitest";
import {
	buildCurriculumMarkdown,
	buildCurriculumPlanIndex,
	discoverCurriculumDocs,
} from "../scripts/sync-real-docs/curriculum";
import { buildHomePage } from "../scripts/sync-real-docs/pages";
import { FakeObjectStore } from "./sync-real-docs-test-support";

describe("curriculum generated markdown", () => {
	it("keeps curriculum graduation requirement labels as separate markdown blocks", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"1.\\n工程知识:能够将数学、自然科学、工程基础和专业知识用于解决复杂工程问题。"}',
			'{"row_type":"paragraph","clean_text":"1.1\\n掌握数学、自然科学、工程基础和计算机类专业知识。"}',
			'{"row_type":"paragraph","clean_text":"1.2\\n应用数学、自然科学和工程科学基本原理识别复杂工程问题。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain("\n## 二、毕业要求\n");
		expect(markdown).toContain(
			"\n1. 工程知识:能够将数学、自然科学、工程基础和专业知识用于解决复杂工程问题。\n",
		);
		expect(markdown).toContain("\n\n1\\.1 掌握数学、自然科学、工程基础和计算机类专业知识。\n\n");
		expect(markdown).toContain(
			"\n\n1\\.2 应用数学、自然科学和工程科学基本原理识别复杂工程问题。\n",
		);
		expect(markdown).not.toContain("复杂工程问题。1\\.1");
	});

	it("disables framework footer navigation on generated curriculum detail pages", () => {
		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText: '{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
		});

		expect(markdown).toMatch(
			/^---\ntitle: "计算机类本科人才培养方案"\nfooter: false\ndocumentKind: "curriculumPlan"\nreaderLayout: "tabular"\nreaderMeasure: "wide"\nreaderOutline: "document"\n---/,
		);
		expect(markdown).not.toContain("readerProfile:");
	});

	it("renders curriculum source and version metadata before generated body content", () => {
		const jsonlText = [
			'{"doc_id":"curriculum:英语本科人才培养方案","version_id":"sha256:curriculum-version","source_pdf":"curriculum-plan-2022.pdf","page_start":198,"row_type":"heading","clean_text":"英语本科人才培养方案","heading_level":1}',
			'{"doc_id":"curriculum:英语本科人才培养方案","version_id":"sha256:curriculum-version","source_pdf":"curriculum-plan-2022.pdf","page_start":198,"row_type":"heading","clean_text":"一、培养目标","heading_level":2}',
			'{"doc_id":"curriculum:英语本科人才培养方案","version_id":"sha256:curriculum-version","source_pdf":"curriculum-plan-2022.pdf","page_start":207,"row_type":"paragraph","clean_text":"正文"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "英语本科人才培养方案",
			jsonlText,
			objectKey:
				"curriculum/documents/curriculum_plan/english/source-faithful/2022/document-units.jsonl",
		});

		expect(markdown).toContain('<section className="document-meta-panel"');
		expect(markdown).toContain('<p className="document-meta-summary">');
		expect(markdown).toContain("<span>2022 版</span>");
		expect(markdown).toContain("<span>原文第 198-207 页</span>");
		expect(markdown).toContain("<span>来源：培养方案汇编</span>");
		expect(markdown).toContain('<details className="document-meta-details">');
		expect(markdown).toContain("<summary>来源详情</summary>");
		expect(markdown).toContain("<dt>原始文件</dt>");
		expect(markdown).toContain("<dd>curriculum-plan-2022.pdf</dd>");
		expect(markdown).toContain("<dt>文档集合</dt>");
		expect(markdown).toContain("<dd>培养方案</dd>");
		expect(markdown).toContain("<dt>doc_id</dt>");
		expect(markdown).not.toContain("<dt>状态</dt>");
		expect(markdown).not.toContain("<dd>当前展示版</dd>");
		expect(markdown.indexOf('<section className="document-meta-panel"')).toBeLessThan(
			markdown.indexOf("## 一、培养目标"),
		);
		expect(markdown).not.toContain("campusrag://");
	});

	it("splits inline curriculum requirement labels inside one paragraph", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"1. 工程知识:能够解决复杂工程问题。\\n1.1 掌握数学、自然科学和工程基础。\\n1.2 应用专业知识建模并求解。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain(
			"\n1. 工程知识:能够解决复杂工程问题。\n\n1\\.1 掌握数学、自然科学和工程基础。\n\n1\\.2 应用专业知识建模并求解。\n",
		);
	});

	it("promotes curriculum specialty graduation requirement labels to headings", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"计算机科学与技术专业毕业要求:"}',
			'{"row_type":"paragraph","clean_text":"1. 工程知识:能够解决复杂工程问题。"}',
			'{"row_type":"paragraph","clean_text":"软件工程专业毕业要求:"}',
			'{"row_type":"paragraph","clean_text":"1. 工程知识:能够解决软件工程问题。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain("\n### 计算机科学与技术专业毕业要求\n");
		expect(markdown).toContain("\n### 软件工程专业毕业要求\n");
		expect(markdown).not.toContain("计算机科学与技术专业毕业要求:");
	});

	it("renders curriculum course-list lead-ins and table captions as styled non-heading blocks", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"社会学类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"课程清单如下:"}',
			'{"row_type":"paragraph","clean_text":"表 1 计算机科学与技术专业毕业要求对培养目标的支撑关系矩阵"}',
			'{"row_type":"table","html":"<table><tr><td>课程</td><td>学分</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "社会学类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain('<p className="docs-lead-in">课程清单如下:</p>');
		expect(markdown).toContain(
			'<p className="docs-table-caption">表 1 计算机科学与技术专业毕业要求对培养目标的支撑关系矩阵</p>',
		);
		expect(markdown).not.toContain("### 表 1 计算机科学与技术专业毕业要求对培养目标的支撑关系矩阵");
	});

	it("splits trailing curriculum course-list lead-ins before tables", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"孝通实验班本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"通识教育板块应修52学分。其中必修44学分，包括思政课19学分、基本素养课23学分，劳动教育2学分；选修8学分。课程清单如下:"}',
			'{"row_type":"table","html":"<table><tr><td>课程</td><td>学分</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "孝通实验班本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain(
			"通识教育板块应修52学分。其中必修44学分，包括思政课19学分、基本素养课23学分，劳动教育2学分；选修8学分。\n\n",
		);
		expect(markdown).toContain('<p className="docs-lead-in">课程清单如下:</p>');
		expect(markdown).not.toContain("选修8学分。课程清单如下:");
	});

	it("splits dense curriculum parenthesized Arabic enums into readable paragraphs", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"中央民族大学通识课程 “大学体育”课程教学计划","heading_level":1}',
			'{"row_type":"heading","clean_text":"三、评价方式","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"(1) 第一层次: 完成每月体育锻炼打卡，方为通过;(2) 第二层次: 各俱乐部制定具体要求;(3) 第三层次: 完成体育代表队训练。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "中央民族大学通识课程 “大学体育”课程教学计划",
			jsonlText,
		});

		expect(markdown).toContain(
			"(1) 第一层次: 完成每月体育锻炼打卡，方为通过;\n\n(2) 第二层次: 各俱乐部制定具体要求;\n\n(3) 第三层次: 完成体育代表队训练。",
		);
		expect(markdown).not.toContain("通过;(2)");
	});

	it("splits dense curriculum bare Arabic enums into readable paragraphs", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"十、毕业设计","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"1)文献资料的查阅与分析应用;2)学习新技术、新方法;3)实验方案确定，实验装置的设计与建立。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain(
			"1)文献资料的查阅与分析应用;\n\n2)学习新技术、新方法;\n\n3)实验方案确定，实验装置的设计与建立。",
		);
		expect(markdown).not.toContain("应用;2)");
	});

	it("renders contextual curriculum suggested-course-list lead-ins as styled blocks", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"1. 计算机科学与技术专业个性化培养至少选择修读6学分,建议课程清单:"}',
			'{"row_type":"table","html":"<table><tr><td>课程</td><td>学分</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain(
			'<p className="docs-lead-in">1. 计算机科学与技术专业个性化培养至少选择修读6学分,建议课程清单:</p>',
		);
	});

	it("uses a stable public heading when embedding structured curriculum course maps", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"六、课程地图","heading_level":2,"section_hint":"section"}',
			'{"row_type":"table","html":"<table><tr><td>课程地图</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
			courseMapEmbed: {
				componentImportPath: "../../../src/components/CourseMapSection",
				dataImportName: "computerCourseMap",
				dataImportPath: "./计算机类本科人才培养方案.course-map.json",
			},
		});

		expect(markdown).toContain("\n## 课程地图\n");
		expect(markdown).not.toContain("\n## 六、课程地图\n");
		expect(markdown).not.toContain("课程地图</td>");
	});

	it("renders curriculum weak subsection labels as styled lead-ins", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"计算机类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"十、综合实践","heading_level":2}',
			'{"row_type":"paragraph","clean_text":"学年论文要求:"}',
			'{"row_type":"paragraph","clean_text":"学生在教师指导下完成论文。"}',
			'{"row_type":"paragraph","clean_text":"毕业设计要求:"}',
			'{"row_type":"paragraph","clean_text":"选题要结合工程实际。"}',
			'{"row_type":"paragraph","clean_text":"计算机科学与技术专业拓展培养:"}',
			'{"row_type":"paragraph","clean_text":"微专业、辅修专业和辅修学位按规定修读。"}',
			'{"row_type":"paragraph","clean_text":"培养目标细化如下。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "计算机类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain('<p className="docs-lead-in">学年论文要求:</p>');
		expect(markdown).toContain('<p className="docs-lead-in">毕业设计要求:</p>');
		expect(markdown).toContain('<p className="docs-lead-in">计算机科学与技术专业拓展培养:</p>');
		expect(markdown).toContain('<p className="docs-lead-in">培养目标细化如下。</p>');
		expect(markdown).not.toContain("\n学年论文要求:\n\n学生");
	});

	it("repairs known stale curriculum table artifacts while rendering docs", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"经济学本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
			'{"row_type":"table","html":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr><tr><td>跨学科</td><td>新开课</td><td>经济统计分析实践</td><td>2</td><td>36</td><td>9</td><td>7</td><td>/</td></tr><tr><td rowspan=\\"2\\">交叉课程</td><td></td><td>社会心理学</td><td>2</td><td>36</td><td>9</td><td>7</td><td rowspan=\\"2\\"></td></tr><tr><td>1034040253</td><td>区块链技术</td><td>2</td><td>36</td><td>9</td><td>7</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "经济学本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain("<td rowSpan={3}>跨学科交叉课程</td>");
		expect(markdown).not.toContain("<td>跨学科</td>");
		expect(markdown).not.toContain("rowSpan={2}>交叉课程");
	});

	it("removes stale global competence placeholder slash while rendering docs", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"俄语（俄语、中亚语）本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
			'{"row_type":"table","html":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr><tr><td rowspan=\\"2\\">本硕贯通课程</td><td>0502-1</td><td>语言文化学</td><td>2</td><td>36</td><td>/</td><td>7</td><td rowspan=\\"2\\">建议深造学生选修</td></tr><tr><td>0502-2</td><td>跨文化交际</td><td>2</td><td>36</td><td>/</td><td>8</td></tr><tr><td>全球胜任力培养课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程/</td><td>建议出国深造学生选修</td></tr></table>"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "俄语（俄语、中亚语）本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain("学校通开的全球胜任力培养课程</td>");
		expect(markdown).not.toContain("学校通开的全球胜任力培养课程/");
	});

	it("discovers curriculum docs from document-units objects and preserves known slug overrides", async () => {
		const objects = new Map<string, string>([
			[
				"curriculum/documents/curriculum_plan/法学-民族实验班/source-faithful/2022/document-units.jsonl",
				[
					'{"doc_id":"curriculum:法学（民族实验班）本科人才培养方案","row_type":"heading","clean_text":"法学（民族实验班）本科人才培养方案"}',
					'{"row_type":"paragraph","clean_text":"正文"}',
				].join("\n"),
			],
			[
				"curriculum/documents/curriculum_plan/法学本科/source-faithful/2022/document-units.jsonl",
				[
					'{"doc_id":"curriculum:法学本科人才培养方案","row_type":"heading","clean_text":"法学本科人才培养方案"}',
					'{"row_type":"paragraph","clean_text":"正文"}',
				].join("\n"),
			],
		]);

		const docs = await discoverCurriculumDocs(new FakeObjectStore(objects));

		expect(docs).toHaveLength(2);
		expect(docs.find((doc) => doc.title === "法学（民族实验班）本科人才培养方案")?.slug).toBe(
			"law-ethnic-experimental-program",
		);
		expect(docs.find((doc) => doc.title === "法学本科人才培养方案")?.slug).toMatch(
			/^法学本科人才培养方案/,
		);
	});

	it("builds public-facing home and curriculum index copy", () => {
		const home = buildHomePage({ includePublicRegulations: true });
		const curriculumIndex = buildCurriculumPlanIndex([
			{
				slug: "computer-science",
				title: "计算机类本科人才培养方案",
				key: "curriculum/example/document-units.jsonl",
			},
			{
				slug: "general-pe",
				title: "中央民族大学通识课程 “大学体育”课程教学计划",
				key: "curriculum/example-2/document-units.jsonl",
			},
		]);

		expect(home).toContain("集中阅读学生手册、培养方案与公开规章");
		expect(home).toContain('documentKind: "home"');
		expect(home).toContain('readerLayout: "landing"');
		expect(home).toContain('readerMeasure: "standard"');
		expect(home).toContain('readerOutline: "none"');
		expect(home).not.toContain("readerProfile:");
		expect(home).not.toContain("验证");
		expect(home).not.toContain("MinIO");
		expect(home).not.toContain("样本");
		expect(curriculumIndex).toContain("footer: false");
		expect(curriculumIndex).toContain('documentKind: "collectionLanding"');
		expect(curriculumIndex).toContain('readerLayout: "landing"');
		expect(curriculumIndex).toContain('readerMeasure: "standard"');
		expect(curriculumIndex).toContain('readerOutline: "none"');
		expect(curriculumIndex).not.toContain("readerProfile:");
		expect(curriculumIndex).toContain("## 本科专业与专业类");
		expect(curriculumIndex).toContain(
			"- [计算机类本科人才培养方案](./undergraduate/computer-science)",
		);
		expect(curriculumIndex).toContain("## 通识课程");
		expect(curriculumIndex).toContain(
			"- [中央民族大学通识课程 “大学体育”课程教学计划](./general-education/general-pe)",
		);
		expect(curriculumIndex).not.toContain("当前公开");
	});
});
