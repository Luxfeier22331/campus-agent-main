import { NOTICE_CONTENT_MAX_CELL_SPAN } from "campus-contracts/notices";

interface LogicalNoticeTableCell {
	columnSpan: number;
	id: number;
	originRow: number;
	rowSpan: number;
	text: string;
}

interface NoticeTableValue {
	columns: number[];
	text: string;
}

type NoticeTableTextDeriver = (root: Element, NodeCtor: typeof Node) => string;

export function serializeLogicalNoticeTable(
	table: Element,
	NodeCtor: typeof Node,
	deriveText: NoticeTableTextDeriver,
): string {
	const rows = tableRows(table);
	if (rows.length === 0) {
		return "";
	}
	const physicalRows = rows.map((row) =>
		tableCells(row).map((cell) => ({
			cell,
			text: normalizeNoticeTableCellText(deriveText(cell, NodeCtor)),
		})),
	);
	const grid = buildNoticeTableGrid(physicalRows);
	if (!grid) {
		return serializePhysicalNoticeRows(physicalRows);
	}
	const headerCount = explicitTableHeaderCount(rows, table);
	if (headerCount === 0) {
		return serializePositionedNoticeRows(grid);
	}
	const columnPaths = noticeTableColumnPaths(grid, headerCount);
	return grid
		.slice(headerCount)
		.map((row) => serializeNoticeTableRow(row, columnPaths))
		.filter(Boolean)
		.join("\n");
}

function normalizeNoticeTableCellText(value: string): string {
	return value.replace(/[\t\n\r\f\v\u00a0\u3000 ]+/gu, " ").trim();
}

function serializePhysicalNoticeRows(
	rows: readonly (readonly { cell: Element; text: string }[])[],
): string {
	return rows
		.map((row) =>
			row
				.map((cell) => cell.text)
				.filter(Boolean)
				.join("；"),
		)
		.filter(Boolean)
		.join("\n");
}

function explicitTableHeaderCount(rows: readonly Element[], table: Element): number {
	const headerRows = new Set([...table.querySelectorAll("THEAD > TR, THEAD > TBODY > TR")]);
	let count = 0;
	while (count < rows.length && headerRows.has(rows[count] as Element)) {
		count += 1;
	}
	return count;
}

function serializePositionedNoticeRows(
	grid: readonly (readonly (LogicalNoticeTableCell | undefined)[])[],
): string {
	let section: string | null = null;
	const lines: string[] = [];
	for (const [rowIndex, row] of grid.entries()) {
		const sectionCell = noticeTableSectionCell(row, rowIndex, grid[0]?.length ?? 0);
		if (sectionCell) {
			section = sectionCell.text;
			continue;
		}
		const values = uniqueNoticeTableCells(row)
			.map((cell) => cell.text)
			.filter(Boolean);
		if (values.length === 0) {
			continue;
		}
		lines.push([section, ...values].filter(Boolean).join("；"));
	}
	return lines.join("\n");
}

function tableRows(table: Element): Element[] {
	const rows: Element[] = [];
	for (const child of [...table.children]) {
		if (child.tagName === "TR") {
			rows.push(child);
			continue;
		}
		if (!["THEAD", "TBODY", "TFOOT"].includes(child.tagName)) {
			continue;
		}
		for (const row of [...child.children]) {
			if (row.tagName === "TR") {
				rows.push(row);
			}
		}
	}
	return rows;
}

function tableCells(row: Element): Element[] {
	return [...row.children].filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
}

