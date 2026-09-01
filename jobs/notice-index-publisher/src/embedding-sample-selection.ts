import { sha256, unicodeLength } from "./encoding.ts";
import {
	NOTICE_EMBEDDING_SAMPLE_DEFINITION,
	type ConfiguredSampleStratum,
	type NoticeEmbeddingSampleBoundary,
	type NoticeEmbeddingSampleRecord,
	type NoticeEmbeddingSampleSelection,
	type NoticeEmbeddingSampleStratum,
	type NoticeEmbeddingSampleStratumSummary,
} from "./embedding-sample-model.ts";
import type { NoticeChunk, Sha256Ref } from "./types.ts";

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
	return [...chunks].sort(
		(left, right) =>
			stableSampleRank(stratum, left.chunkId).localeCompare(
				stableSampleRank(stratum, right.chunkId),
			) || left.chunkId.localeCompare(right.chunkId),
	);
}

function stableBoundarySort(pairs: readonly BoundaryPair[]): BoundaryPair[] {
	return [...pairs].sort(
		(left, right) =>
			stableSampleRank("boundary", left.key).localeCompare(
				stableSampleRank("boundary", right.key),
			) || left.key.localeCompare(right.key),
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
