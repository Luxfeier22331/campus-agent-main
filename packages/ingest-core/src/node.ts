import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateIngestionTaskRegistry } from "ingestion-contracts";
import { type CollectionChunkProfile, parseCollectionChunkProfile } from "./collection-profiles.ts";
import {
	createIngestionTaskRegistryCatalog,
	type IngestionTaskRegistry,
	type IngestionTaskRegistryCatalog,
} from "./core.ts";
import { auditIngestionRegistryExecutability } from "./task-executor.ts";

export function loadIngestionTaskRegistryFromFile(path: string): IngestionTaskRegistry {
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const validation = validateIngestionTaskRegistry(payload);
	if (!validation.ok) {
		throw new Error(`invalid ingestion task registry: ${validation.errors.join("; ")}`);
	}
	return payload as IngestionTaskRegistry;
}

export function loadIngestionTaskRegistryCatalogFromRoot(
	root: string,
): IngestionTaskRegistryCatalog {
	const registries = listIngestionTaskRegistryFiles(root).map(loadIngestionTaskRegistryFromFile);
	const issues = auditIngestionRegistryExecutability(registries);
	if (issues.length > 0) {
		throw new Error(
			`invalid ingestion task registry executability: ${issues
				.map((issue) => `${issue.identity}: ${issue.message}`)
				.join("; ")}`,
		);
	}
	return createIngestionTaskRegistryCatalog(registries);
}

export function listIngestionTaskRegistryFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return listIngestionTaskRegistryFiles(path);
		}
		return entry.name === "task-registry.v3.json" ? [path] : [];
	});
}

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
