import {
	MAX_HEADING_CHARS,
	NOTICE_CHUNK_DEFINITION,
	TINY_CHUNK_CHARS,
	type NoticeChunkDefinition,
} from "./definitions.ts";
import { canonicalJsonBytes, sha256, unicodeLength } from "./encoding.ts";
import type {
	BuiltNoticeChunk,
	BuiltNoticeChunks,
	ChunkPart,
	DetectedHeading,
	NoticeChunkStats,
	NoticeSource,
	SourceRange,
} from "./types.ts";

const PRIMARY_HEADING =
	/^(?:[一二三四五六七八九十百]+\s*[、.．]|第[一二三四五六七八九十百0-9]+(?:章|节|部分))\s*\S.*$/u;
const SECONDARY_HEADING = /^[（(][一二三四五六七八九十百]+[）)]\s*\S.*$/u;
const SENTENCE_END = /[。！？!?]/u;
const CLAUSE_END = /[；;，,、：:]/u;

interface SourceLine extends SourceRange {
	index: number;
	text: string;
}

interface SemanticUnit {
	atomic: boolean;
	bodyLines: SourceLine[];
	compositionKey: string;
	hardSectionId: number;
	headingPath: string[];
	joinSeparator?: "\n" | "\n\n";
	kind: SemanticUnitKind;
	unitId: number;
	protectedTailLineCount: number;
	retrievalHeadingPath?: string[];
}

interface TextBlock {
	range: SourceRange;
}

interface UnitPiece extends ChunkPart {
	atomic: boolean;
	compositionKey: string;
	hardSectionId: number;
	kind: SemanticUnitKind;
	unitId: number;
	joinSeparator: "\n" | "\n\n";
	wholeUnit: boolean;
}

interface BodySegment {
	bodyLines: SourceLine[];
	hardSectionId: number;
	headingPath: string[];
}

interface TableRegion {
	endIndex: number;
	headerStartIndex: number;
	firstRowIndex: number;
	compositionKey: string;
	rows: TableRow[];
	retrievalHeadingPath: string[];
}

interface TableRow {
	endIndex: number;
	startIndex: number;
}

type SplitReason = "clause" | "hard" | "sentence";
type SemanticUnitKind =
	| "field"
	| "footer"
	| "list-item"
	| "record"
	| "table-header"
	| "table-row"
	| "text";

export function buildNoticeChunks(
	source: NoticeSource,
	definition: NoticeChunkDefinition = NOTICE_CHUNK_DEFINITION,
): BuiltNoticeChunks {
	if (!(source.noticeId && source.title) || source.contentText.length === 0) {
		throw new Error(`notice chunk source is invalid: ${source.noticeId || "unknown"}`);
	}
	const sourceSha256 = sha256(canonicalJsonBytes(source));
	const lines = parseSourceLines(source.contentText);
	const headings = detectHeadings(lines);
	const stats: NoticeChunkStats = {
		clauseSplitCount: 0,
		hardCutCount: 0,
		primaryHeadingCount: headings.filter((heading) => heading.level === 1).length,
		secondaryHeadingCount: headings.filter((heading) => heading.level === 2).length,
		sentenceSplitCount: 0,
		tableRowSplitCount: 0,
	};
	const units = buildSemanticUnits(lines, headings, source.contentText, definition);
	const pieces = units.flatMap((unit) =>
		buildUnitPieces(source.contentText, unit, stats, definition),
	);
	const chunks = combinePieces(source, sourceSha256, pieces, definition);
	if (chunks.length === 0) {
		throw new Error(`notice produced no chunks: ${source.noticeId}`);
	}
	return { chunks, definition, headings, source, sourceSha256, stats };
}

function parseSourceLines(value: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let start = 0;
	let index = 0;
	while (start <= value.length) {
		const newline = value.indexOf("\n", start);
		const end = newline === -1 ? value.length : newline;
		lines.push({ end, index, start, text: value.slice(start, end) });
		index += 1;
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return lines;
}

function detectHeadings(lines: readonly SourceLine[]): DetectedHeading[] {
	const candidates = lines.flatMap((line, index) => {
		const level = headingLevel(line.text) ??
			(isPunctuatedPrimaryHeading(lines, index) ? 1 : null);
		return level === null
			? []
			: [{ level, lineIndex: line.index, range: rangeOf(line), text: line.text.trim() }];
	});
	const candidateByLine = new Map(candidates.map((candidate) => [candidate.lineIndex, candidate]));
	return candidates.filter((candidate) => {
		let boundary = lines.length;
		for (const later of candidates) {
			if (later.lineIndex > candidate.lineIndex && later.level <= candidate.level) {
				boundary = later.lineIndex;
				break;
			}
		}
		for (let lineIndex = candidate.lineIndex + 1; lineIndex < boundary; lineIndex += 1) {
			const nested = candidateByLine.get(lineIndex);
			if (nested && nested.level > candidate.level) {
				return true;
			}
			const line = lines[lineIndex];
			if (
				line &&
				!nested &&
				line.text.length > 0 &&
				!isTrailingHeadingFooter(lines, lineIndex)
			) {
				return true;
			}
		}
		return false;
	});
}

function isPunctuatedPrimaryHeading(
	lines: readonly SourceLine[],
	index: number,
): boolean {
	const text = lines[index]?.text.trim() ?? "";
	if (!/。$/u.test(text)) return false;
	const match = text.match(
		/^(?:[一二三四五六七八九十百]+\s*[、.．]|第[一二三四五六七八九十百0-9]+(?:章|节|部分))\s*(\S.*)$/u,
	);
	const title = match?.[1]?.slice(0, -1).trim() ?? "";
	if (
		!title ||
		unicodeLength(title) > 20 ||
		/[，,：:。！？!?；;]/u.test(title) ||
		/^(?:请|须|应|需|必须|不得|禁止|凡|所有|逾期)/u.test(title)
	) {
		return false;
	}
	for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
		const next = lines[cursor]?.text.trim() ?? "";
		if (!next) continue;
		return (
			/^[（(][一二三四五六七八九十百]+[）)]\s*\S/u.test(next) ||
			listMarkerLevel(next) !== null
		);
	}
	return false;
}

function isTrailingHeadingFooter(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return isSignatureLine(text) || isClosingStart(lines, index) || isFooterLine(lines, index);
}

function headingLevel(value: string): 1 | 2 | null {
	const text = value.trim();
	if (!text || unicodeLength(text) > MAX_HEADING_CHARS || /[。！？!?；;]$/u.test(text)) {
		return null;
	}
	if (PRIMARY_HEADING.test(text)) {
		return 1;
	}
	if (SECONDARY_HEADING.test(text) && isSecondaryHeadingCandidate(text)) {
		return 2;
	}
	return null;
}

function isSecondaryHeadingCandidate(value: string): boolean {
	const match = value.trim().match(/^[（(][一二三四五六七八九十百]+[）)]\s*(.*)$/u);
	const body = match?.[1]?.trim() ?? "";
	if (!body) return false;

	const colonIndex = body.search(/[：:]/u);
	if (colonIndex >= 0 && body.slice(colonIndex + 1).trim().length > 0) {
		return false;
	}
	if (/[。！？!?；;…]/u.test(body) || /[，,]/u.test(body)) {
		return false;
	}
	return !/(?:^(?:请|须|应|需|必须|不得|禁止|凡|所有)|均为|只能|不允许|请于|须于|应于|需于|要在|负责|提交|填写|登录|扫描|报送)/u.test(
		body,
	);
}

