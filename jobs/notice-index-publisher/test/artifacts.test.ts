import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildLocalNoticeChunkRun } from "../src/command.ts";

describe("local notice chunk artifacts", () => {
	it("writes content-addressed artifacts and accepts an identical rerun", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-chunks-"));
		try {
			const input = {
				artifactRoot: root,
				sources: [
					{ contentText: "正文内容。", noticeId: "1", title: "第一条通知" },
					{ contentText: "一、安排\n按要求办理。", noticeId: "2", title: "第二条通知" },
				],
			};
			const first = await buildLocalNoticeChunkRun(input);
			const second = await buildLocalNoticeChunkRun(input);

			expect(second).toEqual(first);
			expect(
				JSON.parse(await readFile(join(first.outputDirectory, "manifest.json"), "utf8")),
			).toMatchObject({ chunkCount: 2, noticeCount: 2, schemaVersion: "notice_chunk_run.v1" });
			await expect(
				readFile(join(first.outputDirectory, "source-projection.ndjson")),
			).rejects.toThrow();
			expect(await readFile(join(first.outputDirectory, "chunks.ndjson"), "utf8")).toContain(
				'"noticeId":"1"',
			);
			expect(await readFile(join(first.outputDirectory, "validation.json"), "utf8")).toContain(
				'"primaryBoundaryCrossingCount":0',
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("sorts source notices before deriving the run identity", async () => {
		const firstRoot = await mkdtemp(join(tmpdir(), "notice-chunks-order-a-"));
		const secondRoot = await mkdtemp(join(tmpdir(), "notice-chunks-order-b-"));
		try {
			const sources = [
				{ contentText: "第二条正文。", noticeId: "2", title: "第二条通知" },
				{ contentText: "第一条正文。", noticeId: "1", title: "第一条通知" },
			];
			const reversed = [...sources].reverse();
			const first = await buildLocalNoticeChunkRun({ artifactRoot: firstRoot, sources });
			const second = await buildLocalNoticeChunkRun({
				artifactRoot: secondRoot,
				sources: reversed,
			});

			expect(second.run).toBe(first.run);
			expect(await readFile(join(second.outputDirectory, "chunks.ndjson"), "utf8")).toBe(
				await readFile(join(first.outputDirectory, "chunks.ndjson"), "utf8"),
			);
		} finally {
			await Promise.all([
				rm(firstRoot, { force: true, recursive: true }),
				rm(secondRoot, { force: true, recursive: true }),
			]);
		}
	});

	it("rejects a conflicting file in an existing run", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-chunks-"));
		try {
			const input = {
				artifactRoot: root,
				sources: [{ contentText: "正文内容。", noticeId: "1", title: "通知" }],
			};
			const first = await buildLocalNoticeChunkRun(input);
			await writeFile(join(first.outputDirectory, "chunks.ndjson"), "changed\n");

			await expect(buildLocalNoticeChunkRun(input)).rejects.toThrow(
				"local notice chunk artifact conflicts",
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
