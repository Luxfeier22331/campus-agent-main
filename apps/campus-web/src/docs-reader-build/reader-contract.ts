import type {
	DocsReader,
	DocsReaderElement,
	DocsReaderTableCell,
	DocsReaderTableElement,
} from "./source-types.ts";
import { assertDocsTableLayout } from "./table-layout.ts";

const READER_KEYS = ["docId", "elements", "schemaVersion", "supplements", "versionId"] as const;
const HEADING_KEYS = ["anchor", "kind", "level", "rootUnitId", "text"] as const;
const TABLE_KEYS = ["kind", "rootUnitId", "rows"] as const;
const TEXT_KEYS = ["kind", "rootUnitId", "text"] as const;
const TABLE_CELL_KEYS = ["colSpan", "header", "rowSpan", "text"] as const;
const SUPPLEMENT_KEYS = ["kind", "path"] as const;

export function parseDocsReaderContract(value: unknown): DocsReader {
	const record = requiredRecord(value, "reader");
	assertExactKeys(record, READER_KEYS, "reader");
	if (record.schemaVersion !== "campus_docs_reader.v3" || !Array.isArray(record.elements)) {
		throw new Error("reader schema is invalid");
	}
	const elements = record.elements.map((element, index) =>
		parseReaderElement(element, `reader.elements[${index}]`),
	);
	assertReaderElementIdentity(elements);
	return {
		docId: requiredString(record.docId, "reader.docId"),
		elements,
		schemaVersion: "campus_docs_reader.v3",
		supplements: parseReaderSupplements(record.supplements),
		versionId: requiredString(record.versionId, "reader.versionId"),
	};
}

function parseReaderElement(value: unknown, label: string): DocsReaderElement {
	const record = requiredRecord(value, label);
	const kind = requiredString(record.kind, `${label}.kind`);
	const rootUnitId = requiredString(record.rootUnitId, `${label}.rootUnitId`);
	if (kind === "heading") {
		assertExactKeys(record, HEADING_KEYS, label);
		const level = requiredInteger(record.level, `${label}.level`);
		if (level < 2 || level > 6) {
			throw new Error(`${label}.level must be between 2 and 6`);
		}
		return {
			anchor: requiredString(record.anchor, `${label}.anchor`),
			kind,
			level: level as 2 | 3 | 4 | 5 | 6,
			rootUnitId,
			text: requiredString(record.text, `${label}.text`),
		};
	}
	if (kind === "table") {
		assertExactKeys(record, TABLE_KEYS, label);
		return parseTableElement(record, label, rootUnitId);
	}
	if (kind !== "paragraph" && kind !== "list" && kind !== "blockquote") {
		throw new Error(`${label}.kind is unsupported`);
	}
	assertExactKeys(record, TEXT_KEYS, label);
	return {
		kind,
		rootUnitId,
		text: requiredString(record.text, `${label}.text`),
	};
}

function parseTableElement(
	record: Record<string, unknown>,
	label: string,
	rootUnitId: string,
): DocsReaderTableElement {
	if (!Array.isArray(record.rows) || record.rows.length === 0) {
		throw new Error(`${label}.rows must be a non-empty array`);
	}
	const rows = record.rows.map((row, rowIndex) => {
		if (!Array.isArray(row) || row.length === 0) {
			throw new Error(`${label}.rows[${rowIndex}] must be a non-empty array`);
		}
		return row.map((cell, cellIndex) =>
			parseTableCell(cell, `${label}.rows[${rowIndex}][${cellIndex}]`),
		);
	});
	assertDocsTableLayout(rows, `${label} (${rootUnitId})`);
	return { kind: "table", rootUnitId, rows };
}

function parseTableCell(value: unknown, label: string): DocsReaderTableCell {
	const record = requiredRecord(value, label);
	assertExactKeys(record, TABLE_CELL_KEYS, label);
	if (typeof record.header !== "boolean") {
		throw new Error(`${label}.header must be a boolean`);
	}
	if (typeof record.text !== "string") {
		throw new Error(`${label}.text must be a string`);
	}
	return {
		...(record.colSpan === undefined
			? {}
			: { colSpan: requiredPositiveInteger(record.colSpan, `${label}.colSpan`) }),
		header: record.header,
		...(record.rowSpan === undefined
			? {}
			: { rowSpan: requiredPositiveInteger(record.rowSpan, `${label}.rowSpan`) }),
		text: record.text,
	};
}

function parseReaderSupplements(value: unknown): DocsReader["supplements"] {
	if (!Array.isArray(value)) {
		throw new Error("reader.supplements must be an array");
	}
	return value.map((item, index) => {
		const label = `reader.supplements[${index}]`;
		const record = requiredRecord(item, label);
		assertExactKeys(record, SUPPLEMENT_KEYS, label);
		if (record.kind !== "course_maps" || record.path !== "course-maps.json") {
			throw new Error(`${label} is unsupported`);
		}
		return { kind: "course_maps", path: "course-maps.json" };
	});
}

function assertReaderElementIdentity(elements: DocsReaderElement[]): void {
	const anchors = new Set<string>();
	const rootUnitIds = new Set<string>();
	for (const element of elements) {
		if (rootUnitIds.has(element.rootUnitId)) {
			throw new Error(`reader rootUnitId is duplicated: ${element.rootUnitId}`);
		}
		rootUnitIds.add(element.rootUnitId);
		if (element.kind === "heading") {
			if (anchors.has(element.anchor)) {
				throw new Error(`reader heading anchor is duplicated: ${element.anchor}`);
			}
			anchors.add(element.anchor);
		}
	}
}

function assertExactKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
	if (unexpected.length > 0) {
		throw new Error(`${label} has unsupported fields: ${unexpected.sort().join(", ")}`);
	}
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function requiredInteger(value: unknown, field: string): number {
	if (!(typeof value === "number" && Number.isSafeInteger(value))) {
		throw new Error(`${field} must be an integer`);
	}
	return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
	const integer = requiredInteger(value, field);
	if (integer < 1) {
		throw new Error(`${field} must be a positive integer`);
	}
	return integer;
}
