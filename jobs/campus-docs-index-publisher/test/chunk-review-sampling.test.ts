import { describe, expect, it } from "vitest";

import { buildCampusDocsReviewItemSample } from "../src/chunk-review-sampling.ts";
import type {
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsDocumentCensus,
	CampusDocsReviewBoundary,
	CampusDocsReviewCandidate,
	CampusDocsReviewCandidateSignal,
	CampusDocsReviewChunk,
	CampusDocsReviewDocument,
	CampusDocsReviewItem,
} from "../src/chunk-governance-types.ts";
import type { Sha256Ref } from "../src/types.ts";

const SOURCE_PROJECTION = `sha256:${"a".repeat(64)}` as Sha256Ref;

describe("Campus docs review item sampling", () => {
	it("selects a deterministic 450-item sample across mandatory, signal, and control strata", () => {
		const documents = Array.from({ length: 200 }, (_, index) => document(index));
		const candidates: CampusDocsReviewCandidate[] = [];
		addSignalRange(candidates, documents, "table-context-overhead", 0, 80, 0);
		addSignalRange(candidates, documents, "section-fragment", 80, 80, 0);
		addSignalRange(candidates, documents, "mergeable-short-tail", 0, 70, 1);
		addSignalRange(candidates, documents, "short-table-chunk", 80, 50, 1);
		addSignalRange(candidates, documents, "many-root-units", 130, 50, 1);
		addSignalRange(candidates, documents, "source-url-only", 180, 4, 0);
		addSignalRange(candidates, documents, "standalone-document-metadata", 184, 4, 0);
		addSignalRange(candidates, documents, "near-max-multi-root", 188, 4, 0);
		const evidenceChunkIds = Array.from({ length: 10 }, (_, offset) =>
			requiredChunk(documents, 190 + offset, 2).chunkId,
		);
		const embeddingEvaluation = {
			rankings: evidenceChunkIds.map((chunkId, index) => ({
				evidenceChunkIds: [chunkId],
				evidenceChunkRanks: { [chunkId]: index + 1 },
				question: `question-${index}`,
				questionId: `question-${index}`,
				stratum: "fixture-evidence",
			})),
		} as unknown as CampusDocsChunkEmbeddingEvaluationArtifact;

		const first = buildCampusDocsReviewItemSample({
			candidates,
			documents,
			embeddingEvaluation,
			sourceProjectionSha256: SOURCE_PROJECTION,
		});
		const second = buildCampusDocsReviewItemSample({
			candidates,
			documents,
			embeddingEvaluation,
			sourceProjectionSha256: SOURCE_PROJECTION,
		});

		expect(first).toEqual(second);
		expect(first.items).toHaveLength(450);
		expect(new Set(first.items.map((item) => item.chunk.chunkId))).toHaveLength(450);
		expect(first.summary.strata["metadata-or-near-max"].itemCount).toBe(12);
		expect(first.summary.strata["embedding-evidence"].itemCount).toBe(10);
		expect(first.summary.strata["table-context-overhead"].itemCount).toBe(70);
		expect(first.summary.strata["section-fragment"].itemCount).toBe(70);
		expect(first.summary.strata["mergeable-short-tail"].itemCount).toBe(60);
		expect(first.summary.strata["short-table-chunk"].itemCount).toBe(40);
		expect(first.summary.strata["many-root-or-split-reader"].itemCount).toBe(40);
		expect(first.summary.strata.control.itemCount).toBe(100);
		expect(first.summary.strata["coverage-fill"].itemCount).toBe(48);
		expect(evidenceChunkIds.every((chunkId) => first.items.some((item) => item.chunk.chunkId === chunkId))).toBe(true);
		expect(maxCappedItemsPerDocument(first.items)).toBeLessThanOrEqual(4);
	});
});

