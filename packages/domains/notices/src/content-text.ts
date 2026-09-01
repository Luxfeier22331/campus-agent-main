import { BLOCK_TAGS } from "./content-constants.ts";
import { serializeLogicalNoticeTable } from "./content-tables.ts";

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
			const tableText = serializeLogicalNoticeTable(element, NodeCtor, deriveStructuredText);
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
	return value.replace(/[\t\n\r\f\v \u00a0\u3000]+/gu, " ");
}

export function normalizeComparableText(value: string): string {
	return value.replace(/[\s\u200b]+/gu, " ").trim();
}

export function compactCssValue(value: string): string {
	return value.toLowerCase().replace(/\s+/gu, "").trim();
}
