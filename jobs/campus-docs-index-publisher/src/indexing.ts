import { createHash } from "node:crypto";

import {
	buildReaderRouteSlug,
	canonicalJsonBytes,
	normalizeSourceManifest,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import { assertReaderExtractionQuality } from "../../../apps/campus-web/src/docs-reader-build/reader-quality.ts";
import { assertReaderSegmentationQuality } from "../../../apps/campus-web/src/docs-reader-build/reader-segmentation.ts";
import { parseReader, parseSourceManifest } from "../../../apps/campus-web/src/docs-reader-build/source-schema.ts";
import type {
	DocsReader,
	DocsReaderElement,
	DocsReaderTableCell,
	DocsReaderTableElement,
	DocsSourceManifest,
	DocsSourceVersion,
	ObjectRef,
} from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import type {
	CampusDocsPointPayload,
	CurrentIndexBinding,
	IndexChunk,
	IndexPoint,
	IndexingSource,
	ReaderSection,
	SourceVersionSelection,
	SparseVector,
} from "./types.ts";
import { INDEX_COLLECTION_PREFIX, INDEX_DEFINITION } from "./types.ts";

const MAX_TEXT_BYTES = 16_000;

export function parseIndexingSource(sourceBytes: Uint8Array): IndexingSource {
	const sourceValue = parseJson(sourceBytes, "campus docs source");
	const manifest = normalizeSourceManifest(parseSourceManifest(sourceValue));
	return { manifest, sourceBytes, sourceDigest: sha256(sourceBytes) };
}

export function selectCurrentVersions(source: DocsSourceManifest): SourceVersionSelection[] {
	const versions = new Map(source.versions.map((version) => [version.versionId, version]));
	const selected = source.documents.map((document) => {
		const version = versions.get(document.currentVersionId);
		if (!version || !version.isCurrent || version.docId !== document.docId) {
			throw new Error(`current Campus Web version is invalid: ${document.docId}`);
		}
		const readerRef = assertObjectRef(version.reader, `reader ${version.versionId}`);
		return { document, reader: undefined as unknown as DocsReader, readerRef, version };
	});
	if (selected.length === 0) {
		throw new Error("campus docs source has no documents");
	}
	return selected;
}

export async function loadCurrentVersions(input: {
	source: IndexingSource;
	readerStore: { read(key: string): Promise<Uint8Array> };
}): Promise<SourceVersionSelection[]> {
	const selected = selectCurrentVersions(input.source.manifest);
	for (const item of selected) {
		const bytes = await readVerifiedObject(input.readerStore, item.readerRef);
		item.reader = parseReader(parseJson(bytes, `reader ${item.version.versionId}`));
		assertReaderExtractionQuality(item.reader);
		assertReaderSegmentationQuality(item.reader);
		if (item.reader.docId !== item.document.docId || item.reader.versionId !== item.version.versionId) {
			throw new Error(`reader identity does not match source version: ${item.version.versionId}`);
		}
	}
	return selected;
}

export function buildSections(
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
	reader: DocsReader,
): ReaderSection[] {
	const sections: ReaderSection[] = [];
	let current: MutableSection | undefined;
	const preamble: MutableSection = {
		anchor: null,
		elements: [],
		headingPath: [],
	};
	const headingStack: Array<{ level: number; text: string }> = [];
	for (const element of reader.elements) {
		if (element.kind === "heading") {
			appendSection(sections, current, document, version);
			while ((headingStack.at(-1)?.level ?? 0) >= element.level) headingStack.pop();
			headingStack.push({ level: element.level, text: normalizeBlockText(element.text) });
			current = {
				anchor: element.anchor,
				elements: [],
				headingPath: headingStack.map((heading) => heading.text),
			};
			continue;
		}
		if (!indexableReaderElement(element)) continue;
		if (current) {
			current.elements.push(element);
		} else {
			preamble.elements.push(element);
		}
	}
	appendSection(sections, current, document, version);
	if (preamble.elements.length > 0) sections.unshift(finalizeSection(preamble, document, version));
	if (sections.length === 0) {
		throw new Error(`reader has no indexable content: ${version.versionId}`);
	}
	return sections;
}

export function buildChunks(input: {
	document: DocsSourceManifest["documents"][number];
	reader: DocsReader;
	version: DocsSourceVersion;
}): IndexChunk[] {
	const routeSlug = buildReaderRouteSlug(input.document);
	const canonicalUrl = `/docs/${input.document.corpus}/${input.document.collection}/${routeSlug}/v/${encodeURIComponent(input.version.versionSlug)}`;
	const sections = buildSections(input.document, input.version, input.reader);
	const chunks: IndexChunk[] = [];
	for (const section of sections) {
		const pieces = buildSectionPieces(section.elements, input.version.versionId);
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
				versionLabel: input.version.label,
				versionSlug: input.version.versionSlug,
			});
		}
	}
	return chunks;
}

