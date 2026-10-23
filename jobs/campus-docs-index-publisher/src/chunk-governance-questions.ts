import { decodeGovernanceNdjson } from "./chunk-governance-artifacts.ts";
import type {
	CampusDocsEvidencePlacement,
	CampusDocsRetrievalEvidence,
	CampusDocsRetrievalQuestion,
} from "./chunk-governance-types.ts";
import type { StoredChunk } from "./types.ts";

export function decodeCampusDocsQuestionNdjson(
	bytes: Uint8Array,
): CampusDocsRetrievalQuestion[] {
	const seenQuestionIds = new Set<string>();
	const questions = decodeGovernanceNdjson(bytes).map((value, index) => {
		if (!isRecord(value)) throw new Error(`Campus docs question record ${index} is invalid`);
		for (const field of ["answer", "documentId", "question", "questionId", "stratum"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`Campus docs question record ${index} has invalid ${field}`);
			}
		}
		if (seenQuestionIds.has(value.questionId as string)) {
			throw new Error(`Campus docs question id is duplicated: ${value.questionId as string}`);
		}
		seenQuestionIds.add(value.questionId as string);
		if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
			throw new Error(`Campus docs question record ${index} has no evidence`);
		}
		for (const [evidenceIndex, evidence] of value.evidence.entries()) {
			assertEvidence(evidence, index, evidenceIndex);
		}
		return value as unknown as CampusDocsRetrievalQuestion;
	});
	if (questions.length === 0) throw new Error("Campus docs question file is empty");
	return questions;
}

export function assertCampusDocsQuestionEvidence(
	chunks: readonly StoredChunk[],
	questions: readonly CampusDocsRetrievalQuestion[],
): void {
	const chunksByDocumentId = groupChunksByDocument(chunks);
	for (const question of questions) {
		const documentChunks = chunksByDocumentId.get(question.documentId);
		if (!documentChunks || documentChunks.length === 0) {
			throw new Error(
				`Campus docs question ${question.questionId} references missing document ${question.documentId}`,
			);
		}
		for (const evidence of question.evidence) {
			if (!documentChunks.some((chunk) => chunkMatchesEvidence(chunk, evidence))) {
				throw new Error(
					`Campus docs question ${question.questionId} evidence is missing from ${question.documentId}`,
				);
			}
		}
	}
}

export function placeCampusDocsEvidence(
	chunks: readonly StoredChunk[],
	question: CampusDocsRetrievalQuestion,
): CampusDocsEvidencePlacement {
	const documentChunks = chunks.filter((chunk) => chunk.documentId === question.documentId);
	const evidenceChunkIdsByEvidence = question.evidence.map((evidence) =>
		documentChunks
			.filter((chunk) => chunkMatchesEvidence(chunk, evidence))
			.map((chunk) => chunk.chunkId),
	);
	return {
		allEvidenceInSingleChunk: documentChunks.some((chunk) =>
			question.evidence.every((evidence) => chunkMatchesEvidence(chunk, evidence)),
		),
		documentPresent: documentChunks.length > 0,
		evidenceChunkIds: [...new Set(evidenceChunkIdsByEvidence.flat())],
		evidenceChunkIdsByEvidence,
		missingEvidenceCount: evidenceChunkIdsByEvidence.filter((ids) => ids.length === 0).length,
	};
}

export function chunkMatchesEvidence(
	chunk: StoredChunk,
	evidence: CampusDocsRetrievalEvidence,
): boolean {
	return (
		chunk.content.includes(evidence.text) &&
		(evidence.rootUnitIds === undefined ||
			evidence.rootUnitIds.every((rootUnitId) => chunk.rootUnitIds.includes(rootUnitId)))
	);
}

export function chunkContainsEvidenceText(
	chunk: StoredChunk,
	evidence: CampusDocsRetrievalEvidence,
): boolean {
	return chunk.content.includes(evidence.text);
}

function groupChunksByDocument(chunks: readonly StoredChunk[]): Map<string, StoredChunk[]> {
	const grouped = new Map<string, StoredChunk[]>();
	for (const chunk of chunks) {
		const values = grouped.get(chunk.documentId) ?? [];
		values.push(chunk);
		grouped.set(chunk.documentId, values);
	}
	return grouped;
}

function assertEvidence(value: unknown, recordIndex: number, evidenceIndex: number): void {
	if (!isRecord(value) || !nonEmptyString(value.text)) {
		throw new Error(
			`Campus docs question record ${recordIndex} evidence ${evidenceIndex} is invalid`,
		);
	}
	if (value.rootUnitIds === undefined) return;
	if (
		!Array.isArray(value.rootUnitIds) ||
		value.rootUnitIds.length === 0 ||
		value.rootUnitIds.some((rootUnitId) => !nonEmptyString(rootUnitId)) ||
		new Set(value.rootUnitIds).size !== value.rootUnitIds.length
	) {
		throw new Error(
			`Campus docs question record ${recordIndex} evidence ${evidenceIndex} root unit ids are invalid`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
