import {
	HANDBOOK_ARTICLE_HEADING_RE,
	HANDBOOK_CHAPTER_HEADING_RE,
	MARKDOWN_LINE_LIMIT,
	type TableCell,
	wrapMarkdownTextLines,
} from "./shared";

const TABLE_ROW_RE = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
const TABLE_CELL_RE = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;

export function parseTableRows(html: string): TableCell[][] {
	const rows: TableCell[][] = [];
	for (const rowMatch of html.matchAll(TABLE_ROW_RE)) {
		const rowHtml = rowMatch[0];
		const row: TableCell[] = [];
		for (const cellMatch of rowHtml.matchAll(TABLE_CELL_RE)) {
			row.push({
				text: normalizeTableCellText(stripTags(cellMatch[3] ?? "")),
				rowspan: parsePositiveInt(attributeValue(cellMatch[2] ?? "", "rowspan")),
				colspan: parsePositiveInt(attributeValue(cellMatch[2] ?? "", "colspan")),
			});
		}
		if (row.length > 0) {
			rows.push(row);
		}
	}
	return rows;
}

export function shouldPreserveTableAsHtml(html: string): boolean {
	const rows = parseTableRows(html);
	if (rows.length === 0) {
		return false;
	}
	if (shouldPreserveHandbookTableAsHtml(rows)) {
		return true;
	}
	if (rows.some((row) => row.some((cell) => cell.rowspan > 1))) {
		return true;
	}
	if (hasBlankLeadingHeaderCell(rows)) {
		return true;
	}
	return rows[0]?.some((cell) => cell.rowspan > 1 || cell.colspan > 1) ?? false;
}

export function sanitizePreservedHtmlForMdx(html: string): string {
	return html.trim().replaceAll("*", "&#42;").replaceAll("{", "&#123;").replaceAll("}", "&#125;");
}

export function convertTableHtmlToMarkdownBlocks(html: string): [string, string][] {
	if (shouldPreserveTableAsHtml(html)) {
		return [["block", sanitizePreservedHtmlForMdx(html)]];
	}
	const grid = expandTableRows(parseTableRows(html));
	if (grid.length === 0) {
		return [];
	}

	const blocks: [string, string][] = [];
	let headerRow: string[] | undefined;
	let currentTable: string[][] = [];
	for (const row of grid) {
		const trimmedRow = trimTrailingEmptyCells(row);
		if (!trimmedRow.some(Boolean)) {
			continue;
		}
		if (isSectionRow(trimmedRow)) {
			if (
				currentTable.length > 0 &&
				!(headerRow && currentTable.length === 1 && arraysEqual(currentTable[0], headerRow))
			) {
				blocks.push(["table", renderMarkdownTable(currentTable)]);
			}
			currentTable = headerRow ? [[...headerRow]] : [];
			blocks.push(["section_label", trimmedRow[0] ?? ""]);
			continue;
		}
		if (!headerRow) {
			headerRow = [...trimmedRow];
			currentTable = [[...headerRow]];
			continue;
		}
		if (currentTable.length === 0) {
			currentTable = [[...headerRow]];
		}
		currentTable.push(trimmedRow);
	}
	if (
		currentTable.length > 0 &&
		!(headerRow && currentTable.length === 1 && arraysEqual(currentTable[0], headerRow))
	) {
		blocks.push(...renderTableBlocks(currentTable));
	}
	return blocks;
}

export function htmlRowTextSignature(rowHtml: string): string {
	return rowHtml.replace(TAG_RE, " ").split(/\s+/).join(" ").trim().toLowerCase();
}

export function extractHtmlTableRows(html: string): string[] {
	return [...html.matchAll(TABLE_ROW_RE)].map((match) => match[0]);
}

export function normalizeTableBodyHeaderCells(html: string): string {
	if (!(html.toLowerCase().includes("<th") && html.toLowerCase().includes("<table"))) {
		return html;
	}
	const rowMatches = [...html.matchAll(TABLE_ROW_RE)];
	if (rowMatches.length <= 1) {
		return html;
	}
	let cursor = 0;
	const chunks: string[] = [];
	rowMatches.forEach((match, index) => {
		chunks.push(html.slice(cursor, match.index));
		let rowHtml = match[0];
		if (index > 0) {
			rowHtml = rowHtml.replace(/<th(\b[^>]*)>/gi, "<td$1>").replace(/<\/th>/gi, "</td>");
		}
		chunks.push(rowHtml);
		cursor = (match.index ?? 0) + match[0].length;
	});
	chunks.push(html.slice(cursor));
	return chunks.join("");
}

