import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseHotfixDocsReaderSegmentationArgs } from "../scripts/hotfix-docs-reader-segmentation.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";
import {
	assertReaderSegmentationQuality,
	cleanReaderSegmentation,
} from "../src/docs-reader-build/reader-segmentation.ts";
import {
	applyPreparedDocsReaderSegmentationHotfix,
	prepareDocsReaderSegmentationHotfix,
} from "../src/docs-reader-build/reader-segmentation-hotfix.ts";
import {
	canonicalJsonBytes,
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	sha256,
} from "../src/docs-reader-build/source-catalog.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";
import type {
	DocsReader,
	DocsSourceManifest,
	DocsSupplement,
	ObjectRef,
} from "../src/docs-reader-build/source-types.ts";

describe("文档 reader 分段清洗", () => {
	it.each([
		["阿拉伯数字", "1. 第一项\n2) 第二项"],
		["中文数字", "（一）第一项\n（二）第二项"],
	])("将%s编号段落转换为保留原编号的列表", (_label, text) => {
		const result = cleanReaderSegmentation(readerFixture(text));

		expect(result.reader.elements[0]).toEqual({
			kind: "list",
			rootUnitId: "root-1",
			text,
		});
		expect(result.changes).toEqual([{ kind: "numbered_list", rootUnitId: "root-1" }]);
	});

	it("清洗真实文档中的连续编号段落", () => {
		const result = cleanReaderSegmentation(
			readerFixture(
				"1. 政治素质：热爱社会主义祖国，拥护中国共产党，具有良好的政治思想素质、道德品质、法治意识、诚信意识和团队合作精神，能自觉践行社会主义核心价值观，具有中华民族共同体意识。\n2. 思想品德：具有良好的思想品德、职业道德和社会责任意识，具有良好的心理素质和积极的人生观。\n3. 综合素养：拥有一定的人文素养和艺术鉴赏能力，熟练使用现代信息技术和一门外语，热爱劳动，身心健康，富有创新精神。\n4. 职业素养：具有健全的职业人格，热爱统计学事业，拥有严谨的科学思维，具备科学的统计思想，具有严谨治学、艰苦奋斗、求新务实的精神。\n5. 国际视野：了解国内外统计工作中常用方法与工具，具备跨文化沟通能力。",
			),
		);

		expect(result.reader.elements[0]).toMatchObject({
			kind: "list",
			text: "1. 政治素质：热爱社会主义祖国，拥护中国共产党，具有良好的政治思想素质、道德品质、法治意识、诚信意识和团队合作精神，能自觉践行社会主义核心价值观，具有中华民族共同体意识。\n2. 思想品德：具有良好的思想品德、职业道德和社会责任意识，具有良好的心理素质和积极的人生观。\n3. 综合素养：拥有一定的人文素养和艺术鉴赏能力，熟练使用现代信息技术和一门外语，热爱劳动，身心健康，富有创新精神。\n4. 职业素养：具有健全的职业人格，热爱统计学事业，拥有严谨的科学思维，具备科学的统计思想，具有严谨治学、艰苦奋斗、求新务实的精神。\n5. 国际视野：了解国内外统计工作中常用方法与工具，具备跨文化沟通能力。",
		});
		expect(result.changes).toEqual([{ kind: "numbered_list", rootUnitId: "root-1" }]);
	});

	it("为引导语、编号项和尾段添加显示段落边界", () => {
		const withoutTail = cleanReaderSegmentation(readerFixture("要求如下：\n1. 第一项\n2. 第二项"));
		const withTail = cleanReaderSegmentation(
			readerFixture("要求如下：\n（一）第一项\n（二）第二项\n以上要求自发布之日起施行。"),
		);

		expect(withoutTail.reader.elements[0]).toMatchObject({
			kind: "paragraph",
			text: "要求如下：\n\n1. 第一项\n\n2. 第二项",
		});
		expect(withTail.reader.elements[0]).toMatchObject({
			kind: "paragraph",
			text: "要求如下：\n\n（一）第一项\n\n（二）第二项\n\n以上要求自发布之日起施行。",
		});
		expect(withTail.changes[0]?.kind).toBe("paragraph_with_numbered_list_and_tail");
		expect(cleanReaderSegmentation(withTail.reader).changes).toEqual([]);
	});

	it.each(["第一段\n第二段", "500-\n3000"])("不推断普通断行：%s", (text) => {
		const reader = readerFixture(text);
		const result = cleanReaderSegmentation(reader);

		expect(result.reader).toBe(reader);
		expect(result.changes).toEqual([]);
		expect(result.unresolved).toEqual([{ rootUnitId: "root-1", text }]);
	});

	it("清洗幂等并保留 reader 身份、补充声明和内容单元标识", () => {
		const reader: DocsReader = {
			...readerFixture("1. 第一项\n2. 第二项"),
			docId: "doc-stable",
			supplements: [{ kind: "course_maps", path: "course-maps.json" }],
			versionId: "version-stable",
		};

		const first = cleanReaderSegmentation(reader);
		const second = cleanReaderSegmentation(first.reader);

		expect(first.reader).toMatchObject({
			docId: "doc-stable",
			supplements: reader.supplements,
			versionId: "version-stable",
		});
		expect(first.reader.elements.map((element) => element.rootUnitId)).toEqual(["root-1"]);
		expect(second.reader).toBe(first.reader);
		expect(second.changes).toEqual([]);
		expect(() => assertReaderSegmentationQuality(first.reader)).not.toThrow();
	});

	it("编译质量门禁拒绝仍折叠的高置信编号段落", async () => {
		const fixture = createSourceFixture();
		const reader = readerFixture("1. 第一项\n2. 第二项");
		fixture.store.objects.set(fixture.readerRef.key, canonicalJsonBytes(reader));

		await expect(
			compileDocsSource({ client: fixture.store, source: fixture.source }),
		).rejects.toThrow("reader contains high-confidence folded numbered content: root-1");
		expect(() => assertReaderSegmentationQuality(reader)).toThrow("high-confidence folded");
	});
});