export function buildCurrentIndexBinding(input: {
	embeddingSpaceId: string;
	selections: readonly SourceVersionSelection[];
}): CurrentIndexBinding {
	const canonical = canonicalJsonBytes({
		current_source: currentSourceProjection(input.selections),
		embedding_space_id: input.embeddingSpaceId,
		index_definition: INDEX_DEFINITION,
	});
	const digest = sha256TextBytes(canonical).slice("sha256:".length);
	return {
		collection: `${INDEX_COLLECTION_PREFIX}_${digest}`,
		dense_vector_name: INDEX_DEFINITION.embedding.vectorName,
		embedding_dimensions: INDEX_DEFINITION.embedding.dimensions,
		embedding_model: INDEX_DEFINITION.embedding.model,
		embedding_provider: INDEX_DEFINITION.embedding.provider,
		embedding_query_instruction: INDEX_DEFINITION.embedding.queryInstruction,
		embedding_space_id: input.embeddingSpaceId,
		sparse_model: INDEX_DEFINITION.sparse.model,
		sparse_vector_name: INDEX_DEFINITION.sparse.vectorName,
	};
}

/**
 * Project only the current documents and reader objects that can affect
 * indexed chunks. Historical versions, redirects, topic descriptions and
 * manifest formatting are intentionally outside the collection identity.
 */
function currentSourceProjection(
	selections: readonly SourceVersionSelection[],
): Array<Record<string, unknown>> {
	return selections
		.map((item) => ({
			collection: item.document.collection,
			corpus: item.document.corpus,
			doc_id: item.document.docId,
			document_slug: item.document.documentSlug,
			reader: item.readerRef,
			title: item.document.title,
			version_id: item.version.versionId,
			version_label: item.version.label,
			version_slug: item.version.versionSlug,
		}))
		.sort((left, right) => String(left.doc_id).localeCompare(String(right.doc_id)));
}

export function buildPoint(input: {
	chunk: IndexChunk;
	dense: number[];
}): IndexPoint {
	const textSha = sha256Text(input.chunk.content);
	const retrievalTextSha = sha256Text(input.chunk.retrievalText);
	const payload: CampusDocsPointPayload = {
		chunk_id: input.chunk.chunkId,
		document_id: input.chunk.documentId,
		document_title: input.chunk.documentTitle,
		retrieval_text_sha256: retrievalTextSha,
		root_unit_ids: input.chunk.rootUnitIds,
		schema_version: INDEX_DEFINITION.pointSchemaVersion,
		section_ref: input.chunk.sectionRef,
		section_title: input.chunk.sectionTitle,
		text: input.chunk.content,
		text_sha256: textSha,
		version_id: input.chunk.versionId,
		version_label: input.chunk.versionLabel,
		version_slug: input.chunk.versionSlug,
	};
	return {
		id: buildPointId(input.chunk),
		payload,
		vector: {
			dense: input.dense,
			sparse: buildSparseVector(input.chunk.retrievalText),
		},
	};
}

export function buildPointId(chunk: IndexChunk): string {
	return stableUuid([INDEX_DEFINITION.pointSchemaVersion, chunk.chunkId]);
}

export function buildSparseVector(text: string): SparseVector {
	const counts = new Map<number, number>();
	for (const token of tokenize(text)) {
		const normalized = token.text.toLocaleLowerCase("und");
		if (!/[\p{L}\p{N}\p{Script=Han}]/u.test(normalized)) {
			continue;
		}
		const index = fnv1a(normalized);
		counts.set(index, (counts.get(index) ?? 0) + 1);
	}
	const indices = [...counts.keys()].sort((left, right) => left - right);
	return {
		indices,
		values: indices.map((index) => Math.log1p(counts.get(index) ?? 0)),
	};
}

