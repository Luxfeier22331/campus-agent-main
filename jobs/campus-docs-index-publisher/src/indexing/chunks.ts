import { buildReaderRouteSlug } from "../../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type {
	DocsReader,
	DocsSourceManifest,
	DocsSourceVersion,
} from "../../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import { CHUNK_SET_DEFINITION } from "../definitions.ts";
import { sha256Text, stableId } from "./content-digest.ts";
import type { IndexChunk } from "../types.ts";
import type { ChunkLimits, ChunkPiece } from "./chunk-model.ts";
import {
	assertChunkSize,
	MAX_TEXT_BYTES,
	orderedUnique,
	splitOversizedText,
	splitTextByLimits,
	unicodeLength,
} from "./chunk-text.ts";
import { attachTableContext, buildTableContext, buildTablePieces } from "./table-chunks.ts";
import {
	buildSections,
	isSourceUrlOnly,
	normalizeBlockText,
	type ReaderContentElement,
} from "./sections.ts";

export function buildChunks(input: {
	document: DocsSourceManifest["documents"][number];
	reader: DocsReader;
	version: DocsSourceVersion;
}): IndexChunk[] {
	const routeSlug = buildReaderRouteSlug(input.document);
	const canonicalUrl = `/docs/${input.document.corpus}/${input.document.collection}/${routeSlug}/v/${encodeURIComponent(input.version.versionSlug)}`;
	const sections = buildSections(input.document, input.version, input.reader);
	const leadingMetadata = getLeadingDocumentMetadata(input.reader);
	const chunks: IndexChunk[] = [];
	for (const section of sections) {
		const pieces = buildSectionPieces(
			section.elements,
			input.version.versionId,
			section.headingPath.length === 0 ? leadingMetadata : null,
		);
		for (let index = 0; index < pieces.length; index += 1) {
			const piece = pieces[index] as ChunkPiece;
			const retrievalText = buildRetrievalText(
				input.document.title,
				section.headingPath,
				piece.content,
			);
			if (Buffer.byteLength(retrievalText, "utf8") > MAX_TEXT_BYTES) {
				throw new Error(`Campus docs retrieval text exceeds byte limit: ${input.version.versionId}`);
			}
			const chunkId = stableId(
				"chunk",
				[
					input.document.docId,
					input.version.versionId,
					section.sectionId,
					String(index),
					sha256Text(piece.content),
				],
			);
			chunks.push({
				chunkId,
				content: piece.content,
				documentId: input.document.docId,
				documentTitle: input.document.title,
				retrievalText,
				rootUnitIds: piece.rootUnitIds,
				sectionId: section.sectionId,
				sectionRef: section.anchor
					? `${canonicalUrl}#${encodeURIComponent(section.anchor)}`
					: canonicalUrl,
				sectionTitle: section.sectionTitle,
				versionId: input.version.versionId,
				versionSlug: input.version.versionSlug,
			});
		}
	}
	return chunks;
}

export interface LeadingDocumentMetadata {
	content: string;
	rootUnitIds: string[];
}

