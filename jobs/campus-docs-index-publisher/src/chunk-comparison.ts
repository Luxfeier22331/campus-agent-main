import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
	artifactHex,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
	readGovernanceChunkSet,
	reference,
	writeImmutableGovernanceFile,
} from "./chunk-governance-artifacts.ts";
import {
	CAMPUS_DOCS_CHUNK_COMPARISON_RUN_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import { readCampusDocsChunkEmbeddingEvaluation } from "./chunk-embedding-evaluation.ts";
import {
	assertCampusDocsQuestionEvidence,
	decodeCampusDocsQuestionNdjson,
	placeCampusDocsEvidence,
} from "./chunk-governance-questions.ts";
import type {
	CampusDocsChunkComparisonReport,
	CampusDocsChunkComparisonResult,
	CampusDocsChunkComparisonRunManifest,
	CampusDocsChunkEmbeddingComparison,
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsChunkCorpusDelta,
	CampusDocsChunkRunSummary,
	CampusDocsChunkSourceAlignment,
	CampusDocsEvidenceComparison,
	CampusDocsGovernanceChunkSetData,
	CampusDocsQuestionRanking,
	CampusDocsRankingChangeSummary,
	CampusDocsRetrievalQuestion,
	CampusDocsRetrievalMetricComparison,
	CampusDocsRetrievalMetricSlice,
	NumericDelta,
	NumericDistribution,
	NumericDistributionDelta,
} from "./chunk-governance-types.ts";
import {
	canonicalJsonBytes,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type { ArtifactObjectStore, Sha256Ref } from "./types.ts";

const COMPARISON_DIRECTORY = "comparisons";
const SHORT_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.shortChars;
const TINY_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.tinyChars;
const NEAR_MAX_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.nearMaxChars;

export async function runLocalCampusDocsChunkComparison(input: {
	artifactRoot: string;
	artifactStore: ArtifactObjectStore;
	baselineEvaluation?: Sha256Ref;
	baselineChunkSet: Sha256Ref;
	candidateEvaluation?: Sha256Ref;
	candidateChunkSet: Sha256Ref;
	questionFile?: string;
}): Promise<CampusDocsChunkComparisonResult> {
	if (Boolean(input.baselineEvaluation) !== Boolean(input.candidateEvaluation)) {
		throw new Error("Baseline and candidate embedding evaluations must be provided together");
	}
	const [baseline, candidate, questionBytes, baselineEvaluation, candidateEvaluation] = await Promise.all([
		readGovernanceChunkSet(input.artifactStore, input.baselineChunkSet),
		readGovernanceChunkSet(input.artifactStore, input.candidateChunkSet),
		input.questionFile ? readFile(input.questionFile) : Promise.resolve(undefined),
		input.baselineEvaluation
			? readCampusDocsChunkEmbeddingEvaluation(input.artifactRoot, input.baselineEvaluation)
			: Promise.resolve(undefined),
		input.candidateEvaluation
			? readCampusDocsChunkEmbeddingEvaluation(input.artifactRoot, input.candidateEvaluation)
			: Promise.resolve(undefined),
	]);
	const questions = questionBytes
		? decodeCampusDocsQuestionNdjson(new Uint8Array(questionBytes))
		: [];
	if (questions.length > 0) {
		assertCampusDocsQuestionEvidence(baseline.chunks, questions);
	}
	const report = buildCampusDocsChunkComparison({
		baseline,
		...(baselineEvaluation ? { baselineEvaluation } : {}),
		candidate,
		...(candidateEvaluation ? { candidateEvaluation } : {}),
		questions,
	});
	const reportBytes = canonicalJsonBytes(report);
	const manifest: CampusDocsChunkComparisonRunManifest = {
		...(input.baselineEvaluation ? { baselineEvaluation: input.baselineEvaluation } : {}),
		baselineChunkSet: input.baselineChunkSet,
		...(input.candidateEvaluation ? { candidateEvaluation: input.candidateEvaluation } : {}),
		candidateChunkSet: input.candidateChunkSet,
		definition: CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION,
		questionCount: questions.length,
		...(questionBytes
			? { questions: reference("questions.ndjson", new Uint8Array(questionBytes)) }
			: {}),
		report: reference("report.json", reportBytes),
		schemaVersion: CAMPUS_DOCS_CHUNK_COMPARISON_RUN_SCHEMA_VERSION,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		COMPARISON_DIRECTORY,
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutableGovernanceFile(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "report.json"), reportBytes),
		...(questionBytes
			? [
					writeImmutableGovernanceFile(
						join(outputDirectory, "questions.ndjson"),
						new Uint8Array(questionBytes),
					),
				]
			: []),
	]);
	return {
		baselineChunkSet: input.baselineChunkSet,
		candidateChunkSet: input.candidateChunkSet,
		outputDirectory,
		report,
		run,
	};
}

