import type {
	DocsReaderTableCell,
	DocsReaderTableElement,
} from "campus-contracts/campus-docs";
import { CHUNK_SET_DEFINITION } from "../definitions.ts";
import type { ReaderContentElement } from "./sections.ts";
import { normalizeBlockText } from "./sections.ts";
import type {
	ChunkLimits,
	ChunkPiece,
	LogicalTableCell,
	LogicalTableValue,
	TableContext,
} from "./chunk-model.ts";
import {
	assertChunkSize,
	orderedUnique,
	orderedUniqueBy,
	splitTextByLimits,
	unicodeLength,
} from "./chunk-text.ts";

const TABLE_CONTEXT_MAX_CHARS = Math.floor(CHUNK_SET_DEFINITION.chunking.targetChars / 2);
const TABLE_CONTEXT_SEPARATOR = "\n\n";

export function buildTableContext(
	elements: readonly ReaderContentElement[],
	tableIndex: number,
	table: DocsReaderTableElement,
): TableContext | null {
	const element = elements[tableIndex - 1];
	if (!element || element.kind === "table") return null;
	const content = normalizeBlockText(element.text);
	if (!content || !qualifiesAsTableContext(content, table)) return null;
	if (unicodeLength(content) <= TABLE_CONTEXT_MAX_CHARS) {
		const contextParts = [content];
		const rootUnitIds = [element.rootUnitId];
		const fullyCopiedRootUnitIds = [element.rootUnitId];
		for (let index = tableIndex - 2; index >= 0; index -= 1) {
			const candidate = elements[index];
			if (!candidate || candidate.kind === "table") break;
			const candidateContent = normalizeBlockText(candidate.text);
			if (!isExplicitTableLeadIn(candidateContent)) break;
			const combined = [candidateContent, ...contextParts].join("\n\n");
			if (unicodeLength(combined) > TABLE_CONTEXT_MAX_CHARS) break;
			contextParts.unshift(candidateContent);
			rootUnitIds.unshift(candidate.rootUnitId);
			fullyCopiedRootUnitIds.unshift(candidate.rootUnitId);
		}
		return {
			content: contextParts.join("\n\n"),
			fullyCopiedRootUnitIds,
			rootUnitIds,
		};
	}
	const lastLine = content
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!lastLine) return null;
	const pieces = splitTextByLimits(
		lastLine,
		element.kind,
		TABLE_CONTEXT_MAX_CHARS,
		TABLE_CONTEXT_MAX_CHARS,
	);
	const tail = pieces.at(-1);
	return tail
		? { content: tail, fullyCopiedRootUnitIds: [], rootUnitIds: [element.rootUnitId] }
		: null;
}

export function buildTablePieces(
	table: DocsReaderTableElement,
	versionId: string,
	limits: ChunkLimits,
): ChunkPiece[] {
	const logicalRows = logicalTableGrid(table.rows);
	if (logicalRows.length === 0) return [];
	let leadingHeaderCount = 0;
	while (
		leadingHeaderCount < logicalRows.length &&
		logicalHeaderRow(logicalRows[leadingHeaderCount] ?? [])
	) {
		leadingHeaderCount += 1;
	}
	let rows: string[];
	if (leadingHeaderCount === logicalRows.length) {
		rows = table.rows.flatMap((row) => serializePhysicalTableRow(row, versionId, limits));
	} else {
		const bodyRows = logicalRows.slice(leadingHeaderCount);
		const columnPaths = tableColumnPaths(logicalRows, leadingHeaderCount);
		rows = [
			...serializeUnusedTableHeaders(bodyRows, columnPaths, versionId, limits),
			...bodyRows.flatMap((row) =>
				serializeLogicalTableRow(row, columnPaths, versionId, limits),
			),
		];
	}
	const grouped = groupTableRows(rows, versionId, limits);
	return grouped.map((content) => ({ content, rootUnitIds: [table.rootUnitId] }));
}

export function attachTableContext(
	pieces: readonly ChunkPiece[],
	context: ChunkPiece | null,
): ChunkPiece[] {
	if (!context) return [...pieces];
	return pieces.map((piece) => ({
		content: `${context.content}${TABLE_CONTEXT_SEPARATOR}${piece.content}`,
		rootUnitIds: orderedUnique([...context.rootUnitIds, ...piece.rootUnitIds]),
	}));
}