function buildSemanticUnits(
	lines: readonly SourceLine[],
	headings: readonly DetectedHeading[],
	sourceText: string,
	definition: NoticeChunkDefinition,
): SemanticUnit[] {
	const headingByLine = new Map(headings.map((heading) => [heading.lineIndex, heading]));
	const segments: BodySegment[] = [];
	let bodyLines: SourceLine[] = [];
	let hardSectionId = 0;
	let headingPath: string[] = [];
	let primaryHeading: DetectedHeading | undefined;
	const flush = () => {
		if (bodyLines.some((line) => line.text.length > 0)) {
			segments.push({ bodyLines, hardSectionId, headingPath: [...headingPath] });
		}
		bodyLines = [];
	};

	for (const line of lines) {
		const heading = headingByLine.get(line.index);
		if (!heading) {
			bodyLines.push(line);
			continue;
		}
		flush();
		if (heading.level === 1) {
			hardSectionId += 1;
			primaryHeading = heading;
			headingPath = [heading.text];
		} else {
			headingPath = primaryHeading ? [primaryHeading.text, heading.text] : [heading.text];
		}
	}
	flush();
	return segments.flatMap((segment) =>
		buildSegmentUnits(segment, sourceText, definition),
	);
}

function buildSegmentUnits(
	segment: BodySegment,
	sourceText: string,
	definition: NoticeChunkDefinition,
): SemanticUnit[] {
	const lines = segment.bodyLines.filter((line) => line.text.length > 0);
	if (lines.length === 0) return [];
	const tables = detectTableRegions(lines, segment.headingPath);
	const tableByHeader = new Map(tables.map((table) => [table.headerStartIndex, table]));
	const units: SemanticUnit[] = [];
	let unitId = 0;
	let index = 0;
	let pendingImageCaptions: SourceLine[] = [];

	const append = (unit: Omit<SemanticUnit, "unitId">) => {
		const bodyLines =
			pendingImageCaptions.length > 0
				? [...pendingImageCaptions, ...unit.bodyLines]
				: unit.bodyLines;
		pendingImageCaptions = [];
		units.push({ ...unit, bodyLines, unitId });
		unitId += 1;
	};

	while (index < lines.length) {
		const line = lines[index];
		if (!line) break;

		const table = tableByHeader.get(index);
		if (table) {
			appendTableUnits(append, table, lines, sourceText, segment, definition);
			index = table.endIndex;
			continue;
		}

		if (isRecordStart(line.text)) {
			const end = findNextRecordStart(lines, index + 1, tables);
			for (const unit of buildRecordUnits(
				lines.slice(index, end),
				segment.headingPath,
				segment.hardSectionId,
			)) {
				append(unit);
			}
			index = end;
			continue;
		}

		if (isSignatureLine(line.text) || isClosingStart(lines, index)) {
			const previous = units.at(-1);
			if (previous && (previous.kind === "table-header" || previous.kind === "table-row")) {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous.compositionKey,
					hardSectionId: previous.hardSectionId,
					headingPath: [...previous.headingPath],
					joinSeparator: "\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			} else if (previous) {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: contextKey(segment.headingPath, ["tail"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (isFooterLine(lines, index)) {
			const previous = units.at(-1);
			if (previous && previous.kind !== "table-header" && previous.kind !== "table-row") {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous?.compositionKey ?? sectionCompositionKey(segment.headingPath),
					hardSectionId: previous?.hardSectionId ?? segment.hardSectionId,
					headingPath: [...(previous?.headingPath ?? segment.headingPath)],
					joinSeparator: "\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (isImageCaptionLine(line.text)) {
			const previous = units.at(-1);
			if (previous && previous.kind !== "table-header" && previous.kind !== "table-row") {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else if (previous) {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous.compositionKey,
					hardSectionId: previous.hardSectionId,
					headingPath: [...previous.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 1,
				});
			} else {
				pendingImageCaptions.push(line);
			}
			index += 1;
			continue;
		}

		if (isUrlLine(line.text)) {
			const previous = units.at(-1);
			if (previous) {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: sectionCompositionKey(segment.headingPath),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (isTopicLead(line.text)) {
			const end = findNextBoundary(lines, index + 1, tables);
			append({
				atomic: false,
				bodyLines: lines.slice(index, end),
				compositionKey: contextKey(segment.headingPath, [contextLabel(line.text)]),
				hardSectionId: segment.hardSectionId,
				headingPath: [...segment.headingPath],
				joinSeparator: "\n\n",
				kind: "text",
				protectedTailLineCount: 0,
			});
			index = end;
			continue;
		}

		if (isFieldGroupStart(lines, index)) {
			const end = findFieldGroupBoundary(
				lines,
				index + 1,
				tables,
			);
			for (const unit of buildFieldGroupUnits(lines.slice(index, end), {
				basePath: segment.headingPath,
				compositionKey: contextKey(segment.headingPath, ["field-group"]),
				hardSectionId: segment.hardSectionId,
			})) {
				append(unit);
			}
			index = end;
			continue;
		}

		if (isIndependentBracketListStart(lines, index)) {
			const end = findListRunBoundary(lines, index, tables, 2);
			const listLines = lines.slice(index, end);
			if (isSequentialList(listLines, segment.headingPath)) {
				append({
					atomic: false,
					bodyLines: listLines,
					compositionKey: contextKey(segment.headingPath, ["list-sequence"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 0,
				});
			} else {
				appendIndependentListUnits(append, lines, index, end, tables, {
					basePath: segment.headingPath,
					hardSectionId: segment.hardSectionId,
					listLevel: 2,
				});
			}
			index = end;
			continue;
		}

		if (isTopLevelListItemStart(line.text)) {
			const end = findListRunBoundary(lines, index, tables, 1);
			const listLines = lines.slice(index, end);
			if (isSequentialList(listLines, segment.headingPath)) {
				append({
					atomic: false,
					bodyLines: listLines,
					compositionKey: contextKey(segment.headingPath, ["list-sequence"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 0,
				});
			} else {
				appendIndependentListUnits(append, lines, index, end, tables, {
					basePath: segment.headingPath,
					hardSectionId: segment.hardSectionId,
					listLevel: 1,
				});
			}
			index = end;
			continue;
		}

		const end = findNextBoundary(lines, index + 1, tables);
		const textLines = lines.slice(index, end);
		append({
			atomic: false,
			bodyLines: textLines,
			compositionKey: sectionCompositionKey(segment.headingPath),
			hardSectionId: segment.hardSectionId,
			headingPath: segment.headingPath,
			kind: "text",
			protectedTailLineCount: 0,
		});
		index = end;
	}
	if (pendingImageCaptions.length > 0) {
		const trailingImageCaptions = pendingImageCaptions;
		pendingImageCaptions = [];
		append({
			atomic: true,
			bodyLines: trailingImageCaptions,
			compositionKey: sectionCompositionKey(segment.headingPath),
			hardSectionId: segment.hardSectionId,
			headingPath: [...segment.headingPath],
			joinSeparator: "\n",
			kind: "text",
			protectedTailLineCount: trailingImageCaptions.length,
		});
	}

	return units;
}

function buildFieldGroupUnits(
	lines: readonly SourceLine[],
	input: {
		basePath: readonly string[];
		compositionKey: string;
		hardSectionId: number;
	},
): Array<Omit<SemanticUnit, "unitId">> {
	const fieldGroups: SourceLine[][] = [];
	let current: SourceLine[] = [];
	let hasValue = false;
	const flush = () => {
		if (current.length > 0) fieldGroups.push(current);
		current = [];
		hasValue = false;
	};

	for (const [index, line] of lines.entries()) {
		const inlineField = isInlineLabelLead(line.text);
		const labelOnly = isLabelOnly(line.text) || isLocalLabel(lines, index);
		const blankBefore = hasBlankLineBetween(lines[index - 1], line);
		if (current.length > 0 && inlineField && hasValue) {
			flush();
		} else if (current.length > 0 && labelOnly && hasValue && blankBefore) {
			flush();
		}
		current.push(line);
		if (inlineField || isUrlLine(line.text) || (isTopLevelListItemStart(line.text) && !labelOnly) || !labelOnly) {
			hasValue = true;
		}
	}
	flush();

	return fieldGroups.flatMap((fieldLines) =>
			splitFieldGroupUnits(fieldLines, {
			basePath: [...input.basePath],
			compositionKey: input.compositionKey,
			hardSectionId: input.hardSectionId,
		}),
	);
}

function splitFieldGroupUnits(
	lines: readonly SourceLine[],
	input: {
		basePath: string[];
		compositionKey: string;
		hardSectionId: number;
	},
): Array<Omit<SemanticUnit, "unitId">> {
	const listLevel = siblingListLevel(lines);
	const markerIndexes = lines
		.map((line, index) =>
			listLevel !== null && listMarkerLevel(line.text) === listLevel ? index : -1,
		)
		.filter((index) => index >= 0);
	const starts = markerIndexes.slice(1);
	const listContext =
		listLevel === null
			? undefined
			: lines
					.slice(0, markerIndexes[0] ?? 0)
						.map((line) => line.text.trim())
						.filter(Boolean)
						.join(" ");
	const firstMarkerIndex = markerIndexes[0];
	if (listLevel !== null && firstMarkerIndex !== undefined && firstMarkerIndex > 0) {
		return [
			{
				atomic: true,
				bodyLines: [...lines],
				compositionKey: input.compositionKey,
				hardSectionId: input.hardSectionId,
				headingPath: [...input.basePath],
				joinSeparator: "\n",
				kind: "field",
				protectedTailLineCount: 0,
			},
		];
	}
	const boundaries = [0, ...starts, lines.length];
	if (
		listLevel !== null &&
		starts.length > 0 &&
		isSequentialList(lines, input.basePath)
	) {
		return [
			{
				atomic: false,
				bodyLines: [...lines],
				compositionKey: contextKey(input.basePath, ["list-sequence"]),
				hardSectionId: input.hardSectionId,
				headingPath: [...input.basePath],
				joinSeparator: "\n",
				kind: "text",
				protectedTailLineCount: 0,
			},
		];
	}
	const units: Array<Omit<SemanticUnit, "unitId">> = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? lines.length;
		const bodyLines = lines.slice(start, end);
		if (bodyLines.length === 0) continue;
		units.push({
			atomic: true,
			bodyLines: [...bodyLines],
			compositionKey:
				listLevel === null
					? input.compositionKey
					: contextKey(input.basePath, ["list"]),
			hardSectionId: input.hardSectionId,
			headingPath: [...input.basePath],
			joinSeparator: "\n",
				kind: listLevel === null ? "field" : "list-item",
				protectedTailLineCount: 0,
			...(listLevel === null
				? {}
				: {
						retrievalHeadingPath: buildListRetrievalPath(
							input.basePath,
							listContext,
						),
					}),
		});
	}
	return units;
}

function appendTableUnits(
	append: (unit: Omit<SemanticUnit, "unitId">) => void,
	table: TableRegion,
	lines: readonly SourceLine[],
	sourceText: string,
	segment: BodySegment,
	definition: NoticeChunkDefinition,
): void {
	const headerLines = lines.slice(table.headerStartIndex, table.firstRowIndex);
	const firstRow = table.rows[0];
	if (!firstRow) return;
	const firstRowLines = lines.slice(firstRow.startIndex, firstRow.endIndex);
	const headerAndFirstRow = [...headerLines, ...firstRowLines];
	const headerAndFirstRowChars = sourceTextRangeLength(sourceText, headerAndFirstRow);
	if (headerLines.length > 0 && headerAndFirstRowChars > definition.maxChars) {
		appendTableUnit(append, headerLines, "table-header", table, segment);
		appendTableUnit(append, firstRowLines, "table-row", table, segment);
	} else {
		appendTableUnit(
			append,
			headerAndFirstRow,
			"table-row",
			table,
			segment,
		);
	}
	for (const row of table.rows.slice(1)) {
		appendTableUnit(append, lines.slice(row.startIndex, row.endIndex), "table-row", table, segment);
	}
}

function appendTableUnit(
	append: (unit: Omit<SemanticUnit, "unitId">) => void,
	bodyLines: readonly SourceLine[],
	kind: "table-header" | "table-row",
	table: TableRegion,
	segment: BodySegment,
): void {
	if (bodyLines.length === 0) return;
	append({
		atomic: true,
		bodyLines: [...bodyLines],
		compositionKey: table.compositionKey,
		hardSectionId: segment.hardSectionId,
		headingPath: [...segment.headingPath],
		joinSeparator: "\n",
		kind,
		protectedTailLineCount: 0,
		retrievalHeadingPath: [...table.retrievalHeadingPath],
	});
}

function sourceTextRangeLength(sourceText: string, lines: readonly SourceLine[]): number {
	const first = lines[0];
	const last = lines.at(-1);
	return first && last ? unicodeLength(sourceText.slice(first.start, last.end)) : 0;
}

function detectTableRegions(
	lines: readonly SourceLine[],
	basePath: readonly string[],
): TableRegion[] {
	const regions: TableRegion[] = [];
	let cursor = 0;
	while (cursor < lines.length) {
		const candidates = [
			detectOrdinalTable(lines, cursor, basePath),
			detectFixedTable(lines, cursor, basePath),
		].filter((table): table is TableRegion => table !== null);
		const next = candidates.sort((left, right) => left.headerStartIndex - right.headerStartIndex)[0];
		if (!next) break;
		regions.push(next);
		cursor = Math.max(next.endIndex, next.headerStartIndex + 1);
	}
	return regions;
}

function detectOrdinalTable(
	lines: readonly SourceLine[],
	startIndex: number,
	basePath: readonly string[],
): TableRegion | null {
	for (let firstRowIndex = startIndex; firstRowIndex < lines.length; firstRowIndex += 1) {
		const firstValue = lines[firstRowIndex]?.text.trim() ?? "";
		if (!PURE_ORDINAL.test(firstValue) || Number.parseInt(firstValue, 10) > 3) continue;
		const headerStartIndex = tableHeaderStartIndex(lines, firstRowIndex, startIndex);
		const headerLines = lines.slice(headerStartIndex, firstRowIndex);
		if (!looksLikeOrdinalTableHeader(headerLines)) continue;
		const rowStarts = collectOrdinalRowStarts(lines, firstRowIndex, headerLines.length);
		if (rowStarts.length < 2) continue;
		const rows = buildTableRows(lines, rowStarts, headerLines.length);
		if (rows.some((row) => row.endIndex <= row.startIndex)) continue;
		const endIndex = rows.at(-1)?.endIndex ?? firstRowIndex;
		const context = tableContext(headerLines);
		return {
			compositionKey: contextKey(basePath, ["table", context]),
			endIndex,
			firstRowIndex,
			headerStartIndex,
			retrievalHeadingPath: withContext(basePath, [`表格列：${context}`]),
			rows,
		};
	}
	return null;
}

function detectFixedTable(
	lines: readonly SourceLine[],
	startIndex: number,
	basePath: readonly string[],
): TableRegion | null {
	for (let headerIndex = startIndex; headerIndex < lines.length; headerIndex += 1) {
		const candidate = fixedTableCandidate(lines, headerIndex, basePath);
		if (!candidate) continue;
		const rowStarts = collectFixedRowStarts(lines, candidate.firstRowIndex, candidate.rowStart);
		if (rowStarts.length < 2) continue;
		const rows = buildTableRows(lines, rowStarts, candidate.columnCount);
		if (rows.some((row) => row.endIndex <= row.startIndex)) continue;
		const endIndex = rows.at(-1)?.endIndex ?? candidate.firstRowIndex;
		const headerStartIndex = includeTableGroupLine(lines, candidate.headerStartIndex);
		const headerLines = lines.slice(headerStartIndex, candidate.firstRowIndex);
		const context = tableContext(headerLines);
		return {
			compositionKey: contextKey(basePath, ["table", context]),
			endIndex,
			firstRowIndex: candidate.firstRowIndex,
			headerStartIndex,
			retrievalHeadingPath: withContext(basePath, [`表格列：${context}`]),
			rows,
		};
	}
	return null;
}

interface FixedTableCandidate {
	columnCount: number;
	firstRowIndex: number;
	headerStartIndex: number;
	rowStart: (value: string) => boolean;
}

function fixedTableCandidate(
	lines: readonly SourceLine[],
	headerIndex: number,
	basePath: readonly string[],
): FixedTableCandidate | null {
	const current = lines[headerIndex]?.text.trim() ?? "";
	const next = lines[headerIndex + 1]?.text.trim() ?? "";
	const leadIn = tableLeadInNearby(lines, headerIndex) || tableLeadInPath(basePath);
	if (current === "分值" && next === "标准") {
		const firstRowIndex = lines.findIndex(
			(line, index) => index > headerIndex + 1 && isScoreRowStart(line.text),
		);
		return firstRowIndex >= 0 && leadIn
			? {
					columnCount: 2,
					firstRowIndex,
					headerStartIndex: headerIndex,
					rowStart: isScoreRowStart,
				}
			: null;
	}
	if (current === "主队" && next === "客队") {
		const firstRowIndex = lines.findIndex(
			(line, index) => index > headerIndex + 1 && isRallyRowStart(line.text),
		);
		return firstRowIndex >= 0
			? {
					columnCount: 3,
					firstRowIndex,
					headerStartIndex: headerIndex,
					rowStart: isRallyRowStart,
				}
			: null;
	}
	if (!/(?:节次|时间段)/u.test(current)) return null;
	let firstRowIndex = -1;
	for (let index = headerIndex + 1; index < lines.length; index += 1) {
		if (isScheduleRowStart(lines[index]?.text ?? "")) {
			firstRowIndex = index;
			break;
		}
		if (!isShortTableHeaderCell(lines[index]?.text ?? "")) break;
	}
	if (firstRowIndex < 0) return null;
	const headerLines = lines.slice(headerIndex, firstRowIndex);
	return headerLines.length >= 3 && leadIn
		? {
				columnCount: headerLines.length,
				firstRowIndex,
				headerStartIndex: headerIndex,
				rowStart: isScheduleRowStart,
			}
		: null;
}

function buildTableRows(
	lines: readonly SourceLine[],
	rowStarts: readonly number[],
	columnCount: number,
): TableRow[] {
	return rowStarts.map((rowStart, index) => {
		const nextRowStart = rowStarts[index + 1] ?? lines.length;
		const rowEnd = rowStart + columnCount;
		const terminator = tableEndIndex(lines, rowEnd, rowEnd - 1);
		return {
			endIndex: Math.min(nextRowStart, terminator, rowEnd),
			startIndex: rowStart,
		};
	});
}

function collectOrdinalRowStarts(
	lines: readonly SourceLine[],
	firstRowIndex: number,
	columnCount: number,
): number[] {
	const starts: number[] = [];
	let previousNumber = 0;
	for (let index = firstRowIndex; index < lines.length; index += columnCount) {
		const value = lines[index]?.text.trim() ?? "";
		if (!PURE_ORDINAL.test(value)) break;
		const number = Number.parseInt(value, 10);
		if (number <= previousNumber) break;
		starts.push(index);
		previousNumber = number;
	}
	return starts;
}

function collectFixedRowStarts(
	lines: readonly SourceLine[],
	firstRowIndex: number,
	rowStart: (value: string) => boolean,
): number[] {
	const starts: number[] = [];
	for (let index = firstRowIndex; index < lines.length; index += 1) {
		const value = lines[index]?.text.trim() ?? "";
		if (rowStart(value)) {
			starts.push(index);
			continue;
		}
		if (starts.length > 0 && isTableTerminator(value)) break;
	}
	return starts;
}

function tableEndIndex(
	lines: readonly SourceLine[],
	firstRowIndex: number,
	lastRowIndex: number,
): number {
	for (let index = firstRowIndex; index < lines.length; index += 1) {
		if (index > lastRowIndex && isTableTerminator(lines[index]?.text ?? "")) return index;
	}
	return lines.length;
}

function tableHeaderStartIndex(
	lines: readonly SourceLine[],
	firstRowIndex: number,
	minimumIndex: number,
): number {
	let start = firstRowIndex;
	while (start > minimumIndex && isTableHeaderLine(lines[start - 1]?.text ?? "")) {
		start -= 1;
	}
	return start;
}

function includeTableGroupLine(lines: readonly SourceLine[], headerStartIndex: number): number {
	const previous = lines[headerStartIndex - 1]?.text.trim() ?? "";
	return isTableGroupLine(previous) ? headerStartIndex - 1 : headerStartIndex;
}

function looksLikeOrdinalTableHeader(lines: readonly SourceLine[]): boolean {
	const hits = new Set(
		lines.flatMap((line) => tableHeaderTerms.filter((term) => line.text.includes(term))),
	);
	return hits.size >= 2;
}

function isTableHeaderLine(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 0 &&
		unicodeLength(text) <= 60 &&
		!isListItemStart(text) &&
		!isRecordStart(text) &&
		(tableHeaderTerms.some((term) => text === term || text.includes(term)) ||
			isShortTableHeaderCell(text))
	);
}

function isShortTableHeaderCell(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 0 &&
		unicodeLength(text) <= 30 &&
		!/[。！？!?；;：:]$/u.test(text) &&
		!isListItemStart(text) &&
		!isDateLine(text) &&
		!isUrlLine(text)
	);
}

function isTableGroupLine(value: string): boolean {
	return /^(?:[甲乙丙丁戊己庚辛壬癸]组|第[一二三四五六七八九十0-9]+组)$/u.test(value.trim());
}

function isScoreRowStart(value: string): boolean {
	const text = value.trim();
	return (
		unicodeLength(text) <= 30 &&
		/\d+(?:\.\d+)?\s*分$/u.test(text) &&
		!/(?:每|凡|符合|不符|扣|加|减|满分|得分)/u.test(text)
	);
}

function isRallyRowStart(value: string): boolean {
	return /^第[一二三四五六七八九十0-9]+盘$/u.test(value.trim());
}

function isScheduleRowStart(value: string): boolean {
	return /^\d{1,2}\s*[-—~至]\s*\d{1,2}\s*节$/u.test(value.trim());
}

function tableContext(lines: readonly SourceLine[]): string {
	const value = lines.map((line) => line.text.trim()).filter(Boolean).join(" / ");
	if (value.length <= 180) return value || "表格记录";
	return `${value.slice(0, 177)}…`;
}

function tableLeadInNearby(lines: readonly SourceLine[], index: number): boolean {
	for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
		const value = lines[cursor]?.text.trim() ?? "";
		if (/(?:如下|见下表|具体如下|为)[：:]?$/u.test(value)) return true;
	}
	return false;
}

function tableLeadInPath(basePath: readonly string[]): boolean {
	return basePath.some((value) => /(?:如下|具体赛制|表格|表)/u.test(value.trim()));
}

function isTableStart(index: number, tables: readonly TableRegion[]): boolean {
	return tables.some((table) => table.headerStartIndex === index);
}

function isInsideTable(index: number, tables: readonly TableRegion[]): boolean {
	return tables.some((table) => index >= table.headerStartIndex && index < table.endIndex);
}

function buildRecordUnits(
	lines: readonly SourceLine[],
	basePath: readonly string[],
	hardSectionId: number,
): Array<Omit<SemanticUnit, "unitId">> {
	const identity = recordIdentity(lines[0]?.text ?? "") || "未命名记录";
	const recordPath = withContext(basePath, [`记录：${identity}`]);
	return [
		{
			atomic: true,
			bodyLines: [...lines],
			compositionKey: contextKey(recordPath, []),
			hardSectionId,
			headingPath: [...basePath],
			joinSeparator: "\n\n",
			kind: "record",
			protectedTailLineCount: 0,
		},
	];
}

function findNextRecordStart(
	lines: readonly SourceLine[],
	start: number,
	tables: readonly TableRegion[],
): number {
	for (let index = start; index < lines.length; index += 1) {
		if (isInsideTable(index, tables)) continue;
		if (isRecordStart(lines[index]?.text ?? "")) return index;
	}
	return lines.length;
}

function findListItemBoundary(
	lines: readonly SourceLine[],
	start: number,
	tables: readonly TableRegion[],
	listLevel: 1 | 2,
): number {
	for (let index = start; index < lines.length; index += 1) {
		if (isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			isRecordStart(text) ||
			isTopicLead(text) ||
			isSignatureLine(text) ||
			isClosingStart(lines, index) ||
			isFooterLine(lines, index)
		) {
			return index;
		}
		if (listMarkerLevel(text) === listLevel) return index;
		if (listLevel === 2 && isTopLevelListItemStart(text)) return index;
	}
	return lines.length;
}

function findListRunBoundary(
	lines: readonly SourceLine[],
	start: number,
	tables: readonly TableRegion[],
	listLevel: 1 | 2,
): number {
	let cursor = start;
	while (cursor < lines.length && listMarkerLevel(lines[cursor]?.text ?? "") === listLevel) {
		const end = findListItemBoundary(lines, cursor + 1, tables, listLevel);
		if (end <= cursor) return cursor + 1;
		cursor = end;
	}
	return cursor;
}

function appendIndependentListUnits(
	append: (unit: Omit<SemanticUnit, "unitId">) => void,
	lines: readonly SourceLine[],
	start: number,
	end: number,
	tables: readonly TableRegion[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
		listLevel: 1 | 2;
	},
): void {
	const itemGroups: SourceLine[][] = [];
	let cursor = start;
	while (cursor < end) {
		const itemEnd = Math.min(
			findListItemBoundary(lines, cursor + 1, tables, input.listLevel),
			end,
		);
		if (itemEnd <= cursor) break;
		itemGroups.push(lines.slice(cursor, itemEnd));
		cursor = itemEnd;
	}
	for (const itemLines of itemGroups) {
		if (hasConditionalNestedList(itemLines)) {
			appendListItemUnit(append, itemLines, input);
			continue;
		}
		appendIndependentListItemUnits(append, itemLines, input);
	}
}

function hasConditionalNestedList(lines: readonly SourceLine[]): boolean {
	const nestedStarts = lines
		.map((line, index) =>
			index > 0 && listMarkerLevel(line.text) === 2 ? index : -1,
		)
		.filter((index) => index >= 0);
	if (nestedStarts.length < 2) return false;
	const parentText = lines
		.slice(0, nestedStarts[0])
		.map((line) => line.text.trim())
		.filter(Boolean)
		.join(" ");
	return /(?:以下|之一|包括|如下|任选|任一|满足)/u.test(parentText);
}

function appendIndependentListItemUnits(
	append: (unit: Omit<SemanticUnit, "unitId">) => void,
	lines: readonly SourceLine[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
	},
): void {
	const nestedStarts = independentNestedListStarts(lines);
	if (!nestedStarts) {
		appendListItemUnit(append, lines, input);
		return;
	}
	const parentContext = lines[0]?.text.trim() ?? "";
	const boundaries = [nestedStarts[0], ...nestedStarts.slice(1), lines.length];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = index === 0 ? 0 : boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? lines.length;
		const bodyLines = lines.slice(start, end);
		if (bodyLines.length === 0) continue;
		appendListItemUnit(
			append,
			bodyLines,
			input,
			index === 0 ? undefined : parentContext,
		);
	}
}

function appendListItemUnit(
	append: (unit: Omit<SemanticUnit, "unitId">) => void,
	lines: readonly SourceLine[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
	},
	listContext?: string,
): void {
	if (lines.length === 0) return;
	append({
		atomic: true,
		bodyLines: [...lines],
		compositionKey: contextKey(input.basePath, ["list"]),
		hardSectionId: input.hardSectionId,
		headingPath: [...input.basePath],
		joinSeparator: "\n",
		kind: "list-item",
		protectedTailLineCount: 0,
		retrievalHeadingPath: buildListRetrievalPath(
			input.basePath,
			listContext,
		),
	});
}

function independentNestedListStarts(
	lines: readonly SourceLine[],
): number[] | null {
	const starts = lines
		.map((line, index) =>
			index > 0 && listMarkerLevel(line.text) === 2 ? index : -1,
		)
		.filter((index) => index >= 0);
	if (starts.length < 2) return null;
	const parentText = lines
		.slice(0, starts[0])
		.map((line) => line.text.trim())
		.filter(Boolean)
		.join(" ");
	const nestedLines = lines.slice(starts[0]);
	if (
		/(?:以下|之一|包括|如下|任选|任一|满足)/u.test(parentText) ||
		isLabelOnly(parentText) ||
		isSequentialList(nestedLines, [])
	) {
		return null;
	}
	return starts;
}

function findNextBoundary(
	lines: readonly SourceLine[],
	start: number,
	tables: readonly TableRegion[],
): number {
	for (let index = start; index < lines.length; index += 1) {
		if (isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			isRecordStart(text) ||
			isTopicLead(text) ||
			isIndependentBracketListStart(lines, index) ||
			(isFieldLabelStart(lines, index) && !isListItemStart(text)) ||
			isSignatureLine(text) ||
			isClosingStart(lines, index) ||
			isFooterLine(lines, index) ||
			isImageCaptionLine(text)
		) {
			return index;
		}
	}
	return lines.length;
}

function findFieldGroupBoundary(
	lines: readonly SourceLine[],
	start: number,
	tables: readonly TableRegion[],
): number {
	const previous = lines[start - 1];
	let hasValue = Boolean(
		previous &&
			(isInlineLabelLead(previous.text) ||
				isUrlLine(previous.text) ||
				isTopLevelListItemStart(previous.text) ||
				!isLabelOnly(previous.text)),
	);
	for (let index = start; index < lines.length; index += 1) {
		if (isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			isRecordStart(text) ||
			isTopicLead(text) ||
			isSignatureLine(text) ||
			isClosingStart(lines, index) ||
			isFooterLine(lines, index) ||
			isImageCaptionLine(text)
		) {
			return index;
		}
		const blankBefore = hasBlankLineBetween(lines[index - 1], lines[index]);
		if (isUrlLine(text) || isListItemStart(text)) {
			hasValue = true;
			continue;
		}
		if (isFieldLabelStart(lines, index)) {
			if (blankBefore && hasValue) return index;
			continue;
		}
		if (blankBefore && hasValue) return index;
		hasValue = true;
	}
	return lines.length;
}

function buildUnitPieces(
	sourceText: string,
	unit: SemanticUnit,
	stats: NoticeChunkStats,
	definition: NoticeChunkDefinition,
): UnitPiece[] {
	if (
		unit.kind === "table-row" &&
		sourceTextRangeLength(sourceText, unit.bodyLines) > definition.maxChars
	) {
		stats.tableRowSplitCount += 1;
	}
	const blocks = unit.bodyLines.flatMap((line) => splitLine(line, stats, definition));
	const pieces: Omit<UnitPiece, "wholeUnit">[] = [];
	let current: TextBlock[] = [];
	const flush = () => {
		const first = current[0];
		const last = current.at(-1);
		if (!(first && last)) {
			return;
		}
		pieces.push({
			atomic: unit.atomic,
			bodyRanges: current.map((block) => block.range),
			content: sourceText.slice(first.range.start, last.range.end),
				compositionKey: unit.compositionKey,
				hardSectionId: unit.hardSectionId,
			headingPath: [...unit.headingPath],
				joinSeparator: unit.joinSeparator ?? "\n\n",
				kind: unit.kind,
				unitId: unit.unitId,
			...(unit.retrievalHeadingPath
				? { retrievalHeadingPath: [...unit.retrievalHeadingPath] }
				: {}),
		});
		current = [];
	};

	for (const [blockIndex, block] of blocks.entries()) {
		const first = current[0];
		const currentContent = first
			? sourceText.slice(first.range.start, current.at(-1)?.range.end ?? first.range.end)
			: "";
		const combined = first
			? sourceText.slice(first.range.start, block.range.end)
			: sourceText.slice(block.range.start, block.range.end);
		const protectedTail =
			unit.protectedTailLineCount > 0 && blockIndex >= blocks.length - unit.protectedTailLineCount;
		if (
			current.length > 0 &&
			(unicodeLength(combined) > definition.maxChars ||
				(!unit.atomic && !protectedTail &&
					unicodeLength(currentContent) >= definition.targetChars))
		) {
			flush();
		}
		current.push(block);
	}
	flush();
	const wholeUnit = pieces.length === 1;
	return pieces.map((piece) => ({
		...piece,
		wholeUnit,
	}));
}

function splitLine(
	line: SourceLine,
	stats: NoticeChunkStats,
	definition: NoticeChunkDefinition,
): TextBlock[] {
	if (line.text.length === 0) {
		return [];
	}
	let remaining = line.text;
	let sourceStart = line.start;
	const result: TextBlock[] = [];
	while (unicodeLength(remaining) > definition.maxChars) {
		const characters = [...remaining];
		const split = splitIndex(characters, definition);
		const piece = characters.slice(0, split.index).join("");
		const sourceEnd = sourceStart + piece.length;
		result.push({ range: { end: sourceEnd, start: sourceStart } });
		incrementSplitStat(stats, split.reason);
		remaining = remaining.slice(piece.length);
		sourceStart = sourceEnd;
	}
	if (remaining.length > 0) {
		result.push({ range: { end: line.end, start: sourceStart } });
	}
	return result;
}

function splitIndex(
	characters: readonly string[],
	definition: NoticeChunkDefinition,
): { index: number; reason: SplitReason } {
	const max = Math.min(definition.maxChars, characters.length);
	const target = Math.min(definition.targetChars, max);
	for (const [reason, predicate] of [
		["sentence", sentenceBoundaryAt],
		["clause", clauseBoundaryAt],
	] as const) {
		for (let index = target; index <= max; index += 1) {
			if (predicate(characters, index)) {
				return { index, reason };
			}
		}
		for (let index = target - 1; index >= Math.max(1, Math.floor(target / 2)); index -= 1) {
			if (predicate(characters, index)) {
				return { index, reason };
			}
		}
	}
	return { index: max, reason: "hard" };
}

function sentenceBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!SENTENCE_END.test(punctuation) && punctuation !== ".") {
		return false;
	}
	if (punctuation !== ".") {
		return true;
	}
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	if (next === ".") {
		return false;
	}
	return !(unicodeLetterOrNumber(previous) && unicodeLetterOrNumber(next));
}

function clauseBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!CLAUSE_END.test(punctuation)) {
		return false;
	}
	if (punctuation !== "," && punctuation !== ":") {
		return true;
	}
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	return !(unicodeNumber(previous) && unicodeNumber(next));
}

