/**
 * Canonical ordering for digest, manifest, and artifact identity paths.
 *
 * Canonical bytes are a byte-level contract: the sort order must not depend on
 * the runtime locale (ICU default from LC_ALL/LANG). This comparator uses the
 * UTF-16 code-unit order of JavaScript's default string comparison, matching
 * `Array.prototype.sort` and RFC 8785 JSON Canonicalization Scheme.
 *
 * Use it wherever sorted strings feed canonical serialization, digests, or
 * artifact identity. Display orderings keep explicit locales such as
 * `localeCompare(value, "zh-CN")`.
 */
export function compareCanonicalStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
