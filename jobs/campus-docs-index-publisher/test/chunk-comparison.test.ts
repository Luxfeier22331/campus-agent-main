import { describe, expect, it } from "vitest";

import {
	buildCampusDocsChunkComparison,
	compareEmbeddingEvaluations,
} from "../src/chunk-comparison.ts";
import { CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION } from "../src/chunk-governance-definitions.ts";
import type {
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsChunkEmbeddingMetrics,
	CampusDocsGovernanceChunkSetData,
	CampusDocsQuestionRanking,
	CampusDocsRetrievalQuestion,
} from "../src/chunk-governance-types.ts";
import { parseLocalChunkComparisonCommand } from "../src/local-chunk-comparison-cli.ts";
import { sha256Text } from "../src/indexing/content-digest.ts";
import type { Sha256Ref, StoredChunk } from "../src/types.ts";

describe("Campus docs chunk comparison", () => {
	it("reports a fixed evidence boundary and structural deltas", () => {
		const baseline = run("a", [
			chunk("baseline-1", "第一项事实", ["root-1"]),
			chunk("baseline-2", "第二项事实", ["root-2"]),
		]);
		const candidate = run("b", [
			chunk("candidate-1", "第一项事实\n\n第二项事实", ["root-1", "root-2"]),
		]);
		const report = buildCampusDocsChunkComparison({
			baseline,
			candidate,
			questions: [question()],
		});

		expect(report.sourceAlignment.sourceProjectionEqual).toBe(true);
		expect(report.corpusDelta.chunkCount.delta).toBe(-1);
		expect(report.evidenceComparisons[0]).toMatchObject({ status: "fixed" });
	});

	it("does not compare evidence placement across different source projections", () => {
		const baseline = run("a", [chunk("baseline", "第一项事实", ["root-1"])]);
		const candidate = run("b", [chunk("candidate", "第一项事实", ["root-1"])], "2");

		const report = buildCampusDocsChunkComparison({ baseline, candidate, questions: [question()] });

		expect(report.evidenceComparisons[0]?.status).toBe("not-comparable");
	});

	it("compares embedding metrics and ranking changes for the same question set", () => {
		const baseline = run("a", [
			chunk("baseline-1", "第一项事实", ["root-1"]),
			chunk("baseline-2", "第二项事实", ["root-2"]),
		]);
		const candidate = run("b", [
			chunk("candidate-1", "第一项事实\\n\\n第二项事实", ["root-1", "root-2"]),
		]);
		const baselineEvaluation = embeddingEvaluation(baseline, {
			allEvidenceRank: 5,
			answerEvidenceRank: 4,
			firstDocumentRank: 3,
			firstEvidenceRank: 2,
			allEvidenceRecallAt1: 0,
		});
		const candidateEvaluation = embeddingEvaluation(candidate, {
			allEvidenceRank: 2,
			answerEvidenceRank: 1,
			firstDocumentRank: 1,
			firstEvidenceRank: 1,
			allEvidenceRecallAt1: 1,
		});

		const report = buildCampusDocsChunkComparison({
			baseline,
			baselineEvaluation,
			candidate,
			candidateEvaluation,
		});

		expect(report.embedding?.metrics.overall.recallAt.allEvidenceRecallAt["1"]).toMatchObject({
			baseline: 0,
			candidate: 1,
			delta: 1,
		});
		expect(report.embedding?.rankingChanges).toMatchObject({
			allEvidenceRank: { improved: 1, regressed: 0, unchanged: 0 },
			answerEvidenceRank: { improved: 1, regressed: 0, unchanged: 0 },
			firstDocumentRank: { improved: 1, regressed: 0, unchanged: 0 },
			firstEvidenceRank: { improved: 1, regressed: 0, unchanged: 0 },
		});
		const direct = compareEmbeddingEvaluations(baselineEvaluation, baselineEvaluation);
		expect(direct.metrics.overall.mean.meanReciprocalRank.delta).toBe(0);
		expect(direct.rankingChanges.firstEvidenceRank).toMatchObject({
			commonQuestionCount: 1,
			improved: 0,
			regressed: 0,
			unchanged: 1,
		});
	});

	it("rejects evaluations that are not comparable to their chunk sets", () => {
		const baseline = run("a", [chunk("baseline", "第一项事实", ["root-1"])]);
		const candidate = run("b", [chunk("candidate", "第一项事实", ["root-1"])]);
		const evaluation = embeddingEvaluation(baseline, {
			allEvidenceRank: 1,
			answerEvidenceRank: 1,
			firstDocumentRank: 1,
			firstEvidenceRank: 1,
			allEvidenceRecallAt1: 1,
		});

		expect(() =>
			buildCampusDocsChunkComparison({
				baseline,
				baselineEvaluation: evaluation,
				candidate,
				candidateEvaluation: evaluation,
			}),
		).toThrow(/Candidate embedding evaluation references/);
	});

	it.each([
		{
			expected: /different model targets/,
			mutate(evaluation: CampusDocsChunkEmbeddingEvaluationArtifact) {
				evaluation.manifest.modelTargetSha256 = "b".repeat(64);
			},
			name: "model target",
		},
		{
			expected: /different question artifacts/,
			mutate(evaluation: CampusDocsChunkEmbeddingEvaluationArtifact) {
				evaluation.manifest.questions = {
					...evaluation.manifest.questions,
					sha256: shaRef("different-questions"),
				};
			},
			name: "question artifact",
		},
		{
			expected: /different embedding definitions/,
			mutate(evaluation: CampusDocsChunkEmbeddingEvaluationArtifact) {
				evaluation.manifest.definition = {
					...evaluation.manifest.definition,
					queryInstruction: `${evaluation.manifest.definition.queryInstruction} changed`,
				} as unknown as CampusDocsChunkEmbeddingEvaluationArtifact["manifest"]["definition"];
			},
			name: "embedding definition",
		},
	])("rejects evaluations with a different $name", ({ expected, mutate }) => {
		const baseline = run("a", [chunk("baseline", "第一项事实", ["root-1"])]);
		const candidate = run("b", [chunk("candidate", "第一项事实", ["root-1"])]);
		const baselineEvaluation = embeddingEvaluation(baseline, {
			allEvidenceRank: 1,
			answerEvidenceRank: 1,
			firstDocumentRank: 1,
			firstEvidenceRank: 1,
			allEvidenceRecallAt1: 1,
		});
		const candidateEvaluation = embeddingEvaluation(candidate, {
			allEvidenceRank: 1,
			answerEvidenceRank: 1,
			firstDocumentRank: 1,
			firstEvidenceRank: 1,
			allEvidenceRecallAt1: 1,
		});
		mutate(candidateEvaluation);

		expect(() =>
			buildCampusDocsChunkComparison({
				baseline,
				baselineEvaluation,
				candidate,
				candidateEvaluation,
			}),
		).toThrow(expected);
	});

	it("requires embedding evaluation flags in pairs", () => {
		const chunkSet = "sha256:" + "1".repeat(64);
		const evaluation = "sha256:" + "2".repeat(64);
		const parsed = parseLocalChunkComparisonCommand([
			"--baseline-chunk-set",
			chunkSet,
			"--candidate-chunk-set",
			chunkSet,
			"--baseline-evaluation",
			evaluation,
			"--candidate-evaluation",
			evaluation,
		]);
		expect(parsed.baselineEvaluation).toBe(evaluation);
		expect(parsed.candidateEvaluation).toBe(evaluation);
		expect(() =>
			parseLocalChunkComparisonCommand([
				"--baseline-chunk-set",
				chunkSet,
				"--candidate-chunk-set",
				chunkSet,
				"--baseline-evaluation",
				evaluation,
			]),
		).toThrow();
	});
});

