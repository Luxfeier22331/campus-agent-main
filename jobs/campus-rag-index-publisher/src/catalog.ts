import { ArtifactValidationError } from "@campus-agent/embedding-runtime";
import { Client, type ClientConfig } from "pg";
import type { IndexCatalog, IndexVersion, IndexVersionInput } from "./types.ts";

export interface PostgresCatalogEnv {
	EXECUTION_CONTROL_DATABASE_URL?: string;
}

export function createPostgresIndexCatalog(env: PostgresCatalogEnv = process.env) {
	const client = new Client(postgresClientConfig(env));
	let connected = false;
	let connectionError: Error | undefined;
    const controller = new AbortController();
	client.on("error", (error) => { connectionError = error; controller.abort(error); });
	const connect = async () => {
		if (connectionError) throw connectionError;
		if (!connected) { await client.connect(); connected = true; }
	};
	const transactional = createTransactionalIndexCatalog(client);
	return {
        signal: controller.signal,
		async acquirePublisherLock() {
			await connect();
			const result = await client.query<{ locked: boolean }>(
				"select pg_try_advisory_lock(hashtext($1)) as locked", ["campus_rag_index_publish"],
			);
			if (!result.rows[0]?.locked) throw new Error("another Campus RAG index publisher is already running");
		},
		async register(index: IndexVersionInput) { await connect(); return transactional.register(index); },
		async markValidated(collection: string) { await connect(); await transactional.markValidated(collection); },
		async current(): Promise<{ current: IndexVersion | null; previous: string | null }> {
			await connect();
			const result = await client.query(`SELECT c.collection, c.previous_collection, v.*
			 FROM campus_docs_serving.current_index c LEFT JOIN campus_docs_serving.index_versions v USING (collection)
			 WHERE c.singleton=true`);
			const row = result.rows[0];
			if (!row) return { current: null, previous: null };
			if (!row.docs_embedding_set) throw new ArtifactValidationError("current Campus RAG index has no registered artifact references; publish verified artifacts before automation");
			return { current: version(row), previous: row.previous_collection };
		},
		async activate(index: Parameters<IndexCatalog["activate"]>[0]) {
			await connect();
			await client.query("BEGIN");
			try {
				const result = await transactional.activate(index);
				await client.query("COMMIT");
				return result;
			} catch (error) {
				await client.query("ROLLBACK").catch(() => undefined);
				throw error;
			}
		},
		async versions(): Promise<IndexVersion[]> {
			await connect();
			return (await client.query("SELECT * FROM campus_docs_serving.index_versions")).rows.map(version);
		},
		async retireAbandoned(activeRunIds: string[]) {
			await connect();
			await client.query(`UPDATE campus_docs_serving.index_versions v SET retired_at=now() - interval '1 hour' - interval '1 second'
			 WHERE producer='automatic' AND activated_at IS NULL AND retired_at IS NULL
			 AND created_at < now() - interval '24 hours' AND NOT (COALESCE(producer_run_id, '')=ANY($1::text[]))
			 AND NOT EXISTS (SELECT 1 FROM campus_docs_serving.current_index c WHERE c.collection=v.collection OR c.previous_collection=v.collection)`, [activeRunIds]);
		},
		async retiredVersions(): Promise<IndexVersion[]> {
			await connect();
			const result = await client.query(`SELECT v.* FROM campus_docs_serving.index_versions v
			 WHERE v.producer='automatic' AND v.retired_at < now() - interval '1 hour'
			 AND NOT EXISTS (SELECT 1 FROM campus_docs_serving.current_index c
			 WHERE c.collection=v.collection OR c.previous_collection=v.collection)`);
			return result.rows.map(version);
		},
		async removeRetired(collection: string) {
			await connect();
			await client.query(`DELETE FROM campus_docs_serving.index_versions v WHERE collection=$1
			 AND producer='automatic' AND retired_at < now() - interval '1 hour'
			 AND NOT EXISTS (SELECT 1 FROM campus_docs_serving.current_index c
			 WHERE c.collection=v.collection OR c.previous_collection=v.collection)`, [collection]);
		},
		async close() { if (connected) await client.end(); },
	};
}

