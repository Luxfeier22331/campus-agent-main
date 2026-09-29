import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createOrVerifyS3Object, sha256Hex } from "../src/s3-create-or-verify.ts";

describe("internal portal collection S3 create-or-verify", () => {
	it("hashes bytes and verifies the stored object identity", async () => {
		const body = new TextEncoder().encode("source-bytes");
		const digest = sha256Hex(body);
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof PutObjectCommand) {
				return { ETag: "put-etag", VersionId: "put-version" };
			}
			if (command instanceof HeadObjectCommand) {
				return {
					ContentLength: body.byteLength,
					ETag: "head-etag",
					Metadata: { "content-sha256": digest },
					VersionId: "head-version",
				};
			}
			throw new Error("unexpected S3 command");
		});

		await expect(
			createOrVerifyS3Object({
				body,
				bucket: "campus-agent-source",
				client: { send } as never,
				contentType: "application/octet-stream",
				key: "sources/example",
			}),
		).resolves.toEqual({
			byteSize: body.byteLength,
			contentSha256: digest,
			versionId: "head-version",
		});
	});

	it("rejects an existing object with different bytes", async () => {
		const body = new TextEncoder().encode("source-bytes");
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof PutObjectCommand) {
				throw Object.assign(new Error("already exists"), { name: "PreconditionFailed" });
			}
			if (command instanceof HeadObjectCommand) {
				return {
					ContentLength: body.byteLength + 1,
					Metadata: { "content-sha256": "0".repeat(64) },
				};
			}
			throw new Error("unexpected S3 command");
		});

		await expect(
			createOrVerifyS3Object({
				body,
				bucket: "campus-agent-source",
				client: { send } as never,
				contentType: "application/octet-stream",
				key: "sources/example",
			}),
		).rejects.toThrow("object identity collision at s3://campus-agent-source/sources/example");
	});
});
