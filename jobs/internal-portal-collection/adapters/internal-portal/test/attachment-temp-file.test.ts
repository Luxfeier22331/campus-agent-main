import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spoolAttachmentToTemporaryFile } from "../src/attachment-temp-file.js";

describe("attachment temporary file", () => {
	const originalTmpdir = process.env.TMPDIR;
	let spoolRoot: string;

	beforeEach(async () => {
		spoolRoot = await mkdtemp(path.join(tmpdir(), "attachment-spool-test-"));
		process.env.TMPDIR = spoolRoot;
	});

	afterEach(async () => {
		if (originalTmpdir === undefined) {
			delete process.env.TMPDIR;
		} else {
			process.env.TMPDIR = originalTmpdir;
		}
		await rm(spoolRoot, { force: true, recursive: true });
	});

	it("records size and digest while writing the body", async () => {
		const file = await spoolAttachmentToTemporaryFile({
			body: chunks("file-", "bytes"),
			maxBytes: 10,
			sizeLimitError: () => new Error("too large"),
		});

		expect(file.byteSize).toBe(10);
		expect(file.contentSha256).toBe(createHash("sha256").update("file-bytes").digest("hex"));
		expect(await readFile(file.filePath, "utf-8")).toBe("file-bytes");
		await file.remove();
		expect(await readdir(spoolRoot)).toEqual([]);
	});

	it.each([
		{ expected: "too large", maxBytes: 7 },
		{ expected: "download cancelled", maxBytes: 100 },
	])("removes the partial file when it fails with $expected", async ({ expected, maxBytes }) => {
		const controller = new AbortController();
		async function* body() {
			yield new TextEncoder().encode("12345");
			expect(await readdir(spoolRoot)).toHaveLength(1);
			if (expected === "download cancelled") {
				controller.abort(new Error("download cancelled"));
			}
			yield new TextEncoder().encode("67890");
		}

		await expect(
			spoolAttachmentToTemporaryFile({
				abortSignal: controller.signal,
				body: body(),
				maxBytes,
				sizeLimitError: () => new Error("too large"),
			}),
		).rejects.toThrow(expected);
		expect(await readdir(spoolRoot)).toEqual([]);
	});
});

async function* chunks(...values: string[]) {
	for (const value of values) {
		yield new TextEncoder().encode(value);
	}
}
