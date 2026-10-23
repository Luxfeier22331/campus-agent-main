import { Client } from "pg";
import { createQdrantClient, QdrantCollectionContentMismatchError } from "./qdrant.ts";
import { materializeCollection } from "./publisher.ts";
import { prepareCandidate, targetPoints } from "./candidate.ts";
import { COLLECTION_PATTERN, collectionName, writeCurrentIndex } from "./catalog.ts";
import { workspace, type StreamStore } from "./workspace.ts";
import type { Sha256Ref, UnifiedPoint } from "./types.ts";

// Longer than one Search request (HTTP write timeout 70s), so in-flight reads finish
// on the previous collection before it is deleted.
export const RETIRE_GRACE_MS = 90_000;
export function qdrantRequest(env: NodeJS.ProcessEnv, signal?: AbortSignal) {
	if (!env.QDRANT_URL || !env.QDRANT_API_KEY)
		throw new Error("QDRANT_URL and QDRANT_API_KEY are required");
	return async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
		const r = await fetch(`${env.QDRANT_URL!.replace(/\/$/, "")}${path}`, {
			method,
			...(signal ? { signal } : {}),
			headers: { "api-key": env.QDRANT_API_KEY!, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!r.ok) throw new Error(`Qdrant ${path}: HTTP ${r.status}`);
		return (await r.json()) as { result: any };
	};
}
export async function* batches(points: Iterable<UnifiedPoint>) {
	let batch: UnifiedPoint[] = [];
	let bytes = 16;
	for (const p of points) {
		const size = Buffer.byteLength(JSON.stringify(p)) + 1;
		if (size > 8 * 1024 * 1024 - 16) throw new Error("point exceeds request limit");
		if (batch.length === 64 || bytes + size > 8 * 1024 * 1024) {
			yield batch;
			batch = [];
			bytes = 16;
		}
		batch.push(p);
		bytes += size;
	}
	if (batch.length) yield batch;
}
export async function applyIndex(input: {
	store: StreamStore;
	docs: Sha256Ref;
	notices: Sha256Ref;
	env?: NodeJS.ProcessEnv;
	graceMs?: number;
}) {
	const env = input.env ?? process.env;
	const work = await workspace();
	const client = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL });
	let connected = false;
	const abort = new AbortController();
	client.on("error", (e) => abort.abort(e));
	try {
		const candidate = await prepareCandidate(work.db, input.store, input.docs, input.notices);
		const collection = collectionName(candidate.revision);
		await client.connect();
		connected = true;
		const lock = await client.query(
			"SELECT pg_try_advisory_lock(hashtext('campus_rag_index_publish')) AS locked",
		);
		if (!lock.rows[0].locked) throw new Error("another retrieval job is running");
		const current = (
			await client.query("SELECT collection FROM campus_docs_serving.current_index WHERE singleton")
		).rows[0];
		const qdrant = createQdrantClient(env, (url, init) =>
			fetch(url, { ...init, signal: abort.signal }),
		);
		const previous: string | undefined = current?.collection;
		const noOp = previous === collection;
		if (!noOp) {
			const target = {
				collection,
				pointCount: candidate.pointCount,
				points: async function* () {
					yield* targetPoints(work.db);
				},
			};
			try {
				await materializeCollection(qdrant, target, abort.signal);
			} catch (error) {
				if (!(error instanceof QdrantCollectionContentMismatchError)) throw error;
				// Nothing reads a non-current collection; a leftover from an interrupted run is rebuilt.
				await qdrant.deleteCollection(collection);
				await materializeCollection(qdrant, target, abort.signal);
			}
			abort.signal.throwIfAborted();
			await writeCurrentIndex(client, {
				collection,
				docsEmbeddingSet: input.docs,
				noticeEmbeddingSet: input.notices,
			});
		}
		// Only the collection this database pointed to is owned here; local instances share Qdrant.
		const retired = previous && !noOp && COLLECTION_PATTERN.test(previous) ? [previous] : [];
		if (retired.length) {
			await new Promise((r) => setTimeout(r, input.graceMs ?? RETIRE_GRACE_MS));
			for (const name of retired) await qdrant.deleteCollection(name);
		}
		return { collection, noOp, retired, ...candidate };
	} finally {
		if (connected) await client.end();
		await work.close();
	}
}
