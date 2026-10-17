import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import {
	readDocsEmbeddingSetManifest,
	readNoticeEmbeddingSetManifest,
	parseDocsChunkSetManifest,
	parseDocsChunk,
	parseNoticeChunk,
	parseEmbedding,
	chunkSetManifestKey,
} from "./artifacts.ts";
import { buildDocsPoints, buildNoticePoints } from "./publisher.ts";
import { indexRevision } from "./catalog.ts";
import { canonical, digest, manifest, records, type StreamStore } from "./workspace.ts";
import type { Sha256Ref, UnifiedPoint } from "./types.ts";

export async function prepareCandidate(
	db: DatabaseSync,
	store: StreamStore,
	docsId: Sha256Ref,
	noticeId: Sha256Ref,
) {
	const docs = await readDocsEmbeddingSetManifest(store, docsId),
		notices = await readNoticeEmbeddingSetManifest(store, noticeId);
	if (
		!isDeepStrictEqual(docs.embeddingSpace, notices.embeddingSpace) ||
		docs.modelTargetSha256 !== notices.modelTargetSha256
	)
		throw new Error("Docs and Notice embedding spaces/model targets differ");
	if (notices.schemaVersion !== "notice_embedding_set.v2")
		throw new Error("Rebuild Notice artifacts using the current builder");
	const chunkManifest = parseDocsChunkSetManifest(
		await manifest(store, chunkSetManifestKey(docs.chunkSet), docs.chunkSet),
	);
	db.exec(`CREATE TABLE embeddings (kind TEXT, digest TEXT, vector TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,digest));
 CREATE TABLE target (id TEXT PRIMARY KEY, point TEXT NOT NULL);`);
	const insert = db.prepare("INSERT INTO embeddings(kind,digest,vector) VALUES(?,?,?)");
	for (const [kind, m] of [
		["docs", docs],
		["notices", notices],
	] as const) {
		let count = 0;
		for await (const raw of records(store, m.embeddings)) {
			const e = parseEmbedding(raw, count++, EMBEDDING_SPACE.dimensions, kind);
			insert.run(kind, e.retrievalTextSha256, JSON.stringify(e.dense));
		}
		if (count !== m.embeddingCount) throw new Error(`${kind} embedding count mismatch`);
	}
	const lookup = db.prepare("SELECT vector FROM embeddings WHERE kind=? AND digest=?");
	const mark = db.prepare("UPDATE embeddings SET used=1 WHERE kind=? AND digest=?");
	const pointInsert = db.prepare("INSERT INTO target(id,point) VALUES(?,?)");
	let pointCount = 0;
	for (const [kind, ref] of [
		["docs", chunkManifest.chunks],
		["notices", notices.chunks],
	] as const) {
		let count = 0;
		for await (const raw of records(store, ref)) {
			const c = kind === "docs" ? parseDocsChunk(raw, count++) : parseNoticeChunk(raw, count++);
			const sha = digest(c.retrievalText);
			const row = lookup.get(kind, sha);
			if (!row) throw new Error(`missing embedding: ${sha}`);
			const e = { retrievalTextSha256: sha, dense: JSON.parse(row.vector as string) };
			const point =
				kind === "docs"
					? buildDocsPoints([c as Parameters<typeof buildDocsPoints>[0][number]], [e])[0]
					: buildNoticePoints([c as Parameters<typeof buildNoticePoints>[0][number]], [e])[0];
			if (!point) throw new Error("missing point");
			pointInsert.run(point.id, canonical(point));
			mark.run(kind, sha);
			pointCount++;
		}
		if (count === 0 || (kind === "docs" && count !== chunkManifest.chunkCount))
			throw new Error(`${kind} chunk count mismatch`);
	}
	if (db.prepare("SELECT 1 FROM embeddings WHERE used=0 LIMIT 1").get())
		throw new Error("embedding set contains extra retrieval texts");
	return {
		revision: indexRevision(docsId, noticeId),
		pointCount,
		docsEmbeddingSet: docsId,
		noticeEmbeddingSet: noticeId,
	};
}
export function* targetPoints(db: DatabaseSync): Generator<UnifiedPoint> {
	for (const row of db.prepare("SELECT point FROM target ORDER BY id").iterate())
		yield JSON.parse(row.point as string);
}
