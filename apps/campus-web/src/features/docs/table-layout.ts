export interface DocsTableLayoutCell {
	colSpan?: number;
	rowSpan?: number;
	text: string;
}

export interface DocsTableLayoutViolation {
	cellIndex?: number;
	columnIndexes?: number[];
	kind: "incomplete-row" | "row-span-out-of-bounds" | "span-overlap";
	rowIndex: number;
}

export interface DocsTableLayout {
	columnCount: number;
	expandedRows: string[][];
	violations: DocsTableLayoutViolation[];
}

interface ActiveRowSpan {
	remainingRows: number;
	text: string;
}

export function analyzeDocsTableLayout(
	rows: readonly (readonly DocsTableLayoutCell[])[],
): DocsTableLayout {
	let activeRowSpans = new Map<number, ActiveRowSpan>();
	let columnCount = 0;
	const rowValues: Array<Array<string | undefined>> = [];
	const rowOccupancies: Set<number>[] = [];
	const violations: DocsTableLayoutViolation[] = [];

	for (const [rowIndex, row] of rows.entries()) {
		const occupiedColumns = new Set(activeRowSpans.keys());
		const values: Array<string | undefined> = [];
		const nextRowSpans = new Map<number, ActiveRowSpan>();
		for (const [columnIndex, active] of activeRowSpans) {
			values[columnIndex] = active.text;
			if (active.remainingRows > 1) {
				nextRowSpans.set(columnIndex, {
					remainingRows: active.remainingRows - 1,
					text: active.text,
				});
			}
		}

		let columnIndex = 0;
		for (const [cellIndex, cell] of row.entries()) {
			while (occupiedColumns.has(columnIndex)) {
				columnIndex += 1;
			}
			const colSpan = Math.max(1, cell.colSpan ?? 1);
			const rowSpan = Math.max(1, cell.rowSpan ?? 1);
			const coveredColumns = Array.from(
				{ length: colSpan },
				(_value, offset) => columnIndex + offset,
			);
			if (coveredColumns.some((coveredColumn) => occupiedColumns.has(coveredColumn))) {
				violations.push({ cellIndex, kind: "span-overlap", rowIndex });
			}
			if (rowIndex + rowSpan > rows.length) {
				violations.push({ cellIndex, kind: "row-span-out-of-bounds", rowIndex });
			}

			for (const coveredColumn of coveredColumns) {
				if (!occupiedColumns.has(coveredColumn)) {
					values[coveredColumn] = cell.text;
					occupiedColumns.add(coveredColumn);
				}
				if (rowSpan > 1 && !nextRowSpans.has(coveredColumn)) {
					nextRowSpans.set(coveredColumn, {
						remainingRows: rowSpan - 1,
						text: cell.text,
					});
				}
			}
			columnIndex += colSpan;
		}

		const lastOccupiedColumn = Math.max(-1, ...occupiedColumns);
		columnCount = Math.max(columnCount, lastOccupiedColumn + 1);
		rowOccupancies.push(occupiedColumns);
		rowValues.push(values);
		activeRowSpans = nextRowSpans;
	}

	for (const [rowIndex, occupiedColumns] of rowOccupancies.entries()) {
		const missingColumns = Array.from({ length: columnCount }, (_value, index) => index).filter(
			(columnIndex) => !occupiedColumns.has(columnIndex),
		);
		if (missingColumns.length > 0) {
			violations.push({
				columnIndexes: missingColumns,
				kind: "incomplete-row",
				rowIndex,
			});
		}
	}

	return {
		columnCount,
		expandedRows: rowValues.map((values) =>
			Array.from({ length: columnCount }, (_value, index) => values[index] ?? ""),
		),
		violations,
	};
}

export function assertDocsTableLayout(
	rows: readonly (readonly DocsTableLayoutCell[])[],
	label: string,
): void {
	const violation = analyzeDocsTableLayout(rows).violations[0];
	if (!violation) {
		return;
	}
	throw new Error(`${label} has invalid table layout: ${formatViolation(violation)}`);
}

function formatViolation(violation: DocsTableLayoutViolation): string {
	const rowNumber = violation.rowIndex + 1;
	if (violation.kind === "incomplete-row") {
		const columns = (violation.columnIndexes ?? []).map((index) => index + 1).join(", ");
		return `row ${rowNumber} is missing logical columns ${columns}`;
	}
	const cellNumber = (violation.cellIndex ?? 0) + 1;
	return violation.kind === "span-overlap"
		? `row ${rowNumber} cell ${cellNumber} overlaps an active rowSpan`
		: `row ${rowNumber} cell ${cellNumber} rowSpan exceeds the table row count`;
}