function incrementSplitStat(stats: NoticeChunkStats, reason: SplitReason): void {
	if (reason === "sentence") {
		stats.sentenceSplitCount += 1;
	} else if (reason === "clause") {
		stats.clauseSplitCount += 1;
	} else {
		stats.hardCutCount += 1;
	}
}

function combinePieces(
	source: NoticeSource,
	sourceSha256: `sha256:${string}`,
	pieces: readonly UnitPiece[],
	definition: NoticeChunkDefinition,
): BuiltNoticeChunk[] {
	const chunks: BuiltNoticeChunk[] = [];
	let current: UnitPiece[] = [];
	const flush = () => {
		if (current.length === 0) {
			return;
		}
		const chunkIndex = chunks.length;
		const content = joinPieceContent(current);
		const headingPath = commonHeadingPath(current.map((piece) => piece.headingPath));
		const retrievalText = buildRetrievalText(source.title, current);
		const chunkId = sha256(
			canonicalJsonBytes({
				algorithm: definition.algorithm,
				chunkIndex,
				parts: current.map((piece) => ({
					bodyRanges: piece.bodyRanges,
					headingPath: piece.headingPath,
				})),
				sourceSha256,
			}),
		);
		chunks.push({
			bodyRanges: current.flatMap((piece) => piece.bodyRanges),
			chunkId,
			chunkIndex,
			content,
			hardSectionId: current[0]?.hardSectionId ?? 0,
			headingPath,
			noticeId: source.noticeId,
			parts: current.map(
				({
					bodyRanges,
					content: partContent,
					headingPath: path,
					joinSeparator,
					kind,
					retrievalHeadingPath,
				}) => ({
					bodyRanges,
					content: partContent,
					headingPath: path,
					joinSeparator,
					kind,
					...(retrievalHeadingPath
						? { retrievalHeadingPath: [...retrievalHeadingPath] }
						: {}),
				}),
			),
			retrievalText,
		});
		current = [];
	};

	for (const piece of pieces) {
		if (current.length === 0) {
			current.push(piece);
			continue;
		}
		const currentContent = joinPieceContent(current);
		const combinedContent = joinPieceContent([...current, piece]);
		const sameHardSection = current[0]?.hardSectionId === piece.hardSectionId;
		const sameComposition = current[0]?.compositionKey === piece.compositionKey;
		const onlyWholeUnits = piece.wholeUnit && current.every((item) => item.wholeUnit);
		const containsIndependentListItem =
			piece.kind === "list-item" || current.some((item) => item.kind === "list-item");
		const shortListItemRun =
			piece.kind === "list-item" &&
			isPackableShortListItem(piece.content) &&
			current.every(
					(item) =>
						item.kind === "list-item" && isPackableShortListItem(item.content),
			);
		const flatTextContext =
			current.every((item) => item.headingPath.length === 0) &&
			piece.headingPath.length === 0 &&
			current.every((item) => !isIsolatedUnitKind(item.kind)) &&
			!isIsolatedUnitKind(piece.kind);
		if (
			 sameHardSection &&
			(sameComposition || flatTextContext) &&
			(!containsIndependentListItem || shortListItemRun) &&
			onlyWholeUnits &&
			unicodeLength(currentContent) < definition.targetChars &&
			unicodeLength(combinedContent) <= definition.maxChars
		) {
			current.push(piece);
			continue;
		}
		flush();
		current.push(piece);
	}
	flush();
	return chunks;
}

