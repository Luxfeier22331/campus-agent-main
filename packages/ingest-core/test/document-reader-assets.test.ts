import { describe, expect, it } from "vitest";
import {
	buildDocumentReaderAssetPackage,
	buildDocumentReaderPublishEntry,
	buildPublicDocsSyncManifest,
	type DocumentReaderRegistryRecord,
} from "../src/index.ts";

describe("document reader assets", () => {
	it("emits reader, outline, meta, manifest and course-map supplement assets", () => {
		const record = publicCurriculumRecord();
		const courseMapImageKey =
			"curriculum/documents/curriculum_plan/law-ethnic-class-program--law-ethnic/current-effective/2026/reader-assets/course-maps/page-0349-row-01-map-01.png";

		const assetPackage = buildDocumentReaderAssetPackage({
			canonicalMarkdown: [
				"# 法学（民族班）培养方案",
				"",
				"## 课程设置",
				"",
				"### 第一学期",
				"",
				"第一学期开设思想政治理论、大学英语、体育。",
				"",
				"### 第二学期",
				"",
				"第二学期开设法理学、宪法学。",
				"",
			].join("\n"),
			courseMapImageObjects: {
				[courseMapImageKey]: textBytes("course-map-image"),
			},
			courseMapsJson: {
				schemaVersion: "curriculum_course_map_docs_surface_v2",
				generatedAt: "2026-04-23T08:00:00+00:00",
				documentId: "curriculum:law-ethnic-class-program",
				documentTitle: "法学（民族班）培养方案",
				rawAssetId: "asset:curriculum-plan-2026",
				rawVersionId: "sha256:course-map",
				blocks: [
					{
						blockId: "page-0349-row-01-map-01",
						pageNumber: 349,
						rowId: "page-0349-row-01",
						mapIndex: 1,
						title: "课程地图",
						status: "ready",
						titleConfidence: "visible",
						parentHeadingHint: "六、课程地图",
						displayStageLabels: ["第一学期"],
						nodes: [
							{
								node_id: "node-legal-theory",
								node_label: "法理学",
								stage_id: "stage-1",
								stage_label: "第一学期",
								category_label: "",
							},
						],
						edges: [
							{
								edge_id: "edge-legal-constitution",
								source_node_id: "node-legal-theory",
								source_label: "法理学",
								target_node_id: "node-constitution",
								target_label: "宪法学",
							},
						],
						extractionNotes: ["自动抽取通过"],
						imageObjectKey: courseMapImageKey,
						regionBBoxProvider: [10, 20, 30, 40],
					},
				],
			},
			documentUnitsJsonl: [
				documentUnit(record, {
					chunk_id: "unit-001",
					root_unit_id: "curriculum-root-001",
					unit_type: "heading",
					clean_text: "第一学期",
					anchor: { section_path: ["课程设置", "第一学期"], page_start: 1, page_end: 1 },
					metadata: { heading_level: 2 },
				}),
				documentUnit(record, {
					chunk_id: "unit-002",
					root_unit_id: "semester-1-course-list",
					unit_type: "paragraph",
					clean_text: "第一学期开设思想政治理论、大学英语、体育。",
					anchor: { section_path: ["课程设置", "第一学期"], page_start: 1, page_end: 1 },
				}),
				documentUnit(record, {
					chunk_id: "unit-003",
					root_unit_id: "semester-2-course-list",
					unit_type: "paragraph",
					clean_text: "第二学期开设法理学、宪法学。",
					anchor: { section_path: ["课程设置", "第二学期"], page_start: 2, page_end: 2 },
				}),
			],
			record,
		});

		expect(Object.keys(assetPackage.assets).sort()).toEqual([
			"asset-manifest.json",
			"course-maps.json",
			"course-maps/page-0349-row-01-map-01.png",
			"meta.json",
			"outline.json",
			"reader.json",
		]);
		const reader = parseAsset(assetPackage, "reader.json");
		expect(reader.document.docId).toBe(record.document_id);
		expect(reader.document.documentSlug).toBe("law-ethnic-class-program");
		expect(reader.sections[0]?.anchor).toBe("section-b57a3af59c/section-5e7417834c");
		expect(reader.sections[0]?.blocks[1]?.rootUnitId).toBe("semester-1-course-list");
		expect(reader.supplements).toEqual([{ kind: "course_maps", path: "course-maps.json" }]);
		const readerJson = new TextDecoder().decode(assetPackage.assets["reader.json"]);
		expect(readerJson.startsWith('{"document":{"collection":"curriculum_plan"')).toBe(true);
		expect(readerJson).not.toContain("\n  ");

		const courseMaps = parseAsset(assetPackage, "course-maps.json");
		expect(courseMaps.versionId).toBe("ver_2026_01");
		expect(courseMaps.blocks[0].imagePath).toBe("course-maps/page-0349-row-01-map-01.png");
		expect(courseMaps.blocks[0].nodes[0].nodeId).toBe("node-legal-theory");
		expect(courseMaps.blocks[0].edges[0].sourceNodeId).toBe("node-legal-theory");
		expect(courseMaps.blocks[0]).not.toHaveProperty("imageObjectKey");
		expect(assetPackage.assets["course-maps/page-0349-row-01-map-01.png"]).toEqual(
			textBytes("course-map-image"),
		);

		const outline = parseAsset(assetPackage, "outline.json");
		expect(outline.nodes).toEqual([
			{
				anchor: "section-b57a3af59c",
				depth: 1,
				order: 1,
				parentAnchor: null,
				title: "课程设置",
			},
			{
				anchor: "section-b57a3af59c/section-5e7417834c",
				depth: 2,
				order: 2,
				parentAnchor: "section-b57a3af59c",
				title: "第一学期",
			},
			{
				anchor: "section-b57a3af59c/section-874265e06a",
				depth: 2,
				order: 3,
				parentAnchor: "section-b57a3af59c",
				title: "第二学期",
			},
		]);
		const meta = parseAsset(assetPackage, "meta.json");
		expect(meta.canonicalUrl).toBe("/docs/curriculum/curriculum_plan/law-ethnic-class-program");
		expect(meta.resolvedVersion.versionSlug).toBe("2026-current");
		const manifest = parseAsset(assetPackage, "asset-manifest.json");
		expect(manifest.files["course-maps.json"].contentType).toBe("application/json");
		expect(manifest.files["course-maps/page-0349-row-01-map-01.png"].contentType).toBe("image/png");
		expect(manifest.readerTarget).toEqual({
			anchor: null,
			canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
			docId: record.document_id,
			highlightRootUnitIds: [],
			versionId: record.version_id,
		});
	});

	it("excludes table_unit rows from reader blocks", () => {
		const record = publicCurriculumRecord();
		const htmlTable =
			'<table><tr><td rowspan="2">比赛项目</td><td colspan="2">评分标准</td></tr><tr><td>第一名</td><td>第二名</td></tr><tr><td>全国大学生运动会</td><td>20分</td><td>15分</td></tr></table>';
		const pipeTable =
			"比赛项目 | 评分标准 / 第一名 | 评分标准 / 第二名\n全国大学生运动会 | 20分 | 15分";

		const assetPackage = buildDocumentReaderAssetPackage({
			canonicalMarkdown: "# 竞赛成绩\n\n[表格]\n",
			documentUnitsJsonl: [
				documentUnit(record, {
					chunk_id: "table-0001",
					root_unit_id: "table-0001",
					unit_type: "table",
					clean_text: htmlTable,
					anchor: { section_path: ["竞赛成绩"], page_start: 1, page_end: 1 },
				}),
				documentUnit(record, {
					chunk_id: "table-0001-unit",
					root_unit_id: "table-0001",
					unit_type: "table_unit",
					clean_text: pipeTable,
					anchor: { section_path: ["竞赛成绩"], page_start: 1, page_end: 1 },
				}),
			],
			record,
		});

		const reader = parseAsset(assetPackage, "reader.json");
		expect(
			reader.sections[0].blocks.map((block: { rootUnitId: string }) => block.rootUnitId),
		).toEqual(["table-0001"]);
		expect(reader.sections[0].blocks[0].kind).toBe("table");
		expect(JSON.stringify(reader)).not.toContain(pipeTable);
	});

	it("builds public and gated publish entries", () => {
		const publicEntry = buildDocumentReaderPublishEntry({
			publishedAssetNames: [
				"reader.json",
				"outline.json",
				"meta.json",
				"asset-manifest.json",
				"course-maps.json",
				"course-maps/page-0349-row-01-map-01.png",
			],
			record: publicCurriculumRecord(),
			title: "法学（民族班）培养方案",
		});

		expect(publicEntry.deliveryMode).toBe("public_static_asset");
		expect(publicEntry.documentSlug).toBe("law-ethnic-class-program");
		expect(publicEntry.versionSlug).toBe("2026-current");
		expect(publicEntry.sourceObjects.reader).toBe(
			"curriculum/documents/curriculum_plan/法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/reader-assets/reader.json",
		);
		expect(publicEntry.sourceObjects["supplement.course-maps.json"]).toBe(
			"curriculum/documents/curriculum_plan/法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/reader-assets/course-maps.json",
		);
		expect(publicEntry.targetObjects.reader).toBe(
			"_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
		);

		const gatedEntry = buildDocumentReaderPublishEntry({
			record: {
				...publicCurriculumRecord(),
				document_id: "curriculum:restricted-program",
				entitlement_groups: ["students"],
				version_id: "ver_2026_restricted",
				visibility_level: "restricted",
				document_units_object_key:
					"curriculum/documents/curriculum_plan/restricted-program--restricted/current-effective/2026/document-units.jsonl",
			},
			title: "受限培养方案",
		});

		expect(gatedEntry.deliveryMode).toBe("gated_asset");
		expect(gatedEntry.targetObjects.reader).toBe(
			"_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
		);
	});

	it("keeps regulation document slug separate from effective-date version slug", () => {
		const entry = buildDocumentReaderPublishEntry({
			record: {
				...publicCurriculumRecord(),
				canonical_markdown_object_key:
					"regulations/documents/institutional_rules/示例大学采购工作管理办法--219ecb63/source-faithful/2021/canonical.md",
				collection: "institutional_rules",
				corpus: "regulations",
				document_id: "institutional_regulation:example:示例大学采购工作管理办法:219ecb636aaf",
				document_units_object_key:
					"regulations/documents/institutional_rules/示例大学采购工作管理办法--219ecb63/source-faithful/2021/document-units.jsonl",
				effective_date: "2021年3月1日",
				entitlement_groups: ["campus_members"],
				import_source: "internal_notice_regulation_projection",
				is_current: true,
				published_date: "2021-02-28",
				revision_track: "source-faithful",
				source_channel: "manual_curated",
				source_uri: "campus-agent://promotion/synthetic_notice/187233",
				version_id: "sha256:c55cc6f8:effective-2021年3月1日:revision-修订",
				visibility_level: "restricted",
			},
			title: "示例大学采购工作管理办法",
		});

		expect(entry.documentSlug).toBe("示例大学采购工作管理办法");
		expect(entry.versionSlug).toBe("effective-2021-03-01");
		expect(entry.canonicalUrl).toBe(
			"/docs/regulations/institutional_rules/示例大学采购工作管理办法",
		);
		expect(entry.targetObjects.reader).toBe(
			"_gated-docs/regulations/institutional_rules/示例大学采购工作管理办法/effective-2021-03-01/reader.json",
		);
		expect(Object.values(entry.targetObjects).join("\n")).not.toContain("2021年修订");
	});

	it("keeps public and gated entries in the public docs sync manifest", () => {
		const publicEntry = buildDocumentReaderPublishEntry({
			record: publicCurriculumRecord(),
			title: "法学（民族班）培养方案",
		});
		const gatedEntry = buildDocumentReaderPublishEntry({
			record: {
				...publicCurriculumRecord(),
				document_id: "curriculum:restricted-program",
				entitlement_groups: ["students"],
				version_id: "ver_2026_restricted",
				visibility_level: "restricted",
			},
			title: "受限培养方案",
		});

		expect(
			buildPublicDocsSyncManifest({
				entries: [publicEntry, gatedEntry],
				generatedAt: "2026-04-23T08:30:00+00:00",
			}),
		).toEqual({
			entries: [publicEntry, gatedEntry],
			generatedAt: "2026-04-23T08:30:00+00:00",
			surface: "public_docs",
		});
	});
});

