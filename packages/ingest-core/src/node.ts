import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type CollectionChunkProfile, parseCollectionChunkProfile } from "./collection-profiles.ts";

export function loadCollectionChunkProfilesFromRoot(
	root: string,
): ReadonlyMap<string, CollectionChunkProfile> {
	const profiles = new Map<string, CollectionChunkProfile>();
	for (const path of listCollectionChunkProfileFiles(root)) {
		const profile = parseCollectionChunkProfile(JSON.parse(readFileSync(path, "utf8")) as unknown);
		const key = collectionChunkProfileKey(profile);
		if (profiles.has(key)) {
			throw new Error(`duplicate collection chunk profile: ${key}`);
		}
		profiles.set(key, profile);
	}
	return profiles;
}

export function listCollectionChunkProfileFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return listCollectionChunkProfileFiles(path);
		}
		return entry.name === "chunk-profile.json" ? [path] : [];
	});
}

function collectionChunkProfileKey(
	profile: Pick<CollectionChunkProfile, "collection" | "corpus">,
): string {
	return `${profile.corpus}/${profile.collection}`;
}
