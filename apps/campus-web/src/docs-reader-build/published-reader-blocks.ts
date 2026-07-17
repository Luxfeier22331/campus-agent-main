import { escapeHtml } from "./published-reader-text.ts";

interface ReaderTableCell {
	colSpan?: number;
	rowSpan?: number;
	tag: "td" | "th";
	text: string;
}

export function renderReaderBlockText(text: string): string {
	const rows = parseSafeTableRows(text);
	if (!rows) {
		return escapeHtml(text);
	}
	return `<ReaderTable rows={${JSON.stringify(rows)}} />`;
}

function parseSafeTableRows(value: unknown): ReaderTableCell[][] | undefined {
	const source = String(value ?? "").trim();
	const tableMatch = source.match(/^<table([^>]*)>([\s\S]*)<\/table>$/iu);
	if (!tableMatch || tableMatch[1]?.trim()) {
		return;
	}
	if (source.replace(/<\/?[a-z][^>]*>/giu, "").includes("<")) {
		return;
	}
	if (!hasOnlySafeTableMarkup(source)) {
		return;
	}

	const tableBody = tableMatch[2] ?? "";
	const rowPattern = /<tr\s*>([\s\S]*?)<\/tr>/giu;
	const rows: ReaderTableCell[][] = [];
	let rowMatch = rowPattern.exec(tableBody);
	while (rowMatch) {
		const row = parseSafeTableRow(rowMatch[1] ?? "");
		if (!row) {
			return;
		}
		rows.push(row);
		rowMatch = rowPattern.exec(tableBody);
	}
	const outsideRows = tableBody
		.replace(rowPattern, "")
		.replace(/<\/?(?:thead|tbody)\s*>/giu, "")
		.trim();
	return rows.length > 0 && !outsideRows ? rows : undefined;
}

function hasOnlySafeTableMarkup(source: string): boolean {
	const allowedTags = new Set(["table", "thead", "tbody", "tr", "th", "td"]);
	for (const match of source.matchAll(/<\/?([a-z][a-z0-9-]*)([^>]*)>/giu)) {
		const tagName = String(match[1]).toLowerCase();
		const attributes = String(match[2] ?? "").trim();
		if (!allowedTags.has(tagName)) {
			return false;
		}
		if (!(match[0].startsWith("</") || ["td", "th"].includes(tagName)) && attributes) {
			return false;
		}
		if (["td", "th"].includes(tagName) && parseSafeSpans(attributes) === undefined) {
			return false;
		}
	}
	return true;
}

function parseSafeTableRow(source: string): ReaderTableCell[] | undefined {
	const cells: ReaderTableCell[] = [];
	const cellPattern = /<(th|td)([^>]*)>([^<]*)<\/\1>/giu;
	let cursor = 0;
	let match = cellPattern.exec(source);
	while (match) {
		if (source.slice(cursor, match.index).trim()) {
			return;
		}
		const spans = parseSafeSpans(String(match[2] ?? "").trim());
		if (!spans) {
			return;
		}
		cells.push({
			...spans,
			tag: String(match[1]).toLowerCase() === "th" ? "th" : "td",
			text: String(match[3] ?? "").trim(),
		});
		cursor = cellPattern.lastIndex;
		match = cellPattern.exec(source);
	}
	return cells.length > 0 && !source.slice(cursor).trim() ? cells : undefined;
}

function parseSafeSpans(source: string): Pick<ReaderTableCell, "colSpan" | "rowSpan"> | undefined {
	if (!source) {
		return {};
	}
	const spans: Pick<ReaderTableCell, "colSpan" | "rowSpan"> = {};
	let unsupported = false;
	const consumed = source.replace(
		/([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu,
		(
			_match: string,
			rawName: string,
			doubleQuoted: string | undefined,
			singleQuoted: string | undefined,
			unquoted: string | undefined,
		) => {
			const name = rawName.toLowerCase();
			const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
			if (!((name === "rowspan" || name === "colspan") && /^[1-9][0-9]{0,2}$/u.test(value))) {
				unsupported = true;
				return "";
			}
			const numberValue = Number.parseInt(value, 10);
			if (name === "rowspan") {
				if (spans.rowSpan !== undefined) {
					unsupported = true;
				}
				spans.rowSpan = numberValue;
			} else {
				if (spans.colSpan !== undefined) {
					unsupported = true;
				}
				spans.colSpan = numberValue;
			}
			return "";
		},
	);
	return unsupported || consumed.trim() ? undefined : spans;
}
