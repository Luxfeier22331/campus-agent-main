import { describe, expect, it } from "vitest";

import {
	evaluateCampusDocsDenseRetrieval,
	formatCampusDocsQuery,
} from "../src/chunk-embedding-evaluation.ts";
import { decodeCampusDocsQuestionNdjson } from "../src/chunk-governance-questions.ts";
import { parseLocalChunkEmbeddingEvaluationCommand } from "../src/local-chunk-embedding-evaluation-cli.ts";
import { sha256Text } from "../src/indexing/content-digest.ts";
import type { StoredChunk } from "../src/types.ts";

describe("Campus docs chunk embedding evaluation", () => {
	it("ranks target chunks and reports document, evidence and single-chunk metrics", () => {
		const chunks = [
			chunk("target", "奖学金申请条件为成绩优秀。", "document-1", ["root-1"]),
			chunk("other", "宿舍门禁时间为晚上十一点。", "document-2", ["root-2"]),
		];
		const questions = [{
			answer: "成绩优秀",
			documentId: "document-1",
			evidence: [{ rootUnitIds: ["root-1"], text: "申请条件为成绩优秀" }],
			question: "奖学金申请条件是什么？",
			questionId: "q1",
			stratum: "regulation",
		}];

		const result = evaluateCampusDocsDenseRetrieval({
			chunks,
			documentVectorsByChunkId: new Map([
				["target", [1, 0]],
				["other", [0, 1]],
			]),
			questions,
			queryVectorsByQuestionId: new Map([["q1", [1, 0]]]),
		});

		expect(result.rankings[0]).toMatchObject({
			firstDocumentRank: 1,
			firstEvidenceRank: 1,
			singleChunkAnswerRank: 1,
		});
		expect(result.metrics.targetChunkRecallAt["1"]).toBe(1);
		expect(result.metrics.documentRecallAt["1"]).toBe(1);
		expect(result.metrics.singleChunkAnswerRecallAt["1"]).toBe(1);
	});

	it("validates question NDJSON and the local CLI contract", () => {
		const bytes = new TextEncoder().encode(
			`${JSON.stringify({
				answer: "答案",
				documentId: "document-1",
				evidence: [{ text: "证据" }],
				question: "问题？",
				questionId: "q1",
				stratum: "table",
			})}\n`,
		);
		expect(decodeCampusDocsQuestionNdjson(bytes)).toHaveLength(1);
		expect(formatCampusDocsQuery(" 问题？ ")).toContain("Query:问题？");

		const parsed = parseLocalChunkEmbeddingEvaluationCommand([
			"--chunk-set",
			`sha256:${"1".repeat(64)}`,
			"--questions",
			"var/questions.ndjson",
		]);
		expect(parsed.questionFile).toContain("var/questions.ndjson");
	});
});

function chunk(
	chunkId: string,
	content: string,
	documentId: string,
	rootUnitIds: string[],
): StoredChunk {
	const retrievalText = `${documentId}\n${content}`;
	return {
		chunkId,
		content,
		documentId,
		documentTitle: documentId,
		retrievalText,
		retrievalTextSha256: sha256Text(retrievalText),
		rootUnitIds,
		sectionId: `${documentId}-section`,
		sectionRef: `/docs/${documentId}`,
		sectionTitle: "章节",
		versionId: `${documentId}-version`,
		versionSlug: "1",
	};
}
