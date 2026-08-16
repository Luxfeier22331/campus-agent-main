import type { DocsReader } from "./source-types.ts";

export function assertReaderExtractionQuality(reader: DocsReader): void {
	const migratedHeading = reader.elements.find((element) =>
		element.rootUnitId.includes(":migrated-heading-"),
	);
	if (migratedHeading) {
		throw new Error(`reader contains migrated heading artifact: ${migratedHeading.rootUnitId}`);
	}

	const pipeTable = reader.elements.find(
		(element) => element.kind === "paragraph" && isMultilinePipeTable(element.text),
	);
	if (pipeTable) {
		throw new Error(`reader contains pipe-table paragraph: ${pipeTable.rootUnitId}`);
	}
}

function isMultilinePipeTable(text: string): boolean {
	let rowCount = 0;
	for (const line of text.split(/\r?\n/u)) {
		if (!isPipeTableRow(line)) {
			continue;
		}
		rowCount += 1;
		if (rowCount >= 2) {
			return true;
		}
	}
	return false;
}

function isPipeTableRow(line: string): boolean {
	if (!line.includes("|")) {
		return false;
	}
	return (
		line
			.split("|")
			.map((cell) => cell.trim())
			.filter(Boolean).length >= 2
	);
}
