import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	CANONICAL_EMBEDDING_MODEL,
	EMBEDDING_SPACE,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";

import { writeImmutable } from "./artifacts.ts";
import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	assertNoticeEmbeddingModelTargetSha256,
	noticeEmbeddingCachePath,
	parseCachedNoticeEmbedding,
	resolveNoticeEmbeddingVectors,
} from "./embedding-cache.ts";
import { canonicalJsonBytes, encodeNdjson, sha256, unicodeLength } from "./encoding.ts";
import { artifactHex, readNoticeChunkRun } from "./run-reader.ts";
import type { ArtifactReference, NoticeChunk, Sha256Ref } from "./types.ts";

export const NOTICE_EMBEDDING_SAMPLE_DEFINITION = {
	algorithm: "notice_embedding_stratified.v2",
	sampleTarget: 400,
	strata: [
		{ name: "tiny", target: 40, unit: "chunk" },
		{ name: "short", target: 40, unit: "chunk" },
		{ name: "medium", target: 40, unit: "chunk" },
		{ name: "long", target: 40, unit: "chunk" },
		{ name: "near-max", target: 40, unit: "chunk" },
		{ name: "headed", target: 40, unit: "chunk" },
		{ name: "preamble", target: 40, unit: "chunk" },
		{ name: "boundary", target: 40, unit: "boundary-pair" },
		{ name: "random-control", target: 40, unit: "chunk" },
	],
} as const;

export const NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION = "notice_embedding_sample_run.v1" as const;
export const NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION =
	"notice_embedding_sample_report.v1" as const;
export const NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION =
	"notice_embedding_sample_report_run.v1" as const;

type ConfiguredSampleStratum = (typeof NOTICE_EMBEDDING_SAMPLE_DEFINITION.strata)[number]["name"];

export type NoticeEmbeddingSampleStratum = ConfiguredSampleStratum | "coverage-fill";

export interface NoticeEmbeddingSampleBoundary {
	boundaryIndex: number;
	direction: "next" | "previous";
	nextChunkId: Sha256Ref;
	nextChunkIndex: number;
	previousChunkId: Sha256Ref;
	previousChunkIndex: number;
}

export interface NoticeEmbeddingSampleRecord {
	boundaries: NoticeEmbeddingSampleBoundary[];
	chunkId: Sha256Ref;
	chunkIndex: number;
	content: string;
	contentChars: number;
	headingPath: string[];
	noticeId: string;
	retrievalText: string;
	retrievalTextSha256: Sha256Ref;
	strata: NoticeEmbeddingSampleStratum[];
}

export interface NoticeEmbeddingSampleStratumSummary {
	eligibleCount: number;
	name: NoticeEmbeddingSampleStratum;
	selectedCount: number;
	target: number;
	unit: "chunk" | "boundary-pair";
}

export interface NoticeEmbeddingSampleManifest {
	chunkDefinition: {
		algorithm: string;
		maxChars: number;
		overlapChars: number;
		targetChars: number;
	};
	chunkRun: Sha256Ref;
	embeddingSpace: typeof EMBEDDING_SPACE;
	model: typeof CANONICAL_EMBEDDING_MODEL;
	modelTargetSha256: string;
	sample: ArtifactReference;
	sampleDefinition: typeof NOTICE_EMBEDDING_SAMPLE_DEFINITION;
	selectedChunkCount: number;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION;
	uniqueEmbeddingInputCount: number;
}

export interface NoticeEmbeddingSampleStatus {
	cacheStatus: "generated" | "reused";
	chunkId: Sha256Ref;
	retrievalTextSha256: Sha256Ref;
	valid: true;
}