describe("文档 reader 分段热修", () => {
	it("默认预览并要求来源摘要与报告目录", () => {
		expect(
			parseHotfixDocsReaderSegmentationArgs([
				"--expected-source-digest",
				`sha256:${"a".repeat(64)}`,
				"--report-dir",
				"report",
			]),
		).toEqual({
			apply: false,
			expectedSourceDigest: `sha256:${"a".repeat(64)}`,
			reportDir: resolve("report"),
		});
		expect(() => parseHotfixDocsReaderSegmentationArgs([])).toThrow(
			"usage: hotfix-docs-reader-segmentation",
		);
	});

	it("摘要不匹配时不读取 reader，也不写入对象", async () => {
		const fixture = createSourceFixture();

		await expect(
			prepareDocsReaderSegmentationHotfix({
				client: fixture.store,
				expectedSourceDigest: `sha256:${"a".repeat(64)}`,
			}),
		).rejects.toThrow("campus docs source digest changed");
		expect(fixture.store.reads).toEqual([DOCS_SOURCE_KEY]);
		expect(fixture.store.writes).toEqual([]);
	});

	it("完整编译失败时不上传 reader 或更新来源键", async () => {
		const fixture = createSourceFixture({ invalidCourseMaps: true });
		const previous = fixture.store.objects.get(DOCS_SOURCE_KEY);

		await expect(
			prepareDocsReaderSegmentationHotfix({
				client: fixture.store,
				expectedSourceDigest: fixture.sourceDigest,
			}),
		).rejects.toThrow("must contain at least one map");
		expect(fixture.store.writes).toEqual([]);
		expect(fixture.store.objects.get(DOCS_SOURCE_KEY)).toBe(previous);
	});

	it("上传内容寻址 reader 后更新来源清单", async () => {
		const fixture = createSourceFixture();
		const prepared = await prepareDocsReaderSegmentationHotfix({
			client: fixture.store,
			expectedSourceDigest: fixture.sourceDigest,
			generatedAt: "2026-08-02T00:00:00.000Z",
		});

		expect(prepared.report).toMatchObject({
			changedBlockCount: 1,
			changedReaderCount: 1,
			readerCount: 1,
			unresolvedBlockCount: 0,
		});
		const result = await applyPreparedDocsReaderSegmentationHotfix({
			client: fixture.store,
			prepared,
		});

		expect(result).toEqual({
			sourceDigest: prepared.report.candidateSourceDigest,
			sourceUpdated: true,
			uploadedReaderCount: 1,
		});
		const readerObject = prepared.readerObjects[0];
		expect(readerObject?.ref.key).toMatch(
			/^campus-docs\/readers\/sha256\/[a-f0-9]{64}\/reader\.json$/u,
		);
		expect(readerObject && fixture.store.objects.get(readerObject.ref.key)).toEqual(
			readerObject?.bytes,
		);
		expect(fixture.store.objects.get(DOCS_SOURCE_KEY)).toEqual(prepared.candidateSourceBytes);
		expect(fixture.store.reads.at(-1)).toBe(DOCS_SOURCE_KEY);
	});

	it("预览后来源摘要变化时禁止应用", async () => {
		const fixture = createSourceFixture();
		const prepared = await prepareDocsReaderSegmentationHotfix({
			client: fixture.store,
			expectedSourceDigest: fixture.sourceDigest,
		});
		fixture.store.objects.set(DOCS_SOURCE_KEY, new TextEncoder().encode("changed source"));

		await expect(
			applyPreparedDocsReaderSegmentationHotfix({ client: fixture.store, prepared }),
		).rejects.toThrow("campus docs source digest changed");
		expect(fixture.store.writes).toEqual([]);
	});
});