export function buildCampusDocsChunkComparison(input: {
	baseline: CampusDocsGovernanceChunkSetData;
	baselineEvaluation?: CampusDocsChunkEmbeddingEvaluationArtifact;
	candidate: CampusDocsGovernanceChunkSetData;
	candidateEvaluation?: CampusDocsChunkEmbeddingEvaluationArtifact;
	questions?: readonly CampusDocsRetrievalQuestion[];
}): CampusDocsChunkComparisonReport {
	if (Boolean(input.baselineEvaluation) !== Boolean(input.candidateEvaluation)) {
		throw new Error("Baseline and candidate embedding evaluations must be provided together");
	}
	if (input.baselineEvaluation && input.candidateEvaluation) {
		assertComparableEmbeddingEvaluations(
			input.baseline,
			input.baselineEvaluation,
			input.candidate,
			input.candidateEvaluation,
		);
	}
	const baseline = summarizeChunkSet(input.baseline);
	const candidate = summarizeChunkSet(input.candidate);
	const sourceAlignment = compareSourceAlignment(input.baseline, input.candidate);
	return {
		baseline,
		candidate,
		corpusDelta: compareCorpusSummaries(baseline, candidate),
		...(input.baselineEvaluation && input.candidateEvaluation
			? { embedding: compareEmbeddingEvaluations(input.baselineEvaluation, input.candidateEvaluation) }
			: {}),
		evidenceComparisons: (input.questions ?? []).map((question) =>
			compareQuestion(
				input.baseline,
				input.candidate,
				question,
				sourceAlignment.sourceProjectionEqual,
			),
		),
		schemaVersion: CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION,
		sourceAlignment,
	};
}

function summarizeChunkSet(run: CampusDocsGovernanceChunkSetData): CampusDocsChunkRunSummary {
	const chunkLengths = run.chunks.map((chunk) => unicodeLength(chunk.content));
	const chunksByDocument = groupCounts(run.chunks.map((chunk) => chunk.documentId));
	const chunksBySection = groupCounts(
		run.chunks.map((chunk) => `${chunk.documentId}\u0000${chunk.sectionId}`),
	);
	const shortChunkCount = chunkLengths.filter((length) => length < SHORT_CHARS).length;
	const tinyChunkCount = chunkLengths.filter((length) => length < TINY_CHARS).length;
	return {
		algorithm: run.manifest.chunkDefinition.algorithm,
		chunkChars: distribution(chunkLengths),
		chunkCount: run.chunks.length,
		chunkCountByDocument: distribution([...chunksByDocument.values()]),
		chunkCountBySection: distribution([...chunksBySection.values()]),
		chunkSet: run.id,
		documentCount: chunksByDocument.size,
		multiRootChunkCount: run.chunks.filter((chunk) => chunk.rootUnitIds.length > 1).length,
		nearMaxChunkCount: chunkLengths.filter((length) => length >= NEAR_MAX_CHARS).length,
		sectionCount: chunksBySection.size,
		shortChunkCount,
		shortChunkRatio: round(shortChunkCount / run.chunks.length, 6),
		sourceProjectionSha256: run.manifest.sourceProjectionSha256,
		tinyChunkCount,
		tinyChunkRatio: round(tinyChunkCount / run.chunks.length, 6),
	};
}

function compareSourceAlignment(
	baseline: CampusDocsGovernanceChunkSetData,
	candidate: CampusDocsGovernanceChunkSetData,
): CampusDocsChunkSourceAlignment {
	const baselineIds = [...new Set(baseline.chunks.map((chunk) => chunk.documentId))].sort();
	const candidateIds = [...new Set(candidate.chunks.map((chunk) => chunk.documentId))].sort();
	const baselineSet = new Set(baselineIds);
	const candidateSet = new Set(candidateIds);
	return {
		baselineOnlyDocumentIds: baselineIds.filter((documentId) => !candidateSet.has(documentId)),
		candidateOnlyDocumentIds: candidateIds.filter((documentId) => !baselineSet.has(documentId)),
		commonDocumentCount: baselineIds.filter((documentId) => candidateSet.has(documentId)).length,
		sourceProjectionEqual:
			baseline.manifest.sourceProjectionSha256 === candidate.manifest.sourceProjectionSha256,
		baselineSourceProjectionSha256: baseline.manifest.sourceProjectionSha256,
		candidateSourceProjectionSha256: candidate.manifest.sourceProjectionSha256,
	};
}