export interface NoticeEmbeddingSampleReport {
	cacheValidation: {
		canonicalJsonPassed: true;
		embeddingSpacePassed: true;
		modelTargetPassed: true;
		schemaPassed: true;
		textSha256Passed: true;
	};
	cacheSchemaVersion: typeof NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION;
	chunkRun: Sha256Ref;
	embeddingSpace: typeof EMBEDDING_SPACE;
	finiteValuesPassed: true;
	generatedEmbeddingInputCount: number;
	modelTargetSha256: string;
	nonZeroNormPassed: true;
	passed: true;
	reusedEmbeddingInputCount: number;
	sampleRun: Sha256Ref;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION;
	selectedChunkCount: number;
	statuses: NoticeEmbeddingSampleStatus[];
	strata: NoticeEmbeddingSampleStratumSummary[];
	uniqueEmbeddingInputCount: number;
	vectorDimensions: number;
	vectorDimensionsPassed: true;
}

export interface NoticeEmbeddingSampleReportManifest {
	modelTargetSha256: string;
	report: ArtifactReference;
	sampleRun: Sha256Ref;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION;
}

export interface LocalNoticeEmbeddingSampleResult {
	generatedEmbeddingInputCount: number;
	outputDirectory: string;
	report: NoticeEmbeddingSampleReport;
	reportDirectory: string;
	reportRun: Sha256Ref;
	reusedEmbeddingInputCount: number;
	run: Sha256Ref;
	selectedChunkCount: number;
	uniqueEmbeddingInputCount: number;
}

export interface NoticeEmbeddingSampleSelection {
	records: NoticeEmbeddingSampleRecord[];
	strata: NoticeEmbeddingSampleStratumSummary[];
}

interface SelectedSampleChunk {
	boundaries: NoticeEmbeddingSampleBoundary[];
	chunk: NoticeChunk;
	strata: Set<NoticeEmbeddingSampleStratum>;
}

interface BoundaryPair {
	boundaryIndex: number;
	next: NoticeChunk;
	previous: NoticeChunk;
	key: string;
}

