import { createHash } from "node:crypto";

type Sha256Ref = `sha256:${string}`;

export interface CleanupStore {
	read(key: string): Promise<Uint8Array>;
	list(prefix: string): Promise<readonly string[]>;
	inspect(key: string): Promise<{ runId: string | null; modifiedAt: Date | null }>;
	remove(key: string): Promise<void>;
}

interface CleanupManifest {
	schemaVersion?: unknown;
	embeddings?: { key?: unknown };
	chunkRun?: unknown;
	chunks?: { file?: unknown; key?: unknown };
	validation?: { file?: unknown };
	reviewSamples?: { file?: unknown };
}

/** Only manifest references are needed; deleted data must not prevent cleanup retries. */
export async function noticeArtifactKeys(
	store: Pick<CleanupStore, "read">,
	embeddingSet: Sha256Ref,
): Promise<Set<string>> {
	const keys = new Set<string>();
	const manifestKey = `notices/rag/embedding-sets/sha256/${embeddingSet.slice(7)}/manifest.json`;
	keys.add(manifestKey);
	const embedding = await manifest(store, manifestKey, embeddingSet);
	if (!embedding) {
		return keys;
	}
	const dataKey = embedding.embeddings?.key;
	if (
		typeof dataKey !== "string" ||
		!/^notices\/rag\/embedding-data\/sha256\/[a-f0-9]{64}\/embeddings.ndjson$/u.test(dataKey)
	) {
		throw new Error("Invalid notice embedding data reference during cleanup");
	}
	keys.add(dataKey);
	if (embedding.schemaVersion === "notice_embedding_set.v2") {
		const key = embedding.chunks?.key;
		if (
			typeof key !== "string" ||
			!/^notices\/rag\/chunk-data\/sha256\/[a-f0-9]{64}\/chunks.ndjson$/u.test(key)
		) {
			throw new Error("Invalid notice chunk data reference during cleanup");
		}
		keys.add(key);
		return keys;
	}
	const chunkRun = embedding.chunkRun;
	if (typeof chunkRun !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(chunkRun)) {
		throw new Error("Invalid notice chunk reference during cleanup");
	}
	const prefix = `notices/rag/chunk-runs/sha256/${chunkRun.slice(7)}`;
	keys.add(`${prefix}/manifest.json`);
	const chunks = await manifest(store, `${prefix}/manifest.json`, chunkRun as Sha256Ref);
	if (chunks) {
		for (const part of [chunks.chunks, chunks.validation, chunks.reviewSamples]) {
			if (typeof part?.file !== "string" || !/^[a-z-]+\.(?:ndjson|json)$/u.test(part.file)) {
				throw new Error("Invalid notice chunk file during cleanup");
			}
			keys.add(`${prefix}/${part.file}`);
		}
	}
	return keys;
}

async function manifest(
	store: Pick<CleanupStore, "read">,
	key: string,
	expected: Sha256Ref,
): Promise<CleanupManifest | null> {
	let body: Uint8Array;
	try {
		body = await store.read(key);
	} catch (error) {
		if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) {
			return null;
		}
		throw error;
	}
	if (`sha256:${createHash("sha256").update(body).digest("hex")}` !== expected) {
		throw new Error("Artifact digest mismatch during cleanup");
	}
	return JSON.parse(Buffer.from(body).toString("utf8"));
}

export async function cleanupAutomaticObjects(input: {
	store: CleanupStore;
	protectedKeys: ReadonlySet<string>;
	retiredKeys: ReadonlySet<string>;
	activeRunIds: ReadonlySet<string>;
	now?: number;
}) {
	const now = input.now ?? Date.now();
	const keys = [...(await input.store.list("notices/rag/"))].sort((a, b) => rank(a) - rank(b));
	let deleted = 0;
	for (const key of keys) {
		if (input.protectedKeys.has(key) || key.includes("/embedding-cache/")) {
			continue;
		}
		const meta = await input.store.inspect(key);
		if (!(meta.runId && meta.modifiedAt) || input.activeRunIds.has(meta.runId)) {
			continue;
		}
		if (!input.retiredKeys.has(key) && now - meta.modifiedAt.getTime() < 24 * 60 * 60_000) {
			continue;
		}
		await input.store.remove(key);
		deleted += 1;
	}
	return deleted;
}
function rank(key: string) {
	return key.endsWith("/manifest.json") ? (key.includes("/embedding-sets/") ? 2 : 1) : 0;
}
