import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs-fixture";
import { assertValidChunkSet } from "../src/chunk-validation.ts";
import { CHUNK_SET_DEFINITION } from "../src/definitions.ts";
import {
	buildChunks,
} from "../src/indexing/chunks.ts";
import {
	loadCurrentVersions,
	parseIndexingSource,
} from "../src/indexing/source.ts";
import type { IndexChunk, SourceVersionSelection } from "../src/types.ts";

describe("Campus docs chunk validation", () => {
	it("accepts chunks produced by the index builder", async () => {
		const input = await fixtureInput();

		expect(() => assertValidChunkSet(input)).not.toThrow();
	});

	it("accepts leading metadata attached to body while excluding source URLs", async () => {
		const input = await fixtureInput();
		const fixtureSelection = input.selections[0];
		if (!fixtureSelection) throw new Error("docs fixture is empty");
		const selection = {
			...fixtureSelection,
			reader: {
				...fixtureSelection.reader,
				elements: [
					{ kind: "paragraph" as const, rootUnitId: "approval-date", text: "2024年3月5日" },
					{
						kind: "paragraph" as const,
						rootUnitId: "source-url",
						text: "> Source URL: https://example.edu/docs/1",
					},
					{ kind: "paragraph" as const, rootUnitId: "body", text: "正文内容。" },
				],
			},
		};
		const chunks = buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		});

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({
			content: "2024年3月5日\n\n正文内容。",
			rootUnitIds: ["approval-date", "body"],
		});
		expect(chunks[0]?.rootUnitIds).not.toContain("source-url");
		expect(() => assertValidChunkSet({ chunks, selections: [selection] })).not.toThrow();
	});

	it("rejects duplicate identities and invalid retrieval provenance", async () => {
		const input = await fixtureInput();
		const first = requiredChunk(input.chunks[0]);

		expect(() =>
			assertValidChunkSet({
				...input,
				chunks: [...input.chunks, { ...first }],
			}),
		).toThrow("chunk identity is duplicated");

		const invalid = input.chunks.map((chunk, index) =>
			index === 0 ? { ...chunk, retrievalText: "错误来源" } : chunk,
		);
		expect(() => assertValidChunkSet({ ...input, chunks: invalid })).toThrow(
			"retrieval text is invalid",
		);
	});

	it("rejects chunks that cross sections or reorder root units", async () => {
		const input = await fixtureInput();
		const multiRoot = input.chunks.find((chunk) => chunk.rootUnitIds.length > 1);
		if (!multiRoot) throw new Error("fixture has no multi-root chunk");

		const reordered = input.chunks.map((chunk) =>
			chunk.chunkId === multiRoot.chunkId
				? { ...chunk, rootUnitIds: [...chunk.rootUnitIds].reverse() }
				: chunk,
		);
		expect(() => assertValidChunkSet({ ...input, chunks: reordered })).toThrow(
			"root units are out of order",
		);

		const otherSection = input.chunks.find(
			(chunk) => chunk.documentId === multiRoot.documentId && chunk.sectionId !== multiRoot.sectionId,
		);
		if (!otherSection) throw new Error("fixture has no multi-section document");
		const crossed = input.chunks.map((chunk) =>
			chunk.chunkId === multiRoot.chunkId
				? { ...chunk, rootUnitIds: [...chunk.rootUnitIds, ...otherSection.rootUnitIds] }
				: chunk,
		);
		expect(() => assertValidChunkSet({ ...input, chunks: crossed })).toThrow(
			"crosses section boundaries",
		);
	});

	it("rejects missing reader coverage", async () => {
		const input = await fixtureInput();
		const counts = new Map<string, number>();
		for (const chunk of input.chunks) {
			for (const rootUnitId of chunk.rootUnitIds) {
				counts.set(rootUnitId, (counts.get(rootUnitId) ?? 0) + 1);
			}
		}
		const removable = input.chunks.find((chunk) =>
			chunk.rootUnitIds.some((rootUnitId) => counts.get(rootUnitId) === 1),
		);
		if (!removable) throw new Error("fixture has no uniquely covered reader element");

		expect(() =>
			assertValidChunkSet({
				...input,
				chunks: input.chunks.filter((chunk) => chunk.chunkId !== removable.chunkId),
			}),
		).toThrow("reader element is absent from chunks");
	});

	it("rejects oversized content and missing table cells", async () => {
		const input = await fixtureInput();
		const first = requiredChunk(input.chunks[0]);
		const oversizedContent = "超".repeat(CHUNK_SET_DEFINITION.chunking.maxChars + 1);
		const oversized = input.chunks.map((chunk) =>
			chunk.chunkId === first.chunkId
				? {
						...chunk,
						content: oversizedContent,
						retrievalText: `${chunk.retrievalText.slice(0, -chunk.content.length)}${oversizedContent}`,
					}
				: chunk,
		);
		expect(() => assertValidChunkSet({ ...input, chunks: oversized })).toThrow(
			"exceeds the character limit",
		);

		const tableRootUnitId = "activity-credit-table";
		const tableCellText = "校级社会实践";
		const missingCell = input.chunks.map((chunk) => {
			if (!chunk.rootUnitIds.includes(tableRootUnitId)) return chunk;
			const content = chunk.content.replaceAll(tableCellText, "表格单元格已删除");
			return {
				...chunk,
				content,
				retrievalText: `${chunk.retrievalText.slice(0, -chunk.content.length)}${content}`,
			};
		});
		expect(() => assertValidChunkSet({ ...input, chunks: missingCell })).toThrow(
			"table cell is absent from chunks",
		);
	});
});

async function fixtureInput(): Promise<{
	chunks: IndexChunk[];
	selections: SourceVersionSelection[];
}> {
	const fixture = createDocsSourceSiteFixture();
	const source = parseIndexingSource(fixture.sourceBytes);
	const selections = await loadCurrentVersions({
		readerStore: {
			read: async (key) => {
				const value = fixture.objects.get(key);
				if (!value) throw new Error(`missing fixture object: ${key}`);
				return value.body;
			},
		},
		source,
	});
	return {
		chunks: selections.flatMap((selection) =>
			buildChunks({
				document: selection.document,
				reader: selection.reader,
				version: selection.version,
			}),
		),
		selections,
	};
}

function requiredChunk(chunk: IndexChunk | undefined): IndexChunk {
	if (!chunk) throw new Error("fixture chunk is missing");
	return chunk;
}