export function sha256Text(value: string): `sha256:${string}` {
	return sha256TextBytes(new TextEncoder().encode(value));
}

function sha256TextBytes(value: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeBlockText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

type ReaderContentElement = Exclude<DocsReaderElement, { kind: "heading" }>;

interface MutableSection {
	anchor: string | null;
	elements: ReaderContentElement[];
	headingPath: string[];
}

interface ChunkPiece {
	content: string;
	rootUnitIds: string[];
}

interface LogicalTableCell {
	columnSpan: number;
	header: boolean;
	id: number;
	originColumn: number;
	originRow: number;
	rowSpan: number;
	text: string;
}

interface LogicalTableValue {
	columns: number[];
	text: string;
}

function appendSection(
	sections: ReaderSection[],
	section: MutableSection | undefined,
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
): void {
	if (section && section.elements.length > 0) {
		sections.push(finalizeSection(section, document, version));
	}
}

function finalizeSection(
	section: MutableSection,
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
): ReaderSection {
	const sectionTitle = section.headingPath.join(" > ") || document.title;
	return {
		anchor: section.anchor,
		elements: [...section.elements],
		headingPath: [...section.headingPath],
		sectionId: stableId("section", [
			document.docId,
			version.versionId,
			section.anchor ?? "",
			...section.headingPath,
		]),
		sectionTitle,
	};
}

function indexableReaderElement(element: ReaderContentElement): boolean {
	if (element.kind !== "table") return normalizeBlockText(element.text) !== "";
	return element.rows.some((row) => row.some((cell) => normalizeBlockText(cell.text) !== ""));
}

function buildSectionPieces(
	elements: readonly ReaderContentElement[],
	versionId: string,
): ChunkPiece[] {
	const result: ChunkPiece[] = [];
	let textBlocks: ChunkPiece[] = [];
	const flushText = () => {
		if (textBlocks.length === 0) return;
		result.push({
			content: textBlocks.map((piece) => piece.content).join("\n\n"),
			rootUnitIds: orderedUnique(textBlocks.flatMap((piece) => piece.rootUnitIds)),
		});
		textBlocks = [];
	};
	for (const element of elements) {
		if (element.kind === "table") {
			flushText();
			result.push(...buildTablePieces(element, versionId));
			continue;
		}
		for (const content of splitOversizedText(element.text, element.kind)) {
			const next = { content, rootUnitIds: [element.rootUnitId] };
			const current = textBlocks.map((piece) => piece.content).join("\n\n");
			const combined = [...textBlocks, next].map((piece) => piece.content).join("\n\n");
			if (
				textBlocks.length > 0 &&
				(unicodeLength(current) >= INDEX_DEFINITION.chunking.targetChars ||
					unicodeLength(combined) > INDEX_DEFINITION.chunking.maxChars)
			) {
				flushText();
			}
			textBlocks.push(next);
		}
	}
	flushText();
	for (const piece of result) assertChunkSize(piece.content, versionId);
	return result;
}

function splitOversizedText(
	value: string,
	kind: "blockquote" | "list" | "paragraph" = "paragraph",
): string[] {
	return splitTextByLimits(
		value,
		kind,
		INDEX_DEFINITION.chunking.targetChars,
		INDEX_DEFINITION.chunking.maxChars,
	);
}

function splitTextByLimits(
	value: string,
	kind: "blockquote" | "list" | "paragraph",
	targetChars: number,
	maxChars: number,
): string[] {
	let remaining = normalizeBlockText(value);
	if (!remaining) return [];
	const result: string[] = [];
	while (unicodeLength(remaining) > maxChars) {
		const characters = [...remaining];
		const cut = textSplitIndex(characters, kind, targetChars, maxChars);
		const piece = normalizeBlockText(characters.slice(0, cut).join(""));
		if (piece) result.push(piece);
		remaining = normalizeBlockText(characters.slice(cut).join(""));
	}
	if (remaining) result.push(remaining);
	return result;
}

function textSplitIndex(
	characters: readonly string[],
	kind: "blockquote" | "list" | "paragraph",
	targetChars: number,
	maxChars: number,
): number {
	const max = Math.min(Math.max(1, maxChars), characters.length);
	const target = Math.min(Math.max(1, targetChars), max);
	const predicates: Array<(index: number) => boolean> = [
		(index) => characters[index - 2] === "\n" && characters[index - 1] === "\n",
		(index) => kind === "list" && characters[index - 1] === "\n",
		(index) => sentenceBoundaryAt(characters, index),
		(index) => clauseBoundaryAt(characters, index),
	];
	for (const predicate of predicates) {
		for (let index = target; index <= max; index += 1) {
			if (predicate(index)) return index;
		}
		for (let index = target - 1; index >= Math.max(1, Math.floor(target / 2)); index -= 1) {
			if (predicate(index)) return index;
		}
	}
	return max;
}

function sentenceBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!/[。！？.!?]/u.test(punctuation)) return false;
	if (punctuation !== ".") return true;
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	if (next === ".") return false;
	return !(unicodeLetterOrNumber(previous) && unicodeLetterOrNumber(next));
}

function clauseBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!/[；;，,、：:]/u.test(punctuation)) return false;
	if (punctuation !== "," && punctuation !== ":") return true;
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	return !(unicodeNumber(previous) && unicodeNumber(next));
}

function unicodeLetterOrNumber(value: string): boolean {
	return /^[\p{L}\p{N}]$/u.test(value);
}

function unicodeNumber(value: string): boolean {
	return /^\p{N}$/u.test(value);
}

function buildTablePieces(table: DocsReaderTableElement, versionId: string): ChunkPiece[] {
	const logicalRows = logicalTableGrid(table.rows);
	if (logicalRows.length === 0) return [];
	let leadingHeaderCount = 0;
	while (leadingHeaderCount < logicalRows.length && logicalHeaderRow(logicalRows[leadingHeaderCount] ?? [])) {
		leadingHeaderCount += 1;
	}
	let rows: string[];
	if (leadingHeaderCount === logicalRows.length) {
		rows = table.rows.flatMap((row) => serializePhysicalTableRow(row, versionId));
	} else {
		const bodyRows = logicalRows.slice(leadingHeaderCount);
		const columnPaths = tableColumnPaths(logicalRows, leadingHeaderCount);
		rows = [
			...serializeUnusedTableHeaders(bodyRows, columnPaths, versionId),
			...bodyRows.flatMap((row) => serializeLogicalTableRow(row, columnPaths, versionId)),
		];
	}
	const grouped = groupTableRows(rows, versionId);
	return grouped.map((content) => ({ content, rootUnitIds: [table.rootUnitId] }));
}

function logicalTableGrid(rows: readonly DocsReaderTableCell[][]): Array<Array<LogicalTableCell | undefined>> {
	const grid: Array<Array<LogicalTableCell | undefined>> = [];
	let cellId = 0;
	for (const [rowIndex, row] of rows.entries()) {
		grid[rowIndex] ??= [];
		let columnIndex = 0;
		for (const cell of row) {
			while (grid[rowIndex]?.[columnIndex] !== undefined) columnIndex += 1;
			const rowSpan = cell.rowSpan ?? 1;
			const columnSpan = cell.colSpan ?? 1;
			const logicalCell = {
				columnSpan,
				header: cell.header,
				id: cellId,
				originColumn: columnIndex,
				originRow: rowIndex,
				rowSpan,
				text: normalizeBlockText(cell.text),
			};
			cellId += 1;
			for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
				const targetRowIndex = rowIndex + rowOffset;
				grid[targetRowIndex] ??= [];
				for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
					const targetColumnIndex = columnIndex + columnOffset;
					if (grid[targetRowIndex]?.[targetColumnIndex] !== undefined) {
						throw new Error(`Campus docs table spans overlap at row ${rowIndex + 1}`);
					}
					(grid[targetRowIndex] as Array<LogicalTableCell | undefined>)[targetColumnIndex] = logicalCell;
				}
			}
			columnIndex += columnSpan;
		}
	}
	const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
	return grid.map((row) => Array.from({ length: width }, (_, index) => row[index]));
}

function logicalHeaderRow(row: readonly (LogicalTableCell | undefined)[]): boolean {
	const cells = row.filter((cell): cell is LogicalTableCell => cell !== undefined);
	return cells.length > 0 && cells.every((cell) => cell.header);
}

