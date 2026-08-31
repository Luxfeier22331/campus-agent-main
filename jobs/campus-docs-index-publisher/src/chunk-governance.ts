import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";

import {
	encodeNDJSON,
	readChunkSet,
} from "./artifacts.ts";
import {
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION,
} from "./chunk-governance-definitions.ts";
import { readCampusDocsChunkEmbeddingEvaluation } from "./chunk-embedding-evaluation.ts";
import { buildCampusDocsReviewItemSample } from "./chunk-review-sampling.ts";
import type {
	CampusDocsChunkCensus,
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsChunkGovernanceResult,
	CampusDocsChunkGovernanceRunData,
	CampusDocsChunkGovernanceRunManifest,
	CampusDocsDimensionCensus,
	CampusDocsDocumentCensus,
	CampusDocsReviewBoundary,
	CampusDocsReviewCandidate,
	CampusDocsReviewChunk,
	CampusDocsReviewDocument,
	CampusDocsReviewItem,
	CampusDocsReviewItemSummary,
	CampusDocsReviewRootUnit,
	CampusDocsReviewTag,
	CampusDocsSectionCensus,
	GovernanceArtifactReference,
	NumericDistribution,
} from "./chunk-governance-types.ts";
import { canonicalJsonBytes, sha256 } from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type {
	DocsReaderElement,
} from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import {
	buildChunks,
	buildSections,
	loadCurrentVersions,
	parseIndexingSource,
	sha256Text,
	sourceProjectionSha256,
} from "./indexing.ts";
import { assertValidChunkSet } from "./chunk-validation.ts";
import {
	CAMPUS_DOCS_SOURCE_KEY,
	type IndexChunk,
	type ReaderSection,
	type ReaderObjectStore,
	type Sha256Ref,
	type SourceVersionSelection,
	type StoredChunk,
	type ArtifactObjectStore,
} from "./types.ts";

const GOVERNANCE_ROOT = "campus-docs/chunk-governance";
const GOVERNANCE_REVIEW_DIRECTORY = "reviews";
const SHORT_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.shortChars;
const TINY_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.tinyChars;
const NEAR_MAX_CHARS = CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkThresholds.nearMaxChars;
const MAX_REVIEW_PREVIEW_CHARS = 220;
const TABLE_CONTEXT_OVERHEAD_RATIO = 0.25;

interface SelectionMetadata {
	document: SourceVersionSelection["document"];
	elementByRootUnitId: Map<string, DocsReaderElement>;
	sectionById: Map<string, ReaderSection>;
	sections: ReaderSection[];
	version: SourceVersionSelection["version"];
}

interface DocumentAnalysis {
	document: SourceVersionSelection["document"];
	metadata: SelectionMetadata;
	review: CampusDocsReviewDocument;
	sections: CampusDocsSectionCensus[];
	candidates: CampusDocsReviewCandidate[];
}

interface CorpusAnalysis {
	census: CampusDocsChunkCensus;
	documents: DocumentAnalysis[];
	candidates: CampusDocsReviewCandidate[];
	reviewItems: CampusDocsReviewItem[];
	reviewItemSummary: CampusDocsReviewItemSummary;
	sample: CampusDocsReviewDocument[];
	sampleSummary: Record<string, unknown>;
}

