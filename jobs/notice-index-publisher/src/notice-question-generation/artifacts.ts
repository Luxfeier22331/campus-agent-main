import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import { NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY } from "../broad-review/index.ts";
import { artifactHex } from "../run-reader.ts";
import type { NoticeChunk, Sha256Ref } from "../types.ts";

export interface BroadSampleChunk {
	chunkId: string;
	chunkIndex: number;
	content: string;
}

export interface BroadSampleNotice {
	chunks: BroadSampleChunk[];
	noticeId: string;
	primaryStratum?: string;
	title: string;
}

export interface LoadedBroadSample {
	censusBytes: Uint8Array;
	notices: BroadSampleNotice[];
	sampleBytes: Uint8Array;
}

export async function loadBroadSample(
	artifactRoot: string,
	chunkRun: Sha256Ref,
	chunksByNoticeId: ReadonlyMap<string, readonly NoticeChunk[]>,
): Promise<LoadedBroadSample> {
	const directory = join(
		artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	);
	const [censusBytes, sampleBytes] = await Promise.all([
		readFile(join(directory, "census.json")),
		readFile(join(directory, "broad-sample.ndjson")),
	]);
	const census = parseJson(censusBytes, "notice broad sample census");
	if (!isRecord(census) || census.run !== chunkRun) {
		throw new Error("notice broad sample census does not match the chunk run");
	}
	const values = decodeNdjson(sampleBytes, "notice broad sample");
	const seenNoticeIds = new Set<string>();
	const notices = values.map((value, index) => {
		const notice = decodeBroadSampleNotice(value, index);
		if (seenNoticeIds.has(notice.noticeId)) {
			throw new Error(`notice broad sample notice is duplicated: ${notice.noticeId}`);
		}
		seenNoticeIds.add(notice.noticeId);
		const runChunks = chunksByNoticeId.get(notice.noticeId);
		if (!runChunks || runChunks.length !== notice.chunks.length) {
			throw new Error(`notice broad sample chunks do not match notice ${notice.noticeId}`);
		}
		const orderedSampleChunks = [...notice.chunks].sort(
			(left, right) => left.chunkIndex - right.chunkIndex,
		);
		const orderedRunChunks = [...runChunks].sort(
			(left, right) => left.chunkIndex - right.chunkIndex,
		);
		for (const [chunkIndex, sampleChunk] of orderedSampleChunks.entries()) {
			const runChunk = orderedRunChunks[chunkIndex];
			if (
				!runChunk ||
				sampleChunk.chunkIndex !== chunkIndex ||
				sampleChunk.chunkId !== runChunk.chunkId ||
				sampleChunk.content !== runChunk.content
			) {
				throw new Error(`notice broad sample chunk mismatch: ${notice.noticeId}:${chunkIndex}`);
			}
		}
		return { ...notice, chunks: orderedSampleChunks };
	});
	return { censusBytes, notices, sampleBytes };
}

export async function loadReviewCandidates(
	artifactRoot: string,
	chunkRun: Sha256Ref,
): Promise<{ bytes: Uint8Array; noticeIds: string[] }> {
	const path = join(
		artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
		"review-candidates.ndjson",
	);
	const bytes = await readFile(path);
	const values = decodeNdjson(bytes, "notice review candidates");
	const noticeIds = [
		...new Set(
			values.map((value, index) => {
				if (!isRecord(value) || !nonEmptyString(value.noticeId)) {
					throw new Error(`notice review candidate ${index} has invalid noticeId`);
				}
				return value.noticeId;
			}),
		),
	].sort(compareNoticeIds);
	return { bytes, noticeIds };
}

function decodeBroadSampleNotice(value: unknown, index: number): BroadSampleNotice {
	if (!isRecord(value) || !nonEmptyString(value.noticeId) || !nonEmptyString(value.title)) {
		throw new Error(`notice broad sample record ${index} is invalid`);
	}
	if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
		throw new Error(`notice broad sample record ${index} has no chunks`);
	}
	const chunks = value.chunks.map((raw, chunkIndex) => {
		if (!isRecord(raw) || !nonEmptyString(raw.chunkId) || !nonEmptyString(raw.content)) {
			throw new Error(`notice broad sample ${index} chunk ${chunkIndex} is invalid`);
		}
		if (!nonNegativeInteger(raw.chunkIndex)) {
			throw new Error(`notice broad sample ${index} chunk ${chunkIndex} has invalid index`);
		}
		return {
			chunkId: raw.chunkId,
			chunkIndex: raw.chunkIndex,
			content: raw.content,
		};
	});
	if (value.primaryStratum !== undefined && !nonEmptyString(value.primaryStratum)) {
		throw new Error(`notice broad sample record ${index} has invalid primary stratum`);
	}
	return {
		chunks,
		noticeId: value.noticeId,
		...(value.primaryStratum !== undefined ? { primaryStratum: value.primaryStratum } : {}),
		title: value.title,
	};
}

function decodeNdjson(bytes: Uint8Array, label: string): unknown[] {
	const text = Buffer.from(bytes).toString("utf8");
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	return lines.map((line, index) => {
		try {
			return JSON.parse(line) as unknown;
		} catch (error) {
			throw new Error(`${label} record ${index} is not valid JSON`, { cause: error });
		}
	});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid JSON`, { cause: error });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareNoticeIds(left: string, right: string): number {
	try {
		const leftNumber = BigInt(left);
		const rightNumber = BigInt(right);
		return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
	} catch {
		return compareCanonicalStrings(left, right);
	}
}