function isIsolatedUnitKind(kind: SemanticUnitKind): boolean {
	return (
		kind === "list-item" ||
		kind === "record" ||
		kind === "table-header" ||
		kind === "table-row"
	);
}

function isPackableShortListItem(content: string): boolean {
	if (unicodeLength(content) >= TINY_CHUNK_CHARS) return false;
	return !content
		.split("\n")
		.some((line, index) => index > 0 && listMarkerLevel(line) === 2);
}

function joinPieceContent(
	pieces: readonly Pick<UnitPiece, "content" | "joinSeparator">[],
): string {
	return pieces
		.map((piece) => piece.content)
		.reduce((joined, content, index) => {
			if (index === 0) return content;
			const separator = pieces[index]?.joinSeparator ?? "\n\n";
			return `${joined}${separator}${content}`;
		}, "");
}

function buildRetrievalText(title: string, pieces: readonly UnitPiece[]): string {
	const lines = [title];
	let previousPath: string[] = [];
	for (const piece of pieces) {
		const path = piece.retrievalHeadingPath ?? piece.headingPath;
		const shared = commonPrefixLength(previousPath, path);
		lines.push(...path.slice(shared), piece.content);
		previousPath = path;
	}
	return lines.join("\n");
}

function buildListRetrievalPath(
	basePath: readonly string[],
	listContext?: string,
): string[] {
	return [
		...basePath,
		...(listContext ? [`列表项：${contextLabel(listContext)}`] : []),
	];
}

