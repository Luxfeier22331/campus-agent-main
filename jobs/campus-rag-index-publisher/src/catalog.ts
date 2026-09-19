import { Client, type ClientConfig } from "pg";

import type { IndexCatalog } from "./types.ts";

export interface PostgresCatalogEnv {
	EXECUTION_CONTROL_DATABASE_URL?: string;
}

export function createPostgresIndexCatalog(
	env: PostgresCatalogEnv = process.env,
): IndexCatalog & { acquirePublisherLock(): Promise<void>; close(): Promise<void> } {
	const client = new Client(postgresClientConfig(env));
	let connected = false;
	const connect = async (): Promise<void> => {
		if (!connected) {
			await client.connect();
			connected = true;
		}
	};
	return {
		async acquirePublisherLock() {
			await connect();
			const result = await client.query<{ locked: boolean }>(
				"select pg_try_advisory_lock(hashtext($1)) as locked",
				["campus_rag_index_publish"],
			);
			if (!result.rows[0]?.locked) {
				throw new Error("another Campus RAG index publisher is already running");
			}
		},
		async activate(index) {
			validateBinding(index.collection);
			await connect();
			await client.query("BEGIN");
			try {
				const result = await createTransactionalIndexCatalog(client).activate(index);
				await client.query("COMMIT");
				return result;
			} catch (error) {
				await client.query("ROLLBACK").catch(() => undefined);
				throw error;
			}
		},
		async close() {
			if (connected) await client.end();
		},
	};
}

/** The caller owns BEGIN/COMMIT so foundation rows and the binding change together. */
export function createTransactionalIndexCatalog(client: Pick<Client, "query">): IndexCatalog {
	return {
		async activate(index) {
			validateBinding(index.collection);
			const current = await client.query<{ collection: string }>(
				"select collection from campus_docs_serving.current_index where singleton = true for update",
			);
			if (current.rows[0]?.collection === index.collection) return { noOp: true };
			await client.query(
				`insert into campus_docs_serving.current_index (singleton, collection)
				 values (true, $1)
				 on conflict (singleton) do update set collection = excluded.collection`,
				[index.collection],
			);
			return { noOp: false };
		},
	};
}

function validateBinding(collection: string): void {
	if (!/^campus_docs_[a-f0-9]{64}$/u.test(collection)) {
		throw new Error("Campus RAG current collection identity is invalid");
	}
}

function postgresClientConfig(env: PostgresCatalogEnv): ClientConfig {
	const connectionString = env.EXECUTION_CONTROL_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error("EXECUTION_CONTROL_DATABASE_URL is required for Campus RAG publisher");
	}
	return { connectionString };
}
