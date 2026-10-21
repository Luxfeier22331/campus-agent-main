export {
	deriveStructuredText,
	normalizeComparableText,
	normalizeInlineWhitespace,
} from "@campus-agent/text-normalization";

export function compactCssValue(value: string): string {
	return value.toLowerCase().replace(/\s+/gu, "").trim();
}