function siblingListLevel(lines: readonly SourceLine[]): 1 | 2 | null {
	if (lines.some((line) => listMarkerLevel(line.text) === 1)) return 1;
	if (lines.some((line) => listMarkerLevel(line.text) === 2)) return 2;
	return null;
}

function isSequentialList(
	lines: readonly SourceLine[],
	headingPath: readonly string[],
): boolean {
	const markerCount = lines.filter((line) => listMarkerLevel(line.text) !== null).length;
	if (markerCount < 2) return false;
	const headingText = headingPath.join(" ");
	const listText = lines.map((line) => line.text).join("\n");
	return (
		/(?:流程|步骤|办理程序|操作流程|操作步骤|程序|环节|顺序)/u.test(headingText) ||
		/(?:第[一二三四五六七八九十百0-9]+步|首先|其次|然后|随后|接着|最后|完成后|提交后|审核后|通过后|下一步)/u.test(
			listText,
		)
	);
}

function commonHeadingPath(paths: readonly string[][]): string[] {
	const first = paths[0] ?? [];
	let length = first.length;
	for (const path of paths.slice(1)) {
		length = Math.min(length, commonPrefixLength(first, path));
	}
	return first.slice(0, length);
}

function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
	let index = 0;
	while (index < left.length && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

function unicodeLetterOrNumber(value: string): boolean {
	return /^[\p{L}\p{N}]$/u.test(value);
}

function unicodeNumber(value: string): boolean {
	return /^\p{N}$/u.test(value);
}

function rangeOf(line: SourceLine): SourceRange {
	return { end: line.end, start: line.start };
}

const PURE_ORDINAL = /^\d{1,4}$/u;
const tableHeaderTerms = [
	"序号",
	"姓名",
	"学号",
	"学院",
	"专业",
	"组别",
	"奖项",
	"时间",
	"刊名",
	"出版社",
	"作者",
	"单位",
	"排名",
	"类别",
	"是否",
	"项目名称",
] as const;

function isRecordStart(value: string): boolean {
	return /^(?:\d+\s*[.、）)]\s*)?姓名\s*[:：](?:\s*\S.*)?$/u.test(value.trim());
}

