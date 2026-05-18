import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildCourseMapDataImportName,
	buildCourseMapDataPayload,
	buildCourseMapDocEmbedForRoute,
	inferCourseMapRouteGroup,
	normalizeCourseMapNodeLabel,
	normalizeCourseMapStageLabel,
	resolveCourseMapPublicTitle,
	syncCurriculumCourseMapArtifacts,
} from "../scripts/sync-real-docs/course-map";
import { buildCurriculumMarkdown } from "../scripts/sync-real-docs/curriculum";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

describe("course-map rendering and artifact sync", () => {
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

	it("replaces generic section labels with stable public course-map titles", () => {
		expect(
			resolveCourseMapPublicTitle({
				documentTitle: "生物科学类本科人才培养方案",
				mapIndex: 2,
				title: "六、课程地图",
			}),
		).toEqual({
			title: "生物科学类本科人才培养方案课程地图（第 2 张）",
			titleConfidence: "absent",
		});
		expect(
			resolveCourseMapPublicTitle({
				documentTitle: "计算机类本科人才培养方案",
				mapIndex: 1,
				title: "软件工程专业本科课程结构拓扑图",
				titleConfidence: "visible",
			}),
		).toEqual({
			title: "软件工程专业本科课程结构拓扑图",
			titleConfidence: "visible",
		});
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
		expect(component).toContain("resolveRenderableCourseMapTitle");
		expect(component).toContain("单独打开原图");
		expect(component).not.toContain("需核对");
		expect(component).not.toContain("结构化课程路径");
		expect(css).not.toContain(".course-map-inspector");
		expect(css).not.toContain(".course-map-graph");
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
			docId: "curriculum:computer-science",
			schemaVersion: "curriculum_course_maps_reader_v1",
			versionId: "ver:computer-science",
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
					imagePath: "course-maps/map-01.png",
					nodes: [
						{
							nodeId: "node-programming",
							nodeLabel: "程序设计基础",
							stageId: "stage-1",
							stageLabel: "一年级上学期",
						},
					],
					edges: [],
				},
			],
		};
		const objects = new Map<string, string | Uint8Array>([
			[
				"curriculum/documents/curriculum_plan/computer/source-faithful/2022/docs-surfaces/course-maps.json",
				JSON.stringify(surface),
			],
			[
				"curriculum/documents/curriculum_plan/computer/source-faithful/2022/docs-surfaces/course-maps/map-01.png",
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

	it("syncs mixed published course-map image references from both relative paths and absolute object keys", async () => {
		const root = mkdtempSync(join(tmpdir(), "public-docs-course-map-mixed-"));
		temporaryDirectories.push(root);
		const docsRoot = join(root, "apps/public-docs/docs");
		const surface = {
			docId: "curriculum:mixed-course-map",
			schemaVersion: "curriculum_course_maps_reader_v1",
			versionId: "ver:mixed-course-map",
			blocks: [
				{
					blockId: "page-0001-row-1-map-01",
					title: "课程地图一",
					status: "ready",
					titleConfidence: "visible",
					pageNumber: 1,
					rowId: "page-0001-block-0001",
					mapIndex: 1,
					parentHeadingHint: "六、课程地图",
					displayStageLabels: ["一年级上学期"],
					extractionNotes: [],
					imagePath: "course-maps/map-01.png",
					nodes: [
						{
							nodeId: "node-1",
							nodeLabel: "程序设计基础",
							stageId: "stage-1",
							stageLabel: "一年级上学期",
						},
					],
					edges: [],
				},
				{
					blockId: "page-0002-row-1-map-01",
					title: "课程地图二",
					status: "partial",
					titleConfidence: "visible",
					pageNumber: 2,
					rowId: "page-0002-block-0001",
					mapIndex: 2,
					parentHeadingHint: "六、课程地图",
					displayStageLabels: ["一年级下学期"],
					extractionNotes: ["建议核对原图"],
					imagePath:
						"curriculum/documents/curriculum_plan/mixed/source-faithful/2022/docs-surfaces/course-maps/map-02.png",
					nodes: [
						{
							nodeId: "node-2",
							nodeLabel: "数据结构",
							stageId: "stage-2",
							stageLabel: "一年级下学期",
						},
					],
					edges: [],
				},
			],
		};
		const objects = new Map<string, string | Uint8Array>([
			[
				"curriculum/documents/curriculum_plan/mixed/source-faithful/2022/docs-surfaces/course-maps.json",
				JSON.stringify(surface),
			],
			[
				"curriculum/documents/curriculum_plan/mixed/source-faithful/2022/docs-surfaces/course-maps/map-01.png",
				new Uint8Array([1, 2, 3]),
			],
			[
				"curriculum/documents/curriculum_plan/mixed/source-faithful/2022/docs-surfaces/course-maps/map-02.png",
				new Uint8Array([4, 5, 6]),
			],
		]);

		await syncCurriculumCourseMapArtifacts({
			client: new FakeObjectStore(objects),
			curriculumDocs: [
				{
					key: "curriculum/documents/curriculum_plan/mixed/source-faithful/2022/document-units.jsonl",
					slug: "mixed-course-map",
					title: "混合课程地图示例",
				},
			],
			docsRoot,
		});

		expect(
			readdirSync(join(root, "apps/public-docs/docs/public/course-maps/mixed-course-map")).sort(),
		).toEqual(["map-01.png", "map-02.png"]);
		expect(
			readFileSync(
				join(root, "apps/public-docs/src/generated/course-maps/mixed-course-map.data.ts"),
				"utf-8",
			),
		).toContain('imageSrc: "/course-maps/mixed-course-map/map-02.png"');
	});
});