export async function runLocalNoticeEmbeddingSample(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
}): Promise<LocalNoticeEmbeddingSampleResult> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const runData = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const selection = selectNoticeEmbeddingSample({
		chunks: runData.chunks,
		chunksByNoticeId: runData.chunksByNoticeId,
	});
	const chunksById = new Map(runData.chunks.map((chunk) => [chunk.chunkId, chunk]));
	const textBySha256 = new Map<Sha256Ref, string>();
	for (const record of selection.records) {
		const chunk = chunksById.get(record.chunkId);
		if (!chunk) throw new Error(`notice embedding sample references missing chunk ${record.chunkId}`);
		if (record.retrievalText !== chunk.retrievalText) {
			throw new Error(`notice embedding sample retrieval text differs: ${record.chunkId}`);
		}
		if (record.retrievalTextSha256 !== sha256(record.retrievalText)) {
			throw new Error(`notice embedding sample retrieval text hash is invalid: ${record.chunkId}`);
		}
		const existing = textBySha256.get(record.retrievalTextSha256);
		if (existing !== undefined && existing !== record.retrievalText) {
			throw new Error(`notice embedding text SHA-256 collision: ${record.retrievalTextSha256}`);
		}
		textBySha256.set(record.retrievalTextSha256, record.retrievalText);
	}

	const sampleArtifact = buildNoticeEmbeddingSampleManifest({
		chunkDefinition: runData.manifest.definition,
		chunkRun: input.chunkRun,
		modelTargetSha256: input.modelTargetSha256,
		records: selection.records,
	});
	const { manifestBytes, run, sampleBytes } = sampleArtifact;
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"embedding-samples",
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "sample.ndjson"), sampleBytes),
	]);

	const resolved = await resolveNoticeEmbeddingVectors({
		artifactRoot: input.artifactRoot,
		embedding: input.embedding,
		modelTargetSha256: input.modelTargetSha256,
		...(input.onEmbeddingProgress ? { onProgress: input.onEmbeddingProgress } : {}),
		textBySha256,
	});
	for (const textSha256 of textBySha256.keys()) {
		const cacheBytes = await readFile(
			noticeEmbeddingCachePath(input.artifactRoot, input.modelTargetSha256, textSha256),
		);
		parseCachedNoticeEmbedding(cacheBytes, textSha256, input.modelTargetSha256);
	}
	const statuses = selection.records.map<NoticeEmbeddingSampleStatus>((record) => ({
		cacheStatus: resolved.generatedTextSha256s.has(record.retrievalTextSha256)
			? "generated"
			: "reused",
		chunkId: record.chunkId,
		retrievalTextSha256: record.retrievalTextSha256,
		valid: true,
	}));
	const report: NoticeEmbeddingSampleReport = {
		cacheValidation: {
			canonicalJsonPassed: true,
			embeddingSpacePassed: true,
			modelTargetPassed: true,
			schemaPassed: true,
			textSha256Passed: true,
		},
		cacheSchemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
		chunkRun: input.chunkRun,
		embeddingSpace: EMBEDDING_SPACE,
		finiteValuesPassed: true,
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		modelTargetSha256: input.modelTargetSha256,
		nonZeroNormPassed: true,
		passed: true,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		sampleRun: run,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION,
		selectedChunkCount: selection.records.length,
		statuses,
		strata: selection.strata,
		uniqueEmbeddingInputCount: textBySha256.size,
		vectorDimensions: EMBEDDING_SPACE.dimensions,
		vectorDimensionsPassed: true,
	};
	const reportBytes = canonicalJsonBytes(report);
	const reportManifest: NoticeEmbeddingSampleReportManifest = {
		modelTargetSha256: input.modelTargetSha256,
		report: reference("report.json", reportBytes),
		sampleRun: run,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION,
	};
	const reportManifestBytes = canonicalJsonBytes(reportManifest);
	const reportRun = sha256(reportManifestBytes);
	const reportDirectory = join(outputDirectory, "reports", "sha256", artifactHex(reportRun));
	await mkdir(reportDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(reportDirectory, "manifest.json"), reportManifestBytes),
		writeImmutable(join(reportDirectory, "report.json"), reportBytes),
	]);
	return {
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		outputDirectory,
		report,
		reportDirectory,
		reportRun,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		run,
		selectedChunkCount: selection.records.length,
		uniqueEmbeddingInputCount: textBySha256.size,
	};
}

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

