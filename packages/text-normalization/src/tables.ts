import { NOTICE_CONTENT_MAX_CELL_SPAN } from "campus-contracts/notices";

interface LogicalTableCell {
	columnSpan: number;
	id: number;
	originRow: number;
	rowSpan: number;
	text: string;
}

interface TableValue {
	columns: number[];
	text: string;
}

type TableTextDeriver = (root: Element, NodeCtor: typeof Node) => string;

export function serializeLogicalTable(
	table: Element,
	NodeCtor: typeof Node,
	deriveText: TableTextDeriver,
): string {
	const rows = tableRows(table);
	if (rows.length === 0) {
		return "";
	}
	const physicalRows = rows.map((row) =>
		tableCells(row).map((cell) => ({
			cell,
			text: normalizeTableCellText(deriveText(cell, NodeCtor)),
		})),
	);
	const grid = buildTableGrid(physicalRows);
	if (!grid) {
		return serializePhysicalRows(physicalRows);
	}
	const headerCount = explicitTableHeaderCount(rows, table);
	if (headerCount === 0) {
		return serializePositionedRows(grid);
	}
	const columnPaths = tableColumnPaths(grid, headerCount);
	return grid
		.slice(headerCount)
		.map((row) => serializeTableRow(row, columnPaths))
		.filter(Boolean)
		.join("\n");
}

function normalizeTableCellText(value: string): string {
	return value
		.replace(/\\n/gu, " ")
		.replace(/[\t\n\r\f\v\u00a0\u3000 ]+/gu, " ")
		.trim();
}

function serializePhysicalRows(
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

function serializePositionedRows(
	grid: readonly (readonly (LogicalTableCell | undefined)[])[],
): string {
	let section: string | null = null;
	const lines: string[] = [];
	for (const [rowIndex, row] of grid.entries()) {
		const sectionCell = tableSectionCell(row, rowIndex, grid[0]?.length ?? 0);
		if (sectionCell) {
			section = sectionCell.text;
			continue;
		}
		const values = uniqueTableCells(row)
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

function buildTableGrid(
	rows: readonly (readonly { cell: Element; text: string }[])[],
): Array<Array<LogicalTableCell | undefined>> | null {
	const grid: Array<Array<LogicalTableCell | undefined>> = [];
	let cellId = 0;
	for (const [rowIndex, row] of rows.entries()) {
		grid[rowIndex] ??= [];
		let columnIndex = 0;
		for (const item of row) {
			while (grid[rowIndex]?.[columnIndex] !== undefined) {
				columnIndex += 1;
			}
			const rowSpan = cellSpan(item.cell.getAttribute("rowspan"));
			const columnSpan = cellSpan(item.cell.getAttribute("colspan"));
			const logicalCell: LogicalTableCell = {
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
					(grid[targetRow] as Array<LogicalTableCell | undefined>)[targetColumn] = logicalCell;
				}
			}
			columnIndex += columnSpan;
		}
	}
	const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
	return grid.map((row) => Array.from({ length: width }, (_, index) => row[index]));
}

function cellSpan(value: string | null): number {
	if (!(value && /^[0-9]+$/u.test(value))) {
		return 1;
	}
	const span = Number(value);
	return span >= 1 && span <= NOTICE_CONTENT_MAX_CELL_SPAN ? span : 1;
}

function tableSectionCell(
	row: readonly (LogicalTableCell | undefined)[],
	rowIndex: number,
	width: number,
): LogicalTableCell | null {
	const cells = uniqueTableCells(row);
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

function uniqueTableCells(row: readonly (LogicalTableCell | undefined)[]): LogicalTableCell[] {
	const cells: LogicalTableCell[] = [];
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

function tableColumnPaths(
	rows: readonly (readonly (LogicalTableCell | undefined)[])[],
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

function serializeTableRow(
	row: readonly (LogicalTableCell | undefined)[],
	columnPaths: readonly (readonly string[])[],
): string {
	const values: TableValue[] = [];
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
		const label = compactTableLabel(columns, columnPaths);
		values.push({ columns, text: label ? `${label}：${cell.text}` : cell.text });
	}
	return values.map((value) => value.text).join("；");
}

function compactTableLabel(
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
