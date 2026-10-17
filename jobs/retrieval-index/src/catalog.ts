import { Client } from "pg";
import type { Sha256Ref } from "./types.ts";
import { canonical, digest } from "./workspace.ts";
import { COLLECTION_DEFINITION, COLLECTION_PREFIX } from "./definitions.ts";

export const COLLECTION_PATTERN = /^campus_docs_[a-f0-9]{64}$/u;

export function indexRevision(
	docsEmbeddingSet: Sha256Ref,
	noticeEmbeddingSet: Sha256Ref,
): Sha256Ref {
	return digest(
		canonical({
			collectionDefinition: COLLECTION_DEFINITION,
			docsEmbeddingSet,
			noticeEmbeddingSet,
		}),
	);
}
/** Each revision owns one immutable collection; Apply switches the pointer between them. */
export function collectionName(revision: Sha256Ref): string {
	return `${COLLECTION_PREFIX}_${revision.slice("sha256:".length)}`;
}
export function bindingCollection(binding: {
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
}): string {
	return collectionName(indexRevision(binding.docsEmbeddingSet, binding.noticeEmbeddingSet));
}
/** Callers own the transaction and have materialized and validated the collection. */
export async function writeCurrentIndex(
	client: Pick<Client, "query">,
	input: {
		collection: string;
		docsEmbeddingSet: Sha256Ref;
		noticeEmbeddingSet: Sha256Ref;
	},
) {
	if (input.collection !== bindingCollection(input))
		throw new Error("retrieval collection does not match its embedding sets");
	await client.query(
		`INSERT INTO campus_docs_serving.current_index(singleton,collection,docs_embedding_set,notice_embedding_set)
 VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET collection=excluded.collection,
 docs_embedding_set=excluded.docs_embedding_set,notice_embedding_set=excluded.notice_embedding_set`,
		[input.collection, input.docsEmbeddingSet, input.noticeEmbeddingSet],
	);
}
export function createPostgresIndexCatalog(
	env: { AGENT_CONTROL_DATABASE_URL?: string } = process.env,
) {
	const client = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL });
	let connected = false;
	const controller = new AbortController();
	client.on("error", (e) => controller.abort(e));
	return {
		signal: controller.signal,
		async acquirePublisherLock() {
			await client.connect();
			connected = true;
			const r = await client.query(
				"SELECT pg_try_advisory_lock(hashtext('campus_rag_index_publish')) locked",
			);
			if (!r.rows[0].locked) throw new Error("another retrieval job is running");
		},
		async close() {
			if (connected) await client.end();
		},
	};
}
