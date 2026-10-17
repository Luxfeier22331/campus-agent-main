import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import {
	EMBEDDING_SPACE,
	EMBEDDING_BATCH_SIZE,
	createOpenAICompatibleEmbeddingClient,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { fetchNoticeEmbeddingConnection } from "notice-index-publisher/embedding";
import { iteratePublishedNoticeSources } from "notice-index-publisher/source";
import { NOTICE_CHUNK_DEFINITION } from "notice-index-publisher/definitions";
import { buildNoticeChunks } from "notice-index-publisher/chunking/index";
import { assertValidChunkRun, storedNoticeChunk } from "notice-index-publisher/validation";
import {
	parseIndexingSource,
	selectCurrentVersions,
	loadCurrentVersions,
	indexedSourceProjectionSha256,
} from "campus-docs-index-publisher/indexing/source";
import { buildChunks } from "campus-docs-index-publisher/indexing/chunks";
import { CHUNK_SET_DEFINITION } from "campus-docs-index-publisher/definitions";
import { assertValidChunkSet } from "campus-docs-index-publisher/chunk-validation";
import { DOCS_SOURCE_KEY } from "campus-contracts/campus-docs";
import type { DatabaseSync } from "node:sqlite";
import { workspace, canonical, digest, records } from "./workspace.ts";
import { writeManifest, type ArtifactStore } from "./stream-store.ts";
import {
	readDocsEmbeddingSetManifest,
	readNoticeEmbeddingSetManifest,
	parseEmbedding,
} from "./artifacts.ts";
import type { Sha256Ref } from "./types.ts";

export function initializeBuild(db: DatabaseSync) {
	db.exec(
		`CREATE TABLE chunks(ordinal INTEGER PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE inputs(digest TEXT PRIMARY KEY,text TEXT NOT NULL,vector TEXT);
		CREATE INDEX pending_embeddings ON inputs(digest) WHERE vector IS NULL;`,
	);
}
export function addChunk<T extends { retrievalText: string }>(db: DatabaseSync, value: T) {
	db.prepare("INSERT INTO chunks(value) VALUES(?)").run(canonical(value));
	db.prepare("INSERT OR IGNORE INTO inputs(digest,text) VALUES(?,?)").run(
		digest(value.retrievalText),
		value.retrievalText,
	);
}
export async function generateEmbeddings(db: DatabaseSync, client: EmbeddingClient) {
	let generated = 0;
	for (;;) {
		const rows = db
			.prepare("SELECT digest,text FROM inputs WHERE vector IS NULL ORDER BY digest LIMIT ?")
			.all(Math.min(32, EMBEDDING_BATCH_SIZE));
		if (!rows.length) break;
		const vectors = await client.embed({
			texts: rows.map((r) => r.text as string),
			dimensions: EMBEDDING_SPACE.dimensions,
		});
		if (vectors.length !== rows.length) throw new Error("embedding count mismatch");
		for (const [i, row] of rows.entries()) {
			const dense = vectors[i]!;
			if (dense.length !== EMBEDDING_SPACE.dimensions || dense.some((v) => !Number.isFinite(v)))
				throw new Error("invalid embedding vector");
			db.prepare("UPDATE inputs SET vector=? WHERE digest=?").run(
				JSON.stringify(dense),
				row.digest!,
			);
			generated++;
		}
	}
	return generated;
}
export async function buildIndex(input: {
	store: ArtifactStore;
	source: "docs" | "notices" | "both";
	reuseDocs?: Sha256Ref;
	reuseNotices?: Sha256Ref;
	env?: NodeJS.ProcessEnv;
}) {
	const connection = await fetchNoticeEmbeddingConnection(
		fetch,
		input.env?.MODEL_CONFIG_URL ?? process.env.MODEL_CONFIG_URL,
	);
	const embedding = createOpenAICompatibleEmbeddingClient(connection);
	const output: Record<string, unknown> = {};
	for (const kind of (input.source === "both" ? ["docs", "notices"] : [input.source]) as (
		| "docs"
		| "notices"
	)[]) {
		const work = await workspace();
		try {
			initializeBuild(work.db);
			let docsChunkSet: Sha256Ref | undefined;
			let docsMeta: Record<string, unknown> | undefined;
			if (kind === "notices") {
				const pool = createNoticeDatabasePool(input.env ?? process.env, { max: 1 });
				try {
					for await (const source of iteratePublishedNoticeSources(pool)) {
						const build = buildNoticeChunks(source);
						assertValidChunkRun([build]);
						for (const chunk of build.chunks) addChunk(work.db, storedNoticeChunk(chunk));
					}
				} finally {
					await pool.end();
				}
			} else {
				// source.json is the existing metadata manifest; reader bodies and all vectors are processed per document.
				const source = parseIndexingSource(await input.store.read(DOCS_SOURCE_KEY));
				const selected = selectCurrentVersions(source.manifest);
				for (const item of selected) {
					const selections = await loadCurrentVersions({
						source: {
							...source,
							manifest: {
								...source.manifest,
								documents: [item.document],
								versions: [item.version],
							},
						},
						readerStore: input.store,
					});
					const selection = selections[0]!;
					const chunks = buildChunks({
						document: selection.document,
						reader: selection.reader,
						version: selection.version,
						isCurrent: selection.isCurrent,
						applicableFromAdmissionYear: selection.applicableFromAdmissionYear,
						applicableToAdmissionYear: selection.applicableToAdmissionYear,
					});
					assertValidChunkSet({ chunks, selections });
					for (const chunk of chunks)
						addChunk(work.db, { ...chunk, retrievalTextSha256: digest(chunk.retrievalText) });
				}
				docsMeta = {
					chunkDefinition: CHUNK_SET_DEFINITION.chunking,
					documentCount: selected.length,
					readerSchemaVersion: CHUNK_SET_DEFINITION.readerSchemaVersion,
					schemaVersion: "campus_docs_chunk_set.v2",
					sourceProjectionSha256: indexedSourceProjectionSha256(selected),
					sourceSchemaVersion: CHUNK_SET_DEFINITION.sourceSchemaVersion,
				};
			}
			const prefix = kind === "docs" ? "campus-docs/rag" : "notices/rag";
			const chunks = await input.store.writeRecords(
				`${prefix}/chunk-data`,
				"chunks.ndjson",
				function* () {
					for (const row of work.db.prepare("SELECT value FROM chunks ORDER BY ordinal").iterate())
						yield JSON.parse(row.value as string);
				},
			);
			const chunkCount = Number(work.db.prepare("SELECT count(*) n FROM chunks").get()!.n);
			if (docsMeta)
				docsChunkSet = await writeManifest(input.store, `${prefix}/chunk-sets`, {
					...docsMeta,
					chunks,
					chunkCount,
				});
			const reuse = kind === "docs" ? input.reuseDocs : input.reuseNotices;
			let reused = 0;
			if (reuse) {
				const old =
					kind === "docs"
						? await readDocsEmbeddingSetManifest(input.store, reuse)
						: await readNoticeEmbeddingSetManifest(input.store, reuse);
				if (old.modelTargetSha256 !== connection.targetSha256)
					throw new Error("reuse embedding model target differs");
				let count = 0;
				for await (const value of records(input.store, old.embeddings)) {
					const e = parseEmbedding(value, count++, EMBEDDING_SPACE.dimensions, kind);
					const r = work.db
						.prepare("UPDATE inputs SET vector=? WHERE digest=? AND vector IS NULL")
						.run(JSON.stringify(e.dense), e.retrievalTextSha256);
					reused += Number(r.changes);
				}
				if (count !== old.embeddingCount) throw new Error("reuse embedding count mismatch");
			}
			const generated = await generateEmbeddings(work.db, embedding);
			const embeddings = await input.store.writeRecords(
				`${prefix}/embedding-data`,
				"embeddings.ndjson",
				function* () {
					for (const row of work.db
						.prepare("SELECT digest,vector FROM inputs ORDER BY digest")
						.iterate())
						yield { dense: JSON.parse(row.vector as string), retrievalTextSha256: row.digest };
				},
			);
			const embeddingCount = Number(work.db.prepare("SELECT count(*) n FROM inputs").get()!.n);
			const embeddingSet = await writeManifest(input.store, `${prefix}/embedding-sets`, {
				...(kind === "docs"
					? { chunkSet: docsChunkSet, schemaVersion: "campus_docs_embedding_set.v3" }
					: {
							chunks,
							chunkDefinition: NOTICE_CHUNK_DEFINITION,
							schemaVersion: "notice_embedding_set.v2",
						}),
				embeddingCount,
				embeddingSpace: EMBEDDING_SPACE,
				embeddings,
				modelTargetSha256: connection.targetSha256,
			});
			output[kind] = { embeddingSet, chunkCount, embeddingCount, generated, reused };
		} finally {
			await work.close();
		}
	}
	return output;
}
