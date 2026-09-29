import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it, vi } from "vitest";

import { buildLocalNoticeChunkRun } from "../src/command.ts";
import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	parseCachedNoticeEmbedding,
} from "../src/embedding-cache.ts";
import {
		runLocalNoticeEmbeddingSample,
	selectNoticeEmbeddingSample,
} from "../src/embedding-sample/index.ts";
import { parseLocalEmbeddingSampleCommand } from "../src/cli/local-embedding-sample-cli.ts";
import { canonicalJsonBytes, sha256, unicodeLength } from "../src/encoding.ts";
import type { NoticeChunk, Sha256Ref } from "../src/types.ts";

describe("notice embedding sample selection", () => {
	it("selects a deterministic unique sample and preserves boundary neighbors", () => {
		const chunks = Array.from({ length: 480 }, (_, index) => {
			const lengths = [80, 180, 400, 700, 1050];
			return syntheticChunk(
				"1",
				index,
				lengths[index % lengths.length] ?? 80,
				index % 2 === 0 ? ["一、安排"] : [],
			);
		});
		const chunksByNoticeId = new Map<string, readonly NoticeChunk[]>([["1", chunks]]);
		const first = selectNoticeEmbeddingSample({
			chunks,
			chunksByNoticeId,
		});
		const second = selectNoticeEmbeddingSample({
			chunks: [...chunks].reverse(),
			chunksByNoticeId,
		});
		expect(second).toEqual(first);
		expect(first.records).toHaveLength(400);
		expect(new Set(first.records.map((record) => record.chunkId)).size).toBe(400);
		expect(first.records.every((record) => record.contentChars === unicodeLength(record.content))).toBe(
			true,
		);
		expect(
			first.records.every((record) => record.retrievalTextSha256 === sha256(record.retrievalText)),
		).toBe(true);

		const boundarySummary = first.strata.find((stratum) => stratum.name === "boundary");
		expect(boundarySummary).toMatchObject({
			selectedCount: 40,
			target: 40,
			unit: "boundary-pair",
		});
		const recordsById = new Map(first.records.map((record) => [record.chunkId, record]));
		for (const record of first.records.filter((item) => item.strata.includes("boundary"))) {
			expect(record.boundaries.length).toBeGreaterThan(0);
			const selectedBoundary = record.boundaries.find((boundary) =>
				recordsById.has(boundary.previousChunkId) && recordsById.has(boundary.nextChunkId),
			);
			expect(selectedBoundary).toBeDefined();
			if (selectedBoundary?.direction === "next") {
				expect(selectedBoundary.previousChunkIndex).toBe(record.chunkIndex);
				expect(selectedBoundary.nextChunkIndex).toBe(record.chunkIndex + 1);
			} else {
				expect(selectedBoundary?.direction).toBe("previous");
				expect(selectedBoundary?.previousChunkIndex).toBe(record.chunkIndex - 1);
				expect(selectedBoundary?.nextChunkIndex).toBe(record.chunkIndex);
			}
		}
	});

	it("uses all chunks when the corpus is smaller than the target", () => {
		const chunks = [
			syntheticChunk("1", 0, 20, []),
			syntheticChunk("1", 1, 200, ["一、安排"]),
			syntheticChunk("2", 0, 400, []),
		];
		const result = selectNoticeEmbeddingSample({
			chunks,
			chunksByNoticeId: new Map([
				["1", chunks.slice(0, 2)],
				["2", chunks.slice(2)],
			]),
		});

		expect(result.records.map((record) => record.chunkId).sort()).toEqual(
			chunks.map((chunk) => chunk.chunkId).sort(),
		);
	});
});