function tableColumnPaths(
	rows: readonly (readonly (LogicalTableCell | undefined)[])[],
	headerCount: number,
): string[][] {
	const width = rows[0]?.length ?? 0;
	return Array.from({ length: width }, (_, columnIndex) => {
		return orderedUnique(
			rows
				.slice(0, headerCount)
				.map((row) => row[columnIndex]?.text ?? "")
				.filter(Boolean),
		);
	});
}

function serializeLogicalTableRow(
	row: readonly (LogicalTableCell | undefined)[],
	columnPaths: readonly (readonly string[])[],
	versionId: string,
): string[] {
	const fields = logicalTableValues(row).flatMap((value) => {
		const label = compactColumnLabel(value.columns, columnPaths);
		return serializeTableValue(value.text, label, versionId);
	});
	return groupTableFields(fields, versionId);
}

function serializeUnusedTableHeaders(
	rows: readonly (readonly (LogicalTableCell | undefined)[])[],
	columnPaths: readonly (readonly string[])[],
	versionId: string,
): string[] {
	const usedColumns = new Set(
		rows.flatMap((row) => logicalTableValues(row).flatMap((value) => value.columns)),
	);
	const unusedColumns = columnPaths.flatMap((path, columnIndex) =>
		path.length > 0 && !usedColumns.has(columnIndex) ? [columnIndex] : [],
	);
	if (unusedColumns.length === 0) return [];
	const label = compactColumnLabel(unusedColumns, columnPaths);
	return groupTableFields(serializeTableValue(label, "", versionId), versionId);
}

function serializePhysicalTableRow(
	row: readonly DocsReaderTableCell[],
	versionId: string,
): string[] {
	const values: LogicalTableValue[] = [];
	let columnIndex = 0;
	for (const cell of row) {
		const columnSpan = cell.colSpan ?? 1;
		const text = normalizeBlockText(cell.text);
		if (text) {
			appendLogicalTableValue(values, {
				columns: Array.from({ length: columnSpan }, (_, offset) => columnIndex + offset),
				text,
			});
		}
		columnIndex += columnSpan;
	}
	return groupTableFields(
		values.flatMap((value) => serializeTableValue(value.text, "", versionId)),
		versionId,
	);
}

function logicalTableValues(
	row: readonly (LogicalTableCell | undefined)[],
): LogicalTableValue[] {
	const values: LogicalTableValue[] = [];
	const emitted = new Set<number>();
	for (const [columnIndex, cell] of row.entries()) {
		if (!cell || emitted.has(cell.id)) continue;
		emitted.add(cell.id);
		if (!cell.text) continue;
		const columns: number[] = [];
		for (let coveredColumn = columnIndex; coveredColumn < row.length; coveredColumn += 1) {
			if (row[coveredColumn]?.id === cell.id) columns.push(coveredColumn);
		}
		appendLogicalTableValue(values, { columns, text: cell.text });
	}
	return values;
}

function appendLogicalTableValue(
	values: LogicalTableValue[],
	value: LogicalTableValue,
): void {
	const previous = values.at(-1);
	if (
		previous &&
		previous.text === value.text &&
		(previous.columns.at(-1) ?? -1) + 1 === value.columns[0]
	) {
		previous.columns.push(...value.columns);
		return;
	}
	values.push(value);
}

function compactColumnLabel(
	columns: readonly number[],
	columnPaths: readonly (readonly string[])[],
): string {
	const paths = orderedUniqueBy(
		columns
			.map((column) => columnPaths[column] ?? [])
			.filter((path) => path.length > 0),
		(path) => path.join("\u0000"),
	);
	if (paths.length === 0) return "";
	if (paths.length === 1) return (paths[0] ?? []).join(" / ");
	let commonLength = 0;
	while (
		paths.every((path) => path[commonLength] !== undefined && path[commonLength] === paths[0]?.[commonLength])
	) {
		commonLength += 1;
	}
	if (commonLength === 0 || paths.some((path) => path.length === commonLength)) {
		return paths.map((path) => path.join(" / ")).join("、");
	}
	const prefix = (paths[0] ?? []).slice(0, commonLength).join(" / ");
	const suffixes = paths.map((path) => path.slice(commonLength).join(" / "));
	return `${prefix} / ${suffixes.join("、")}`;
}