export function selectNoticeEmbeddingSample(input: {
	chunks: readonly NoticeChunk[];
	chunksByNoticeId: ReadonlyMap<string, readonly NoticeChunk[]>;
}): NoticeEmbeddingSampleSelection {
	if (input.chunks.length === 0) throw new Error("notice embedding sample requires chunks");
	const chunks = [...input.chunks].sort(compareChunks);
	const target = Math.min(NOTICE_EMBEDDING_SAMPLE_DEFINITION.sampleTarget, chunks.length);
	const boundariesByChunkId = buildBoundaries(input.chunksByNoticeId);
	const selected = new Map<Sha256Ref, SelectedSampleChunk>();
	const eligibleByStratum = new Map<NoticeEmbeddingSampleStratum, number>();
	let selectedBoundaryPairs = 0;

	const addChunk = (chunk: NoticeChunk, stratum: NoticeEmbeddingSampleStratum): void => {
		const current = selected.get(chunk.chunkId);
		if (current) {
			current.strata.add(stratum);
			return;
		}
		if (selected.size >= target) return;
		selected.set(chunk.chunkId, {
			boundaries: [...(boundariesByChunkId.get(chunk.chunkId) ?? [])],
			chunk,
			strata: new Set([stratum]),
		});
	};

	const selectChunkStratum = (
		stratum: ConfiguredSampleStratum | "coverage-fill",
		eligible: readonly NoticeChunk[],
		limit: number,
	): void => {
		eligibleByStratum.set(stratum, eligible.length);
		let selectedCount = 0;
		for (const chunk of stableChunkSort(eligible, stratum)) {
			if (selectedCount >= limit) break;
			const existing = selected.get(chunk.chunkId);
			if (existing) {
				existing.strata.add(stratum);
				selectedCount += 1;
				continue;
			}
			if (selected.size >= target) continue;
			addChunk(chunk, stratum);
			selectedCount += 1;
		}
	};

	const boundaryPairs = buildBoundaryPairs(input.chunksByNoticeId);
	for (const stratum of NOTICE_EMBEDDING_SAMPLE_DEFINITION.strata) {
		if (stratum.name === "boundary") {
			eligibleByStratum.set("boundary", boundaryPairs.length);
			for (const pair of stableBoundarySort(boundaryPairs)) {
				if (selectedBoundaryPairs >= stratum.target) break;
				const previousSelected = selected.has(pair.previous.chunkId);
				const nextSelected = selected.has(pair.next.chunkId);
				const newChunkCount = Number(!previousSelected) + Number(!nextSelected);
				if (selected.size + newChunkCount > target) continue;
				addChunk(pair.previous, "boundary");
				addChunk(pair.next, "boundary");
				selectedBoundaryPairs += 1;
			}
			continue;
		}
		selectChunkStratum(
			stratum.name,
			eligibleChunksForStratum(chunks, stratum.name),
			stratum.target,
		);
	}

	const remaining = target - selected.size;
	selectChunkStratum(
		"coverage-fill",
		chunks.filter((chunk) => !selected.has(chunk.chunkId)),
		remaining,
	);

	const records = [...selected.values()]
		.sort((left, right) => compareChunks(left.chunk, right.chunk))
		.map<NoticeEmbeddingSampleRecord>(({ boundaries, chunk, strata }) => ({
			boundaries,
			chunkId: chunk.chunkId,
			chunkIndex: chunk.chunkIndex,
			content: chunk.content,
			contentChars: unicodeLength(chunk.content),
			headingPath: [...chunk.headingPath],
			noticeId: chunk.noticeId,
			retrievalText: chunk.retrievalText,
			retrievalTextSha256: sha256(chunk.retrievalText),
			strata: [...strata].sort(),
		}));
	if (records.length !== target) {
		throw new Error(`notice embedding sample selected ${records.length} chunks, expected ${target}`);
	}
	const strata: NoticeEmbeddingSampleStratumSummary[] = NOTICE_EMBEDDING_SAMPLE_DEFINITION.strata.map(
		(stratum) => ({
			eligibleCount: eligibleByStratum.get(stratum.name) ?? 0,
			name: stratum.name,
			selectedCount:
				stratum.name === "boundary"
					? selectedBoundaryPairs
					: records.filter((record) => record.strata.includes(stratum.name)).length,
			target: stratum.target,
			unit: stratum.unit,
		}),
	);
	strata.push({
		eligibleCount: eligibleByStratum.get("coverage-fill") ?? 0,
		name: "coverage-fill",
		selectedCount: records.filter((record) => record.strata.includes("coverage-fill")).length,
		target: remaining,
		unit: "chunk",
	});
	return { records, strata };
}

function eligibleChunksForStratum(
	chunks: readonly NoticeChunk[],
	stratum: Exclude<ConfiguredSampleStratum, "boundary"> | "coverage-fill",
): NoticeChunk[] {
	if (stratum === "coverage-fill" || stratum === "random-control") return [...chunks];
	switch (stratum) {
		case "tiny":
			return chunks.filter((chunk) => unicodeLength(chunk.content) < 120);
		case "short":
			return chunks.filter((chunk) => {
				const chars = unicodeLength(chunk.content);
				return chars >= 120 && chars < 300;
			});
		case "medium":
			return chunks.filter((chunk) => {
				const chars = unicodeLength(chunk.content);
				return chars >= 300 && chars < 600;
			});
		case "long":
			return chunks.filter((chunk) => {
				const chars = unicodeLength(chunk.content);
				return chars >= 600 && chars < 1000;
			});
		case "near-max":
			return chunks.filter((chunk) => unicodeLength(chunk.content) >= 1000);
		case "headed":
			return chunks.filter((chunk) => chunk.headingPath.length > 0);
		case "preamble":
			return chunks.filter((chunk) => chunk.headingPath.length === 0);
	}
}

