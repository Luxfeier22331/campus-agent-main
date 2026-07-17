import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Plugin } from "vite";

interface ChunkMetadata {
	importedCss?: Set<string>;
}

export interface CampusBundleGraphChunk {
	css: string[];
	dynamicImports: string[];
	facadeModuleId: string | null;
	imports: string[];
	isEntry: boolean;
}

export interface CampusBundleGraph {
	chunks: Record<string, CampusBundleGraphChunk>;
	entry: string;
}

export function campusBundleGraphPlugin(input: { outputFile: string }): Plugin {
	return {
		generateBundle(_outputOptions, bundle) {
			const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
			const entry = chunks.find(
				(chunk) =>
					chunk.isEntry &&
					Object.keys(chunk.modules).some((moduleId) => moduleId.endsWith("/src/main.tsx")),
			);
			if (!entry) {
				return;
			}
			const graph: CampusBundleGraph = {
				chunks: Object.fromEntries(
					chunks.map((chunk) => {
						const metadata = (chunk as typeof chunk & { viteMetadata?: ChunkMetadata })
							.viteMetadata;
						return [
							chunk.fileName,
							{
								css: [...(metadata?.importedCss ?? [])].sort(),
								dynamicImports: [...chunk.dynamicImports].sort(),
								facadeModuleId: chunk.facadeModuleId,
								imports: [...chunk.imports].sort(),
								isEntry: chunk.isEntry,
							} satisfies CampusBundleGraphChunk,
						];
					}),
				),
				entry: entry.fileName,
			};
			mkdirSync(dirname(input.outputFile), { recursive: true });
			writeFileSync(input.outputFile, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
		},
		name: "campus-web:bundle-graph",
	};
}