function compareQuestion(
	baseline: CampusDocsGovernanceChunkSetData,
	candidate: CampusDocsGovernanceChunkSetData,
	question: CampusDocsRetrievalQuestion,
	sourceProjectionEqual: boolean,
): CampusDocsEvidenceComparison {
	const baselinePlacement = placeCampusDocsEvidence(baseline.chunks, question);
	const candidatePlacement = placeCampusDocsEvidence(candidate.chunks, question);
	return {
		baseline: baselinePlacement,
		candidate: candidatePlacement,
		questionId: question.questionId,
		status: sourceProjectionEqual
			? comparePlacementStatus(baselinePlacement, candidatePlacement)
			: "not-comparable",
	};
}

function comparePlacementStatus(
	baseline: CampusDocsEvidenceComparison["baseline"],
	candidate: CampusDocsEvidenceComparison["candidate"],
): CampusDocsEvidenceComparison["status"] {
	if (!candidate.documentPresent || candidate.missingEvidenceCount > 0) return "not-comparable";
	if (!baseline.documentPresent || baseline.missingEvidenceCount > 0) return "candidate-only";
	if (baseline.allEvidenceInSingleChunk && !candidate.allEvidenceInSingleChunk) return "regressed";
	if (!baseline.allEvidenceInSingleChunk && candidate.allEvidenceInSingleChunk) return "fixed";
	return "unchanged";
}

function compareCorpusSummaries(
	baseline: CampusDocsChunkRunSummary,
	candidate: CampusDocsChunkRunSummary,
): CampusDocsChunkCorpusDelta {
	return {
		chunkChars: distributionDelta(baseline.chunkChars, candidate.chunkChars),
		chunkCount: numericDelta(baseline.chunkCount, candidate.chunkCount),
		chunkCountByDocument: distributionDelta(
			baseline.chunkCountByDocument,
			candidate.chunkCountByDocument,
		),
		chunkCountBySection: distributionDelta(
			baseline.chunkCountBySection,
			candidate.chunkCountBySection,
		),
		documentCount: numericDelta(baseline.documentCount, candidate.documentCount),
		multiRootChunkCount: numericDelta(
			baseline.multiRootChunkCount,
			candidate.multiRootChunkCount,
		),
		nearMaxChunkCount: numericDelta(baseline.nearMaxChunkCount, candidate.nearMaxChunkCount),
		sectionCount: numericDelta(baseline.sectionCount, candidate.sectionCount),
		shortChunkCount: numericDelta(baseline.shortChunkCount, candidate.shortChunkCount),
		shortChunkRatio: numericDelta(baseline.shortChunkRatio, candidate.shortChunkRatio),
		tinyChunkCount: numericDelta(baseline.tinyChunkCount, candidate.tinyChunkCount),
		tinyChunkRatio: numericDelta(baseline.tinyChunkRatio, candidate.tinyChunkRatio),
	};
}

function numericDelta(baseline: number, candidate: number): NumericDelta {
	return { baseline, candidate, delta: round(candidate - baseline, 6) };
}

function distributionDelta(
	baseline: NumericDistribution,
	candidate: NumericDistribution,
): NumericDistributionDelta {
	return {
		baseline,
		candidate,
		delta: Object.fromEntries(
			Object.keys(baseline).map((key) => [
				key,
				round(
					candidate[key as keyof NumericDistribution] - baseline[key as keyof NumericDistribution],
					2,
				),
			]),
		) as unknown as NumericDistribution,
	};
}

function distribution(values: readonly number[]): NumericDistribution {
	if (values.length === 0) {
		return { max: 0, mean: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 };
	}
	const sorted = [...values].sort((left, right) => left - right);
	const percentile = (fraction: number): number =>
		sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
	return {
		max: sorted.at(-1) ?? 0,
		mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length, 2),
		min: sorted[0] ?? 0,
		p10: percentile(0.1),
		p25: percentile(0.25),
		p50: percentile(0.5),
		p75: percentile(0.75),
		p90: percentile(0.9),
		p95: percentile(0.95),
		p99: percentile(0.99),
	};
}

