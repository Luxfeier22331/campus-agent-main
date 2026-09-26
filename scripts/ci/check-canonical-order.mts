import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Canonical ordering gate.
 *
 * Artifact identity code (digests, manifests, published object ordering, and
 * the tests that pin their bytes) must not depend on the runtime locale. Such
 * code sorts strings with `compareCanonicalStrings` from
 * `campus-contracts/canonical-order`. Default-locale string operations
 * (`localeCompare` without a locale argument, `toLocaleLowerCase()` /
 * `toLocaleUpperCase()` without an argument) are banned in the scoped paths.
 * Display orderings keep explicit locales such as `localeCompare(value, "zh-CN")`
 * and are therefore allowed.
 */
export const CANONICAL_ORDER_PATHS = [
	"packages/contracts/src",
	"packages/contracts/test",
	"packages/domains/dining/src",
	"packages/domains/dining/test",
	"apps/campus-web/src/docs-reader-build",
	"apps/campus-web/scripts/seed-local-docs-source.ts",
	"apps/campus-web/test/helpers/docs-search-index-fixture.ts",
	"jobs/campus-docs-index-publisher/src",
	"jobs/campus-docs-index-publisher/test",
	"jobs/campus-rag-index-publisher/src",
	"jobs/campus-rag-index-publisher/test",
	"jobs/notice-index-publisher/src",
	"jobs/notice-index-publisher/test",
	"jobs/notice-publisher/src",
	"jobs/notice-publisher/test",
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

export interface CanonicalOrderViolation {
	column: number;
	excerpt: string;
	file: string;
	kind: "locale-compare" | "locale-case";
	line: number;
}

const METHOD_NAMES = ["localeCompare", "toLocaleLowerCase", "toLocaleUpperCase"] as const;

export function collectCanonicalOrderViolations(
	repositoryRoot: string,
	paths: readonly string[] = CANONICAL_ORDER_PATHS,
): CanonicalOrderViolation[] {
	const violations: CanonicalOrderViolation[] = [];
	for (const scopedPath of paths) {
		for (const file of collectSourceFiles(resolve(repositoryRoot, scopedPath))) {
			violations.push(...findFileViolations(repositoryRoot, file));
		}
	}
	return violations.sort((left, right) =>
		left.file === right.file
			? left.line - right.line || left.column - right.column
			: left.file < right.file
				? -1
				: 1,
	);
}

function collectSourceFiles(root: string): string[] {
	const stats = statSync(root, { throwIfNoEntry: false });
	if (!stats) {
		return [];
	}
	if (stats.isFile()) {
		const name = basename(root);
		const extension = name.slice(name.lastIndexOf("."));
		return SOURCE_EXTENSIONS.has(extension) ? [root] : [];
	}
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist") {
			continue;
		}
		files.push(...collectSourceFiles(join(root, entry.name)));
	}
	return files;
}

function findFileViolations(repositoryRoot: string, file: string): CanonicalOrderViolation[] {
	const source = readFileSync(file, "utf8");
	const masked = maskCommentsAndStringBodies(source);
	const violations: CanonicalOrderViolation[] = [];
	for (const methodName of METHOD_NAMES) {
		const needle = `.${methodName}(`;
		for (
			let index = masked.indexOf(needle);
			index !== -1;
			index = masked.indexOf(needle, index + 1)
		) {
			const argumentCount = countCallArguments(masked, index + needle.length - 1);
			if (argumentCount < 0) {
				continue;
			}
			const needsLocale = methodName === "localeCompare" ? 2 : 1;
			if (argumentCount >= needsLocale) {
				continue;
			}
			const { line, column } = lineColumn(source, index);
			violations.push({
				column,
				excerpt: trimmedLine(source, line),
				file: relative(repositoryRoot, file),
				kind: methodName === "localeCompare" ? "locale-compare" : "locale-case",
				line,
			});
		}
	}
	return violations;
}

/**
 * Blank comment bodies and string literal bodies with spaces so call-site
 * detection and argument counting see only code structure. Offsets are
 * preserved, and only false negatives (not false positives) can result from
 * regex literals that contain quotes.
 */
function maskCommentsAndStringBodies(source: string): string {
	const characters = [...source];
	let index = 0;
	while (index < characters.length) {
		const character = characters[index];
		if (character === "/" && characters[index + 1] === "/") {
			while (index < characters.length && characters[index] !== "\n") {
				characters[index] = " ";
				index += 1;
			}
			continue;
		}
		if (character === "/" && characters[index + 1] === "*") {
			const end = source.indexOf("*/", index + 2);
			const stop = end === -1 ? characters.length : end + 2;
			while (index < stop) {
				if (characters[index] !== "\n") {
					characters[index] = " ";
				}
				index += 1;
			}
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const quote = character;
			index += 1;
			while (index < characters.length) {
				if (characters[index] === "\\") {
					characters[index] = " ";
					if (index + 1 < characters.length) {
						characters[index + 1] = " ";
					}
					index += 2;
					continue;
				}
				if (quote === "`" && characters[index] === "$" && characters[index + 1] === "{") {
					// Keep template interpolation bodies: they are executable code.
					characters[index] = " ";
					characters[index + 1] = " ";
					index += 2;
					let depth = 1;
					while (index < characters.length && depth > 0) {
						if (characters[index] === "{") {
							depth += 1;
						} else if (characters[index] === "}") {
							depth -= 1;
						}
						if (depth > 0) {
							index += 1;
						}
					}
					if (index < characters.length) {
						characters[index] = " ";
						index += 1;
					}
					continue;
				}
				if (characters[index] === quote) {
					index += 1;
					break;
				}
				if (characters[index] !== "\n") {
					characters[index] = " ";
				}
				index += 1;
			}
			continue;
		}
		index += 1;
	}
	return characters.join("");
}

/** Count top-level arguments of the call whose "(" is at openIndex; -1 when unbalanced. */
function countCallArguments(masked: string, openIndex: number): number {
	let depth = 0;
	let commas = 0;
	let sawContent = false;
	for (let index = openIndex + 1; index < masked.length; index += 1) {
		const character = masked[index];
		if (character === "(" || character === "[" || character === "{") {
			depth += 1;
		} else if (character === ")" || character === "]" || character === "}") {
			if (depth === 0) {
				return sawContent || commas > 0 ? commas + 1 : 0;
			}
			depth -= 1;
		} else if (character === "," && depth === 0) {
			commas += 1;
		} else if (character !== " " && character !== "\t" && character !== "\n") {
			sawContent = true;
		}
	}
	return -1;
}

function lineColumn(source: string, offset: number): { column: number; line: number } {
	let line = 1;
	let lineStart = 0;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === "\n") {
			line += 1;
			lineStart = index + 1;
		}
	}
	return { column: offset - lineStart + 1, line };
}

function trimmedLine(source: string, line: number): string {
	return source.split("\n")[line - 1]?.trim() ?? "";
}

function main(): void {
	const repositoryRoot = process.cwd();
	const violations = collectCanonicalOrderViolations(repositoryRoot);
	if (violations.length === 0) {
		console.log("canonical-order: ok");
		return;
	}
	for (const violation of violations) {
		console.error(
			`canonical-order: ${violation.file}:${violation.line}:${violation.column}: ` +
				`${violation.kind === "locale-compare" ? "localeCompare without a locale argument" : "locale case conversion without a locale argument"} ` +
				"in artifact identity code; use compareCanonicalStrings from campus-contracts/canonical-order " +
				`(display orderings keep an explicit locale): ${violation.excerpt}`,
		);
	}
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "canonical-order")).href) {
	main();
}
