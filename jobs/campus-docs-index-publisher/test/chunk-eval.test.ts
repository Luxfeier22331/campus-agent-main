import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "../../../apps/campus-web/fixtures/docs-source-site.ts";
import {
	evaluateChunks,
	type ChunkEvalQueryCase,
	type ChunkEvalReview,
} from "../src/chunk-eval.ts";
import {
	buildChunks,
	loadCurrentVersions,
	parseIndexingSource,
} from "../src/indexing.ts";
import { parseEvalCommand } from "../src/eval-cli.ts";
import type { IndexChunk, IndexingSource, SourceVersionSelection } from "../src/types.ts";

describe("Campus docs chunk eval", () => {
	it("accepts the pnpm argument separator", () => {
		expect(
			parseEvalCommand([
				"--",
				"--reviews",
				"reviews.json",
				"--query-cases",
				"cases.json",
			]),
		).toEqual({
			queryCasesPath: resolve("cases.json"),
			reviewsPath: resolve("reviews.json"),
		});
	});

	it("validates the complete fixture corpus and selects deterministic samples", async () => {
		const input = await fixtureInput();
		const first = evaluateChunks(input);
		const second = evaluateChunks(input);

		expect(first.issues).toEqual([]);
		expect(first.document_count).toBe(input.selections.length);
		expect(first.chunk_count).toBe(input.chunks.length);
		expect(first.collection_count).toBe(6);
		expect(first.collection_stats).toHaveLength(6);
		expect(first.section_stats).toHaveLength(first.section_count);
		expect(
			first.composition.blockquote +
				first.composition.list +
				first.composition.mixed +
				first.composition.paragraph +
				first.composition.table +
				first.composition.unknown,
		).toBe(first.chunk_count);
		expect(first.duplicate_stats.content_groups).toBeInstanceOf(Array);
		expect(first.duplicate_stats.retrieval_text_groups).toBeInstanceOf(Array);
		expect(first.sample_chunks).toHaveLength(36);
		expect(second.sample_chunks.map((sample) => sample.chunk_id)).toEqual(
			first.sample_chunks.map((sample) => sample.chunk_id),
		);
		expect(first.manual_review.status).toBe("not_started");
		expect(first.query_coverage.status).toBe("not_started");
	});

	it("passes completed manual reviews and query evidence coverage", async () => {
		const input = await fixtureInput();
		const baseline = evaluateChunks(input);
		const target = rootUnitWithSingleChunk(input.chunks);
		const queryCases: ChunkEvalQueryCase[] = [
			{
				case_id: "fixture-evidence",
				max_chunk_count: 1,
				question: "这段示例内容是什么？",
				required_evidence: [target.chunk.content],
				target_document_id: target.chunk.documentId,
				target_root_unit_ids: [target.rootUnitId],
			},
		];
		const reviews: ChunkEvalReview[] = baseline.sample_chunks.map((sample) => ({
			chunk_id: sample.chunk_id,
			critical: false,
			notes: "fixture review",
			score: 2,
		}));

		const report = evaluateChunks({ ...input, queryCases, reviews });

		expect(report.manual_review).toMatchObject({
			critical_count: 0,
			reviewed_count: baseline.sample_chunks.length,
			status: "passed",
		});
		expect(report.query_coverage).toMatchObject({
			case_count: 1,
			covered_case_count: 1,
			status: "passed",
		});
		expect(report.sample_chunks.every((sample) => sample.review?.score === 2)).toBe(true);
		expect(report.passed).toBe(true);
	});

	it("fails query coverage when required evidence is absent", async () => {
		const input = await fixtureInput();
		const target = rootUnitWithSingleChunk(input.chunks);
		const report = evaluateChunks({
			...input,
			queryCases: [
				{
					case_id: "missing-evidence",
					max_chunk_count: 1,
					question: "不存在的事实是什么？",
					required_evidence: ["该证据不存在于文档中"],
					target_document_id: target.chunk.documentId,
					target_root_unit_ids: [target.rootUnitId],
				},
			],
		});

		expect(report.query_coverage).toMatchObject({
			case_count: 1,
			covered_case_count: 0,
			status: "failed",
		});
		expect(report.query_coverage.results[0]?.covered_evidence).toEqual([]);
	});

	it("reports duplicate chunk identities and oversized content", async () => {
		const input = await fixtureInput();
		const first = requiredChunk(input.chunks[0]);
		const second = requiredChunk(input.chunks[1]);
		const chunks = input.chunks.map((chunk) => ({ ...chunk }));
		chunks[0] = {
			...first,
			content: "超".repeat(1601),
		};
		chunks[1] = { ...second, chunkId: first.chunkId };

		const report = evaluateChunks({ ...input, chunks });

		expect(report.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(["chunk_char_limit", "duplicate_chunk_id"]),
		);
	});

	it("reports duplicate retrieval text and a detached table lead-in", async () => {
		const input = await fixtureInput();
		const first = requiredChunk(input.chunks[0]);
		const duplicate = {
			...first,
			chunkId: `${first.chunkId}_duplicate`,
		};
		const duplicateReport = evaluateChunks({
			...input,
			chunks: [...input.chunks, duplicate],
		});
		expect(duplicateReport.issues).toContainEqual(
			expect.objectContaining({ code: "duplicate_retrieval_text", severity: "error" }),
		);

		const pair = paragraphBeforeTable(input);
		const content = "课程安排如下：";
		const chunks = input.chunks.map((chunk) =>
			chunk.chunkId === pair.leadIn.chunkId
				? {
					...chunk,
					content,
					retrievalText: `${chunk.retrievalText.slice(0, -chunk.content.length)}${content}`,
				}
				: chunk.chunkId === pair.table.chunkId
					? {
							...chunk,
							rootUnitIds: chunk.rootUnitIds.filter(
								(rootUnitId) => !pair.leadIn.rootUnitIds.includes(rootUnitId),
							),
						}
					: chunk,
		);
		const detachedReport = evaluateChunks({ ...input, chunks });
		expect(detachedReport.issues).toContainEqual(
			expect.objectContaining({ code: "detached_table_lead_in", severity: "warning" }),
		);
	});

	it("reports missing roots and cross-section chunks", async () => {
		const input = await fixtureInput();
		const target = rootUnitWithSingleChunk(input.chunks);
		const withoutTarget = input.chunks.filter((chunk) => chunk.chunkId !== target.chunk.chunkId);
		const missing = evaluateChunks({ ...input, chunks: withoutTarget });
		expect(missing.issues).toContainEqual(
			expect.objectContaining({ code: "missing_root_unit", root_unit_id: target.rootUnitId }),
		);

		const pair = chunksFromDifferentSections(input.chunks);
		const crossSectionChunks = input.chunks.map((chunk) =>
			chunk.chunkId === pair.first.chunkId
				? {
					...chunk,
					rootUnitIds: [
						...chunk.rootUnitIds,
						requiredRootUnitId(pair.second),
					],
				}
				: chunk,
		);
		const crossSection = evaluateChunks({ ...input, chunks: crossSectionChunks });
		expect(crossSection.issues.map((issue) => issue.code)).toContain("cross_section_chunk");
	});

	it("reports table cell text removed from serialized chunks", async () => {
		const input = await fixtureInput();
		const tableRootUnitId = input.selections
			.flatMap((selection) => selection.reader.elements)
			.find((element) => element.kind === "table")?.rootUnitId;
		if (!tableRootUnitId) throw new Error("fixture has no table");
		const chunks = input.chunks.map((chunk) =>
			chunk.rootUnitIds.includes(tableRootUnitId)
				? { ...chunk, content: "表格内容已删除", retrievalText: "表格内容已删除" }
				: chunk,
		);

		const report = evaluateChunks({ ...input, chunks });

		expect(report.issues).toContainEqual(
			expect.objectContaining({ code: "table_cell_coverage", root_unit_id: tableRootUnitId }),
		);
	});
});

