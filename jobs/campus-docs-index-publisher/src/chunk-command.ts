import { buildCampusDocsChunkSet } from "./publisher.ts";
import type { BuildChunkSetInput } from "./types.ts";

export async function runBuildChunks(input: BuildChunkSetInput): Promise<void> {
	const result = await buildCampusDocsChunkSet(input);
	console.log(JSON.stringify({
		chunk_count: result.chunkCount,
		chunk_set: result.chunkSet,
		document_count: result.documentCount,
		source_projection_sha256: result.sourceProjectionSha256,
	}, null, 2));
}
