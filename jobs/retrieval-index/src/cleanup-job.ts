import { Client } from "pg";
import { bindingCollection } from "./catalog.ts";
import { workspace, manifest } from "./workspace.ts";
import type { ArtifactStore } from "./stream-store.ts";
import type { Sha256Ref } from "./types.ts";

/** Explicit roots only; all other published manifests protect their referenced data. */
export async function cleanupArtifacts(
	store: ArtifactStore,
	targets: { kind: "docs" | "notices"; id: Sha256Ref }[],
	env = process.env,
) {
	if (!targets.length) throw new Error("cleanup requires explicit embedding set IDs");
	const work = await workspace(),
		client = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL });
	let connected = false;
	try {
		await client.connect();
		connected = true;
		const locked = await client.query(
			"SELECT pg_try_advisory_lock(hashtext('campus_rag_index_publish')) locked",
		);
		if (!locked.rows[0].locked) throw new Error("another retrieval job is running");
		const current = (
			await client.query("SELECT * FROM campus_docs_serving.current_index WHERE singleton")
		).rows[0];
		// The previous notice Worker switches the pointer without these references; refuse until
		// retrieval-index has applied once and owns them.
		if (
			!current?.docs_embedding_set ||
			!current.notice_embedding_set ||
			current.collection !==
				bindingCollection({
					docsEmbeddingSet: current.docs_embedding_set,
					noticeEmbeddingSet: current.notice_embedding_set,
				})
		)
			throw new Error("cleanup requires a current index applied by retrieval-index");
		work.db.exec(
			"CREATE TABLE candidates(key TEXT PRIMARY KEY, phase INTEGER NOT NULL);CREATE TABLE retained(key TEXT PRIMARY KEY)",
		);
		const roots = new Set(
			targets.map(
				(t) =>
					`${t.kind === "docs" ? "campus-docs" : "notices"}/rag/embedding-sets/sha256/${t.id.slice(7)}/manifest.json`,
			),
		);
		for (const t of targets)
			if (t.id === (t.kind === "docs" ? current.docs_embedding_set : current.notice_embedding_set))
				throw new Error("cannot remove current artifacts");
		const walk = async (key: string, id: Sha256Ref, table: "candidates" | "retained") => {
			const statement = work.db.prepare(
				table === "candidates"
					? "INSERT OR IGNORE INTO candidates(key,phase) VALUES(?,?)"
					: "INSERT OR IGNORE INTO retained(key) VALUES(?)",
			);
			const insert = (key: string, phase = 0) => {
				if (table === "candidates") statement.run(key, phase);
				else statement.run(key);
			};
			const read = async (key: string, id: Sha256Ref) => {
				try {
					return await manifest<Record<string, any>>(store, key, id);
				} catch (error) {
					if (table === "candidates" && error instanceof Error && error.name === "NoSuchKey")
						return undefined;
					throw error;
				}
			};
			const m = await read(key, id);
			insert(key, 2);
			if (!m) return;
			if (!m.embeddings?.key) throw new Error(`invalid embedding manifest ${key}`);
			insert(m.embeddings.key);
			if (m.chunkSet) {
				const chunkKey = `campus-docs/rag/chunk-sets/sha256/${m.chunkSet.slice(7)}/manifest.json`;
				insert(chunkKey, 1);
				const c = await read(chunkKey, m.chunkSet);
				if (c) insert(c.chunks.key);
			} else if (m.chunks?.key) insert(m.chunks.key);
			else if (m.chunkRun) {
				const prefix = `notices/rag/chunk-runs/sha256/${m.chunkRun.slice(7)}`;
				const chunkKey = `${prefix}/manifest.json`;
				insert(chunkKey, 1);
				const c = await read(chunkKey, m.chunkRun);
				if (!c) return;
				for (const ref of [c.chunks, c.reviewSamples, c.validation])
					if (ref?.file) insert(`${prefix}/${ref.file}`);
			} else throw new Error(`invalid chunk reference: ${key}`);
		};
		for (const t of targets) {
			const key = `${t.kind === "docs" ? "campus-docs" : "notices"}/rag/embedding-sets/sha256/${t.id.slice(7)}/manifest.json`;
			await walk(key, t.id, "candidates");
		}
		for (const prefix of ["campus-docs/rag/embedding-sets/", "notices/rag/embedding-sets/"])
			for await (const key of store.list(prefix)) {
				const match = key.match(/\/sha256\/([a-f0-9]{64})\/manifest.json$/);
				if (match && !roots.has(key)) await walk(key, `sha256:${match[1]}`, "retained");
			}
		let removed = 0;
		// Preserve traversal metadata until every referenced data object is gone.
		for (const row of work.db
			.prepare(
				"SELECT key FROM candidates WHERE key NOT IN (SELECT key FROM retained) ORDER BY phase, key",
			)
			.iterate()) {
			await store.remove(row.key as string);
			removed++;
		}
		return { removed };
	} finally {
		if (connected) await client.end();
		await work.close();
	}
}