async function fixtureInput(): Promise<{
	chunks: IndexChunk[];
	selections: SourceVersionSelection[];
	source: IndexingSource;
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
		source,
	};
}

function rootUnitWithSingleChunk(chunks: readonly IndexChunk[]): {
	chunk: IndexChunk;
	rootUnitId: string;
} {
	const counts = new Map<string, number>();
	for (const chunk of chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			counts.set(rootUnitId, (counts.get(rootUnitId) ?? 0) + 1);
		}
	}
	for (const chunk of chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			if (counts.get(rootUnitId) === 1) return { chunk, rootUnitId };
		}
	}
	throw new Error("fixture has no root unit represented by one chunk");
}

function chunksFromDifferentSections(chunks: readonly IndexChunk[]): {
	first: IndexChunk;
	second: IndexChunk;
} {
	for (const first of chunks) {
		const second = chunks.find(
			(candidate) =>
				candidate.documentId === first.documentId && candidate.sectionId !== first.sectionId,
		);
		if (second) return { first, second };
	}
	throw new Error("fixture has no document with multiple chunk sections");
}

function paragraphBeforeTable(input: Awaited<ReturnType<typeof fixtureInput>>): {
	leadIn: IndexChunk;
	table: IndexChunk;
} {
	const tableRootUnitIds = new Set(
		input.selections.flatMap((selection) =>
			selection.reader.elements.flatMap((element) =>
				element.kind === "table" ? [element.rootUnitId] : [],
			),
		),
	);
	for (let index = 0; index < input.chunks.length - 1; index += 1) {
		const leadIn = input.chunks[index];
		const table = input.chunks[index + 1];
		if (
			leadIn &&
			table &&
			leadIn.documentId === table.documentId &&
			leadIn.sectionId === table.sectionId &&
			!leadIn.rootUnitIds.some((rootUnitId) => tableRootUnitIds.has(rootUnitId)) &&
			table.rootUnitIds.some((rootUnitId) => tableRootUnitIds.has(rootUnitId))
		) {
			return { leadIn, table };
		}
	}
	throw new Error("fixture has no paragraph followed by a table");
}

function requiredChunk(chunk: IndexChunk | undefined): IndexChunk {
	if (!chunk) throw new Error("fixture chunk is missing");
	return chunk;
}

function requiredRootUnitId(chunk: IndexChunk): string {
	const rootUnitId = chunk.rootUnitIds[0];
	if (!rootUnitId) throw new Error("fixture chunk has no root unit id");
	return rootUnitId;
}