function recordIdentity(value: string): string | null {
	const match = value.trim().match(/(?:姓名\s*[:：]\s*)([^，,；;。]+)/u);
	return match?.[1]?.trim() || null;
}

function isLabelOnly(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 1 &&
		text.length <= 100 &&
		/[：:]$/u.test(text) &&
		!isSalutationLine(text) &&
		!isNarrativeLead(text) &&
		!isUrlLine(text)
	);
}

function isNarrativeLead(value: string): boolean {
	return /如下[：:]$/u.test(value.trim());
}

function isInlineLabelLead(value: string): boolean {
	const text = value.trim();
	if (!text || text.length > 180 || isUrlLine(text)) return false;
	const match = text.match(/^(.{1,80}?)[：:]\s*\S/u);
	if (!match || /[。！？!?；;]/u.test(match[1] ?? "")) return false;
	const label = match[1]?.trim() ?? "";
	if (!label || isNarrativeLabel(label)) return false;
	return !/[。！？!?；;：:]$/u.test(text);
}

function isNarrativeLabel(value: string): boolean {
	return /^(?:根据|现将|现就|为|为了|本次|此次|结合|按照|经|针对|关于|以下|具体|相关).{0,45}$/u.test(
		value.trim(),
	);
}

function isFieldGroupStart(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return !isListItemStart(text) && isFieldLabelStart(lines, index);
}

