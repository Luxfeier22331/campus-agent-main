import { Client } from "pg";

import {
	INDEX_DEFINITION,
	type CurrentIndexBinding,
	type PublisherIndexCatalog,
} from "./types.ts";

export interface PostgresCatalogEnv {
	CAMPUS_DOCS_DATABASE_URL?: string;
}

export function createPostgresIndexCatalog(
	env: PostgresCatalogEnv = process.env,
): PublisherIndexCatalog & { close(): Promise<void> } {
	const connectionString = env.CAMPUS_DOCS_DATABASE_URL?.trim();
	if (!connectionString) throw new Error("CAMPUS_DOCS_DATABASE_URL is required for Campus docs publisher");
	const client = new Client({ connectionString });
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
				["campus_docs_index_publisher"],
			);
			if (!result.rows[0]?.locked) {
				throw new Error("another Campus docs index publisher is already running");
			}
		},
		async activate(index) {
			validateTargetBinding(index);
			await connect();
			await client.query("BEGIN");
			try {
				const current = await client.query<CurrentIndexRow>(
					`select *
					   from campus_docs_serving.current_index
					  where singleton = true
					  for update`,
				);
				const currentBinding = current.rows[0] ? toBinding(current.rows[0]) : null;
				if (currentBinding?.collection === index.collection) {
					assertSameBinding(currentBinding, index);
					await client.query("COMMIT");
					return { noOp: true };
				}
				await client.query(
					`insert into campus_docs_serving.current_index
					 (singleton, collection, dense_vector_name, embedding_dimensions,
					  embedding_model, embedding_provider, embedding_query_instruction,
					  embedding_space_id, sparse_model, sparse_vector_name)
					 values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9)
					 on conflict (singleton) do update set
					   collection = excluded.collection,
					   dense_vector_name = excluded.dense_vector_name,
					   embedding_dimensions = excluded.embedding_dimensions,
					   embedding_model = excluded.embedding_model,
					   embedding_provider = excluded.embedding_provider,
					   embedding_query_instruction = excluded.embedding_query_instruction,
					   embedding_space_id = excluded.embedding_space_id,
					   sparse_model = excluded.sparse_model,
					   sparse_vector_name = excluded.sparse_vector_name`,
					[
						index.collection,
						index.dense_vector_name,
						index.embedding_dimensions,
						index.embedding_model,
						index.embedding_provider,
						index.embedding_query_instruction,
						index.embedding_space_id,
						index.sparse_model,
						index.sparse_vector_name,
					],
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
		async current() {
			await connect();
			const result = await client.query<CurrentIndexRow>(
				`select *
				   from campus_docs_serving.current_index
				  where singleton = true`,
			);
			return result.rows[0] ? toBinding(result.rows[0]) : null;
		},
	};
}

export function assertSameBinding(stored: CurrentIndexBinding, expected: CurrentIndexBinding): void {
	for (const field of bindingFields) {
		if (stored[field] !== expected[field]) {
			throw new Error(`Campus docs current index conflicts at ${field}`);
		}
	}
}

interface CurrentIndexRow {
	collection: string;
	dense_vector_name: string;
	embedding_dimensions: number;
	embedding_model: string;
	embedding_provider: string;
	embedding_query_instruction: string;
	embedding_space_id: string;
	sparse_model: string;
	sparse_vector_name: string;
}

const bindingFields = [
	"collection",
	"dense_vector_name",
	"embedding_dimensions",
	"embedding_model",
	"embedding_provider",
	"embedding_query_instruction",
	"embedding_space_id",
	"sparse_model",
	"sparse_vector_name",
] as const;

function toBinding(row: CurrentIndexRow): CurrentIndexBinding {
	const binding = {
		collection: row.collection,
		dense_vector_name: row.dense_vector_name,
		embedding_dimensions: row.embedding_dimensions,
		embedding_model: row.embedding_model,
		embedding_provider: row.embedding_provider,
		embedding_query_instruction: row.embedding_query_instruction,
		embedding_space_id: row.embedding_space_id,
		sparse_model: row.sparse_model,
		sparse_vector_name: row.sparse_vector_name,
	};
	validateStoredBinding(binding);
	return binding;
}

function validateStoredBinding(binding: CurrentIndexBinding): void {
	if (!/^campus_docs_[a-f0-9]{64}$/u.test(binding.collection)) {
		throw new Error("Campus docs current collection identity is invalid");
	}
	if (!Number.isSafeInteger(binding.embedding_dimensions) || binding.embedding_dimensions < 1) {
		throw new Error("Campus docs current embedding dimensions are invalid");
	}
	for (const field of bindingFields) {
		if (field === "collection" || field === "embedding_dimensions") continue;
		if (!binding[field].trim()) {
			throw new Error(`Campus docs current index field is empty: ${field}`);
		}
	}
}

function validateTargetBinding(binding: CurrentIndexBinding): void {
	validateStoredBinding(binding);
	const expected = INDEX_DEFINITION;
	if (
		binding.dense_vector_name !== expected.embedding.vectorName ||
		binding.embedding_dimensions !== expected.embedding.dimensions ||
		binding.embedding_model !== expected.embedding.model ||
		binding.embedding_provider !== expected.embedding.provider ||
		binding.embedding_query_instruction !== expected.embedding.queryInstruction ||
		!binding.embedding_space_id.trim() ||
		binding.sparse_model !== expected.sparse.model ||
		binding.sparse_vector_name !== expected.sparse.vectorName
	) {
		throw new Error("Campus docs current index query binding is invalid");
	}
}
