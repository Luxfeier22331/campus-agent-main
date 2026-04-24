import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildCourseMapDataImportName,
	inferCourseMapRouteGroup,
} from "../scripts/sync-real-docs/course-map";
import {
	buildCurriculumMarkdown,
	discoverCurriculumDocs,
} from "../scripts/sync-real-docs/curriculum";
import { cleanHandbookMarkdown } from "../scripts/sync-real-docs/handbook";
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
		expect(markdown).toContain("\n1\\.1 掌握数学、自然科学、工程基础和计算机类专业知识。\n");
		expect(markdown).toContain("\n1\\.2 应用数学、自然科学和工程科学基本原理识别复杂工程问题。\n");
		expect(markdown).not.toContain("复杂工程问题。1\\.1");
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