function publicCurriculumRecord(): DocumentReaderRegistryRecord {
	return {
		canonical_markdown_object_key:
			"curriculum/documents/curriculum_plan/law-ethnic-class-program--law-ethnic/current-effective/2026/canonical.md",
		collection: "curriculum_plan",
		content_hash: "sha256:test-curriculum-doc",
		corpus: "curriculum",
		document_id: "curriculum:law-ethnic-class-program",
		document_units_object_key:
			"curriculum/documents/curriculum_plan/law-ethnic-class-program--law-ethnic/current-effective/2026/document-units.jsonl",
		effective_date: "2026-02-01",
		embedding_model: "text-embedding-3-large",
		entitlement_groups: [],
		import_source: "raw_online_ocr",
		ingestion_timestamp: "2026-04-23T08:00:00+00:00",
		is_current: true,
		parser_version: "mineru_api_v1",
		published_date: "2026-02-15",
		revision_track: "current-effective",
		source_channel: "pdf_ocr",
		source_uri:
			"campus-agent://curriculum/curriculum_plan/docs/curriculum:law-ethnic-class-program",
		status: "active",
		version_id: "ver_2026_01",
		visibility_level: "public",
		visibility_scope: "main",
	};
}

function documentUnit(record: DocumentReaderRegistryRecord, input: Record<string, unknown>) {
	return {
		doc_id: record.document_id,
		version_id: record.version_id,
		...input,
	};
}

function parseAsset(assetPackage: { assets: Record<string, Uint8Array> }, name: string) {
	return JSON.parse(new TextDecoder().decode(assetPackage.assets[name]));
}

function textBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}
