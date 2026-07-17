import { resolve } from "node:path";
import { writeText } from "./published-reader-text.ts";
import type { RoutedPublishedReaderManifestEntry } from "./published-reader-types.ts";

export function writeBootstrapPages(docsRoot: string): void {
	writeText(
		resolve(docsRoot, "reader-bootstrap.mdx"),
		[
			"---",
			'title: "文档阅读"',
			"footer: false",
			'docsSearchVisibility: "noindex"',
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"---",
			"",
			'import GatedReaderBootstrap from "@/components/docs/gated-reader-bootstrap";',
			"",
			"<GatedReaderBootstrap />",
			"",
		].join("\n"),
	);
	writeText(
		resolve(docsRoot, "collection-bootstrap.mdx"),
		[
			"---",
			'title: "文档目录"',
			"footer: false",
			'docsSearchVisibility: "noindex"',
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"outline: false",
			"---",
			"",
			'import GatedCollectionBootstrap from "@/components/docs/gated-collection-bootstrap";',
			"",
			"<GatedCollectionBootstrap />",
			"",
		].join("\n"),
	);
}

export function writeGatedReaderPage(input: {
	docsRoot: string;
	entry: RoutedPublishedReaderManifestEntry;
}): void {
	const versionPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		input.entry.routeSlug,
		"v",
		`${input.entry.versionSlug}.mdx`,
	);
	const currentPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		`${input.entry.routeSlug}.mdx`,
	);
	const versionMdx = buildGatedReaderMdx({
		entry: input.entry,
		importPath: "@/components/docs/gated-reader-bootstrap",
	});
	writeText(versionPath, versionMdx);
	if (input.entry.isCurrent) {
		writeText(currentPath, versionMdx);
	}
}

function buildGatedReaderMdx(input: {
	entry: RoutedPublishedReaderManifestEntry;
	importPath: string;
}): string {
	return [
		"---",
		`title: ${JSON.stringify(input.entry.title)}`,
		"footer: false",
		'docsSearchVisibility: "gated_bootstrap"',
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		'readerLayout: "reference"',
		'readerMeasure: "standard"',
		'readerOutline: "document"',
		"---",
		"",
		`import GatedReaderBootstrap from "${input.importPath}";`,
		"",
		`<GatedReaderBootstrap documentSlug={${JSON.stringify(input.entry.documentSlug)}} renderTitle={false} />`,
		"",
	].join("\n");
}

function resolveDocumentKind(entry: RoutedPublishedReaderManifestEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "curriculumPlan";
	}
	if (entry.collection === "student_rules") {
		return "studentHandbookArticle";
	}
	return "publicRegulation";
}