export async function runLocalCampusDocsChunkGovernanceReview(input: {
	artifactRoot: string;
	artifactStore: ArtifactObjectStore;
	chunkSet: Sha256Ref;
	embeddingEvaluation?: Sha256Ref;
	sourceStore: ReaderObjectStore;
}): Promise<CampusDocsChunkGovernanceResult> {
	const [chunkSet, sourceBytes, embeddingEvaluation] = await Promise.all([
		readChunkSet(input.artifactStore, input.chunkSet),
		input.sourceStore.read(CAMPUS_DOCS_SOURCE_KEY),
		input.embeddingEvaluation
			? readCampusDocsChunkEmbeddingEvaluation(input.artifactRoot, input.embeddingEvaluation)
			: Promise.resolve(undefined),
	]);
	if (embeddingEvaluation && embeddingEvaluation.manifest.chunkSet !== input.chunkSet) {
		throw new Error("Campus docs embedding evaluation does not reference the reviewed chunk set");
	}
	const source = parseIndexingSource(sourceBytes);
	const selections = await loadCurrentVersions({ source, readerStore: input.sourceStore });
	const projection = sourceProjectionSha256(selections);
	if (projection !== chunkSet.manifest.sourceProjectionSha256) {
		throw new Error("Campus docs chunk set does not match the current source projection");
	}
	const generatedChunks = selections.flatMap((selection) =>
		buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		}),
	);
	assertValidChunkSet({ chunks: generatedChunks, selections });
	assertStoredChunksMatch(chunkSet.chunks, generatedChunks);

	const analysis = analyzeCorpus({
		chunkSet: input.chunkSet,
		chunks: chunkSet.chunks,
		...(embeddingEvaluation ? { embeddingEvaluation } : {}),
		selections,
		sourceProjectionSha256: projection,
	});
	const censusBytes = canonicalJsonBytes(analysis.census);
	const sampleBytes = encodeGovernanceNdjson(analysis.sample);
	const candidatesBytes = encodeGovernanceNdjson(analysis.candidates);
	const summaryBytes = canonicalJsonBytes(analysis.sampleSummary);
	const reviewItemsBytes = encodeGovernanceNdjson(analysis.reviewItems);
	const reviewItemSummaryBytes = canonicalJsonBytes(analysis.reviewItemSummary);
	const manifest: CampusDocsChunkGovernanceRunManifest = {
		candidates: reference("candidates.ndjson", candidatesBytes),
		chunkSet: input.chunkSet,
		census: reference("census.json", censusBytes),
		definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
		...(input.embeddingEvaluation ? { embeddingEvaluation: input.embeddingEvaluation } : {}),
		reviewItemCount: analysis.reviewItems.length,
		reviewItems: reference("review-items.ndjson", reviewItemsBytes),
		reviewItemSummary: reference("review-items-summary.json", reviewItemSummaryBytes),
		sample: reference("sample.ndjson", sampleBytes),
		sampleCount: analysis.sample.length,
		sampleSummary: reference("sample-summary.json", summaryBytes),
		schemaVersion: CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
		sourceProjectionSha256: projection,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		GOVERNANCE_ROOT,
		GOVERNANCE_REVIEW_DIRECTORY,
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "candidates.ndjson"), candidatesBytes),
		writeImmutable(join(outputDirectory, "census.json"), censusBytes),
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "review-items.ndjson"), reviewItemsBytes),
		writeImmutable(join(outputDirectory, "review-items-summary.json"), reviewItemSummaryBytes),
		writeImmutable(join(outputDirectory, "sample-summary.json"), summaryBytes),
		writeImmutable(join(outputDirectory, "sample.ndjson"), sampleBytes),
	]);
	return {
		candidateCount: analysis.candidates.length,
		chunkCount: chunkSet.chunks.length,
		documentCount: selections.length,
		outputDirectory,
		reviewItemCount: analysis.reviewItems.length,
		run,
		sampleCount: analysis.sample.length,
		sourceProjectionSha256: projection,
	};
}

