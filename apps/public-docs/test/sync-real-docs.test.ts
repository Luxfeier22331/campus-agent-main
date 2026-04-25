import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildCurriculumMetaEntries,
	buildGroupMetaEntries,
	buildHandbookMetaEntries,
	buildTopLevelMetaEntries,
} from "../scripts/sync-real-docs";
import {
	buildCourseMapDataImportName,
	buildCourseMapDataPayload,
	buildCourseMapDocEmbedForRoute,
	inferCourseMapRouteGroup,
	normalizeCourseMapNodeLabel,
	normalizeCourseMapStageLabel,
	syncCurriculumCourseMapArtifacts,
} from "../scripts/sync-real-docs/course-map";
import {
	buildCurriculumMarkdown,
	buildCurriculumPlanIndex,
	discoverCurriculumDocs,
} from "../scripts/sync-real-docs/curriculum";
import { cleanHandbookMarkdown } from "../scripts/sync-real-docs/handbook";
import { syncHandbookFlowGraphArtifacts } from "../scripts/sync-real-docs/handbook-flow-graph";
import { sanitizePreservedHtmlForMdx } from "../scripts/sync-real-docs/html-table";
import { buildHomePage } from "../scripts/sync-real-docs/pages";
import { buildPublicRegulationMarkdown } from "../scripts/sync-real-docs/regulations";
import { formatJsonContent } from "../scripts/sync-real-docs/shared";
import type { ObjectStoreClient } from "../scripts/sync-real-docs/storage";
import { buildLocalSearchFallbackResults } from "../src/search/local-search-fallback-core";

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

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("course-map rendering keys", () => {
	it("publishes course-map relations by node ids instead of duplicate labels", () => {
		const payload = buildCourseMapDataPayload({
			publicSlug: "computer",
			surface: {
				blocks: [
					{
						blockId: "map-1",
						displayStageLabels: ["一年级", "二年级"],
						edges: [
							{
								edge_id: "edge-foundation-elective",
								source_label: "程序设计基础",
								source_node_id: "node-programming",
								target_label: "选修模块",
								target_node_id: "node-elective-2",
							},
							{ source_label: "选修模块", target_label: "毕业论文" },
						],
						extractionNotes: [],
						imageObjectKey: "course-maps/computer/map.png",
						mapIndex: 1,
						nodes: [
							{
								node_id: "node-programming",
								node_label: "程序设计基础",
								stage_id: "stage-1",
								stage_label: "一年级",
							},
							{
								node_id: "node-elective-1",
								node_label: "选修模块",
								stage_id: "stage-1",
								stage_label: "一年级",
							},
							{
								node_id: "node-elective-2",
								node_label: "选修模块",
								stage_id: "stage-2",
								stage_label: "二年级",
							},
							{
								node_id: "node-thesis",
								node_label: "毕业论文",
								stage_id: "stage-2",
								stage_label: "二年级",
							},
						],
						pageNumber: 1,
						parentHeadingHint: "",
						rowId: "row-1",
						status: "ready",
						title: "测试课程地图",
						titleConfidence: "visible",
					},
				],
				documentId: "doc",
				documentTitle: "测试",
				generatedAt: "2026-04-25T00:00:00.000Z",
				rawAssetId: "asset",
				rawVersionId: "version",
			},
		});
		const block = (
			payload.blocks as Array<{
				edges: Array<{ edge_id: string; source_node_id: string; target_node_id: string }>;
				extractionNotes: string[];
				nodes: Array<{ node_id: string; incoming_count: number; outgoing_count: number }>;
			}>
		)[0];

		expect(block.edges).toEqual([
			expect.objectContaining({
				edge_id: "edge-foundation-elective",
				source_node_id: "node-programming",
				target_node_id: "node-elective-2",
			}),
		]);
		expect(block.nodes.find((node) => node.node_id === "node-programming")).toMatchObject({
			outgoing_count: 1,
		});
		expect(block.nodes.find((node) => node.node_id === "node-elective-2")).toMatchObject({
			incoming_count: 1,
		});
		expect(block.extractionNotes).toContain(
			"存在同名课程节点导致无法唯一定位的关系端点，已从结构化关系中移除：选修模块（source）。",
		);
	});

	it("classifies public foundation courses outside professional core groups", () => {
		expect(inferCourseMapRouteGroup("中国近现代史纲要")).toBe("foundation");
		expect(inferCourseMapRouteGroup("马克思主义基本原理概论")).toBe("foundation");
		expect(inferCourseMapRouteGroup("习近平新时代中国特色社会主义思想概论")).toBe("foundation");
		expect(inferCourseMapRouteGroup("毕业论文（设计）")).toBe("practice");
	});

	it("normalizes known course-map OCR label drift before rendering", () => {
		expect(normalizeCourseMapNodeLabel("中近现代史纲要")).toBe("中国近现代史纲要");
		expect(normalizeCourseMapNodeLabel("高散结构")).toBe("离散结构");
	});

	it("normalizes ambiguous course-map stage labels before public rendering", () => {
		expect(normalizeCourseMapStageLabel("下学期")).toBe("未按学期拆分");
		expect(normalizeCourseMapStageLabel(" 上学期 ")).toBe("未按学期拆分");
		expect(normalizeCourseMapStageLabel("本科三年级")).toBe("本科三年级");
	});

	it("applies course-map label normalization to nodes, edges, and relation counts", () => {
		const payload = buildCourseMapDataPayload({
			publicSlug: "computer",
			surface: {
				blocks: [
					{
						blockId: "map-1",
						displayStageLabels: ["一年级"],
						edges: [{ source_label: "中近现代史纲要", target_label: "高散结构" }],
						extractionNotes: [],
						imageObjectKey: "course-maps/computer/map.png",
						mapIndex: 1,
						nodes: [
							{
								category_label: "思政课",
								node_label: "中近现代史纲要",
								stage_label: "一年级",
							},
							{
								category_label: "专业核心",
								node_label: "高散结构",
								stage_label: "一年级",
							},
						],
						pageNumber: 1,
						parentHeadingHint: "",
						rowId: "row-1",
						status: "ready",
						title: "测试课程地图",
						titleConfidence: "visible",
					},
				],
				documentId: "doc",
				documentTitle: "测试",
				generatedAt: "2026-04-25T00:00:00.000Z",
				rawAssetId: "asset",
				rawVersionId: "version",
			},
		});
		const block = (payload.blocks as Array<{ nodes: unknown[]; edges: unknown[] }>)[0];

		expect(block.nodes).toContainEqual(
			expect.objectContaining({
				node_label: "中国近现代史纲要",
				outgoing_count: 1,
				route_group: "foundation",
			}),
		);
		expect(block.nodes).toContainEqual(
			expect.objectContaining({
				incoming_count: 1,
				node_label: "离散结构",
			}),
		);
		expect(block.edges).toContainEqual({
			edge_id: expect.stringMatching(/^edge-[0-9a-f]{12}$/),
			source_label: "中国近现代史纲要",
			source_node_id: expect.stringMatching(/^node-[0-9a-f]{12}$/),
			target_label: "离散结构",
			target_node_id: expect.stringMatching(/^node-[0-9a-f]{12}$/),
		});
	});

	it("downgrades course-map blocks without stage buckets to image-only publishing", () => {
		const payload = buildCourseMapDataPayload({
			publicSlug: "public-management",
			surface: {
				blocks: [
					{
						blockId: "map-1",
						displayStageLabels: [],
						edges: [],
						extractionNotes: [],
						imageObjectKey: "course-maps/public-management/map.png",
						mapIndex: 1,
						nodes: [
							{
								node_id: "node-1",
								node_label: "管理学原理",
								stage_id: "stage-unknown",
								stage_label: "",
							},
						],
						pageNumber: 1,
						parentHeadingHint: "六、课程地图",
						rowId: "row-1",
						status: "ready",
						title: "测试课程地图",
						titleConfidence: "visible",
					},
				],
				documentId: "doc",
				documentTitle: "测试",
				generatedAt: "2026-04-25T00:00:00.000Z",
				rawAssetId: "asset",
				rawVersionId: "version",
			},
		});
		const block = (
			payload.blocks as Array<{
				displayStageLabels: string[];
				extractionNotes: string[];
				status: string;
			}>
		)[0];

		expect(block.status).toBe("failed");
		expect(block.displayStageLabels).toEqual([]);
		expect(block.extractionNotes).toContain(
			"未识别到可用于阅读分组的阶段信息，当前仅发布原始区域图。",
		);
	});
});

