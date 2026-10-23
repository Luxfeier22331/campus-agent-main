import type { DocsReader, DocsSourceManifest, ObjectRef } from "campus-contracts/campus-docs";
import {
	assertReaderSegmentationQuality,
	cleanReaderSegmentation,
} from "campus-contracts/campus-docs";
import { DOCS_SOURCE_KEY, normalizeSourceManifest } from "campus-contracts/campus-docs/node";
import { describe, expect, it } from "vitest";
import { canonicalJsonBytes, sha256 } from "../src/docs-reader-build/artifact-digest.ts";
import type { ReaderObjectStoreClient } from "../src/docs-reader-build/published-reader-types.ts";
import {
	assertDocsSourceQuality,
	compileDocsSource,
} from "../src/docs-reader-build/source-compiler.ts";

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

		const compiled = await compileDocsSource({ client: fixture.store, source: fixture.source });
		expect(() => assertDocsSourceQuality(compiled)).toThrow(
			"reader contains high-confidence folded numbered content: root-1",
		);
		expect(() => assertReaderSegmentationQuality(reader)).toThrow("high-confidence folded");
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

function createSourceFixture(): {
	readerRef: ObjectRef;
	source: DocsSourceManifest;
	store: MemoryStore;
} {
	const store = memoryStore();
	const reader = readerFixture("1. 第一项\n2. 第二项");
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
				docId: "doc-1",
				documentSlug: "document-1",
				title: "测试培养方案",
				topicId: null,
			},
		],
		redirects: [],
		schemaVersion: "campus_docs_source.v4",
		topics: [],
		versions: [
			{
				docId: "doc-1",
				reader: readerRef,
				supplements: [],
				versionId: "version-1",
				versionSlug: "2026",
			},
		],
	});
	const sourceBytes = canonicalJsonBytes(source);
	store.objects.set(DOCS_SOURCE_KEY, sourceBytes);
	return { readerRef, source, store };
}

interface MemoryStore extends ReaderObjectStoreClient {
	objects: Map<string, Uint8Array>;
}

function memoryStore(): MemoryStore {
	const objects = new Map<string, Uint8Array>();
	return {
		objects,
		async readOptionalBytesObject({ key }) {
			return objects.get(key);
		},
	};
}

function putJson(store: MemoryStore, key: string, value: unknown): ObjectRef {
	const bytes = canonicalJsonBytes(value);
	store.objects.set(key, bytes);
	return { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
}
