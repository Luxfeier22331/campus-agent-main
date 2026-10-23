import { NOTICE_CONTENT_ALLOWED_TAGS } from "campus-contracts/notices";
import { JSDOM } from "jsdom";

const ALLOWED_TAGS = new Set<string>(NOTICE_CONTENT_ALLOWED_TAGS);
const REMOVED_TAGS = ["IFRAME", "FORM", "SCRIPT", "STYLE"];

export interface SanitizedDocument {
	document: Document;
	Node: typeof Node;
}

/**
 * Parse an HTML fragment and apply the generic allow-list sanitization:
 * comments, non-element nodes and script/style/form/iframe content are
 * removed; disallowed tags are unwrapped (children kept); TD/TH cell spans
 * are normalized. Portal-specific image, link and presentation handling
 * stays with the notice domain.
 */
export function sanitizeHtml(html: string): SanitizedDocument {
	const dom = new JSDOM(`<body>${html}</body>`);
	const { document, Node } = dom.window;
	sanitizeChildren(document.body);
	return { document, Node };
}

export function sanitizeChildren(parent: Element): void {
	for (const child of [...parent.childNodes]) {
		if (child.nodeType === child.COMMENT_NODE) {
			child.remove();
			continue;
		}
		if (child.nodeType === child.TEXT_NODE) {
			continue;
		}
		if (child.nodeType !== child.ELEMENT_NODE) {
			child.remove();
			continue;
		}
		const element = child as Element;
		if (REMOVED_TAGS.includes(element.tagName)) {
			element.remove();
			continue;
		}
		sanitizeChildren(element);
		if (!ALLOWED_TAGS.has(element.tagName)) {
			element.replaceWith(...element.childNodes);
		}
	}
}
