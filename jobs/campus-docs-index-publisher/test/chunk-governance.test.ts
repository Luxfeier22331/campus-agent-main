import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "../../../apps/campus-web/fixtures/docs-source-site.ts";
import {
	readGovernanceChunkSet,
} from "../src/chunk-governance-artifacts.ts";
import {
	readCampusDocsChunkGovernanceRun,
	runLocalCampusDocsChunkGovernanceReview,
} from "../src/chunk-governance.ts";
import { buildCampusDocsChunkSet } from "../src/publisher.ts";
import type { ArtifactObjectStore, ReaderObjectStore } from "../src/types.ts";

describe("Campus docs chunk governance", () => {
	it("builds a deterministic census and broad sample from the production chunk set", async () => {
		const fixture = createDocsSourceSiteFixture();
		const artifactStore = memoryArtifactStore();
		const sourceStore: ReaderObjectStore = {
			read: async (key) => requiredObject(fixture.objects, key),
		};
		const chunkSet = await buildCampusDocsChunkSet({ artifactStore, sourceStore });
		const artifactRoot = await mkdtemp(join(tmpdir(), "campus-docs-governance-"));

		const first = await runLocalCampusDocsChunkGovernanceReview({
			artifactRoot,
			artifactStore,
			chunkSet: chunkSet.chunkSet,
			sourceStore,
		});
		const second = await runLocalCampusDocsChunkGovernanceReview({
			artifactRoot,
			artifactStore,
			chunkSet: chunkSet.chunkSet,
			sourceStore,
		});
		const artifact = await readCampusDocsChunkGovernanceRun(artifactRoot, first.run);

		expect(second.run).toBe(first.run);
		expect(artifact.census.chunkCount).toBe(chunkSet.chunkCount);
		expect(artifact.census.documentCount).toBe(chunkSet.documentCount);
		expect(artifact.census.maxHeadingLevel).toBeGreaterThanOrEqual(2);
		expect(artifact.reviewItems).toHaveLength(chunkSet.chunkCount);
		expect(artifact.reviewItemSummary.selectedItemCount).toBe(chunkSet.chunkCount);
		expect(new Set(artifact.reviewItems.map((item) => item.chunk.chunkId))).toHaveLength(chunkSet.chunkCount);
		expect(artifact.sample).toHaveLength(chunkSet.documentCount);
	});

	it("reads historical chunk definitions without requiring the current production definition", async () => {
		const fixture = createDocsSourceSiteFixture();
		const artifactStore = memoryArtifactStore();
		const sourceStore: ReaderObjectStore = {
			read: async (key) => requiredObject(fixture.objects, key),
		};
		const built = await buildCampusDocsChunkSet({ artifactStore, sourceStore });
		const manifestKey = `campus-docs/rag/chunk-sets/sha256/${built.chunkSet.slice("sha256:".length)}/manifest.json`;
		const original = JSON.parse(new TextDecoder().decode(await artifactStore.read(manifestKey))) as Record<string, unknown>;
		const historical = {
			...original,
			chunkDefinition: {
				...(original.chunkDefinition as Record<string, unknown>),
				algorithm: "campus_docs_reader_elements.v3",
			},
		};
		const bytes = new TextEncoder().encode(`${JSON.stringify(historical)}\n`);
		const historicalId = await import("../../../apps/campus-web/src/docs-reader-build/source-catalog.ts")
			.then(({ sha256 }) => sha256(bytes));
		await artifactStore.writeImmutable(
			`campus-docs/rag/chunk-sets/sha256/${historicalId.slice("sha256:".length)}/manifest.json`,
			bytes,
		);

		const read = await readGovernanceChunkSet(artifactStore, historicalId);

		expect(read.manifest.chunkDefinition.algorithm).toBe("campus_docs_reader_elements.v3");
		expect(read.chunks).toHaveLength(built.chunkCount);
	});
});

function memoryArtifactStore(): ArtifactObjectStore {
	const objects = new Map<string, Uint8Array>();
	return {
		async read(key) {
			const value = objects.get(key);
			if (!value) throw new Error(`missing artifact: ${key}`);
			return value;
		},
		async writeImmutable(key, body) {
			const existing = objects.get(key);
			if (existing && !Buffer.from(existing).equals(Buffer.from(body))) {
				throw new Error(`artifact conflict: ${key}`);
			}
			objects.set(key, body);
		},
	};
}

function requiredObject(
	objects: ReadonlyMap<string, { body: Uint8Array }>,
	key: string,
): Uint8Array {
	const value = objects.get(key);
	if (!value) throw new Error(`missing fixture object: ${key}`);
	return value.body;
}