function qualifiesAsTableContext(content: string, table: DocsReaderTableElement): boolean {
	if (isExplicitTableLeadIn(content)) return true;
	const comparableContent = content.replace(/\s+/gu, "");
	return table.rows.some((row) =>
		row.some((cell) => {
			if (cell.header) return false;
			const term = normalizeBlockText(cell.text).replace(/\s+/gu, "");
			return (
				unicodeLength(term) >= 3 &&
				/[\p{L}\p{Script=Han}]/u.test(term) &&
				comparableContent.includes(term)
			);
		}),
	);
}

function isExplicitTableLeadIn(content: string): boolean {
	return /(?:如下|见下表|具体如下)[：:]?$/u.test(content);
}

function logicalTableGrid(
	rows: readonly DocsReaderTableCell[][],
): Array<Array<LogicalTableCell | undefined>> {
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
					(grid[targetRowIndex] as Array<LogicalTableCell | undefined>)[targetColumnIndex] =
						logicalCell;
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
	return Array.from({ length: width }, (_, columnIndex) =>
		orderedUnique(
			rows
				.slice(0, headerCount)
				.map((row) => row[columnIndex]?.text ?? "")
				.filter(Boolean),
		),
	);
}

function serializeLogicalTableRow(
	row: readonly (LogicalTableCell | undefined)[],
	columnPaths: readonly (readonly string[])[],
	versionId: string,
	limits: ChunkLimits,
): string[] {
	const fields = logicalTableValues(row).flatMap((value) => {
		const label = compactColumnLabel(value.columns, columnPaths);
		return serializeTableValue(value.text, label, versionId, limits);
	});
	return groupTableFields(fields, versionId, limits);
}

function serializeUnusedTableHeaders(
	rows: readonly (readonly (LogicalTableCell | undefined)[])[],
	columnPaths: readonly (readonly string[])[],
	versionId: string,
	limits: ChunkLimits,
): string[] {
	const usedColumns = new Set(
		rows.flatMap((row) => logicalTableValues(row).flatMap((value) => value.columns)),
	);
	const unusedColumns = columnPaths.flatMap((path, columnIndex) =>
		path.length > 0 && !usedColumns.has(columnIndex) ? [columnIndex] : [],
	);
	if (unusedColumns.length === 0) return [];
	const label = compactColumnLabel(unusedColumns, columnPaths);
	return groupTableFields(serializeTableValue(label, "", versionId, limits), versionId, limits);
}

function serializePhysicalTableRow(
	row: readonly DocsReaderTableCell[],
	versionId: string,
	limits: ChunkLimits,
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
		values.flatMap((value) => serializeTableValue(value.text, "", versionId, limits)),
		versionId,
		limits,
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

function appendLogicalTableValue(values: LogicalTableValue[], value: LogicalTableValue): void {
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
		paths.every(
			(path) => path[commonLength] !== undefined && path[commonLength] === paths[0]?.[commonLength],
		)
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

function serializeTableValue(
	text: string,
	label: string,
	versionId: string,
	limits: ChunkLimits,
): string[] {
	const prefix = label ? `${label}：` : "";
	const availableMax = limits.maxChars - unicodeLength(prefix);
	if (availableMax < 1) {
		throw new Error(`Campus docs table column name exceeds Unicode character limit: ${versionId}`);
	}
	const availableTarget = Math.max(
		1,
		Math.min(availableMax, limits.targetChars - unicodeLength(prefix)),
	);
	return splitTextByLimits(text, "paragraph", availableTarget, availableMax).map(
		(value) => `${prefix}${value}`,
	);
}

function groupTableFields(
	fields: readonly string[],
	versionId: string,
	limits: ChunkLimits,
): string[] {
	const result: string[] = [];
	let current: string[] = [];
	for (const field of fields) {
		const currentText = current.join("；");
		const candidate = [...current, field].join("；");
		if (current.length > 0 && unicodeLength(candidate) > limits.maxChars) {
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

function groupTableRows(
	rows: readonly string[],
	versionId: string,
	limits: ChunkLimits,
): string[] {
	const result: string[] = [];
	let current: string[] = [];
	for (const row of rows) {
		const currentText = current.join("\n");
		const candidate = [...current, row].join("\n");
		if (
			current.length > 0 &&
			(unicodeLength(currentText) >= limits.targetChars || unicodeLength(candidate) > limits.maxChars)
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