function isFieldLabelStart(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return isLabelOnly(text) || isInlineLabelLead(text) || isLocalLabel(lines, index);
}

function isUrlLine(value: string): boolean {
	return /^(?:https?:\/\/|mailto:)\S+$/u.test(value.trim());
}

function hasBlankLineBetween(previous: SourceLine | undefined, current: SourceLine | undefined): boolean {
	return Boolean(previous && current && current.index > previous.index + 1);
}

function isLocalLabel(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text.trim() ?? "";
	if (!LOCAL_LABEL.test(text)) {
		return false;
	}
	const next = lines[index + 1];
	if (!next) return false;
	return (
		isListItemStart(next.text) ||
		(unicodeLength(text) <= 60 &&
			!isRecordStart(next.text) &&
			!isTopicLead(next.text) &&
			!isSignatureLine(next.text))
	);
}

function isListItemStart(value: string): boolean {
	return listMarkerLevel(value) !== null;
}

function isTopLevelListItemStart(value: string): boolean {
	return listMarkerLevel(value) === 1;
}

function listMarkerLevel(value: string): 1 | 2 | null {
	const text = value.trim();
	if (/^\d{1,3}\s*[.．、）)]\s*\S/u.test(text)) return 1;
	if (
		/^[（(](?:\d{1,3}|[一二三四五六七八九十百]+)[）)]\s*\S/u.test(text) ||
		/^[①②③④⑤⑥⑦⑧⑨⑩]\s*\S/u.test(text)
	) {
		return 2;
	}
	return null;
}

