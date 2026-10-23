import { COLLECTION_DEFINITION } from "../definitions.ts";
import type {
	CampusDocsPointPayload,
	CurrentIndexBinding,
	IndexChunk,
	IndexPoint,
	Sha256Ref,
} from "../types.ts";
import { INDEX_COLLECTION_PREFIX } from "../types.ts";
import { sha256Text, stableUuid } from "./content-digest.ts";
import { buildSparseVector } from "./sparse-vector.ts";

export function buildCurrentIndexBinding(
	index: Sha256Ref,
): CurrentIndexBinding {
	const digest = index.slice("sha256:".length);
	return {
		collection: `${INDEX_COLLECTION_PREFIX}_${digest}`,
	};
}
export function buildPoint(input: {
	chunk: IndexChunk;
	dense: number[];
}): IndexPoint {
	const textSha = sha256Text(input.chunk.content);
	const retrievalTextSha = sha256Text(input.chunk.retrievalText);
	const payload: CampusDocsPointPayload = {
		chunk_id: input.chunk.chunkId,
		document_id: input.chunk.documentId,
		document_title: input.chunk.documentTitle,
		retrieval_text_sha256: retrievalTextSha,
		root_unit_ids: input.chunk.rootUnitIds,
		schema_version: COLLECTION_DEFINITION.pointSchemaVersion,
		section_ref: input.chunk.sectionRef,
		section_title: input.chunk.sectionTitle,
		text: input.chunk.content,
		text_sha256: textSha,
		version_id: input.chunk.versionId,
		version_slug: input.chunk.versionSlug,
		is_current: input.chunk.isCurrent ?? true,
		applicable_from_admission_year: input.chunk.applicableFromAdmissionYear ?? null,
		applicable_to_admission_year: input.chunk.applicableToAdmissionYear ?? null,
		corpus: input.chunk.corpus ?? "regulations",
	};
	return {
		id: buildPointId(input.chunk),
		payload,
		vector: {
			dense: input.dense,
			sparse: buildSparseVector(input.chunk.retrievalText),
		},
	};
}

export function buildPointId(chunk: IndexChunk): string {
	return stableUuid([COLLECTION_DEFINITION.pointSchemaVersion, chunk.chunkId]);
}