/** Caller owns transaction and publisher lock (including local data import). */
export function createTransactionalIndexCatalog(client: Pick<Client, "query">): IndexCatalog {
	return {
		async register(index) {
			validateBinding(index.collection);
			const inserted = await client.query(`INSERT INTO campus_docs_serving.index_versions
			 (collection, docs_embedding_set, notice_embedding_set, producer, producer_run_id)
			 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (collection) DO NOTHING RETURNING collection`,
			 [index.collection, index.docsEmbeddingSet, index.noticeEmbeddingSet, index.producer, index.producerRunId ?? null]);
			const result = await client.query(`SELECT v.*, EXISTS (
			 SELECT 1 FROM campus_docs_serving.current_index c WHERE c.collection=v.collection OR c.previous_collection=v.collection
			 ) AS protected FROM campus_docs_serving.index_versions v WHERE collection=$1`, [index.collection]);
			const row = result.rows[0];
			if (!row || row.docs_embedding_set !== index.docsEmbeddingSet || row.notice_embedding_set !== index.noticeEmbeddingSet) {
				throw new ArtifactValidationError("Campus RAG version artifact references conflict");
			}
			if (index.producer === "manual" && row.producer === "automatic") {
				await client.query("UPDATE campus_docs_serving.index_versions SET producer='manual', producer_run_id=NULL WHERE collection=$1", [index.collection]);
			}
			return { rebuildIncomplete: inserted.rowCount === 0 && !row.validated && !row.activated_at && !row.protected };
		},
		async markValidated(collection) {
			const result = await client.query("UPDATE campus_docs_serving.index_versions SET validated=true WHERE collection=$1", [collection]);
			if (result.rowCount !== 1) throw new Error("Campus RAG candidate is not registered");
		},
		async activate(index) {
			validateBinding(index.collection);
			// Covers first publication too, when there is no current row to lock.
			await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["campus_rag_index_activate"]);
			const current = await client.query<{ collection: string; previous_collection: string | null }>(
				"select collection, previous_collection from campus_docs_serving.current_index where singleton = true for update",
			);
			const old = current.rows[0];
			if (old?.collection === index.collection) {
				await client.query("UPDATE campus_docs_serving.index_versions SET activated_at=COALESCE(activated_at, now()), retired_at=NULL WHERE collection=$1 AND validated", [index.collection]);
				return { noOp: true };
			}
			if (index.expectedCurrent !== undefined && (old?.collection ?? null) !== index.expectedCurrent) {
				await client.query("UPDATE campus_docs_serving.index_versions SET retired_at=COALESCE(retired_at, now()) WHERE collection=$1 AND activated_at IS NULL", [index.collection]);
				return { noOp: true, obsolete: true };
			}
			const candidate = await client.query("SELECT validated FROM campus_docs_serving.index_versions WHERE collection=$1", [index.collection]);
			if (!candidate.rows[0]?.validated) throw new ArtifactValidationError("Campus RAG activation requires a registered validated version");
			await client.query(`insert into campus_docs_serving.current_index (singleton, collection, previous_collection)
			 values (true, $1, $2) on conflict (singleton) do update
			 set collection=excluded.collection, previous_collection=excluded.previous_collection`, [index.collection, old?.collection ?? null]);
			await client.query("UPDATE campus_docs_serving.index_versions SET activated_at=now(), retired_at=NULL WHERE collection=$1", [index.collection]);
			if (old?.collection) await client.query("UPDATE campus_docs_serving.index_versions SET retired_at=now() WHERE collection=$1", [old.collection]);
			if (old?.previous_collection && old.previous_collection !== index.collection) {
				await client.query("UPDATE campus_docs_serving.index_versions SET retired_at=now() WHERE collection=$1", [old.previous_collection]);
			}
			return { noOp: false };
		},
	};
}

function version(row: Record<string, any>): IndexVersion {
	return { collection: row.collection, docsEmbeddingSet: row.docs_embedding_set, noticeEmbeddingSet: row.notice_embedding_set,
		producer: row.producer, ...(row.producer_run_id ? { producerRunId: row.producer_run_id } : {}), validated: row.validated, createdAt: row.created_at.toISOString(),
		activatedAt: row.activated_at?.toISOString() ?? null, retiredAt: row.retired_at?.toISOString() ?? null };
}
function validateBinding(collection: string) {
	if (!/^campus_docs_[a-f0-9]{64}$/u.test(collection)) throw new ArtifactValidationError("Campus RAG current collection identity is invalid");
}
function postgresClientConfig(env: PostgresCatalogEnv): ClientConfig {
	const connectionString = env.EXECUTION_CONTROL_DATABASE_URL?.trim();
	if (!connectionString) throw new Error("EXECUTION_CONTROL_DATABASE_URL is required for Campus RAG publisher");
	return { connectionString };
}