function buildBoundaryPairs(
	chunksByNoticeId: ReadonlyMap<string, readonly NoticeChunk[]>,
): BoundaryPair[] {
	const pairs: BoundaryPair[] = [];
	for (const chunks of chunksByNoticeId.values()) {
		const ordered = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
		for (let boundaryIndex = 0; boundaryIndex < ordered.length - 1; boundaryIndex += 1) {
			const previous = ordered[boundaryIndex];
			const next = ordered[boundaryIndex + 1];
			if (!(previous && next)) throw new Error("notice embedding sample boundary is invalid");
			pairs.push({
				boundaryIndex,
				key: `${previous.noticeId}\0${boundaryIndex}`,
				next,
				previous,
			});
		}
	}
	return pairs;
}

function buildBoundaries(
	chunksByNoticeId: ReadonlyMap<string, readonly NoticeChunk[]>,
): Map<Sha256Ref, NoticeEmbeddingSampleBoundary[]> {
	const result = new Map<Sha256Ref, NoticeEmbeddingSampleBoundary[]>();
	const append = (chunkId: Sha256Ref, boundary: NoticeEmbeddingSampleBoundary): void => {
		const current = result.get(chunkId) ?? [];
		current.push(boundary);
		result.set(chunkId, current);
	};
	for (const pair of buildBoundaryPairs(chunksByNoticeId)) {
		append(pair.previous.chunkId, {
			boundaryIndex: pair.boundaryIndex,
			direction: "next",
			nextChunkId: pair.next.chunkId,
			nextChunkIndex: pair.next.chunkIndex,
			previousChunkId: pair.previous.chunkId,
			previousChunkIndex: pair.previous.chunkIndex,
		});
		append(pair.next.chunkId, {
			boundaryIndex: pair.boundaryIndex,
			direction: "previous",
			nextChunkId: pair.next.chunkId,
			nextChunkIndex: pair.next.chunkIndex,
			previousChunkId: pair.previous.chunkId,
			previousChunkIndex: pair.previous.chunkIndex,
		});
	}
	for (const boundaries of result.values()) {
		boundaries.sort(
			(left, right) =>
				left.boundaryIndex - right.boundaryIndex || left.direction.localeCompare(right.direction),
		);
	}
	return result;
}

function stableChunkSort(
	chunks: readonly NoticeChunk[],
	stratum: NoticeEmbeddingSampleStratum,
): NoticeChunk[] {
	return [...chunks].sort((left, right) =>
		stableSampleRank(stratum, left.chunkId).localeCompare(stableSampleRank(stratum, right.chunkId)) ||
		left.chunkId.localeCompare(right.chunkId),
	);
}

function stableBoundarySort(pairs: readonly BoundaryPair[]): BoundaryPair[] {
	return [...pairs].sort(
		(left, right) =>
			stableSampleRank("boundary", left.key).localeCompare(stableSampleRank("boundary", right.key)) ||
			left.key.localeCompare(right.key),
	);
}

function stableSampleRank(scope: string, value: string): string {
	return sha256(`${NOTICE_EMBEDDING_SAMPLE_DEFINITION.algorithm}\0${scope}\0${value}`);
}

function compareChunks(left: NoticeChunk, right: NoticeChunk): number {
	return (
		compareNoticeIds(left.noticeId, right.noticeId) ||
		left.chunkIndex - right.chunkIndex ||
		left.chunkId.localeCompare(right.chunkId)
	);
}

function compareNoticeIds(left: string, right: string): number {
	return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}
