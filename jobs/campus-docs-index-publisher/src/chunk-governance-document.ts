import type { DocsReaderElement } from "campus-contracts/campus-docs";
import {
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import { buildReviewCandidates } from "./chunk-governance-candidates.ts";
import {
	MAX_REVIEW_PREVIEW_CHARS,
	NEAR_MAX_CHARS,
	SHORT_CHARS,
	TINY_CHARS,
} from "./chunk-governance-thresholds.ts";
import type {
	CampusDocsDocumentCensus,
	CampusDocsReviewBoundary,
	CampusDocsReviewChunk,
	CampusDocsReviewDocument,
	CampusDocsReviewRootUnit,
	CampusDocsReviewTag,
	CampusDocsSectionCensus,
} from "./chunk-governance-types.ts";
import { buildSections } from "./indexing/sections.ts";
import type { SourceVersionSelection, StoredChunk } from "./types.ts";
import type { DocumentAnalysis, SelectionMetadata } from "./chunk-governance-analysis-model.ts";

export function buildSelectionMetadata(selection: SourceVersionSelection): SelectionMetadata {
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

export function analyzeDocument(input: {
	chunks: readonly StoredChunk[];
	metadata: SelectionMetadata;
}): DocumentAnalysis {
	const reviewDocumentId = `${input.metadata.document.docId}@${input.metadata.version.versionSlug}`;
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
			documentId: reviewDocumentId,
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
		documentId: reviewDocumentId,
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
		chars: textUnicodeLength(chunk.content),
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
		? textUnicodeLength(`${previous.content}\n\n${next.content}`)
		: null;
	const riskCodes: string[] = [];
	if (
		sameSection &&
		combinedChars !== null &&
		combinedChars <= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkDefinition.maxChars
	) {
		riskCodes.push("mergeable-same-section");
	}
	if (
		textUnicodeLength(previous.content) < SHORT_CHARS ||
		textUnicodeLength(next.content) < SHORT_CHARS
	) {
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
			(textUnicodeLength(previous.content) < SHORT_CHARS ||
				textUnicodeLength(next.content) < SHORT_CHARS)
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

export function groupChunksByDocument(chunks: readonly StoredChunk[]): Map<string, StoredChunk[]> {
	const grouped = new Map<string, StoredChunk[]>();
	for (const chunk of chunks) {
		const current = grouped.get(chunk.documentId) ?? [];
		current.push(chunk);
		grouped.set(chunk.documentId, current);
	}
	return grouped;
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
	return textUnicodeLength(elementText(element));
}

function hasTableRoot(chunk: StoredChunk, metadata: SelectionMetadata): boolean {
	return chunk.rootUnitIds.some(
		(rootUnitId) => metadata.elementByRootUnitId.get(rootUnitId)?.kind === "table",
	);
}

function sameParentPath(left: readonly string[], right: readonly string[]): boolean {
	if (left.length < 2 || right.length < 2) return false;
	return left.slice(0, -1).join("\u0000") === right.slice(0, -1).join("\u0000");
}

function normalizeText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
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

function textUnicodeLength(value: string): number {
	return [...value].length;
}
