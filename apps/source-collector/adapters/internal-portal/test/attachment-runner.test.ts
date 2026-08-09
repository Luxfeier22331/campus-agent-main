import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { downloadAttachment } from "../src/attachment-runner.js";
import type { ApiResponseLike } from "../src/types.js";

describe("file-release attachment downloader", () => {
	it("downloads one internal portal file to a temporary stream", async () => {
		const get = vi.fn(async () => response("file-bytes"));
		const result = await downloadAttachment({
			apiContext: { get, post: async () => response("") },
			attachmentUrl: "/files/646.pdf",
		});

		try {
			expect(get).toHaveBeenCalledOnce();
			expect(get).toHaveBeenCalledWith("/files/646.pdf");
			expect(await readFile(result.filePath, "utf-8")).toBe("file-bytes");
			expect(result.byteSize).toBe(10);
		} finally {
			await result.remove();
		}
	});

	it("propagates a missing file as a collection failure", async () => {
		await expect(
			downloadAttachment({
				apiContext: {
					get: async () => ({
						cancelBody: async () => undefined,
						headers: () => ({}),
						ok: () => false,
						status: () => 404,
						statusText: () => "Not Found",
						text: async () => "Not Found",
					}),
					post: async () => response(""),
				},
				attachmentUrl: "/files/missing.pdf",
			}),
		).rejects.toThrow("Internal portal attachment download request failed.");
	});
});

function response(payload: string): ApiResponseLike {
	return {
		bodyStream: () => bytes(payload),
		headers: () => ({
			"content-disposition": 'attachment; filename="sample.pdf"',
			"content-length": String(Buffer.byteLength(payload)),
			"content-type": "application/pdf",
		}),
		ok: () => true,
		status: () => 200,
		statusText: () => "OK",
		text: async () => payload,
	};
}

async function* bytes(payload: string): AsyncIterable<Uint8Array> {
	yield Buffer.from(payload);
}
