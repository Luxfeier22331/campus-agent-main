import { isDeepStrictEqual } from "node:util";
import { sha256Text } from "./indexing/content-digest.ts";
import type { IndexChunk, StoredChunk } from "./types.ts";

export function assertStoredChunksMatch(
	stored: readonly StoredChunk[],
	generated: readonly IndexChunk[],
): void {
	if (stored.length !== generated.length) {
		throw new Error(`Campus docs stored chunk count = ${stored.length}, generated = ${generated.length}`);
	}
	for (const [index, expected] of generated.entries()) {
		const actual = stored[index];
		if (!actual || !sameChunkIdentityAndContent(actual, expected)) {
			throw new Error(`Campus docs stored chunk differs from current builder at index ${index}`);
		}
		if (actual.retrievalTextSha256 !== sha256Text(actual.retrievalText)) {
			throw new Error(`Campus docs stored chunk retrieval text digest is invalid: ${actual.chunkId}`);
		}
	}
}

function sameChunkIdentityAndContent(left: StoredChunk, right: IndexChunk): boolean {
	return isDeepStrictEqual(
		{
			chunkId: left.chunkId,
			content: left.content,
			documentId: left.documentId,
			documentTitle: left.documentTitle,
			retrievalText: left.retrievalText,
			rootUnitIds: left.rootUnitIds,
			sectionId: left.sectionId,
			sectionRef: left.sectionRef,
			sectionTitle: left.sectionTitle,
			versionId: left.versionId,
			versionLabel: left.versionLabel,
			versionSlug: left.versionSlug,
		},
		{
			chunkId: right.chunkId,
			content: right.content,
			documentId: right.documentId,
			documentTitle: right.documentTitle,
			retrievalText: right.retrievalText,
			rootUnitIds: right.rootUnitIds,
			sectionId: right.sectionId,
			sectionRef: right.sectionRef,
			sectionTitle: right.sectionTitle,
			versionId: right.versionId,
			versionLabel: right.versionLabel,
			versionSlug: right.versionSlug,
		},
	);
}