function serializeTableValue(text: string, label: string, versionId: string): string[] {
	const prefix = label ? `${label}：` : "";
	const availableMax = INDEX_DEFINITION.chunking.maxChars - unicodeLength(prefix);
	if (availableMax < 1) {
		throw new Error(`Campus docs table column name exceeds Unicode character limit: ${versionId}`);
	}
	const availableTarget = Math.max(
		1,
		Math.min(availableMax, INDEX_DEFINITION.chunking.targetChars - unicodeLength(prefix)),
	);
	return splitTextByLimits(text, "paragraph", availableTarget, availableMax)
		.map((value) => `${prefix}${value}`);
}

function groupTableFields(fields: readonly string[], versionId: string): string[] {
	const result: string[] = [];
	let current: string[] = [];
	for (const field of fields) {
		const currentText = current.join("；");
		const candidate = [...current, field].join("；");
		if (current.length > 0 && unicodeLength(candidate) > INDEX_DEFINITION.chunking.maxChars) {
			result.push(currentText);
			current = [field];
		} else {
			current.push(field);
		}
		assertChunkSize(current.join("；"), versionId);
	}
	if (current.length > 0) result.push(current.join("；"));
	return result;
}

function groupTableRows(rows: readonly string[], versionId: string): string[] {
	const result: string[] = [];
	let current: string[] = [];
	for (const row of rows) {
		const currentText = current.join("\n");
		const candidate = [...current, row].join("\n");
		if (
			current.length > 0 &&
			(unicodeLength(currentText) >= INDEX_DEFINITION.chunking.targetChars ||
				unicodeLength(candidate) > INDEX_DEFINITION.chunking.maxChars)
		) {
			result.push(currentText);
			current = [row];
		} else {
			current.push(row);
		}
		assertChunkSize(current.join("\n"), versionId);
	}
	if (current.length > 0) result.push(current.join("\n"));
	return result;
}

function buildRetrievalText(documentTitle: string, headingPath: readonly string[], content: string): string {
	return [documentTitle, ...headingPath, content]
		.map(normalizeBlockText)
		.filter(Boolean)
		.join("\n");
}

function assertChunkSize(content: string, versionId: string): void {
	if (unicodeLength(content) > INDEX_DEFINITION.chunking.maxChars) {
		throw new Error(`Campus docs chunk exceeds Unicode character limit: ${versionId}`);
	}
	if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
		throw new Error(`Campus docs chunk exceeds byte limit: ${versionId}`);
	}
}

function unicodeLength(value: string): number {
	return [...value].length;
}

function orderedUnique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function orderedUniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const itemKey = key(value);
		if (seen.has(itemKey)) return false;
		seen.add(itemKey);
		return true;
	});
}

interface TokenPiece {
	text: string;
}

function tokenize(value: string): TokenPiece[] {
	const pieces: TokenPiece[] = [];
	for (const match of value.matchAll(/[\p{Script=Han}]|[\p{L}\p{N}_]+|[^\s]/gu)) {
		const token = match[0];
		if (token) pieces.push({ text: token });
	}
	return pieces;
}

function stableId(prefix: string, values: readonly string[]): string {
	const digest = createHash("sha256").update(values.join("\u0000")).digest("hex");
	return `${prefix}_${digest.slice(0, 40)}`;
}

function stableUuid(values: readonly string[]): string {
	const digest = createHash("sha256").update(values.join("\u0000")).digest("hex");
	const variant = ((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function fnv1a(value: string): number {
	let hash = 2166136261;
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= byte;
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash & 0x7fffffff;
}

async function readVerifiedObject(
	store: { read(key: string): Promise<Uint8Array> },
	ref: ObjectRef,
): Promise<Uint8Array> {
	const bytes = await store.read(ref.key);
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`object byteSize mismatch: ${ref.key}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new Error(`object sha256 mismatch: ${ref.key}`);
	}
	return bytes;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function assertObjectRef(value: ObjectRef, label: string): ObjectRef {
	if (
		!value.key.trim() ||
		!Number.isSafeInteger(value.byteSize) ||
		value.byteSize < 1 ||
		!/^sha256:[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} object identity is invalid`);
	}
	return value;
}
