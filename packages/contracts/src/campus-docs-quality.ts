import type { DocsReader } from "./campus-docs-types.ts";

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

	const sourceUrlMarker = reader.elements.find(
		(element) => element.kind === "paragraph" && isStandaloneSourceUrlMarker(element.text),
	);
	if (sourceUrlMarker) {
		throw new Error(`reader contains source URL marker paragraph: ${sourceUrlMarker.rootUnitId}`);
	}

	const documentNumberHeading = reader.elements.find(
		(element) => element.kind === "heading" && isStandaloneFormalDocumentNumber(element.text),
	);
	if (documentNumberHeading) {
		throw new Error(`reader contains document number heading: ${documentNumberHeading.rootUnitId}`);
	}

	for (let index = 0; index + 1 < reader.elements.length; index += 1) {
		const current = reader.elements[index];
		const next = reader.elements[index + 1];
		if (
			current?.kind === "heading" &&
			next?.kind === "heading" &&
			normalizeHeadingText(current.text) === normalizeHeadingText(next.text)
		) {
			throw new Error(
				`reader contains adjacent duplicate headings: ${current.rootUnitId}, ${next.rootUnitId}`,
			);
		}
	}
}

export function isStandaloneSourceUrlMarker(value: string): boolean {
	return /^>\s*Source URL:\s*https?:\/\/\S+$/u.test(normalizeHeadingText(value));
}

export function isStandaloneFormalDocumentNumber(value: string): boolean {
	return /^(?:[\p{Script=Han}A-Za-z]{0,24})[〔（(]\d{4}[〕）)]\s*\d+\s*号$/u.test(
		normalizeHeadingText(value),
	);
}

function normalizeHeadingText(value: string): string {
	return value.replace(/\r\n?/gu, "\n").trim();
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
