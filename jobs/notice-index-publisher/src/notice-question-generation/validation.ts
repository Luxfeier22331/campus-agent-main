import type { NoticeChunk } from "../types.ts";
import {
	NOTICE_QUESTION_SET_DEFINITION,
	type GeneratedNoticeQuestion,
	type GeneratedNoticeQuestionSelection,
} from "./model.ts";

export function materializeGeneratedNoticeQuestions(input: {
	chunkContents: readonly string[];
	questions: readonly GeneratedNoticeQuestionSelection[];
}): GeneratedNoticeQuestion[] {
	validateNoticeChunkSelections(input.questions, input.chunkContents);
	const chunkReferences = buildChunkReferenceIndex(input.chunkContents);

	return input.questions.map((question, questionIndex) => {
		const chunk = chunkReferences.get(question.chunkRef);
		if (!chunk) {
			throw new Error(
				`notice generated question ${questionIndex} references unknown chunk: ${question.chunkRef}`,
			);
		}
		return {
			answer: question.answer,
			evidence: [chunk.content],
			question: question.question,
		};
	});
}

export function validateGeneratedQuestions(input: {
	chunks: readonly Pick<NoticeChunk, "content">[];
	noticeId: string;
	questions: readonly GeneratedNoticeQuestion[];
}): GeneratedNoticeQuestion[] {
	const questions = parseMaterializedGeneratedNoticeQuestions({ questions: input.questions });
	for (const [questionIndex, question] of questions.entries()) {
		for (const [evidenceIndex, evidence] of question.evidence.entries()) {
			if (!input.chunks.some((chunk) => chunk.content.includes(evidence))) {
				throw new Error(
					`notice ${input.noticeId} question ${questionIndex + 1} evidence ${evidenceIndex + 1} is not contained in a chunk`,
				);
			}
		}
	}
	return questions;
}

function parseMaterializedGeneratedNoticeQuestions(value: unknown): GeneratedNoticeQuestion[] {
	if (!isRecord(value) || !Array.isArray(value.questions)) {
		throw new Error("notice question model output must contain questions");
	}
	if (value.questions.length !== NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice) {
		throw new Error("notice question model output must contain exactly two questions");
	}
	const questions = value.questions.map((raw, index) => {
		if (!isRecord(raw)) throw new Error(`notice generated question ${index} is invalid`);
		const question = nonEmptyString(raw.question) ? raw.question.trim() : "";
		const answer = nonEmptyString(raw.answer) ? raw.answer.trim() : "";
		if (!question || !answer || !Array.isArray(raw.evidence) || raw.evidence.length === 0) {
			throw new Error(`notice generated question ${index} is invalid`);
		}
		const evidence = raw.evidence.map((item, evidenceIndex) => {
			if (!nonEmptyString(item)) {
				throw new Error(`notice generated question ${index} evidence ${evidenceIndex} is invalid`);
			}
			return item;
		});
		if (new Set(evidence).size !== evidence.length) {
			throw new Error(`notice generated question ${index} has duplicate evidence`);
		}
		return { answer, evidence, question };
	});
	if (new Set(questions.map((question) => question.question)).size !== questions.length) {
		throw new Error("notice generated questions are duplicated");
	}
	return questions;
}

function validateNoticeChunkSelections(
	questions: readonly GeneratedNoticeQuestionSelection[],
	chunkContents: readonly string[],
): void {
	const chunkReferences = buildChunkReferenceIndex(chunkContents);
	for (const [questionIndex, question] of questions.entries()) {
		if (!chunkReferences.has(question.chunkRef)) {
			throw new Error(
				`notice generated question ${questionIndex} references unknown chunk: ${question.chunkRef}`,
			);
		}
	}
}

interface NoticeChunkLocation {
	chunkIndex: number;
	content: string;
}

function buildChunkReferenceIndex(
	chunkContents: readonly string[],
): Map<string, NoticeChunkLocation> {
	const references = new Map<string, NoticeChunkLocation>();
	for (const [chunkIndex, content] of chunkContents.entries()) {
		references.set(`chunk-${chunkIndex}`, { chunkIndex, content });
	}
	return references;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
