import { createPostgresIndexCatalog } from "./catalog.ts";
import { createOpenAICompatibleEmbeddingClient } from "./embedding.ts";
import { createS3ReaderStore } from "./object-store.ts";
import { publishCampusDocsIndex } from "./publisher.ts";
import { createQdrantClient } from "./qdrant.ts";

async function main(): Promise<void> {
	const readerStore = createS3ReaderStore();
	const readSource = () => readerStore.read("campus-docs/source.json");
	const catalog = createPostgresIndexCatalog();
	try {
		await catalog.acquirePublisherLock();
		const sourceBytes = await readSource();
		const result = await publishCampusDocsIndex({
			catalog,
			embedding: createOpenAICompatibleEmbeddingClient(),
			qdrant: createQdrantClient(),
			readSource,
			readerStore,
			sourceBytes,
		});
		console.log(JSON.stringify({
			collection: result.collection,
			document_count: result.documentCount,
			...(result.pointCount === undefined ? {} : {
				generated_embedding_input_count: result.generatedEmbeddingInputCount,
				point_count: result.pointCount,
				reused_embedding_input_count: result.reusedEmbeddingInputCount,
				unique_embedding_input_count: result.uniqueEmbeddingInputCount,
			}),
			no_op: result.noOp,
			source_digest: result.sourceDigest,
		}, null, 2));
	} finally {
		await catalog.close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