function buildNoticeTableGrid(
	rows: readonly (readonly { cell: Element; text: string }[])[],
): Array<Array<LogicalNoticeTableCell | undefined>> | null {
	const grid: Array<Array<LogicalNoticeTableCell | undefined>> = [];
	let cellId = 0;
	for (const [rowIndex, row] of rows.entries()) {
		grid[rowIndex] ??= [];
		let columnIndex = 0;
		for (const item of row) {
			while (grid[rowIndex]?.[columnIndex] !== undefined) {
				columnIndex += 1;
			}
			const rowSpan = noticeCellSpan(item.cell.getAttribute("rowspan"));
			const columnSpan = noticeCellSpan(item.cell.getAttribute("colspan"));
			const logicalCell: LogicalNoticeTableCell = {
				columnSpan,
				id: cellId,
				originRow: rowIndex,
				rowSpan,
				text: item.text,
			};
			cellId += 1;
			for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
				const targetRow = rowIndex + rowOffset;
				grid[targetRow] ??= [];
				for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
					const targetColumn = columnIndex + columnOffset;
					if (grid[targetRow]?.[targetColumn] !== undefined) {
						return null;
					}
					(grid[targetRow] as Array<LogicalNoticeTableCell | undefined>)[targetColumn] =
						logicalCell;
				}
			}
			columnIndex += columnSpan;
		}
	}
	const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
	return grid.map((row) => Array.from({ length: width }, (_, index) => row[index]));
}

function noticeCellSpan(value: string | null): number {
	if (!(value && /^[0-9]+$/u.test(value))) {
		return 1;
	}
	const span = Number(value);
	return span >= 1 && span <= NOTICE_CONTENT_MAX_CELL_SPAN ? span : 1;
}

function noticeTableSectionCell(
	row: readonly (LogicalNoticeTableCell | undefined)[],
	rowIndex: number,
	width: number,
): LogicalNoticeTableCell | null {
	const cells = uniqueNoticeTableCells(row);
	const cell = cells[0];
	return cell &&
		width > 1 &&
		cells.length === 1 &&
		cell.originRow === rowIndex &&
		cell.columnSpan >= width &&
		cell.text
		? cell
		: null;
}

function uniqueNoticeTableCells(
	row: readonly (LogicalNoticeTableCell | undefined)[],
): LogicalNoticeTableCell[] {
	const cells: LogicalNoticeTableCell[] = [];
	const seen = new Set<number>();
	for (const cell of row) {
		if (!cell || seen.has(cell.id)) {
			continue;
		}
		seen.add(cell.id);
		cells.push(cell);
	}
	return cells;
}

function noticeTableColumnPaths(
	rows: readonly (readonly (LogicalNoticeTableCell | undefined)[])[],
	headerCount: number,
): string[][] {
	const width = rows[0]?.length ?? 0;
	return Array.from({ length: width }, (_, columnIndex) => [
		...new Set(
			rows
				.slice(0, headerCount)
				.map((row) => row[columnIndex]?.text ?? "")
				.filter(Boolean),
		),
	]);
}

function serializeNoticeTableRow(
	row: readonly (LogicalNoticeTableCell | undefined)[],
	columnPaths: readonly (readonly string[])[],
): string {
	const values: NoticeTableValue[] = [];
	const emitted = new Set<number>();
	for (const cell of row) {
		if (!cell || emitted.has(cell.id)) {
			continue;
		}
		emitted.add(cell.id);
		if (!cell.text) {
			continue;
		}
		const columns = row.flatMap((candidate, index) => (candidate?.id === cell.id ? [index] : []));
		const label = compactNoticeTableLabel(columns, columnPaths);
		values.push({ columns, text: label ? `${label}：${cell.text}` : cell.text });
	}
	return values.map((value) => value.text).join("；");
}

function compactNoticeTableLabel(
	columns: readonly number[],
	columnPaths: readonly (readonly string[])[],
): string {
	const paths = [
		...new Map(
			columns
				.map((column) => columnPaths[column] ?? [])
				.filter((path) => path.length > 0)
				.map((path) => [path.join("\u0000"), path] as const),
		).values(),
	];
	if (paths.length === 0) {
		return "";
	}
	if (paths.length === 1) {
		return paths[0]?.join(" / ") ?? "";
	}
	return paths.map((path) => path.join(" / ")).join("、");
}