function shouldPreserveHandbookTableAsHtml(rows: TableCell[][]): boolean {
	if (rows.length < 4) {
		return false;
	}
	if (rows[0]?.some((cell) => cell.rowspan > 1 || cell.colspan > 1)) {
		return false;
	}
	const emptyCellCount = rows.flat().filter((cell) => !cell.text).length;
	const mergedCellCount = rows.flat().filter((cell) => cell.rowspan > 1 || cell.colspan > 1).length;
	const fieldLabels = new Set([
		"姓名",
		"学号",
		"民族",
		"学院(系)",
		"专业",
		"学制",
		"出生年月日",
		"家庭所在地",
		"火车到站站名",
		"学院(系)领导签字",
	]);
	let fieldLikeLabelCount = 0;
	for (const cell of rows.flat()) {
		const label = cell.text.replace(/\s+/g, "");
		if (fieldLabels.has(label) || label.startsWith("照片")) {
			fieldLikeLabelCount += 1;
		}
	}
	return emptyCellCount >= 3 && mergedCellCount >= 1 && fieldLikeLabelCount >= 4;
}

function hasBlankLeadingHeaderCell(rows: TableCell[][]): boolean {
	return (rows[0]?.length ?? 0) >= 3 && !rows[0]?.[0]?.text;
}

function expandTableRows(rows: TableCell[][]): string[][] {
	const activeRowspans = new Map<number, { text: string; remaining: number }>();
	const expandedRows: string[][] = [];
	let maxWidth = 0;

	for (const sourceRow of rows) {
		const expandedRow: string[] = [];
		let columnIndex = 0;
		const consumeActiveRowspans = () => {
			while (activeRowspans.has(columnIndex)) {
				const active = activeRowspans.get(columnIndex);
				if (!active) {
					break;
				}
				expandedRow.push(active.text);
				if (active.remaining <= 1) {
					activeRowspans.delete(columnIndex);
				} else {
					activeRowspans.set(columnIndex, { text: active.text, remaining: active.remaining - 1 });
				}
				columnIndex += 1;
			}
		};

		consumeActiveRowspans();
		for (const cell of sourceRow) {
			consumeActiveRowspans();
			for (let offset = 0; offset < cell.colspan; offset += 1) {
				expandedRow.push(cell.text);
				if (cell.rowspan > 1) {
					activeRowspans.set(columnIndex + offset, {
						text: cell.text,
						remaining: cell.rowspan - 1,
					});
				}
			}
			columnIndex += cell.colspan;
		}
		consumeActiveRowspans();
		maxWidth = Math.max(maxWidth, expandedRow.length);
		expandedRows.push(expandedRow);
	}

	for (const row of expandedRows) {
		while (row.length < maxWidth) {
			row.push("");
		}
	}
	return expandedRows;
}

function trimTrailingEmptyCells(row: string[]): string[] {
	const trimmed = [...row];
	while (trimmed.length > 0 && !trimmed.at(-1)) {
		trimmed.pop();
	}
	return trimmed;
}

function isSectionRow(row: string[]): boolean {
	const nonempty = row.filter(Boolean);
	if (nonempty.length < 2 || new Set(nonempty).size !== 1) {
		return false;
	}
	return !/^[（(]?[0-9一二三四五六七八九十]+[)）]?$/.test(nonempty[0] ?? "");
}

function renderMarkdownTable(rows: string[][]): string {
	const width = Math.max(...rows.map((row) => row.length));
	const normalizedRows = rows.map((row) => [
		...row,
		...Array.from({ length: width - row.length }, () => ""),
	]);
	if (normalizedRows.length === 1) {
		return `|${normalizedRows[0]?.filter(Boolean).map(escapeMarkdownCell).join("|")}|`;
	}
	const separator = Array.from({ length: width }, () => "---");
	return [
		renderMarkdownRow(normalizedRows[0] ?? []),
		renderMarkdownRow(separator),
		...normalizedRows.slice(1).map(renderMarkdownRow),
	].join("\n");
}

