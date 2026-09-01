import { CANONICAL_EMBEDDING_MODEL, EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";

import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import {
	NOTICE_EMBEDDING_SAMPLE_DEFINITION,
	NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION,
	type NoticeEmbeddingSampleManifest,
	type NoticeEmbeddingSampleRecord,
} from "./embedding-sample-model.ts";
import type { ArtifactReference, Sha256Ref } from "./types.ts";

export function buildNoticeEmbeddingSampleManifest(input: {
	chunkDefinition: NoticeEmbeddingSampleManifest["chunkDefinition"];
	chunkRun: Sha256Ref;
	modelTargetSha256: string;
	records: readonly NoticeEmbeddingSampleRecord[];
}): {
	manifest: NoticeEmbeddingSampleManifest;
	manifestBytes: Uint8Array;
	run: Sha256Ref;
	sampleBytes: Uint8Array;
} {
	if (input.records.length === 0) throw new Error("notice embedding sample has no records");
	const sampleBytes = encodeNdjson(input.records);
	const manifest: NoticeEmbeddingSampleManifest = {
		chunkDefinition: input.chunkDefinition,
		chunkRun: input.chunkRun,
		embeddingSpace: EMBEDDING_SPACE,
		model: CANONICAL_EMBEDDING_MODEL,
		modelTargetSha256: input.modelTargetSha256,
		sample: reference("sample.ndjson", sampleBytes),
		sampleDefinition: NOTICE_EMBEDDING_SAMPLE_DEFINITION,
		selectedChunkCount: input.records.length,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION,
		uniqueEmbeddingInputCount: new Set(
			input.records.map((record) => record.retrievalTextSha256),
		).size,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	return { manifest, manifestBytes, run: sha256(manifestBytes), sampleBytes };
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}