function document(index: number): CampusDocsReviewDocument {
	const chunks = Array.from({ length: 4 }, (_, chunkIndex) => chunk(index, chunkIndex));
	return {
		boundaries: chunks.slice(1).map((next, offset) => boundary(chunks[offset], next, offset)),
		chunks,
		collection: "fixture",
		corpus: "fixture",
		documentId: `document-${index}`,
		documentTitle: `Document ${index}`,
		metrics: metrics(index),
		tags: [],
	};
}

function chunk(documentIndex: number, chunkIndex: number): CampusDocsReviewChunk {
	return {
		chars: 100,
		chunkId: `chunk-${documentIndex}-${chunkIndex}`,
		chunkIndex,
		content: `content ${documentIndex}/${chunkIndex}`,
		headingPath: [`heading-${chunkIndex}`],
		rootUnitIds: [`root-${documentIndex}-${chunkIndex}`],
		rootUnits: [{
			chars: 100,
			kind: "paragraph",
			rootUnitId: `root-${documentIndex}-${chunkIndex}`,
			textPreview: `content ${documentIndex}/${chunkIndex}`,
		}],
		sectionId: `section-${documentIndex}-${chunkIndex}`,
		sectionTitle: `Section ${chunkIndex}`,
	};
}

function boundary(
	previous: CampusDocsReviewChunk | undefined,
	next: CampusDocsReviewChunk,
	previousIndex: number,
): CampusDocsReviewBoundary {
	if (!previous) throw new Error("fixture previous chunk is missing");
	return {
		combinedChars: null,
		nextChunkId: next.chunkId,
		nextFirst: next.content,
		nextIndex: previousIndex + 1,
		previousChunkId: previous.chunkId,
		previousEnd: previous.content,
		previousIndex,
		riskCodes: [],
		sameSection: false,
	};
}

function metrics(index: number): CampusDocsDocumentCensus {
	return {
		blockquoteCount: 0,
		chunkCount: 4,
		collection: "fixture",
		corpus: "fixture",
		documentId: `document-${index}`,
		documentTitle: `Document ${index}`,
		headingCount: 4,
		listCount: 0,
		maxHeadingLevel: 1,
		nearMaxChunkCount: 0,
		paragraphCount: 4,
		readerElementCount: 8,
		repeatedRootUnitCount: 0,
		sameSectionBoundaryCount: 0,
		sectionCount: 4,
		shortChunkCount: 4,
		supplementCount: 0,
		tableCount: 0,
		tinyChunkCount: 0,
		totalChars: 400,
	};
}

function addSignalRange(
	candidates: CampusDocsReviewCandidate[],
	documents: readonly CampusDocsReviewDocument[],
	signal: CampusDocsReviewCandidateSignal,
	startDocument: number,
	count: number,
	chunkIndex: number,
): void {
	for (let offset = 0; offset < count; offset += 1) {
		const documentValue = documents[startDocument + offset];
		const chunkValue = documentValue?.chunks[chunkIndex];
		if (!documentValue || !chunkValue) throw new Error("fixture signal chunk is missing");
		candidates.push({
			chunkIndex,
			detail: signal,
			documentId: documentValue.documentId,
			sectionId: chunkValue.sectionId,
			signal,
			title: documentValue.documentTitle,
		});
	}
}

function requiredChunk(
	documents: readonly CampusDocsReviewDocument[],
	documentIndex: number,
	chunkIndex: number,
): CampusDocsReviewChunk {
	const chunkValue = documents[documentIndex]?.chunks[chunkIndex];
	if (!chunkValue) throw new Error("fixture evidence chunk is missing");
	return chunkValue;
}

function maxCappedItemsPerDocument(items: readonly CampusDocsReviewItem[]): number {
	const uncapped = new Set(["metadata-or-near-max", "embedding-evidence"]);
	const counts = new Map<string, number>();
	for (const item of items.filter((candidate) => !uncapped.has(candidate.primaryStratum))) {
		counts.set(item.documentId, (counts.get(item.documentId) ?? 0) + 1);
	}
	return Math.max(0, ...counts.values());
}