function isIndependentBracketListStart(
	lines: readonly SourceLine[],
	index: number,
): boolean {
	if (listMarkerLevel(lines[index]?.text ?? "") !== 2) return false;
	if (index > 0 && !isDirectListLead(lines[index - 1]?.text ?? "")) return false;
	for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
		const text = lines[cursor]?.text ?? "";
		const markerLevel = listMarkerLevel(text);
		if (markerLevel === 2) return true;
		if (
			markerLevel === 1 ||
			isRecordStart(text) ||
			isTopicLead(text) ||
			isSignatureLine(text) ||
			isClosingStart(lines, cursor) ||
			isFooterLine(lines, cursor)
		) {
			return false;
		}
	}
	return false;
}

function isDirectListLead(value: string): boolean {
	const text = value.trim();
	if (!text) return true;
	if (listMarkerLevel(text) !== null) return false;
	return !/(?:以下|包括|满足|之一)[：:]?$/u.test(text);
}

function isImageCaptionLine(value: string): boolean {
	const text = value.trim();
	if (!text || unicodeLength(text) > 100 || isUrlLine(text)) return false;
	return (
		/^[（(【[]?[^。！？!?；;\n]{0,60}(?:二维码|小程序码)[）)】\]]?[：:]?$/u.test(text) ||
		/^(?:请|可)?(?:扫描|扫码)[^。！？!?；;\n]{0,80}[：:]?[。.]?$/u.test(text)
	);
}

function isFooterLine(lines: readonly SourceLine[], index: number): boolean {
	if (!isEditorialCreditLine(lines[index]?.text ?? "")) return false;
	return lines.slice(index + 1).every((line) => {
		const text = line.text.trim();
		return (
			isEditorialCreditLine(text) ||
			isSignatureLine(text) ||
			isOrganizationLine(text) ||
			isDateLine(text)
		);
	});
}

function isEditorialCreditLine(value: string): boolean {
	return /^(?:撰稿|供稿|供图|作者|审核)[：:]\s*\S/u.test(value.trim());
}

function isTopicLead(value: string): boolean {
	const text = value.trim();
	return (
		/^聚焦/u.test(text) ||
		/^开放/u.test(text) ||
		/^本奖项面向/u.test(text) ||
		/^以[“"「].{1,40}[”"」]为核心/u.test(text) ||
		/^系统展示/u.test(text) ||
		/^围绕[^，。]{1,40}(?:开展|进行|设置)/u.test(text)
	);
}

function isSalutationLine(value: string): boolean {
	return /^(?:各|尊敬的|亲爱的|致|广大师生|全体(?:师生|教职工|学生))[^。！？!?；;]{0,100}[：:]$/u.test(
		value.trim(),
	);
}

function isSignatureLine(value: string): boolean {
	return /^\s*[—–―]{1,3}\s*\S/u.test(value);
}

function isClosingStart(lines: readonly SourceLine[], index: number): boolean {
	if (index < Math.max(0, lines.length - 3)) return false;
	const text = lines[index]?.text.trim() ?? "";
	if (isDateLine(text)) return true;
	const next = lines[index + 1]?.text.trim() ?? "";
	return Boolean(isOrganizationLine(text) && isDateLine(next));
}

function isDateLine(value: string): boolean {
	return /^(?:\d{4}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2})?|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)$/u.test(
		value.trim(),
	);
}

function isOrganizationLine(value: string): boolean {
	const text = value.trim();
	return text.length > 0 && text.length <= 30 && /(?:学院|大学|处|部|室|中心|委员会|研究院|研究生院|办公室|团委|党委|实验室|学校|协会|系)$/u.test(text);
}

function isTableTerminator(value: string): boolean {
	const text = value.trim();
	return /^(?:公示时间|受理意见|联系方式|联系人|联系电话|如有异议|主要完成人|主要完成单位|注|备注|科研处|教务处|国际合作处|理学院|中央民族大学)/u.test(
		text,
	);
}

function contextLabel(value: string): string {
	const text = value.trim().replace(/[：:。]$/u, "");
	return text.length <= 80 ? text : `${text.slice(0, 77)}…`;
}

function withContext(basePath: readonly string[], contexts: readonly string[]): string[] {
	return [...basePath, ...contexts.filter((value) => value.length > 0)];
}

function contextKey(basePath: readonly string[], contexts: readonly string[]): string {
	return JSON.stringify([...basePath, ...contexts]);
}

function sectionCompositionKey(headingPath: readonly string[]): string {
	return contextKey(headingPath, []);
}

const LOCAL_LABEL = /^[（(](?:[一二三四五六七八九十百]+|\d{1,2})[）)]\s*[^。！？!?；;]{1,80}。?$/u;
