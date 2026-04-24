import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNodeKey, buildNodeOccurrenceKey } from "../docs/.components/course-map-types";
import {
	buildCurriculumMetaEntries,
	buildHandbookMetaEntries,
	buildTopLevelMetaEntries,
} from "../scripts/sync-real-docs";
import {
	buildCourseMapDataImportName,
	inferCourseMapRouteGroup,
} from "../scripts/sync-real-docs/course-map";
import {
	buildCurriculumMarkdown,
	buildCurriculumPlanIndex,
	discoverCurriculumDocs,
} from "../scripts/sync-real-docs/curriculum";
import { cleanHandbookMarkdown } from "../scripts/sync-real-docs/handbook";
import { sanitizePreservedHtmlForMdx } from "../scripts/sync-real-docs/html-table";
import { buildHomePage } from "../scripts/sync-real-docs/pages";
import { formatJsonContent } from "../scripts/sync-real-docs/shared";
import type { ObjectStoreClient } from "../scripts/sync-real-docs/storage";

class FakeObjectStore implements ObjectStoreClient {
	private readonly objects: ReadonlyMap<string, Uint8Array | string>;

	constructor(objects: ReadonlyMap<string, Uint8Array | string>) {
		this.objects = objects;
	}

	async readTextObject({ key }: { bucket?: string; key: string }): Promise<string> {
		const value = this.objects.get(key);
		if (value === undefined) {
			throw new Error(`missing object: ${key}`);
		}
		return typeof value === "string" ? value : new TextDecoder().decode(value);
	}

	async readOptionalBytesObject({
		key,
	}: {
		bucket?: string;
		key: string;
	}): Promise<Uint8Array | undefined> {
		const value = this.objects.get(key);
		if (value === undefined) {
			return;
		}
		return typeof value === "string" ? new TextEncoder().encode(value) : value;
	}

	async listObjectKeys({ prefix }: { bucket?: string; prefix: string }): Promise<string[]> {
		return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
	}
}

describe("course-map rendering keys", () => {
	it("keeps duplicate course labels renderable with occurrence keys", () => {
		const node = {
			node_label: "产业经济学",
			stage_label: "本科三年级",
			category_label: "专业选修",
		};

		expect(buildNodeKey(node)).toBe("本科三年级::产业经济学");
		expect(buildNodeOccurrenceKey(node, 0)).toBe("本科三年级::产业经济学#0");
		expect(buildNodeOccurrenceKey(node, 1)).toBe("本科三年级::产业经济学#1");
		expect(buildNodeOccurrenceKey(node, 0)).not.toBe(buildNodeOccurrenceKey(node, 1));
	});
});

