import { describe, expect, it } from "vitest";
import {
	type OfficialWebNextArtifactStore,
	type OfficialWebNextReferencePipelineResult,
	uploadOfficialWebNextReferenceArtifacts,
} from "../src/index.ts";

class InMemoryArtifactStore implements OfficialWebNextArtifactStore {
	readonly writes = new Map<string, string>();

	async putObject(input: { objectKey: string; data: Uint8Array; contentType: string }) {
		this.writes.set(input.objectKey, new TextDecoder().decode(input.data));
		return {
			objectKey: input.objectKey,
			contentSha256: `test-sha-${input.objectKey}`,
			byteSize: input.data.byteLength,
		};
	}
}

describe("official-web-next reference artifacts", () => {
	it("uploads document units, chunks, and candidate release manifest without publishing", async () => {
		const artifactStore = new InMemoryArtifactStore();
		const reference: OfficialWebNextReferencePipelineResult = {
			documentUnits: [
				{
					schemaVersion: "official_web_next_document_unit.v1",
					documentUnitId: "owdoc_1",
					rawAssetId: "owasset_1",
					rawVersionId: "owver_1",
					sourceUrl: "https://www.example.edu/about.html",
					title: "About",
					text: "About text",
					sourceBlocks: [0, 1],
				},
			],
			chunks: [
				{
					schemaVersion: "official_web_next_chunk.v1",
					chunkId: "owchunk_1",
					documentUnitId: "owdoc_1",
					sourceUrl: "https://www.example.edu/about.html",
					text: "About text",
					sourceBlockRange: { start: 0, end: 1 },
				},
			],
			releaseManifest: {
				schemaVersion: "official_web_next_release_manifest.v1",
				releaseId: "candidate-release-001",
				siteId: "muc_public",
				crawlRunId: "ow-next-run-001",
				documentUnitCount: 1,
				chunkCount: 1,
				aliasPublished: false,
				currentPointerUpdated: false,
			},
		};

		const refs = await uploadOfficialWebNextReferenceArtifacts({
			artifactStore,
			reference,
		});

		expect(refs.map((ref) => ref.objectKey)).toEqual([
			"official_web_next/muc_public/runs/ow-next-run-001/reference/document-units.jsonl",
			"official_web_next/muc_public/runs/ow-next-run-001/reference/chunks.jsonl",
			"official_web_next/muc_public/runs/ow-next-run-001/reference/release-manifest.json",
		]);
		expect(artifactStore.writes.get(refs[2].objectKey)).toContain('"aliasPublished": false');
		expect(artifactStore.writes.get(refs[2].objectKey)).toContain('"currentPointerUpdated": false');
	});
});