describe("notice embedding sample execution", () => {
	it("embeds unique retrieval texts, validates cache records, and reports reuse separately", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-embedding-sample-"));
		try {
			const chunkRun = await buildLocalNoticeChunkRun({
				artifactRoot: root,
				sources: [
					{ contentText: "同一正文。", noticeId: "1", title: "相同通知" },
					{ contentText: "同一正文。", noticeId: "2", title: "相同通知" },
				],
			});
			const embed = vi.fn(async (input: { dimensions: number; texts: string[] }) =>
				input.texts.map(() => {
					const vector = Array(input.dimensions).fill(0) as number[];
					vector[0] = 1;
					return vector;
				}),
			);
			const modelTargetSha256 = "a".repeat(64);

			const first = await runLocalNoticeEmbeddingSample({
				artifactRoot: root,
				chunkRun: chunkRun.run,
				embedding: { embed },
				modelTargetSha256,
			});
			const second = await runLocalNoticeEmbeddingSample({
				artifactRoot: root,
				chunkRun: chunkRun.run,
				embedding: {
					async embed() {
						throw new Error("cached rerun called embedding provider");
					},
				},
				modelTargetSha256,
			});

			expect(first.run).toBe(second.run);
			expect(first.selectedChunkCount).toBe(2);
			expect(first.uniqueEmbeddingInputCount).toBe(1);
			expect(first.generatedEmbeddingInputCount).toBe(1);
			expect(first.reusedEmbeddingInputCount).toBe(0);
			expect(second.generatedEmbeddingInputCount).toBe(0);
			expect(second.reusedEmbeddingInputCount).toBe(1);
			expect(first.report.statuses).toHaveLength(2);
			expect(first.report.statuses.every((status) => status.cacheStatus === "generated")).toBe(true);
			expect(second.report.statuses.every((status) => status.cacheStatus === "reused")).toBe(true);
			expect(first.reportRun).not.toBe(second.reportRun);
			expect(embed).toHaveBeenCalledTimes(1);
			const firstManifestBytes = await readFile(join(first.outputDirectory, "manifest.json"));
			expect(sha256(firstManifestBytes)).toBe(first.run);
			const firstReportBytes = await readFile(join(first.reportDirectory, "report.json"));
			const firstReportManifestBytes = await readFile(join(first.reportDirectory, "manifest.json"));
			expect(sha256(firstReportManifestBytes)).toBe(first.reportRun);
			expect(sha256(firstReportBytes)).toBe(
				JSON.parse(firstReportManifestBytes.toString("utf8")).report.sha256,
			);
			expect(
				JSON.parse(firstManifestBytes.toString("utf8")),
			).toMatchObject({
				chunkRun: chunkRun.run,
				selectedChunkCount: 2,
				uniqueEmbeddingInputCount: 1,
			});
			expect(JSON.parse(firstReportBytes.toString("utf8"))).toMatchObject({
				generatedEmbeddingInputCount: 1,
				passed: true,
				schemaVersion: "notice_embedding_sample_report.v1",
			});
			expect(
				JSON.parse(await readFile(join(first.reportDirectory, "manifest.json"), "utf8")),
			).toMatchObject({
				report: { file: "report.json" },
				sampleRun: first.run,
			});
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});

describe("notice embedding cache contract", () => {
	it("rejects invalid dimensions, zero norms, and non-canonical cache JSON", () => {
		const textSha256 = sha256("text");
		const modelTargetSha256 = "a".repeat(64);
		const valid = {
			dense: [1, 0],
			embeddingSpace: EMBEDDING_SPACE,
			modelTargetSha256,
			schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
			textSha256,
		};

		expect(() => parseCachedNoticeEmbedding(canonicalJsonBytes(valid), textSha256, modelTargetSha256)).toThrow(
			"vector is invalid",
		);
		const zero = {
			...valid,
			dense: Array(EMBEDDING_SPACE.dimensions).fill(0) as number[],
		};
		expect(() => parseCachedNoticeEmbedding(canonicalJsonBytes(zero), textSha256, modelTargetSha256)).toThrow(
			"norm is invalid",
		);
		const dense = Array(EMBEDDING_SPACE.dimensions).fill(0) as number[];
		dense[0] = 1;
		const canonical = {
			...valid,
			dense,
		};
		const nonCanonical = new TextEncoder().encode(
			JSON.stringify({
				textSha256,
				schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
				modelTargetSha256,
				embeddingSpace: EMBEDDING_SPACE,
				dense,
			}) + "\n",
		);
		expect(() => parseCachedNoticeEmbedding(nonCanonical, textSha256, modelTargetSha256)).toThrow(
			"not canonical",
		);
		expect(parseCachedNoticeEmbedding(canonicalJsonBytes(canonical), textSha256, modelTargetSha256).dense).toHaveLength(
			EMBEDDING_SPACE.dimensions,
		);
	});
});

describe("notice embedding sample CLI", () => {
	it("parses the explicit chunk run and rejects extra flags", () => {
		const chunkRun = `sha256:${"a".repeat(64)}` as Sha256Ref;
		expect(parseLocalEmbeddingSampleCommand(["--", "--chunk-run", chunkRun])).toEqual({ chunkRun });
		expect(() => parseLocalEmbeddingSampleCommand(["--chunk-run", chunkRun, "--extra", "value"])).toThrow(
			"Usage: sample-embeddings-local",
		);
	});
});

function syntheticChunk(
	noticeId: string,
	chunkIndex: number,
	contentChars: number,
	headingPath: string[],
): NoticeChunk {
	const content = "字".repeat(contentChars);
	const retrievalText = `通知${noticeId}\n${headingPath.join("\n")}\n${content}`;
	return {
		chunkId: sha256(`${noticeId}\0${chunkIndex}\0${retrievalText}`),
		chunkIndex,
		content,
		headingPath,
		noticeId,
		retrievalText,
	};
}