describe("public-docs sync-real-docs TypeScript generator", () => {
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

	it("normalizes preserved HTML tables for MDX and React", () => {
		const html =
			'<table><tr><td rowspan="2">类别</td><td colspan="2">评分标准</td></tr><tr><td>第一名</td><td>{备注} *重点*</td></tr></table>';

		const sanitized = sanitizePreservedHtmlForMdx(html);

		expect(sanitized).toBe(
			'<div className="docs-table-scroll" role="region" aria-label="可横向滚动的文档表格" tabIndex={0}><table><tbody><tr><td rowSpan={2}>类别</td><td colSpan={2}>评分标准</td></tr><tr><td>第一名</td><td>&#123;备注&#125; &#42;重点&#42;</td></tr></tbody></table></div>',
		);
		expect(sanitized).not.toContain("rowspan=");
		expect(sanitized).not.toContain("colspan=");
		expect(sanitized).not.toContain("<table><tr>");
		expect(sanitized).toContain('className="docs-table-scroll"');
	});

	it("styles generated and markdown tables through scroll containers", () => {
		const css = readFileSync(join(process.cwd(), "theme/docs-ui.css"), "utf8");

		expect(css).toContain(".rspress-doc .docs-table-scroll");
		expect(css).toContain(".rspress-doc .rp-table-scroll-container");
		expect(css).not.toContain(".rspress-doc table {\n\tdisplay: block;");
	});

	it("omits prose course-map headings when no published course-map surface exists", () => {
		const jsonlText = [
			'{"row_type":"heading","clean_text":"公共管理类本科人才培养方案","heading_level":1}',
			'{"row_type":"heading","clean_text":"六、课程地图","heading_level":2,"section_hint":"section"}',
			'{"row_type":"heading","clean_text":"1.公共事业管理","heading_level":4}',
			'{"row_type":"heading","clean_text":"2.行政管理","heading_level":4}',
			'{"row_type":"heading","clean_text":"七、其他说明","heading_level":2,"section_hint":"section"}',
			'{"row_type":"paragraph","clean_text":"允许国际学分转换。"}',
		].join("\n");

		const markdown = buildCurriculumMarkdown({
			title: "公共管理类本科人才培养方案",
			jsonlText,
		});

		expect(markdown).toContain("## 七、其他说明");
		expect(markdown).not.toContain("## 六、课程地图");
		expect(markdown).not.toContain("公共事业管理");
		expect(markdown).not.toContain("行政管理");
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

	it("adds course-map group and edge counts", () => {
		const payload = {
			generatedAt: "2026-04-22T00:00:00+00:00",
			documentTitle: "示例培养方案",
			documentId: "curriculum:test",
			rawAssetId: "asset:test",
			rawVersionId: "sha256:test",
			blocks: [
				{
					blockId: "page-0001-row-1-map-01",
					title: "示例课程地图",
					status: "ready",
					titleConfidence: "visible",
					pageNumber: 1,
					rowId: "page-0001-block-0001",
					mapIndex: 1,
					parentHeadingHint: "六、课程地图",
					displayStageLabels: ["一年级上学期"],
					extractionNotes: [],
					imageObjectKey:
						"curriculum/documents/example/reader-assets/course-maps/page-0001-row-1-map-01.png",
					nodes: [
						{ node_label: "公共体育（一）", stage_label: "一年级上学期", category_label: "" },
						{ node_label: "程序设计基础课程设计", stage_label: "一年级下学期", category_label: "" },
						{ node_label: "数据结构", stage_label: "一年级下学期", category_label: "" },
					],
					edges: [
						{ source_label: "公共体育（一）", target_label: "程序设计基础课程设计" },
						{ source_label: "程序设计基础课程设计", target_label: "数据结构" },
					],
				},
			],
		};

		expect(inferCourseMapRouteGroup("公共体育（二）")).toBe("foundation");
		expect(inferCourseMapRouteGroup("程序设计基础课程设计")).toBe("practice");
		expect(inferCourseMapRouteGroup("专业选修课程")).toBe("extension");
		expect(buildCourseMapDataImportName("法学本科人才培养方案")).toMatch(
			/^courseMapData[0-9a-f]{8}$/,
		);
		expect(
			payload.blocks[0]?.nodes.map((node) => inferCourseMapRouteGroup(node.node_label)),
		).toEqual(["foundation", "practice", "core"]);
	});

	it("formats generated metadata JSON with tab indentation", () => {
		expect(formatJsonContent(["index", "law-ethnic-experimental-program"])).toBe(
			'[\n\t"index",\n\t"law-ethnic-experimental-program"\n]\n',
		);
	});

	it("builds labeled sidebar metadata instead of raw index entries", () => {
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
						slug: "student-rules",
						title: "中央民族大学学生管理规定",
						documentId: "handbook:test",
					},
				],
			}),
		).toEqual([
			{ type: "file", name: "index", label: "学生手册概览" },
			{ type: "section-header", label: "办事流程" },
			{
				type: "file",
				name: "central-minzu-student-dormitory-management-workflow",
				label: "中央民族大学学生公寓管理工作流程",
			},
			{ type: "section-header", label: "学生手册目录" },
			{ type: "file", name: "student-rules", label: "中央民族大学学生管理规定" },
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
			{ type: "file", name: "index", label: "培养方案概览" },
			{ type: "section-header", label: "本科专业与专业类" },
			{ type: "file", name: "computer-science", label: "计算机类本科人才培养方案" },
			{ type: "section-header", label: "强基计划" },
			{
				type: "file",
				name: "philosophy-strong-base",
				label: "哲学（强基计划）本科人才培养方案",
			},
			{ type: "section-header", label: "通识课程" },
			{
				type: "file",
				name: "general-pe",
				label: "中央民族大学通识课程 “大学体育”课程教学计划",
			},
		]);
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

		expect(home).toContain("学生手册、培养方案与公开规章的统一阅读入口");
		expect(home).not.toContain("验证");
		expect(home).not.toContain("MinIO");
		expect(home).not.toContain("样本");
		expect(curriculumIndex).toContain("## 本科专业与专业类");
		expect(curriculumIndex).toContain("- [计算机类本科人才培养方案](./computer-science)");
		expect(curriculumIndex).toContain("## 通识课程");
		expect(curriculumIndex).toContain(
			"- [中央民族大学通识课程 “大学体育”课程教学计划](./general-pe)",
		);
		expect(curriculumIndex).not.toContain("当前公开");
	});
});

describe("public-docs generated-docs checker", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("rejects restricted markers in generated markdown", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/student-handbook/leak.md");
		mkdirSync(join(root, "apps/public-docs/docs/student-handbook"), { recursive: true });
		writeFileSync(
			target,
			[
				"---",
				"title: 泄漏样例",
				"---",
				"",
				"collection: institutional_rules",
				"campusrag://internal/example",
			].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains restricted public-docs marker: institutional_rules",
		);
		expect(issues.map((issue) => issue.message)).toContain(
			"contains internal locator marker: campusrag://",
		);
		expect(readFileSync(target, "utf-8")).toContain("institutional_rules");
	});
});