function readerFixture(text: string): DocsReader {
	return {
		docId: "doc-1",
		elements: [{ kind: "paragraph", rootUnitId: "root-1", text }],
		schemaVersion: "campus_docs_reader.v3",
		supplements: [],
		versionId: "version-1",
	};
}

function createSourceFixture(input: { invalidCourseMaps?: boolean } = {}): {
	readerRef: ObjectRef;
	source: DocsSourceManifest;
	sourceDigest: `sha256:${string}`;
	store: MemoryStore;
} {
	const store = memoryStore();
	const supplements: DocsSupplement[] = [];
	const reader = readerFixture("1. 第一项\n2. 第二项");
	if (input.invalidCourseMaps) {
		supplements.push({
			assets: [],
			kind: "course_maps",
			object: putJson(store, "inputs/invalid-course-maps.json", {
				blocks: [],
				schemaVersion: "curriculum_course_maps_reader_v1",
			}),
			path: "course-maps.json",
		});
		reader.supplements = [{ kind: "course_maps", path: "course-maps.json" }];
	}
	const readerRef = putJson(store, "readers/original.json", reader);
	const source = normalizeSourceManifest({
		collections: [
			{
				collection: "undergraduate",
				corpus: "curriculum",
				description: "本科培养方案。",
				displayName: "本科培养方案",
			},
		],
		documents: [
			{
				collection: "undergraduate",
				corpus: "curriculum",
				currentVersionId: "version-1",
				currentVersionSlug: "current",
				docId: "doc-1",
				documentSlug: "document-1",
				title: "测试培养方案",
				topicId: null,
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_source.v3",
		topics: [],
		versions: [
			{
				docId: "doc-1",
				effectiveFrom: null,
				isCurrent: true,
				label: "现行版",
				reader: readerRef,
				sourceLabel: "测试来源",
				supplements,
				updatedAt: "2026-08-02T00:00:00.000Z",
				versionId: "version-1",
				versionSlug: "current",
			},
		],
	});
	const sourceBytes = canonicalJsonBytes(source);
	store.objects.set(DOCS_SOURCE_KEY, sourceBytes);
	return {
		readerRef,
		source,
		sourceDigest: sha256(sourceBytes),
		store,
	};
}

interface MemoryStore extends ReaderObjectStoreWriter {
	objects: Map<string, Uint8Array>;
	reads: string[];
	writes: string[];
}

function memoryStore(): MemoryStore {
	const objects = new Map<string, Uint8Array>();
	const reads: string[] = [];
	const writes: string[] = [];
	return {
		objects,
		reads,
		writes,
		async readOptionalBytesObject({ key }) {
			reads.push(key);
			return objects.get(key);
		},
		async writeBytesObject({ body, key }) {
			writes.push(key);
			objects.set(key, body);
		},
	};
}

function putJson(store: MemoryStore, key: string, value: unknown): ObjectRef {
	const bytes = canonicalJsonBytes(value);
	store.objects.set(key, bytes);
	return { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
}
