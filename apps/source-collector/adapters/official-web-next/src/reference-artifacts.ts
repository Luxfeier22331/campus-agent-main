import type { OfficialWebNextReferencePipelineResult } from "./reference-pipeline.ts";
import type { OfficialWebNextArtifactStore, StoredArtifactRef } from "./types.ts";

const textEncoder = new TextEncoder();

export async function uploadOfficialWebNextReferenceArtifacts(input: {
	artifactStore: OfficialWebNextArtifactStore;
	reference: OfficialWebNextReferencePipelineResult;
}): Promise<StoredArtifactRef[]> {
	const prefix = `official_web_next/${input.reference.releaseManifest.siteId}/runs/${input.reference.releaseManifest.crawlRunId}/reference`;
	const artifacts = [
		{
			objectKey: `${prefix}/document-units.jsonl`,
			contentType: "application/x-ndjson",
			body: toJsonLines(input.reference.documentUnits),
			recordCount: input.reference.documentUnits.length,
		},
		{
			objectKey: `${prefix}/chunks.jsonl`,
			contentType: "application/x-ndjson",
			body: toJsonLines(input.reference.chunks),
			recordCount: input.reference.chunks.length,
		},
		{
			objectKey: `${prefix}/release-manifest.json`,
			contentType: "application/json",
			body: JSON.stringify(input.reference.releaseManifest, null, 2),
			recordCount: 1,
		},
	];
	const refs: StoredArtifactRef[] = [];
	for (const artifact of artifacts) {
		refs.push(
			await input.artifactStore.putObject({
				objectKey: artifact.objectKey,
				contentType: artifact.contentType,
				data: textEncoder.encode(artifact.body),
				recordCount: artifact.recordCount,
			}),
		);
	}
	return refs;
}

function toJsonLines(rows: unknown[]): string {
	return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
}
