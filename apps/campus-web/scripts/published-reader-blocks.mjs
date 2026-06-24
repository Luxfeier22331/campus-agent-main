import { escapeAttribute, escapeHtml } from "./published-reader-text.mjs";

export function renderReaderBlockText(text) {
	const tableHtml = normalizeSafeTableHtml(text);
	if (!tableHtml) {
		return escapeHtml(text);
	}
	return `<div className="docs-table-scroll" data-docs-scrollable="true">\n${tableHtml}\n</div>`;
}

function normalizeSafeTableHtml(value) {
	const text = String(value ?? "").trim();
	if (!/^<table(?:\s[^>]*)?>[\s\S]*<\/table>$/iu.test(text)) {
		return;
	}
	if (text.replace(/<\/?[a-z][^>]*>/giu, "").includes("<")) {
		return;
	}

	const allowedTags = new Set(["table", "thead", "tbody", "tr", "th", "td"]);
	const tagPattern = /<\/?([a-z][a-z0-9-]*)([^>]*)>/giu;
	let normalized = "";
	let cursor = 0;
	let sawTable = false;
	let tableChildDepth = 0;
	let insertedImplicitTbody = false;
	let implicitTbodyOpen = false;
	for (const match of text.matchAll(tagPattern)) {
		const [rawTag, rawTagName, rawAttributes = ""] = match;
		const index = match.index ?? 0;
		const tagName = rawTagName.toLowerCase();
		if (!allowedTags.has(tagName)) {
			return;
		}
		normalized += renderJsxTextNode(text.slice(cursor, index));
		cursor = index + rawTag.length;
		if (rawTag.startsWith("</")) {
			if (tagName === "table" && implicitTbodyOpen) {
				normalized += "</tbody>";
				implicitTbodyOpen = false;
			}
			normalized += `</${tagName}>`;
			if (tagName === "thead" || tagName === "tbody") {
				tableChildDepth = Math.max(0, tableChildDepth - 1);
			}
			continue;
		}
		if (tagName === "table") {
			if (sawTable) {
				return;
			}
			sawTable = true;
		}
		if (tagName === "thead" || tagName === "tbody") {
			tableChildDepth += 1;
		}
		if (tagName === "tr" && sawTable && tableChildDepth === 0 && !insertedImplicitTbody) {
			normalized += "<tbody>";
			insertedImplicitTbody = true;
			implicitTbodyOpen = true;
			tableChildDepth = 1;
		}
		const attributes = normalizeSafeTableAttributes(rawAttributes);
		if (attributes === undefined) {
			return;
		}
		normalized += `<${tagName}${attributes}>`;
	}
	normalized += renderJsxTextNode(text.slice(cursor));
	return sawTable ? normalized : undefined;
}

function renderJsxTextNode(value) {
	if (!value) {
		return "";
	}
	return `{${JSON.stringify(value)}}`;
}

function normalizeSafeTableAttributes(rawAttributes) {
	const source = rawAttributes.trim();
	if (!source) {
		return "";
	}
	const attributes = [];
	let unsupported = false;
	const consumed = source.replace(
		/([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu,
		(_match, rawName, doubleQuoted, singleQuoted, unquoted) => {
			const name = String(rawName).toLowerCase();
			const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
			if (name === "rowspan" || name === "colspan") {
				if (!/^[1-9][0-9]{0,2}$/u.test(value)) {
					throw new Error("unsafe table span attribute");
				}
				attributes.push(
					`${name === "rowspan" ? "rowSpan" : "colSpan"}="${escapeAttribute(value)}"`,
				);
				return "";
			}
			unsupported = true;
			return "";
		},
	);
	if (unsupported || consumed.trim()) {
		return;
	}
	return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}
