import { Client, type ClientConfig } from "pg";

import type { CurrentIndexBinding, PublisherIndexCatalog } from "./types.ts";

export interface PostgresCatalogEnv {
	EXECUTION_CONTROL_DATABASE_URL?: string;
}

export function createPostgresIndexCatalog(
	env: PostgresCatalogEnv = process.env,
): PublisherIndexCatalog & { close(): Promise<void> } {
	const client = new Client(postgresClientConfig(env));
	let connected = false;
	const connect = async () => {
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
				["campus_docs_index_publish"],
			);
			if (!result.rows[0]?.locked) {
				throw new Error("another Campus docs index publisher is already running");
			}
		},
		async activate(index) {
			validateStoredBinding(index);
			await connect();
			await client.query("BEGIN");
			try {
				const current = await client.query<CurrentIndexRow>(
					`select collection
					   from campus_docs_serving.current_index
					  where singleton = true
					  for update`,
				);
				const currentBinding = current.rows[0] ? toBinding(current.rows[0]) : null;
				if (currentBinding?.collection === index.collection) {
					await client.query("COMMIT");
					return { noOp: true };
				}
				await client.query(
					`insert into campus_docs_serving.current_index
					 (singleton, collection)
					 values (true, $1)
					 on conflict (singleton) do update set
					   collection = excluded.collection`,
					[index.collection],
				);
				await client.query("COMMIT");
				return { noOp: false };
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

interface CurrentIndexRow {
	collection: string;
}

function toBinding(row: CurrentIndexRow): CurrentIndexBinding {
	const binding = {
		collection: row.collection,
	};
	validateStoredBinding(binding);
	return binding;
}

function validateStoredBinding(binding: CurrentIndexBinding): void {
	if (!/^campus_docs_[a-f0-9]{64}$/u.test(binding.collection)) {
		throw new Error("Campus docs current collection identity is invalid");
	}
}

function postgresClientConfig(env: PostgresCatalogEnv): ClientConfig {
	return {
		connectionString: requiredEnv(
			env.EXECUTION_CONTROL_DATABASE_URL,
			"EXECUTION_CONTROL_DATABASE_URL",
		),
	};
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus docs publisher`);
	return normalized;
}
