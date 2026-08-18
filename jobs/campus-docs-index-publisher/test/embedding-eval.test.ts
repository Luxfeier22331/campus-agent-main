import { describe, expect, it } from "vitest";

import { EMBEDDING_SPACE } from "../src/definitions.ts";
import {
	buildDenseQueryText,
	evaluateDenseRanking,
} from "../src/embedding-eval.ts";
import { sha256Text } from "../src/indexing.ts";
import type { StoredChunk, StoredEmbedding } from "../src/types.ts";

const chunkSet = `sha256:${"a".repeat(64)}` as const;
const embeddingSet = `sha256:${"b".repeat(64)}` as const;

describe("Campus docs dense embedding eval", () => {
	it("uses the admitted query instruction format", () => {
		expect(buildDenseQueryText("  问题  ")).toBe(
			"Instruct: Given a Campus Web document question, retrieve relevant current passages that answer the query.\nQuery:问题",
		);
	});

	it("reports top-K evidence coverage and first relevant MRR", () => {
		const chunks = [
			storedChunk("target-one", "doc-one", "root-one", "答案一"),
			storedChunk("distractor", "other-doc", "other-root", "干扰内容"),
			storedChunk("target-two", "doc-two", "root-two", "答案二"),
		];
		const embeddings = [
			storedEmbedding(chunks[0] as StoredChunk, vector(1, 0)),
			storedEmbedding(chunks[1] as StoredChunk, vector(0, 1)),
			storedEmbedding(chunks[2] as StoredChunk, vector(0.8, 0.2)),
		];
		const report = evaluateDenseRanking({
			chunkSet,
			chunks,
			embeddingSet,
			embeddings,
			queryCases: [
				{
					case_id: "first",
					max_chunk_count: 1,
					question: "问题一",
					required_evidence: ["答案一"],
					target_document_id: "doc-one",
					target_root_unit_ids: ["root-one"],
				},
				{
					case_id: "second",
					max_chunk_count: 1,
					question: "问题二",
					required_evidence: ["答案二"],
					target_document_id: "doc-two",
					target_root_unit_ids: ["root-two"],
				},
			],
			queryVectors: [vector(1, 0), vector(0, 1)],
		});

		expect(report.metrics).toEqual({
			evidence_coverage_at_k: 0.5,
			first_relevant_mrr: 0.75,
			root_unit_recall_at_k: 0.5,
		});
		expect(report.results[0]).toMatchObject({
			first_relevant_rank: 1,
			top_chunks: [{ chunk_id: "target-one", rank: 1 }],
		});
		expect(report.results[1]).toMatchObject({
			evidence_coverage_at_k: 0,
			first_relevant_mrr: 0.5,
			first_relevant_rank: 2,
			root_unit_recall_at_k: 0,
			top_chunks: [{ chunk_id: "distractor", rank: 1 }],
		});
	});
});

function storedChunk(
	chunkId: string,
	documentId: string,
	rootUnitId: string,
	content: string,
): StoredChunk {
	const retrievalText = `文档\n章节\n${content}`;
	return {
		chunkId,
		content,
		documentId,
		documentTitle: "文档",
		retrievalText,
		retrievalTextSha256: sha256Text(retrievalText),
		rootUnitIds: [rootUnitId],
		sectionId: "section",
		sectionRef: "/docs/test",
		sectionTitle: "章节",
		versionId: "version",
		versionLabel: "版本",
		versionSlug: "version",
	};
}

function storedEmbedding(chunk: StoredChunk, dense: number[]): StoredEmbedding {
	return { dense, retrievalTextSha256: chunk.retrievalTextSha256 };
}

function vector(first: number, second: number): number[] {
	const result = Array(EMBEDDING_SPACE.dimensions).fill(0) as number[];
	result[0] = first;
	result[1] = second;
	return result;
}