function groupCounts(values: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
}

function unicodeLength(value: string): number {
	return [...value].length;
}

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}

export function assertComparableEmbeddingEvaluations(
	baselineChunkSet: CampusDocsGovernanceChunkSetData,
	baselineEvaluation: CampusDocsChunkEmbeddingEvaluationArtifact,
	candidateChunkSet: CampusDocsGovernanceChunkSetData,
	candidateEvaluation: CampusDocsChunkEmbeddingEvaluationArtifact,
): void {
	if (baselineEvaluation.manifest.chunkSet !== baselineChunkSet.id) {
		throw new Error(
			"Baseline embedding evaluation references " +
				baselineEvaluation.manifest.chunkSet +
				", want " +
				baselineChunkSet.id,
		);
	}
	if (candidateEvaluation.manifest.chunkSet !== candidateChunkSet.id) {
		throw new Error(
			"Candidate embedding evaluation references " +
				candidateEvaluation.manifest.chunkSet +
				", want " +
				candidateChunkSet.id,
		);
	}
	if (baselineEvaluation.manifest.modelTargetSha256 !== candidateEvaluation.manifest.modelTargetSha256) {
		throw new Error("Baseline and candidate embedding evaluations use different model targets");
	}
	if (baselineEvaluation.manifest.questions.sha256 !== candidateEvaluation.manifest.questions.sha256) {
		throw new Error("Baseline and candidate embedding evaluations use different question artifacts");
	}
	if (
		!isDeepStrictEqual(
			baselineEvaluation.manifest.definition,
			candidateEvaluation.manifest.definition,
		) ||
		!isDeepStrictEqual(
			baselineEvaluation.manifest.definition,
			CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding,
		)
	) {
		throw new Error("Baseline and candidate embedding evaluations use different embedding definitions");
	}
	if (!isDeepStrictEqual(baselineEvaluation.manifest.chunkDefinition, baselineChunkSet.manifest.chunkDefinition)) {
		throw new Error("Baseline embedding evaluation chunk definition does not match its chunk set");
	}
	if (!isDeepStrictEqual(candidateEvaluation.manifest.chunkDefinition, candidateChunkSet.manifest.chunkDefinition)) {
		throw new Error("Candidate embedding evaluation chunk definition does not match its chunk set");
	}
	if (baselineEvaluation.manifest.chunkCount !== baselineChunkSet.chunks.length) {
		throw new Error("Baseline embedding evaluation chunk count does not match its chunk set");
	}
	if (candidateEvaluation.manifest.chunkCount !== candidateChunkSet.chunks.length) {
		throw new Error("Candidate embedding evaluation chunk count does not match its chunk set");
	}
	if (baselineEvaluation.questions.length !== candidateEvaluation.questions.length) {
		throw new Error("Baseline and candidate embedding evaluations have different question counts");
	}
	if (
		baselineEvaluation.questions.some(
			(question, index) => question.questionId !== candidateEvaluation.questions[index]?.questionId,
		)
	) {
		throw new Error("Baseline and candidate embedding evaluations have different question order");
	}
}

export function compareEmbeddingEvaluations(
	baseline: CampusDocsChunkEmbeddingEvaluationArtifact,
	candidate: CampusDocsChunkEmbeddingEvaluationArtifact,
): CampusDocsChunkEmbeddingComparison {
	const commonQuestions = intersectRankings(baseline.rankings, candidate.rankings);
	return {
		baselineEvaluationRun: baseline.evaluationRun,
		baselineQuestionCount: baseline.questions.length,
		candidateEvaluationRun: candidate.evaluationRun,
		candidateQuestionCount: candidate.questions.length,
		commonQuestionCount: commonQuestions.length,
		metrics: {
			overall: compareMetricSlice(baseline.metrics, candidate.metrics),
			byStratum: compareMetricStrata(baseline.metrics.byStratum, candidate.metrics.byStratum),
		},
		rankingChanges: {
			allEvidenceRank: summarizeRankingChanges(commonQuestions, "allEvidenceRank"),
			answerEvidenceRank: summarizeRankingChanges(commonQuestions, "answerEvidenceRank"),
			firstDocumentRank: summarizeRankingChanges(commonQuestions, "firstDocumentRank"),
			firstEvidenceRank: summarizeRankingChanges(commonQuestions, "firstEvidenceRank"),
		},
	};
}

