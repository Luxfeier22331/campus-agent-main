import type {
	DocsReader,
	DocsReaderElement,
	DocsSourceManifest,
} from "campus-contracts/campus-docs";
import { assertReaderExtractionQuality } from "campus-contracts/campus-docs";
import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs-fixture";
import { describe, expect, it } from "vitest";
import { canonicalJsonBytes, sha256 } from "../src/docs-reader-build/artifact-digest.ts";
import { compileDocsSource } from "../src/docs-reader-build/source-compiler.ts";

describe("文档 reader 提取质量", () => {
	it("拒绝遗留的迁移标题占位元素", async () => {
		const fixture = sourceWithReaderElements([
			{
				anchor: "scope",
				kind: "heading",
				level: 2,
				rootUnitId: "doc:migrated-heading-0001",
				text: "适用范围",
			},
		]);

		expect(() => assertReaderExtractionQuality(fixture.reader)).toThrow(
			"reader contains migrated heading artifact: doc:migrated-heading-0001",
		);
		await expect(
			compileDocsSource({ client: fixture.client, source: fixture.source }),
		).rejects.toThrow("reader contains migrated heading artifact");
	});

	it("拒绝被降级为多行 pipe 文本的表格", async () => {
		const fixture = sourceWithReaderElements([
			{
				kind: "paragraph",
				rootUnitId: "doc:table-0001",
				text: "项目 | 要求\n学分 | 2",
			},
		]);

		expect(() => assertReaderExtractionQuality(fixture.reader)).toThrow(
			"reader contains pipe-table paragraph: doc:table-0001",
		);
		await expect(
			compileDocsSource({ client: fixture.client, source: fixture.source }),
		).rejects.toThrow("reader contains pipe-table paragraph");
	});

	it("允许单行普通 pipe 文本和结构化 table", () => {
		const reader: DocsReader = {
			docId: "doc-1",
			elements: [
				{ kind: "paragraph", rootUnitId: "doc:paragraph-1", text: "A | B 是界面文案。" },
				{
					kind: "table",
					rootUnitId: "doc:table-1",
					rows: [
						[
							{ header: true, text: "项目" },
							{ header: true, text: "要求" },
						],
						[
							{ header: false, text: "学分" },
							{ header: false, text: "2" },
						],
					],
				},
			],
			schemaVersion: "campus_docs_reader.v3",
			supplements: [],
			versionId: "version-1",
		};

		expect(() => assertReaderExtractionQuality(reader)).not.toThrow();
	});

	it.each([
		["> Source URL: https://example.com/docs", "source URL marker"],
		["民大校发（2025）140号", "prefixed document number"],
		["（2021）150号", "bare document number"],
	])("拒绝独立来源或文号：%s", (text, _label) => {
		const reader: DocsReader = {
			docId: "doc-1",
			elements: [
				text.startsWith("> Source URL")
					? { kind: "paragraph", rootUnitId: "bad", text }
					: {
							anchor: "bad",
							kind: "heading",
							level: 2,
							rootUnitId: "bad",
							text,
						},
			],
			schemaVersion: "campus_docs_reader.v3",
			supplements: [],
			versionId: "version-1",
		};

		expect(() => assertReaderExtractionQuality(reader)).toThrow("reader contains");
	});

	it("拒绝相邻重复 heading，但允许正文 URL 和非相邻同名 heading", () => {
		const reader: DocsReader = {
			docId: "doc-1",
			elements: [
				{
					anchor: "one",
					kind: "heading",
					level: 2,
					rootUnitId: "heading-1",
					text: "适用范围",
				},
				{ kind: "paragraph", rootUnitId: "body-1", text: "访问 https://example.com。" },
				{
					anchor: "two",
					kind: "heading",
					level: 2,
					rootUnitId: "heading-2",
					text: "适用范围",
				},
			],
			schemaVersion: "campus_docs_reader.v3",
			supplements: [],
			versionId: "version-1",
		};
		expect(() => assertReaderExtractionQuality(reader)).not.toThrow();

		reader.elements.splice(1, 1);
		expect(() => assertReaderExtractionQuality(reader)).toThrow(
			"reader contains adjacent duplicate headings",
		);
	});
});

function sourceWithReaderElements(elements: DocsReaderElement[]): {
	client: { readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined> };
	reader: DocsReader;
	source: DocsSourceManifest;
} {
	const fixture = createDocsSourceSiteFixture();
	const source = structuredClone(fixture.source);
	const version = source.versions[0];
	if (!version) {
		throw new Error("docs fixture has no version");
	}
	const reader: DocsReader = {
		docId: version.docId,
		elements,
		schemaVersion: "campus_docs_reader.v3",
		supplements: [],
		versionId: version.versionId,
	};
	const readerBytes = canonicalJsonBytes(reader);
	const readerKey = "fixtures/docs/readers/extraction-quality.json";
	version.reader = {
		byteSize: readerBytes.byteLength,
		key: readerKey,
		sha256: sha256(readerBytes),
	};
	version.supplements = [];
	const objects = new Map([...fixture.objects].map(([key, object]) => [key, object.body] as const));
	objects.set(readerKey, readerBytes);
	return {
		client: {
			async readOptionalBytesObject({ key }) {
				return objects.get(key);
			},
		},
		reader,
		source,
	};
}