export async function readCampusDocsChunkGovernanceRun(
	artifactRoot: string,
	run: Sha256Ref,
): Promise<CampusDocsChunkGovernanceRunData> {
	const directory = join(
		artifactRoot,
		GOVERNANCE_ROOT,
		GOVERNANCE_REVIEW_DIRECTORY,
		"sha256",
		artifactHex(run),
	);
	const manifestBytes = new Uint8Array(await readFile(join(directory, "manifest.json")));
	if (sha256(manifestBytes) !== run) {
		throw new Error(`Campus docs chunk governance manifest digest does not match ${run}`);
	}
	const manifest = parseGovernanceManifest(JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown);
	const [censusBytes, sampleBytes, candidatesBytes, reviewItemsBytes, reviewItemSummaryBytes] = await Promise.all([
		readVerifiedFile(directory, manifest.census, "Campus docs chunk governance census"),
		readVerifiedFile(directory, manifest.sample, "Campus docs chunk governance sample"),
		readVerifiedFile(directory, manifest.candidates, "Campus docs chunk governance candidates"),
		readVerifiedFile(directory, manifest.reviewItems, "Campus docs chunk governance review items"),
		readVerifiedFile(
			directory,
			manifest.reviewItemSummary,
			"Campus docs chunk governance review item summary",
		),
	]);
	return {
		candidates: decodeGovernanceNdjson(candidatesBytes) as CampusDocsReviewCandidate[],
		census: parseCensus(JSON.parse(new TextDecoder().decode(censusBytes)) as unknown),
		manifest,
		reviewItems: decodeGovernanceNdjson(reviewItemsBytes) as CampusDocsReviewItem[],
		reviewItemSummary: JSON.parse(
			new TextDecoder().decode(reviewItemSummaryBytes),
		) as CampusDocsReviewItemSummary,
		sample: decodeGovernanceNdjson(sampleBytes) as CampusDocsReviewDocument[],
		run,
	};
}

