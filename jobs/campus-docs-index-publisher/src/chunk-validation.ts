import type {
	DocsReaderElement,
	DocsReaderTableElement,
} from "campus-contracts/campus-docs";
import { CHUNK_SET_DEFINITION } from "./definitions.ts";
import { buildSections, isSourceUrlOnly } from "./indexing/sections.ts";
import { getLeadingDocumentMetadata } from "./indexing/chunks.ts";
import type {
	IndexChunk,
	ReaderSection,
	SourceVersionSelection,
} from "./types.ts";

interface SelectionMetadata {
	document: SourceVersionSelection["document"];
	elementByRootUnitId: Map<string, DocsReaderElement>;
	leadingMetadataRootUnitIds: ReadonlySet<string>;
	ordinalByRootUnitId: Map<string, number>;
	sectionByRootUnitId: Map<string, ReaderSection>;
	sections: ReaderSection[];
	version: SourceVersionSelection["version"];
}

export function assertValidChunkSet(input: {
	chunks: readonly IndexChunk[];
	selections: readonly SourceVersionSelection[];
}): void {
	const metadata = input.selections.map(buildSelectionMetadata);
	const metadataByDocument = new Map(metadata.map((item) => [item.document.docId, item]));
	const seenChunkIds = new Set<string>();

	for (const chunk of input.chunks) {
		if (seenChunkIds.has(chunk.chunkId)) {
			throw new Error(`Campus docs chunk identity is duplicated: ${chunk.chunkId}`);
		}
		seenChunkIds.add(chunk.chunkId);
		if (!chunk.content.trim()) {
			throw new Error(`Campus docs chunk content is empty: ${chunk.chunkId}`);
		}
		if (chunk.rootUnitIds.length === 0) {
			throw new Error(`Campus docs chunk has no root units: ${chunk.chunkId}`);
		}

		const document = metadataByDocument.get(chunk.documentId);
		if (!document) {
			throw new Error(`Campus docs chunk references an unknown document: ${chunk.documentId}`);
		}
		if (chunk.versionId !== document.version.versionId) {
			throw new Error(`Campus docs chunk references a non-current version: ${chunk.chunkId}`);
		}
		assertValidChunkRoots(chunk, document);

		const rootUnitId = chunk.rootUnitIds[0];
		const section = rootUnitId
			? document.sectionByRootUnitId.get(rootUnitId)
			: undefined;
		if (!section) {
			throw new Error(`Campus docs chunk references an unknown section: ${chunk.chunkId}`);
		}
		const expectedRetrievalText = [document.document.title, ...section.headingPath, chunk.content]
			.map(normalizeBlockText)
			.filter(Boolean)
			.join("\n");
		if (chunk.retrievalText !== expectedRetrievalText) {
			throw new Error(`Campus docs chunk retrieval text is invalid: ${chunk.chunkId}`);
		}
		if ([...chunk.content].length > CHUNK_SET_DEFINITION.chunking.maxChars) {
			throw new Error(`Campus docs chunk exceeds the character limit: ${chunk.chunkId}`);
		}
	}

	assertSourceCoverage(metadata, input.chunks);
}

function buildSelectionMetadata(selection: SourceVersionSelection): SelectionMetadata {
	const sections = buildSections(selection.document, selection.version, selection.reader);
	const leadingMetadata = getLeadingDocumentMetadata(selection.reader);
	const elementByRootUnitId = new Map<string, DocsReaderElement>();
	const ordinalByRootUnitId = new Map<string, number>();
	for (const [ordinal, element] of selection.reader.elements.entries()) {
		elementByRootUnitId.set(element.rootUnitId, element);
		ordinalByRootUnitId.set(element.rootUnitId, ordinal);
	}
	const sectionByRootUnitId = new Map<string, ReaderSection>();
	for (const section of sections) {
		for (const element of section.elements) {
			sectionByRootUnitId.set(element.rootUnitId, section);
		}
	}
	return {
		document: selection.document,
		elementByRootUnitId,
		leadingMetadataRootUnitIds: new Set(leadingMetadata?.rootUnitIds ?? []),
		ordinalByRootUnitId,
		sectionByRootUnitId,
		sections,
		version: selection.version,
	};
}