function question(): CampusDocsRetrievalQuestion {
	return {
		answer: "第一项事实和第二项事实",
		documentId: "document-1",
		evidence: [
			{ rootUnitIds: ["root-1"], text: "第一项事实" },
			{ rootUnitIds: ["root-2"], text: "第二项事实" },
		],
		question: "两项事实是什么？",
		questionId: "q1",
		stratum: "boundary",
	};
}

function run(
	id: string,
	chunks: StoredChunk[],
	projection = "1",
): CampusDocsGovernanceChunkSetData {
	return {
		chunks,
		id: shaRef(id),
		manifest: {
			chunkCount: chunks.length,
			chunkDefinition: {
				algorithm: `algorithm-${id}`,
				maxChars: 1600,
				overlapChars: 0,
				targetChars: 800,
			},
			chunks: { byteSize: 1, key: "chunks.ndjson", sha256: shaRef("f") },
			documentCount: 1,
			readerSchemaVersion: "campus_docs_reader.v3",
			schemaVersion: "campus_docs_chunk_set.v2",
			sourceProjectionSha256: shaRef(projection),
			sourceSchemaVersion: "campus_docs_source.v4",
		},
	};
}

function chunk(id: string, content: string, rootUnitIds: string[]): StoredChunk {
	const retrievalText = `文档标题\n章节\n${content}`;
	return {
		chunkId: id,
		content,
		documentId: "document-1",
		documentTitle: "文档标题",
		retrievalText,
		retrievalTextSha256: sha256Text(retrievalText),
		rootUnitIds,
		sectionId: "section-1",
		sectionRef: "/docs/document-1#section-1",
		sectionTitle: "章节",
		versionId: "version-1",
		versionSlug: "1",
	};
}