function analyzeCorpus(input: {
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
		if (!documentMetadata) throw new Error(`Campus docs metadata is missing: ${selection.document.docId}`);
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
	const sample = sampleSelection.documents.map((analysis) => ({
		...analysis.review,
		primaryStratum: sampleSelection.primaryStratumByDocumentId.get(analysis.document.docId) ?? "coverage-fill",
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

function buildSelectionMetadata(selection: SourceVersionSelection): SelectionMetadata {
	const sections = buildSections(selection.document, selection.version, selection.reader);
	const elementByRootUnitId = new Map<string, DocsReaderElement>();
	for (const element of selection.reader.elements) {
		elementByRootUnitId.set(element.rootUnitId, element);
	}
	const sectionById = new Map(sections.map((section) => [section.sectionId, section]));
	return {
		document: selection.document,
		elementByRootUnitId,
		sectionById,
		sections,
		version: selection.version,
	};
}

function analyzeDocument(input: {
	chunks: readonly StoredChunk[];
	metadata: SelectionMetadata;
}): DocumentAnalysis {
	const chunks = [...input.chunks];
	const chunkReviews = chunks.map((chunk, chunkIndex) =>
		buildReviewChunk(chunk, chunkIndex, input.metadata),
	);
	const boundaries = chunks.slice(1).map((chunk, offset) => {
		const previous = chunks[offset];
		if (!previous) throw new Error("Campus docs chunk order is invalid");
		return buildBoundary(previous, chunk, offset, input.metadata);
	});
	const sections = input.metadata.sections.map((section) => {
		const sectionChunks = chunkReviews.filter((chunk) => chunk.sectionId === section.sectionId);
		const lengths = sectionChunks.map((chunk) => chunk.chars);
		return {
			chunkCount: sectionChunks.length,
			documentId: input.metadata.document.docId,
			headingPath: section.headingPath,
			maxChunkChars: Math.max(...lengths),
			minChunkChars: Math.min(...lengths),
			sectionId: section.sectionId,
			sectionTitle: section.sectionTitle,
			shortChunkCount: lengths.filter((length) => length < SHORT_CHARS).length,
			totalChars: lengths.reduce((sum, length) => sum + length, 0),
			tinyChunkCount: lengths.filter((length) => length < TINY_CHARS).length,
		} satisfies CampusDocsSectionCensus;
	});
	const metrics = buildDocumentCensus(input.metadata, chunkReviews, boundaries);
	const tags = buildDocumentTags(metrics);
	const review: CampusDocsReviewDocument = {
		boundaries,
		chunks: chunkReviews,
		collection: input.metadata.document.collection,
		documentId: input.metadata.document.docId,
		documentTitle: input.metadata.document.title,
		metrics,
		tags,
		corpus: input.metadata.document.corpus,
	};
	return {
		candidates: buildReviewCandidates(review, sections),
		document: input.metadata.document,
		metadata: input.metadata,
		review,
		sections,
	};
}

function buildReviewChunk(
	chunk: StoredChunk,
	chunkIndex: number,
	metadata: SelectionMetadata,
): CampusDocsReviewChunk {
	const section = metadata.sectionById.get(chunk.sectionId);
	if (!section) throw new Error(`Campus docs chunk section is unknown: ${chunk.chunkId}`);
	const rootUnits = chunk.rootUnitIds.map((rootUnitId) => {
		const element = metadata.elementByRootUnitId.get(rootUnitId);
		if (!element || element.kind === "heading") {
			throw new Error(`Campus docs chunk root unit is unknown: ${chunk.chunkId}`);
		}
		return {
			chars: elementChars(element),
			kind: element.kind,
			rootUnitId,
			textPreview: preview(elementText(element)),
		} satisfies CampusDocsReviewRootUnit;
	});
	return {
		chars: unicodeLength(chunk.content),
		chunkId: chunk.chunkId,
		chunkIndex,
		content: chunk.content,
		headingPath: [...section.headingPath],
		rootUnitIds: [...chunk.rootUnitIds],
		rootUnits,
		sectionId: chunk.sectionId,
		sectionTitle: chunk.sectionTitle,
	};
}

function buildBoundary(
	previous: StoredChunk,
	next: StoredChunk,
	previousIndex: number,
	metadata: SelectionMetadata,
): CampusDocsReviewBoundary {
	const sameSection = previous.sectionId === next.sectionId;
	const combinedChars = sameSection
		? unicodeLength(`${previous.content}\n\n${next.content}`)
		: null;
	const riskCodes: string[] = [];
	if (sameSection && combinedChars !== null && combinedChars <= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkDefinition.maxChars) {
		riskCodes.push("mergeable-same-section");
	}
	if (unicodeLength(previous.content) < SHORT_CHARS || unicodeLength(next.content) < SHORT_CHARS) {
		riskCodes.push("short-adjacent");
	}
	if (!sameSection) {
		const previousSection = metadata.sectionById.get(previous.sectionId);
		const nextSection = metadata.sectionById.get(next.sectionId);
		if (
			previousSection &&
			nextSection &&
			previousSection.headingPath.length > 0 &&
			nextSection.headingPath.length > 0 &&
			sameParentPath(previousSection.headingPath, nextSection.headingPath) &&
			(unicodeLength(previous.content) < SHORT_CHARS || unicodeLength(next.content) < SHORT_CHARS)
		) {
			riskCodes.push("short-lower-heading-boundary");
		}
	}
	if (hasTableRoot(previous, metadata) !== hasTableRoot(next, metadata)) {
		riskCodes.push("table-transition");
	}
	return {
		combinedChars,
		nextChunkId: next.chunkId,
		nextFirst: preview(firstNonemptyLine(next.content)),
		nextIndex: previousIndex + 1,
		previousChunkId: previous.chunkId,
		previousEnd: preview(lastNonemptyLine(previous.content)),
		previousIndex,
		riskCodes,
		sameSection,
	};
}

function buildDocumentCensus(
	metadata: SelectionMetadata,
	chunks: readonly CampusDocsReviewChunk[],
	boundaries: readonly CampusDocsReviewBoundary[],
): CampusDocsDocumentCensus {
	const readerElements = metadata.elementByRootUnitId;
	const lengths = chunks.map((chunk) => chunk.chars);
	const rootOccurrences = new Map<string, number>();
	for (const chunk of chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			rootOccurrences.set(rootUnitId, (rootOccurrences.get(rootUnitId) ?? 0) + 1);
		}
	}
	return {
		blockquoteCount: countElements(readerElements, "blockquote"),
		chunkCount: chunks.length,
		collection: metadata.document.collection,
		documentId: metadata.document.docId,
		documentTitle: metadata.document.title,
		headingCount: countElements(readerElements, "heading"),
		listCount: countElements(readerElements, "list"),
		maxHeadingLevel: maxHeadingLevel(metadata),
		nearMaxChunkCount: lengths.filter((length) => length >= NEAR_MAX_CHARS).length,
		paragraphCount: countElements(readerElements, "paragraph"),
		readerElementCount: readerElements.size,
		repeatedRootUnitCount: [...rootOccurrences.values()].filter((count) => count > 1).length,
		sameSectionBoundaryCount: boundaries.filter((boundary) => boundary.sameSection).length,
		sectionCount: metadata.sections.length,
		shortChunkCount: lengths.filter((length) => length < SHORT_CHARS).length,
		supplementCount: metadata.version.supplements.length,
		tableCount: countElements(readerElements, "table"),
		tinyChunkCount: lengths.filter((length) => length < TINY_CHARS).length,
		totalChars: lengths.reduce((sum, length) => sum + length, 0),
		corpus: metadata.document.corpus,
	};
}

function buildDocumentTags(metrics: CampusDocsDocumentCensus): CampusDocsReviewTag[] {
	const tags: CampusDocsReviewTag[] = [];
	if (metrics.corpus === "curriculum") tags.push("curriculum");
	if (metrics.corpus === "regulations") tags.push("regulations");
	if (metrics.maxHeadingLevel >= 4 || metrics.headingCount >= 20) tags.push("deep-heading");
	if (metrics.totalChars >= 10_000) tags.push("long-document");
	if (metrics.chunkCount >= 20) tags.push("many-chunks");
	if (metrics.sectionCount >= 20) tags.push("many-sections");
	if (metrics.repeatedRootUnitCount > 0) tags.push("multi-root");
	if (metrics.sameSectionBoundaryCount > 0) tags.push("same-section-split");
	if (metrics.totalChars <= 1_000) tags.push("short-document");
	if (metrics.tableCount >= 5) tags.push("table-heavy");
	if (metrics.tinyChunkCount / metrics.chunkCount >= 0.4) tags.push("tiny-heavy");
	if (metrics.headingCount === 0) tags.push("unstructured");
	return tags;
}

function buildReviewCandidates(
	review: CampusDocsReviewDocument,
	sections: readonly CampusDocsSectionCensus[],
): CampusDocsReviewCandidate[] {
	const candidates: CampusDocsReviewCandidate[] = [];
	const rootOccurrenceCounts = new Map<string, number>();
	for (const chunk of review.chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			rootOccurrenceCounts.set(rootUnitId, (rootOccurrenceCounts.get(rootUnitId) ?? 0) + 1);
		}
		const tableRootCount = chunk.rootUnits.filter((root) => root.kind === "table").length;
		const contextChars = chunk.rootUnits
			.filter((root) => root.kind !== "table")
			.reduce((sum, root) => sum + root.chars, 0);
		if (isSourceUrlOnly(chunk.content)) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: "chunk contains only the captured source URL",
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "source-url-only",
				title: review.documentTitle,
			});
		}
		if (isStandaloneDocumentMetadata(chunk.content)) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: "chunk contains only an approval date, revision date, or document number",
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "standalone-document-metadata",
				title: review.documentTitle,
			});
		}
		if (chunk.rootUnitIds.length >= 8) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `chunk contains ${chunk.rootUnitIds.length} reader root units`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "many-root-units",
				title: review.documentTitle,
			});
		}
		if (chunk.chars >= NEAR_MAX_CHARS && chunk.rootUnitIds.length >= 3) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `near-max chunk (${chunk.chars} chars) combines ${chunk.rootUnitIds.length} reader root units`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "near-max-multi-root",
				title: review.documentTitle,
			});
		}
		if (tableRootCount > 0 && contextChars / Math.max(1, chunk.chars) >= TABLE_CONTEXT_OVERHEAD_RATIO) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `table chunk carries ${contextChars} chars of adjacent non-table context`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "table-context-overhead",
				title: review.documentTitle,
			});
		}
		if (tableRootCount > 0 && chunk.chars < SHORT_CHARS) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `table chunk is only ${chunk.chars} chars`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "short-table-chunk",
				title: review.documentTitle,
			});
		}
	}
	for (const [rootUnitId, count] of rootOccurrenceCounts) {
		const root = review.chunks
			.flatMap((chunk) => chunk.rootUnits)
			.find((unit) => unit.rootUnitId === rootUnitId);
		if (count > 1 && root?.kind !== "table") {
			for (const chunk of review.chunks.filter((item) => item.rootUnitIds.includes(rootUnitId))) {
				candidates.push({
					chunkIndex: chunk.chunkIndex,
					detail: `reader ${rootUnitId} appears in ${count} chunks`,
					documentId: review.documentId,
					sectionId: chunk.sectionId,
					signal: "split-reader-element",
					title: review.documentTitle,
				});
			}
		}
	}
	for (const section of sections) {
		if (
			section.chunkCount === 1 &&
			section.minChunkChars < SHORT_CHARS &&
			section.headingPath.length >= 2
		) {
			const sectionChunk = review.chunks.find((chunk) => chunk.sectionId === section.sectionId);
			if (!sectionChunk) {
				throw new Error(`Campus docs review section has no chunk: ${section.sectionId}`);
			}
			candidates.push({
				chunkIndex: sectionChunk.chunkIndex,
				detail: `lower-level section has one short chunk (${section.minChunkChars} chars)`,
				documentId: review.documentId,
				sectionId: section.sectionId,
				signal: "section-fragment",
				title: review.documentTitle,
			});
		}
	}
	for (const boundary of review.boundaries) {
		if (
			boundary.sameSection &&
			boundary.combinedChars !== null &&
			boundary.combinedChars <= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkDefinition.maxChars &&
			(boundary.nextIndex === boundary.previousIndex + 1)
		) {
			const next = review.chunks[boundary.nextIndex];
			const previous = review.chunks[boundary.previousIndex];
			if (next && previous && (next.chars < SHORT_CHARS || previous.chars < SHORT_CHARS)) {
				candidates.push({
					chunkIndex: boundary.nextIndex,
					detail: `adjacent same-section chunks could fit in ${boundary.combinedChars} chars`,
					documentId: review.documentId,
					sectionId: next.sectionId,
					signal: "mergeable-short-tail",
					title: review.documentTitle,
				});
			}
		}
	}
	return candidates;
}

