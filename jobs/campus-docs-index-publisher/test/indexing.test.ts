import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "../../../apps/campus-web/fixtures/docs-source-site.ts";
import {
	canonicalJsonBytes,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type { DocsReaderElement } from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import {
	buildChunks,
	buildCurrentIndexBinding,
	buildPoint,
	buildSections,
	loadCurrentVersions,
	parseIndexingSource,
	sha256Text,
	sourceProjectionSha256,
} from "../src/indexing.ts";
import { buildSparseVector } from "../src/indexing.ts";
import { INDEX_DEFINITION } from "../src/types.ts";

describe("Campus docs indexing", () => {
	it("indexes only current reader versions and preserves section boundaries", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const selections = await loadCurrentVersions({
			readerStore: {
				read: async (key) => {
					const object = fixture.objects.get(key);
					if (!object) throw new Error(`missing fixture object: ${key}`);
					return object.body;
				},
			},
			source,
		});
		const attendance = selections.find((item) => item.document.docId === "doc_site_attendance");
		if (!attendance) throw new Error("attendance fixture is missing");
		const sections = buildSections(attendance.document, attendance.version, attendance.reader);
		expect(sections.map((section) => section.anchor)).toContain("attendance-leave-process");
		expect(sections.map((section) => section.anchor)).not.toContain("attendance-requirements");
		expect(sections.map((section) => section.sectionTitle)).toContain(
			"文档正文 > 教学活动要求 > 请假手续",
		);
		expect(
			sections.some((section) =>
				section.elements.some((element) => element.kind !== "table" && element.text.includes("普通正文")),
			),
		).toBe(true);
		const chunks = buildChunks({
			document: attendance.document,
			reader: attendance.reader,
			version: attendance.version,
		});
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks.every((chunk) => chunk.versionId === attendance.version.versionId)).toBe(true);
		expect(chunks.some((chunk) => chunk.content.includes("活动名称：校级社会实践"))).toBe(true);
		expect(
			chunks.every(
				(chunk) =>
					!chunk.rootUnitIds.includes("activity-credit-table") || chunk.rootUnitIds.length === 1,
			),
		).toBe(true);
	});

	it.each([
		[
			"migrated heading",
			{
				anchor: "scope",
				kind: "heading" as const,
				level: 2 as const,
				rootUnitId: "doc:migrated-heading-0001",
				text: "适用范围",
			},
			"reader contains migrated heading artifact",
		],
		[
			"pipe table",
			{
				kind: "paragraph" as const,
				rootUnitId: "doc:table-0001",
				text: "项目 | 要求\n学分 | 2",
			},
			"reader contains pipe-table paragraph",
		],
		[
			"folded numbered content",
			{
				kind: "paragraph" as const,
				rootUnitId: "doc:folded-numbered-0001",
				text: "1. 第一项\n2. 第二项",
			},
			"reader contains high-confidence folded numbered content",
		],
	])("rejects %s artifacts before indexing", async (_label, element, message) => {
		const fixture = createDocsSourceSiteFixture();
		const source = structuredClone(fixture.source);
		const document = source.documents[0];
		if (!document) throw new Error("docs fixture has no document");
		const version = source.versions.find(
			(candidate) => candidate.versionId === document.currentVersionId,
		);
		if (!version) throw new Error("docs fixture has no current version");
		const reader = {
			docId: document.docId,
			elements: [element],
			schemaVersion: "campus_docs_reader.v3" as const,
			supplements: [],
			versionId: version.versionId,
		};
		const readerBytes = canonicalJsonBytes(reader);
		const readerKey = `fixtures/docs/readers/${_label.replaceAll(" ", "-")}.json`;
		version.reader = {
			byteSize: readerBytes.byteLength,
			key: readerKey,
			sha256: sha256(readerBytes),
		};
		version.supplements = [];
		const indexingSource = parseIndexingSource(canonicalJsonBytes(source));

		await expect(
			loadCurrentVersions({
				readerStore: {
					async read(key) {
						if (key === readerKey) return readerBytes;
						const object = fixture.objects.get(key);
						if (!object) throw new Error(`missing fixture object: ${key}`);
						return object.body;
					},
				},
				source: indexingSource,
			}),
		).rejects.toThrow(message);
	});

	it("keeps heading paths in retrieval text and uses the canonical URL for preamble evidence", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const elements = [
			{ kind: "paragraph", rootUnitId: "root-preamble", text: "文档导言。" },
			{ anchor: "chapter", kind: "heading", level: 2, rootUnitId: "root-heading-1", text: "第一章" },
			{ anchor: "empty", kind: "heading", level: 3, rootUnitId: "root-heading-2", text: "空章节" },
			{ anchor: "details", kind: "heading", level: 3, rootUnitId: "root-heading-3", text: "办理细则" },
			{ kind: "paragraph", rootUnitId: "root-details", text: "应当提交完整材料。" },
		] satisfies DocsReaderElement[];
		const reader = { ...selection.reader, elements };

		const sections = buildSections(selection.document, selection.version, reader);
		expect(sections.map((section) => section.sectionTitle)).toEqual([
			selection.document.title,
			"第一章 > 办理细则",
		]);
		const chunks = buildChunks({ document: selection.document, reader, version: selection.version });
		const [preamble, details] = chunks;
		expect(preamble?.sectionRef).not.toContain("#");
		expect(preamble?.rootUnitIds).toEqual(["root-preamble"]);
		expect(preamble?.retrievalText).toBe(`${selection.document.title}\n文档导言。`);
		expect(details).toMatchObject({
			content: "应当提交完整材料。",
			rootUnitIds: ["root-details"],
			sectionTitle: "第一章 > 办理细则",
		});
		expect(details?.retrievalText).toBe(
			`${selection.document.title}\n第一章\n办理细则\n应当提交完整材料。`,
		);
		expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("空章节");
	});

	it("groups complete text elements to the soft target and preserves every root unit", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const elements = [
			{ anchor: "content", kind: "heading", level: 2, rootUnitId: "heading", text: "正文" },
			{ kind: "paragraph", rootUnitId: "root-a", text: "甲".repeat(390) },
			{ kind: "list", rootUnitId: "root-b", text: "乙".repeat(390) },
			{ kind: "blockquote", rootUnitId: "root-c", text: "丙".repeat(20) },
			{ kind: "paragraph", rootUnitId: "root-long", text: "丁".repeat(1700) },
		] satisfies DocsReaderElement[];
		const chunks = buildChunks({
			document: selection.document,
			reader: { ...selection.reader, elements },
			version: selection.version,
		});

		expect(chunks[0]?.rootUnitIds).toEqual(["root-a", "root-b", "root-c"]);
		expect(chunks[0]?.content).toBe(
			`${"甲".repeat(390)}\n\n${"乙".repeat(390)}\n\n${"丙".repeat(20)}`,
		);
		expect(chunks.filter((chunk) => chunk.rootUnitIds.includes("root-long"))).toHaveLength(2);
		expect(chunks.every((chunk) => [...chunk.content].length <= 1600)).toBe(true);
		expect(INDEX_DEFINITION.chunking.overlapChars).toBe(0);
	});

	it("splits oversized prose and lists only at structural boundaries without overlap", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const sentenceA = `${"甲".repeat(700)}。`;
		const sentenceB = `${"乙".repeat(700)}。`;
		const sentenceC = `${"丙".repeat(700)}。`;
		const itemA = "项目甲".repeat(200);
		const itemB = "项目乙".repeat(200);
		const itemC = "项目丙".repeat(200);
		const elements = [
			{ anchor: "long", kind: "heading", level: 2, rootUnitId: "heading", text: "超长正文" },
			{ kind: "paragraph", rootUnitId: "root-prose", text: sentenceA + sentenceB + sentenceC },
			{ kind: "list", rootUnitId: "root-list", text: `${itemA}\n${itemB}\n${itemC}` },
		] satisfies DocsReaderElement[];
		const chunks = buildChunks({
			document: selection.document,
			reader: { ...selection.reader, elements },
			version: selection.version,
		});
		const prose = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-prose"));
		const list = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-list"));

		expect(prose.map((chunk) => chunk.content)).toEqual([sentenceA + sentenceB, sentenceC]);
		expect(list.map((chunk) => chunk.content)).toEqual([`${itemA}\n${itemB}`, itemC]);
		expect(prose.map((chunk) => chunk.content).join("")).toBe(sentenceA + sentenceB + sentenceC);
		expect(list.map((chunk) => chunk.content).join("\n")).toBe(`${itemA}\n${itemB}\n${itemC}`);
	});

	it("does not split numeric and identifier punctuation inside oversized prose", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const protectedValues = ["2.72%", "97.51%", "1,000", "12:30", "docs.example.edu", "v1.2.3"];
		const elements = [
			{ anchor: "punctuation", kind: "heading", level: 2, rootUnitId: "heading", text: "标点" },
			...protectedValues.map((value, index) => ({
				kind: "paragraph" as const,
				rootUnitId: `root-punctuation-${index}`,
				text: `${"甲".repeat(810)}${value}${"乙".repeat(900)}`,
			})),
		] satisfies DocsReaderElement[];
		const chunks = buildChunks({
			document: selection.document,
			reader: { ...selection.reader, elements },
			version: selection.version,
		});

		for (const [index, value] of protectedValues.entries()) {
			const matchingChunks = chunks.filter((chunk) =>
				chunk.rootUnitIds.includes(`root-punctuation-${index}`),
			);
			expect(matchingChunks.some((chunk) => chunk.content.includes(value))).toBe(true);
		}
	});

	it("copies adjacent reader context into otherwise identical table chunks", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const tableRows = [
			[
				{ header: true, text: "类别" },
				{ header: true, text: "学分" },
			],
			[
				{ header: false, text: "演出实践" },
				{ header: false, text: "2" },
			],
		];
		const chunks = buildChunks({
			document: selection.document,
			reader: {
				...selection.reader,
				elements: [
					{
						anchor: "practice",
						kind: "heading",
						level: 2,
						rootUnitId: "heading",
						text: "专业实践",
					},
					{
						kind: "paragraph",
						rootUnitId: "root-track-a",
						text: "舞蹈表演专业实践包括毕业实习和演出实践。",
					},
					{ kind: "table", rootUnitId: "root-table-a", rows: tableRows },
					{
						kind: "paragraph",
						rootUnitId: "root-track-b",
						text: "舞蹈表演（民族英才班）专业实践包括毕业实习和演出实践。",
					},
					{ kind: "table", rootUnitId: "root-table-b", rows: tableRows },
				],
			},
			version: selection.version,
		});
		const trackA = chunks.find((chunk) => chunk.rootUnitIds.includes("root-table-a"));
		const trackB = chunks.find((chunk) => chunk.rootUnitIds.includes("root-table-b"));

		expect(trackA).toMatchObject({
			content: "舞蹈表演专业实践包括毕业实习和演出实践。\n\n类别：演出实践；学分：2",
			rootUnitIds: ["root-track-a", "root-table-a"],
		});
		expect(trackB).toMatchObject({
			content: "舞蹈表演（民族英才班）专业实践包括毕业实习和演出实践。\n\n类别：演出实践；学分：2",
			rootUnitIds: ["root-track-b", "root-table-b"],
		});
		expect(chunks.filter((chunk) => chunk.rootUnitIds.includes("root-track-a"))).toHaveLength(1);
		expect(chunks.filter((chunk) => chunk.rootUnitIds.includes("root-track-b"))).toHaveLength(1);
		expect(trackA?.retrievalText).not.toBe(trackB?.retrievalText);
	});

	it("copies a contiguous table lead-in and related list as one context chain", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const chunks = buildChunks({
			document: selection.document,
			reader: {
				...selection.reader,
				elements: [
					{
						anchor: "course-plan",
						kind: "heading",
						level: 2,
						rootUnitId: "heading",
						text: "课程安排",
					},
					{
						kind: "paragraph",
						rootUnitId: "root-lead-in",
						text: "修读建议如下：",
					},
					{
						kind: "list",
						rootUnitId: "root-advice",
						text: "1. 先修高等数学\n2. 再修线性代数",
					},
					{
						kind: "table",
						rootUnitId: "root-course-table",
						rows: [
							[
								{ header: true, text: "课程" },
								{ header: true, text: "学分" },
							],
							[
								{ header: false, text: "高等数学" },
								{ header: false, text: "4" },
							],
						],
					},
				],
			},
			version: selection.version,
		});

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({
			content:
				"修读建议如下：\n\n1. 先修高等数学\n2. 再修线性代数\n\n课程：高等数学；学分：4",
			rootUnitIds: ["root-lead-in", "root-advice", "root-course-table"],
		});
	});

	it("repeats a bounded tail context across split table chunks", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const context = "前文".repeat(250) + "\n最终表格说明如下：";
		const value = "甲".repeat(3000);
		const chunks = buildChunks({
			document: selection.document,
			reader: {
				...selection.reader,
				elements: [
					{
						anchor: "long-table",
						kind: "heading",
						level: 2,
						rootUnitId: "heading",
						text: "长表格",
					},
					{ kind: "paragraph", rootUnitId: "root-context", text: context },
					{
						kind: "table",
						rootUnitId: "root-long-table",
						rows: [
							[{ header: true, text: "说明" }],
							[{ header: false, text: value }],
						],
					},
				],
			},
			version: selection.version,
		});
		const tableChunks = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-long-table"));
		const contextPrefix = "最终表格说明如下：\n\n";
		const columnPrefix = "说明：";

		expect(tableChunks.length).toBeGreaterThan(1);
		expect(
			tableChunks.every(
				(chunk) =>
					chunk.content.startsWith(`${contextPrefix}${columnPrefix}`) &&
					chunk.rootUnitIds.join(",") === "root-context,root-long-table" &&
					[...chunk.content].length <= INDEX_DEFINITION.chunking.maxChars,
			),
		).toBe(true);
		expect(
			tableChunks
				.map((chunk) => chunk.content.slice(contextPrefix.length + columnPrefix.length))
				.join(""),
		).toBe(value);
	});

	it("does not attach an unrelated adjacent paragraph to a table", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const chunks = buildChunks({
			document: selection.document,
			reader: {
				...selection.reader,
				elements: [
					{ anchor: "form", kind: "heading", level: 2, rootUnitId: "heading", text: "申请表" },
					{
						kind: "paragraph",
						rootUnitId: "root-explanation",
						text: "十八、本办法由学生处负责解释。",
					},
					{
						kind: "table",
						rootUnitId: "root-form",
						rows: [
							[
								{ header: true, text: "姓名" },
								{ header: true, text: "学院" },
							],
							[
								{ header: false, text: "张三" },
								{ header: false, text: "文学院" },
							],
						],
					},
				],
			},
			version: selection.version,
		});
		const explanation = chunks.find((chunk) => chunk.rootUnitIds.includes("root-explanation"));
		const table = chunks.find((chunk) => chunk.rootUnitIds.includes("root-form"));

		expect(explanation?.rootUnitIds).toEqual(["root-explanation"]);
		expect(table?.rootUnitIds).toEqual(["root-form"]);
		expect(table?.content).not.toContain("本办法由学生处负责解释");
	});

	it("serializes table semantics without expanded coordinates or empty fields", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const elements = [
			{ anchor: "table", kind: "heading", level: 2, rootUnitId: "heading", text: "课程表" },
			{
				kind: "table",
				rootUnitId: "root-table",
				rows: [
					[
						{ header: true, rowSpan: 2, text: "课程类别" },
						{ colSpan: 2, header: true, text: "毕业要求" },
					],
					[
						{ header: true, text: "知识要求" },
						{ header: true, text: "能力要求" },
					],
					[
						{ header: false, rowSpan: 2, text: "必修" },
						{ colSpan: 2, header: false, text: "达成" },
					],
					[
						{ header: false, text: "掌握" },
						{ header: false, text: "掌握" },
					],
					[
						{ header: false, text: "选修" },
						{ header: false, text: "" },
						{ header: false, text: "了解" },
					],
				],
			},
			{
				kind: "table",
				rootUnitId: "root-no-header",
				rows: [
					[
						{ colSpan: 2, header: false, text: "甲" },
						{ header: false, text: "" },
						{ header: false, text: "乙" },
						{ header: false, text: "乙" },
					],
				],
			},
			{
				kind: "table",
				rootUnitId: "root-no-header-rowspan",
				rows: [
					[
						{ header: false, rowSpan: 2, text: "上下文" },
						{ header: false, text: "第一行" },
					],
					[{ header: false, text: "第二行" }],
				],
			},
			{
				kind: "table",
				rootUnitId: "root-header-only",
				rows: [
					[{ colSpan: 2, header: true, text: "课程信息" }],
					[
						{ header: true, text: "类别" },
						{ header: true, text: "名称" },
					],
				],
			},
			{
				kind: "table",
				rootUnitId: "root-unused-headers",
				rows: [
					[
						{ header: true, text: "项目" },
						{ header: true, text: "学生民主互评" },
						{ header: true, text: "测评小组评定" },
					],
					[
						{ header: false, text: "思想政治表现" },
						{ header: false, text: "" },
						{ header: false, text: "" },
					],
				],
			},
			{
				kind: "table",
				rootUnitId: "root-long-cell",
				rows: [
					[{ header: true, text: "说明" }],
					[{ header: false, text: "丙".repeat(3200) }],
				],
			},
		] satisfies DocsReaderElement[];
		const chunks = buildChunks({
			document: selection.document,
			reader: { ...selection.reader, elements },
			version: selection.version,
		});
		const spanned = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-table"));
		const noHeader = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-no-header"));
		const noHeaderRowSpan = chunks.filter((chunk) =>
			chunk.rootUnitIds.includes("root-no-header-rowspan"),
		);
		const headerOnly = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-header-only"));
		const unusedHeaders = chunks.filter((chunk) =>
			chunk.rootUnitIds.includes("root-unused-headers"),
		);
		const longCell = chunks.filter((chunk) => chunk.rootUnitIds.includes("root-long-cell"));

		expect(spanned.map((chunk) => chunk.content)).toEqual([
			[
				"课程类别：必修；毕业要求 / 知识要求、能力要求：达成",
				"课程类别：必修；毕业要求 / 知识要求、能力要求：掌握",
				"课程类别：选修；毕业要求 / 能力要求：了解",
			].join("\n"),
		]);
		expect(noHeader.map((chunk) => chunk.content)).toEqual(["甲；乙"]);
		expect(noHeaderRowSpan.map((chunk) => chunk.content)).toEqual([
			"上下文；第一行\n上下文；第二行",
		]);
		expect(headerOnly.map((chunk) => chunk.content)).toEqual(["课程信息\n类别；名称"]);
		expect(unusedHeaders.map((chunk) => chunk.content)).toEqual([
			"学生民主互评、测评小组评定\n项目：思想政治表现",
		]);
		expect(unusedHeaders[0]?.content).not.toContain("学生民主互评：");
		expect(longCell).toHaveLength(3);
		expect(longCell.map((chunk) => chunk.content.replace(/^说明：/u, "")).join(""))
			.toBe("丙".repeat(3200));
		expect(chunks.every((chunk) => chunk.rootUnitIds.length === 1)).toBe(true);
		expect(chunks.every((chunk) => [...chunk.content].length <= 1600)).toBe(true);
	});

	it("produces stable fingerprints and bounded sparse vectors", async () => {
		const index = `sha256:${"a".repeat(64)}` as const;
		const first = buildCurrentIndexBinding(index);
		const second = buildCurrentIndexBinding(index);
		expect(first.collection).toMatch(/^campus_docs_[a-f0-9]{64}$/u);
		expect(second).toEqual(first);
		expect(first.embedding_space_id).toBe(INDEX_DEFINITION.embedding.spaceId);
		const sparse = buildSparseVector("培养方案 Course_101 course_101 课程 课程 ÄÖ");
		expect(sparse).toEqual({
			indices: [148423468, 272413536, 603158067, 919704991, 1116344764, 1145662860, 1154101346, 1767701743],
			values: [
				0.6931471805599453,
				0.6931471805599453,
				1.0986122886681096,
				0.6931471805599453,
				0.6931471805599453,
				0.6931471805599453,
				1.0986122886681096,
				1.0986122886681096,
			],
		});
	});

	it("matches the cross-language sparse Unicode normalization fixture", () => {
		expect(buildSparseVector("İ İ ΣΟΣ ÄÖ ẞ Course_101 course_101 课程 课程")).toEqual({
			indices: [603158067, 815662359, 919704991, 1129763277, 1154101346, 1272149201, 1767701743],
			values: [
				1.0986122886681096,
				0.6931471805599453,
				0.6931471805599453,
				1.0986122886681096,
				1.0986122886681096,
				0.6931471805599453,
				1.0986122886681096,
			],
		});
	});

	it("binds the index only to current document selections", async () => {
		const fixture = createDocsSourceSiteFixture();
		const read = async (key: string) =>
			fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })();
		const baselineSource = parseIndexingSource(fixture.sourceBytes);
		const baselineSelections = await loadCurrentVersions({
			readerStore: { read },
			source: baselineSource,
		});
		const historicalOnlySource = parseIndexingSource(canonicalJsonBytes({
			...fixture.source,
			versions: fixture.source.versions.map((version) =>
				version.isCurrent ? version : { ...version, label: `${version.label}（修订说明）` },
			),
		}));
		const historicalOnlySelections = await loadCurrentVersions({
			readerStore: { read },
			source: historicalOnlySource,
		});

		expect(historicalOnlySource.sourceBytes).not.toEqual(baselineSource.sourceBytes);
		expect(sourceProjectionSha256(historicalOnlySelections)).toBe(
			sourceProjectionSha256(baselineSelections),
		);

		const changedCurrentSource = parseIndexingSource(canonicalJsonBytes({
			...fixture.source,
			documents: fixture.source.documents.map((document, index) =>
				index === 0 ? { ...document, title: `${document.title}（修订）` } : document,
			),
		}));
		const changedCurrentSelections = await loadCurrentVersions({
			readerStore: { read },
			source: changedCurrentSource,
		});
		expect(sourceProjectionSha256(changedCurrentSelections)).not.toBe(
			sourceProjectionSha256(baselineSelections),
		);
	});

	it("binds section identities to the document version", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const original = buildSections(selection.document, selection.version, selection.reader);
		const changed = buildSections(
			{ ...selection.document, docId: "doc_other", currentVersionId: "version_other" },
			{ ...selection.version, docId: "doc_other", versionId: "version_other" },
			{ ...selection.reader, docId: "doc_other", versionId: "version_other" },
		);
		expect(changed.map((section) => section.sectionId)).not.toEqual(
			original.map((section) => section.sectionId),
		);
	});

	it("uses deterministic UUID point identities accepted by Qdrant", async () => {
		const fixture = createDocsSourceSiteFixture();
		const source = parseIndexingSource(fixture.sourceBytes);
		const [selection] = await loadCurrentVersions({
			readerStore: {
				read: async (key) => fixture.objects.get(key)?.body ?? (() => { throw new Error(key); })(),
			},
			source,
		});
		if (!selection) throw new Error("docs fixture is empty");
		const [chunk] = buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		});
		if (!chunk) throw new Error("docs fixture produced no chunks");
		const input = { chunk, dense: [0.1, 0.2, 0.3] };
		const first = buildPoint(input);
		const second = buildPoint(input);
		expect(first.id).toBe(second.id);
		expect(first.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
		expect(first.id).not.toBe(chunk.chunkId);
		expect(first.payload).toMatchObject({
			retrieval_text_sha256: sha256Text(chunk.retrievalText),
			root_unit_ids: chunk.rootUnitIds,
			schema_version: "campus_docs_point.v3",
			text_sha256: sha256Text(chunk.content),
			version_id: chunk.versionId,
			version_label: chunk.versionLabel,
			version_slug: chunk.versionSlug,
		});
		expect(first.vector.sparse).toEqual(buildSparseVector(chunk.retrievalText));
	});
});