function compareMetricStrata(
	baseline: Readonly<Record<string, CampusDocsRetrievalMetricSlice>>,
	candidate: Readonly<Record<string, CampusDocsRetrievalMetricSlice>>,
): Record<string, CampusDocsRetrievalMetricComparison> {
	const strata = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
	return Object.fromEntries(
		strata.map((stratum) => {
			const baselineSlice = baseline[stratum];
			const candidateSlice = candidate[stratum];
			if (!baselineSlice || !candidateSlice) {
				throw new Error("Baseline and candidate embedding evaluations have different strata");
			}
			return [stratum, compareMetricSlice(baselineSlice, candidateSlice)];
		}),
	) as Record<string, CampusDocsRetrievalMetricComparison>;
}

function compareMetricSlice(
	baseline: CampusDocsRetrievalMetricSlice,
	candidate: CampusDocsRetrievalMetricSlice,
): CampusDocsRetrievalMetricComparison {
	return {
		mean: {
			meanAnswerReciprocalRank: numericDelta(
				baseline.meanAnswerReciprocalRank,
				candidate.meanAnswerReciprocalRank,
			),
			meanDocumentReciprocalRank: numericDelta(
				baseline.meanDocumentReciprocalRank,
				candidate.meanDocumentReciprocalRank,
			),
			meanReciprocalRank: numericDelta(
				baseline.meanReciprocalRank,
				candidate.meanReciprocalRank,
			),
			meanSingleChunkAnswerReciprocalRank: numericDelta(
				baseline.meanSingleChunkAnswerReciprocalRank,
				candidate.meanSingleChunkAnswerReciprocalRank,
			),
		},
		recallAt: {
			allEvidenceRecallAt: compareRecallAt(baseline.allEvidenceRecallAt, candidate.allEvidenceRecallAt),
			answerEvidenceRecallAt: compareRecallAt(
				baseline.answerEvidenceRecallAt,
				candidate.answerEvidenceRecallAt,
			),
			documentRecallAt: compareRecallAt(baseline.documentRecallAt, candidate.documentRecallAt),
			singleChunkAnswerRecallAt: compareRecallAt(
				baseline.singleChunkAnswerRecallAt,
				candidate.singleChunkAnswerRecallAt,
			),
			targetChunkRecallAt: compareRecallAt(baseline.targetChunkRecallAt, candidate.targetChunkRecallAt),
		},
	};
}

function compareRecallAt(
	baseline: Record<"1" | "3" | "5" | "10", number>,
	candidate: Record<"1" | "3" | "5" | "10", number>,
): Record<"1" | "3" | "5" | "10", NumericDelta> {
	return {
		"1": numericDelta(baseline["1"], candidate["1"]),
		"3": numericDelta(baseline["3"], candidate["3"]),
		"5": numericDelta(baseline["5"], candidate["5"]),
		"10": numericDelta(baseline["10"], candidate["10"]),
	};
}

type RankingField =
	| "allEvidenceRank"
	| "answerEvidenceRank"
	| "firstDocumentRank"
	| "firstEvidenceRank";

function summarizeRankingChanges(
	commonQuestions: readonly { baseline: CampusDocsQuestionRanking; candidate: CampusDocsQuestionRanking }[],
	field: RankingField,
): CampusDocsRankingChangeSummary {
	return {
		commonQuestionCount: commonQuestions.length,
		improved: commonQuestions.filter(({ baseline, candidate }) => candidate[field] < baseline[field]).length,
		regressed: commonQuestions.filter(({ baseline, candidate }) => candidate[field] > baseline[field]).length,
		unchanged: commonQuestions.filter(({ baseline, candidate }) => candidate[field] === baseline[field]).length,
	};
}

function intersectRankings(
	baseline: readonly CampusDocsQuestionRanking[],
	candidate: readonly CampusDocsQuestionRanking[],
): Array<{ baseline: CampusDocsQuestionRanking; candidate: CampusDocsQuestionRanking }> {
	const candidateById = new Map(candidate.map((ranking) => [ranking.questionId, ranking]));
	return baseline.flatMap((ranking) => {
		const candidateRanking = candidateById.get(ranking.questionId);
		return candidateRanking ? [{ baseline: ranking, candidate: candidateRanking }] : [];
	});
}
