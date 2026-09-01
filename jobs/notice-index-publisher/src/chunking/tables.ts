import type { NoticeChunkDefinition } from "../definitions.ts";
import { unicodeLength } from "../encoding.ts";
import {
	type BodySegment,
	type SemanticUnit,
	type SourceLine,
	type TableRegion,
	type TableRow,
	PURE_ORDINAL,
	contextKey,
	isDateLine,
	isListItemStart,
	isRecordStart,
	isTableTerminator,
	isUrlLine,
	tableHeaderTerms,
	withContext,
} from "./model.ts";

export function appendTableUnits(
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

export function appendTableUnit(
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

export function sourceTextRangeLength(sourceText: string, lines: readonly SourceLine[]): number {
	const first = lines[0];
	const last = lines.at(-1);
	return first && last ? unicodeLength(sourceText.slice(first.start, last.end)) : 0;
}

export function detectTableRegions(
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

export function detectOrdinalTable(
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

export function detectFixedTable(
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

export interface FixedTableCandidate {
	columnCount: number;
	firstRowIndex: number;
	headerStartIndex: number;
	rowStart: (value: string) => boolean;
}

export function fixedTableCandidate(
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

export function buildTableRows(
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

export function collectOrdinalRowStarts(
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

export function collectFixedRowStarts(
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

export function tableEndIndex(
	lines: readonly SourceLine[],
	firstRowIndex: number,
	lastRowIndex: number,
): number {
	for (let index = firstRowIndex; index < lines.length; index += 1) {
		if (index > lastRowIndex && isTableTerminator(lines[index]?.text ?? "")) return index;
	}
	return lines.length;
}

export function tableHeaderStartIndex(
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

export function includeTableGroupLine(lines: readonly SourceLine[], headerStartIndex: number): number {
	const previous = lines[headerStartIndex - 1]?.text.trim() ?? "";
	return isTableGroupLine(previous) ? headerStartIndex - 1 : headerStartIndex;
}

export function looksLikeOrdinalTableHeader(lines: readonly SourceLine[]): boolean {
	const hits = new Set(
		lines.flatMap((line) => tableHeaderTerms.filter((term) => line.text.includes(term))),
	);
	return hits.size >= 2;
}

export function isTableHeaderLine(value: string): boolean {
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

export function isShortTableHeaderCell(value: string): boolean {
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

export function isTableGroupLine(value: string): boolean {
	return /^(?:[甲乙丙丁戊己庚辛壬癸]组|第[一二三四五六七八九十0-9]+组)$/u.test(value.trim());
}

export function isScoreRowStart(value: string): boolean {
	const text = value.trim();
	return (
		unicodeLength(text) <= 30 &&
		/\d+(?:\.\d+)?\s*分$/u.test(text) &&
		!/(?:每|凡|符合|不符|扣|加|减|满分|得分)/u.test(text)
	);
}

export function isRallyRowStart(value: string): boolean {
	return /^第[一二三四五六七八九十0-9]+盘$/u.test(value.trim());
}

export function isScheduleRowStart(value: string): boolean {
	return /^\d{1,2}\s*[-—~至]\s*\d{1,2}\s*节$/u.test(value.trim());
}

export function tableContext(lines: readonly SourceLine[]): string {
	const value = lines.map((line) => line.text.trim()).filter(Boolean).join(" / ");
	if (value.length <= 180) return value || "表格记录";
	return `${value.slice(0, 177)}…`;
}

export function tableLeadInNearby(lines: readonly SourceLine[], index: number): boolean {
	for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
		const value = lines[cursor]?.text.trim() ?? "";
		if (/(?:如下|见下表|具体如下|为)[：:]?$/u.test(value)) return true;
	}
	return false;
}

export function tableLeadInPath(basePath: readonly string[]): boolean {
	return basePath.some((value) => /(?:如下|具体赛制|表格|表)/u.test(value.trim()));
}

export function isTableStart(index: number, tables: readonly TableRegion[]): boolean {
	return tables.some((table) => table.headerStartIndex === index);
}

export function isInsideTable(index: number, tables: readonly TableRegion[]): boolean {
	return tables.some((table) => index >= table.headerStartIndex && index < table.endIndex);
}