function buildCensus(input: {
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
		documents: [...documentMetrics].sort((left, right) => left.documentId.localeCompare(right.documentId)),
		elementCounts,
		maxHeadingLevel: Math.max(...documentMetrics.map((document) => document.maxHeadingLevel)),
		multiRootChunkCount: chunks.filter((chunk) => chunk.rootUnitIds.length > 1).length,
		nearMaxChunkCount: chunks.filter((chunk) => chunk.chars >= NEAR_MAX_CHARS).length,
		readerElementCount: documentMetrics.reduce((sum, document) => sum + document.readerElementCount, 0),
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
		tableChunkCount: chunks.filter((chunk) => chunk.rootUnits.some((root) => root.kind === "table")).length,
		tableContextChunkCount: chunks.filter((chunk) => {
			const kinds = new Set(chunk.rootUnits.map((root) => root.kind));
			return kinds.has("table") && kinds.size > 1;
		}).length,
		tableOnlyChunkCount: chunks.filter((chunk) => chunk.rootUnits.every((root) => root.kind === "table")).length,
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
	return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function selectReviewSample(
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

function buildSampleSummary(
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
		strata: Object.fromEntries(Object.entries(stratumCounts).sort(([left], [right]) => left.localeCompare(right))),
		tags: Object.fromEntries(Object.entries(tagCounts).sort(([left], [right]) => left.localeCompare(right))),
	};
}

function groupChunksByDocument(chunks: readonly StoredChunk[]): Map<string, StoredChunk[]> {
	const grouped = new Map<string, StoredChunk[]>();
	for (const chunk of chunks) {
		const current = grouped.get(chunk.documentId) ?? [];
		current.push(chunk);
		grouped.set(chunk.documentId, current);
	}
	return grouped;
}

function assertStoredChunksMatch(
	stored: readonly StoredChunk[],
	generated: readonly IndexChunk[],
): void {
	if (stored.length !== generated.length) {
		throw new Error(`Campus docs stored chunk count = ${stored.length}, generated = ${generated.length}`);
	}
	for (const [index, expected] of generated.entries()) {
		const actual = stored[index];
		if (!actual || !sameChunkIdentityAndContent(actual, expected)) {
			throw new Error(`Campus docs stored chunk differs from current builder at index ${index}`);
		}
		if (actual.retrievalTextSha256 !== sha256Text(actual.retrievalText)) {
			throw new Error(`Campus docs stored chunk retrieval text digest is invalid: ${actual.chunkId}`);
		}
	}
}

function sameChunkIdentityAndContent(left: StoredChunk, right: IndexChunk): boolean {
	return isDeepStrictEqual(
		{
			chunkId: left.chunkId,
			content: left.content,
			documentId: left.documentId,
			documentTitle: left.documentTitle,
			retrievalText: left.retrievalText,
			rootUnitIds: left.rootUnitIds,
			sectionId: left.sectionId,
			sectionRef: left.sectionRef,
			sectionTitle: left.sectionTitle,
			versionId: left.versionId,
			versionLabel: left.versionLabel,
			versionSlug: left.versionSlug,
		},
		{
			chunkId: right.chunkId,
			content: right.content,
			documentId: right.documentId,
			documentTitle: right.documentTitle,
			retrievalText: right.retrievalText,
			rootUnitIds: right.rootUnitIds,
			sectionId: right.sectionId,
			sectionRef: right.sectionRef,
			sectionTitle: right.sectionTitle,
			versionId: right.versionId,
			versionLabel: right.versionLabel,
			versionSlug: right.versionSlug,
		},
	);
}

function countElements(
	elements: ReadonlyMap<string, DocsReaderElement>,
	kind: DocsReaderElement["kind"],
): number {
	return [...elements.values()].filter((element) => element.kind === kind).length;
}

function maxHeadingLevel(metadata: SelectionMetadata): number {
	return Math.max(
		0,
		...[...metadata.elementByRootUnitId.values()]
			.filter((element) => element.kind === "heading")
			.map((element) => element.level),
	);
}

function elementText(element: Exclude<DocsReaderElement, { kind: "heading" }>): string {
	if (element.kind !== "table") return normalizeText(element.text);
	return element.rows
		.flatMap((row) => row.map((cell) => normalizeText(cell.text)))
		.filter(Boolean)
		.join("；");
}

function elementChars(element: Exclude<DocsReaderElement, { kind: "heading" }>): number {
	return unicodeLength(elementText(element));
}

function hasTableRoot(chunk: StoredChunk, metadata: SelectionMetadata): boolean {
	return chunk.rootUnitIds.some((rootUnitId) => metadata.elementByRootUnitId.get(rootUnitId)?.kind === "table");
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

function sameParentPath(left: readonly string[], right: readonly string[]): boolean {
	if (left.length < 2 || right.length < 2) return false;
	return left.slice(0, -1).join("\u0000") === right.slice(0, -1).join("\u0000");
}

function sampleKey(sourceProjectionSha256: Sha256Ref, stratum: string, documentId: string): string {
	return sha256(new TextEncoder().encode(`${sourceProjectionSha256}\n${stratum}\n${documentId}`));
}

function distribution(values: readonly number[]): NumericDistribution {
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

function normalizeText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function isSourceUrlOnly(value: string): boolean {
	return /^>\s*Source URL:\s*https?:\/\/\S+$/u.test(normalizeText(value));
}

function isStandaloneDocumentMetadata(value: string): boolean {
	const lines = normalizeText(value)
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.length > 0 && lines.every((line) => isApprovalDate(line) || isDocumentNumber(line));
}

function isApprovalDate(value: string): boolean {
	const year = "(?:\\d{4}|[〇零一二三四五六七八九]{4})";
	const monthOrDay = "(?:\\d{1,2}|[〇零一二三四五六七八九十]{1,3})";
	return new RegExp(
		`^[（(]?(?:经)?${year}年${monthOrDay}月${monthOrDay}日(?:[^。；\\n]{0,40}(?:审议通过|通过|修订|批准))?[）)]?$`,
		"u",
	).test(value);
}

function isDocumentNumber(value: string): boolean {
	return /^[\p{Script=Han}A-Za-z（）()]{1,24}[〔（(\[]\d{4}[〕）)\]]\s*\d+\s*号$/u.test(value);
}

function preview(value: string): string {
	const normalized = normalizeText(value).replace(/\s+/gu, " ");
	return [...normalized].slice(0, MAX_REVIEW_PREVIEW_CHARS).join("");
}

function firstNonemptyLine(value: string): string {
	return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function lastNonemptyLine(value: string): string {
	return [...value.split("\n")].reverse().map((line) => line.trim()).find(Boolean) ?? "";
}

function unicodeLength(value: string): number {
	return [...value].length;
}

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}

function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function reference(file: string, bytes: Uint8Array): GovernanceArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}

function encodeGovernanceNdjson(records: readonly unknown[]): Uint8Array {
	if (records.length === 0) return new TextEncoder().encode("");
	return encodeNDJSON(records);
}

function decodeGovernanceNdjson(bytes: Uint8Array): unknown[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (text === "") return [];
	if (!text.endsWith("\n")) throw new Error("Campus docs governance NDJSON must end with a newline");
	return text
		.slice(0, -1)
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown);
}

async function readVerifiedFile(
	directory: string,
	referenceValue: GovernanceArtifactReference,
	label: string,
): Promise<Uint8Array> {
	const bytes = new Uint8Array(await readFile(join(directory, referenceValue.file)));
	if (bytes.byteLength !== referenceValue.byteSize) {
		throw new Error(`${label} byte size does not match`);
	}
	if (sha256(bytes) !== referenceValue.sha256) {
		throw new Error(`${label} digest does not match`);
	}
	return bytes;
}

async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
	try {
		await writeFile(path, bytes, { flag: "wx" });
		return;
	} catch (error) {
		if (!isFileExistsError(error)) throw error;
	}
	const existing = new Uint8Array(await readFile(path));
	if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
		throw new Error(`Campus docs governance artifact conflicts: ${path}`);
	}
}

