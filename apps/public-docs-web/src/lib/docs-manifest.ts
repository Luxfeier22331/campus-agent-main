import { buildDocsManifestFromFiles } from "./docs-manifest.shared";

const docModules = import.meta.glob("../../content/docs/**/*.{md,mdx}", {
	eager: true,
	query: {
		collection: "docs",
	},
}) as Record<string, unknown>;

const docsFiles = Object.fromEntries(
	Object.entries(docModules).map(([filePath, module]) => [
		filePath.replace(/^..\/..\/content\/docs\//u, ""),
		toSyntheticMarkdown(module),
	]),
);

export const docsManifest = buildDocsManifestFromFiles(docsFiles);

export function getDocsPageEntry(slugs: string[] | undefined) {
	const routePath = !slugs || slugs.length === 0 ? "/docs" : `/docs/${slugs.join("/")}`;

	return docsManifest.pageByRoute[routePath];
}

function toSyntheticMarkdown(module: unknown) {
	const frontmatter = extractFrontmatter(module);

	return [
		"---",
		...(frontmatter.title ? [`title: ${frontmatter.title}`] : []),
		...(frontmatter.description ? [`description: ${frontmatter.description}`] : []),
		"---",
		"",
	].join("\n");
}

function extractFrontmatter(module: unknown) {
	if (module && typeof module === "object" && "frontmatter" in module) {
		const frontmatter = module.frontmatter;

		if (frontmatter && typeof frontmatter === "object") {
			const record = frontmatter as Record<string, unknown>;

			return {
				title: typeof record.title === "string" ? record.title : undefined,
				description: typeof record.description === "string" ? record.description : undefined,
			};
		}
	}

	const keys =
		module && typeof module === "object" ? Object.keys(module).join(", ") : typeof module;
	throw new TypeError(`unexpected markdown module shape: ${keys}`);
}
