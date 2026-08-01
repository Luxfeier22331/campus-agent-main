import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { assertSha256 } from "./source-catalog.ts";

export const DOCS_CONTENT_SCHEMA = "campus_web_docs_content.v4" as const;
export const DOCS_CONTENT_METADATA_FILE = "content.json";

export interface DocsContentMetadata {
	files: string[];
	schemaVersion: typeof DOCS_CONTENT_SCHEMA;
	sourceDigest: `sha256:${string}`;
}

export interface DocsContentPaths {
	generatedRoot: string;
	metadataPath: string;
	objectsRoot: string;
	pagesRoot: string;
	publicRoot: string;
	root: string;
	sourcePath: string;
}

export function resolveSourceDocsContentPaths(
	appRoot: string,
	sourceDigest: string,
): DocsContentPaths {
	const digest = assertSha256(sourceDigest).slice("sha256:".length);
	return resolveDocsContentPaths(
		resolve(appRoot, ".generated/docs-content/sources", `sha256-${digest}`),
	);
}

export function resolveDocsContentPaths(root: string): DocsContentPaths {
	const resolvedRoot = resolve(root);
	return {
		generatedRoot: resolve(resolvedRoot, "build"),
		metadataPath: resolve(resolvedRoot, DOCS_CONTENT_METADATA_FILE),
		objectsRoot: resolve(resolvedRoot, "input/objects"),
		pagesRoot: resolve(resolvedRoot, "pages/docs"),
		publicRoot: resolve(resolvedRoot, "public"),
		root: resolvedRoot,
		sourcePath: resolve(resolvedRoot, "input/source.json"),
	};
}

export function readDocsContentMetadata(path: string): DocsContentMetadata | null {
	if (!existsSync(path)) {
		return null;
	}
	const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error(`docs content metadata is invalid: ${path}`);
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== DOCS_CONTENT_SCHEMA) {
		throw new Error(`docs content metadata schema is invalid: ${path}`);
	}
	if (
		typeof record.sourceDigest === "string" &&
		Array.isArray(record.files) &&
		Object.keys(record).length === 3
	) {
		const files = record.files.map((value, index) => {
			if (typeof value !== "string" || !isSafeContentRelativePath(value)) {
				throw new Error(`docs content metadata file is invalid: ${path}[${index}]`);
			}
			return value;
		});
		if (new Set(files).size !== files.length) {
			throw new Error(`docs content metadata contains duplicate files: ${path}`);
		}
		return {
			files,
			schemaVersion: DOCS_CONTENT_SCHEMA,
			sourceDigest: assertSha256(record.sourceDigest),
		};
	}
	throw new Error(`docs content metadata is invalid: ${path}`);
}

export function isDocsContentReady(
	paths: DocsContentPaths,
	input: { requirePages: boolean; sourceDigest: `sha256:${string}` },
): boolean {
	try {
		const actual = readDocsContentMetadata(paths.metadataPath);
		return (
			actual?.sourceDigest === input.sourceDigest &&
			actual.files.every((file) => existsSync(resolveContentFile(paths.root, file))) &&
			hasRequiredContentFiles(actual.files, input.requirePages)
		);
	} catch {
		return false;
	}
}

export function createDocsContentMetadata(input: {
	paths: DocsContentPaths;
	sourceDigest: `sha256:${string}`;
}): DocsContentMetadata {
	return {
		files: listContentFiles(input.paths),
		schemaVersion: DOCS_CONTENT_SCHEMA,
		sourceDigest: input.sourceDigest,
	};
}

function listContentFiles(paths: DocsContentPaths): string[] {
	const files = [
		...listFiles(paths.generatedRoot, paths.root),
		...listFiles(paths.pagesRoot, paths.root),
		...listFiles(paths.publicRoot, paths.root),
		...(existsSync(paths.sourcePath)
			? [relative(paths.root, paths.sourcePath).replaceAll(sep, "/")]
			: []),
	];
	return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function listFiles(root: string, contentRoot: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const files: string[] = [];
	const directories = [root];
	while (directories.length > 0) {
		const directory = directories.pop();
		if (!directory) {
			continue;
		}
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(path);
				continue;
			}
			if (entry.isFile()) {
				files.push(relative(contentRoot, path).replaceAll(sep, "/"));
			}
		}
	}
	return files;
}

function hasRequiredContentFiles(files: readonly string[], requirePages: boolean): boolean {
	const fileSet = new Set(files);
	if (
		!(
			fileSet.has("input/source.json") &&
			fileSet.has("build/catalog.json") &&
			fileSet.has("public/_docs/site-index.json") &&
			[...fileSet].some((file) =>
				/^public\/_docs\/search\/sha256\/[a-f0-9]{64}\.json$/u.test(file),
			) &&
			[...fileSet].some((file) => /^public\/_docs\/.+\/reader\.json$/u.test(file))
		)
	) {
		return false;
	}
	return !requirePages || [...fileSet].some((file) => /^pages\/docs\/.+\.html$/u.test(file));
}

function resolveContentFile(contentRoot: string, file: string): string {
	if (!isSafeContentRelativePath(file)) {
		throw new Error(`docs content file path is invalid: ${file}`);
	}
	const target = resolve(contentRoot, file);
	if (!(target === contentRoot || target.startsWith(`${contentRoot}${sep}`))) {
		throw new Error(`docs content file escapes root: ${file}`);
	}
	return target;
}

function isSafeContentRelativePath(value: string): boolean {
	return (
		Boolean(value) &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.split("/").some((segment) => !segment || segment === "." || segment === "..")
	);
}
