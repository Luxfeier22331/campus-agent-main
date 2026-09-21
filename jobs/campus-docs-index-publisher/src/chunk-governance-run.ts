import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
	artifactHex,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
	encodeGovernanceNdjson,
	reference,
	writeImmutableGovernanceFile,
} from "./chunk-governance-artifacts.ts";
import { readChunkSet } from "./artifacts.ts";
import {
	analyzeCorpus,
	assertStoredChunksMatch,
} from "./chunk-governance-analysis.ts";
import {
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
} from "./chunk-governance-definitions.ts";
import { readCampusDocsChunkEmbeddingEvaluation } from "./chunk-embedding-evaluation.ts";
import type {
	CampusDocsChunkGovernanceResult,
	CampusDocsChunkGovernanceRunManifest,
} from "./chunk-governance-types.ts";
import { canonicalJsonBytes, sha256 } from "./indexing/content-digest.ts";
import { DOCS_SOURCE_KEY } from "campus-contracts/campus-docs";
import { buildChunks } from "./indexing/chunks.ts";
import { loadCurrentVersions, parseIndexingSource, indexedSourceProjectionSha256 } from "./indexing/source.ts";
import { assertValidChunkSet } from "./chunk-validation.ts";
import {
	type ArtifactObjectStore,
	type ReaderObjectStore,
	type Sha256Ref,
} from "./types.ts";

const GOVERNANCE_REVIEW_DIRECTORY = "reviews";

export async function runLocalCampusDocsChunkGovernanceReview(input: {
	artifactRoot: string;
	artifactStore: ArtifactObjectStore;
	chunkSet: Sha256Ref;
	embeddingEvaluation?: Sha256Ref;
	sourceStore: ReaderObjectStore;
}): Promise<CampusDocsChunkGovernanceResult> {
	const [chunkSet, sourceBytes, embeddingEvaluation] = await Promise.all([
		readChunkSet(input.artifactStore, input.chunkSet),
		input.sourceStore.read(DOCS_SOURCE_KEY),
		input.embeddingEvaluation
			? readCampusDocsChunkEmbeddingEvaluation(input.artifactRoot, input.embeddingEvaluation)
			: Promise.resolve(undefined),
	]);
	if (embeddingEvaluation && embeddingEvaluation.manifest.chunkSet !== input.chunkSet) {
		throw new Error("Campus docs embedding evaluation does not reference the reviewed chunk set");
	}
	const source = parseIndexingSource(sourceBytes);
	const selections = await loadCurrentVersions({ source, readerStore: input.sourceStore });
	const projection = indexedSourceProjectionSha256(selections);
	if (projection !== chunkSet.manifest.sourceProjectionSha256) {
		throw new Error("Campus docs chunk set does not match the current source projection");
	}
	const generatedChunks = selections.flatMap((selection) =>
		buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
			isCurrent: selection.isCurrent,
			applicableFromAdmissionYear: selection.applicableFromAdmissionYear,
			applicableToAdmissionYear: selection.applicableToAdmissionYear,
		}),
	);
	assertValidChunkSet({ chunks: generatedChunks, selections });
	assertStoredChunksMatch(chunkSet.chunks, generatedChunks);

	const analysis = analyzeCorpus({
		chunkSet: input.chunkSet,
		chunks: chunkSet.chunks,
		...(embeddingEvaluation ? { embeddingEvaluation } : {}),
		selections,
		sourceProjectionSha256: projection,
	});
	const censusBytes = canonicalJsonBytes(analysis.census);
	const sampleBytes = encodeGovernanceNdjson(analysis.sample);
	const candidatesBytes = encodeGovernanceNdjson(analysis.candidates);
	const summaryBytes = canonicalJsonBytes(analysis.sampleSummary);
	const reviewItemsBytes = encodeGovernanceNdjson(analysis.reviewItems);
	const reviewItemSummaryBytes = canonicalJsonBytes(analysis.reviewItemSummary);
	const manifest: CampusDocsChunkGovernanceRunManifest = {
		candidates: reference("candidates.ndjson", candidatesBytes),
		chunkSet: input.chunkSet,
		census: reference("census.json", censusBytes),
		definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
		...(input.embeddingEvaluation ? { embeddingEvaluation: input.embeddingEvaluation } : {}),
		reviewItemCount: analysis.reviewItems.length,
		reviewItems: reference("review-items.ndjson", reviewItemsBytes),
		reviewItemSummary: reference("review-items-summary.json", reviewItemSummaryBytes),
		sample: reference("sample.ndjson", sampleBytes),
		sampleCount: analysis.sample.length,
		sampleSummary: reference("sample-summary.json", summaryBytes),
		schemaVersion: CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
		sourceProjectionSha256: projection,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		GOVERNANCE_REVIEW_DIRECTORY,
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutableGovernanceFile(join(outputDirectory, "candidates.ndjson"), candidatesBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "census.json"), censusBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "review-items.ndjson"), reviewItemsBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "review-items-summary.json"), reviewItemSummaryBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "sample-summary.json"), summaryBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "sample.ndjson"), sampleBytes),
	]);
	return {
		candidateCount: analysis.candidates.length,
		chunkCount: chunkSet.chunks.length,
		documentCount: selections.length,
		outputDirectory,
		reviewItemCount: analysis.reviewItems.length,
		run,
		sampleCount: analysis.sample.length,
		sourceProjectionSha256: projection,
	};
}
