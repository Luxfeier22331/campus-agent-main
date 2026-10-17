import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import { assembleCandidate } from "./publisher.ts";
import type { ReaderObjectStore, Sha256Ref, WritableObjectStore } from "./types.ts";

const IMPORTABLE_PREFIXES = ["campus-docs/rag/", "notices/rag/"] as const;

export interface ImportedArtifactResult {
	byteCount: number;
	createdObjectCount: number;
	existingObjectCount: number;
	objectCount: number;
}

export interface ArtifactClosureObject {
	body: Uint8Array;
	key: string;
}

export async function importCampusRagArtifacts(input: {
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
	sourceStore: ReaderObjectStore;
	targetStore: WritableObjectStore;
}): Promise<ImportedArtifactResult> {
	const objects = await collectValidatedArtifactClosure({
		sourceStore: input.sourceStore,
		validate: (store) =>
			assembleCandidate(store, input.docsEmbeddingSet, input.noticeEmbeddingSet).then(
				() => undefined,
			),
	});
	const existing = new Set<string>();
	let byteCount = 0;
	for (const object of objects) {
		byteCount += object.body.byteLength;
		const current = await input.targetStore.readIfExists(object.key);
		if (current === undefined) continue;
		if (!sameBytes(current, object.body)) {
			throw new Error(`immutable object conflicts with existing content: ${object.key}`);
		}
		existing.add(object.key);
	}

	let createdObjectCount = 0;
	let existingObjectCount = existing.size;
	for (const object of objects) {
		if (existing.has(object.key)) continue;
		const result = await input.targetStore.writeImmutable(object.key, object.body);
		if (result === "created") {
			createdObjectCount += 1;
		} else {
			existingObjectCount += 1;
		}
	}
	return {
		byteCount,
		createdObjectCount,
		existingObjectCount,
		objectCount: objects.length,
	};
}

export async function collectValidatedArtifactClosure(input: {
	sourceStore: ReaderObjectStore;
	validate: (store: ReaderObjectStore) => Promise<void>;
}): Promise<ArtifactClosureObject[]> {
	const recorded = new Map<string, Uint8Array>();
	const recordingStore: ReaderObjectStore = {
		async read(key) {
			assertImportableKey(key);
			const body = new Uint8Array(await input.sourceStore.read(key));
			const previous = recorded.get(key);
			if (previous && !sameBytes(previous, body)) {
				throw new Error(`source object changed while importing: ${key}`);
			}
			recorded.set(key, body);
			return body;
		},
	};
	await input.validate(recordingStore);
	const objects = [...recorded.entries()]
		.sort(([left], [right]) => compareCanonicalStrings(left, right))
		.map(([key, body]) => ({ body, key }));
	if (objects.length === 0) {
		throw new Error("validated Campus RAG artifact closure is empty");
	}
	return objects;
}

function assertImportableKey(key: string): void {
	if (!IMPORTABLE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
		throw new Error(`Campus RAG artifact reference is outside the RAG namespaces: ${key}`);
	}
	if (key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new Error(`Campus RAG artifact reference has an invalid object key: ${key}`);
	}
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}
