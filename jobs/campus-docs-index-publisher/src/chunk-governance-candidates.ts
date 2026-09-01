import {
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import {
	NEAR_MAX_CHARS,
	SHORT_CHARS,
	TABLE_CONTEXT_OVERHEAD_RATIO,
} from "./chunk-governance-thresholds.ts";
import type {
	CampusDocsReviewCandidate,
	CampusDocsReviewDocument,
	CampusDocsSectionCensus,
} from "./chunk-governance-types.ts";
import { isSourceUrlOnly } from "./indexing/sections.ts";
import { isStandaloneDocumentMetadata } from "./indexing/chunks.ts";

export function buildReviewCandidates(
	review: CampusDocsReviewDocument,
	sections: readonly CampusDocsSectionCensus[],
): CampusDocsReviewCandidate[] {
	const candidates: CampusDocsReviewCandidate[] = [];
	const rootOccurrenceCounts = new Map<string, number>();
	for (const chunk of review.chunks) {
		for (const rootUnitId of chunk.rootUnitIds) {
			rootOccurrenceCounts.set(rootUnitId, (rootOccurrenceCounts.get(rootUnitId) ?? 0) + 1);
		}
		const tableRootCount = chunk.rootUnits.filter((root) => root.kind === "table").length;
		const contextChars = chunk.rootUnits
			.filter((root) => root.kind !== "table")
			.reduce((sum, root) => sum + root.chars, 0);
		if (isSourceUrlOnly(chunk.content)) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: "chunk contains only the captured source URL",
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "source-url-only",
				title: review.documentTitle,
			});
		}
		if (isStandaloneDocumentMetadata(chunk.content)) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: "chunk contains only an approval date, revision date, or document number",
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "standalone-document-metadata",
				title: review.documentTitle,
			});
		}
		if (chunk.rootUnitIds.length >= 8) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `chunk contains ${chunk.rootUnitIds.length} reader root units`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "many-root-units",
				title: review.documentTitle,
			});
		}
		if (chunk.chars >= NEAR_MAX_CHARS && chunk.rootUnitIds.length >= 3) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `near-max chunk (${chunk.chars} chars) combines ${chunk.rootUnitIds.length} reader root units`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "near-max-multi-root",
				title: review.documentTitle,
			});
		}
		if (
			tableRootCount > 0 &&
			contextChars / Math.max(1, chunk.chars) >= TABLE_CONTEXT_OVERHEAD_RATIO
		) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `table chunk carries ${contextChars} chars of adjacent non-table context`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "table-context-overhead",
				title: review.documentTitle,
			});
		}
		if (tableRootCount > 0 && chunk.chars < SHORT_CHARS) {
			candidates.push({
				chunkIndex: chunk.chunkIndex,
				detail: `table chunk is only ${chunk.chars} chars`,
				documentId: review.documentId,
				sectionId: chunk.sectionId,
				signal: "short-table-chunk",
				title: review.documentTitle,
			});
		}
	}
	for (const [rootUnitId, count] of rootOccurrenceCounts) {
		const root = review.chunks
			.flatMap((chunk) => chunk.rootUnits)
			.find((unit) => unit.rootUnitId === rootUnitId);
		if (count > 1 && root?.kind !== "table") {
			for (const chunk of review.chunks.filter((item) => item.rootUnitIds.includes(rootUnitId))) {
				candidates.push({
					chunkIndex: chunk.chunkIndex,
					detail: `reader ${rootUnitId} appears in ${count} chunks`,
					documentId: review.documentId,
					sectionId: chunk.sectionId,
					signal: "split-reader-element",
					title: review.documentTitle,
				});
			}
		}
	}
	for (const section of sections) {
		if (
			section.chunkCount === 1 &&
			section.minChunkChars < SHORT_CHARS &&
			section.headingPath.length >= 2
		) {
			const sectionChunk = review.chunks.find((chunk) => chunk.sectionId === section.sectionId);
			if (!sectionChunk) {
				throw new Error(`Campus docs review section has no chunk: ${section.sectionId}`);
			}
			candidates.push({
				chunkIndex: sectionChunk.chunkIndex,
				detail: `lower-level section has one short chunk (${section.minChunkChars} chars)`,
				documentId: review.documentId,
				sectionId: section.sectionId,
				signal: "section-fragment",
				title: review.documentTitle,
			});
		}
	}
	for (const boundary of review.boundaries) {
		if (
			boundary.sameSection &&
			boundary.combinedChars !== null &&
			boundary.combinedChars <= CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.chunkDefinition.maxChars &&
			boundary.nextIndex === boundary.previousIndex + 1
		) {
			const next = review.chunks[boundary.nextIndex];
			const previous = review.chunks[boundary.previousIndex];
			if (next && previous && (next.chars < SHORT_CHARS || previous.chars < SHORT_CHARS)) {
				candidates.push({
					chunkIndex: boundary.nextIndex,
					detail: `adjacent same-section chunks could fit in ${boundary.combinedChars} chars`,
					documentId: review.documentId,
					sectionId: next.sectionId,
					signal: "mergeable-short-tail",
					title: review.documentTitle,
				});
			}
		}
	}
	return candidates;
}
