import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
	ListObjectVersionsCommand,
	DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createArtifactStore } from "../src/stream-store.ts";
import { canonical, digest } from "../src/workspace.ts";
const env = {
	OBJECT_STORE_ENDPOINT: "http://store.test",
	OBJECT_STORE_DERIVED_ACCESS_KEY: "test",
	OBJECT_STORE_DERIVED_SECRET_KEY: "test",
};
afterEach(() => vi.restoreAllMocks());
it("streams deterministic bytes and checks an existing immutable object", async () => {
	const expected = Buffer.from(canonical({ text: "中文😀" }) + "\n");
	let uploaded = false;
	vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
		if (command instanceof GetObjectCommand) return { Body: Readable.from([expected]) };
		if (!(command instanceof PutObjectCommand)) throw new Error("unexpected command");
		if (uploaded) throw { $metadata: { httpStatusCode: 412 } };
		const chunks = [];
		for await (const chunk of command.input.Body as Readable) chunks.push(chunk);
		expect(Buffer.concat(chunks)).toEqual(expected);
		uploaded = true;
		return {};
	});
	const store = createArtifactStore(env);
	try {
		for (let i = 0; i < 2; i++) {
			const ref = await store.writeRecords("notices/rag/chunk-data", "chunks.ndjson", () => [
				{ text: "中文😀" },
			]);
			expect(ref.sha256).toBe(digest(expected));
			expect(ref.byteSize).toBe(expected.length);
		}
	} finally {
		store.close();
	}
});
it("uploads bounded parts serially and aborts an incomplete upload", async () => {
	const sizes: number[] = [];
	let fail = false;
	let aborted = false;
	vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
		if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload" };
		if (command instanceof UploadPartCommand) {
			if (fail) throw new Error("upload interrupted");
			sizes.push(command.input.ContentLength!);
			return { ETag: `part-${sizes.length}` };
		}
		if (command instanceof CompleteMultipartUploadCommand) {
			expect(command.input.IfNoneMatch).toBe("*");
			expect(command.input.MultipartUpload!.Parts).toHaveLength(2);
			return {};
		}
		if (command instanceof AbortMultipartUploadCommand) {
			aborted = true;
			return {};
		}
		throw new Error("unexpected command");
	});
	const store = createArtifactStore(env);
	const rows = function* () {
		for (let i = 0; i < 18; i++) yield { text: "x".repeat(1024 * 1024) };
	};
	try {
		const result = await store.writeRecords(
			"notices/rag/embedding-data",
			"embeddings.ndjson",
			rows,
		);
		expect(sizes[0]).toBe(16 * 1024 * 1024);
		expect(sizes.reduce((a, b) => a + b, 0)).toBe(result.byteSize);
		fail = true;
		await expect(
			store.writeRecords("notices/rag/embedding-data", "embeddings.ndjson", rows),
		).rejects.toThrow("upload interrupted");
		expect(aborted).toBe(true);
	} finally {
		store.close();
	}
});
it("removes all versions of legacy review filenames", async () => {
	const Key = `notices/rag/chunk-runs/sha256/${"a".repeat(64)}/review-samples.ndjson`;
	let deleted = false;
	vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
		if (command instanceof ListObjectVersionsCommand)
			return { Versions: deleted ? [] : [{ Key, VersionId: "version" }] };
		if (command instanceof DeleteObjectCommand) {
			expect(command.input).toMatchObject({ Key, VersionId: "version" });
			deleted = true;
			return {};
		}
		throw new Error("unexpected command");
	});
	const store = createArtifactStore(env);
	try {
		await store.remove(Key);
		expect(deleted).toBe(true);
	} finally {
		store.close();
	}
});