function assertValidChunkRoots(chunk: IndexChunk, metadata: SelectionMetadata): void {
	const seenRootUnitIds = new Set<string>();
	const sectionIds = new Set<string>();
	const ordinals: number[] = [];
	for (const rootUnitId of chunk.rootUnitIds) {
		if (seenRootUnitIds.has(rootUnitId)) {
			throw new Error(`Campus docs chunk repeats a root unit: ${chunk.chunkId}`);
		}
		seenRootUnitIds.add(rootUnitId);
		const element = metadata.elementByRootUnitId.get(rootUnitId);
		if (!element) {
			throw new Error(`Campus docs chunk references an unknown root unit: ${chunk.chunkId}`);
		}
		if (element.kind === "heading") {
			throw new Error(`Campus docs chunk references a heading root unit: ${chunk.chunkId}`);
		}
		if (isSourceUrlOnly(element.kind === "table" ? "" : element.text)) {
			throw new Error(`Campus docs chunk references a non-evidence root unit: ${chunk.chunkId}`);
		}
		const section = metadata.sectionByRootUnitId.get(rootUnitId);
		if (!section) {
			throw new Error(`Campus docs chunk root unit has no section: ${chunk.chunkId}`);
		}
		sectionIds.add(section.sectionId);
		const ordinal = metadata.ordinalByRootUnitId.get(rootUnitId);
		if (ordinal === undefined) {
			throw new Error(`Campus docs chunk root unit has no reader position: ${chunk.chunkId}`);
		}
		ordinals.push(ordinal);
	}
	if (sectionIds.size !== 1) {
		throw new Error(`Campus docs chunk crosses section boundaries: ${chunk.chunkId}`);
	}
	if (!ordinals.every((ordinal, index) => index === 0 || ordinal > (ordinals[index - 1] ?? ordinal))) {
		throw new Error(`Campus docs chunk root units are out of order: ${chunk.chunkId}`);
	}
}

function assertSourceCoverage(
	metadata: readonly SelectionMetadata[],
	chunks: readonly IndexChunk[],
): void {
	for (const document of metadata) {
		const documentChunks = chunks.filter((chunk) => chunk.documentId === document.document.docId);
		for (const section of document.sections) {
			const sectionChunks = documentChunks.filter((chunk) =>
				chunk.rootUnitIds.some(
					(rootUnitId) => document.sectionByRootUnitId.get(rootUnitId)?.sectionId === section.sectionId,
				),
			);
			const representedRootUnitIds = new Set(
				sectionChunks.flatMap((chunk) => chunk.rootUnitIds),
			);
			for (const element of section.elements) {
				if (
					isSourceUrlOnly(element.kind === "table" ? "" : element.text) ||
					document.leadingMetadataRootUnitIds.has(element.rootUnitId)
				) {
					continue;
				}
				if (!representedRootUnitIds.has(element.rootUnitId)) {
					throw new Error(
						`Campus docs reader element is absent from chunks: ${document.document.docId}/${element.rootUnitId}`,
					);
				}
				if (element.kind === "table") {
					assertTableCoverage(element, sectionChunks, document.document.docId);
					continue;
				}
				const evidence = sectionChunks.filter((chunk) =>
					chunk.rootUnitIds.includes(element.rootUnitId),
				);
				const expected = canonicalCoverage(element.text);
				const directlyCovered = evidence.some((chunk) =>
					canonicalCoverage(chunk.content).includes(expected),
				);
				const aggregateCoverage = canonicalCoverage(
					evidence.map((chunk) => chunk.content).join(""),
				);
				if (!directlyCovered && !aggregateCoverage.includes(expected)) {
					throw new Error(
						`Campus docs reader text is absent from chunks: ${document.document.docId}/${element.rootUnitId}`,
					);
				}
			}
		}
	}
}

function assertTableCoverage(
	table: DocsReaderTableElement,
	sectionChunks: readonly IndexChunk[],
	documentId: string,
): void {
	const tableContent = canonicalCoverage(
		sectionChunks
			.filter((chunk) => chunk.rootUnitIds.includes(table.rootUnitId))
			.map((chunk) => chunk.content)
			.join(""),
	);
	for (const row of table.rows) {
		for (const cell of row) {
			const expected = canonicalCoverage(cell.text);
			if (expected && !tableContent.includes(expected)) {
				throw new Error(
					`Campus docs table cell is absent from chunks: ${documentId}/${table.rootUnitId}`,
				);
			}
		}
	}
}

function canonicalCoverage(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\s+/gu, "");
}

function normalizeBlockText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}