function parseGovernanceManifest(value: unknown): CampusDocsChunkGovernanceRunManifest {
	if (!isRecord(value) || value.schemaVersion !== CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION) {
		throw new Error("Campus docs chunk governance manifest schema is invalid");
	}
	if (
		!isSha256Ref(value.chunkSet) ||
		!isSha256Ref(value.sourceProjectionSha256) ||
		(value.embeddingEvaluation !== undefined && !isSha256Ref(value.embeddingEvaluation)) ||
		!positiveInteger(value.reviewItemCount) ||
		!positiveInteger(value.sampleCount)
	) {
		throw new Error("Campus docs chunk governance manifest definition is invalid");
	}
	for (const [field, label] of [
		["candidates", "governance candidates"],
		["census", "governance census"],
		["reviewItems", "governance review items"],
		["reviewItemSummary", "governance review item summary"],
		["sample", "governance sample"],
		["sampleSummary", "governance sample summary"],
	] as const) {
		assertArtifactReference(value[field], label);
	}
	return value as unknown as CampusDocsChunkGovernanceRunManifest;
}

function parseCensus(value: unknown): CampusDocsChunkCensus {
	if (!isRecord(value) || value.schemaVersion !== CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION) {
		throw new Error("Campus docs chunk census schema is invalid");
	}
	return value as unknown as CampusDocsChunkCensus;
}

function assertArtifactReference(value: unknown, label: string): asserts value is GovernanceArtifactReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		typeof value.file !== "string" ||
		!value.file ||
		!isSha256Ref(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