function buildSectionPieces(
	elements: readonly ReaderContentElement[],
	versionId: string,
	leadingDocumentMetadata: LeadingDocumentMetadata | null,
): ChunkPiece[] {
	const result: ChunkPiece[] = [];
	let textBlocks: ChunkPiece[] = [];
	let mergeBlockedBeforeNextPiece = false;
	const leadingMetadataRootUnitIds = new Set(leadingDocumentMetadata?.rootUnitIds ?? []);
	const sectionMetadata = elements
		.filter((element) => leadingMetadataRootUnitIds.has(element.rootUnitId))
		.map((element) => ({
			content: normalizeBlockText(element.kind === "table" ? "" : element.text),
			rootUnitIds: [element.rootUnitId],
		}));
	const contentElements = elements.filter(
		(element) => !leadingMetadataRootUnitIds.has(element.rootUnitId),
	);
	const flushText = () => {
		if (textBlocks.length === 0) return;
		const firstTextBlock = textBlocks[0];
		result.push({
			content: textBlocks.map((piece) => piece.content).join("\n\n"),
			...(firstTextBlock?.mergeBlockedBefore ? { mergeBlockedBefore: true } : {}),
			rootUnitIds: orderedUnique(textBlocks.flatMap((piece) => piece.rootUnitIds)),
		});
		textBlocks = [];
	};
	for (const [elementIndex, element] of contentElements.entries()) {
		if (element.kind === "table") {
			const context = buildTableContext(contentElements, elementIndex, element);
			const contextPrefixLength = context
				? unicodeLength(context.content) + unicodeLength("\n\n")
				: 0;
			const tableMaxChars = CHUNK_SET_DEFINITION.chunking.maxChars - contextPrefixLength;
			if (tableMaxChars < 1) {
				throw new Error(`Campus docs table context exceeds Unicode character limit: ${versionId}`);
			}
			const tableLimits: ChunkLimits = {
				maxChars: tableMaxChars,
				targetChars: Math.max(
					1,
					Math.min(
						tableMaxChars,
						CHUNK_SET_DEFINITION.chunking.targetChars - contextPrefixLength,
					),
				),
			};
			if (context) {
				const fullyCopiedRootUnitIds = new Set(context.fullyCopiedRootUnitIds);
				while (
					textBlocks.at(-1)?.rootUnitIds.length === 1 &&
					fullyCopiedRootUnitIds.has(textBlocks.at(-1)?.rootUnitIds[0] ?? "")
				) {
					textBlocks.pop();
				}
			}
			flushText();
			const tablePieces = attachTableContext(
				buildTablePieces(element, versionId, tableLimits),
				context,
			);
			if (tablePieces.length > 0) {
				const firstTablePiece = tablePieces[0];
				if (!firstTablePiece) throw new Error("Campus docs table produced no first piece");
				result.push(
					{ ...firstTablePiece, mergeBlockedBefore: true },
					...tablePieces.slice(1),
				);
			}
			mergeBlockedBeforeNextPiece = true;
			continue;
		}
		if (isProgramGraduationRequirementBoundary(element.text)) {
			flushText();
			mergeBlockedBeforeNextPiece = true;
		}
		for (const content of splitOversizedText(element.text, element.kind)) {
			const next = {
				content,
				...(mergeBlockedBeforeNextPiece ? { mergeBlockedBefore: true } : {}),
				rootUnitIds: [element.rootUnitId],
			};
			mergeBlockedBeforeNextPiece = false;
			const current = textBlocks.map((piece) => piece.content).join("\n\n");
			const combined = [...textBlocks, next].map((piece) => piece.content).join("\n\n");
			if (
				textBlocks.length > 0 &&
				(unicodeLength(current) >= CHUNK_SET_DEFINITION.chunking.targetChars ||
					unicodeLength(combined) > CHUNK_SET_DEFINITION.chunking.maxChars)
			) {
				flushText();
			}
			textBlocks.push(next);
		}
	}
	flushText();
	let pieces = result;
	if (sectionMetadata.length > 0 && pieces.length > 0) {
		pieces = attachLeadingMetadata(pieces, sectionMetadata, versionId);
	}
	pieces = mergeAdjacentShortPieces(pieces);
	for (const piece of pieces) assertChunkSize(piece.content, versionId);
	return pieces;
}

const SHORT_TAIL_MAX_CHARS = 200;

