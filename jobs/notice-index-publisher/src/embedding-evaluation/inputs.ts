import { createNoticeEmbeddingInputs } from "../embedding-cache.ts";
import {
	NOTICE_QUERY_INSTRUCTION,
	type NoticeEmbeddingInputSet,
	type NoticeRetrievalQuestion,
} from "./model.ts";
import type { NoticeChunk, Sha256Ref } from "../types.ts";

export function formatNoticeQuery(question: string): string {
	const value = question.trim();
	if (!value) throw new Error("notice retrieval question is required");
	return `Instruct: ${NOTICE_QUERY_INSTRUCTION}\nQuery:${value}`;
}

export function decodeNoticeQuestionNdjson(bytes: Uint8Array): NoticeRetrievalQuestion[] {
	const seenQuestionIds = new Set<string>();
	return decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new Error(`notice question record ${index} is invalid`);
		for (const field of ["answer", "noticeId", "question", "questionId", "stratum"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`notice question record ${index} has invalid ${field}`);
			}
		}
		if (seenQuestionIds.has(value.questionId as string)) {
			throw new Error(`notice question id is duplicated: ${value.questionId as string}`);
		}
		seenQuestionIds.add(value.questionId as string);
		if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
			throw new Error(`notice question record ${index} has no evidence`);
		}
		for (const [evidenceIndex, evidence] of value.evidence.entries()) {
			if (!isRecord(evidence) || !nonEmptyString(evidence.text)) {
				throw new Error(
					`notice question record ${index} evidence ${evidenceIndex} is invalid`,
				);
			}
			if (evidence.chunkId !== undefined) {
				if (!nonEmptyString(evidence.chunkId)) {
					throw new Error(
						`notice question record ${index} evidence ${evidenceIndex} chunk id is invalid`,
					);
				}
			}
		}
		return value as unknown as NoticeRetrievalQuestion;
	});
}

export function assertQuestionEvidence(
	chunks: readonly NoticeChunk[],
	questions: readonly NoticeRetrievalQuestion[],
): void {
	const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
	for (const question of questions) {
		for (const evidence of question.evidence) {
			if (evidence.chunkId) {
				const annotatedChunk = chunksById.get(evidence.chunkId);
				if (!annotatedChunk) {
					throw new Error(
						`question ${question.questionId} references missing chunk ${evidence.chunkId}`,
					);
				}
				if (
					annotatedChunk.noticeId !== question.noticeId ||
					!annotatedChunk.content.includes(evidence.text)
				) {
					throw new Error(
						`question ${question.questionId} annotated evidence does not match ${annotatedChunk.chunkId}`,
					);
				}
			}
			if (
				!chunks.some(
					(chunk) =>
						chunk.noticeId === question.noticeId && chunk.content.includes(evidence.text),
				)
			) {
				throw new Error(
					`question ${question.questionId} evidence text is missing from notice ${question.noticeId}`,
				);
			}
		}
	}
}

export function buildEmbeddingInputSet(
	chunks: readonly NoticeChunk[],
	questions: readonly NoticeRetrievalQuestion[],
): NoticeEmbeddingInputSet {
	const { textBySha256, add: addText } = createNoticeEmbeddingInputs();
	const documentTextByChunkId = new Map<string, Sha256Ref>();
	for (const chunk of chunks) {
		documentTextByChunkId.set(chunk.chunkId, addText(chunk.retrievalText));
	}
	const queryTextByQuestionId = new Map<string, Sha256Ref>();
	for (const question of questions) {
		queryTextByQuestionId.set(question.questionId, addText(formatNoticeQuery(question.question)));
	}
	return { documentTextByChunkId, queryTextByQuestionId, textBySha256 };
}

function decodeNdjson<T>(
	bytes: Uint8Array,
	parse: (value: unknown, index: number) => T,
): T[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (!text.endsWith("\n")) throw new Error("notice evaluation NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.some((line) => line === "")) {
		throw new Error("notice evaluation NDJSON contains an empty record");
	}
	return lines.map((line, index) => parse(JSON.parse(line) as unknown, index));
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
