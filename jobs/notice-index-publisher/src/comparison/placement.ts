import { isDeepStrictEqual } from "node:util";

import type {
	NoticeQuestionRanking,
	NoticeRetrievalQuestion,
} from "../embedding-evaluation/model.ts";
import type {
	NoticeEvidencePlacement,
	NoticeQuestionComparison,
	NoticeQuestionRankSnapshot,
} from "./model.ts";
import type { NoticeChunk } from "../types.ts";

export function placeNoticeQuestionEvidence(
	chunks: readonly NoticeChunk[],
	question: NoticeRetrievalQuestion,
): NoticeEvidencePlacement {
	const noticeChunks = chunks
		.filter((chunk) => chunk.noticeId === question.noticeId)
		.sort((left, right) => left.chunkIndex - right.chunkIndex);
	const evidenceChunkIndexesByEvidence = question.evidence.map((evidence) =>
		noticeChunks
			.filter((chunk) => chunk.content.includes(evidence.text))
			.map((chunk) => chunk.chunkIndex),
	);
	const evidenceChunkIndexes = [...new Set(evidenceChunkIndexesByEvidence.flat())].sort(
		(left, right) => left - right,
	);
	const commonChunkIndexes = evidenceChunkIndexes.filter((chunkIndex) =>
		evidenceChunkIndexesByEvidence.every((indexes) => indexes.includes(chunkIndex)),
	);
	return {
		allEvidenceInSingleChunk: commonChunkIndexes.length > 0,
		evidenceChunkIndexes,
		evidenceChunkIndexesByEvidence,
		missingEvidenceCount: evidenceChunkIndexesByEvidence.filter((indexes) => indexes.length === 0)
			.length,
	};
}

export function compareQuestion(
	baselineChunks: readonly NoticeChunk[],
	baselineRanking: NoticeQuestionRanking,
	candidateChunks: readonly NoticeChunk[],
	candidateRanking: NoticeQuestionRanking,
	question: NoticeRetrievalQuestion,
): NoticeQuestionComparison {
	const baselinePlacement = placeNoticeQuestionEvidence(baselineChunks, question);
	const candidatePlacement = placeNoticeQuestionEvidence(candidateChunks, question);
	return {
		answer: question.answer,
		baseline: {
			placement: baselinePlacement,
			ranking: rankSnapshot(baselineRanking),
		},
		candidate: {
			placement: candidatePlacement,
			ranking: rankSnapshot(candidateRanking),
		},
		evidence: question.evidence.map((evidence) => evidence.text),
		noticeId: question.noticeId,
		placementChanged: !isDeepStrictEqual(baselinePlacement, candidatePlacement),
		question: question.question,
		questionId: question.questionId,
		rankChange: {
			answerEvidenceRank:
				candidateRanking.answerEvidenceRank - baselineRanking.answerEvidenceRank,
			firstNoticeRank: candidateRanking.firstNoticeRank - baselineRanking.firstNoticeRank,
			singleChunkAnswerRank: nullableRankChange(
				baselineRanking.singleChunkAnswerRank,
				candidateRanking.singleChunkAnswerRank,
			),
		},
		stratum: question.stratum,
	};
}

function rankSnapshot(ranking: NoticeQuestionRanking): NoticeQuestionRankSnapshot {
	return {
		answerEvidenceRank: ranking.answerEvidenceRank,
		firstNoticeRank: ranking.firstNoticeRank,
		singleChunkAnswerRank: ranking.singleChunkAnswerRank,
	};
}

function nullableRankChange(baseline: number | null, candidate: number | null): number | null {
	return baseline === null || candidate === null ? null : candidate - baseline;
}
