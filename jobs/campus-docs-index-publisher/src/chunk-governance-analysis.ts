import { buildCampusDocsReviewItemSample } from "./chunk-review-sampling.ts";
import {
	buildCensus,
	buildSampleSummary,
	selectReviewSample,
} from "./chunk-governance-census.ts";
import {
	analyzeDocument,
	buildSelectionMetadata,
	groupChunksByDocument,
} from "./chunk-governance-document.ts";
import type {
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsReviewDocument,
} from "./chunk-governance-types.ts";
import type { CorpusAnalysis } from "./chunk-governance-analysis-model.ts";
import type { Sha256Ref, SourceVersionSelection, StoredChunk } from "./types.ts";

export type { CorpusAnalysis } from "./chunk-governance-analysis-model.ts";
export { assertStoredChunksMatch } from "./chunk-governance-consistency.ts";

export function analyzeCorpus(input: {
	chunkSet: Sha256Ref;
	chunks: readonly StoredChunk[];
	embeddingEvaluation?: CampusDocsChunkEmbeddingEvaluationArtifact;
	selections: readonly SourceVersionSelection[];
	sourceProjectionSha256: Sha256Ref;
}): CorpusAnalysis {
	const metadata = input.selections.map(buildSelectionMetadata);
	const metadataByDocumentId = new Map(metadata.map((item) => [item.document.docId, item]));
	const chunksByDocumentId = groupChunksByDocument(input.chunks);
	const analyses = input.selections.map((selection) => {
		const documentMetadata = metadataByDocumentId.get(selection.document.docId);
		if (!documentMetadata) {
			throw new Error(`Campus docs metadata is missing: ${selection.document.docId}`);
		}
		const chunks = chunksByDocumentId.get(selection.document.docId) ?? [];
		if (chunks.length === 0) {
			throw new Error(`Campus docs chunk set has no chunks for ${selection.document.docId}`);
		}
		return analyzeDocument({ chunks, metadata: documentMetadata });
	});
	if (chunksByDocumentId.size !== input.selections.length) {
		throw new Error("Campus docs chunk set contains an unknown document");
	}
	const documents = analyses.sort((left, right) =>
		left.document.docId.localeCompare(right.document.docId),
	);
	const sampleSelection = selectReviewSample(documents, input.sourceProjectionSha256);
	const sample: CampusDocsReviewDocument[] = sampleSelection.documents.map((analysis) => ({
		...analysis.review,
		primaryStratum:
			sampleSelection.primaryStratumByDocumentId.get(analysis.document.docId) ?? "coverage-fill",
	}));
	const census = buildCensus({
		chunkSet: input.chunkSet,
		documents,
		selections: input.selections,
		sourceProjectionSha256: input.sourceProjectionSha256,
	});
	const candidates = documents.flatMap((analysis) => analysis.candidates);
	const reviewItemSample = buildCampusDocsReviewItemSample({
		candidates,
		documents: documents.map((analysis) => analysis.review),
		...(input.embeddingEvaluation ? { embeddingEvaluation: input.embeddingEvaluation } : {}),
		sourceProjectionSha256: input.sourceProjectionSha256,
	});
	return {
		census,
		documents,
		candidates,
		reviewItems: reviewItemSample.items,
		reviewItemSummary: reviewItemSample.summary,
		sample,
		sampleSummary: buildSampleSummary(documents, sampleSelection),
	};
}