describe("public-docs sync-real-docs TypeScript generator", () => {
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

		expect(markdown).toMatch(/^---\ntitle: "计算机类本科人才培养方案"\nfooter: false\n---/);
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
		expect(markdown).toContain("<dt>集合</dt>");
		expect(markdown).toContain("<dd>培养方案</dd>");
		expect(markdown).toContain("<dd>curriculum-plan-2022.pdf</dd>");
		expect(markdown).toContain("<dd>原文第 198-207 页</dd>");
		expect(markdown).toContain("<dd>2022 版</dd>");
		expect(markdown).toContain("<dt>doc_id</dt>");
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
		expect(cleaned).toContain("<dt>集合</dt>");
		expect(cleaned).toContain("<dd>学生手册</dd>");
		expect(cleaned).toContain("<dd>学生手册_2018.pdf</dd>");
		expect(cleaned).toContain("<dd>原文第 42-44 页</dd>");
		expect(cleaned).toContain("<dd>2018 版</dd>");
		expect(cleaned).toContain("<dt>version_id</dt>");
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
		const theme = readFileSync(join(process.cwd(), "theme/index.tsx"), "utf8");

		expect(css).toContain(".rspress-doc .docs-table-scroll");
		expect(css).toContain(".rspress-doc .rp-table-scroll-container");
		expect(css).toContain(".rspress-doc.docs-reader-normal");
		expect(css).toContain("max-width: min(100%, 76rem);");
		expect(css).toContain(".rspress-doc.docs-reader-wide");
		expect(css).toContain("max-width: min(100%, 76rem);");
		expect(css).toContain(".rspress-doc.docs-reader-map");
		expect(css).toContain(".rspress-doc.docs-reader-home");
		expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.72fr);");
		expect(css).toContain("grid-template-columns: minmax(5.5rem, 8rem) minmax(0, 1fr);");
		expect(css).toContain("--docs-sidebar-width: 17rem;");
		expect(css).toContain("--docs-sidebar-width: 16.5rem;");
		expect(css).toContain("--docs-sidebar-outer-gutter: 16px;");
		expect(css).toContain("--docs-sidebar-gutter: 12px;");
		expect(css).toContain("--docs-outline-width: 11rem;");
		expect(css).toContain("--rp-sidebar-margin-left: var(--docs-sidebar-gutter);");
		expect(css).toContain("--rp-outline-width: var(--docs-outline-width);");
		expect(css).toContain("width: var(--docs-outline-width);");
		expect(css).toContain(".rp-doc-layout__sidebar .rp-sidebar-item__left");
		expect(css).toContain('.rp-doc-layout__sidebar .rp-sidebar-item[data-depth="1"]');
		expect(css).toContain("--docs-sidebar-item-indent: 0.75rem;");
		expect(css).toContain('.rp-doc-layout__sidebar .rp-sidebar-item[data-depth="2"]');
		expect(css).toContain("--docs-sidebar-item-indent: 1.25rem;");
		expect(css).toContain("padding-left: var(--docs-sidebar-item-indent, 0.25rem);");
		expect(css).toContain("-webkit-line-clamp: 2;");
		expect(css).toContain(".rp-doc-layout__sidebar .rp-sidebar-item--group-item::before");
		expect(css).toContain("body .rp-search-button--mobile");
		expect(css).toContain("body .rp-nav-hamburger__sm");
		expect(css).toContain("body:has(.rp-doc-layout__sidebar--open) .rp-sidebar-menu__left::after");
		expect(css).toContain('content: "关闭目录";');
		expect(css).toContain(".rspress-doc .docs-table-scroll table");
		expect(css).toContain(".rspress-doc .docs-table-mobile-cards");
		expect(css).toContain(".rspress-doc .docs-table-mobile-raw");
		expect(css).toContain("max-width: 100%;\n\t\tmin-width: 0;\n\t\toverflow-x: auto;");
		expect(css).toContain('.docs-table-scroll[data-docs-enhanced-table="true"]');
		expect(css).toContain('.docs-table-scroll[data-docs-scrollable="false"]::before');
		expect(css).toContain(".rspress-doc table thead th");
		expect(css).toContain("main.rp-doc-layout__doc-container {\n\tbox-sizing: border-box;");
		expect(css).toContain(".rp-doc-layout__doc {\n\t\tflex: 1 1 auto;");
		expect(css).toContain("max-width: none;");
		expect(css).toContain("width: 100%;\n\t\tmin-width: 0;");
		expect(css).toContain("padding-left: var(--docs-reader-padding);");
		expect(css).toContain(".rspress-doc {\n\tmin-width: 0;");
		expect(css).toContain("padding-right: 1.25rem;");
		expect(css).toContain("font-size: 0.82rem;");
		expect(css).toContain("min-width: 7.25rem;");
		expect(css).not.toContain(".rspress-doc table {\n\tdisplay: block;");
		expect(css).not.toContain(".rspress-doc table {\n\twidth: max-content;");
		expect(css).toContain('content: "横向滑动查看更多列"');
		expect(css).toContain("--docs-sidebar-width: 18rem;");
		expect(css).toContain("@media (min-width: 1600px)");
		expect(css).toContain("@media (min-width: 1280px)");
		expect(css).toContain(".rp-doc-layout__container .rp-doc-layout__sidebar-placeholder");
		expect(css).toContain("margin-left: var(--docs-sidebar-outer-gutter);");
		expect(css).toContain("@media (min-width: 1100px) and (max-width: 1599px)");
		expect(css).toContain("@media (min-width: 900px) and (max-width: 1099px)");
		expect(css).toContain("@media (max-width: 899px)");
		expect(css).toContain("--docs-sidebar-item-indent: 0.85rem;");
		expect(css).toContain("--docs-sidebar-item-indent: 1.45rem;");
		expect(css).toContain("--docs-sidebar-item-indent: 1.9rem;");
		expect(theme).not.toContain("useFlushSidebarIndent();");
		expect(theme).not.toContain("MutationObserver");
	});

	it("wires a mobile sidebar close guard for the Rspress menu affordance", () => {
		const config = readFileSync(join(process.cwd(), "rspress.config.ts"), "utf8");
		const guard = readFileSync(
			join(process.cwd(), "src/components/MobileSidebarGuard.tsx"),
			"utf8",
		);

		expect(config).toContain("MobileSidebarGuard.tsx");
		expect(config).toContain("DocsContentEnhancer.tsx");
		expect(guard).toContain(".rp-sidebar-menu__left");
		expect(guard).toContain(".rp-sidebar-menu__mask");
		expect(guard).toContain("stopImmediatePropagation");
		expect(guard).toContain('event.key !== "Escape"');
		expect(guard).toContain("mask.click()");
	});

	it("keeps course-map routes as a lightweight read-first document surface", () => {
		const css = readFileSync(join(process.cwd(), "src/components/course-map-section.css"), "utf8");
		const component = readFileSync(
			join(process.cwd(), "src/components/CourseMapSection.tsx"),
			"utf8",
		);

		expect(css).toContain("container-type: inline-size;");
		expect(css).toContain("@container (max-width: 58rem)");
		expect(css).toContain(".course-map-course-relations summary");
		expect(css).toContain(".course-map-route-card-list");
		expect(css).toContain(".course-map-document-nav-tab");
		expect(css).toContain(
			"grid-template-columns: repeat(auto-fit, minmax(min(14.5rem, 100%), 1fr));",
		);
		expect(css).toContain(".course-map-image-actions");
		expect(css).toContain(".course-map-route-card-compact");
		expect(css).toContain(".course-map-disclosure summary");
		expect(component).toContain("建议核对原图");
		expect(component).toContain("已整理为课程路径");
		expect(component).toContain("未按学期拆分");
		expect(component).toContain("单独打开原图");
		expect(component).not.toContain("需核对");
		expect(component).not.toContain("结构化课程路径");
		expect(css).not.toContain(".course-map-inspector");
		expect(css).not.toContain(".course-map-graph");
	});

	it("renders document technical metadata as a fixed low-distraction popover", () => {
		const css = readFileSync(join(process.cwd(), "theme/docs-ui.css"), "utf8");

		expect(css).toContain(".rspress-doc .document-meta-technical dl");
		expect(css).toContain("position: fixed;");
		expect(css).toContain("bottom: 2rem;");
		expect(css).toContain("bottom: max(1rem, env(safe-area-inset-bottom));");
		expect(css).toContain("box-shadow: 0 18px 40px rgba(28, 45, 37, 0.14);");
		expect(css).not.toContain("flex-basis: 100%;");
	});

	it("builds fallback local search suggestions from the generated search index shape", () => {
		const results = buildLocalSearchFallbackResults("奖学金", [
			{
				title: "中央民族大学本科学生国家奖学金评审办法",
				routePath: "/student-handbook/scholarship/national-scholarship-evaluation",
				content: "第一条 为规范国家奖学金评审工作。",
				toc: [{ id: "第一条", text: "第一条", charIndex: 0 }],
			},
		]);

		expect(results[0]).toMatchObject({
			type: "title",
			title: "中央民族大学本科学生国家奖学金评审办法",
			link: "/student-handbook/scholarship/national-scholarship-evaluation",
			query: "奖学金",
		});
	});

	it("falls back to section and content matches when titles do not match", () => {
		const results = buildLocalSearchFallbackResults("毕业要求", [
			{
				title: "计算机类本科人才培养方案",
				routePath: "/curriculum-plan/undergraduate/计算机类本科人才培养方案",
				content: "二、毕业要求\n\n软件工程专业毕业要求包括知识、能力和素质要求。",
				toc: [{ id: "二毕业要求", text: "二、毕业要求", charIndex: 0 }],
			},
		]);

		expect(results.map((result) => result.type)).toEqual(["header", "content"]);
		expect(results[0]).toMatchObject({
			header: "计算机类本科人才培养方案 > 二、毕业要求",
			link: "/curriculum-plan/undergraduate/计算机类本科人才培养方案#二毕业要求",
		});
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
						slug: "credit-system",
						title: "中央民族大学本科学分制实施办法",
						documentId: "handbook:test",
					},
				],
			}),
		).toEqual([
			{ type: "file", name: "index", label: "学生手册概览" },
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
			{ type: "file", name: "index", label: "培养方案概览" },
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

	it("builds grouped course-map MDX imports against app src directories", () => {
		expect(
			buildCourseMapDocEmbedForRoute({
				dataImportName: "computerScienceData",
				routeDepthFromDocsRoot: 2,
				slug: "computer-science",
			}),
		).toEqual({
			componentImportPath: "../../../src/components/CourseMapSection",
			dataImportName: "computerScienceData",
			dataImportPath: "../../../src/generated/course-maps/computer-science.data",
		});
	});

	it("syncs course-map data modules to app src while keeping Rspress-served images under docs public", async () => {
		const root = mkdtempSync(join(tmpdir(), "public-docs-course-map-"));
		temporaryDirectories.push(root);
		const docsRoot = join(root, "apps/public-docs/docs");
		const surface = {
			generatedAt: "2026-04-22T00:00:00+00:00",
			documentTitle: "计算机类本科人才培养方案",
			documentId: "curriculum:computer-science",
			rawAssetId: "asset:test",
			rawVersionId: "sha256:test",
			blocks: [
				{
					blockId: "page-0001-row-1-map-01",
					title: "课程地图",
					status: "ready",
					titleConfidence: "visible",
					pageNumber: 1,
					rowId: "page-0001-block-0001",
					mapIndex: 1,
					parentHeadingHint: "六、课程地图",
					displayStageLabels: ["一年级上学期"],
					extractionNotes: [],
					imageObjectKey:
						"curriculum/documents/curriculum_plan/computer/source-faithful/2022/reader-assets/course-maps/map-01.png",
					nodes: [{ node_label: "程序设计基础", stage_label: "一年级上学期" }],
					edges: [],
				},
			],
		};
		const objects = new Map<string, string | Uint8Array>([
			[
				"curriculum/documents/curriculum_plan/computer/source-faithful/2022/reader-assets/course-maps.json",
				JSON.stringify(surface),
			],
			[
				"curriculum/documents/curriculum_plan/computer/source-faithful/2022/reader-assets/course-maps/map-01.png",
				new Uint8Array([137, 80, 78, 71]),
			],
		]);
		const existingImageDir = join(
			root,
			"apps/public-docs/docs/public/course-maps/computer-science",
		);
		mkdirSync(existingImageDir, { recursive: true });
		writeFileSync(join(existingImageDir, "stale-map.png"), new Uint8Array([1, 2, 3]));

		const embeds = await syncCurriculumCourseMapArtifacts({
			client: new FakeObjectStore(objects),
			curriculumDocs: [
				{
					key: "curriculum/documents/curriculum_plan/computer/source-faithful/2022/document-units.jsonl",
					slug: "computer-science",
					title: "计算机类本科人才培养方案",
				},
			],
			docsRoot,
		});

		expect(
			readFileSync(
				join(root, "apps/public-docs/src/generated/course-maps/computer-science.data.ts"),
				"utf-8",
			),
		).toContain('imageSrc: "/course-maps/computer-science/map-01.png"');
		expect(
			readFileSync(
				join(root, "apps/public-docs/docs/public/course-maps/computer-science/map-01.png"),
			),
		).toEqual(Buffer.from([137, 80, 78, 71]));
		expect(
			existsSync(
				join(root, "apps/public-docs/docs/public/course-maps/computer-science/stale-map.png"),
			),
		).toBe(false);
		expect(readdirSync(existingImageDir)).toEqual(["map-01.png"]);
		expect(embeds.get("computer-science")?.dataImportPath).toBe(
			"../src/generated/course-maps/computer-science.data",
		);
	});

	it("renders public regulation source metadata without leaking internal collection ids", () => {
		const markdown = buildPublicRegulationMarkdown({
			doc: {
				collection: "institutional_rules",
				collectionLabel: "学校规章",
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
		expect(markdown).toContain("<dd>学校规章</dd>");
		expect(markdown).toContain("<dd>regulation-source.pdf</dd>");
		expect(markdown).toContain("<dd>原文第 1-2 页</dd>");
		expect(markdown).toContain("<dd>2026 版</dd>");
		expect(markdown).not.toContain("institutional_rules");
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
		expect(home).not.toContain("验证");
		expect(home).not.toContain("MinIO");
		expect(home).not.toContain("样本");
		expect(curriculumIndex).toContain("footer: false");
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

describe("public-docs generated-docs checker", () => {
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

	it("rejects stale Rspress sample docs directories", async () => {
		const { validatePublicDocsGeneratedTree } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		mkdirSync(join(root, "apps/public-docs/docs/api"), { recursive: true });
		writeFileSync(
			join(root, "apps/public-docs/docs/api/index.md"),
			["---", "title: API", "---", "", "sample"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedTree({ root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale Rspress sample docs directory: apps/public-docs/docs/api",
		);
	});

	it("rejects subgroup overview files and stale subgroup index metadata", async () => {
		const { validatePublicDocsGeneratedTree } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const groupDir = join(root, "apps/public-docs/docs/student-handbook/workflows");
		mkdirSync(groupDir, { recursive: true });
		writeFileSync(
			join(groupDir, "_meta.json"),
			JSON.stringify([
				{ type: "file", name: "index", label: "办事流程概览" },
				{
					type: "file",
					name: "central-minzu-student-dormitory-management-workflow",
					label: "中央民族大学学生公寓管理工作流程",
				},
			]),
			"utf-8",
		);
		writeFileSync(
			join(groupDir, "index.md"),
			["---", "title: 办事流程", "---", "", "stale subgroup overview"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedTree({ root });

		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale subgroup overview document: apps/public-docs/docs/student-handbook/workflows/index.md",
		);
		expect(issues.map((issue) => issue.message)).toContain(
			"contains stale subgroup overview metadata entry: apps/public-docs/docs/student-handbook/workflows/_meta.json",
		);
	});

	it("rejects generated detail pages without visible source metadata", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/undergraduate/example.mdx");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan/undergraduate"), {
			recursive: true,
		});
		writeFileSync(
			target,
			["---", "title: 示例培养方案", "---", "", "## 正文", "", "内容。"].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"generated detail document must include visible source metadata",
		);
	});

	it("rejects raw React metadata component tags in generated docs", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/student-handbook/academic/example.mdx");
		mkdirSync(join(root, "apps/public-docs/docs/student-handbook/academic"), {
			recursive: true,
		});
		writeFileSync(
			target,
			[
				"---",
				"title: 示例学生手册",
				"---",
				"",
				'<DocumentMetaPanel metadata={{ collectionLabel: "学生手册" }} />',
				"",
				"正文。",
			].join("\n"),
			"utf-8",
		);

		const issues = validatePublicDocsGeneratedFile(target, { root });

		expect(issues.map((issue) => issue.message)).toContain(
			"generated source metadata must use static HTML, not a raw React component tag",
		);
	});

	it("allows collection landing pages without document source metadata", async () => {
		const { validatePublicDocsGeneratedFile } = await import("../scripts/check-generated-docs");
		const root = mkdtempSync(join(tmpdir(), "public-docs-check-"));
		temporaryDirectories.push(root);
		const target = join(root, "apps/public-docs/docs/curriculum-plan/index.md");
		mkdirSync(join(root, "apps/public-docs/docs/curriculum-plan"), { recursive: true });
		writeFileSync(target, ["---", "title: 培养方案概览", "---", "", "目录。"].join("\n"), "utf-8");

		expect(validatePublicDocsGeneratedFile(target, { root })).toEqual([]);
	});

	it("rejects tracked generated canonical reader content while allowing root scaffold files", async () => {
		const { validatePublicDocsTrackedPaths } = await import("../scripts/check-generated-docs");

		const issues = validatePublicDocsTrackedPaths([
			"apps/public-docs/docs/index.md",
			"apps/public-docs/docs/_meta.json",
			"apps/public-docs/docs/_nav.json",
			"apps/public-docs/docs/student-handbook/index.md",
			"apps/public-docs/docs/student-handbook/academic/credit-system.md",
			"apps/public-docs/docs/curriculum-plan/undergraduate/computer-science.mdx",
			"apps/public-docs/docs/public/course-maps/computer-science/map-01.png",
			"apps/public-docs/src/generated/course-maps/computer-science.data.ts",
		]);

		expect(issues.map((issue) => issue.message)).toEqual([
			"generated public-docs content must not be tracked: apps/public-docs/docs/student-handbook/index.md",
			"generated public-docs content must not be tracked: apps/public-docs/docs/student-handbook/academic/credit-system.md",
			"generated public-docs content must not be tracked: apps/public-docs/docs/curriculum-plan/undergraduate/computer-science.mdx",
			"generated public-docs content must not be tracked: apps/public-docs/docs/public/course-maps/computer-science/map-01.png",
			"generated public-docs content must not be tracked: apps/public-docs/src/generated/course-maps/computer-science.data.ts",
		]);
	});
});

describe("public-docs local scaffold", () => {
	it("materializes missing ignored collection directories without overwriting existing docs", async () => {
		const { ensurePublicDocsScaffold } = await import("../scripts/ensure-docs-scaffold");
		const root = mkdtempSync(join(tmpdir(), "public-docs-scaffold-"));
		temporaryDirectories.push(root);
		const docsRoot = join(root, "apps/public-docs/docs");
		mkdirSync(join(docsRoot, "student-handbook"), { recursive: true });
		writeFileSync(
			join(docsRoot, "student-handbook/index.md"),
			["---", "title: 真实学生手册", "---", "", "existing"].join("\n"),
			"utf-8",
		);

		ensurePublicDocsScaffold({ docsRoot });

		expect(readFileSync(join(docsRoot, "student-handbook/index.md"), "utf-8")).toContain(
			"title: 真实学生手册",
		);
		expect(readFileSync(join(docsRoot, "student-handbook/_meta.json"), "utf-8")).toBe("[]\n");
		expect(readFileSync(join(docsRoot, "curriculum-plan/index.md"), "utf-8")).toContain(
			"title: 培养方案",
		);
		expect(readFileSync(join(docsRoot, "curriculum-plan/_meta.json"), "utf-8")).toBe("[]\n");
	});
});
