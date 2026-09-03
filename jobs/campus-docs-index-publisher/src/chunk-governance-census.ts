import { sha256 } from "./indexing/content-digest.ts";
import {
	CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import {
	NEAR_MAX_CHARS,
	SHORT_CHARS,
	TINY_CHARS,
} from "./chunk-governance-thresholds.ts";
import type {
	CampusDocsChunkCensus,
	CampusDocsDimensionCensus,
	CampusDocsDocumentCensus,
	CampusDocsReviewChunk,
} from "./chunk-governance-types.ts";
import type { DocumentAnalysis } from "./chunk-governance-analysis-model.ts";
import type { Sha256Ref, SourceVersionSelection } from "./types.ts";

export function buildCensus(input: {
	chunkSet: Sha256Ref;
	documents: readonly DocumentAnalysis[];
	selections: readonly SourceVersionSelection[];
	sourceProjectionSha256: Sha256Ref;
}): CampusDocsChunkCensus {
	const documentMetrics = input.documents.map((document) => document.review.metrics);
	const sectionMetrics = input.documents.flatMap((document) => document.sections);
	const chunks = input.documents.flatMap((document) => document.review.chunks);
	const elementCounts = {
		blockquote: 0,
		heading: 0,
		list: 0,
		paragraph: 0,
		table: 0,
	} satisfies CampusDocsChunkCensus["elementCounts"];
	for (const selection of input.selections) {
		for (const element of selection.reader.elements) {
			elementCounts[element.kind] += 1;
		}
	}
	return {
		byCollection: buildDimensionCensus(documentMetrics, "collection"),
		byCorpus: buildDimensionCensus(documentMetrics, "corpus"),
		chunkChars: distribution(chunks.map((chunk) => chunk.chars)),
		chunkCount: chunks.length,
		chunkSet: input.chunkSet,
		definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkDefinition,
		documentChunkCounts: distribution(documentMetrics.map((document) => document.chunkCount)),
		documentCount: documentMetrics.length,
		documents: [...documentMetrics].sort((left, right) =>
			left.documentId.localeCompare(right.documentId),
		),
		elementCounts,
		maxHeadingLevel: Math.max(...documentMetrics.map((document) => document.maxHeadingLevel)),
		multiRootChunkCount: chunks.filter((chunk) => chunk.rootUnitIds.length > 1).length,
		nearMaxChunkCount: chunks.filter((chunk) => chunk.chars >= NEAR_MAX_CHARS).length,
		readerElementCount: documentMetrics.reduce(
			(sum, document) => sum + document.readerElementCount,
			0,
		),
		repeatedRootUnitCount: documentMetrics.reduce(
			(sum, document) => sum + document.repeatedRootUnitCount,
			0,
		),
		rootUnitCounts: distribution(chunks.map((chunk) => chunk.rootUnitIds.length)),
		schemaVersion: CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION,
		sectionChunkCounts: distribution(sectionMetrics.map((section) => section.chunkCount)),
		sectionCount: sectionMetrics.length,
		sections: sectionMetrics.sort((left, right) =>
			left.sectionId.localeCompare(right.sectionId),
		),
		shortChunkCount: chunks.filter((chunk) => chunk.chars < SHORT_CHARS).length,
		shortSectionCount: sectionMetrics.filter((section) => section.minChunkChars < SHORT_CHARS).length,
		sourceProjectionSha256: input.sourceProjectionSha256,
		tableChunkCount: chunks.filter((chunk) =>
			chunk.rootUnits.some((root) => root.kind === "table"),
		).length,
		tableContextChunkCount: chunks.filter((chunk) => {
			const kinds = new Set(chunk.rootUnits.map((root) => root.kind));
			return kinds.has("table") && kinds.size > 1;
		}).length,
		tableOnlyChunkCount: chunks.filter((chunk) =>
			chunk.rootUnits.every((root) => root.kind === "table"),
		).length,
		tinyChunkCount: chunks.filter((chunk) => chunk.chars < TINY_CHARS).length,
		sameSectionBoundaryCount: input.documents.reduce(
			(sum, document) => sum + document.review.metrics.sameSectionBoundaryCount,
			0,
		),
		splitReaderElementCount: countSplitReaderElements(chunks),
	};
}

function buildDimensionCensus(
	documents: readonly CampusDocsDocumentCensus[],
	field: "collection" | "corpus",
): Record<string, CampusDocsDimensionCensus> {
	const result: Record<string, CampusDocsDimensionCensus> = {};
	for (const document of documents) {
		const key = document[field];
		const current = result[key] ?? {
			chunkCount: 0,
			documentCount: 0,
			shortChunkCount: 0,
			tinyChunkCount: 0,
			totalChars: 0,
		};
		current.chunkCount += document.chunkCount;
		current.documentCount += 1;
		current.shortChunkCount += document.shortChunkCount;
		current.tinyChunkCount += document.tinyChunkCount;
		current.totalChars += document.totalChars;
		result[key] = current;
	}
	return Object.fromEntries(
		Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
	);
}

export function selectReviewSample(
	documents: readonly DocumentAnalysis[],
	sourceProjectionSha256: Sha256Ref,
): {
	documents: DocumentAnalysis[];
	primaryStratumByDocumentId: Map<string, string>;
} {
	const strata: Array<{
		name: string;
		target: number;
		select: (document: DocumentAnalysis) => boolean;
	}> = [
		{ name: "table-heavy", target: 20, select: (document) => document.review.tags.includes("table-heavy") },
		{ name: "tiny-heavy", target: 20, select: (document) => document.review.tags.includes("tiny-heavy") },
		{ name: "long-document", target: 15, select: (document) => document.review.tags.includes("long-document") },
		{ name: "many-sections", target: 15, select: (document) => document.review.tags.includes("many-sections") },
		{ name: "deep-heading", target: 15, select: (document) => document.review.tags.includes("deep-heading") },
		{ name: "same-section-split", target: 15, select: (document) => document.review.tags.includes("same-section-split") },
		{ name: "many-chunks", target: 15, select: (document) => document.review.tags.includes("many-chunks") },
		{ name: "short-document", target: 15, select: (document) => document.review.tags.includes("short-document") },
		{ name: "curriculum", target: 10, select: (document) => document.review.tags.includes("curriculum") },
		{ name: "regulations", target: 10, select: (document) => document.review.tags.includes("regulations") },
		{ name: "unstructured", target: 10, select: (document) => document.review.tags.includes("unstructured") },
	];
	const used = new Set<string>();
	const primaryStratumByDocumentId = new Map<string, string>();
	const selected: DocumentAnalysis[] = [];
	for (const stratum of strata) {
		const candidates = documents
			.filter((document) => stratum.select(document) && !used.has(document.document.docId))
			.sort((left, right) =>
				sampleKey(sourceProjectionSha256, stratum.name, left.document.docId).localeCompare(
					sampleKey(sourceProjectionSha256, stratum.name, right.document.docId),
				),
			)
			.slice(0, stratum.target);
		for (const document of candidates) {
			used.add(document.document.docId);
			primaryStratumByDocumentId.set(document.document.docId, stratum.name);
			selected.push(document);
		}
	}
	if (selected.length < CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.sampleTarget) {
		for (const document of documents
			.filter((candidate) => !used.has(candidate.document.docId))
			.sort((left, right) =>
				sampleKey(sourceProjectionSha256, "coverage-fill", left.document.docId).localeCompare(
					sampleKey(sourceProjectionSha256, "coverage-fill", right.document.docId),
				),
			)) {
			if (selected.length >= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.review.sampleTarget) break;
			used.add(document.document.docId);
			primaryStratumByDocumentId.set(document.document.docId, "coverage-fill");
			selected.push(document);
		}
	}
	return { documents: selected, primaryStratumByDocumentId };
}

export function buildSampleSummary(
	documents: readonly DocumentAnalysis[],
	selection: {
		documents: readonly DocumentAnalysis[];
		primaryStratumByDocumentId: ReadonlyMap<string, string>;
	},
): Record<string, unknown> {
	const selectedIds = new Set(selection.documents.map((document) => document.document.docId));
	const stratumCounts: Record<string, number> = {};
	for (const document of selection.documents) {
		const stratum = selection.primaryStratumByDocumentId.get(document.document.docId) ?? "unknown";
		stratumCounts[stratum] = (stratumCounts[stratum] ?? 0) + 1;
	}
	const tagCounts: Record<string, number> = {};
	for (const document of selection.documents) {
		for (const tag of document.review.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
	}
	return {
		populationDocumentCount: documents.length,
		populationChunkCount: documents.reduce(
			(sum, document) => sum + document.review.metrics.chunkCount,
			0,
		),
		selectedDocumentCount: selectedIds.size,
		selectedChunkCount: selection.documents.reduce(
			(sum, document) => sum + document.review.metrics.chunkCount,
			0,
		),
		strata: Object.fromEntries(
			Object.entries(stratumCounts).sort(([left], [right]) => left.localeCompare(right)),
		),
		tags: Object.fromEntries(
			Object.entries(tagCounts).sort(([left], [right]) => left.localeCompare(right)),
		),
	};
}

function countSplitReaderElements(chunks: readonly CampusDocsReviewChunk[]): number {
	const counts = new Map<string, number>();
	for (const chunk of chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			counts.set(rootUnitId, (counts.get(rootUnitId) ?? 0) + 1);
		}
	}
	return [...counts.values()].filter((count) => count > 1).length;
}

function sampleKey(sourceProjectionSha256: Sha256Ref, stratum: string, documentId: string): string {
	return sha256(new TextEncoder().encode(`${sourceProjectionSha256}\n${stratum}\n${documentId}`));
}

function distribution(values: readonly number[]): CampusDocsChunkCensus["chunkChars"] {
	if (values.length === 0) {
		return {
			max: 0,
			mean: 0,
			min: 0,
			p10: 0,
			p25: 0,
			p50: 0,
			p75: 0,
			p90: 0,
			p95: 0,
			p99: 0,
		};
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

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}
