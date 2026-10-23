export type { SanitizedDocument } from "./sanitize.ts";
export { sanitizeChildren, sanitizeHtml } from "./sanitize.ts";
export { serializeLogicalTable } from "./tables.ts";
export {
	BLOCK_TAGS,
	deriveStructuredText,
	normalizeComparableText,
	normalizeInlineWhitespace,
} from "./text.ts";

import { sanitizeHtml } from "./sanitize.ts";
import { deriveStructuredText } from "./text.ts";

/**
 * Parse an HTML fragment, apply the generic allow-list sanitization and
 * derive the structured text (block boundaries, BR line breaks, tables
 * serialized as logical `；`-joined rows).
 */
export function htmlToStructuredText(html: string): string {
	const { document, Node } = sanitizeHtml(html);
	return deriveStructuredText(document.body, Node);
}
