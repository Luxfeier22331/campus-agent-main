import { serializeLogicalTable } from "./tables.ts";

export const BLOCK_TAGS = new Set([
	"BLOCKQUOTE",
	"H3",
	"H4",
	"H5",
	"H6",
	"LI",
	"P",
	"TABLE",
	"TD",
	"TH",
	"TR",
]);

export function deriveStructuredText(root: Element, NodeCtor: typeof Node): string {
	const parts: string[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === NodeCtor.TEXT_NODE) {
			parts.push(node.textContent ?? "");
			return;
		}
		if (node.nodeType !== NodeCtor.ELEMENT_NODE) {
			return;
		}
		const element = node as Element;
		if (element.tagName === "TABLE") {
			const tableText = serializeLogicalTable(element, NodeCtor, deriveStructuredText);
			if (tableText) {
				parts.push(tableText);
			}
			parts.push("\n");
			return;
		}
		if (element.tagName === "BR") {
			parts.push("\n");
		}
		for (const child of [...element.childNodes]) {
			visit(child);
		}
		if (BLOCK_TAGS.has(element.tagName)) {
			parts.push("\n");
		}
	};
	visit(root);
	return parts
		.join("")
		.replace(/[\t\f\v \u00a0]+/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

export function normalizeInlineWhitespace(value: string): string {
	return value.replace(/[\t\n\r\f\v\u00a0\u3000]+/gu, " ");
}

export function normalizeComparableText(value: string): string {
	return value.replace(/[\s\u200b]+/gu, " ").trim();
}
