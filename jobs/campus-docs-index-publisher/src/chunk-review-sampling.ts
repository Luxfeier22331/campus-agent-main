import {
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import type {
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsReviewCandidate,
	CampusDocsReviewCandidateSignal,
	CampusDocsReviewDocument,
	CampusDocsReviewEmbeddingAnchor,
	CampusDocsReviewItem,
	CampusDocsReviewItemCountSummary,
	CampusDocsReviewItemStratum,
	CampusDocsReviewItemSummary,
} from "./chunk-governance-types.ts";
import { sha256 } from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type { Sha256Ref } from "./types.ts";

const METADATA_SIGNALS = new Set<CampusDocsReviewCandidateSignal>([
	"near-max-multi-root",
	"source-url-only",
	"standalone-document-metadata",
]);

const REVIEW_ITEM_STRATA: readonly CampusDocsReviewItemStratum[] = [
	"metadata-or-near-max",
	"embedding-evidence",
	"table-context-overhead",
	"section-fragment",
	"mergeable-short-tail",
	"short-table-chunk",
	"many-root-or-split-reader",
	"control",
	"coverage-fill",
];

interface ReviewChunkRecord {
	anchors: CampusDocsReviewEmbeddingAnchor[];
	chunkIndex: number;
	document: CampusDocsReviewDocument;
	signals: CampusDocsReviewCandidate[];
}

interface SelectedReviewChunk {
	primaryStratum: CampusDocsReviewItemStratum;
	record: ReviewChunkRecord;
}

export function buildCampusDocsReviewItemSample(input: {
	candidates: readonly CampusDocsReviewCandidate[];
	documents: readonly CampusDocsReviewDocument[];
	embeddingEvaluation?: CampusDocsChunkEmbeddingEvaluationArtifact;
	sourceProjectionSha256: Sha256Ref;
}): { items: CampusDocsReviewItem[]; summary: CampusDocsReviewItemSummary } {
	const records = buildReviewChunkRecords(input);
	const selected = new Map<string, SelectedReviewChunk>();
	const cappedCountByDocumentId = new Map<string, number>();
	const target = Math.min(CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.itemTarget, records.length);
	const enforceDocumentCap = records.length > target;

	const select = (
		stratum: CampusDocsReviewItemStratum,
		candidates: readonly ReviewChunkRecord[],
		limit: number,
		capped: boolean,
	): void => {
		let added = 0;
		for (const record of sortForStratum(candidates, input.sourceProjectionSha256, stratum)) {
			if (added >= limit || selected.size >= target) break;
			const chunk = record.document.chunks[record.chunkIndex];
			if (!chunk || selected.has(chunk.chunkId)) continue;
			const documentId = record.document.documentId;
			const cappedCount = cappedCountByDocumentId.get(documentId) ?? 0;
			if (
				capped &&
				enforceDocumentCap &&
				cappedCount >= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.perDocumentItemCap
			) {
				continue;
			}
			selected.set(chunk.chunkId, { primaryStratum: stratum, record });
			if (capped) cappedCountByDocumentId.set(documentId, cappedCount + 1);
			added += 1;
		}
	};

	select(
		"metadata-or-near-max",
		records.filter((record) => record.signals.some((signal) => METADATA_SIGNALS.has(signal.signal))),
		Number.POSITIVE_INFINITY,
		false,
	);
	select(
		"embedding-evidence",
		records.filter((record) => record.anchors.length > 0),
		Number.POSITIVE_INFINITY,
		false,
	);
	for (const stratum of CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.signalStrata) {
		const signals = new Set<CampusDocsReviewCandidateSignal>(stratum.signals);
		select(
			stratum.name,
			records.filter((record) => record.signals.some((signal) => signals.has(signal.signal))),
			stratum.target,
			true,
		);
	}
	select(
		"control",
		records.filter((record) => record.signals.length === 0 && record.anchors.length === 0),
		CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.controlItemTarget,
		true,
	);
	select("coverage-fill", records, target - selected.size, true);

	const items = [...selected.values()].map(buildReviewItem);
	return { items, summary: buildReviewItemSummary(records, items) };
}

function buildReviewChunkRecords(input: {
	candidates: readonly CampusDocsReviewCandidate[];
	documents: readonly CampusDocsReviewDocument[];
	embeddingEvaluation?: CampusDocsChunkEmbeddingEvaluationArtifact;
}): ReviewChunkRecord[] {
	const signalsByChunkKey = new Map<string, CampusDocsReviewCandidate[]>();
	for (const candidate of input.candidates) {
		const key = chunkKey(candidate.documentId, candidate.chunkIndex);
		const current = signalsByChunkKey.get(key) ?? [];
		current.push(candidate);
		signalsByChunkKey.set(key, current);
	}
	const anchorsByChunkId = buildEmbeddingAnchors(input.embeddingEvaluation);
	const knownChunkIds = new Set<string>();
	const records = input.documents.flatMap((document) =>
		document.chunks.map((chunk, chunkIndex) => {
			knownChunkIds.add(chunk.chunkId);
			return {
				anchors: [...(anchorsByChunkId.get(chunk.chunkId) ?? [])].sort((left, right) =>
					left.questionId.localeCompare(right.questionId),
				),
				chunkIndex,
				document,
				signals: [...(signalsByChunkKey.get(chunkKey(document.documentId, chunkIndex)) ?? [])]
					.sort((left, right) =>
						left.signal.localeCompare(right.signal) || left.detail.localeCompare(right.detail),
					),
			} satisfies ReviewChunkRecord;
		}),
	);
	for (const candidate of input.candidates) {
		const document = input.documents.find((item) => item.documentId === candidate.documentId);
		if (!document?.chunks[candidate.chunkIndex]) {
			throw new Error(
				`Campus docs review candidate points to an unknown chunk: ${candidate.documentId}#${candidate.chunkIndex}`,
			);
		}
	}
	for (const chunkId of anchorsByChunkId.keys()) {
		if (!knownChunkIds.has(chunkId)) {
			throw new Error(`Campus docs embedding evidence points to an unknown chunk: ${chunkId}`);
		}
	}
	return records;
}

function buildEmbeddingAnchors(
	evaluation: CampusDocsChunkEmbeddingEvaluationArtifact | undefined,
): Map<string, CampusDocsReviewEmbeddingAnchor[]> {
	const anchorsByChunkId = new Map<string, CampusDocsReviewEmbeddingAnchor[]>();
	if (!evaluation) return anchorsByChunkId;
	for (const ranking of evaluation.rankings) {
		for (const chunkId of ranking.evidenceChunkIds) {
			const rank = ranking.evidenceChunkRanks[chunkId];
			if (!rank) {
				throw new Error(
					`Campus docs embedding ranking is missing evidence rank: ${ranking.questionId}/${chunkId}`,
				);
			}
			const current = anchorsByChunkId.get(chunkId) ?? [];
			current.push({
				question: ranking.question,
				questionId: ranking.questionId,
				rank,
				stratum: ranking.stratum,
			});
			anchorsByChunkId.set(chunkId, current);
		}
	}
	return anchorsByChunkId;
}

function buildReviewItem(selected: SelectedReviewChunk): CampusDocsReviewItem {
	const { document, chunkIndex, anchors, signals } = selected.record;
	const chunk = document.chunks[chunkIndex];
	if (!chunk) throw new Error("Campus docs selected review chunk is missing");
	const previousBoundary = chunkIndex > 0 ? document.boundaries[chunkIndex - 1] : undefined;
	const nextBoundary = document.boundaries[chunkIndex];
	return {
		boundaries: {
			...(nextBoundary ? { next: nextBoundary } : {}),
			...(previousBoundary ? { previous: previousBoundary } : {}),
		},
		chunk,
		collection: document.collection,
		corpus: document.corpus,
		documentId: document.documentId,
		documentTags: [...document.tags],
		documentTitle: document.documentTitle,
		embeddingAnchors: anchors,
		primaryStratum: selected.primaryStratum,
		signals,
	};
}

function buildReviewItemSummary(
	population: readonly ReviewChunkRecord[],
	items: readonly CampusDocsReviewItem[],
): CampusDocsReviewItemSummary {
	const itemCountByDocumentId = new Map<string, number>();
	for (const item of items) {
		itemCountByDocumentId.set(item.documentId, (itemCountByDocumentId.get(item.documentId) ?? 0) + 1);
	}
	const strata = Object.fromEntries(
		REVIEW_ITEM_STRATA.map((stratum) => [stratum, countItems(items.filter((item) => item.primaryStratum === stratum))]),
	) as Record<CampusDocsReviewItemStratum, CampusDocsReviewItemCountSummary>;
	const signalNames = [...new Set(population.flatMap((record) => record.signals.map((signal) => signal.signal)))].sort();
	const signals = Object.fromEntries(
		signalNames.map((signal) => [
			signal,
			countItems(items.filter((item) => item.signals.some((candidate) => candidate.signal === signal))),
		]),
	) as Partial<Record<CampusDocsReviewCandidateSignal, CampusDocsReviewItemCountSummary>>;
	return {
		embeddingAnchorCount: items.reduce((sum, item) => sum + item.embeddingAnchors.length, 0),
		embeddingAnchoredItemCount: items.filter((item) => item.embeddingAnchors.length > 0).length,
		maxItemsPerDocument: Math.max(0, ...itemCountByDocumentId.values()),
		populationCandidateChunkCount: population.filter((record) => record.signals.length > 0).length,
		populationChunkCount: population.length,
		populationDocumentCount: new Set(population.map((record) => record.document.documentId)).size,
		selectedDocumentCount: itemCountByDocumentId.size,
		selectedItemCount: items.length,
		signals,
		strata,
	};
}

function countItems(items: readonly CampusDocsReviewItem[]): CampusDocsReviewItemCountSummary {
	return {
		documentCount: new Set(items.map((item) => item.documentId)).size,
		itemCount: items.length,
	};
}

function sortForStratum(
	records: readonly ReviewChunkRecord[],
	sourceProjectionSha256: Sha256Ref,
	stratum: CampusDocsReviewItemStratum,
): ReviewChunkRecord[] {
	return [...records].sort((left, right) =>
		sampleKey(sourceProjectionSha256, stratum, left).localeCompare(
			sampleKey(sourceProjectionSha256, stratum, right),
		),
	);
}

function sampleKey(
	sourceProjectionSha256: Sha256Ref,
	stratum: CampusDocsReviewItemStratum,
	record: ReviewChunkRecord,
): Sha256Ref {
	const chunk = record.document.chunks[record.chunkIndex];
	if (!chunk) throw new Error("Campus docs review chunk is missing while sampling");
	return sha256(
		new TextEncoder().encode(
			`${sourceProjectionSha256}\n${stratum}\n${record.document.documentId}\n${chunk.chunkId}`,
		),
	);
}

function chunkKey(documentId: string, chunkIndex: number): string {
	return `${documentId}\u0000${chunkIndex}`;
}