function attachLeadingMetadata(
	pieces: readonly ChunkPiece[],
	metadata: readonly ChunkPiece[],
	versionId: string,
): ChunkPiece[] {
	const first = pieces[0];
	if (!first) return [...pieces];
	const metadataContent = metadata.map((piece) => piece.content).join("\n\n");
	const prefix = `${metadataContent}\n\n`;
	const availableMax = CHUNK_SET_DEFINITION.chunking.maxChars - unicodeLength(prefix);
	if (availableMax < 1) {
		throw new Error(`Campus docs leading metadata leaves no room for content: ${versionId}`);
	}
	const metadataRootUnitIds = metadata.flatMap((piece) => piece.rootUnitIds);
	if (unicodeLength(`${prefix}${first.content}`) <= CHUNK_SET_DEFINITION.chunking.maxChars) {
		return [
			{
				...first,
				content: `${prefix}${first.content}`,
				rootUnitIds: orderedUnique([...metadataRootUnitIds, ...first.rootUnitIds]),
			},
			...pieces.slice(1),
		];
	}
	const bodyPieces = splitTextByLimits(
		first.content,
		"paragraph",
		Math.max(
			1,
			Math.min(availableMax, CHUNK_SET_DEFINITION.chunking.targetChars - unicodeLength(prefix)),
		),
		availableMax,
	);
	const firstBodyPiece = bodyPieces[0];
	if (!firstBodyPiece) {
		throw new Error(`Campus docs first content is not splittable after leading metadata: ${versionId}`);
	}
	return [
		{
			...first,
			content: `${prefix}${firstBodyPiece}`,
			rootUnitIds: orderedUnique([...metadataRootUnitIds, ...first.rootUnitIds]),
		},
		...bodyPieces.slice(1).map((content) => ({
			content,
			rootUnitIds: [...first.rootUnitIds],
		})),
		...pieces.slice(1),
	];
}

function mergeAdjacentShortPieces(pieces: readonly ChunkPiece[]): ChunkPiece[] {
	const result: ChunkPiece[] = [];
	for (const piece of pieces) {
		const previous = result.at(-1);
		if (!previous || piece.mergeBlockedBefore) {
			result.push(piece);
			continue;
		}
		const content = `${previous.content}\n\n${piece.content}`;
		if (
			(unicodeLength(previous.content) < SHORT_TAIL_MAX_CHARS ||
				unicodeLength(piece.content) < SHORT_TAIL_MAX_CHARS) &&
			unicodeLength(content) <= CHUNK_SET_DEFINITION.chunking.maxChars
		) {
			result[result.length - 1] = {
				...previous,
				content,
				rootUnitIds: orderedUnique([...previous.rootUnitIds, ...piece.rootUnitIds]),
			};
			continue;
		}
		result.push(piece);
	}
	return result;
}

export function isStandaloneDocumentMetadata(value: string): boolean {
	const lines = normalizeBlockText(value)
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.length > 0 && lines.every((line) => isApprovalDate(line) || isDocumentNumber(line));
}

export function getLeadingDocumentMetadata(reader: DocsReader): LeadingDocumentMetadata | null {
	const metadata: Array<{ content: string; rootUnitId: string }> = [];
	for (const element of reader.elements) {
		if (element.kind === "heading" || element.kind === "table") break;
		const content = normalizeBlockText(element.text);
		if (!content || isSourceUrlOnly(content)) continue;
		if (!isStandaloneDocumentMetadata(content)) break;
		metadata.push({ content, rootUnitId: element.rootUnitId });
	}
	if (metadata.length === 0) return null;
	return {
		content: metadata.map((item) => item.content).join("\n\n"),
		rootUnitIds: metadata.map((item) => item.rootUnitId),
	};
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

function isProgramGraduationRequirementBoundary(value: string): boolean {
	const normalized = normalizeBlockText(value);
	return /^(?:[\p{L}\p{N}（）()·、/／\- ]{1,64})专业毕业要求[：:]$/u.test(normalized);
}

function buildRetrievalText(
	documentTitle: string,
	headingPath: readonly string[],
	content: string,
): string {
	return [documentTitle, ...headingPath, content]
		.map(normalizeBlockText)
		.filter(Boolean)
		.join("\n");
}
