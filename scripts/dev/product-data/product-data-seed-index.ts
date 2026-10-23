import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createLocalEmbeddingConnection,
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { createFilesystemArtifactStore } from "../../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import {
	buildCampusDocsChunkSet,
	buildCampusDocsEmbeddingSet,
} from "../../../jobs/campus-docs-index-publisher/src/publisher.ts";
import { writeStoredNoticeChunks } from "../../../jobs/notice-index-publisher/src/artifacts.ts";
import { buildNoticeChunkRun } from "../../../jobs/notice-index-publisher/src/command.ts";
import { buildNoticeEmbeddingSet } from "../../../jobs/notice-index-publisher/src/embedding-set.ts";
import { assembleCandidate } from "../../../jobs/retrieval-index/src/publisher.ts";
import type { Sha256Ref } from "../../../jobs/retrieval-index/src/types.ts";
import { createProductSeed } from "./product-data-seed.ts";

/** Maintainer regeneration only; data seed consumes committed artifacts without provider calls. */
export async function buildProductSeedIndex(
	root: string,
	input: { apiKey: string; baseUrl: string },
) {
	const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
	const disk = createFilesystemArtifactStore(root);
	const store = {
		...disk,
		async list(prefix: string) {
			return (await readdir(root, { recursive: true })).filter((key) => key.startsWith(prefix));
		},
		async writeImmutableFile(key: string, file: { path: string }) {
			await disk.writeImmutable(key, await readFile(file.path));
		},
	};
	const sourceStore = {
		async read(key: string) {
			const object = seed.objects.get(key);
			if (!object) {
				throw new Error(`Missing seed source object: ${key}`);
			}
			return object.body;
		},
	};
	const connection = createLocalEmbeddingConnection(input);
	const embedding = createOpenAICompatibleEmbeddingClient(connection);
	const docs = await buildCampusDocsChunkSet({ sourceStore, artifactStore: store });
	const notices = await writeStoredNoticeChunks({
		artifactStore: store,
		...buildNoticeChunkRun({
			sources: seed.rows["notices.notices"]
				.filter((row) => row.is_published && !row.is_external)
				.map((row) => ({
					noticeId: String(row.notice_id),
					title: String(row.title),
					contentText: String(row.content_text),
					releasedAt: new Date(String(row.released_at)).toISOString(),
				})),
		}),
	});
	const docsEmbedding = await buildCampusDocsEmbeddingSet({
		artifactStore: store,
		chunkSet: docs.chunkSet,
		embedding,
		embeddingTargetSha256: connection.targetSha256,
	});
	const noticeEmbedding = await buildNoticeEmbeddingSet({
		artifactStore: store,
		chunks: notices.chunks.sha256,
		embedding,
		modelTargetSha256: connection.targetSha256,
	});
	return {
		docsEmbeddingSet: docsEmbedding.embeddingSet,
		noticeEmbeddingSet: noticeEmbedding.embeddingSet,
	};
}

export async function readProductSeedIndex(repoRoot: string) {
	const root = join(repoRoot, "scripts/dev/product-data/fixtures/product-data");
	const binding = JSON.parse(await readFile(join(root, "index.json"), "utf8")) as {
		docsEmbeddingSet: Sha256Ref;
		noticeEmbeddingSet: Sha256Ref;
	};
	const candidate = await assembleCandidate(
		createFilesystemArtifactStore(root),
		binding.docsEmbeddingSet,
		binding.noticeEmbeddingSet,
	);
	return { ...candidate, ...binding };
}