function embeddingEvaluation(
	chunkSet: CampusDocsGovernanceChunkSetData,
	overrides: {
		allEvidenceRank: number;
		answerEvidenceRank: number;
		firstDocumentRank: number;
		firstEvidenceRank: number;
		allEvidenceRecallAt1: number;
	},
): CampusDocsChunkEmbeddingEvaluationArtifact {
	const questions = [question()];
	const ranking: CampusDocsQuestionRanking = {
		allEvidenceRank: overrides.allEvidenceRank,
		answer: questions[0]!.answer,
		answerEvidenceRank: overrides.answerEvidenceRank,
		documentId: questions[0]!.documentId,
		evidenceChunkIds: chunkSet.chunks.slice(0, 1).map((item) => item.chunkId),
		evidenceChunkRanks: { [chunkSet.chunks[0]!.chunkId]: overrides.firstEvidenceRank },
		firstDocumentRank: overrides.firstDocumentRank,
		firstEvidenceRank: overrides.firstEvidenceRank,
		question: questions[0]!.question,
		questionId: questions[0]!.questionId,
		singleChunkAnswerRank: overrides.firstEvidenceRank,
		stratum: questions[0]!.stratum,
		topChunks: [],
	};
	const slice: CampusDocsChunkEmbeddingMetrics = {
		allEvidenceRecallAt: { "1": overrides.allEvidenceRecallAt1, "3": 1, "5": 1, "10": 1 },
		answerEvidenceRecallAt: { "1": 1, "3": 1, "5": 1, "10": 1 },
		byStratum: {},
		chunkCount: chunkSet.chunks.length,
		definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding,
		documentRecallAt: { "1": 1, "3": 1, "5": 1, "10": 1 },
		meanAnswerReciprocalRank: 1 / overrides.answerEvidenceRank,
		meanDocumentReciprocalRank: 1 / overrides.firstDocumentRank,
		meanReciprocalRank: 1 / overrides.firstEvidenceRank,
		meanSingleChunkAnswerReciprocalRank: 1 / overrides.firstEvidenceRank,
		multiChunkEvidenceQuestionCount: 0,
		questionCount: 1,
		singleChunkAnswerQuestionCount: 1,
		singleChunkAnswerRecallAt: { "1": 1, "3": 1, "5": 1, "10": 1 },
		targetChunkRecallAt: { "1": 1, "3": 1, "5": 1, "10": 1 },
		schemaVersion: "campus_docs_chunk_embedding_metrics.v1",
		singleChunkEvidenceQuestionCount: 1,
	};
	const metrics: CampusDocsChunkEmbeddingMetrics = {
		...slice,
		byStratum: { boundary: slice },
	};
	return {
		evaluationRun: shaRef("evaluation-" + chunkSet.id),
		manifest: {
			chunkCount: chunkSet.chunks.length,
			chunkDefinition: chunkSet.manifest.chunkDefinition,
			chunkSet: chunkSet.id,
			definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding,
			embeddingInputCount: 1,
			metrics: { byteSize: 1, file: "metrics.json", sha256: shaRef("metrics") },
			modelTargetSha256: "a".repeat(64),
			questionCount: questions.length,
			questions: { byteSize: 1, file: "questions.ndjson", sha256: shaRef("questions") },
			rankings: { byteSize: 1, file: "rankings.ndjson", sha256: shaRef("rankings") },
			schemaVersion: "campus_docs_chunk_embedding_evaluation_run.v1",
		},
		metrics,
		questions,
		rankings: [ranking],
	};
}

function shaRef(value: string): Sha256Ref {
	return `sha256:${value.repeat(64).slice(0, 64)}`;
}