function renderMarkdownRow(row: string[]): string {
	return `|${row.map(escapeMarkdownCell).join("|")}|`;
}

function escapeMarkdownCell(text: string): string {
	return text.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function renderTableBlocks(rows: string[][]): [string, string][] {
	if (rows.some((row) => renderMarkdownRow(row).length > MARKDOWN_LINE_LIMIT)) {
		return [["block", renderMarkdownRecords(rows)]];
	}
	return [["table", renderMarkdownTable(rows)]];
}

function renderMarkdownRecords(rows: string[][]): string {
	if (rows.length < 2) {
		return renderMarkdownTable(rows);
	}
	const headers = rows[0] ?? [];
	const records: string[] = [];
	for (const row of rows.slice(1)) {
		const recordLines: string[] = [];
		let firstField = true;
		for (const [header, value] of iterMarkdownRecordEntries(headers, row)) {
			const label = header ? `${header}：` : "";
			if (firstField) {
				recordLines.push(
					...wrapMarkdownTextLines(`${label}${value}`, {
						initialPrefix: "- ",
						subsequentPrefix: "  ",
					}),
				);
				firstField = false;
			} else {
				recordLines.push(
					...wrapMarkdownTextLines(`${label}${value}`, {
						initialPrefix: "  - ",
						subsequentPrefix: "    ",
					}),
				);
			}
		}
		if (recordLines.length > 0) {
			records.push(recordLines.join("\n"));
		}
	}
	return records.join("\n\n");
}

function iterMarkdownRecordEntries(headers: string[], row: string[]): [string, string][] {
	const compactedCourseEntries = compactCurriculumCourseColspanEntries(headers, row);
	if (compactedCourseEntries) {
		return compactedCourseEntries;
	}
	const entries: [string, string][] = [];
	row.forEach((cell, index) => {
		const value = normalizeMarkdownRecordValue(cell);
		if (!value) {
			return;
		}
		entries.push([(headers[index] ?? "").trim(), value]);
	});
	return entries;
}

function compactCurriculumCourseColspanEntries(
	headers: string[],
	row: string[],
): [string, string][] | undefined {
	const normalizedHeaders = headers.map((header) => header.trim());
	if (
		JSON.stringify(normalizedHeaders.slice(0, 8)) !==
		JSON.stringify(["课程类", "课程号", "课程名称", "学分", "学时", "实践学时", "开设学期", "备注"])
	) {
		return;
	}
	const values = row.map(normalizeMarkdownRecordValue);
	if (values.length < 7 || !values[0]) {
		return;
	}
	const mergedValue = values[1];
	if (!mergedValue) {
		return;
	}
	if (values.slice(1, 7).some((value) => value !== mergedValue)) {
		return;
	}
	const entries: [string, string][] = [
		["课程类", values[0] ?? ""],
		["课程名称", mergedValue],
	];
	if (values[7]) {
		entries.push(["备注", values[7]]);
	}
	return entries;
}

function normalizeMarkdownRecordValue(value: string): string {
	const normalized = value.trim();
	return normalized === "学校通开的全球胜任力培养课程/"
		? "学校通开的全球胜任力培养课程"
		: normalized;
}

function stripTags(html: string): string {
	return html.replace(/<br\s*\/?>/gi, "\n").replace(TAG_RE, "");
}

function normalizeTableCellText(text: string): string {
	return decodeHtmlEntities(text)
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function decodeHtmlEntities(text: string): string {
	return text
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");
}

function attributeValue(attrs: string, name: string): string | undefined {
	const match = new RegExp(`${name}\\s*=\\s*["']?([^"'\\s>]+)`, "i").exec(attrs);
	return match?.[1];
}

function parsePositiveInt(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "1", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function arraysEqual(left: string[] | undefined, right: string[]): boolean {
	return (
		left !== undefined &&
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export function looksLikeHandbookChapterHeading(text: string): boolean {
	return HANDBOOK_CHAPTER_HEADING_RE.test(text);
}

export function looksLikeHandbookArticleHeading(text: string): boolean {
	return HANDBOOK_ARTICLE_HEADING_RE.test(text);
}
