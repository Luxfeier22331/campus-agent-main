import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemOfficialWebNextArtifactStore } from "../src/index.ts";

describe("official-web-next filesystem artifact store", () => {
	it("writes object keys under the configured root and returns content metadata", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "official-web-next-store-"));
		const store = new FilesystemOfficialWebNextArtifactStore(rootDir);

		const ref = await store.putObject({
			objectKey: "official_web_next/site/runs/run-001/source-truth-bundle.json",
			contentType: "application/json",
			data: new TextEncoder().encode('{"ok":true}'),
			recordCount: 1,
		});

		expect(ref).toEqual(
			expect.objectContaining({
				byteSize: 11,
				objectKey: "official_web_next/site/runs/run-001/source-truth-bundle.json",
				recordCount: 1,
			}),
		);
		await expect(readFile(join(rootDir, ref.objectKey), "utf8")).resolves.toBe('{"ok":true}');
	});

	it("rejects object keys that escape the configured root", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "official-web-next-store-"));
		const store = new FilesystemOfficialWebNextArtifactStore(rootDir);

		await expect(
			store.putObject({
				objectKey: "../escape.json",
				contentType: "application/json",
				data: new TextEncoder().encode("{}"),
			}),
		).rejects.toThrow(/must stay under artifact root/u);
	});
});
