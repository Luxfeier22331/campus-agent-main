import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildLocalNoticeChunkRun } from "../src/command.ts";
import { canonicalJsonBytes, sha256 } from "../src/encoding.ts";
import { readNoticeChunkRun } from "../src/run-reader.ts";
import type { Sha256Ref } from "../src/types.ts";

describe("notice chunk run reader", () => {
	it("reads the ordinary chunk run artifacts", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-run-reader-"));
		try {
			const result = await buildLocalNoticeChunkRun({
				artifactRoot: root,
				sources: [
					{ contentText: "正文一", noticeId: "1", title: "通知一" },
					{ contentText: "正文二", noticeId: "2", title: "通知二" },
				],
			});
			const run = await readNoticeChunkRun(root, result.run);

			expect(run.manifest.chunkCount).toBe(2);
			expect(run.manifest.noticeCount).toBe(2);
			expect(run.chunksByNoticeId.get("1")).toHaveLength(1);
			expect(run.reviewSamples.length).toBeGreaterThan(0);
			expect(run.validation.chunkCount).toBe(2);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it.each(["notice_chunk_validation.v1", "notice_chunk_validation.v2"] as const)(
		"reads legacy %s diagnostics as zero",
		async (schemaVersion) => {
			const root = await mkdtemp(join(tmpdir(), "notice-run-reader-legacy-"));
			try {
				const result = await buildLocalNoticeChunkRun({
					artifactRoot: root,
					sources: [{ contentText: "正文", noticeId: "1", title: "通知" }],
				});
				const legacyRun = await writeLegacyValidationRun(root, result.run, schemaVersion);
				const run = await readNoticeChunkRun(root, legacyRun);

				expect(run.validation).toMatchObject({
					fieldValueSplitCount: 0,
					listContinuationSplitCount: 0,
					schemaVersion: "notice_chunk_validation.v3",
					tableHeaderContextMissingCount: 0,
					tableRowSplitCount: 0,
					urlOwnerSplitCount: 0,
				});
				if (schemaVersion === "notice_chunk_validation.v1") {
					expect(run.validation).toMatchObject({
						footerOnlyChunkCount: 0,
						headingContentDuplicateCount: 0,
						formalHeadingPathViolationCount: 0,
						orphanLabelCount: 0,
						secondaryBoundaryCrossingCount: 0,
						standaloneUrlCount: 0,
					});
				}
			} finally {
				await rm(root, { force: true, recursive: true });
			}
		},
	);
});

async function writeLegacyValidationRun(
	root: string,
	run: Sha256Ref,
	schemaVersion: "notice_chunk_validation.v1" | "notice_chunk_validation.v2",
): Promise<Sha256Ref> {
	const sourceDirectory = join(root, "notices", "chunking", "sha256", run.slice("sha256:".length));
	const [manifestBytes, chunkBytes, reviewBytes, currentValidationBytes] = await Promise.all([
		readFile(join(sourceDirectory, "manifest.json")),
		readFile(join(sourceDirectory, "chunks.ndjson")),
		readFile(join(sourceDirectory, "review-samples.ndjson")),
		readFile(join(sourceDirectory, "validation.json")),
	]);
	const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
	const validation = JSON.parse(currentValidationBytes.toString("utf8")) as Record<string, unknown>;
	validation.schemaVersion = schemaVersion;
	for (const field of [
		"fieldValueSplitCount",
		"listContinuationSplitCount",
		"tableHeaderContextMissingCount",
		"tableRowSplitCount",
		"urlOwnerSplitCount",
	]) {
		delete validation[field];
	}
	if (schemaVersion === "notice_chunk_validation.v1") {
		for (const field of [
			"footerOnlyChunkCount",
			"headingContentDuplicateCount",
			"formalHeadingPathViolationCount",
			"orphanLabelCount",
			"secondaryBoundaryCrossingCount",
			"standaloneUrlCount",
		]) {
			delete validation[field];
		}
	}
	const validationBytes = canonicalJsonBytes(validation);
	manifest.validation = {
		byteSize: validationBytes.byteLength,
		file: "validation.json",
		sha256: sha256(validationBytes),
	};
	const legacyManifestBytes = canonicalJsonBytes(manifest);
	const legacyRun = sha256(legacyManifestBytes);
	const outputDirectory = join(
		root,
		"notices",
		"chunking",
		"sha256",
		legacyRun.slice("sha256:".length),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeFile(join(outputDirectory, "manifest.json"), legacyManifestBytes),
		writeFile(join(outputDirectory, "chunks.ndjson"), chunkBytes),
		writeFile(join(outputDirectory, "review-samples.ndjson"), reviewBytes),
		writeFile(join(outputDirectory, "validation.json"), validationBytes),
	]);
	return legacyRun;
}
